export interface SandboxLimits {
  memoryMb: number;
  cpus: number;
  pidsLimit: number;
  commandTimeoutMs: number;
  maxOutputBytes: number;
}

export const DEFAULT_LIMITS: SandboxLimits = {
  memoryMb: 2048,
  cpus: 2,
  pidsLimit: 512,
  commandTimeoutMs: 300_000,
  maxOutputBytes: 1_000_000,
};

export interface CommandRequest {
  /** Project id used for container naming and logging. */
  projectId: string;
  command: string;
  /** Relative directory inside the container workspace. */
  cwd?: string;
  timeoutMs?: number;
  /** Set when a human already approved a gated command. */
  approvalToken?: string;
}

export interface CommandChunk {
  stream: "stdout" | "stderr";
  chunk: string;
}

export interface CommandResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

export type CommandVerdict =
  | { decision: "allow"; reason: string }
  | {
      decision: "requires_approval";
      reason: string;
      category: "dependency_install" | "destructive_command";
    }
  | { decision: "deny"; reason: string; category: "blocked" };

export interface SandboxContainerInfo {
  id: string;
  image: string;
  hostWorkspace: string;
  startedAt: string;
  /** Host loopback port mapped to the app port, when one was requested. */
  previewPort: number | null;
}

export interface SandboxCallbacks {
  onCommandStart?: (command: string) => void;
  onCommandChunk?: (chunk: CommandChunk) => void;
  onCommandEnd?: (result: CommandResult) => void;
}
