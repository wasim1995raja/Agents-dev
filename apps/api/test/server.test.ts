import fs from "node:fs/promises";
import path from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildServer } from "../src/app.js";
import { createFakeDeps, makeApproval, makeProject, makeTask, makeTestResult, type FakeState } from "./fakes.js";

const WORKSPACE_ROOT = path.join("/tmp/opencode", `api-routes-${process.pid}-${Date.now()}`);

let app: FastifyInstance;
let state: FakeState;
let deps: ReturnType<typeof createFakeDeps>["deps"];

beforeAll(async () => {
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
});

afterAll(async () => {
  await fs.rm(WORKSPACE_ROOT, { recursive: true, force: true });
});

beforeEach(async () => {
  if (app) await app.close();
  const fake = createFakeDeps({ workspaceRoot: WORKSPACE_ROOT });
  deps = fake.deps;
  state = fake.state;
  app = await buildServer({ deps, logger: false });
});

async function makeWorkspace(projectId: string, files: Record<string, string>): Promise<void> {
  const root = path.join(WORKSPACE_ROOT, projectId);
  await fs.mkdir(root, { recursive: true });
  for (const [filePath, content] of Object.entries(files)) {
    const absolute = path.join(root, filePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, "utf8");
  }
}

describe("health and runtime", () => {
  it("reports health when the database responds", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", database: "up", engine: "scaffold" });
  });

  it("reports a degraded service instead of a 500 when the database is down", async () => {
    deps.pingDatabase = async () => {
      throw new Error("connection refused");
    };
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: "degraded", database: "down" });
  });

  it("never claims an LLM engine is available without a key", async () => {
    const response = await app.inject({ method: "GET", url: "/api/runtime" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.hasOpenAIKey).toBe(false);
    expect(body.engine).toBe("scaffold");
    expect(body.availableEngines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "scaffold", available: true }),
        expect.objectContaining({ name: "codex", available: false }),
        expect.objectContaining({ name: "openai-agents", available: false }),
      ]),
    );
    expect(body.sandbox.dockerAvailable).toBe(true);
  });

  it("reports Docker unavailability rather than failing", async () => {
    deps.sandbox.assertAvailable = async () => {
      throw new Error("Cannot connect to the Docker daemon");
    };
    const response = await app.inject({ method: "GET", url: "/api/runtime" });
    expect(response.statusCode).toBe(200);
    expect(response.json().sandbox.dockerAvailable).toBe(false);
  });
});

describe("projects", () => {
  it("rejects invalid input with field-level detail", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "x", description: "short", requirements: "tiny" },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe("bad_request");
    expect(body.error.details.length).toBeGreaterThan(0);
    expect(body.error.details[0]).toHaveProperty("path");
  });

  it("creates a project, its workspace and a creation event", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Inventory Tracker",
        description: "Track warehouse inventory across locations",
        requirements: "Users must add items, adjust quantities and see low-stock alerts.",
        techStack: ["typescript", "nodejs"],
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.project).toMatchObject({
      name: "Inventory Tracker",
      engine: "scaffold",
      status: "draft",
      active: false,
    });
    expect(body.project.workspacePath).toBeUndefined();
    expect(body.project.containerId).toBeUndefined();

    const workspace = path.join(WORKSPACE_ROOT, body.project.id);
    expect((await fs.stat(workspace)).isDirectory()).toBe(true);
    expect(state.published).toEqual([
      expect.objectContaining({ type: "project.created", projectId: body.project.id }),
    ]);
  });

  it("refuses an engine that needs credentials it does not have", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "LLM Project",
        description: "A project that asks for the codex engine",
        requirements: "It should be rejected because OPENAI_API_KEY is absent.",
        engine: "codex",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/OPENAI_API_KEY/);
  });

  it("accepts autoStart and starts the run in the background", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Auto Start",
        description: "A project that starts as soon as it is created",
        requirements: "It should return 202 without waiting for the full pipeline.",
        autoStart: true,
      },
    });
    expect(response.statusCode).toBe(202);
    const id = response.json().project.id;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(state.started).toEqual([id]);
  });

  it("lists projects newest first with pagination metadata", async () => {
    const older = makeProject({ name: "Older", createdAt: new Date("2026-01-01T00:00:00Z") });
    const newer = makeProject({ name: "Newer", createdAt: new Date("2026-02-01T00:00:00Z") });
    state.projects.push(older, newer);

    const response = await app.inject({ method: "GET", url: "/api/projects?limit=1" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("Newer");
    expect(body.nextCursor).toBe(newer.createdAt.toISOString());
  });

  it("returns detail with tasks, tests and approvals", async () => {
    const project = makeProject();
    state.projects.push(project);
    state.tasks.push(makeTask({ projectId: project.id, title: "Analyse requirements" }));
    state.tests.push(makeTestResult({ projectId: project.id }));
    state.approvals.push(makeApproval({ projectId: project.id }));

    const response = await app.inject({ method: "GET", url: `/api/projects/${project.id}` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.project.id).toBe(project.id);
    expect(body.tasks).toHaveLength(1);
    expect(body.tests[0]).toMatchObject({ status: "passed", passed: 4 });
    expect(body.tests[0].createdAt).toMatch(/Z$/);
    expect(body.approvals[0]).toMatchObject({ status: "pending", type: "production_deployment" });
  });

  it("404s for an unknown project", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${crypto.randomUUID()}`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("not_found");
  });

  it("starts and cancels a run", async () => {
    const project = makeProject();
    state.projects.push(project);

    const started = await app.inject({ method: "POST", url: `/api/projects/${project.id}/start` });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({ id: project.id, accepted: true });

    const again = await app.inject({ method: "POST", url: `/api/projects/${project.id}/start` });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.message).toMatch(/already running/);

    const cancelled = await app.inject({ method: "POST", url: `/api/projects/${project.id}/cancel` });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().project.status).toBe("cancelled");
    expect(state.stopped).toEqual([project.id]);
  });

  it("deletes the row and only removes the workspace when asked", async () => {
    const project = makeProject();
    state.projects.push(project);
    await makeWorkspace(project.id, { "index.html": "<h1>hi</h1>" });

    const kept = await app.inject({ method: "DELETE", url: `/api/projects/${project.id}` });
    expect(kept.statusCode).toBe(200);
    expect(kept.json()).toEqual({ deleted: true, workspaceRemoved: false });
    expect((await fs.stat(path.join(WORKSPACE_ROOT, project.id))).isDirectory()).toBe(true);

    state.projects.push(project);
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}?deleteWorkspace=true`,
    });
    expect(removed.json()).toEqual({ deleted: true, workspaceRemoved: true });
    await expect(fs.stat(path.join(WORKSPACE_ROOT, project.id))).rejects.toThrow();
  });
});

