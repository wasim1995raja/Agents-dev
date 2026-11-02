/**
 * HTTP API end-to-end verification.
 *
 * Boots the real Fastify app on an ephemeral port and drives it exactly the way
 * the dashboard does: create a project over HTTP, subscribe to the SSE stream,
 * start the run, approve the deployment gate through the approval endpoint,
 * then verify the persisted evidence, file explorer, source download, live
 * preview and command policy. Postgres, Docker, git and Playwright are all real.
 *
 * Run with: pnpm --filter @autodev/api e2e
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { ActivityEvent } from "@autodev/shared";
import {
  ArtifactsRepository,
  EventsRepository,
  ProjectsRepository,
  RequirementsRepository,
  TasksRepository,
  createDatabase,
} from "@autodev/db";
import { EventBus, Orchestrator, resolveWorkspacePath } from "@autodev/orchestrator";
import { SandboxManager } from "@autodev/sandbox";
import { readConfig } from "@autodev/shared";

import { buildServer } from "../src/app.js";

const root = path.join("/tmp/opencode", `autodev-api-e2e-${Date.now().toString(36)}`);
const workspacesRoot = path.join(root, "workspaces");
const RUN_TIMEOUT_MS = 12 * 60_000;
const execFileAsync = promisify(execFile);

interface CheckResult {
  ok: boolean;
  name: string;
  detail: string;
}

const results: CheckResult[] = [];

async function check(name: string, run: () => Promise<string>): Promise<void> {
  const started = Date.now();
  try {
    const detail = await run();
    results.push({ ok: true, name, detail });
    console.log(`PASS  ${name}  ${detail} (${Date.now() - started}ms)`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ ok: false, name, detail });
    console.log(`FAIL  ${name}  ${detail}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ApiResponse {
  status: number;
  headers: Headers;
  body: unknown;
  buffer: Buffer;
}

/**
 * Minimal SSE reader. Frames are accumulated so a chunk boundary can never
 * split an event, and the parsed events double as the dashboard's evidence.
 */
class SseClient {
  readonly events: ActivityEvent[] = [];
  private readonly controller = new AbortController();
  private buffer = "";

  constructor(private readonly url: string) {}

  async connect(): Promise<void> {
    const response = await fetch(this.url, {
      signal: this.controller.signal,
      headers: { accept: "text/event-stream" },
    });
    assert(response.ok, `SSE connect failed with ${response.status}`);
    assert(response.body, "SSE response has no body");
    void this.pump(response.body);
  }

  private async pump(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        let boundary = this.buffer.indexOf("\n\n");
        while (boundary >= 0) {
          this.handleFrame(this.buffer.slice(0, boundary));
          this.buffer = this.buffer.slice(boundary + 2);
          boundary = this.buffer.indexOf("\n\n");
        }
      }
    } catch {
      // Aborted by close(); nothing to report.
    }
  }

  private handleFrame(frame: string): void {
    let eventName = "";
    let data = "";
    for (const line of frame.split("\n")) {
      if (line.startsWith("event: ")) eventName = line.slice("event: ".length);
      else if (line.startsWith("data: ")) data += line.slice("data: ".length);
    }
    if (!data || !eventName) return;
    try {
      const parsed = JSON.parse(data) as ActivityEvent;
      if (parsed.type === eventName) this.events.push(parsed);
    } catch {
      // A malformed frame is a real problem, but the checks below assert on
      // required events, so ignoring it here cannot produce a false pass.
    }
  }

  async waitFor(
    predicate: (event: ActivityEvent) => boolean,
    timeoutMs = 30_000,
  ): Promise<ActivityEvent> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.events.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) throw new Error("timed out waiting for an SSE event");
      await sleep(100);
    }
  }

  close(): void {
    this.controller.abort();
  }
}

