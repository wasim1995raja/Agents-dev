import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: Pool;
  close: () => Promise<void>;
}

/**
 * Creates a pooled Drizzle client. Callers own the lifecycle and must close it.
 * `max` is deliberately small: the API and orchestrator each hold one pool.
 */
export function createDatabase(connectionString: string, options?: { max?: number }): DatabaseHandle {
  const pool = new Pool({
    connectionString,
    max: options?.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}

/** Convenience helper for the common connection-string override in tests. */
export function resolveDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  return (
    source.DATABASE_URL ??
    `postgresql://${source.PGUSER ?? "autodev"}:${source.PGPASSWORD ?? "autodev"}@${
      source.PGHOST ?? "127.0.0.1"
    }:${source.PGPORT ?? "5432"}/${source.PGDATABASE ?? "autodev"}`
  );
}
