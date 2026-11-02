/**
 * Core domain vocabulary shared by every package.
 * Keep this file dependency-free so it can be imported anywhere.
 */

export const PROJECT_STATUSES = [
  "draft",
  "queued",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Ordered workflow phases. The orchestrator walks this list. */
export const PHASES = [
  "intake",
  "brd",
  "architecture",
  "ux",
  "implementation",
  "testing",
  "review",
  "deployment",
  "approval",
] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_LABELS: Record<Phase, string> = {
  intake: "Requirement analysis",
  brd: "Business requirements",
  architecture: "Solution architecture",
  ux: "UI/UX design",
  implementation: "Implementation",
  testing: "QA automation",
  review: "Code review",
  deployment: "Deployment prep",
  approval: "Owner approval",
};

export const TASK_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "blocked",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const AGENT_ROLES = [
  "manager",
  "business_analyst",
  "solution_architect",
  "ui_ux",
  "frontend_developer",
  "backend_developer",
  "qa_automation",
  "code_review",
  "deployment",
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const CHAT_ROLES = ["user", "assistant", "system", "tool"] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

export const ENGINE_NAMES = ["codex", "openai-agents", "scaffold"] as const;
export type EngineName = (typeof ENGINE_NAMES)[number];

export const APPROVAL_TYPES = [
  "dependency_install",
  "destructive_command",
  "production_deployment",
] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const EVENT_LEVELS = ["debug", "info", "warn", "error"] as const;
export type EventLevel = (typeof EVENT_LEVELS)[number];

/**
 * Event types emitted by the orchestrator and pushed to the dashboard over SSE.
 * `project.*` events drive status pills, `log` drives the terminal panel.
 *
 * Kept as a runtime list as well as a union so the dashboard can register one
 * SSE listener per named event without duplicating the vocabulary.
 */
export const ACTIVITY_EVENT_TYPES = [
  "project.created",
  "project.started",
  "project.completed",
  "project.failed",
  "project.cancelled",
  "phase.started",
  "phase.completed",
  "task.started",
  "task.completed",
  "task.failed",
  "agent.message",
  "tool.call",
  "file.written",
  "command.started",
  "command.output",
  "command.completed",
  "test.started",
  "test.completed",
  "approval.requested",
  "approval.decided",
  "checkpoint.created",
  "log",
] as const;
export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

export interface ActivityEvent {
  id: string;
  projectId: string;
  type: ActivityEventType;
  level: EventLevel;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** Ordered hand-off between specialist agents. */
export interface PhasePlanItem {
  phase: Phase;
  role: AgentRole;
  title: string;
}

export const DEFAULT_PHASE_PLAN: PhasePlanItem[] = [
  { phase: "brd", role: "business_analyst", title: "Write BRD, user stories and acceptance criteria" },
  { phase: "architecture", role: "solution_architect", title: "Design system architecture, schema and API spec" },
  { phase: "ux", role: "ui_ux", title: "Define screens, navigation and responsive layouts" },
  { phase: "implementation", role: "frontend_developer", title: "Implement frontend application" },
  { phase: "implementation", role: "backend_developer", title: "Implement backend API and data models" },
  { phase: "testing", role: "qa_automation", title: "Generate and run Playwright tests" },
  { phase: "review", role: "code_review", title: "Review code quality and security" },
  { phase: "deployment", role: "deployment", title: "Prepare containerised deployment artifacts" },
  { phase: "approval", role: "manager", title: "Request owner approval" },
];
