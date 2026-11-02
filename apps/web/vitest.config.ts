import { defineConfig } from "vitest/config";

/**
 * Unit tests only. Playwright specs live in `e2e/` and need the full stack
 * (Postgres, API, Docker), so they must never be collected by Vitest.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
    environment: "node",
  },
});
