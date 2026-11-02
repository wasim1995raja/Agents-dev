import { expect, test } from "@playwright/test";

/**
 * End-to-end dashboard check against the real stack:
 * Postgres + Fastify API + Docker sandbox + orchestrator + Next.js dashboard.
 *
 * Nothing is mocked. The test fails if the run does not produce generated files,
 * a passing Playwright suite, git checkpoints and a completed project.
 */
test("owner creates a project, approves the gate and inspects verified artifacts", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  const name = `E2E Field Ops ${stamp}`;
  const description = "Dispatch jobs, track technicians and capture completion notes.";
  const requirements = [
    "A dispatcher creates jobs with a title, location and priority.",
    "Technicians claim jobs, mark them in progress and complete them with notes.",
    "The dashboard lists today's jobs and highlights overdue work.",
    "Only a dispatcher can create or reassign a job.",
  ].join(" ");

  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "From an idea to a tested, reviewed application",
  );
  await expect(page.getByRole("heading", { name: "Create new project" })).toBeVisible();

  await page.getByLabel("Project name").fill(name);
  await page.getByLabel("One-line description").fill(description);
  await page.getByLabel("Application requirements").fill(requirements);
  await page.getByLabel("Coding engine").selectOption("scaffold");
  await expect(page.getByLabel("Start development immediately")).toBeChecked();

  await page.getByRole("button", { name: "Create project" }).click();

  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();
  const projectId = projectUrl.split("/").at(-1) as string;

  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText("Development progress")).toBeVisible();

  // The orchestrator pauses at the owner approval gate; the UI must surface it.
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  await expect(approve).toBeVisible({ timeout: 180_000 });
  await page.getByLabel(/Decision note for/).fill("Approved in the dashboard E2E run.");
  await approve.click();

  // Only a real completed run is allowed to show "Completed".
  await expect(page.locator(".badge", { hasText: /^Completed$/ })).toBeVisible({
    timeout: 180_000,
  });

  // Progress and workflow are derived from persisted rows.
  await expect(page.locator(".progress-value").first()).toHaveText("100%");
  const steps = page.locator(".stepper .step");
  await expect(steps).toHaveCount(9);
  await expect(page.locator(".step[data-state='done']")).toHaveCount(9);

  // Stats must reflect real artifacts, never placeholders.
  const stats = page.locator(".stat");
  await expect(stats.filter({ hasText: "Git checkpoints" }).locator(".stat-value")).not.toHaveText(
    "0",
  );
  await expect(
    stats.filter({ hasText: "Tests passing" }).locator(".stat-value"),
  ).not.toHaveText("—");
  await expect(
    stats.filter({ hasText: "Generated files" }).locator(".stat-value"),
  ).not.toHaveText("—");

  // Files explorer reads a generated file through the API.
  await page.getByRole("tab", { name: /^Files/ }).click();
  await page.getByRole("button", { name: "server.mjs", exact: true }).click();
  await expect(page.locator(".code")).toContainText("createServer", { timeout: 30_000 });

  // Test evidence from the real Playwright run inside the container.
  await page.getByRole("tab", { name: /^Tests/ }).click();
  await expect(page.locator(".test-card").first()).toBeVisible();
  await expect(page.locator(".test-card").first().locator(".badge").first()).toHaveText(
    "passed",
  );

  // Terminal stream carries the real sandbox and test-run output. The scaffold
  // engine writes files directly, so no shell command lines are expected here;
  // assert on what the orchestrator actually logged.
  await page.getByRole("tab", { name: /^Terminal/ }).click();
  const terminal = page.locator(".terminal-body");
  await expect(terminal).toContainText("Sandbox container", { timeout: 30_000 });
  await expect(terminal).toContainText("Running Playwright tests");

  // Requirements artifacts exist for the approved run.
  await page.getByRole("tab", { name: /^Requirements/ }).click();
  await expect(
    page.getByRole("heading", { name: "Business requirements document", level: 4 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "User stories", level: 4 }),
  ).toBeVisible();
  await expect(page.locator(".doc")).toContainText("Business Requirements Document");

  // Checkpoints were recorded by the orchestrator.
  await page.getByRole("tab", { name: /^Checkpoints/ }).click();
  const commits = page.locator(".commit-row");
  expect(await commits.count()).toBeGreaterThan(0);

  // The approval panel records the owner decision.
  await expect(page.locator(".approval-card[data-status='approved']")).toBeVisible();
  await expect(page.locator(".approval-card[data-status='approved']")).toContainText(
    "Approved in the dashboard E2E run.",
  );

  // Source download is offered and points at the API archive.
  const download = page.getByRole("link", { name: "Download source" });
  await expect(download).toHaveAttribute(
    "href",
    new RegExp(`/api/projects/${projectId}/source$`),
  );

  // Preview must be the sandbox's published loopback port.
  const previewLink = page.locator(".preview-url a");
  await expect(previewLink).toBeVisible({ timeout: 60_000 });
  await expect(previewLink).toHaveAttribute("href", /^http:\/\/127\.0\.0\.1:\d+$/);

  // The project appears in history with its real status.
  await page.goto("/");
  const row = page.locator(".project-row", { hasText: name });
  await expect(row).toBeVisible();
  await expect(row.locator(".badge", { hasText: /^Completed$/ })).toBeVisible();
});
