import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";

import { OrchestratorError } from "@autodev/orchestrator";

import { errorHandler } from "./http.js";
import { registerApprovalRoutes } from "./routes/approvals.js";
import { registerArtifactRoutes } from "./routes/artifacts.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerRuntimeRoutes } from "./routes/runtime.js";
import { registerSmsRoutes } from "./routes/sms.js";
import type { ApiDeps } from "./types.js";

export interface BuildServerOptions {
  deps: ApiDeps;
  logger?: boolean;
}

/**
 * Builds the HTTP app without binding a port, so tests can use `app.inject`.
 * Every dependency arrives through `ApiDeps`; nothing in this function touches
 * Docker, Postgres or the filesystem directly.
 */
export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const { deps } = options;
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: deps.config.LOG_LEVEL,
            // Never log request bodies: they can contain project secrets.
            redact: ["req.headers.authorization", "req.headers.cookie"],
          },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });

  const origins = deps.config.CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: origins.includes("*") ? true : origins,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "last-event-id"],
    exposedHeaders: ["content-disposition", "content-type"],
  });

  app.setErrorHandler((error, request, reply) => {
    const err = error instanceof Error ? error : new Error(String(error));
    if (err instanceof OrchestratorError) {
      request.log.warn({ err }, "orchestrator rejected request");
      void reply.status(400).send({
        error: {
          code: "orchestrator_error",
          message: err.message,
          details: err.details,
          requestId: request.id,
        },
      });
      return;
    }
    errorHandler(
      err as Error & { statusCode?: number; code?: string; validation?: unknown },
      request,
      reply,
    );
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      error: {
        code: "not_found",
        message: `No route for ${request.method} ${request.url}`,
        requestId: request.id,
      },
    });
  });

  const ctx = { deps };
  registerHealthRoutes(app, ctx);
  registerProjectRoutes(app, ctx);
  registerArtifactRoutes(app, ctx);
  registerApprovalRoutes(app, ctx);
  registerEventRoutes(app, ctx);
  registerFileRoutes(app, ctx);
  registerRuntimeRoutes(app, ctx);
  registerSmsRoutes(app, ctx);

  app.get("/", async () => ({
    name: "AutoDev Agent API",
    version: "0.1.0",
    docs: "/api/health, /api/runtime, /api/projects",
  }));

  return app;
}