describe("events", () => {
  it("lists persisted events in chronological order", async () => {
    const project = makeProject();
    state.projects.push(project);
    await deps.eventBus.publish({ projectId: project.id, type: "phase.started", message: "one" });
    await deps.eventBus.publish({ projectId: project.id, type: "task.started", message: "two" });

    const response = await app.inject({ method: "GET", url: `/api/projects/${project.id}/events` });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.map((event: { message: string }) => event.message)).toEqual([
      "one",
      "two",
    ]);
  });

  it("streams buffered and live events as server-sent events", async () => {
    const project = makeProject();
    state.projects.push(project);
    await deps.eventBus.publish({ projectId: project.id, type: "phase.started", message: "buffered" });

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const controller = new AbortController();

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/projects/${project.id}/events/stream`, {
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("no body");
      const decoder = new TextDecoder();
      let text = "";

      // The buffered event must be replayed before any live event.
      while (!text.includes("buffered")) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      expect(text).toContain("event: phase.started");

      await deps.eventBus.publish({ projectId: project.id, type: "task.started", message: "live" });
      while (!text.includes("live")) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      expect(text).toContain("event: task.started");
    } finally {
      controller.abort();
    }
  });

  it("sets CORS headers on the hijacked event stream so browsers can subscribe", async () => {
    const project = makeProject();
    state.projects.push(project);

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const url = `http://127.0.0.1:${address.port}/api/projects/${project.id}/events/stream`;
    const allowedController = new AbortController();
    const blockedController = new AbortController();

    try {
      const allowed = await fetch(url, {
        headers: { origin: "http://localhost:3000" },
        signal: allowedController.signal,
      });
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get("access-control-allow-origin")).toBe(
        "http://localhost:3000",
      );

      const blocked = await fetch(url, {
        headers: { origin: "http://evil.example" },
        signal: blockedController.signal,
      });
      expect(blocked.status).toBe(200);
      expect(blocked.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      allowedController.abort();
      blockedController.abort();
    }
  });
});

