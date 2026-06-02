import { Queue } from "bullmq";
import { redis } from "./redis.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

// Target queue for text extraction, chunking and embeddings
export const documentQueue = new Queue("document-indexing", {
  connection: redis as any
});

interface IndexingJobPayload {
  orgId: string;
  workspaceId: string;
  documentId: string;
  fileKey?: string;
  actorId?: string;
}

/**
 * Enqueues a document indexing job.
 */
export async function enqueueDocumentIndexing(payload: IndexingJobPayload): Promise<void> {
  try {
    await documentQueue.add("index-document", payload, {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000
      },
      removeOnComplete: true,
      removeOnFail: false
    });
    logger.info({ documentId: payload.documentId }, "Enqueued background indexing job");
  } catch (error) {
    logger.error({ error, documentId: payload.documentId }, "Failed to enqueue background indexing job");
    throw error;
  }
}

/**
 * Register repeatable jobs for periodic SLA and due date checks.
 */
export async function initializeScheduler(): Promise<void> {
  try {
    // Register repeatable job to run every 5 minutes in Redis
    await documentQueue.add("check-sla-and-due-dates", {}, {
      repeat: {
        pattern: "*/5 * * * *"
      },
      removeOnComplete: true,
      removeOnFail: true
    });
    logger.info("Repeatable SLA and due date check job registered in BullMQ.");
  } catch (error) {
    logger.error({ error }, "Failed to register repeatable SLA/due-date check job");
  }
}

export const webhookQueue = new Queue("webhook-delivery", {
  connection: redis as any
});

export interface WebhookJobPayload {
  orgId: string;
  workspaceId: string;
  event: string;
  payload: unknown;
}

export async function enqueueWebhook(payload: WebhookJobPayload): Promise<void> {
  try {
    await webhookQueue.add("deliver-webhook", payload, {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 2000
      },
      removeOnComplete: true,
      removeOnFail: false
    });
    logger.info({ event: payload.event }, "Enqueued background webhook job");
  } catch (error) {
    logger.error({ error, event: payload.event }, "Failed to enqueue webhook delivery job");
  }
}

/**
 * Clean up queue connection resources on shutdown.
 */
export async function closeQueue(): Promise<void> {
  await documentQueue.close();
  await webhookQueue.close();
  await redis.quit();
}
