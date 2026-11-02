import { and, desc, eq, lt } from "drizzle-orm";

import type { ActivityEvent, ActivityEventType, EventLevel } from "@autodev/shared";

import type { Database } from "../client.js";
import { activityEvents } from "../schema.js";

export interface AppendEventInput {
  projectId: string;
  type: ActivityEventType;
  level?: EventLevel;
  message: string;
  payload?: Record<string, unknown>;
}

export function toActivityEvent(row: typeof activityEvents.$inferSelect): ActivityEvent {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type as ActivityEventType,
    level: row.level,
    message: row.message,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
}

export class EventsRepository {
  constructor(private readonly db: Database) {}

  async append(input: AppendEventInput): Promise<ActivityEvent> {
    const [row] = await this.db
      .insert(activityEvents)
      .values({
        projectId: input.projectId,
        type: input.type,
        level: input.level ?? "info",
        message: input.message,
        payload: input.payload ?? {},
      })
      .returning();
    if (!row) throw new Error("Failed to append activity event");
    return toActivityEvent(row);
  }

  async list(
    projectId: string,
    options: { limit: number; before?: Date } = { limit: 200 },
  ): Promise<ActivityEvent[]> {
    const conditions = [eq(activityEvents.projectId, projectId)];
    if (options.before) conditions.push(lt(activityEvents.createdAt, options.before));

    const rows = await this.db
      .select()
      .from(activityEvents)
      .where(and(...conditions))
      .orderBy(desc(activityEvents.createdAt))
      .limit(options.limit);

    return rows.reverse().map(toActivityEvent);
  }
}