async function main(): Promise<void> {
  await fs.mkdir(workspacesRoot, { recursive: true });

  const config = readConfig({
    ...process.env,
    NODE_ENV: "test",
    WORKSPACES_ROOT: workspacesRoot,
    AUTODEV_ENGINE: "scaffold",
    LOG_LEVEL: "error",
  });

  const database = createDatabase(config.DATABASE_URL);
  const repositories = {
    projects: new ProjectsRepository(database.db),
    tasks: new TasksRepository(database.db),
    artifacts: new ArtifactsRepository(database.db),
    requirements: new RequirementsRepository(database.db),
    events: new EventsRepository(database.db),
  };

  const eventBus = new EventBus({ events: repositories.events });
  const sandbox = new SandboxManager({
    image: config.SANDBOX_IMAGE,
    limits: {
      memoryMb: config.SANDBOX_MEMORY_MB,
      cpus: config.SANDBOX_CPUS,
      pidsLimit: config.SANDBOX_PIDS_LIMIT,
      commandTimeoutMs: config.COMMAND_TIMEOUT_MS,
    },
  });
  const orchestrator = new Orchestrator({
    config,
    ...repositories,
    events: eventBus,
    sandbox,
    maxRepairAttempts: 1,
    maxReviewRounds: 1,
    approvalTimeoutMs: 180_000,
    logger: (message, detail) => console.log(`[orchestrator] ${message}`, detail ?? ""),
  });

  const app = await buildServer({
    deps: {
      config,
      repositories,
      eventBus,
      orchestrator,
      sandbox,
      workspaceFor: (projectId) => resolveWorkspacePath(config.workspacesRoot, projectId),
      pingDatabase: async () => {
        await database.pool.query("select 1");
      },
      ownerIdentity: "owner@autodev.local",
    },
    logger: false,
  });

  // Held in objects because the assignments happen inside async check
  // callbacks and TypeScript's control-flow analysis cannot see them.
  const sseBox: { current: SseClient | null } = { current: null };
  let projectId: string | null = null;
  let previewUrl: string | null = null;
  let stopApprover = false;

  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert(address && typeof address !== "string", "API did not bind a TCP port");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    console.log(`api listening on ${baseUrl}\n`);

    async function api(
      method: string,
      urlPath: string,
      body?: unknown,
    ): Promise<ApiResponse> {
      const response = await fetch(`${baseUrl}${urlPath}`, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") ?? "";
      let parsed: unknown = null;
      if (contentType.includes("application/json") && buffer.length > 0) {
        parsed = JSON.parse(buffer.toString("utf8"));
      }
      return { status: response.status, headers: response.headers, body: parsed, buffer };
    }

    await check("health endpoint reports a live database and sandbox", async () => {
      const health = await api("GET", "/api/health");
      assert(health.status === 200, `health returned ${health.status}`);
      const body = health.body as { status: string; database: string; engine: string };
      assert(body.status === "ok", `health status ${body.status}`);
      assert(body.database === "up", `database ${body.database}`);
      assert(body.engine === "scaffold", `engine ${body.engine}`);

      const runtime = await api("GET", "/api/runtime");
      assert(runtime.status === 200, `runtime returned ${runtime.status}`);
      const info = runtime.body as {
        hasOpenAIKey: boolean;
        sandbox: { dockerAvailable: boolean };
        availableEngines: Array<{ name: string; available: boolean }>;
      };
      assert(info.sandbox.dockerAvailable, "Docker is not available");
      // No key is configured in this environment; the API must not pretend
      // otherwise. If a key is present the assertion is inverted but honest.
      const scaffold = info.availableEngines.find((engine) => engine.name === "scaffold");
      assert(scaffold?.available === true, "scaffold engine is not available");
      return `db up, docker up, key ${info.hasOpenAIKey ? "present" : "absent"}`;
    });

    await check("create project over HTTP", async () => {
      const response = await api("POST", "/api/projects", {
        name: "API E2E Task Tracker",
        description: "A tiny task tracker created through the real HTTP API by the e2e script",
        requirements: [
          "A single page that lists tasks with a title and completion state.",
          "An API endpoint that reports application health.",
          "Playwright tests that prove the home page renders and the API responds.",
        ].join("\n"),
        techStack: ["typescript", "nodejs", "playwright"],
      });
      assert(response.status === 201, `expected 201, got ${response.status}`);
      const body = response.body as { project: Record<string, unknown> };
      projectId = String(body.project.id);
      assert(body.project.status === "draft", `status ${String(body.project.status)}`);
      assert(body.project.engine === "scaffold", `engine ${String(body.project.engine)}`);
      assert(body.project.workspacePath === undefined, "workspacePath leaked in the response");
      assert(body.project.containerId === undefined, "containerId leaked in the response");

      const workspace = path.join(workspacesRoot, projectId);
      assert((await fs.stat(workspace)).isDirectory(), "workspace directory was not created");
      return `${projectId} in ${workspace}`;
    });
    const id = projectId;
    assert(id, "project was not created");

    await check("reject an engine that needs a missing credential", async () => {
      if (config.hasOpenAIKey) return "skipped: OPENAI_API_KEY is configured";
      const response = await api("POST", "/api/projects", {
        name: "Codex Without Key",
        description: "This request must be rejected because no model key is configured",
        requirements: "It should fail loudly instead of queueing a run that cannot start.",
        engine: "codex",
      });
      assert(response.status === 400, `expected 400, got ${response.status}`);
      const body = response.body as { error: { message: string } };
      assert(/OPENAI_API_KEY/.test(body.error.message), "error does not explain the missing key");
      return "400 with an actionable message";
    });

    await check("open the SSE stream before the run starts", async () => {
      sseBox.current = new SseClient(`${baseUrl}/api/projects/${id}/events/stream`);
      await sseBox.current.connect();
      return "stream connected";
    });
    const stream = sseBox.current;
    assert(stream, "SSE client was not created");

    // The dashboard approves the deployment gate. Doing it through the HTTP
    // endpoint exercises the same path the UI uses. Deciding before the
    // orchestrator registers its waiter would leave the run blocked, so wait
    // for the registry to settle after the event is published.
    const decided = new Set<string>();
    void (async () => {
      while (!stopApprover) {
        const request = stream.events.find(
          (event) =>
            event.type === "approval.requested" &&
            typeof event.payload.approvalId === "string" &&
            !decided.has(String(event.payload.approvalId)),
        );
        if (request) {
          const approvalId = String(request.payload.approvalId);
          decided.add(approvalId);
          await sleep(1_500);
          const response = await api("POST", `/api/approvals/${approvalId}/decision`, {
            decision: "approved",
            note: "approved by api e2e script",
          }).catch(() => null);
          if (!response || response.status !== 200) {
            console.log(
              `[approver] decision failed: ${response ? `${response.status} ${JSON.stringify(response.body)}` : "network error"}`,
            );
          }
        }
        await sleep(200);
      }
    })();

    await check("start the run over HTTP and reach completion", async () => {
      const response = await api("POST", `/api/projects/${id}/start`, {});
      assert(response.status === 202, `expected 202, got ${response.status}`);
      const body = response.body as { accepted: boolean };
      assert(body.accepted === true, "start was not accepted");

      const deadline = Date.now() + RUN_TIMEOUT_MS;
      let lastStatus = "";
      for (;;) {
        const detail = await api("GET", `/api/projects/${id}`);
        assert(detail.status === 200, `detail returned ${detail.status}`);
        const project = (detail.body as { project: Record<string, unknown> }).project;
        lastStatus = `${String(project.status)} ${String(project.progress)}%`;
        if (project.status === "completed") {
          assert(project.progress === 100, `completed at ${String(project.progress)}%`);
          return `completed at 100%`;
        }
        if (project.status === "failed" || project.status === "cancelled") {
          throw new Error(`run ended ${String(project.status)}: ${String(project.error ?? "")}`);
        }
        if (Date.now() > deadline) throw new Error(`timed out at ${lastStatus}`);
        await sleep(1_000);
      }
    });

    await check("SSE stream carried live pipeline activity", async () => {
      const required = [
        "project.started",
        "phase.started",
        "task.started",
        "file.written",
        "test.completed",
        "checkpoint.created",
        "approval.requested",
        "approval.decided",
        "project.completed",
      ];
      const seen = new Set(stream.events.map((event) => event.type));
      const missing = required.filter((type) => !seen.has(type as ActivityEvent["type"]));
      assert(missing.length === 0, `missing live events: ${missing.join(", ")}`);
      return `${stream.events.length} events, ${seen.size} types`;
    });

    await check("project detail exposes the dashboard contract", async () => {
      const response = await api("GET", `/api/projects/${id}`);
      assert(response.status === 200, `detail returned ${response.status}`);
      const body = response.body as {
        project: { active: boolean; status: string };
        requirements: { brd: string | null; userStories: unknown[]; acceptanceCriteria: unknown[] } | null;
        tasks: Array<{ status: string; phase: string }>;
        tests: Array<{ status: string; total: number }>;
        approvals: Array<{ type: string; status: string; decidedBy: string | null }>;
      };
      assert(body.project.active === false, "project still reports an active run");
      assert(body.requirements, "no requirements row");
      assert((body.requirements.brd ?? "").length > 50, "BRD is too short to be real");
      assert(body.requirements.userStories.length > 0, "no user stories");
      assert(body.requirements.acceptanceCriteria.length > 0, "no acceptance criteria");

      assert(body.tasks.length === 9, `expected 9 tasks, got ${body.tasks.length}`);
      const unfinished = body.tasks.filter((task) => task.status !== "succeeded");
      assert(
        unfinished.length === 0,
        `unfinished tasks: ${unfinished.map((task) => `${task.phase}:${task.status}`).join(", ")}`,
      );

      const passing = body.tests.filter((test) => test.status === "passed");
      assert(passing.length > 0, "no passing Playwright run was recorded");
      assert(
        passing.reduce((sum, test) => sum + test.total, 0) > 0,
        "a passing run recorded zero browser tests",
      );

      const deployment = body.approvals.find((approval) => approval.type === "production_deployment");
      assert(deployment, "no production approval row");
      assert(deployment.status === "approved", `approval is ${deployment.status}`);
      assert(
        deployment.decidedBy === "owner@autodev.local",
        `decided by ${String(deployment.decidedBy)}`,
      );
      return `9 tasks, ${passing.length} passing run(s), approval ${deployment.status}`;
    });

    await check("git checkpoints were recorded", async () => {
      const response = await api("GET", `/api/projects/${id}/commits`);
      assert(response.status === 200, `commits returned ${response.status}`);
      const body = response.body as { items: Array<{ commit: string; subject: string }> };
      assert(body.items.length >= 6, `expected at least 6 commits, got ${body.items.length}`);
      assert(
        body.items.some((entry) => entry.subject.includes("implementation")),
        "no implementation checkpoint",
      );
      assert(
        body.items.some((entry) => entry.subject.includes("deployment")),
        "no deployment checkpoint",
      );
      return `${body.items.length} commits, head ${body.items[0]?.commit.slice(0, 7) ?? "?"}`;
    });

    await check("file explorer lists and reads generated source", async () => {
      const list = await api("GET", `/api/projects/${id}/files`);
      assert(list.status === 200, `files returned ${list.status}`);
      const body = list.body as { items: Array<{ path: string; language: string | null }>; count: number };
      const paths = body.items.map((file) => file.path);
      for (const required of ["package.json", "server.mjs", "public/index.html", "tests/app.spec.ts"]) {
        assert(paths.includes(required), `${required} is missing from the index`);
      }
      assert(!paths.includes(".env"), ".env must never be indexed");

      const read = await api(
        "GET",
        `/api/projects/${id}/files/content?path=${encodeURIComponent("server.mjs")}`,
      );
      assert(read.status === 200, `file read returned ${read.status}`);
      const content = (read.body as { content: string }).content;
      assert(content.includes("createServer"), "server.mjs does not look like the real server");
      return `${body.count} files indexed, server.mjs read`;
    });

    await check("secrets are neither listed, readable nor downloadable", async () => {
      const workspace = path.join(workspacesRoot, id);
      const secretPath = path.join(workspace, ".env");
      await fs.writeFile(secretPath, "AUTODEV_E2E_SECRET=do-not-leak\n", "utf8");
      try {
        const list = await api("GET", `/api/projects/${id}/files`);
        const paths = (list.body as { items: Array<{ path: string }> }).items.map((file) => file.path);
        assert(!paths.includes(".env"), ".env leaked into the file index");

        const read = await api(
          "GET",
          `/api/projects/${id}/files/content?path=${encodeURIComponent(".env")}`,
        );
        assert(read.status === 403, `expected 403 for .env, got ${read.status}`);
        assert(!read.buffer.toString("utf8").includes("do-not-leak"), "secret leaked in the 403 body");

        const zip = await api("GET", `/api/projects/${id}/source`);
        assert(zip.status === 200, `source returned ${zip.status}`);
        const archive = zip.buffer.toString("latin1");
        assert(!archive.includes("AUTODEV_E2E_SECRET"), "secret leaked into the source archive");

        // Read the real entry names with unzip rather than substring-matching
        // the binary, so `.env.example` is not confused with `.env`.
        const archivePath = path.join(root, "source.zip");
        await fs.writeFile(archivePath, zip.buffer);
        try {
          const { stdout } = await execFileAsync("unzip", ["-Z1", archivePath]);
          const entries = stdout.split("\n").map((entry) => entry.trim()).filter(Boolean);
          assert(entries.length > 0, "the source archive is empty");
          assert(!entries.includes(".env"), ".env leaked into the source archive");
          assert(!entries.some((entry) => entry.endsWith("/.env")), ".env leaked into a folder");
          assert(entries.includes("server.mjs"), "the source archive is missing server.mjs");
          assert(entries.includes(".env.example"), ".env.example should still be downloadable");

          const listed = await api("GET", `/api/projects/${id}/files`);
          const indexed = (listed.body as { items: Array<{ path: string }> }).items
            .map((file) => file.path)
            .sort();
          assert(
            JSON.stringify(entries.sort()) === JSON.stringify(indexed),
            `archive entries (${entries.length}) do not match the filtered index (${indexed.length})`,
          );
          return `${entries.length} entries, secret excluded, index match`;
        } finally {
          await fs.rm(archivePath, { force: true });
        }
      } finally {
        await fs.rm(secretPath, { force: true });
      }
    });

    await check("command policy blocks dangerous commands over HTTP", async () => {
      const response = await api("POST", `/api/projects/${id}/commands`, {
        command: "rm -rf /",
      });
      assert(response.status === 400, `expected 400, got ${response.status}`);
      const body = response.body as { error: { code: string; message: string } };
      assert(body.error.code === "orchestrator_error", `error code ${body.error.code}`);
      assert(/blocked by policy/i.test(body.error.message), `unexpected message: ${body.error.message}`);
      return "rm -rf / rejected";
    });

    await check("approved-safe commands run inside the sandbox", async () => {
      const response = await api("POST", `/api/projects/${id}/commands`, {
        command: "node --version",
      });
      assert(response.status === 200, `expected 200, got ${response.status}`);
      const result = (response.body as { result: { exitCode: number | null; stdout: string } }).result;
      assert(result.exitCode === 0, `exit code ${String(result.exitCode)}`);
      assert(/^v\d+\./.test(result.stdout.trim()), `unexpected stdout ${result.stdout}`);
      return `node ${result.stdout.trim()} inside Docker`;
    });

    await check("preview serves the generated app from the container", async () => {
      const started = await api("POST", `/api/projects/${id}/preview/start`, {});
      assert(started.status === 200, `preview start returned ${started.status}`);
      const info = started.body as { url: string | null };
      assert(info.url, "no preview url was published");
      assert(info.url !== "http://127.0.0.1:4173", "preview port was not remapped to a host port");
      previewUrl = info.url;

      let lastError = "";
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          const health = await fetch(`${previewUrl}/api/health`);
          if (health.ok) {
            const payload = (await health.json()) as { status?: string };
            assert(payload.status === "ok", `health payload ${JSON.stringify(payload)}`);
            const html = await (await fetch(previewUrl)).text();
            assert(html.includes("API E2E Task Tracker"), "home page is missing the app name");
            return `${previewUrl} served health + home page`;
          }
          lastError = `status ${health.status}`;
        } catch (error) {
          lastError = String(error);
        }
        await sleep(250);
      }
      throw new Error(`preview unreachable: ${lastError}`);
    });

    await check("event history is persisted for replay", async () => {
      const response = await api("GET", `/api/projects/${id}/events?limit=500`);
      assert(response.status === 200, `events returned ${response.status}`);
      const body = response.body as { items: ActivityEvent[] };
      assert(body.items.length > 20, `only ${body.items.length} persisted events`);
      const phases = body.items
        .filter((event) => event.type === "phase.completed")
        .map((event) => String(event.payload.phase));
      assert(phases.length === 9, `expected 9 completed phases, got ${phases.length}`);
      return `${body.items.length} events, ${phases.length} phases`;
    });

    await check("project list includes the new project", async () => {
      const response = await api("GET", "/api/projects?limit=100");
      assert(response.status === 200, `list returned ${response.status}`);
      const body = response.body as { items: Array<{ id: string; status: string }> };
      const found = body.items.find((project) => project.id === id);
      assert(found, "created project is missing from the list");
      assert(found.status === "completed", `listed status ${found.status}`);
      return `${body.items.length} project(s), newest included`;
    });
  } finally {
    stopApprover = true;
    sseBox.current?.close();

    if (previewUrl) {
      await fetch(`${previewUrl}/api/health`).catch(() => undefined);
    }
    if (projectId) {
      await orchestrator.stopPreview(projectId).catch(() => undefined);
      const live = await repositories.projects.findById(projectId).catch(() => null);
      if (live?.containerId) {
        await sandbox.removeContainer(live.containerId).catch((error: unknown) => {
          console.log(`[cleanup] container: ${String(error)}`);
        });
      }
    }

    await sleep(100);
    app.server.closeAllConnections?.();
    await app.close().catch((error: unknown) => console.log(`[cleanup] api: ${String(error)}`));
    await database.close().catch((error: unknown) => console.log(`[cleanup] db: ${String(error)}`));
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`workspace retained at ${root}`);
  if (failed.length > 0) {
    console.log("\nfailed:");
    for (const result of failed) console.log(` - ${result.name}: ${result.detail}`);
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
