import { expect, test } from "@playwright/test";

/**
 * SMS E2E coverage for the control centre, the users & access surface and the
 * maker–checker queue. The tests run against the real stack: Postgres +
 * Fastify API + Next.js web (see playwright.config.ts). The pages under test
 * must render even while the API is unreachable, but the permission-driven copy
 * below only holds when the API answers.
 */
test("SMS control centre renders the permission snapshot", async ({ page }) => {
  await page.goto("/sms");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("SMS control centre");
  await expect(page.getByText("Table-wise responsibilities")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pending approvals" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent audit" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Responsibility matrix" })).toBeVisible();

  const stats = page.locator(".stat");
  await expect(stats).toHaveCount(5);
  await expect(stats.filter({ hasText: "Pending approvals" })).toBeVisible();
});

test("SMS users page configures responsibilities and assignments", async ({ page }) => {
  await page.goto("/sms/users");

  await expect(
    page.getByRole("heading", { level: 1 }),
  ).toHaveText("Roles, users and table responsibilities");
  await expect(page.getByRole("heading", { name: "Create role" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create user" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Configure table responsibility" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Assign responsibilities" })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Assign to role" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Assign to user" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Role assignments" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "User assignments" })).toBeVisible();

  await expect(page.getByLabel("Role name")).toBeVisible();
  await expect(page.getByLabel("Responsibility name")).toBeVisible();
});

test("SMS maker–checker queue renders the proposal flow", async ({ page }) => {
  await page.goto("/sms/queue");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Authorization queue");
  await expect(page.getByRole("heading", { name: "Propose a transaction" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve/ })).toHaveCount(0);
});
