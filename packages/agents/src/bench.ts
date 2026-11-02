import type { AgentRole } from "@autodev/shared";
import type { z } from "zod";

import {
  architectureSchema,
  businessAnalysisSchema,
  deploymentSchema,
  parseJsonResponse,
  qaPlanSchema,
  reviewSchema,
  uxSchema,
  type Architecture,
  type BusinessAnalysis,
  type DeploymentPlan,
  type QaPlan,
  type ReviewResult,
  type UxSpec,
} from "./artifacts.js";
import {
  localArchitecture,
  localBusinessAnalysis,
  localCodeReview,
  localDeployment,
  localQaPlan,
  localUx,
  type ProjectFacts,
  type ReviewInput,
} from "./local-specialists.js";
import { AGENT_PROMPTS } from "./prompts.js";
import { AgentRuntime, type AgentRuntimeOptions } from "./runtime.js";

export type ArtifactSource = "llm" | "local";

export interface ArtifactEnvelope<T> {
  role: Exclude<AgentRole, "manager">;
  artifact: T;
  source: ArtifactSource;
  raw?: string;
  fallbackReason?: string;
}

/**
 * Runs the specialist bench. Every method attempts the LLM when credentials
 * exist, validates the JSON against a schema, and only falls back to the
 * deterministic builder when the LLM is unavailable or invalid. The envelope's
 * `source` always tells the truth about which path produced the artifact.
 */
export class SpecialistBench {
  private readonly runtime: AgentRuntime;

  constructor(options: AgentRuntimeOptions & { allowLocalFallback?: boolean } = {}) {
    this.runtime = new AgentRuntime(options);
    this.allowLocalFallback = options.allowLocalFallback ?? true;
  }

  private readonly allowLocalFallback: boolean;

  private async invoke<T extends z.ZodTypeAny>(
    role: Exclude<AgentRole, "manager">,
    schema: T,
    input: string,
    local: () => z.infer<T>,
  ): Promise<ArtifactEnvelope<z.infer<T>>> {
    if (!this.runtime.isAvailable()) {
      const reason = this.runtime.unavailableReason() ?? "runtime unavailable";
      if (!this.allowLocalFallback) throw new Error(reason);
      return { role, artifact: local(), source: "local", fallbackReason: reason };
    }

    const prompt = AGENT_PROMPTS[role];
    const result = await this.runtime.runAgent({
      name: prompt.name,
      instructions: prompt.instructions,
      input,
      maxTurns: 4,
    });

    try {
      return {
        role,
        artifact: parseJsonResponse(schema, result.text),
        source: "llm",
        raw: result.text,
      };
    } catch (error) {
      if (!this.allowLocalFallback) throw error;
      return {
        role,
        artifact: local(),
        source: "local",
        fallbackReason: `LLM artifact failed validation: ${String(error)}`,
      };
    }
  }

  async businessAnalysis(facts: ProjectFacts): Promise<ArtifactEnvelope<BusinessAnalysis>> {
    return this.invoke("business_analyst", businessAnalysisSchema, inputFor(facts), () =>
      localBusinessAnalysis(facts),
    );
  }

  async architecture(
    facts: ProjectFacts,
    analysis?: BusinessAnalysis,
  ): Promise<ArtifactEnvelope<Architecture>> {
    return this.invoke(
      "solution_architect",
      architectureSchema,
      inputFor(facts, analysis?.brd ? `BRD:\n${analysis.brd}` : ""),
      () => localArchitecture(facts),
    );
  }

  async ux(
    facts: ProjectFacts,
    analysis?: BusinessAnalysis,
    architecture?: Architecture,
  ): Promise<ArtifactEnvelope<UxSpec>> {
    return this.invoke(
      "ui_ux",
      uxSchema,
      inputFor(
        facts,
        [
          analysis?.brd ? `BRD:\n${analysis.brd}` : "",
          architecture?.overview ? `Architecture:\n${architecture.overview}` : "",
        ].join("\n\n"),
      ),
      () => localUx(facts),
    );
  }

  async qa(
    facts: ProjectFacts,
    acceptanceCriteria: string[],
  ): Promise<ArtifactEnvelope<QaPlan>> {
    return this.invoke(
      "qa_automation",
      qaPlanSchema,
      inputFor(
        facts,
        `Acceptance criteria:\n${acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`,
      ),
      () => localQaPlan(acceptanceCriteria),
    );
  }

  async review(input: ReviewInput): Promise<ArtifactEnvelope<ReviewResult>> {
    const fileSummary = input.files
      .map((file) => `### ${file.path}\n\`\`\`\n${file.content.slice(0, 20_000)}\n\`\`\``)
      .join("\n\n");

    return this.invoke(
      "code_review",
      reviewSchema,
      inputFor(
        input.facts,
        [
          `Test summary: ${JSON.stringify(input.testSummary)}`,
          `Files:\n${fileSummary}`,
        ].join("\n\n"),
      ),
      () => localCodeReview(input),
    );
  }

  async deployment(facts: ProjectFacts): Promise<ArtifactEnvelope<DeploymentPlan>> {
    return this.invoke("deployment", deploymentSchema, inputFor(facts), () =>
      localDeployment(facts),
    );
  }
}

function inputFor(facts: ProjectFacts, extra = ""): string {
  return [
    `Application name: ${facts.appName}`,
    `Description: ${facts.description}`,
    `Stack: ${facts.techStack.join(", ") || "unspecified"}`,
    "Requirements:",
    facts.requirements,
    extra,
    "Return only the JSON object described in your instructions.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
