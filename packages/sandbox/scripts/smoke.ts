/**
 * Real integration check for the Docker sandbox.
 * Creates a container, runs commands, proves isolation, then cleans up.
 * Run: pnpm --filter @autodev/sandbox exec tsx scripts/smoke.ts
 */
import fs from "node:fs/promises";
import path from "node:path";

import { SandboxError, SandboxManager } from "../src/index.js";

const results: Array<{ name: string; ok: boolean; detail: string }> = [];

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`PASS  ${name}  ${detail}`);
  } catch (error) {
    results.push({ name, ok: false, detail: String(error) });
    console.error(`FAIL  ${name}  ${String(error)}`);
  }
}

async function main(): Promise<void> {
  const workspace = path.join("/tmp/opencode", `autodev-sandbox-smoke-${Date.now()}`);
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "package.json"), JSON.stringify({ name: "smoke" }));

  const sandbox = new SandboxManager();
  let containerId: string | null = null;
  let previewPort: number | null = null;

  try {
    await check("docker image available", async () => {
      await sandbox.assertAvailable();
      return sandbox.getImage();
    });

    await check("container starts", async () => {
      const info = await sandbox.createContainer("smoke0000000", workspace);
      containerId = info.id;
      previewPort = info.previewPort;
      return info.id.slice(0, 12);
    });

    if (!containerId) throw new Error("container was not created");

    await check("node runs inside container", async () => {
      const result = await sandbox.exec({ containerId: containerId!, projectId: "smoke", command: "node -v" });
      if (result.exitCode !== 0) throw new Error(`exit ${result.exitCode}: ${result.stderr}`);
      return result.stdout.trim();
    });

    await check("workspace is mounted read-write", async () => {
      const result = await sandbox.exec({
        containerId: containerId!,
        projectId: "smoke",
        command: "printf 'hello-from-container' > generated.txt",
      });
      if (result.exitCode !== 0) throw new Error(result.stderr);
      const content = await fs.readFile(path.join(workspace, "generated.txt"), "utf8");
      if (content !== "hello-from-container") throw new Error("host did not see container write");
      return "host sees container writes";
    });

    await check("working directory is /workspace", async () => {
      const result = await sandbox.exec({ containerId: containerId!, projectId: "smoke", command: "pwd" });
      const pwd = result.stdout.trim();
      if (pwd !== "/workspace") throw new Error(`unexpected pwd ${pwd}`);
      return pwd;
    });

    await check("host filesystem is not mounted", async () => {
      const result = await sandbox.exec({
        containerId: containerId!,
        projectId: "smoke",
        command: "ls /home/wasim_raja/Desktop/Agent 2>&1 || true",
      });
      if (!/No such file|not found|Permission denied/i.test(result.stdout + result.stderr)) {
        throw new Error(`host path appears visible: ${result.stdout}`);
      }
      return "host path invisible";
    });

    await check("policy blocks rm -rf /", async () => {
      try {
        await sandbox.exec({ containerId: containerId!, projectId: "smoke", command: "rm -rf /" });
      } catch (error) {
        if (error instanceof SandboxError) return "blocked before docker exec";
        throw error;
      }
      throw new Error("command was not blocked");
    });

    await check("policy gates dependency installs", async () => {
      try {
        await sandbox.exec({ containerId: containerId!, projectId: "smoke", command: "npm install left-pad" });
      } catch (error) {
        if (error instanceof SandboxError) return "approval required";
        throw error;
      }
      throw new Error("install was not gated");
    });

    await check("approved destructive command runs", async () => {
      const result = await sandbox.exec({
        containerId: containerId!,
        projectId: "smoke",
        command: "mkdir -p scratch && rm -rf scratch",
        approvalToken: "smoke-test",
      });
      if (result.exitCode !== 0) throw new Error(result.stderr);
      return "exit 0";
    });

    await check("timeout kills long commands", async () => {
      const result = await sandbox.exec({
        containerId: containerId!,
        projectId: "smoke",
        command: "sleep 30",
        timeoutMs: 1500,
      });
      if (!result.timedOut) throw new Error("command was not reported as timed out");
      return `timedOut after ${result.durationMs}ms`;
    });

    await check("playwright launcher and browsers are preinstalled", async () => {
      const result = await sandbox.exec({
        containerId: containerId!,
        projectId: "smoke",
        command:
          "node -e \"const p=require('@playwright/test/package.json'); console.log(p.version)\" && " +
          "ls /ms-playwright | tr '\\n' ' '",
      });
      const output = result.stdout + result.stderr;
      if (result.exitCode !== 0) throw new Error(output);
      if (!/1\.\d+\.\d+/.test(output)) throw new Error(`unexpected playwright version: ${output}`);
      if (!/chromium/.test(output)) throw new Error(`browser cache missing: ${output}`);
      return output.replace(/\s+/g, " ").trim();
    });

    await check("playwright runs a real browser test in the sandbox", async () => {      await fs.mkdir(path.join(workspace, "tests"), { recursive: true });
      await fs.writeFile(
        path.join(workspace, "playwright.config.ts"),
        [
          'import { defineConfig } from "@playwright/test";',
          "",
          "export default defineConfig({",
          '  testDir: "./tests",',
          "  timeout: 30_000,",
          "  reporter: [[\"line\"]],",
          "  use: { headless: true },",
          "});",
          "",
        ].join("\n"),
        "utf8",
      );
      await fs.writeFile(
        path.join(workspace, "tests", "smoke.spec.ts"),
        [
          'import { expect, test } from "@playwright/test";',
          "",
          'test("renders in chromium", async ({ page }) => {',
          '  await page.setContent("<h1 data-testid=\\"title\\">sandbox</h1>");',
          '  await expect(page.getByTestId("title")).toHaveText("sandbox");',
          "});",
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await sandbox.exec({
        containerId: containerId!,
        projectId: "smoke",
        command: "node /opt/autodev/node_modules/@playwright/test/cli.js test --reporter=line",
        timeoutMs: 180_000,
      });
      const output = `${result.stdout}\n${result.stderr}`;
      if (result.exitCode !== 0) throw new Error(`exit ${result.exitCode}: ${output.slice(-1500)}`);
      if (!/1 passed/.test(output)) throw new Error(`unexpected reporter output: ${output.slice(-800)}`);
      return "1 browser test passed";
    });

    await check("preview port is published on loopback", async () => {
      if (!previewPort) throw new Error("createContainer did not report a preview port");
      if (previewPort === 4173) throw new Error("preview port was not remapped to a random host port");

      await fs.writeFile(
        path.join(workspace, "preview.mjs"),
        [
          'import http from "node:http";',
          'const server = http.createServer((req, res) => {',
          '  res.writeHead(200, { "content-type": "application/json" });',
          '  res.end(JSON.stringify({ preview: "ok", path: req.url }));',
          "});",
          'server.listen(4173, "0.0.0.0");',
          "",
        ].join("\n"),
        "utf8",
      );

      await sandbox.startDetached({
        containerId: containerId!,
        projectId: "smoke",
        command: "node preview.mjs > /tmp/preview.log 2>&1",
      });

      let lastError = "";
      for (let attempt = 0; attempt < 25; attempt += 1) {
        try {
          const response = await fetch(`http://127.0.0.1:${previewPort}/healthz`);
          const body = (await response.json()) as { preview?: string };
          if (response.ok && body.preview === "ok") {
            return `127.0.0.1:${previewPort} responded`;
          }
          lastError = `status ${response.status}`;
        } catch (error) {
          lastError = String(error);
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const logs = await sandbox.exec({
        containerId: containerId!,
        projectId: "smoke",
        command: "cat /tmp/preview.log 2>&1 || true",
      });
      throw new Error(`preview unreachable (${lastError}); logs: ${logs.stdout}`);
    });

    await check("restarting the container stops detached processes", async () => {
      await sandbox.restartContainer(containerId!);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const running = await sandbox.isRunning(containerId!);
      if (!running) throw new Error("container did not come back after restart");
      const reachable = await fetch(`http://127.0.0.1:${previewPort}/healthz`)
        .then(() => true)
        .catch(() => false);
      if (reachable) throw new Error("detached preview process survived the restart");
      return "container restarted without the preview process";
    });
  } finally {
    if (containerId) {
      await sandbox.removeContainer(containerId);
      console.log("cleaned up container");
    }
    await fs.rm(workspace, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  // Dockerode leaves keep-alive sockets around after detached execs; exit
  // explicitly so the smoke script terminates deterministically.
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
