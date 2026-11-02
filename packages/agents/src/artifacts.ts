import { z } from "zod";

export const userStorySchema = z.object({
  id: z.string(),
  asA: z.string(),
  iWant: z.string(),
  soThat: z.string(),
  acceptanceCriteria: z.array(z.string()).default([]),
});

export const businessAnalysisSchema = z.object({
  brd: z.string(),
  userStories: z.array(userStorySchema).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});
export type BusinessAnalysis = z.infer<typeof businessAnalysisSchema>;

export const architectureSchema = z.object({
  overview: z.string(),
  components: z
    .array(z.object({ name: z.string(), responsibility: z.string(), technology: z.string() }))
    .default([]),
  dataModel: z
    .array(z.object({ table: z.string(), columns: z.array(z.string()) }))
    .default([]),
  api: z
    .array(z.object({ method: z.string(), path: z.string(), purpose: z.string() }))
    .default([]),
  decisions: z.array(z.object({ decision: z.string(), rationale: z.string() })).default([]),
  risks: z.array(z.string()).default([]),
});
export type Architecture = z.infer<typeof architectureSchema>;

export const uxSchema = z.object({
  ux: z.string(),
  screens: z
    .array(
      z.object({
        name: z.string(),
        route: z.string(),
        purpose: z.string(),
        components: z.array(z.string()).default([]),
        states: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  navigation: z.array(z.string()).default([]),
  designTokens: z
    .object({
      color: z.array(z.string()).default([]),
      spacing: z.array(z.string()).default([]),
      typography: z.array(z.string()).default([]),
    })
    .default({ color: [], spacing: [], typography: [] }),
  accessibility: z.array(z.string()).default([]),
});
export type UxSpec = z.infer<typeof uxSchema>;

export const qaPlanSchema = z.object({
  scenarios: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        steps: z.array(z.string()).default([]),
        expected: z.string(),
      }),
    )
    .default([]),
  notes: z.string().default(""),
});
export type QaPlan = z.infer<typeof qaPlanSchema>;

export const reviewSchema = z.object({
  verdict: z.enum(["pass", "changes_requested"]),
  summary: z.string(),
  issues: z
    .array(
      z.object({
        severity: z.enum(["critical", "high", "medium", "low"]),
        file: z.string().nullable().optional(),
        issue: z.string(),
        recommendation: z.string(),
      }),
    )
    .default([]),
});
export type ReviewResult = z.infer<typeof reviewSchema>;

export const deploymentSchema = z.object({
  dockerfile: z.string().default(""),
  compose: z.string().default(""),
  envVars: z
    .array(z.object({ name: z.string(), required: z.boolean().default(false), description: z.string() }))
    .default([]),
  healthcheck: z.string().default(""),
  notes: z.string().default(""),
  readyForProduction: z.boolean().default(false),
});
export type DeploymentPlan = z.infer<typeof deploymentSchema>;

export const managerPlanSchema = z.object({
  strategy: z.string(),
  milestones: z
    .array(
      z.object({
        title: z.string(),
        role: z.enum([
          "business_analyst",
          "solution_architect",
          "ui_ux",
          "frontend_developer",
          "backend_developer",
          "qa_automation",
          "code_review",
          "deployment",
        ]),
        acceptanceCheck: z.string(),
      }),
    )
    .default([]),
  risks: z.array(z.string()).default([]),
});
export type ManagerPlan = z.infer<typeof managerPlanSchema>;

/** Extracts JSON from a model response that may include markdown fences. */
export function parseJsonResponse<S extends z.ZodTypeAny>(schema: S, raw: string): z.infer<S> {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    throw new Error(`Model response was not valid JSON: ${String(error)}`);
  }
  return schema.parse(parsed);
}
