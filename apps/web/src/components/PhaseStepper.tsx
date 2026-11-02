"use client";

import type { Phase } from "@/lib/types";
import { phaseProgress } from "@/lib/progress";
import type { Project, Task } from "@/lib/types";

/**
 * Workflow stepper. Every state comes from persisted task rows, so the
 * dashboard cannot show a phase as done before the orchestrator finished it.
 */
export function PhaseStepper({ project, tasks }: { project: Project; tasks: Task[] }) {
  const steps = phaseProgress(project, tasks);

  return (
    <ol className="stepper" aria-label="Development workflow">
      {steps.map((step, index) => (
        <li
          key={step.phase}
          className="step"
          data-state={step.state}
          data-phase={step.phase}
          title={
            step.tasks.length > 0
              ? `${step.label}: ${step.tasks.length} task(s)`
              : step.label
          }
        >
          <span className="step-index" aria-hidden="true">
            {step.state === "done" ? "✓" : index + 1}
          </span>
          <span className="step-label">{step.label}</span>
          <span className="sr-only">{step.state}</span>
        </li>
      ))}
    </ol>
  );
}

export function currentPhaseLabel(phase: Phase | null, fallback: string): string {
  if (!phase) return fallback;
  return phase;
}
