import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { uploadFile } from "./storage.js";

const execAsync = promisify(exec);

export interface BackupResult {
  filename: string;
  localPath: string;
  s3Url?: string;
  sizeBytes: number;
}

/**
 * Creates a database backup dump using pg_dump.
 * Saves locally to the backups directory, and optionally uploads to S3/MinIO.
 */
export async function createBackup(options: {
  schemaOnly?: boolean;
  uploadToS3?: boolean;
} = {}): Promise<BackupResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = options.schemaOnly ? "schema-backup" : "full-backup";
  const filename = `${prefix}-${timestamp}.sql`;

  // Define local backups folder: apps/api/backups/ or current workspace root backups/
  const backupsDir = path.resolve(process.cwd(), "backups");
  
  // Ensure backups directory exists
  await fs.mkdir(backupsDir, { recursive: true });
  const localPath = path.join(backupsDir, filename);

  logger.info({ localPath }, "Starting PostgreSQL database backup...");

  try {
    // Construct pg_dump command.
    // The -d argument takes the database URI containing password directly to prevent interactive prompts.
    const schemaFlag = options.schemaOnly ? "--schema-only" : "";
    const command = `pg_dump -d "${config.DATABASE_URL}" ${schemaFlag} -f "${localPath}"`;

    await execAsync(command);

    // Get backup file stats
    const stats = await fs.stat(localPath);
    const sizeBytes = stats.size;

    logger.info(
      { filename, sizeBytes, localPath },
      "Database backup completed successfully locally."
    );

    let s3Url: string | undefined;

    if (options.uploadToS3) {
      logger.info({ filename }, "Uploading database backup to object storage...");
      const fileBuffer = await fs.readFile(localPath);
      s3Url = await uploadFile(`backups/${filename}`, fileBuffer, "application/sql");
    }

    return {
      filename,
      localPath,
      s3Url,
      sizeBytes
    };
  } catch (error) {
    logger.error({ error }, "Database backup failed");
    throw error;
  }
}
