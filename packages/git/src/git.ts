import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Raised whenever a git invocation exits non-zero. The message includes the
 * command that failed so orchestration logs stay diagnosable, and the raw
 * stderr is preserved for the dashboard's terminal view.
 */
export class GitError extends Error {
  readonly command: string;
  readonly exitCode: number;
  readonly stderr: string;

  constructor(command: string, exitCode: number, stderr: string) {
    super(`git ${command} failed (exit ${exitCode}): ${stderr.trim() || "no stderr"}`);
    this.name = "GitError";
    this.command = command;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export interface GitRunResult {
  stdout: string;
  stderr: string;
}

export interface GitCheckpoint {
  commit: string;
  subject: string;
  createdAt: string;
}

export interface CommitOutcome {
  committed: boolean;
  commit: string | null;
  /** Human-readable reason when nothing was committed. */
  reason?: string;
}

export interface GitOptions {
  /** Absolute path to the repository (or the directory that becomes one). */
  repoPath: string;
  /** Per-command timeout. Git should never hang the orchestrator. */
  timeoutMs?: number;
  /** Identity used for commits so we never depend on host git config. */
  authorName?: string;
  authorEmail?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const SAFE_REVISION = /^(HEAD|HEAD~[0-9]{1,3}|[0-9a-f]{7,40})$/;

/**
 * Thin, safe wrapper around the git CLI.
 *
 * Every call uses `execFile` with an argument array — never a shell — so
 * user-controlled values such as commit messages or paths cannot be
 * interpreted as shell syntax. Revisions are additionally validated because
 * a leading `-` would be parsed as a flag.
 */
export class GitRepo {
  readonly repoPath: string;
  private readonly timeoutMs: number;
  private readonly authorName: string;
  private readonly authorEmail: string;

  constructor(options: GitOptions) {
    this.repoPath = path.resolve(options.repoPath);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.authorName = options.authorName ?? "AutoDev Agent";
    this.authorEmail = options.authorEmail ?? "agent@autodev.local";
  }

  /** Creates the repository if needed and pins a local identity. */
  async init(): Promise<void> {
    await fs.mkdir(this.repoPath, { recursive: true });
    if (await this.isRepository()) return;

    await this.run(["init", "--initial-branch=main"]);
    await this.run(["config", "user.name", this.authorName]);
    await this.run(["config", "user.email", this.authorEmail]);
  }

  async isRepository(): Promise<boolean> {
    try {
      const { stdout } = await this.run(["rev-parse", "--is-inside-work-tree"]);
      return stdout.trim() === "true";
    } catch {
      return false;
    }
  }

  async hasCommits(): Promise<boolean> {
    try {
      await this.run(["rev-parse", "--verify", "HEAD"]);
      return true;
    } catch {
      return false;
    }
  }

  /** Raw porcelain status lines. Empty array means a clean tree. */
  async status(): Promise<string[]> {
    const { stdout } = await this.run(["status", "--porcelain"]);
    return stdout
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean);
  }

  /**
   * Stages everything and commits. Returns `committed: false` (rather than
   * throwing) when the tree is already clean, because "nothing changed" is a
   * normal outcome for a checkpoint.
   */
  async commitAll(message: string): Promise<CommitOutcome> {
    if (!message.trim()) throw new Error("commit message must not be empty");

    await this.run(["add", "--all"]);
    const staged = await this.run(["diff", "--cached", "--name-only"]);
    if (!staged.stdout.trim()) {
      return { committed: false, commit: null, reason: "working tree is clean" };
    }

    await this.run(["commit", "-m", message]);
    const { stdout } = await this.run(["rev-parse", "HEAD"]);
    return { committed: true, commit: stdout.trim() };
  }

  /** Commits the current tree under a consistent `checkpoint:` prefix. */
  async checkpoint(label: string): Promise<CommitOutcome> {
    const safeLabel = label.trim().replace(/\s+/g, " ");
    if (!safeLabel) throw new Error("checkpoint label must not be empty");
    return this.commitAll(`checkpoint: ${safeLabel}`);
  }

  /**
   * Returns checkpoints newest-first. Used by the dashboard's project history
   * panel and by the rollback picker.
   */
  async log(limit = 20): Promise<GitCheckpoint[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("log limit must be an integer between 1 and 500");
    }
    if (!(await this.hasCommits())) return [];

    const { stdout } = await this.run([
      "log",
      `--max-count=${limit}`,
      "--pretty=format:%H%x1f%s%x1f%aI%x1e",
    ]);

    return stdout
      .split("\x1e")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [commit, subject, createdAt] = entry.split("\x1f");
        return {
          commit: commit ?? "",
          subject: subject ?? "",
          createdAt: createdAt ?? "",
        };
      })
      .filter((entry) => entry.commit.length > 0);
  }

  /**
   * Restores the worktree to a checkpoint. Optionally removes untracked files
   * as well, which is what "roll back to a known-good state" usually means.
   */
  async rollback(revision: string, options: { clean?: boolean } = {}): Promise<void> {
    const target = this.assertRevision(revision);
    await this.run(["reset", "--hard", target]);
    if (options.clean) await this.run(["clean", "-fd"]);
  }

  /** Diffstat between two revisions, or between a revision and the worktree. */
  async diffStat(from: string, to?: string): Promise<string> {
    const args = ["diff", "--stat", this.assertRevision(from)];
    if (to) args.push(this.assertRevision(to));
    const { stdout } = await this.run(args);
    return stdout.trim();
  }

  /** Names of files changed between two revisions. */
  async changedFiles(from: string, to?: string): Promise<string[]> {
    const args = ["diff", "--name-only", this.assertRevision(from)];
    if (to) args.push(this.assertRevision(to));
    const { stdout } = await this.run(args);
    return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  /**
   * Executes a git command inside the repo. Exposed for callers that need a
   * command the wrapper does not model; arguments are still passed as an
   * array so no shell parsing occurs.
   */
  async run(args: string[]): Promise<GitRunResult> {
    if (!Array.isArray(args) || args.length === 0) {
      throw new Error("git requires at least one argument");
    }
    if (args.some((arg) => typeof arg !== "string")) {
      throw new Error("git arguments must all be strings");
    }

    return new Promise<GitRunResult>((resolve, reject) => {
      execFile(
        "git",
        args,
        {
          cwd: this.repoPath,
          timeout: this.timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            GIT_AUTHOR_NAME: this.authorName,
            GIT_AUTHOR_EMAIL: this.authorEmail,
            GIT_COMMITTER_NAME: this.authorName,
            GIT_COMMITTER_EMAIL: this.authorEmail,
          },
        },
        (error, stdout, stderr) => {
          if (error) {
            const exitCode =
              typeof (error as { code?: unknown }).code === "number"
                ? ((error as { code: number }).code as number)
                : 1;
            reject(new GitError(args.join(" "), exitCode, stderr || error.message));
            return;
          }
          resolve({ stdout, stderr });
        },
      );
    });
  }

  private assertRevision(revision: string): string {
    if (!SAFE_REVISION.test(revision)) {
      throw new Error(
        `unsafe git revision "${revision}" — expected HEAD, HEAD~N or a 7-40 char hex commit`,
      );
    }
    return revision;
  }
}
