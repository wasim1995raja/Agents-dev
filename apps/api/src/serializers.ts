import type { ActivityEvent } from "@autodev/shared";
import type {
  ApprovalRecord,
  DeploymentRecord,
  ExecutionRecord,
  ProjectRecord,
  RequirementsRecord,
  TaskRecord,
  TestResultRecord,
} from "./types.js";

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/**
 * Wire shapes are explicit rather than `JSON.stringify(row)` so the API never
 * leaks host paths (`workspace_path`), container ids or other internals.
 */
export interface ProjectDto {
  id: string;
  name: string;
  description: string;
  requirements: string;
  techStack: string[];
  status: ProjectRecord["status"];
  phase: ProjectRecord["phase"];
  engine: ProjectRecord["engine"];
  progress: number;
  error: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export function projectDto(row: ProjectRecord, active: boolean): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    requirements: row.requirements,
    techStack: row.techStack,
    status: row.status,
    phase: row.phase,
    engine: row.engine,
    progress: row.progress,
    error: row.error,
    active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
  };
}

export interface TaskDto {
  id: string;
  phase: TaskRecord["phase"];
  role: TaskRecord["role"];
  title: string;
  status: TaskRecord["status"];
  orderIndex: number;
  attempt: number;
  output: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export function taskDto(row: TaskRecord): TaskDto {
  return {
    id: row.id,
    phase: row.phase,
    role: row.role,
    title: row.title,
    status: row.status,
    orderIndex: row.orderIndex,
    attempt: row.attempt,
    output: row.output ?? null,
    error: row.error,
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
  };
}

export interface TestDto {
  id: string;
  suite: string;
  status: TestResultRecord["status"];
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failures: unknown[];
  output: string | null;
  createdAt: string;
}

export function testDto(row: TestResultRecord): TestDto {
  const report = (row.report ?? {}) as {
    failures?: unknown[];
    output?: string | null;
  };
  return {
    id: row.id,
    suite: row.suite,
    status: row.status,
    total: row.total,
    passed: row.passed,
    failed: row.failed,
    skipped: row.skipped,
    durationMs: row.durationMs,
    failures: Array.isArray(report.failures) ? report.failures : [],
    output: typeof report.output === "string" ? report.output : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ApprovalDto {
  id: string;
  projectId: string;
  type: ApprovalRecord["type"];
  status: ApprovalRecord["status"];
  title: string;
  payload: Record<string, unknown>;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  note: string | null;
}

export function approvalDto(row: ApprovalRecord): ApprovalDto {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    status: row.status,
    title: row.title,
    payload: row.payload,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: iso(row.decidedAt),
    decidedBy: row.decidedBy,
    note: row.note,
  };
}

export interface DeploymentDto {
  id: string;
  version: string;
  status: DeploymentRecord["status"];
  image: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export function deploymentDto(row: DeploymentRecord): DeploymentDto {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    image: row.image,
    details: row.details,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ExecutionDto {
  id: string;
  agentName: string;
  engine: ExecutionRecord["engine"];
  model: string | null;
  status: ExecutionRecord["status"];
  durationMs: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export function executionDto(row: ExecutionRecord): ExecutionDto {
  return {
    id: row.id,
    agentName: row.agentName,
    engine: row.engine,
    model: row.model,
    status: row.status,
    durationMs: row.durationMs,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    finishedAt: iso(row.finishedAt),
  };
}

export interface RequirementsDto {
  brd: string | null;
  userStories: unknown[];
  acceptanceCriteria: unknown[];
  createdAt: string;
}

export function requirementsDto(row: RequirementsRecord): RequirementsDto {
  return {
    brd: row.brd,
    userStories: row.userStories,
    acceptanceCriteria: row.acceptanceCriteria,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface FileDto {
  path: string;
  sha256: string;
  sizeBytes: number;
  language: string | null;
}

export function eventDto(event: ActivityEvent): ActivityEvent {
  return event;
}
