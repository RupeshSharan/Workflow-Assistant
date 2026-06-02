import "dotenv/config";
import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("8h"),
  REDIS_URL: z.string().url().optional(),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_CHAT_MODEL: z.string().default("llama3.1:8b"),
  OLLAMA_EMBEDDING_MODEL: z.string().default("nomic-embed-text"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("workflow-documents"),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional()
});

const result = environmentSchema.safeParse(process.env);

if (!result.success) {
  throw new Error(`Invalid environment configuration: ${result.error.message}`);
}

export const config = result.data;
