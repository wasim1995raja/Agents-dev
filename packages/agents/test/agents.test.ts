import fs from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  architectureSchema,
  managerPlanSchema,
  parseJsonResponse,
  reviewSchema,
  type ManagerPlan,
} from "../src/artifacts.js";
import {
  localArchitecture,
  localBusinessAnalysis,
  localCodeReview,
  localDeployment,
  localManagerPlan,
  localQaPlan,
  localUx,
  type ProjectFacts,
} from "../src/local-specialists.js";
import { AGENT_PROMPTS, getAgentPrompt } from "../src/prompts.js";
import { createWorkspaceTools } from "../src/tools.js";

const facts: ProjectFacts = {
  appName: "Harbor Tasks",
  description: "A team task tracker for small product teams.",
  requirements: [
    "Build a team task tracker.",
    "Users can create tasks with a title, owner and due date.",
    "Users can move tasks between backlog, doing and done.",
    "The dashboard shows overdue work first.",
    "Only authenticated members can view a board.",
  ].join("\n"),
  techStack: ["nodejs", "postgresql", "playwright", "docker"],
};

const workspace = path.join("/tmp/opencode", `autodev-agents-test-${Date.now()}`);

beforeAll(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "README.md"), "# Demo\n", "utf8");
});

afterAll(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

describe("parseJsonResponse", () => {
  it("parses a bare JSON object", () => {
    const plan = parseJsonResponse(
      managerPlanSchema,
      JSON.stringify({ strategy: "slice it", milestones: [], risks: [] }),
    );
    expect(plan.strategy).toBe("slice it");
  });

  it("unwraps markdown fences", () => {
    const raw = 'Here you go:\n```json\n{"strategy":"x","milestones":[],"risks":["r"]}\n```';
    expect(parseJsonResponse(managerPlanSchema, raw).risks).toEqual(["r"]);
  });

  it("applies schema defaults", () => {
    const plan = parseJsonResponse(managerPlanSchema, '{"strategy":"x"}');
    expect(plan.milestones).toEqual([]);
    expect(plan.risks).toEqual([]);
  });

  it("throws on invalid JSON and invalid shape", () => {
    expect(() => parseJsonResponse(managerPlanSchema, "not json")).toThrow(/not valid JSON/);
    expect(() => parseJsonResponse(managerPlanSchema, '{"strategy":1}')).toThrow();
  });
});

describe("local specialists", () => {
  it("produces a BRD grounded in the requirements", () => {
    const analysis = localBusinessAnalysis(facts);
    expect(analysis.brd).toContain("Harbor Tasks");
    expect(analysis.brd).toContain("create tasks");
    expect(analysis.userStories.length).toBeGreaterThanOrEqual(3);
    expect(analysis.userStories[0]?.id).toBe("US-1");
    expect(analysis.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  it("produces architecture, UX and QA artifacts", () => {
    const architecture = localArchitecture(facts);
    expect(architectureSchema.parse(architecture).components.length).toBeGreaterThan(2);
    expect(architecture.api.some((route) => route.path === "/api/health")).toBe(true);

    const ux = localUx(facts);
    expect(ux.screens.length).toBeGreaterThanOrEqual(3);
    expect(ux.accessibility.join(" ")).toMatch(/contrast/i);

    const qa = localQaPlan(localBusinessAnalysis(facts).acceptanceCriteria);
    expect(qa.scenarios.length).toBeGreaterThan(0);
    expect(qa.scenarios[0]?.id).toBe("TC-1");
  });

  it("flags failing tests and committed secrets in review", () => {
    const review = localCodeReview({
      facts,
      files: [
        { path: "server.mjs", content: "const key = 'sk-abcdefghijklmnopqrstuvwx';" },
        { path: ".env", content: "PORT=4173" },
      ],
      testSummary: { total: 4, passed: 3, failed: 1 },
    });

    expect(review.verdict).toBe("changes_requested");
    expect(reviewSchema.parse(review).issues.length).toBeGreaterThanOrEqual(3);
    expect(review.issues.some((issue) => issue.severity === "critical")).toBe(true);
  });

  it("passes a review with tests and no secrets", () => {
    const review = localCodeReview({
      facts,
      files: [{ path: "tests/app.spec.ts", content: "test('ok', async () => {});" }],
      testSummary: { total: 2, passed: 2, failed: 0 },
    });
    expect(review.verdict).toBe("pass");
    expect(review.issues.filter((issue) => issue.severity === "critical")).toEqual([]);
  });

  it("prepares deployment without claiming production readiness", () => {
    const deployment = localDeployment(facts);
    expect(deployment.dockerfile).toContain("FROM node:22");
    expect(deployment.envVars.some((entry) => entry.name === "PORT")).toBe(true);
    expect(deployment.readyForProduction).toBe(false);
  });

  it("produces a manager plan that satisfies the schema", () => {
    const plan: ManagerPlan = localManagerPlan(facts);
    expect(managerPlanSchema.parse(plan).milestones).toHaveLength(8);
  });
});

describe("prompts", () => {
  it("exposes a prompt for every specialist role", () => {
    for (const role of [
      "business_analyst",
      "solution_architect",
      "ui_ux",
      "frontend_developer",
      "backend_developer",
      "qa_automation",
      "code_review",
      "deployment",
    ] as const) {
      expect(AGENT_PROMPTS[role].instructions.length).toBeGreaterThan(100);
    }
  });

  it("returns the manager prompt for the manager role", () => {
    expect(getAgentPrompt("manager").name).toBe("Manager Agent");
  });
});

describe("workspace tools", () => {
  const tools = createWorkspaceTools({ workspacePath: workspace });
  const readFile = tools.find((entry) => entry.name === "read_file")!;
  const writeFile = tools.find((entry) => entry.name === "write_file")!;

  it("reads files inside the workspace", async () => {
    const result = await readFile.invoke({} as never, JSON.stringify({ path: "README.md" }));
    expect(String(result)).toContain("# Demo");
  });

  it("writes files inside the workspace", async () => {
    await writeFile.invoke(
      {} as never,
      JSON.stringify({ path: "src/app.ts", content: "export const ok = true;\n" }),
    );
    const written = await fs.readFile(path.join(workspace, "src/app.ts"), "utf8");
    expect(written).toContain("ok = true");
  });

  it("refuses path traversal and absolute paths", async () => {
    const traversal = await readFile.invoke(
      {} as never,
      JSON.stringify({ path: "../outside.txt" }),
    );
    expect(String(traversal)).toMatch(/outside workspace/);

    const sibling = path.join(workspace, "..", "escaped.txt");
    await fs.rm(sibling, { force: true });
    const absolute = await writeFile.invoke(
      {} as never,
      JSON.stringify({ path: sibling, content: "should never land" }),
    );
    expect(String(absolute)).toMatch(/outside workspace/);
    await expect(fs.readFile(sibling, "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("only exposes run_command when a sandbox executor is supplied", () => {
    expect(tools.some((entry) => entry.name === "run_command")).toBe(false);
    const withExec = createWorkspaceTools({
      workspacePath: workspace,
      runCommand: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
    });
    expect(withExec.some((entry) => entry.name === "run_command")).toBe(true);
  });
});
