import { Pool, PoolClient, QueryResultRow } from "pg";
import { config } from "../config";
import { logger } from "../utils/logger";

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
});

pool.on("error", (err) => {
  logger.error({ err }, "Unexpected idle client error");
});

/**
 * Execute a parameterized query with slow-query logging (>200ms).
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  const start = Date.now();
  const result = await pool.query<T>(text, params);
  const duration = Date.now() - start;

  if (duration > 200) {
    logger.warn({ text, duration, rows: result.rowCount }, "Slow query detected");
  }

  return result;
}

/**
 * Acquire a client from the pool for use in transactions.
 * Caller must call client.release() when done.
 */
export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

/**
 * Test database connectivity. Returns true if the connection succeeds.
 */
export async function testConnection(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (err) {
    logger.error({ err }, "Database connection test failed");
    return false;
  }
}
