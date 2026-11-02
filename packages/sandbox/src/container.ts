import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import Docker from "dockerode";

import { classifyCommand } from "./policy.js";
import {
  DEFAULT_LIMITS,
  type CommandChunk,
  type CommandRequest,
  type CommandResult,
  type SandboxContainerInfo,
  type SandboxLimits,
} from "./types.js";

export class SandboxError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "SandboxError";
  }
}

export interface SandboxOptions {
  limits?: Partial<SandboxLimits>;
  image?: string;
  docker?: Docker;
  /** Read-only mount of the host Playwright browser cache, if available. */
  playwrightCachePath?: string | null;
  /** Container port to publish on a random loopback port (app preview). */
  previewContainerPort?: number;
}

const CONTAINER_WORKSPACE = "/workspace";

function safeCwd(cwd?: string): string {
  if (!cwd || cwd === "." || cwd === "./") return CONTAINER_WORKSPACE;
  if (path.isAbsolute(cwd) || cwd.includes("..")) {
    throw new SandboxError(`cwd must be a relative path inside the workspace: ${cwd}`);
  }
  return path.posix.join(CONTAINER_WORKSPACE, cwd);
}

export class SandboxManager {
  private readonly docker: Docker;
  private readonly limits: SandboxLimits;
  private readonly image: string;
  private readonly playwrightCachePath: string | null;
  private readonly previewContainerPort: number;

  constructor(options: SandboxOptions = {}) {
    this.docker = options.docker ?? new Docker();
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.image = options.image ?? "autodev/workspace:latest";
    this.playwrightCachePath =
      options.playwrightCachePath === undefined
        ? path.join(os.homedir(), ".cache", "ms-playwright")
        : options.playwrightCachePath;
    this.previewContainerPort = options.previewContainerPort ?? 4173;
  }

  getLimits(): SandboxLimits {
    return { ...this.limits };
  }

  getImage(): string {
    return this.image;
  }

  async assertAvailable(): Promise<void> {
    try {
      await this.docker.ping();
    } catch (error) {
      throw new SandboxError("Docker daemon is not reachable", error);
    }
    try {
      await this.docker.getImage(this.image).inspect();
    } catch (error) {
      throw new SandboxError(
        `Sandbox image ${this.image} is missing. Run: docker build -t ${this.image} docker/workspace`,
        error,
      );
    }
  }

  async createContainer(projectId: string, hostWorkspace: string): Promise<SandboxContainerInfo> {
    await this.assertAvailable();

    const resolvedWorkspace = path.resolve(hostWorkspace);
    const stat = await fs.promises.stat(resolvedWorkspace).catch(() => null);
    if (!stat?.isDirectory()) {
      throw new SandboxError(`Workspace directory does not exist: ${resolvedWorkspace}`);
    }

    const binds = [`${resolvedWorkspace}:${CONTAINER_WORKSPACE}`];
    if (this.playwrightCachePath && fs.existsSync(this.playwrightCachePath)) {
      binds.push(`${this.playwrightCachePath}:/ms-playwright:ro`);
    }

    const previewPortKey = `${this.previewContainerPort}/tcp`;

    const container = await this.docker.createContainer({
      name: `autodev-${projectId.slice(0, 12)}-${Date.now().toString(36)}`,
      Image: this.image,
      WorkingDir: CONTAINER_WORKSPACE,
      Cmd: ["sleep", "infinity"],
      Tty: false,
      Labels: { "autodev.projectId": projectId, "autodev.managed": "true" },
      ExposedPorts: { [previewPortKey]: {} },
      Env: [
        "HOME=/tmp/home",
        "npm_config_cache=/tmp/home/.npm",
        "npm_config_fund=false",
        "npm_config_audit=false",
        "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright",
        "CI=1",
        "TERM=dumb",
      ],
      HostConfig: {
        Binds: binds,
        PortBindings: {
          [previewPortKey]: [{ HostIp: "127.0.0.1", HostPort: "" }],
        },
        Memory: this.limits.memoryMb * 1024 * 1024,
        NanoCpus: Math.round(this.limits.cpus * 1_000_000_000),
        PidsLimit: this.limits.pidsLimit,
        ReadonlyRootfs: true,
        Tmpfs: { "/tmp": "rw,exec,size=1024m" },
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
        AutoRemove: false,
        NetworkMode: "bridge",
      },
    });

    await container.start();

    const info = await container.inspect();
    const bindings = info.NetworkSettings?.Ports?.[previewPortKey] ?? [];
    const hostPort = Number(bindings[0]?.HostPort ?? "");

    return {
      id: container.id,
      image: this.image,
      hostWorkspace: resolvedWorkspace,
      startedAt: new Date().toISOString(),
      previewPort: Number.isInteger(hostPort) && hostPort > 0 ? hostPort : null,
    };
  }

  async isRunning(containerId: string): Promise<boolean> {
    try {
      const info = await this.docker.getContainer(containerId).inspect();
      return info.State.Running === true;
    } catch {
      return false;
    }
  }

