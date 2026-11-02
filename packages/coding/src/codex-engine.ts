import fs from "node:fs/promises";
import path from "node:path";

import {
  CodingEngineUnavailableError,
  type CodingEngine,
  type CodingResult,
  type CodingTask,
  type CodingEventHandler,
} from "./types.js";

export interface CodexEngineOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

/**
 * LLM-backed engine using the Codex SDK.
 *
 * Security note: Codex runs with `workspace-write` scoped to the project
 * directory and network access disabled. All platform-initiated commands
 * (servers, tests) still execute through the Docker sandbox. See
 * docs/ARCHITECTURE.md for the trust model.
 */
export class CodexEngine implements CodingEngine {
  readonly name = "codex" as const;

  constructor(private readonly options: CodexEngineOptions = {}) {}

  isAvailable(): boolean {
    return Boolean(this.options.apiKey && this.options.apiKey.trim().length > 0);
  }

  unavailableReason(): string | null {
    return this.isAvailable()
      ? null
      : "OPENAI_API_KEY is not set, so the Codex engine cannot run";
  }

  async run(task: CodingTask, onEvent: CodingEventHandler): Promise<CodingResult> {
    if (!this.isAvailable()) {
      throw new CodingEngineUnavailableError("codex", this.unavailableReason() ?? "unavailable");
    }

    const before = await listFiles(task.workspacePath);
    onEvent({ type: "log", message: "starting Codex thread" });

    const { Codex } = await import("@openai/codex-sdk");
    const codex = new Codex({
      apiKey: this.options.apiKey,
      ...(this.options.baseUrl ? { baseUrl: this.options.baseUrl } : {}),
    });

    const threadOptions = {
      workingDirectory: task.workspacePath,
      skipGitRepoCheck: true,
      sandboxMode: "workspace-write" as const,
      networkAccessEnabled: false,
      approvalPolicy: "never" as const,
      ...(this.options.model ? { model: this.options.model } : {}),
    };

    const thread = codex.startThread(threadOptions);
    const prompt = buildPrompt(task);

    const turn = await thread.run(prompt);
    onEvent({ type: "log", message: "Codex turn finished" });

    const after = await listFiles(task.workspacePath);
    const filesWritten = [...after].filter((file) => !before.has(file)).sort();

    for (const file of filesWritten) {
      onEvent({ type: "file", path: file });
    }

    const usage = (turn as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;

    return {
      engine: "codex",
      summary: turn.finalResponse || "Codex completed without a final response.",
      filesWritten,
      commandsRun: [],
      transcript: JSON.stringify(turn.items ?? [], null, 2).slice(0, 50_000),
      model: this.options.model,
      tokensIn: usage?.input_tokens,
      tokensOut: usage?.output_tokens,
    };
  }
}

function buildPrompt(task: CodingTask): string {
  const { brd, architecture, ux, reviewFeedback } = task.phaseContext;
  return [
    "You are implementing a software project inside the current working directory.",
    `Application: ${task.appName}`,
    `Requirements:\n${task.requirements}`,
    brd ? `Business requirements:\n${brd}` : "",
    architecture ? `Architecture:\n${architecture}` : "",
    ux ? `UX specification:\n${ux}` : "",
    reviewFeedback && reviewFeedback.length > 0
      ? `Address this review feedback:\n- ${reviewFeedback.join("\n- ")}`
      : "",
    `Instruction: ${task.instruction}`,
    "Constraints:",
    "- Write clean, modular code with tests where practical.",
    "- Do not install dependencies; network access is disabled.",
    "- Do not attempt production deployment.",
    "- Finish with a short summary of what you changed.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function listFiles(root: string): Promise<Set<string>> {
  const result = new Set<string>();
  const skip = new Set(["node_modules", ".git", ".next", "test-results", "playwright-report", "dist"]);

  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relative);
      } else if (entry.isFile()) {
        result.add(relative);
      }
    }
  }

  await walk(root, "");
  return result;
}
