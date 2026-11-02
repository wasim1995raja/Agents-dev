/**
 * API entrypoint.
 *
 * Wires the real Postgres repositories, Docker sandbox and orchestrator into the
 * HTTP app. It intentionally starts even when Docker or a model key is missing:
 * `/api/health` and `/api/runtime` report the degradation instead of the process
 * dying, and a project run fails loudly at the point it needs the capability.
 */
import {
  ArtifactsRepository,
  EventsRepository,
  ProjectsRepository,
  RequirementsRepository,
  TasksRepository,
  createDatabase,
} from "@autodev/db";
import { EventBus, Orchestrator, resolveWorkspacePath } from "@autodev/orchestrator";
import { SandboxManager } from "@autodev/sandbox";
import { readConfig } from "@autodev/shared";
import { seedSmsDefaults } from "@autodev/sms";

import { buildServer } from "./app.js";

async function main(): Promise<void> {
  const config = readConfig();
  const database = createDatabase(config.DATABASE_URL);

  // Idempotent SMS bootstrap: keeps a fresh local database usable without
  // hand-inserted roles. Boot continues if the SMS tables are missing.
  try {
    const seeded = await seedSmsDefaults(database, {
      adminPassword: process.env.SMS_ADMIN_PASSWORD?.trim() || undefined,
    });
    if (seeded.adminCreated) {
      console.warn(
        "[api] seeded SMS super admin (change the bootstrap password before exposing the API)",
      );
    }
  } catch (error) {
    console.warn(
      "[api] SMS seed skipped:",
      error instanceof Error ? error.message : String(error),
    );
  }

  const repositories = {
    projects: new ProjectsRepository(database.db),
    tasks: new TasksRepository(database.db),
    artifacts: new ArtifactsRepository(database.db),
    requirements: new RequirementsRepository(database.db),
    events: new EventsRepository(database.db),
  };

  const eventBus = new EventBus({
    events: repositories.events,
    onListenerError: (error) => {
      console.error("[api] event subscriber failed", error);
    },
  });

  const sandbox = new SandboxManager({
    image: config.SANDBOX_IMAGE,
    limits: {
      memoryMb: config.SANDBOX_MEMORY_MB,
      cpus: config.SANDBOX_CPUS,
      pidsLimit: config.SANDBOX_PIDS_LIMIT,
      commandTimeoutMs: config.COMMAND_TIMEOUT_MS,
    },
  });

  const orchestrator = new Orchestrator({
    config,
    ...repositories,
    events: eventBus,
    sandbox,
    logger: (message, detail) => {
      console.log(`[orchestrator] ${message}`, detail ?? "");
    },
  });

  const ownerIdentity = process.env.OWNER_EMAIL?.trim() || "owner@autodev.local";

  const app = await buildServer({
    deps: {
      config,
      repositories,
      eventBus,
      orchestrator,
      sandbox,
      workspaceFor: (projectId) => resolveWorkspacePath(config.workspacesRoot, projectId),
      pingDatabase: async () => {
        await database.pool.query("select 1");
      },
      ownerIdentity,
    },
  });

  try {
    await sandbox.assertAvailable();
  } catch (error) {
    app.log.warn(
      { err: error },
      "Docker is not available; runs will fail until the daemon is reachable",
    );
  }

  // Resuming is opt-in: restarting the API should not silently spend model
  // credits or restart containers unless the operator asked for it.
  if (process.env.AUTODEV_RESUME_ON_BOOT === "true") {
    const running = await repositories.projects.findRunning();
    for (const project of running) {
      app.log.info({ projectId: project.id }, "resuming project after restart");
      void orchestrator.start(project.id).catch((error: unknown) => {
        app.log.error({ err: error, projectId: project.id }, "resume failed");
      });
    }
  } else {
    const running = await repositories.projects.findRunning();
    if (running.length > 0) {
      app.log.warn(
        { projectIds: running.map((project) => project.id) },
        "projects were running before restart; set AUTODEV_RESUME_ON_BOOT=true to resume them",
      );
    }
  }

  await app.listen({ host: config.API_HOST, port: config.API_PORT });
  app.log.info(
    {
      engine: config.resolvedEngine,
      hasOpenAIKey: config.hasOpenAIKey,
      workspacesRoot: config.workspacesRoot,
    },
    "AutoDev API ready",
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    await app.close().catch((error: unknown) => app.log.error({ err: error }, "server close failed"));
    await database.close().catch((error: unknown) => app.log.error({ err: error }, "database close failed"));
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("[api] fatal startup error", error);
  process.exit(1);
});