  async removeContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      try {
        await container.stop({ t: 5 });
      } catch {
        // already stopped
      }
      await container.remove({ force: true, v: true });
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404) return;
      throw new SandboxError(`Failed to remove container ${containerId}`, error);
    }
  }

  /**
   * Executes a command inside an existing project container.
   * The host enforces the policy first; Docker enforces isolation second.
   */
  async exec(
    request: CommandRequest & { containerId: string },
    callbacks: {
      onChunk?: (chunk: CommandChunk) => void;
      onStart?: (command: string) => void;
    } = {},
  ): Promise<CommandResult> {
    const verdict = classifyCommand(request.command);
    if (verdict.decision === "deny") {
      throw new SandboxError(`Command blocked by policy: ${verdict.reason}`);
    }
    if (verdict.decision === "requires_approval" && !request.approvalToken) {
      throw new SandboxError(`Command requires approval: ${verdict.reason}`);
    }

    const timeoutMs = request.timeoutMs ?? this.limits.commandTimeoutMs;
    if (timeoutMs < 1_000 || timeoutMs > 900_000) {
      throw new SandboxError("timeoutMs must be between 1000 and 900000");
    }

    const container = this.docker.getContainer(request.containerId);
    const startedAt = Date.now();
    callbacks.onStart?.(request.command);

    let stdout = "";
    let stderr = "";
    let truncated = false;

    const append = (target: "stdout" | "stderr", text: string): void => {
      const current = target === "stdout" ? stdout : stderr;
      if (current.length + text.length > this.limits.maxOutputBytes) {
        truncated = true;
        const remaining = Math.max(0, this.limits.maxOutputBytes - current.length);
        const slice = text.slice(0, remaining);
        if (target === "stdout") stdout += slice;
        else stderr += slice;
      } else if (target === "stdout") {
        stdout += text;
      } else {
        stderr += text;
      }
      callbacks.onChunk?.({ stream: target, chunk: text });
    };

    const exec = await container.exec({
      Cmd: [
        "timeout",
        "-k",
        "5",
        "-s",
        "TERM",
        `${Math.ceil(timeoutMs / 1000)}s`,
        "bash",
        "-lc",
        request.command,
      ],
      WorkingDir: safeCwd(request.cwd),
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });

    const stream = await exec.start({ hijack: false, stdin: false });

    let timedOut = false;
    let hostTimer: NodeJS.Timeout | undefined;

    const stdoutSink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        append("stdout", chunk.toString("utf8"));
        callback();
      },
    });
    const stderrSink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        append("stderr", chunk.toString("utf8"));
        callback();
      },
    });

    this.docker.modem.demuxStream(stream, stdoutSink, stderrSink);

    await new Promise<void>((resolve) => {
      hostTimer = setTimeout(() => {
        timedOut = true;
        stream.destroy();
        resolve();
      }, timeoutMs + 10_000);

      stream.on("end", () => resolve());
      stream.on("error", () => resolve());
      stream.on("close", () => resolve());
    });

    if (hostTimer) clearTimeout(hostTimer);
    stdoutSink.end();
    stderrSink.end();

    let exitCode: number | null = null;
    try {
      const info = await exec.inspect();
      exitCode = info.ExitCode ?? null;
      if (timedOut && (exitCode === null || exitCode === 137 || exitCode === 124)) {
        exitCode = 124;
      }
    } catch {
      exitCode = timedOut ? 124 : null;
    }

    const result: CommandResult = {
      command: request.command,
      exitCode,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt,
      timedOut: timedOut || exitCode === 124,
      truncated,
    };
    return result;
  }

  /**
   * Starts a long-running process (a dev server) without attaching to its
   * output. Policy is still enforced on the host. The caller is responsible for
   * redirecting logs; the orchestrator writes them to `/tmp/preview.log`.
   */
  async startDetached(
    request: CommandRequest & { containerId: string },
  ): Promise<{ execId: string }> {
    const verdict = classifyCommand(request.command);
    if (verdict.decision === "deny") {
      throw new SandboxError(`Command blocked by policy: ${verdict.reason}`);
    }
    if (verdict.decision === "requires_approval" && !request.approvalToken) {
      throw new SandboxError(`Command requires approval: ${verdict.reason}`);
    }

    const container = this.docker.getContainer(request.containerId);
    const exec = await container.exec({
      Cmd: ["bash", "-lc", request.command],
      WorkingDir: safeCwd(request.cwd),
      AttachStdout: false,
      AttachStderr: false,
      Tty: false,
    });

    await exec.start({ Detach: true });
    return { execId: exec.id };
  }

  /** Restarts the container, killing any detached processes it is running. */
  async restartContainer(containerId: string): Promise<void> {
    try {
      await this.docker.getContainer(containerId).restart({ t: 5 });
    } catch (error) {
      throw new SandboxError(`Failed to restart container ${containerId}`, error);
    }
  }

  /** Current running state and published preview port for a container. */
  async getInfo(containerId: string): Promise<{ running: boolean; previewPort: number | null }> {
    try {
      const info = await this.docker.getContainer(containerId).inspect();
      const portKey = `${this.previewContainerPort}/tcp`;
      const bindings = info.NetworkSettings?.Ports?.[portKey] ?? [];
      const hostPort = Number(bindings[0]?.HostPort ?? "");
      return {
        running: info.State.Running === true,
        previewPort: Number.isInteger(hostPort) && hostPort > 0 ? hostPort : null,
      };
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404) return { running: false, previewPort: null };
      throw new SandboxError(`Failed to inspect container ${containerId}`, error);
    }
  }

  /** Best-effort cleanup of every container this platform created. */
  async listManagedContainers(): Promise<Array<{ id: string; projectId: string; state: string }>> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: ["autodev.managed=true"] },
    });
    return containers.map((container) => ({
      id: container.Id,
      projectId: container.Labels["autodev.projectId"] ?? "unknown",
      state: container.State,
    }));
  }
}
