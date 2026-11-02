import { desc, eq } from "drizzle-orm";

import type { Database } from "../client.js";
import { requirements } from "../schema.js";

export type RequirementsRecord = typeof requirements.$inferSelect;

export class RequirementsRepository {
  constructor(private readonly db: Database) {}

  async save(input: {
    projectId: string;
    brd: string;
    userStories: unknown[];
    acceptanceCriteria: unknown[];
  }): Promise<RequirementsRecord> {
    const [row] = await this.db.insert(requirements).values(input).returning();
    if (!row) throw new Error("Failed to save requirements");
    return row;
  }

  async latest(projectId: string): Promise<RequirementsRecord | null> {
    const [row] = await this.db
      .select()
      .from(requirements)
      .where(eq(requirements.projectId, projectId))
      .orderBy(desc(requirements.createdAt))
      .limit(1);
    return row ?? null;
  }
}
