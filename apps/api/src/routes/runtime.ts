import type { FastifyInstance } from "fastify";
import { ZipFile } from "yazl";
import { z } from "zod";

import { safeJoin } from "@autodev/coding";
import { listWorkspaceFiles } from "@autodev/orchestrator";
import { projectIdParamsSchema, runCommandSchema } from "@autodev/shared";

import { notFound, parse } from "../http.js";
import type { RouteContext } from "../types.js";

const previewBodySchema = z.object({
  command: z.string().trim().min(1).max(500).optional(),
});

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

export function registerRuntimeRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;
  const { projects } = deps.repositories;

  async function requireProject(id: string) {
    const project = await projects.findById(id);
    if (!project) throw notFound(`Project ${id}`);
    return project;
  }

  app.post("/api/projects/:id/commands", async (request) => {
    const { id } = parse(projectIdParamsSchema, request.params, "project id");
    const input = parse(runCommandSchema, request.body, "command body");
    await requireProject(id);

    const result = await deps.orchestrator.runCommand(id, input);
    return { result };
  });

  app.get("/api/projects/:id/preview", async (request) => {
    const { id } = parse(projectIdParamsSchema, request.params, "project id");
    await requireProject(id);
    return deps.orchestrator.previewInfo(id);
  });

  app.post("/api/projects/:id/preview/start", async (request) => {
    const { id } = parse(projectIdParamsSchema, request.params, "project id");
    const input = parse(previewBodySchema, request.body ?? {}, "preview body");
    await requireProject(id);
    return deps.orchestrator.startPreview(id, input.command);
  });

  app.post("/api/projects/:id/preview/stop", async (request) => {
    const { id } = parse(projectIdParamsSchema, request.params, "project id");
    await requireProject(id);
    await deps.orchestrator.stopPreview(id);
    return { stopped: true };
  });

  /**
   * Streams a zip of the project workspace. The archive is built from the same
   * filtered index as the file explorer, so `.env` files, `.git` and
   * `node_modules` never leave the server.
   */
  app.get("/api/projects/:id/source", async (request, reply) => {
    const { id } = parse(projectIdParamsSchema, request.params, "project id");
    const project = await requireProject(id);

    const workspace = deps.workspaceFor(id);
    const files = await listWorkspaceFiles(workspace, { maxFiles: 5_000 });
    if (files.length === 0) throw notFound("Source files");

    const zip = new ZipFile();
    for (const file of files) {
      zip.addFile(safeJoin(workspace, file.path), file.path);
    }
    zip.end();

    return reply
      .header("content-type", "application/zip")
      .header(
        "content-disposition",
        `attachment; filename="${slug(project.name)}-${project.id.slice(0, 8)}.zip"`,
      )
      .header("cache-control", "no-store")
      .send(zip.outputStream);
  });
}
