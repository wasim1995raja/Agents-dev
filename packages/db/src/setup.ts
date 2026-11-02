import path from "node:path";
import { fileURLToPath } from "node:url";

import { eq } from "drizzle-orm";

import { createDatabase, resolveDatabaseUrl } from "./client.js";
import { runMigrations } from "./migrate.js";
import { users } from "./schema.js";

/**
 * Idempotent local setup: apply migrations, then ensure a default owner exists.
 * Creating the role/database itself requires elevated privileges, so it is done
 * by `scripts/bootstrap-db.sh` and this script verifies the result.
 */
async function main(): Promise<void> {
  const url = resolveDatabaseUrl();
  const safeUrl = url.replace(/:\/\/([^:]+):[^@]*@/, "://$1:***@");
  console.log(`[db:setup] target ${safeUrl}`);

  const handle = createDatabase(url, { max: 2 });
  try {
    await handle.pool.query("select 1");
  } catch (error) {
    console.error("[db:setup] cannot reach PostgreSQL.");
    console.error("[db:setup] run ./scripts/bootstrap-db.sh first, then retry.");
    throw error;
  }

  try {
    await runMigrations(url);

    const email = "owner@autodev.local";
    const existing = await handle.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length === 0) {
      await handle.db.insert(users).values({ email, name: "Product Owner" });
      console.log(`[db:setup] created default owner ${email}`);
    } else {
      console.log(`[db:setup] owner ${email} already present`);
    }

    const tables = await handle.pool.query<{ count: string }>(
      "select count(*)::text as count from generated_files",
    );
    console.log(`[db:setup] ok (generated_files rows: ${tables.rows[0]?.count ?? "0"})`);
  } finally {
    await handle.close();
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error("[db:setup] failed:", error);
    process.exitCode = 1;
  });
}
