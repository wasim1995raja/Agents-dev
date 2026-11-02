import { managerPlanSchema, parseJsonResponse, type ManagerPlan } from "./artifacts.js";
import { localManagerPlan, type ProjectFacts } from "./local-specialists.js";
import { MANAGER_PROMPT } from "./prompts.js";
import { AgentRuntime, type AgentRuntimeOptions } from "./runtime.js";

export type PlanSource = "llm" | "local";

export interface ManagerPlanResult {
  plan: ManagerPlan;
  source: PlanSource;
  /** Populated only when an LLM produced the plan. */
  raw?: string;
  /** Populated when the LLM path was attempted and rejected. */
  fallbackReason?: string;
}

/**
 * The Manager Agent is the only entry point to the specialist bench.
 *
 * When credentials exist it asks the model for a plan and validates the answer
 * against `managerPlanSchema`. When it does not, it falls back to a
 * deterministic plan and reports `source: "local"` so callers and the dashboard
 * can show exactly what happened. It never pretends an LLM ran.
 */
export class ManagerAgent {
  private readonly runtime: AgentRuntime;
  private readonly allowLocalFallback: boolean;

  constructor(options: AgentRuntimeOptions & { allowLocalFallback?: boolean } = {}) {
    this.runtime = new AgentRuntime(options);
    this.allowLocalFallback = options.allowLocalFallback ?? true;
  }

  isAvailable(): boolean {
    return this.runtime.isAvailable();
  }

  unavailableReason(): string | null {
    return this.runtime.unavailableReason();
  }

  async plan(facts: ProjectFacts): Promise<ManagerPlanResult> {
    if (!this.runtime.isAvailable()) {
      const reason = this.runtime.unavailableReason() ?? "manager runtime unavailable";
      if (!this.allowLocalFallback) throw new Error(reason);
      return {
        plan: localManagerPlan(facts),
        source: "local",
        fallbackReason: reason,
      };
    }

    const result = await this.runtime.runAgent({
      name: MANAGER_PROMPT.name,
      instructions: MANAGER_PROMPT.instructions,
      input: buildManagerInput(facts),
      maxTurns: 4,
    });

    try {
      const plan = parseJsonResponse(managerPlanSchema, result.text);
      return { plan, source: "llm", raw: result.text };
    } catch (error) {
      if (!this.allowLocalFallback) throw error;
      return {
        plan: localManagerPlan(facts),
        source: "local",
        fallbackReason: `LLM plan failed validation: ${String(error)}`,
      };
    }
  }
}

function buildManagerInput(facts: ProjectFacts): string {
  return [
    `Application name: ${facts.appName}`,
    `Description: ${facts.description}`,
    `Selected stack: ${facts.techStack.join(", ") || "unspecified"}`,
    "Product Owner requirements:",
    facts.requirements,
    "",
    "Return JSON with this shape:",
    JSON.stringify(
      {
        strategy: "string",
        milestones: [
          { title: "string", role: "business_analyst", acceptanceCheck: "string" },
        ],
        risks: ["string"],
      },
      null,
      2,
    ),
  ].join("\n");
}
