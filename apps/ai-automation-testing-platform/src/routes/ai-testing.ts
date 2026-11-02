import { eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";

import { aiTestingProjects } from "@autodev/db";
import { type DatabaseHandle } from "@autodev/db";
import { badRequest, notFound, parse } from "../http.js";

export const createAiTestingProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(""),
  appUrl: z.string().trim().max(2048).default(""),
});

/**
 * Module 1 – Project Management for the AI Automation Testing Platform.
 *
 * Creates, lists and fetches AI testing projects (application under test +
 * requirements context). Later milestones add execution, test generation and
 * reporting routes on top of these projects.
 */
export function registerAiTestingRoutes(app: FastifyInstance, db: DatabaseHandle): void {
  app.get("/api/ai-testing/v1/projects", async () => {
    const rows = await db.db.select().from(aiTestingProjects);
    return { projects: rows };
  });

  app.post("/api/ai-testing/v1/projects", async (request, reply) => {
    const input = parse(createAiTestingProjectSchema, request.body, "ai testing project body");
    const [row] = await db.db
      .insert(aiTestingProjects)
      .values({
        name: input.name,
        description: input.description,
        appUrl: input.appUrl,
        status: "draft",
      })
      .returning();
    if (!row) throw notFound("AI testing project");
    return reply.status(201).send({ project: row });
  });

  app.get("/api/ai-testing/v1/projects/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await db.db.select().from(aiTestingProjects).where(eq(aiTestingProjects.id, id));
    if (rows.length > 0) {
      return { project: rows[0] };
    }
    const byName = await db.db.select().from(aiTestingProjects).where(eq(aiTestingProjects.name, id));
    if (byName.length > 0) {
      return { project: byName[0] };
    }
    throw notFound("AI testing project");
  });
}
