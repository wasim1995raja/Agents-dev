import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";

import { errorHandler } from "./http.js";
import { registerAiTestingRoutes } from "./routes/ai-testing.js";
import { type DatabaseHandle } from "@autodev/db";

export interface BuildServerOptions {
  logger?: boolean;
  database: DatabaseHandle;
}

/**
 * Builds the AI Automation Testing Platform HTTP app without binding a port,
 * so tests can use `app.inject`.
 */
export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger === false ? false : { level: "info" },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });

  const origins = (process.env.CORS_ORIGIN ?? "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: origins.includes("*") ? true : origins,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "last-event-id"],
    exposedHeaders: ["content-disposition", "content-type"],
  });

  app.setErrorHandler((error, request, reply) => {
    errorHandler(
      error as Error & { statusCode?: number; code?: string },
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

  app.get("/api/health", async (_request, reply) => {
    return reply.send({
      status: "ok",
      version: "0.1.0",
      service: "ai-automation-testing-platform",
    });
  });

  registerAiTestingRoutes(app, options.database);

  return app;
}
