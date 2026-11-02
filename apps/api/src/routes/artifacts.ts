import type { FastifyInstance } from "fastify";

import { GitRepo } from "@autodev/git";
import { projectIdParamsSchema } from "@autodev/shared";

import { notFound, parse } from "../http.js";
import { approvalDto, deploymentDto, executionDto, taskDto, testDto } from "../serializers.js";
import type { RouteContext } from "../types.js";

export function registerArtifactRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;
  const { projects, tasks, artifacts } = deps.repositories;

  async function requireProject(id: string) {
    const project = await projects.findById(id);
    if (!project) throw notFound(`Project ${id}`);
    return project;
  }

  app.get("/api/projects/:id/tasks", async (request) => {
    const { id } = parse(projectIdParamsSchema, request.params, "project id");
    await requireProject(id);
    return { items: (await tasks.listByProject(id)).map(taskDto) };
  });

  app.get("/api/projects/:id/tests", async (request) => {
    const { id } = parse(projectIdParamsSchema, request.params, "project id");
    await requireProject(id);
    return { items: (await artifacts.listTests(id)).map(testDto) };
  });

  app.get("/api/projects/:id/executions", async (request) => {
    const { id } = parse(projectIdParamsSchema, request.params, "project id");
    await requireProject(id);
    return { items: (await artifacts.listExecutions(id)).map(executionDto) };
  });

  app.get("/api/projects/:id/deployments", async (request) => {
    const { id } = parse(projectIdParamsSchema, request.params, "project id");
    await requireProject(id);
    return { items: (await artifacts.listDeployments(id)).map(deploymentDto) };
  });

  app.get("/api/projects/:id/approvals", async (request) => {
    const { id } = parse(projectIdParamsSchema, request.params, "project id");
    await requireProject(id);
    return { items: (await artifacts.listApprovals(id)).map(approvalDto) };
  });

  /**
   * Git history is read from the workspace, not a cache. A project that has not
   * been committed yet returns an empty list rather than an error.
   */
  app.get("/api/projects/:id/commits", async (request) => {
    const { id } = parse(projectIdParamsSchema, request.params, "project id");
    await requireProject(id);

    const git = new GitRepo({ repoPath: deps.workspaceFor(id) });
    if (!(await git.isRepository())) return { items: [] };
    return { items: await git.log(50) };
  });
}
