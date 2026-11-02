import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDatabase, resolveDatabaseUrl } from "./client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const migrationsFolder = path.resolve(here, "../drizzle");

export async function runMigrations(connectionString = resolveDatabaseUrl()): Promise<void> {
  const handle = createDatabase(connectionString, { max: 1 });
  try {
    await migrate(handle.db, { migrationsFolder });
  } finally {
    await handle.close();
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const url = resolveDatabaseUrl();
  console.log(`[db] applying migrations from ${migrationsFolder}`);
  runMigrations(url)
    .then(() => {
      console.log("[db] migrations applied");
    })
    .catch((error: unknown) => {
      console.error("[db] migration failed:", error);
      process.exitCode = 1;
    });
}
