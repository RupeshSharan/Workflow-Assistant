import { z } from "zod";
import { config } from "../config.js";
import { HttpError } from "../lib/http-error.js";

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

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const response = await fetch(`${config.OLLAMA_BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: config.OLLAMA_EMBEDDING_MODEL,
      input: texts
    })
  }).catch(() => {
    throw new HttpError(502, "The embedding model service is unavailable.");
  });

  if (!response.ok) {
    throw new HttpError(502, "The embedding model could not process this request.");
  }

  const parsed = embeddingResponseSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.embeddings.length !== texts.length) {
    throw new HttpError(502, "The embedding model returned an invalid response.");
  }

  for (const embedding of parsed.data.embeddings) {
    if (embedding.length !== EMBEDDING_DIMENSIONS || embedding.some((value) => !Number.isFinite(value))) {
      throw new HttpError(
        502,
        `The configured embedding model must return ${EMBEDDING_DIMENSIONS}-dimension vectors.`
      );
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
  }).catch(() => {
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

export function chatCompletion(messages: ChatMessage[]): Promise<ChatResult> {
  return callChat(messages);
}

export async function structuredChat<T>(
  messages: ChatMessage[],
  format: Record<string, unknown>,
  schema: z.ZodType<T>
): Promise<{ result: T; tokensIn: number | null; tokensOut: number | null }> {
  const chat = await callChat(messages, format);
  let json: unknown;
  try {
    json = JSON.parse(chat.content);
  } catch {
    throw new HttpError(502, "The assistant model response was not valid JSON.");
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new HttpError(502, "The assistant model response did not match the required format.");
  }
  return { result: result.data, tokensIn: chat.tokensIn, tokensOut: chat.tokensOut };
}
