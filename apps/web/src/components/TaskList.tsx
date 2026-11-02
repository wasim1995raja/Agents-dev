"use client";

import { PHASES, PHASE_LABELS } from "@autodev/shared/domain";

import { formatDateTime } from "@/lib/format";
import { roleLabel } from "@/lib/format";
import type { Task } from "@/lib/types";
import { EmptyState, TaskStatusBadge } from "./ui";

function duration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt || !finishedAt) return "—";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

/** Task ledger grouped by workflow phase, straight from persisted rows. */
export function TaskList({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return (
      <EmptyState title="No tasks yet">
        The manager agent creates the phase plan when the run starts. Each task is
        persisted before it executes.
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      {PHASES.map((phase) => {
        const phaseTasks = tasks.filter((task) => task.phase === phase);
        if (phaseTasks.length === 0) return null;
        return (
          <section key={phase}>
            <div className="panel-toolbar" style={{ marginBottom: 8 }}>
              <span className="field-label" style={{ margin: 0 }}>
                {PHASE_LABELS[phase]}
              </span>
              <span className="panel-sub">{phaseTasks.length} task(s)</span>
            </div>
            <div className="task-list">
              {phaseTasks.map((task) => (
                <article className="task-row" key={task.id}>
                  <div className="task-top">
                    <span className="task-title">{task.title}</span>
                    <TaskStatusBadge status={task.status} />
                  </div>
                  <div className="task-meta">
                    <span>{roleLabel(task.role)}</span>
                    <span>attempt {task.attempt}</span>
                    <span>{duration(task.startedAt, task.finishedAt)}</span>
                    {task.startedAt ? <span>started {formatDateTime(task.startedAt)}</span> : null}
                  </div>
                  {task.error ? <pre className="task-error">{task.error}</pre> : null}
                  {task.output && Object.keys(task.output).length > 0 ? (
                    <details className="test-failures">
                      <summary>Task output</summary>
                      <pre className="mt-8">{JSON.stringify(task.output, null, 2)}</pre>
                    </details>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
