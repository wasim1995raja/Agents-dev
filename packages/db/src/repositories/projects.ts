import { and, desc, eq, lt } from "drizzle-orm";

import type { Phase, ProjectStatus } from "@autodev/shared";

import type { Database } from "../client.js";
import { projects } from "../schema.js";

export interface CreateProjectRecord {
  /** Optional caller-supplied id so the workspace path can be resolved first. */
  id?: string;
  name: string;
  description: string;
  requirements: string;
  techStack: string[];
  engine: "codex" | "openai-agents" | "scaffold";
  workspacePath: string;
}

export type ProjectRecord = typeof projects.$inferSelect;

export class ProjectsRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateProjectRecord): Promise<ProjectRecord> {
    const [row] = await this.db.insert(projects).values(input).returning();
    if (!row) throw new Error("Failed to create project");
    return row;
  }

  async findById(id: string): Promise<ProjectRecord | null> {
    const [row] = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return row ?? null;
  }

  async list(options: { limit: number; before?: Date }): Promise<ProjectRecord[]> {
    const where = options.before ? lt(projects.createdAt, options.before) : undefined;
    return this.db
      .select()
      .from(projects)
      .where(where)
      .orderBy(desc(projects.createdAt))
      .limit(options.limit);
  }

  async update(id: string, patch: Partial<typeof projects.$inferInsert>): Promise<ProjectRecord> {
    const [row] = await this.db
      .update(projects)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    if (!row) throw new Error(`Project ${id} not found`);
    return row;
  }

  async setStatus(
    id: string,
    status: ProjectStatus,
    extra: Partial<typeof projects.$inferInsert> = {},
  ): Promise<ProjectRecord> {
    return this.update(id, { status, ...extra });
  }

  async setPhase(id: string, phase: Phase | null): Promise<void> {
    await this.update(id, { phase });
  }

  async setProgress(id: string, progress: number): Promise<void> {
    await this.update(id, { progress: Math.max(0, Math.min(100, Math.round(progress))) });
  }

  async findRunning(): Promise<ProjectRecord[]> {
    return this.db
      .select()
      .from(projects)
      .where(and(eq(projects.status, "running")))
      .orderBy(desc(projects.createdAt));
  }

  /** Removes the project row; related rows cascade. The workspace is untouched. */
  async delete(id: string): Promise<void> {
    const deleted = await this.db.delete(projects).where(eq(projects.id, id)).returning();
    if (deleted.length === 0) throw new Error(`Project ${id} not found`);
  }
}
