import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import crypto from "node:crypto";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { query, withTransaction } from "./db.js";
import { getFile } from "./services/storage.js";
import { chunkText } from "./services/chunk-text.js";
import { embedTexts, toPgVector } from "./services/ollama.js";
import { broadcastToWorkspace } from "./services/socket.js";

// Import pdf-parse using compatibility-friendly syntax
import * as pdf from "pdf-parse";


const redisConnectionUrl = config.REDIS_URL || "redis://localhost:6379";

const redisConnection = new Redis(redisConnectionUrl, {
  maxRetriesPerRequest: null // Required by BullMQ
});

redisConnection.on("error", (error) => {
  logger.error({ error }, "Unexpected Redis connection error in Worker Daemon");
});

interface JobPayload {
  orgId: string;
  workspaceId: string;
  documentId: string;
  fileKey?: string;
  actorId?: string;
}

logger.info("Initializing background worker daemon...");

const worker = new Worker(
  "document-indexing",
  async (job: Job<any>) => {
    if (job.name === "check-sla-and-due-dates") {
      logger.info("Worker processing repeatable SLA and due-date checks...");
      await runSlaAndDueDateChecks();
      return;
    }

    const { orgId, workspaceId, documentId, fileKey, actorId } = job.data;
    logger.info({ documentId, jobName: job.name }, "Worker processing indexing job");

    // Fetch document metadata to confirm it exists and status is processing/uploaded
    const documentQuery = await query<{ title: string; content_text: string | null; uploaded_by: string }>(
      `SELECT title, content_text, uploaded_by
         FROM documents
        WHERE id = $1 AND org_id = $2 AND workspace_id = $3 AND deleted_at IS NULL`,
      [documentId, orgId, workspaceId]
    );

    if (!documentQuery.rowCount) {
      logger.warn({ documentId }, "Document not found or deleted, skipping indexing");
      return;
    }

    const document = documentQuery.rows[0]!;
    let text = "";

    try {
      // Step 1: Update status to processing
      await query(
        `UPDATE documents SET status = 'processing'
          WHERE id = $1 AND org_id = $2 AND workspace_id = $3`,
        [documentId, orgId, workspaceId]
      );

      // Step 2: Extract text based on whether it is a file or a simple note
      if (fileKey) {
        logger.info({ fileKey }, "Downloading file from object storage");
        const fileBuffer = await getFile(fileKey);

        if (fileKey.toLowerCase().endsWith(".pdf")) {
          logger.info("Extracting text from PDF file");
          const parsePdf = (pdf as any).default || pdf;
          const parsedPdf = await parsePdf(fileBuffer);
          text = parsedPdf.text || "";
        } else {
          logger.info("Reading text file");
          text = fileBuffer.toString("utf-8");
        }
      } else {
        text = document.content_text || "";
      }

      // Clean/sanitize text check
      text = text.trim();
      if (!text) {
        throw new Error("Document has no extractable or readable text content.");
      }

      // Step 3: Split content into chunks
      const chunks = chunkText(text);
      if (!chunks.length) {
        throw new Error("Document has no indexable text chunks.");
      }

      logger.info({ chunksCount: chunks.length }, "Generating vector embeddings via Ollama");

      // Step 4: Generate embeddings via Ollama adapter
      const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));

      // Step 5: Save chunks and updated document details inside a transaction
      await withTransaction(async (client) => {
        // Clear previous chunks if any
        await client.query("DELETE FROM document_chunks WHERE document_id = $1", [documentId]);

        // Insert new chunks
        for (const [index, chunk] of chunks.entries()) {
          const embeddingVector = embeddings[index]!;
          await client.query(
            `INSERT INTO document_chunks (document_id, chunk_index, chunk_text, embedding_vector)
             VALUES ($1, $2, $3, $4::vector)`,
            [documentId, chunk.index, chunk.text, toPgVector(embeddingVector)]
          );
        }

        // Update document status & store extracted content text back for full search if it was a file
        await client.query(
          `UPDATE documents
              SET status = 'indexed',
                  content_text = $1,
                  updated_at = NOW()
            WHERE id = $2`,
          [text, documentId]
        );

        // Audit Log
        await client.query(
          `INSERT INTO audit_logs
             (org_id, workspace_id, actor_id, action, entity_type, entity_id, payload_json)
           VALUES ($1, $2, $3, 'document.indexed', 'document', $4, $5::jsonb)`,
          [
            orgId,
            workspaceId,
            actorId || document.uploaded_by,
            documentId,
            JSON.stringify({ chunks: chunks.length, title: document.title, hasFile: !!fileKey })
          ]
        );
      });

      logger.info({ documentId }, "Document indexing completed successfully");
    } catch (error: any) {
      logger.error({ error, documentId }, "Background document indexing failed");

      // Update status to failed
      await query(
        `UPDATE documents SET status = 'failed'
          WHERE id = $1 AND org_id = $2 AND workspace_id = $3`,
        [documentId, orgId, workspaceId]
      ).catch((updateError) => {
        logger.error({ updateError, documentId }, "Failed to set document status to failed");
      });

      throw error; // Rethrow to let BullMQ handle retry/fail state
    }
  },
  {
    connection: redisConnection as any,
    concurrency: 2 // Max parallel jobs per worker
  }
);

worker.on("completed", (job) => {
  logger.info({ jobId: job.id }, "Job completed successfully");
});

worker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, error }, "Job failed execution");
});