describe("files", () => {
  it("lists files but never secrets or dependency trees", async () => {
    const project = makeProject();
    state.projects.push(project);
    await makeWorkspace(project.id, {
      "index.html": "<h1>hi</h1>",
      "src/app.ts": "export const answer = 42;\n",
      ".env": "SECRET=1\n",
      ".gitignore": "node_modules/\n",
      "node_modules/dep/index.js": "noise",
    });

    const response = await app.inject({ method: "GET", url: `/api/projects/${project.id}/files` });
    expect(response.statusCode).toBe(200);
    const paths = response.json().items.map((file: { path: string }) => file.path);
    expect(paths).toContain("index.html");
    expect(paths).toContain("src/app.ts");
    expect(paths).toContain(".gitignore");
    expect(paths).not.toContain(".env");
    expect(paths.some((file: string) => file.startsWith("node_modules/"))).toBe(false);
  });

  it("reads a source file", async () => {
    const project = makeProject();
    state.projects.push(project);
    await makeWorkspace(project.id, { "src/app.ts": "export const answer = 42;\n" });

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/files/content?path=src/app.ts`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ path: "src/app.ts", content: "export const answer = 42;\n" });
  });

  it("forbids reading a secret file even by explicit path", async () => {
    const project = makeProject();
    state.projects.push(project);
    await makeWorkspace(project.id, { ".env": "SECRET=1\n", ".env.production": "SECRET=2\n" });

    for (const secret of [".env", ".env.production"]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/projects/${project.id}/files/content?path=${encodeURIComponent(secret)}`,
      });
      expect(response.statusCode).toBe(403);
      expect(JSON.stringify(response.json())).not.toContain("SECRET=");
    }
  });

  it("rejects path traversal", async () => {
    const project = makeProject();
    state.projects.push(project);
    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/files/content?path=${encodeURIComponent("../etc/passwd")}`,
    });
    expect(response.statusCode).toBe(400);
  });

  it("downloads a zip that excludes secrets and VCS data", async () => {
    const project = makeProject();
    state.projects.push(project);
    await makeWorkspace(project.id, {
      "index.html": "<h1>hi</h1>",
      "src/app.ts": "export const answer = 42;\n",
      ".env": "SECRET=1\n",
      ".git/config": "noise",
    });

    const response = await app.inject({ method: "GET", url: `/api/projects/${project.id}/source` });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");
    expect(response.headers["content-disposition"]).toMatch(/attachment; filename=".*\.zip"/);

    const body = response.rawPayload;
    expect(body.subarray(0, 2).toString()).toBe("PK");
    const text = body.toString("latin1");
    expect(text).toContain("index.html");
    expect(text).toContain("src/app.ts");
    expect(text).not.toContain(".env");
    expect(text).not.toContain(".git/config");
  });
});

describe("approvals, commands and preview", () => {
  it("records an approval decision through the orchestrator", async () => {
    const project = makeProject();
    const approval = makeApproval({ projectId: project.id });
    state.projects.push(project);
    state.approvals.push(approval);

    const response = await app.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/decision`,
      payload: { decision: "approved", note: "ship it" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().approval).toMatchObject({
      status: "approved",
      decidedBy: "owner@autodev.local",
      note: "ship it",
    });
    expect(state.decided).toEqual([
      { approvalId: approval.id, decision: "approved", decidedBy: "owner@autodev.local", note: "ship it" },
    ]);
  });

  it("refuses to decide an approval twice", async () => {
    const project = makeProject();
    const approval = makeApproval({ projectId: project.id, status: "approved" });
    state.projects.push(project);
    state.approvals.push(approval);

    const response = await app.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/decision`,
      payload: { decision: "rejected" },
    });
    expect(response.statusCode).toBe(409);
    expect(state.decided).toEqual([]);
  });

  it("runs a command and returns the real result envelope", async () => {
    const project = makeProject();
    state.projects.push(project);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/commands`,
      payload: { command: "node --version" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().result).toMatchObject({ command: "node --version", exitCode: 0 });
  });

  it("starts and stops the preview", async () => {
    const project = makeProject();
    state.projects.push(project);

    const start = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/preview/start`,
      payload: { command: "node server.mjs" },
    });
    expect(start.statusCode).toBe(200);
    expect(start.json().url).toBe("http://127.0.0.1:9000");

    const info = await app.inject({ method: "GET", url: `/api/projects/${project.id}/preview` });
    expect(info.json().url).toBe("http://127.0.0.1:9000");

    const stop = await app.inject({ method: "POST", url: `/api/projects/${project.id}/preview/stop` });
    expect(stop.json()).toEqual({ stopped: true });
  });
});

describe("error handling", () => {
  it("returns a JSON 404 for unknown routes", async () => {
    const response = await app.inject({ method: "GET", url: "/api/nope" });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("not_found");
  });

  it("hides internal error messages from clients", async () => {
    deps.repositories.projects.findById = async () => {
      throw new Error("password authentication failed for user \"autodev\"");
    };
    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${crypto.randomUUID()}`,
    });
    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error.message).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("password");
    expect(body.error.requestId).toBeTruthy();
  });
});
