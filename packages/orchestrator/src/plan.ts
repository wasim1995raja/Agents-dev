import type { AgentRole, Phase } from "@autodev/shared";

/**
 * The executable order of work. `DEFAULT_PHASE_PLAN` in `@autodev/shared` is the
 * display plan (implementation is split into frontend/backend for the UI); this
 * list is what the orchestrator actually persists and walks. The `key` maps to a
 * handler and is stored on each task so a resumed run knows what to execute.
 */
export interface OrchestrationStep {
  key: OrchestrationStepKey;
  phase: Phase;
  role: AgentRole;
  title: string;
}

export const ORCHESTRATION_STEP_KEYS = [
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
export type OrchestrationStepKey = (typeof ORCHESTRATION_STEP_KEYS)[number];

export const ORCHESTRATION_STEPS: OrchestrationStep[] = [
  {
    key: "intake",
    phase: "intake",
    role: "manager",
    title: "Analyse requirements and produce the delivery plan",
  },
  {
    key: "brd",
    phase: "brd",
    role: "business_analyst",
    title: "Write BRD, user stories and acceptance criteria",
  },
  {
    key: "architecture",
    phase: "architecture",
    role: "solution_architect",
    title: "Design system architecture, data model and API",
  },
  {
    key: "ux",
    phase: "ux",
    role: "ui_ux",
    title: "Define screens, navigation and accessibility requirements",
  },
  {
    key: "implementation",
    phase: "implementation",
    role: "frontend_developer",
    title: "Implement the application in the project workspace",
  },
  {
    key: "testing",
    phase: "testing",
    role: "qa_automation",
    title: "Generate and run Playwright end-to-end tests",
  },
  {
    key: "review",
    phase: "review",
    role: "code_review",
    title: "Review code quality, tests and security",
  },
  {
    key: "deployment",
    phase: "deployment",
    role: "deployment",
    title: "Prepare containerised deployment artifacts",
  },
  {
    key: "approval",
    phase: "approval",
    role: "manager",
    title: "Request owner approval for production deployment",
  },
];

/** Weight of each step when computing progress; the approval gate is heaviest. */
export const STEP_PROGRESS_WEIGHT: Record<OrchestrationStepKey, number> = {
  intake: 5,
  brd: 10,
  architecture: 10,
  ux: 10,
  implementation: 25,
  testing: 15,
  review: 10,
  deployment: 10,
  approval: 5,
};

export function stepKeyFromTaskInput(input: unknown): OrchestrationStepKey | null {
  if (!input || typeof input !== "object") return null;
  const key = (input as { key?: unknown }).key;
  return typeof key === "string" && (ORCHESTRATION_STEP_KEYS as readonly string[]).includes(key)
    ? (key as OrchestrationStepKey)
    : null;
}
