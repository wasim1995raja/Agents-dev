import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function notFound(what: string): HttpError {
  return new HttpError(404, "not_found", `${what} not found`);
}

export function badRequest(message: string, details?: unknown): HttpError {
  return new HttpError(400, "bad_request", message, details);
}

export function conflict(message: string, details?: unknown): HttpError {
  return new HttpError(409, "conflict", message, details);
}

export function forbidden(message: string, details?: unknown): HttpError {
  return new HttpError(403, "forbidden", message, details);
}

/**
 * Validates request input with the shared Zod contracts. Validation failures
 * become 400s with field-level detail so the dashboard can render them inline.
 */
export function parse<S extends z.ZodType>(
  schema: S,
  value: unknown,
  label: string,
): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(
      `Invalid ${label}`,
      result.error.issues.map((issue) => ({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export function errorHandler(
  error: Error & { statusCode?: number; code?: string; validation?: unknown },
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof HttpError) {
    void reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        requestId: request.id,
      },
    } satisfies ErrorBody);
    return;
  }

  // Fastify's own schema errors (only used for a couple of query params).
  if (error.validation) {
    void reply.status(400).send({
      error: {
        code: "bad_request",
        message: error.message,
        details: error.validation,
        requestId: request.id,
      },
    } satisfies ErrorBody);
    return;
  }

  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  if (status >= 500) {
    request.log.error({ err: error }, "unhandled request error");
  }

  void reply.status(status).send({
    error: {
      code: error.code ?? (status >= 500 ? "internal_error" : "request_failed"),
      // Never leak internals for a 5xx; the request id ties the UI to the log.
      message: status >= 500 ? "Internal server error" : error.message,
      requestId: request.id,
    },
  } satisfies ErrorBody);
}
