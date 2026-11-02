import { createDatabase } from "@autodev/db";
import { buildServer } from "./app.js";

const PORT = Number(process.env.PORT ?? 3002);

async function main(): Promise<void> {
  const database = createDatabase(
    process.env.DATABASE_URL ?? "postgresql://autodev:autodev@127.0.0.1:5432/autodev",
  );

  const app = await buildServer({ database });

  app.addHook("onClose", async () => {
    await database.close();
  });

  await app.listen({ port: PORT, host: "127.0.0.1" });
}

main().catch((error: unknown) => {
  console.error("[ai-testing-platform] failed to start:", error);
  process.exitCode = 1;
});
