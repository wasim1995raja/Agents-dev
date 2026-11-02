import { z } from "zod";

import { AGENT_ROLES, ENGINE_NAMES, PROJECT_STATUSES } from "./domain.js";
import { TECH_STACK_OPTIONS } from "./options.js";

export { TECH_STACK_OPTIONS, type TechStackOption } from "./options.js";

const techStackSchema = z
  .array(z.enum(TECH_STACK_OPTIONS))
  .min(1)
  .max(TECH_STACK_OPTIONS.length);

export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(10).max(2000),
  requirements: z.string().trim().min(20).max(20000),
  techStack: techStackSchema.optional(),
  engine: z.enum(ENGINE_NAMES).optional(),
  autoStart: z.boolean().optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const projectIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const taskIdParamsSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
});

export const listProjectsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().datetime().optional(),
});

export const startProjectSchema = z.object({
  engine: z.enum(ENGINE_NAMES).optional(),
});

export const runTaskSchema = z.object({
  role: z.enum(AGENT_ROLES).optional(),
  instruction: z.string().trim().max(5000).optional(),
});

export const approvalDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(1000).optional(),
});

export const writeFileSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(400)
    .refine((p) => !p.startsWith("/") && !p.includes(".."), "path must stay inside the workspace"),
  content: z.string().max(2_000_000),
});

export const runCommandSchema = z.object({
  command: z.string().trim().min(1).max(2000),
  cwd: z.string().max(400).optional(),
  timeoutMs: z.number().int().min(1_000).max(900_000).optional(),
});

export const agentMessageSchema = z.object({
  message: z.string().trim().min(1).max(10000),
});

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  status: (typeof PROJECT_STATUSES)[number];
  engine: (typeof ENGINE_NAMES)[number];
  techStack: string[];
  progress: number;
  createdAt: string;
  updatedAt: string;
}
