import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";

import type { FastifyInstance } from "fastify";

import {
  createProjectSchema,
  listProjectsQuerySchema,
  projectIdParamsSchema,
  startProjectSchema,
  type EngineName,
} from "@autodev/shared";
import { ensureWorkspace } from "@autodev/orchestrator";

import { badRequest, conflict, notFound, parse } from "../http.js";
import {
  approvalDto,
  deploymentDto,
  projectDto,
  requirementsDto,
  taskDto,
  testDto,
} from "../serializers.js";
import type { ProjectRecord, RouteContext } from "../types.js";

function assertEngineUsable(deps: RouteContext["deps"], engine: EngineName): void {
  if (engine === "scaffold") return;
  if (!deps.config.hasOpenAIKey) {
    throw badRequest(
      `Engine "${engine}" requires OPENAI_API_KEY. Use the scaffold engine or configure a key.`,
    );
  }
}

export function registerProjectRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;
  const { projects, tasks, artifacts, requirements } = deps.repositories;

  async function requireProject(id: string): Promise<ProjectRecord> {
    const project = await projects.findById(id);
    if (!project) throw notFound(`Project ${id}`);
    return project;
  }

  app.post("/api/projects", async (request, reply) => {
    const input = parse(createProjectSchema, request.body, "project body");
    const engine = input.engine ?? deps.config.resolvedEngine;
    assertEngineUsable(deps, engine);

    const id = randomUUID();
    const workspacePath = deps.workspaceFor(id);
    await ensureWorkspace(workspacePath);

    let project: ProjectRecord;
    try {
      project = await projects.create({
        id,
        name: input.name,
        description: input.description,
        requirements: input.requirements,
        techStack: input.techStack ?? ["typescript", "nodejs", "playwright"],
        engine,
        workspacePath,
      });
    } catch (error) {
      // Do not leave an orphan directory when the insert fails.
      await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }

    await deps.eventBus.publish({
      projectId: project.id,
      type: "project.created",
      message: `Project "${project.name}" created with the ${project.engine} engine`,
      payload: { engine: project.engine, techStack: project.techStack },
    });

    if (input.autoStart) {
      // Fire and forget: the run reports progress through events and the project
      // row. The 202 below means "accepted", never "finished".
      void deps.orchestrator.start(project.id).catch((error: unknown) => {
        app.log.error({ err: error, projectId: project.id }, "auto-start failed");
      });
      return reply.status(202).send({ project: projectDto(project, true) });
    }

    return reply.status(201).send({ project: projectDto(project, deps.orchestrator.isActive(project.id)) });
  });

  app.get("/api/projects", async (request) => {
    const query = parse(listProjectsQuerySchema, request.query, "query");
    const rows = await projects.list({
      limit: query.limit,
      ...(query.cursor ? { before: new Date(query.cursor) } : {}),
    });
    const items = rows.map((row) => projectDto(row, deps.orchestrator.isActive(row.id)));
    return {
      items,
      nextCursor: rows.length === query.limit ? rows[rows.length - 1]?.createdAt.toISOString() : null,
    };
  });

  app.get("/api/projects/:id", async (request) => {
    const { id } = parse(projectIdParamsSchema, request.params, "project id");
    const project = await requireProject(id);

    const [requirementsRow, taskRows, testRows, approvalRows, deploymentRows] = await Promise.all([
      requirements.latest(id),
      tasks.listByProject(id),
      artifacts.listTests(id),
      artifacts.listApprovals(id),
      artifacts.listDeployments(id),
    ]);

    return {
      project: projectDto(project, deps.orchestrator.isActive(project.id)),
      requirements: requirementsRow ? requirementsDto(requirementsRow) : null,
      tasks: taskRows.map(taskDto),
      tests: testRows.map(testDto),
      approvals: approvalRows.map(approvalDto),
      deployments: deploymentRows.map(deploymentDto),
    };
  });

  app.post("/api/projects/:id/start", async (request, reply) => {
    const { id } = parse(projectIdParamsSchema, request.params, "project id");
    const input = parse(startProjectSchema, request.body ?? {}, "start body");
    const project = await requireProject(id);

    if (deps.orchestrator.isActive(id)) {
      throw conflict("Project is already running");
    }

    const engine = input.engine ?? project.engine;
    assertEngineUsable(deps, engine);
    if (engine !== project.engine) {
      await projects.update(id, { engine });
    }

    void deps.orchestrator.start(id).catch((error: unknown) => {
      app.log.error({ err: error, projectId: id }, "start failed");
    });

    return reply.status(202).send({ id, accepted: true, engine });
  });

  app.post("/api/projects/:id/cancel", async (request) => {
    const { id } = parse(projectIdParamsSchema, request.params, "project id");
    await requireProject(id);
    await deps.orchestrator.stop(id);
    const project = await requireProject(id);
    return { project: projectDto(project, deps.orchestrator.isActive(id)) };
  });

  app.delete("/api/projects/:id", async (request) => {
    const { id } = parse(projectIdParamsSchema, request.params, "project id");
    const query = request.query as { deleteWorkspace?: string };
    const project = await requireProject(id);

    if (deps.orchestrator.isActive(id)) {
      throw conflict("Cancel the run before deleting the project");
    }

    if (query.deleteWorkspace === "true") {
      const workspace = deps.workspaceFor(id);
      await fs.rm(workspace, { recursive: true, force: true });
    }

    await projects.delete(id);
    return { deleted: true, workspaceRemoved: query.deleteWorkspace === "true" };
  });
}
