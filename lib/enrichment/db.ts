// Layer: persistence. Owns explicit connections and transaction boundaries.
import "../assert-server";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";

export interface QueryResult<T> {
  rows: T[];
}
export interface Sql {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
}
export interface Database extends Sql {
  transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
}

// Never reads an environment file or implicitly connects to a production database.
export function postgresDatabase(
  connectionString: string,
): Database & { close(): Promise<void> } {
  const pool = new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
  });
  return {
    async query<T>(text: string, values?: unknown[]) {
      const result = await pool.query(text, values);
      return { rows: result.rows as T[] };
    },
    async transaction<T>(fn: (sql: Sql) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          async query<R>(text: string, values?: unknown[]) {
            const result = await client.query(text, values);
            return { rows: result.rows as R[] };
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function migrateEnrichment(db: Database): Promise<void> {
  const sql = await readFile(
    new URL("../../migrations/001_enrichment.sql", import.meta.url),
    "utf8",
  );
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(73422001)");
    await tx.query(
      "CREATE TABLE IF NOT EXISTS enrichment_migrations (version integer PRIMARY KEY, installed_at timestamptz NOT NULL DEFAULT now())",
    );
    const applied = await tx.query(
      "SELECT version FROM enrichment_migrations WHERE version = 1",
    );
    if (!applied.rows.length) {
      await tx.query(sql);
      await tx.query("INSERT INTO enrichment_migrations(version) VALUES (1)");
    }
  });
}
