import { randomUUID } from "node:crypto";

import type { ActivityEvent, ActivityEventType, EventLevel, AppConfig } from "@autodev/shared";
import type { ApprovalRecord, ProjectRecord, TaskRecord, TestResultRecord } from "@autodev/db";

import type { ApiDeps, OrchestratorPort } from "../src/types.js";

export function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    NODE_ENV: "test",
    API_PORT: 3001,
    API_HOST: "127.0.0.1",
    CORS_ORIGIN: "http://localhost:3000",
    DATABASE_URL: "postgresql://unused",
    WORKSPACES_ROOT: "./workspaces",
    LOG_LEVEL: "info",
    AUTODEV_ENGINE: "auto",
    SANDBOX_IMAGE: "autodev/workspace:latest",
    SANDBOX_MEMORY_MB: 2048,
    SANDBOX_CPUS: 2,
    SANDBOX_PIDS_LIMIT: 512,
    COMMAND_TIMEOUT_MS: 300_000,
    MAX_COMMANDS_PER_PROJECT: 500,
    workspacesRoot: "/tmp/opencode/api-test-workspaces",
    hasOpenAIKey: false,
    resolvedEngine: "scaffold",
    ...overrides,
  };
}

export function makeProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: randomUUID(),
    ownerId: null,
    name: "Test Project",
    description: "A project used by API route tests",
    requirements: "The generated app must serve a home page and a health endpoint.",
    techStack: ["typescript", "nodejs"],
    status: "draft",
    phase: null,
    engine: "scaffold",
    progress: 0,
    workspacePath: "/tmp/opencode/unused",
    containerId: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

export function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: randomUUID(),
    projectId: randomUUID(),
    phase: "intake",
    role: "manager",
    title: "Analyse requirements",
    status: "succeeded",
    orderIndex: 0,
    attempt: 1,
    input: {},
    output: {},
    error: null,
    startedAt: new Date(),
    finishedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

export function makeTestResult(overrides: Partial<TestResultRecord> = {}): TestResultRecord {
  return {
    id: randomUUID(),
    projectId: randomUUID(),
    taskId: null,
    suite: "playwright",
    status: "passed",
    total: 4,
    passed: 4,
    failed: 0,
    skipped: 0,
    durationMs: 1200,
    report: { failures: [], output: "4 passed" },
    artifacts: [],
    createdAt: new Date(),
    ...overrides,
  };
}

export function makeApproval(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    id: randomUUID(),
    projectId: randomUUID(),
    type: "production_deployment",
    status: "pending",
    title: "Approve production deployment",
    payload: {},
    requestedAt: new Date(),
    decidedAt: null,
    decidedBy: null,
    note: null,
    ...overrides,
  };
}

export interface FakeState {
  projects: ProjectRecord[];
  tasks: TaskRecord[];
  tests: TestResultRecord[];
  approvals: ApprovalRecord[];
  events: ActivityEvent[];
  active: Set<string>;
  published: Array<{ projectId: string; type: ActivityEventType; message: string; level: EventLevel }>;
  subscribers: Map<string, Set<(event: ActivityEvent) => void>>;
  started: string[];
  stopped: string[];
  decided: Array<{ approvalId: string; decision: string; decidedBy: string; note?: string }>;
}

