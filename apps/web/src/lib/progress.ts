import { PHASES, PHASE_LABELS, type Phase } from "@autodev/shared/domain";

import type { Project, Task } from "./types";

export type PhaseState = "pending" | "active" | "done" | "failed";

export interface PhaseProgress {
  phase: Phase;
  label: string;
  state: PhaseState;
  tasks: Task[];
}

/**
 * Derives the workflow stepper from persisted task rows rather than from a
 * client-side guess. A completed project always renders every phase as done;
 * otherwise failed and running tasks win, and the project's current phase marks
 * the active step.
 */
export function phaseProgress(project: Project, tasks: Task[]): PhaseProgress[] {
  const currentIndex = project.phase ? PHASES.indexOf(project.phase) : -1;

  return PHASES.map((phase, index) => {
    const phaseTasks = tasks.filter((task) => task.phase === phase);
    let state: PhaseState;

    if (project.status === "completed") {
      state = "done";
    } else if (phaseTasks.some((task) => task.status === "failed")) {
      state = "failed";
    } else if (phaseTasks.some((task) => task.status === "running")) {
      state = "active";
    } else if (
      phaseTasks.length > 0 &&
      phaseTasks.every((task) => task.status === "succeeded" || task.status === "skipped")
    ) {
      state = "done";
    } else if (phase === "intake") {
      state = project.startedAt
        ? "done"
        : project.status === "running"
          ? "active"
          : "pending";
    } else if (project.phase === phase) {
      state = project.status === "failed" ? "failed" : "active";
    } else if (currentIndex >= 0 && index < currentIndex) {
      state = "done";
    } else {
      state = "pending";
    }

    return { phase, label: PHASE_LABELS[phase], state, tasks: phaseTasks };
  });
}

export interface TaskSummary {
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  pending: number;
}

export function summarizeTasks(tasks: Task[]): TaskSummary {
  return {
    total: tasks.length,
    succeeded: tasks.filter((task) => task.status === "succeeded").length,
    failed: tasks.filter((task) => task.status === "failed").length,
    running: tasks.filter((task) => task.status === "running").length,
    pending: tasks.filter((task) => task.status === "pending").length,
  };
}
