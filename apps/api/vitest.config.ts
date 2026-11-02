import { defineConfig } from "vitest/config";

/**
 * Keep generated project workspaces out of the unit-test run. `workspaces/` is
 * the default runtime root for projects created through this API, and those
 * projects ship their own Playwright suites.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules/**", "workspaces/**", "dist/**"],
  },
});