export async function runSlaAndDueDateChecks(): Promise<void> {
  try {
    // 1. Process Overdue Work Items
    const overdueItems = await query<{
      id: string;
      title: string;
      org_id: string;
      workspace_id: string;
      assignee_id: string;
      due_date: Date;
    }>(
      `SELECT id, title, org_id, workspace_id, assignee_id, due_date
         FROM work_items
        WHERE closed_at IS NULL
          AND deleted_at IS NULL
          AND assignee_id IS NOT NULL
          AND due_date < NOW()
          AND (last_reminder_sent_at IS NULL OR last_reminder_sent_at < NOW() - INTERVAL '24 hours')`
    );

    logger.info({ count: overdueItems.rowCount }, "Found overdue work items for reminders");

    for (const item of overdueItems.rows) {
      await withTransaction(async (client) => {
        const notificationId = crypto.randomUUID();
        const body = `"${item.title}" was due on ${new Date(item.due_date).toLocaleDateString()}. Please update its status or request an extension.`;
        await client.query(
          `INSERT INTO notifications (id, org_id, workspace_id, user_id, type, title, body)
           VALUES ($1, $2, $3, $4, 'reminder', $5, $6)`,
          [notificationId, item.org_id, item.workspace_id, item.assignee_id, "Overdue Work Item", body]
        );

        await client.query(
          `UPDATE work_items SET last_reminder_sent_at = NOW() WHERE id = $1`,
          [item.id]
        );
      });

      broadcastToWorkspace(item.workspace_id, "notification:created", { userId: item.assignee_id });
    }

    // 2. Process SLA Violations
    const slaViolations = await query<{
      id: string;
      title: string;
      org_id: string;
      workspace_id: string;
      assignee_id: string | null;
      reporter_id: string;
      stage_name: string;
      sla_hours: number;
      entered_at: Date;
    }>(
      `WITH stage_entries AS (
         SELECT 
           wi.id,
           wi.title,
           wi.org_id,
           wi.workspace_id,
           wi.assignee_id,
           wi.reporter_id,
           ws.name AS stage_name,
           ws.sla_hours,
           COALESCE(
             (SELECT h.changed_at FROM work_item_history h 
               WHERE h.work_item_id = wi.id AND h.field_name = 'current_stage_id' 
               ORDER BY h.changed_at DESC LIMIT 1),
             wi.created_at
           ) AS entered_at,
           wi.last_sla_warning_sent_at
         FROM work_items wi
         JOIN workflow_stages ws ON ws.id = wi.current_stage_id
         WHERE ws.sla_hours IS NOT NULL 
           AND wi.closed_at IS NULL 
           AND wi.deleted_at IS NULL
       )
       SELECT * FROM stage_entries
       WHERE NOW() - entered_at > sla_hours * INTERVAL '1 hour'
         AND (last_sla_warning_sent_at IS NULL OR last_sla_warning_sent_at < entered_at)`
    );

    logger.info({ count: slaViolations.rowCount }, "Found SLA-breaching work items");

    for (const item of slaViolations.rows) {
      const recipientId = item.assignee_id || item.reporter_id;

      await withTransaction(async (client) => {
        const notificationId = crypto.randomUUID();
        const body = `"${item.title}" has been in "${item.stage_name}" stage for more than the SLA limit of ${item.sla_hours} hours.`;
        await client.query(
          `INSERT INTO notifications (id, org_id, workspace_id, user_id, type, title, body)
           VALUES ($1, $2, $3, $4, 'sla_warning', $5, $6)`,
          [notificationId, item.org_id, item.workspace_id, recipientId, "SLA Breached", body]
        );

        await client.query(
          `UPDATE work_items SET last_sla_warning_sent_at = NOW() WHERE id = $1`,
          [item.id]
        );
      });

      broadcastToWorkspace(item.workspace_id, "notification:created", { userId: recipientId });
    }
  } catch (error) {
    logger.error({ error }, "Error running SLA and due date checks in background worker");
  }
}

const webhookWorker = new Worker(
  "webhook-delivery",
  async (job: Job<any>) => {
    const { orgId, workspaceId, event, payload } = job.data;
    logger.info({ event }, "Worker processing webhook delivery job");

    // Fetch active subscriptions for this event and workspace
    const subs = await query<{ id: string; url: string; secret_token: string | null }>(
      `SELECT id, url, secret_token
         FROM webhook_subscriptions
        WHERE org_id = $1
          AND workspace_id = $2
          AND is_active = TRUE
          AND $3 = ANY(events)`,
      [orgId, workspaceId, event]
    );

    for (const sub of subs.rows) {
      try {
        const timestamp = Date.now().toString();
        let signature = "";

        if (sub.secret_token) {
          const bodyStr = JSON.stringify(payload);
          signature = crypto
            .createHmac("sha256", sub.secret_token)
            .update(`${timestamp}.${bodyStr}`)
            .digest("hex");
        }

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Webhook-Event": event,
          "X-Webhook-Timestamp": timestamp
        };

        if (signature) {
          headers["X-Webhook-Signature"] = signature;
        }

        const res = await fetch(sub.url, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000) // 5s timeout
        });

        if (!res.ok) {
          throw new Error(`Endpoint returned status ${res.status}`);
        }

        logger.info({ subscriptionId: sub.id, url: sub.url }, "Webhook delivered successfully");
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : err, subscriptionId: sub.id, url: sub.url },
          "Webhook delivery failed"
        );
        throw err; // Fail job to trigger BullMQ retry
      }
    }
  },
  {
    connection: redisConnection as any
  }
);

// Setup graceful shutdown handlers
async function shutdown(): Promise<void> {
  logger.info("Stopping background worker daemon...");
  await worker.close();
  await webhookWorker.close();
  await redisConnection.quit();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
