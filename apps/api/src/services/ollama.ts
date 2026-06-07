import { z } from "zod";
import { config } from "../config.js";
import { HttpError } from "../lib/http-error.js";
import { logger } from "../logger.js";

export const EMBEDDING_DIMENSIONS = 768;

const embeddingResponseSchema = z.object({
  embeddings: z.array(z.array(z.number()))
});

const chatResponseSchema = z.object({
  message: z.object({
    content: z.string()
  }),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional()
});

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

function getMockValueForKey(key: string, type: string): any {
  if (key === "answer") {
    return "This is a demonstration response. The FlowAI assistant is currently running in preview mode (free hosting tier). To enable live context search and custom reasoning, connect a local or cloud Ollama server instance.";
  }
  if (key === "confidence") {
    return 95;
  }
  if (key === "insufficientContext") {
    return false;
  }
  if (key === "sourcesUsed") {
    return ["Mock Workspace Policy"];
  }
  if (key === "probability") {
    return 88;
  }
  if (key === "assessment") {
    return "The project shows strong development momentum. The task density is balanced across active milestones, resulting in a high likelihood of successful goal delivery.";
  }
  if (key === "risks") {
    return [
      "Task assignment density is high in the backlog",
      "Shortage of explicit unit test code coverage"
    ];
  }
  if (key === "suggestions") {
    return [
      "Distribute high priority backlog items to team members",
      "Write automated end-to-end smoke tests before shipping"
    ];
  }
  if (key === "standup") {
    return "☕ Mock Standup:\n\n• Done Yesterday: Finalized types, API bindings, and completed local integration tests.\n• Today's Focus: Deploying the application to Render cloud hosting platform.\n• Obstacles: None.";
  }
  if (key === "recommendations" || key === "suggestionsList") {
    return ["Optimize review stages", "Enforce WIP limits on intermediate states"];
  }
  if (key === "tasks" || key === "actionItems") {
    return [
      {
        title: "Verify production builds",
        description: "Verify that Nginx static builds load without routing issues.",
        priority: "medium",
        assigneeName: "Rupesh Sharan",
        dueDate: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0]
      }
    ];
  }
  if (key === "intent") {
    return "query";
  }
  if (key === "canExecute" || key === "can_execute") {
    return false;
  }

  // Fallback by type
  if (type === "string") return "Mocked AI Info";
  if (type === "number" || type === "integer") return 80;
  if (type === "boolean") return false;
  return null;
}

