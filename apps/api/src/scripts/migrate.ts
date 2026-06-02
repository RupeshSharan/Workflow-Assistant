import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { closeDatabase, pool } from "../db.js";
import { logger } from "../logger.js";

const migrationsDirectory = fileURLToPath(
  new URL("../../../../database/migrations/", import.meta.url)
);

async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const applied = await pool.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations WHERE filename = $1",
      [file]
    );

    if (applied.rowCount) {
      logger.info({ file }, "Skipping applied migration");
      continue;
    }

    const sql = await readFile(`${migrationsDirectory}/${file}`, "utf8");
    await pool.query(sql);
    logger.info({ file }, "Applied migration");
  }
}

migrate()
  .catch((error) => {
    logger.error({ error }, "Migration failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
