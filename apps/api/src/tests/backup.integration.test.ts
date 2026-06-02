import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { createBackup } from "../services/backup.js";

// Mock the storage service to prevent actual S3 upload calls in integration tests
vi.mock("../services/storage.js", () => ({
  uploadFile: vi.fn(async (key) => `http://localhost:9000/workflow-documents/${key}`),
  initializeStorage: vi.fn(async () => undefined)
}));

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

async function checkPgDump(): Promise<boolean> {
  try {
    await execAsync("pg_dump --version");
    return true;
  } catch {
    return false;
  }
}

const hasPgDump = await checkPgDump();

describe.runIf(hasPgDump)("Database Backup Service Integration", () => {
  it("successfully performs a schema-only database backup and generates a file", async () => {
    const result = await createBackup({ schemaOnly: true, uploadToS3: true });

    expect(result).toBeDefined();
    expect(result.filename).toContain("schema-backup");
    expect(result.localPath).toBeDefined();
    expect(result.s3Url).toContain("backups/schema-backup");
    expect(result.sizeBytes).toBeGreaterThan(0);

    // Verify local file exists
    const fileExists = await fs
      .stat(result.localPath)
      .then(() => true)
      .catch(() => false);
    expect(fileExists).toBe(true);

    // Verify backup content contains standard postgres keywords
    const content = await fs.readFile(result.localPath, "utf-8");
    expect(content).toContain("PostgreSQL database dump");

    // Clean up backup file
    await fs.unlink(result.localPath);
  });

  it("successfully performs a full database backup and generates a file", async () => {
    const result = await createBackup({ schemaOnly: false, uploadToS3: false });

    expect(result).toBeDefined();
    expect(result.filename).toContain("full-backup");
    expect(result.s3Url).toBeUndefined();
    expect(result.sizeBytes).toBeGreaterThan(0);

    // Verify local file exists
    const fileExists = await fs
      .stat(result.localPath)
      .then(() => true)
      .catch(() => false);
    expect(fileExists).toBe(true);

    // Clean up backup file
    await fs.unlink(result.localPath);
  });
});
