import { describe, expect, it } from "vitest";

import { readConfig } from "../src/config.js";
import { createProjectSchema, runCommandSchema, writeFileSchema } from "../src/contracts.js";
import { PHASES, DEFAULT_PHASE_PLAN } from "../src/domain.js";
import { toSseFrame } from "../src/events.js";

describe("createProjectSchema", () => {
  it("accepts a valid project payload", () => {
    const parsed = createProjectSchema.parse({
      name: "Harbor Tasks",
      description: "A team task tracker for small product teams.",
      requirements: "Users can create and move tasks between backlog and done.",
      techStack: ["nodejs", "playwright"],
    });
    expect(parsed.name).toBe("Harbor Tasks");
  });

  it("rejects short names, short requirements and unknown stack items", () => {
    expect(() =>
      createProjectSchema.parse({ name: "a", description: "x".repeat(20), requirements: "y".repeat(30) }),
    ).toThrow();
    expect(() =>
      createProjectSchema.parse({
        name: "Harbor",
        description: "x".repeat(20),
        requirements: "short",
      }),
    ).toThrow();
    expect(() =>
      createProjectSchema.parse({
        name: "Harbor",
        description: "x".repeat(20),
        requirements: "y".repeat(30),
        techStack: ["cobol"],
      }),
    ).toThrow();
  });
});

describe("path boundary validation", () => {
  it("rejects traversal and absolute paths for file writes", () => {
    expect(() => writeFileSchema.parse({ path: "../escape", content: "x" })).toThrow();
    expect(() => writeFileSchema.parse({ path: "/etc/passwd", content: "x" })).toThrow();
    expect(writeFileSchema.parse({ path: "src/index.ts", content: "x" }).path).toBe("src/index.ts");
  });

  it("bounds command timeouts", () => {
    expect(() => runCommandSchema.parse({ command: "ls", timeoutMs: 10 })).toThrow();
    expect(() => runCommandSchema.parse({ command: "ls", timeoutMs: 10_000_000 })).toThrow();
  });
});

describe("readConfig", () => {
  it("resolves the engine to scaffold without a key", () => {
    const config = readConfig({ DATABASE_URL: "postgresql://x:y@localhost:5432/z" });
    expect(config.hasOpenAIKey).toBe(false);
    expect(config.resolvedEngine).toBe("scaffold");
    expect(config.workspacesRoot.endsWith("workspaces")).toBe(true);
  });

  it("resolves auto to codex when a key is present", () => {
    const config = readConfig({ OPENAI_API_KEY: "sk-test", AUTODEV_ENGINE: "auto" });
    expect(config.hasOpenAIKey).toBe(true);
    expect(config.resolvedEngine).toBe("codex");
  });

  it("honours an explicit engine and rejects invalid values", () => {
    expect(readConfig({ AUTODEV_ENGINE: "openai-agents" }).resolvedEngine).toBe("openai-agents");
    expect(() => readConfig({ AUTODEV_ENGINE: "magic" })).toThrow(/Invalid environment/);
  });
});

describe("domain plan", () => {
  it("maps every phase plan item to a known phase", () => {
    for (const item of DEFAULT_PHASE_PLAN) {
      expect(PHASES).toContain(item.phase);
      expect(item.title.length).toBeGreaterThan(10);
    }
  });
});

describe("toSseFrame", () => {
  it("formats a named event and a heartbeat", () => {
    const frame = toSseFrame({
      kind: "event",
      data: {
        id: "evt-1",
        projectId: "proj-1",
        type: "log",
        level: "info",
        message: "hello",
        payload: {},
        createdAt: new Date(0).toISOString(),
      },
    });
    expect(frame).toContain("id: evt-1");
    expect(frame).toContain("event: log");
    expect(frame.endsWith("\n\n")).toBe(true);

    expect(toSseFrame({ kind: "heartbeat" })).toMatch(/^: heartbeat /);
  });
});
