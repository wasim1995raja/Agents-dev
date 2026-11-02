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
  error: Error & { statusCode?: number; code?: string },
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  if (status >= 500) {
    request.log.error({ err: error }, "unhandled request error");
  }
  void reply.status(status).send({
    error: {
      code: error.code ?? (status >= 500 ? "internal_error" : "request_failed"),
      message: status >= 500 ? "Internal server error" : error.message,
      requestId: request.id,
    },
  } satisfies ErrorBody);
}
