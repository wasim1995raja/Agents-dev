import type { FastifyInstance } from "fastify";

import type { EngineName } from "@autodev/shared";

import type { RouteContext, RuntimeInfo } from "../types.js";

const APP_VERSION = "0.1.0";

/**
 * Health and capability reporting.
 *
 * These endpoints deliberately report what is actually available (no model key,
 * no Docker daemon) instead of pretending every engine can run.
 */
export function registerHealthRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;

  app.get("/api/health", async (_request, reply) => {
    let database: "up" | "down" = "up";
    let detail: string | undefined;
    try {
      await deps.pingDatabase();
    } catch (error) {
      database = "down";
      detail = error instanceof Error ? error.message : String(error);
    }

    const body = {
      status: database === "up" ? "ok" : "degraded",
      version: APP_VERSION,
      database,
      engine: deps.config.resolvedEngine,
      detail,
    };
    return reply.status(database === "up" ? 200 : 503).send(body);
  });

  app.get("/api/runtime", async (): Promise<RuntimeInfo> => {
    let dockerAvailable = true;
    let dockerError: string | undefined;
    try {
      await deps.sandbox.assertAvailable();
    } catch (error) {
      dockerAvailable = false;
      dockerError = error instanceof Error ? error.message : String(error);
    }

    const availability: Array<{ name: EngineName; available: boolean; reason: string }> = [
      {
        name: "scaffold",
        available: true,
        reason: "Deterministic generator; needs no external credentials.",
      },
      {
        name: "codex",
        available: deps.config.hasOpenAIKey,
        reason: deps.config.hasOpenAIKey
          ? "OPENAI_API_KEY is configured."
          : "Set OPENAI_API_KEY to enable the Codex engine.",
      },
      {
        name: "openai-agents",
        available: deps.config.hasOpenAIKey,
        reason: deps.config.hasOpenAIKey
          ? "OPENAI_API_KEY is configured."
          : "Set OPENAI_API_KEY to enable the OpenAI Agents engine.",
      },
    ];

    return {
      engine: deps.config.resolvedEngine,
      configuredEngine: deps.config.AUTODEV_ENGINE,
      hasOpenAIKey: deps.config.hasOpenAIKey,
      availableEngines: availability,
      sandbox: {
        image: deps.config.SANDBOX_IMAGE,
        dockerAvailable,
        memoryMb: deps.config.SANDBOX_MEMORY_MB,
        cpus: deps.config.SANDBOX_CPUS,
        pidsLimit: deps.config.SANDBOX_PIDS_LIMIT,
        commandTimeoutMs: deps.config.COMMAND_TIMEOUT_MS,
        ...(dockerError ? { dockerError } : {}),
      },
      workspacesRoot: deps.config.workspacesRoot,
    };
  });
}
