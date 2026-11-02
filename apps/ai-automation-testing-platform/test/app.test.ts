import { eq } from "drizzle-orm";
import { createDatabase, resolveDatabaseUrl, aiTestingProjects } from "@autodev/db";
import { buildServer } from "../src/app.js";
import { describe, afterAll, beforeAll, expect, it } from "vitest";

describe("AI Automation Testing Platform API", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let database: ReturnType<typeof createDatabase>;

  beforeAll(async () => {
    database = createDatabase(resolveDatabaseUrl(), { max: 2 });
    app = await buildServer({ database });
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it("reports healthy", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("ok");
  });

  it("creates an AI testing project", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ai-testing/v1/projects",
      payload: { name: "Demo storefront", description: "E2E demo", appUrl: "http://127.0.0.1:3000" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().project.name).toBe("Demo storefront");
  });

  it("lists AI testing projects", async () => {
    const response = await app.inject({ method: "GET", url: "/api/ai-testing/v1/projects" });
    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json().projects)).toBe(true);
  });

  it("fetches an AI testing project by id", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/ai-testing/v1/projects",
      payload: { name: "Fetch probe" },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().project.id as string;

    const fetched = await app.inject({ method: "GET", url: `/api/ai-testing/v1/projects/${id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().project.id).toBe(id);
  });

  it("returns 404 for an unknown AI testing project", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/ai-testing/v1/projects/00000000-0000-4000-8000-000000000000",
    });
    expect(response.statusCode).toBe(404);
  });

  it("removes AI testing projects created by the tests", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/ai-testing/v1/projects",
      payload: { name: "Cleanup probe" },
    });
    const id = created.json().project.id as string;
    await database.db.delete(aiTestingProjects).where(eq(aiTestingProjects.id, id));
  });
});
