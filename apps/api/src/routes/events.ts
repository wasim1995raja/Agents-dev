import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { projectIdParamsSchema, toSseFrame } from "@autodev/shared";

import { notFound, parse } from "../http.js";
import type { RouteContext } from "../types.js";

const listEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  before: z.string().datetime().optional(),
});

const HEARTBEAT_MS = 15_000;

/**
 * `reply.hijack()` bypasses Fastify's normal response pipeline, so the CORS
 * plugin never runs for the stream. Resolve the allowed origin here with the
 * same rules the REST routes use; otherwise browsers block EventSource and the
 * dashboard silently falls back to a stale snapshot.
 */
function resolveCorsOrigin(configOrigin: string, requestOrigin: string | undefined): string | null {
  if (!requestOrigin) return null;
  const origins = configOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.includes("*")) return "*";
  return origins.includes(requestOrigin) ? requestOrigin : null;
}

export function registerEventRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;

  app.get("/api/projects/:id/events", async (request) => {
    const { id } = parse(projectIdParamsSchema, request.params, "project id");
    const query = parse(listEventsQuerySchema, request.query, "query");
    const project = await deps.repositories.projects.findById(id);
    if (!project) throw notFound(`Project ${id}`);

    const events = await deps.repositories.events.list(id, {
      limit: query.limit,
      ...(query.before ? { before: new Date(query.before) } : {}),
    });
    return {
      items: events,
      nextCursor: events.length === query.limit ? events[0]?.createdAt ?? null : null,
    };
  });

  /**
   * Server-sent events for live activity. Replays the in-memory ring buffer
   * first (optionally resuming after `Last-Event-ID`), then streams new events
   * and a periodic heartbeat so proxies do not time the connection out.
   */
  app.get("/api/projects/:id/events/stream", async (request, reply) => {
    const { id } = parse(projectIdParamsSchema, request.params, "project id");
    const project = await deps.repositories.projects.findById(id);
    if (!project) throw notFound(`Project ${id}`);

    const lastEventId =
      (request.headers["last-event-id"] as string | undefined) ??
      (typeof (request.query as { lastEventId?: string }).lastEventId === "string"
        ? (request.query as { lastEventId?: string }).lastEventId
        : undefined);

    reply.hijack();
    const raw = reply.raw;
    const allowedOrigin = resolveCorsOrigin(
      deps.config.CORS_ORIGIN,
      request.headers.origin,
    );
    const headers: Record<string, string> = {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      vary: "Origin",
    };
    if (allowedOrigin) headers["access-control-allow-origin"] = allowedOrigin;
    raw.writeHead(200, headers);
    raw.write(`retry: 2000\n\n`);

    const write = (frame: string): void => {
      if (raw.writableEnded) return;
      raw.write(frame);
    };

    const buffered = deps.eventBus.recent(id);
    const resumeIndex = lastEventId
      ? buffered.findIndex((event) => event.id === lastEventId)
      : -1;
    for (const event of resumeIndex >= 0 ? buffered.slice(resumeIndex + 1) : buffered) {
      write(toSseFrame({ kind: "event", data: event }));
    }

    const unsubscribe = deps.eventBus.subscribe(id, (event) => {
      write(toSseFrame({ kind: "event", data: event }));
    });
    const heartbeat = setInterval(() => {
      write(toSseFrame({ kind: "heartbeat" }));
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    let closed = false;
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      if (!raw.writableEnded) raw.end();
    };

    request.raw.on("close", cleanup);
    request.raw.on("aborted", cleanup);
    raw.on("close", cleanup);
  });
}