export function createFakeDeps(options: { workspaceRoot: string; config?: Partial<AppConfig> }) {
  const state: FakeState = {
    projects: [],
    tasks: [],
    tests: [],
    approvals: [],
    events: [],
    active: new Set(),
    published: [],
    subscribers: new Map(),
    started: [],
    stopped: [],
    decided: [],
  };

  const orchestrator: OrchestratorPort = {
    isActive: (projectId) => state.active.has(projectId),
    start: async (projectId) => {
      state.started.push(projectId);
      state.active.add(projectId);
      const project = state.projects.find((row) => row.id === projectId);
      if (project) project.status = "running";
    },
    stop: async (projectId) => {
      state.stopped.push(projectId);
      state.active.delete(projectId);
      const project = state.projects.find((row) => row.id === projectId);
      if (project) project.status = "cancelled";
    },
    decideApproval: async (approvalId, decision, decidedBy, note) => {
      state.decided.push({ approvalId, decision, decidedBy, ...(note ? { note } : {}) });
      const approval = state.approvals.find((row) => row.id === approvalId);
      if (!approval) throw new Error(`Approval ${approvalId} not found`);
      approval.status = decision;
      approval.decidedBy = decidedBy;
      approval.decidedAt = new Date();
      approval.note = note ?? null;
    },
    runCommand: async (_projectId, request) => ({
      command: request.command,
      exitCode: 0,
      stdout: "ok\n",
      stderr: "",
      durationMs: 5,
      timedOut: false,
      truncated: false,
    }),
    previewInfo: async () => ({ url: "http://127.0.0.1:9000", command: "node server.mjs" }),
    startPreview: async () => ({ url: "http://127.0.0.1:9000", command: "node server.mjs" }),
    stopPreview: async () => undefined,
  };

  const repositories = {
    projects: {
      create: async (input: {
        id?: string;
        name: string;
        description: string;
        requirements: string;
        techStack: string[];
        engine: ProjectRecord["engine"];
        workspacePath: string;
      }) => {
        const project = makeProject({
          id: input.id ?? randomUUID(),
          name: input.name,
          description: input.description,
          requirements: input.requirements,
          techStack: input.techStack,
          engine: input.engine,
          workspacePath: input.workspacePath,
        });
        state.projects.push(project);
        return project;
      },
      findById: async (id: string) => state.projects.find((row) => row.id === id) ?? null,
      list: async (listOptions: { limit: number; before?: Date }) => {
        const rows = [...state.projects]
          .filter((row) => !listOptions.before || row.createdAt < listOptions.before)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows.slice(0, listOptions.limit);
      },
      update: async (id: string, patch: Partial<ProjectRecord>) => {
        const project = state.projects.find((row) => row.id === id);
        if (!project) throw new Error(`Project ${id} not found`);
        Object.assign(project, patch);
        return project;
      },
      delete: async (id: string) => {
        const index = state.projects.findIndex((row) => row.id === id);
        if (index === -1) throw new Error(`Project ${id} not found`);
        state.projects.splice(index, 1);
      },
    },
    tasks: {
      listByProject: async (projectId: string) => state.tasks.filter((row) => row.projectId === projectId),
    },
    artifacts: {
      listTests: async (projectId: string) => state.tests.filter((row) => row.projectId === projectId),
      listApprovals: async (projectId: string) =>
        state.approvals.filter((row) => row.projectId === projectId),
      listDeployments: async () => [],
      listExecutions: async () => [],
      findApproval: async (id: string) => state.approvals.find((row) => row.id === id) ?? null,
    },
    requirements: {
      latest: async () => null,
    },
    events: {
      list: async (projectId: string, listOptions: { limit: number; before?: Date }) =>
        state.events
          .filter((row) => row.projectId === projectId)
          .filter((row) => !listOptions.before || new Date(row.createdAt) < listOptions.before)
          .slice(-listOptions.limit),
    },
  };

  const eventBus = {
    publish: async (input: { projectId: string; type: ActivityEventType; message: string; level?: EventLevel; payload?: Record<string, unknown> }) => {
      const event: ActivityEvent = {
        id: randomUUID(),
        projectId: input.projectId,
        type: input.type,
        level: input.level ?? "info",
        message: input.message,
        payload: input.payload ?? {},
        createdAt: new Date().toISOString(),
      };
      state.events.push(event);
      state.published.push({
        projectId: input.projectId,
        type: input.type,
        message: input.message,
        level: event.level,
      });
      for (const subscriber of state.subscribers.get(input.projectId) ?? []) {
        subscriber(event);
      }
      return event;
    },
    subscribe: (projectId: string, subscriber: (event: ActivityEvent) => void) => {
      const set = state.subscribers.get(projectId) ?? new Set();
      set.add(subscriber);
      state.subscribers.set(projectId, set);
      return () => set.delete(subscriber);
    },
    recent: (projectId: string) => state.events.filter((row) => row.projectId === projectId),
  };

  const deps = {
    config: makeConfig(options.config),
    repositories,
    eventBus,
    orchestrator,
    sandbox: {
      assertAvailable: async () => undefined,
      getInfo: async () => ({ running: true, previewPort: 9000 }),
    },
    workspaceFor: (projectId: string) => `${options.workspaceRoot}/${projectId}`,
    pingDatabase: async () => undefined,
    ownerIdentity: "owner@autodev.local",
  } as unknown as ApiDeps;

  return { deps, state };
}
