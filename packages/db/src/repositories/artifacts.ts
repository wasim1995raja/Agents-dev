import { desc, eq } from "drizzle-orm";

import type { ApprovalStatus, ApprovalType, EngineName, TaskStatus } from "@autodev/shared";

import type { Database } from "../client.js";
import {
  agentExecutions,
  approvalRequests,
  deploymentHistory,
  generatedFiles,
  testResults,
} from "../schema.js";

export type GeneratedFileRecord = typeof generatedFiles.$inferSelect;
export type TestResultRecord = typeof testResults.$inferSelect;
export type ApprovalRecord = typeof approvalRequests.$inferSelect;
export type DeploymentRecord = typeof deploymentHistory.$inferSelect;
export type ExecutionRecord = typeof agentExecutions.$inferSelect;

export interface UpsertFileInput {
  projectId: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  language?: string | null;
}

export interface RecordTestInput {
  projectId: string;
  taskId?: string | null;
  suite: string;
  status: "passed" | "failed" | "error";
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  report?: Record<string, unknown> | null;
  artifacts?: string[];
}

export interface RecordExecutionInput {
  projectId: string;
  taskId?: string | null;
  agentName: string;
  engine: EngineName;
  model?: string | null;
  prompt?: string | null;
}

export class ArtifactsRepository {
  constructor(private readonly db: Database) {}

  async upsertFile(input: UpsertFileInput): Promise<GeneratedFileRecord> {
    const [row] = await this.db
      .insert(generatedFiles)
      .values(input)
      .onConflictDoUpdate({
        target: [generatedFiles.projectId, generatedFiles.path],
        set: { sha256: input.sha256, sizeBytes: input.sizeBytes, language: input.language },
      })
      .returning();
    if (!row) throw new Error("Failed to persist generated file");
    return row;
  }

  async listFiles(projectId: string): Promise<GeneratedFileRecord[]> {
    return this.db
      .select()
      .from(generatedFiles)
      .where(eq(generatedFiles.projectId, projectId))
      .orderBy(generatedFiles.path);
  }

  async recordTest(input: RecordTestInput): Promise<TestResultRecord> {
    // Playwright reports fractional milliseconds; the column is an integer and
    // Postgres rejects "1746.44", so normalise every numeric field here.
    const integer = (value: number): number =>
      Number.isFinite(value) && value > 0 ? Math.round(value) : 0;

    const [row] = await this.db
      .insert(testResults)
      .values({
        ...input,
        total: integer(input.total),
        passed: integer(input.passed),
        failed: integer(input.failed),
        skipped: integer(input.skipped),
        durationMs: integer(input.durationMs),
      })
      .returning();
    if (!row) throw new Error("Failed to persist test result");
    return row;
  }

  async listTests(projectId: string): Promise<TestResultRecord[]> {
    return this.db
      .select()
      .from(testResults)
      .where(eq(testResults.projectId, projectId))
      .orderBy(desc(testResults.createdAt))
      .limit(50);
  }

  async createApproval(input: {
    projectId: string;
    type: ApprovalType;
    title: string;
    payload?: Record<string, unknown>;
  }): Promise<ApprovalRecord> {
    const [row] = await this.db.insert(approvalRequests).values(input).returning();
    if (!row) throw new Error("Failed to create approval request");
    return row;
  }

  async findApproval(id: string): Promise<ApprovalRecord | null> {
    const [row] = await this.db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, id))
      .limit(1);
    return row ?? null;
  }

  async decideApproval(
    id: string,
    decision: ApprovalStatus,
    decidedBy: string,
    note?: string,
  ): Promise<ApprovalRecord> {
    const [row] = await this.db
      .update(approvalRequests)
      .set({ status: decision, decidedAt: new Date(), decidedBy, note })
      .where(eq(approvalRequests.id, id))
      .returning();
    if (!row) throw new Error(`Approval ${id} not found`);
    return row;
  }

  async listApprovals(projectId: string): Promise<ApprovalRecord[]> {
    return this.db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.projectId, projectId))
      .orderBy(desc(approvalRequests.requestedAt));
  }

  async createDeployment(input: {
    projectId: string;
    version: string;
    status: "prepared" | "building" | "built" | "failed";
    image?: string | null;
    details?: Record<string, unknown>;
  }): Promise<DeploymentRecord> {
    const [row] = await this.db.insert(deploymentHistory).values(input).returning();
    if (!row) throw new Error("Failed to record deployment");
    return row;
  }

  async listDeployments(projectId: string): Promise<DeploymentRecord[]> {
    return this.db
      .select()
      .from(deploymentHistory)
      .where(eq(deploymentHistory.projectId, projectId))
      .orderBy(desc(deploymentHistory.createdAt));
  }

  async startExecution(input: RecordExecutionInput): Promise<ExecutionRecord> {
    const [row] = await this.db
      .insert(agentExecutions)
      .values({ ...input, status: "running" })
      .returning();
    if (!row) throw new Error("Failed to start execution record");
    return row;
  }

  async finishExecution(
    id: string,
    patch: {
      status: TaskStatus;
      response?: string | null;
      toolCalls?: unknown[];
      tokensIn?: number | null;
      tokensOut?: number | null;
      error?: string | null;
      durationMs?: number;
    },
  ): Promise<void> {
    await this.db
      .update(agentExecutions)
      .set({ ...patch, finishedAt: new Date() })
      .where(eq(agentExecutions.id, id));
  }

  async listExecutions(projectId: string): Promise<ExecutionRecord[]> {
    return this.db
      .select()
      .from(agentExecutions)
      .where(eq(agentExecutions.projectId, projectId))
      .orderBy(desc(agentExecutions.startedAt))
      .limit(100);
  }
}
