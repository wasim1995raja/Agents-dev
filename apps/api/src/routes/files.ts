import fs from "node:fs/promises";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { safeJoin } from "@autodev/coding";
import {
  isSensitivePath,
  listWorkspaceFiles,
  readWorkspaceText,
} from "@autodev/orchestrator";
import { projectIdParamsSchema } from "@autodev/shared";

import { badRequest, forbidden, notFound, parse } from "../http.js";
import type { FileDto } from "../serializers.js";
import type { RouteContext } from "../types.js";

const fileQuerySchema = z.object({
  path: z
    .string()
    .min(1)
    .max(400)
    .refine((value) => !value.startsWith("/") && !value.includes(".."), "path must stay inside the workspace"),
});

const MAX_PREVIEW_BYTES = 512 * 1024;

export function registerFileRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;

  async function requireProject(id: string) {
    const project = await deps.repositories.projects.findById(id);
    if (!project) throw notFound(`Project ${id}`);
    return project;
  }

  app.get("/api/projects/:id/files", async (request) => {
    const { id } = parse(projectIdParamsSchema, request.params, "project id");
    await requireProject(id);

    const workspace = deps.workspaceFor(id);
    const files = await listWorkspaceFiles(workspace, { maxFiles: 2_000 });
    const items: FileDto[] = files.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      language: file.language,
    }));
    return { items, count: items.length };
  });

  app.get("/api/projects/:id/files/content", async (request) => {
    const { id } = parse(projectIdParamsSchema, request.params, "project id");
    const query = parse(fileQuerySchema, request.query, "query");
    await requireProject(id);

    if (isSensitivePath(query.path)) {
      throw forbidden(`Files matching ${query.path} are not readable through the API`);
    }

    const workspace = deps.workspaceFor(id);
    const absolute = safeJoin(workspace, query.path);
    const stat = await fs.stat(absolute).catch(() => null);
    if (!stat?.isFile()) throw notFound(`File ${query.path}`);
    if (stat.size > MAX_PREVIEW_BYTES) {
      throw badRequest(
        `File ${query.path} is ${stat.size} bytes; previews are limited to ${MAX_PREVIEW_BYTES}`,
      );
    }

    const content = await readWorkspaceText(workspace, query.path);
    if (content === null) throw notFound(`File ${query.path}`);
    if (content.includes("\u0000")) {
      throw badRequest(`File ${query.path} looks binary`);
    }

    return {
      path: query.path,
      sizeBytes: stat.size,
      content,
    };
  });
}
