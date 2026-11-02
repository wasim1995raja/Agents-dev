import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ScaffoldEngine, extractFeatures, safeJoin } from "../src/scaffold-engine.js";
import type { CodingEvent, CodingTask } from "../src/types.js";

const workspace = path.join("/tmp/opencode", `autodev-coding-test-${Date.now()}`);
const port = 4600 + Math.floor(Math.random() * 300);

const task: CodingTask = {
  projectId: "00000000-0000-0000-0000-000000000001",
  workspacePath: workspace,
  appName: "Harbor Tasks",
  requirements:
    "Build a team task tracker.\nUsers can create tasks with a title and due date.\nUsers can move tasks between backlog and done.\nShow a dashboard of overdue work.\nOnly authenticated members can view a board.",
  techStack: ["nodejs", "playwright"],
  phaseContext: {
    brd: "# BRD\n\nTeam task management.",
    architecture: "# Architecture\n\nNode HTTP server.",
    ux: "# UX\n\nDashboard and board.",
  },
  instruction: "Scaffold the MVP.",
};

let server: ReturnType<typeof spawn> | null = null;

beforeAll(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

afterAll(async () => {
  if (server) {
    server.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 300));
    server.kill("SIGKILL");
  }
  await fs.rm(workspace, { recursive: true, force: true });
});

describe("ScaffoldEngine", () => {
  it("derives features from requirements", () => {
    const features = extractFeatures(task.requirements);
    expect(features.length).toBeGreaterThanOrEqual(3);
    expect(features.map((f) => f.description).join(" ")).toContain("create tasks");
  });

  it("refuses to escape the workspace", () => {
    expect(() => safeJoin(workspace, "../escape.txt")).toThrow(/outside workspace/);
    expect(() => safeJoin(workspace, "/etc/passwd")).toThrow(/outside workspace/);
  });

  it("writes a runnable application", async () => {
    const events: CodingEvent[] = [];
    const result = await new ScaffoldEngine().run(task, (event) => events.push(event));

    expect(result.engine).toBe("scaffold");
    expect(result.filesWritten).toContain("server.mjs");
    expect(result.filesWritten).toContain("tests/app.spec.ts");
    expect(events.filter((e) => e.type === "file").length).toBe(result.filesWritten.length);

    const spec = await fs.readFile(path.join(workspace, "tests/app.spec.ts"), "utf8");
    expect(spec).toContain("Harbor Tasks");

    const brd = await fs.readFile(path.join(workspace, "docs/BRD.md"), "utf8");
    expect(brd).toContain("Team task management");
  });

  it("serves real HTTP responses", async () => {
    server = spawn("node", ["server.mjs"], {
      cwd: workspace,
      env: { ...process.env, PORT: String(port) },
      stdio: "ignore",
    });

    const deadline = Date.now() + 15_000;
    let health: Response | null = null;
    while (Date.now() < deadline) {
      try {
        health = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (health.ok) break;
      } catch {
        // not up yet
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    expect(health?.ok).toBe(true);
    const body = (await health?.json()) as { status: string };
    expect(body.status).toBe("ok");

    const home = await fetch(`http://127.0.0.1:${port}/`);
    const html = await home.text();
    expect(html).toContain("Harbor Tasks");

    const meta = await fetch(`http://127.0.0.1:${port}/api/meta`);
    const metaBody = (await meta.json()) as { features: unknown[] };
    expect(metaBody.features.length).toBeGreaterThan(0);

    const missing = await fetch(`http://127.0.0.1:${port}/api/nope`);
    expect(missing.status).toBe(404);
  });
});