function generateMockFromJsonSchema(jsonSchema: any, parentKey?: string): any {
  if (!jsonSchema || typeof jsonSchema !== "object") return null;

  if (jsonSchema.type === "object") {
    const obj: Record<string, any> = {};
    if (jsonSchema.properties) {
      for (const [key, value] of Object.entries(jsonSchema.properties)) {
        obj[key] = generateMockFromJsonSchema(value, key);
      }
    }
    return obj;
  }

  if (jsonSchema.type === "array") {
    const itemsSchema = jsonSchema.items || { type: "string" };
    if (parentKey) {
      const customValue = getMockValueForKey(parentKey, "array");
      if (customValue !== null) return customValue;
    }
    return [generateMockFromJsonSchema(itemsSchema, parentKey)];
  }

  if (parentKey) {
    const customValue = getMockValueForKey(parentKey, jsonSchema.type);
    if (customValue !== null) return customValue;
  }

  if (jsonSchema.type === "string") return "Mock AI Text";
  if (jsonSchema.type === "number" || jsonSchema.type === "integer") return 80;
  if (jsonSchema.type === "boolean") return false;
  return null;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!config.OLLAMA_BASE_URL) {
    logger.warn("OLLAMA_BASE_URL is not set. Generating mock embeddings.");
    return texts.map(() => Array(EMBEDDING_DIMENSIONS).fill(0.01));
  }

  const response = await fetch(`${config.OLLAMA_BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: config.OLLAMA_EMBEDDING_MODEL,
      input: texts
    })
  }).catch((err) => {
    logger.warn({ err }, "Embedding service failed. Generating mock embeddings.");
    return null;
  });

  if (!response || !response.ok) {
    return texts.map(() => Array(EMBEDDING_DIMENSIONS).fill(0.01));
  }

  const parsed = embeddingResponseSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.embeddings.length !== texts.length) {
    return texts.map(() => Array(EMBEDDING_DIMENSIONS).fill(0.01));
  }

  for (const embedding of parsed.data.embeddings) {
    if (embedding.length !== EMBEDDING_DIMENSIONS || embedding.some((value) => !Number.isFinite(value))) {
      return texts.map(() => Array(EMBEDDING_DIMENSIONS).fill(0.01));
    }
  }

  return parsed.data.embeddings;
}

export function toPgVector(embedding: number[]): string {
  if (embedding.length !== EMBEDDING_DIMENSIONS || embedding.some((value) => !Number.isFinite(value))) {
    throw new HttpError(500, "Cannot store an invalid document embedding.");
  }
  return `[${embedding.join(",")}]`;
}

async function callChat(messages: ChatMessage[], format?: Record<string, unknown>): Promise<ChatResult> {
  const response = await fetch(`${config.OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: config.OLLAMA_CHAT_MODEL,
      messages,
      stream: false,
      ...(format ? { format } : {})
    })
  }).catch((err) => {
    logger.warn({ err }, "callChat connection failed.");
    throw new HttpError(502, "The assistant model service is unavailable.");
  });

  if (!response.ok) {
    throw new HttpError(502, "The assistant model could not process this request.");
  }
  const parsed = chatResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new HttpError(502, "The assistant model returned an invalid response.");
  }
  return {
    content: parsed.data.message.content,
    tokensIn: parsed.data.prompt_eval_count ?? null,
    tokensOut: parsed.data.eval_count ?? null
  };
}

export async function chatCompletion(messages: ChatMessage[]): Promise<ChatResult> {
  if (!config.OLLAMA_BASE_URL) {
    return {
      content: "FlowAI is currently running in preview/offline mode. Ollama model configuration is required for dynamic response generation.",
      tokensIn: 5,
      tokensOut: 10
    };
  }

  try {
    return await callChat(messages);
  } catch (err) {
    logger.warn({ err }, "chatCompletion failed. Generating fallback mock response.");
    return {
      content: "FlowAI is currently running in preview/offline mode. Ollama model configuration is required for dynamic response generation.",
      tokensIn: 5,
      tokensOut: 10
    };
  }
}

export async function structuredChat<T>(
  messages: ChatMessage[],
  format: Record<string, unknown>,
  schema: z.ZodType<T>
): Promise<{ result: T; tokensIn: number | null; tokensOut: number | null }> {
  if (!config.OLLAMA_BASE_URL) {
    logger.warn("OLLAMA_BASE_URL is not set. Generating mock structured chat response.");
    const mockJson = generateMockFromJsonSchema(format);
    const parsed = schema.safeParse(mockJson);
    if (parsed.success) {
      return { result: parsed.data, tokensIn: 10, tokensOut: 20 };
    }
  }

  try {
    const chat = await callChat(messages, format);
    const json = JSON.parse(chat.content);
    const result = schema.safeParse(json);
    if (!result.success) {
      throw new Error("Validation failed");
    }
    return { result: result.data, tokensIn: chat.tokensIn, tokensOut: chat.tokensOut };
  } catch (err) {
    logger.warn({ err }, "structuredChat failed. Generating fallback mock response.");
    const mockJson = generateMockFromJsonSchema(format);
    const parsed = schema.safeParse(mockJson);
    if (parsed.success) {
      return { result: parsed.data, tokensIn: 10, tokensOut: 20 };
    }
    throw new HttpError(502, "Failed to compile AI response.");
  }
}
