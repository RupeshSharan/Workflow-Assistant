import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { config } from "./config.js";
import { logger } from "./logger.js";

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  min: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

pool.on("error", (error) => {
  logger.error({ error }, "Unexpected PostgreSQL pool error");
});

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  return pool.query<T>(text, values);
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
