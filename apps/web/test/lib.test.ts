import { describe, expect, it } from "vitest";

import { mergeEvents, terminalEntries, shouldRefreshDetail } from "../src/lib/events";
import {
  formatBytes,
  formatDuration,
  formatPercent,
  relativeTime,
  statusLabel,
  statusTone,
} from "../src/lib/format";
import { phaseProgress, summarizeTasks } from "../src/lib/progress";
import type { ActivityEvent, Project, Task } from "../src/lib/types";

function event(
  id: string,
  createdAt: string,
  overrides: Partial<ActivityEvent> = {},
): ActivityEvent {
  return {
    id,
    projectId: "project-1",
    type: "log",
    level: "info",
    message: `message ${id}`,
    payload: {},
    createdAt,
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    phase: "implementation",
    role: "frontend_developer",
    title: "Implement",
    status: "succeeded",
    orderIndex: 0,
    attempt: 1,
    output: null,
    error: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    ...overrides,
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "Test",
    description: "desc",
    requirements: "req",
    techStack: ["typescript"],
    status: "running",
    phase: "implementation",
    engine: "scaffold",
    progress: 40,
    error: null,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}

describe("mergeEvents", () => {
  it("deduplicates replayed events and keeps chronological order", () => {
    const replayed = event("b", "2026-01-01T00:00:02.000Z");
    const merged = mergeEvents(
      [event("a", "2026-01-01T00:00:01.000Z"), replayed],
      [replayed, event("c", "2026-01-01T00:00:03.000Z")],
    );
    expect(merged.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps only the newest events when the limit is exceeded", () => {
    const merged = mergeEvents(
      [event("a", "2026-01-01T00:00:01.000Z")],
      [event("b", "2026-01-01T00:00:02.000Z"), event("c", "2026-01-01T00:00:03.000Z")],
      2,
    );
    expect(merged.map((item) => item.id)).toEqual(["b", "c"]);
  });

  it("returns the current list unchanged for an empty batch", () => {
    const current = [event("a", "2026-01-01T00:00:01.000Z")];
    expect(mergeEvents(current, [])).toBe(current);
  });
});

describe("terminalEntries", () => {
  it("maps command output streams to stdout and stderr", () => {
    const entries = terminalEntries([
      event("1", "2026-01-01T00:00:01.000Z", {
        type: "command.output",
        message: "out",
        payload: { stream: "stdout" },
      }),
      event("2", "2026-01-01T00:00:02.000Z", {
        type: "command.output",
        message: "err",
        payload: { stream: "stderr" },
      }),
    ]);
    expect(entries.map((entry) => entry.tone)).toEqual(["stdout", "stderr"]);
  });

  it("marks a zero exit code as success and a non-zero one as stderr", () => {
    const entries = terminalEntries([
      event("1", "2026-01-01T00:00:01.000Z", {
        type: "command.completed",
        payload: { exitCode: 0 },
      }),
      event("2", "2026-01-01T00:00:02.000Z", {
        type: "command.completed",
        payload: { exitCode: 1 },
      }),
    ]);
    expect(entries.map((entry) => entry.tone)).toEqual(["success", "stderr"]);
  });

  it("warns on a test run with failures", () => {
    const [entry] = terminalEntries([
      event("1", "2026-01-01T00:00:01.000Z", {
        type: "test.completed",
        message: "2 failed",
        payload: { failed: 2 },
      }),
    ]);
    expect(entry?.tone).toBe("warning");
  });

  it("ignores event types that are not terminal output", () => {
    const entries = terminalEntries([
      event("1", "2026-01-01T00:00:01.000Z", { type: "file.written" }),
      event("2", "2026-01-01T00:00:02.000Z", { type: "approval.requested" }),
    ]);
    expect(entries).toEqual([]);
  });
});

describe("phaseProgress", () => {
  it("marks every phase done for a completed project", () => {
    const steps = phaseProgress(project({ status: "completed", phase: "approval" }), []);
    expect(steps).toHaveLength(9);
    expect(steps.every((step) => step.state === "done")).toBe(true);
  });

  it("marks a phase failed when one of its tasks failed", () => {
    const steps = phaseProgress(project(), [task({ status: "failed" })]);
    expect(steps.find((step) => step.phase === "implementation")?.state).toBe("failed");
  });

  it("marks the current phase active when its tasks are still pending", () => {
    const steps = phaseProgress(project({ phase: "architecture" }), []);
    expect(steps.find((step) => step.phase === "architecture")?.state).toBe("active");
    expect(steps.find((step) => step.phase === "intake")?.state).toBe("done");
  });
});

describe("summarizeTasks", () => {
  it("counts tasks by status", () => {
    const summary = summarizeTasks([
      task({ id: "1", status: "succeeded" }),
      task({ id: "2", status: "failed" }),
      task({ id: "3", status: "running" }),
      task({ id: "4", status: "pending" }),
    ]);
    expect(summary).toEqual({ total: 4, succeeded: 1, failed: 1, running: 1, pending: 1 });
  });
});

describe("format helpers", () => {
  it("labels and tones project statuses", () => {
    expect(statusLabel("awaiting_approval")).toBe("Awaiting approval");
    expect(statusTone("completed")).toBe("positive");
    expect(statusTone("failed")).toBe("negative");
  });

  it("formats durations and bytes without inventing values", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(1500)).toBe("1.50s");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });

  it("formats percentages", () => {
    expect(formatPercent(99.4)).toBe("99%");
  });

  it("describes recent times relative to a fixed clock", () => {
    const now = Date.parse("2026-01-01T00:01:00.000Z");
    expect(relativeTime("2026-01-01T00:00:58.000Z", now)).toBe("just now");
    expect(relativeTime("2026-01-01T00:00:30.000Z", now)).toBe("30s ago");
  });
});

describe("shouldRefreshDetail", () => {
  it("refreshes on workflow events but not on file writes", () => {
    expect(shouldRefreshDetail("task.completed")).toBe(true);
    expect(shouldRefreshDetail("approval.decided")).toBe(true);
    expect(shouldRefreshDetail("file.written")).toBe(false);
  });
});
