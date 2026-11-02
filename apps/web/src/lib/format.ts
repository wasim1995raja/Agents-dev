import type {
  ActivityEvent,
  ApprovalStatus,
  EventLevel,
  ProjectStatus,
  TaskStatus,
} from "./types";

export type Tone = "positive" | "negative" | "warning" | "info" | "neutral" | "active";

const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "Draft",
  queued: "Queued",
  running: "Running",
  awaiting_approval: "Awaiting approval",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function statusLabel(status: ProjectStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function statusTone(status: ProjectStatus): Tone {
  switch (status) {
    case "completed":
      return "positive";
    case "failed":
      return "negative";
    case "cancelled":
      return "neutral";
    case "running":
      return "active";
    case "awaiting_approval":
      return "warning";
    case "queued":
      return "info";
    default:
      return "neutral";
  }
}

export function taskTone(status: TaskStatus): Tone {
  switch (status) {
    case "succeeded":
      return "positive";
    case "failed":
      return "negative";
    case "running":
      return "active";
    case "blocked":
      return "warning";
    case "skipped":
      return "neutral";
    default:
      return "neutral";
  }
}

export function approvalTone(status: ApprovalStatus): Tone {
  switch (status) {
    case "approved":
      return "positive";
    case "rejected":
      return "negative";
    case "pending":
      return "warning";
    default:
      return "neutral";
  }
}

export function levelTone(level: EventLevel): Tone {
  switch (level) {
    case "error":
      return "negative";
    case "warn":
      return "warning";
    case "debug":
      return "neutral";
    default:
      return "info";
  }
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

/** Short, stable relative time for the live activity feed. */
export function relativeTime(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  const deltaSeconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (deltaSeconds < 5) return "just now";
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDateTime(iso);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

export function formatPercent(value: number): string {
  return `${Math.min(100, Math.max(0, Math.round(value)))}%`;
}

const ROLE_LABELS: Record<string, string> = {
  manager: "Manager",
  business_analyst: "Business analyst",
  solution_architect: "Solution architect",
  ui_ux: "UI/UX designer",
  frontend_developer: "Frontend developer",
  backend_developer: "Backend developer",
  qa_automation: "QA automation",
  code_review: "Code reviewer",
  deployment: "Deployment",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ");
}

const APPROVAL_LABELS: Record<string, string> = {
  dependency_install: "Dependency install",
  destructive_command: "Destructive command",
  production_deployment: "Production deployment",
};

export function approvalTypeLabel(type: string): string {
  return APPROVAL_LABELS[type] ?? type.replace(/_/g, " ");
}

export function testStatusTone(status: string): Tone {
  if (status === "passed") return "positive";
  if (status === "failed") return "warning";
  if (status === "error") return "negative";
  return "neutral";
}

/** Renders unknown JSON payload values compactly for the activity feed. */
export function summarizePayload(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "object") continue;
    if (key === "approvalId" || key === "taskId" || key === "projectId") continue;
    parts.push(`${key}: ${String(value)}`);
  }
  return parts.join(" · ");
}

export function eventLabel(event: ActivityEvent): string {
  return event.type.replace(/\./g, " ");
}

/** Normalizes any thrown value into a displayable message. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------- SMS labels

const SMS_AUTHORIZATION_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  resubmitted: "Resubmitted",
};

export function smsAuthorizationStatusLabel(status: string): string {
  return SMS_AUTHORIZATION_STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

export function smsAuthorizationStatusTone(status: string): Tone {
  switch (status) {
    case "approved":
      return "positive";
    case "rejected":
      return "negative";
    case "pending_approval":
      return "warning";
    case "resubmitted":
      return "info";
    default:
      return "neutral";
  }
}

const SMS_OPERATION_LABELS: Record<string, string> = {
  add: "Add",
  edit: "Edit",
  delete: "Delete",
};

export function smsOperationLabel(operation: string): string {
  return SMS_OPERATION_LABELS[operation] ?? operation;
}

export function smsUserStatusTone(status: string): Tone {
  return status === "active" ? "positive" : "neutral";
}

/** Renders an SMS table name (`sms_students`) as a readable module label. */
export function smsTableLabel(tableName: string): string {
  const stripped = tableName.replace(/^sms_/, "").replace(/_/g, " ");
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}
