import fs from "fs";
import path from "path";
import { pool } from "./pool";
import { logger } from "../utils/logger";

/**
 * Forward-only SQL migration runner.
 *
 * Applies every *.sql file in sql/migrations/ that hasn't been recorded in the
 * schema_migrations table, in filename order, each in its own transaction. It is
 * idempotent (already-applied files are skipped) and safe to run on every boot —
 * a Postgres advisory lock serializes concurrent deploys/replicas so two
 * containers can't apply the same migration at once.
 *
 * schema.sql is the baseline (applied once when the DB is first created); this
 * runner only handles incremental changes on top of it.
 *
 * Run via `npm run migrate` or as the pre-start step in the Docker CMD.
 */

// Arbitrary constant key for the advisory lock (must be the same across deploys).
const MIGRATION_LOCK_KEY = 947_213_001;

// Resolve relative to this file so it works whether run from dist/ or src/.
const MIGRATIONS_DIR = path.resolve(__dirname, "../../sql/migrations");

async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = fs.existsSync(MIGRATIONS_DIR)
      ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()
      : [];

    if (files.length === 0) {
      logger.info({ dir: MIGRATIONS_DIR }, "No migration files found");
      return;
    }

    const appliedRes = await client.query<{ name: string }>(
      "SELECT name FROM schema_migrations",
    );
    const applied = new Set(appliedRes.rows.map((r) => r.name));

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        count++;
        logger.info({ migration: file }, "Applied migration");
      } catch (err) {
        await client.query("ROLLBACK");
        logger.error({ migration: file, err }, "Migration failed — rolled back");
        throw err;
      }
    }

    logger.info({ applied: count, total: files.length }, "Migrations up to date");
  } finally {
    // Release the lock on the same connection, then return it to the pool.
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

runMigrations()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err }, "Migration runner failed");
    await pool.end().catch(() => {});
    process.exit(1);
  });
