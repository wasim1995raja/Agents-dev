import type { ApprovalStatus, ProjectStatus, TaskStatus } from "@/lib/types";
import { statusLabel, statusTone, type Tone } from "@/lib/format";

export function Badge({
  tone = "neutral",
  children,
  title,
  small = false,
}: {
  tone?: Tone;
  children: React.ReactNode;
  title?: string;
  small?: boolean;
}) {
  return (
    <span
      className={`badge badge-${tone}${small ? " badge-sm" : ""}`}
      title={title}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: ProjectStatus }) {
  const tone = statusTone(status);
  return (
    <Badge tone={tone}>
      <span className={`dot${status === "running" ? " dot-pulse" : ""}`} aria-hidden="true" />
      {statusLabel(status)}
    </Badge>
  );
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const tone: Tone =
    status === "succeeded"
      ? "positive"
      : status === "failed"
        ? "negative"
        : status === "running"
          ? "active"
          : status === "blocked"
            ? "warning"
            : "neutral";
  return (
    <Badge tone={tone} small>
      {status}
    </Badge>
  );
}

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  const tone: Tone =
    status === "approved"
      ? "positive"
      : status === "rejected"
        ? "negative"
        : status === "pending"
          ? "warning"
          : "neutral";
  return (
    <Badge tone={tone} small>
      {status}
    </Badge>
  );
}

export function ProgressBar({
  value,
  large = false,
  label,
}: {
  value: number;
  large?: boolean;
  label?: string;
}) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div className="progress-row">
      <div
        className={`progress${large ? " progress-lg" : ""}`}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Development progress"}
        style={{ flex: 1 }}
      >
        <span style={{ width: `${clamped}%` }} />
      </div>
      <span className="progress-value">{clamped}%</span>
    </div>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
    </div>
  );
}
