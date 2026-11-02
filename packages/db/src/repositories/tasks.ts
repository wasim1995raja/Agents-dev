import { and, asc, eq, inArray } from "drizzle-orm";

import type { AgentRole, Phase, TaskStatus } from "@autodev/shared";

import type { Database } from "../client.js";
import { agentTasks } from "../schema.js";

export type TaskRecord = typeof agentTasks.$inferSelect;

export interface NewTaskRecord {
  phase: Phase;
  role: AgentRole;
  title: string;
  orderIndex: number;
  input?: Record<string, unknown>;
}

export class TasksRepository {
  constructor(private readonly db: Database) {}

  async createMany(projectId: string, tasks: NewTaskRecord[]): Promise<TaskRecord[]> {
    if (tasks.length === 0) return [];
    return this.db
      .insert(agentTasks)
      .values(tasks.map((task) => ({ ...task, projectId })))
      .returning();
  }

  async listByProject(projectId: string): Promise<TaskRecord[]> {
    return this.db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.projectId, projectId))
      .orderBy(asc(agentTasks.orderIndex));
  }

  async findById(taskId: string): Promise<TaskRecord | null> {
    const [row] = await this.db.select().from(agentTasks).where(eq(agentTasks.id, taskId)).limit(1);
    return row ?? null;
  }

  async firstPending(projectId: string): Promise<TaskRecord | null> {
    const [row] = await this.db
      .select()
      .from(agentTasks)
      .where(and(eq(agentTasks.projectId, projectId), eq(agentTasks.status, "pending")))
      .orderBy(asc(agentTasks.orderIndex))
      .limit(1);
    return row ?? null;
  }

  async setStatus(
    taskId: string,
    status: TaskStatus,
    extra: Partial<typeof agentTasks.$inferInsert> = {},
  ): Promise<TaskRecord> {
    const [row] = await this.db
      .update(agentTasks)
      .set({ status, ...extra })
      .where(eq(agentTasks.id, taskId))
      .returning();
    if (!row) throw new Error(`Task ${taskId} not found`);
    return row;
  }

  async markRunning(taskId: string): Promise<TaskRecord> {
    return this.setStatus(taskId, "running", { startedAt: new Date(), error: null });
  }

  async markSucceeded(
    taskId: string,
    output: Record<string, unknown>,
  ): Promise<TaskRecord> {
    return this.setStatus(taskId, "succeeded", { output, finishedAt: new Date(), error: null });
  }

  async markFailed(taskId: string, error: string): Promise<TaskRecord> {
    return this.setStatus(taskId, "failed", { error, finishedAt: new Date() });
  }

  /** Re-open failed tasks for a bounded repair iteration. */
  async reopenFailed(projectId: string): Promise<TaskRecord[]> {
    const failed = await this.db
      .select()
      .from(agentTasks)
      .where(and(eq(agentTasks.projectId, projectId), eq(agentTasks.status, "failed")));

    if (failed.length === 0) return [];

    return this.db
      .update(agentTasks)
      .set({ status: "pending", error: null, finishedAt: null })
      .where(
        inArray(
          agentTasks.id,
          failed.map((task) => task.id),
        ),
      )
      .returning();
  }

  async countByStatus(projectId: string): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ status: agentTasks.status })
      .from(agentTasks)
      .where(eq(agentTasks.projectId, projectId));
    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});
  }
}
