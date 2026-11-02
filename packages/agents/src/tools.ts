import fs from "node:fs/promises";
import path from "node:path";

import { tool } from "@openai/agents";
import { safeJoin } from "@autodev/coding";
import { z } from "zod";

export interface WorkspaceToolOptions {
  workspacePath: string;
  /** Optional sandboxed command executor. Commands never run on the host. */
  runCommand?: (command: string, cwd?: string) => Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
}

const IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "dist", "test-results", "playwright-report"]);

/**
 * Surface tool failures to the model instead of the SDK's generic message.
 * Path-boundary violations must be visible so the agent can correct itself,
 * while the rejection itself still happens inside `safeJoin`.
 */
const surfaceError = (_context: unknown, error: unknown): string =>
  `Tool error: ${error instanceof Error ? error.message : String(error)}`;

export async function listWorkspaceFiles(root: string, limit = 300): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    if (files.length >= limit) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (files.length >= limit) return;
      if (IGNORED_DIRS.has(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative);
      else if (entry.isFile()) files.push(relative);
    }
  }

  await walk(root, "");
  return files.sort();
}

export function createWorkspaceTools(options: WorkspaceToolOptions) {
  const { workspacePath, runCommand } = options;

  const listFilesTool = tool({
    name: "list_files",
    description: "List files in the project workspace. Use this before editing.",
    parameters: z.object({}),
    errorFunction: surfaceError,
    execute: async () => {
      const files = await listWorkspaceFiles(workspacePath);
      return files.join("\n") || "(workspace is empty)";
    },
  });

  const readFileTool = tool({
    name: "read_file",
    description: "Read a UTF-8 text file from the project workspace.",
    parameters: z.object({ path: z.string().describe("Relative file path") }),
    errorFunction: surfaceError,
    execute: async ({ path: filePath }) => {
      const absolute = safeJoin(workspacePath, filePath);
      const content = await fs.readFile(absolute, "utf8");
      return content.length > 120_000 ? `${content.slice(0, 120_000)}\n...[truncated]` : content;
    },
  });

  const writeFileTool = tool({
    name: "write_file",
    description:
      "Create or overwrite a UTF-8 text file inside the project workspace. Parent directories are created.",
    parameters: z.object({
      path: z.string().describe("Relative file path inside the workspace"),
      content: z.string().describe("Full file content"),
    }),
    errorFunction: surfaceError,
    execute: async ({ path: filePath, content }) => {
      const absolute = safeJoin(workspacePath, filePath);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, content, "utf8");
      return `wrote ${content.length} bytes to ${filePath}`;
    },
  });

  const tools = [listFilesTool, readFileTool, writeFileTool];

  if (runCommand) {
    tools.push(
      tool({
        name: "run_command",
        description:
          "Run a shell command inside the isolated project container. Commands are policy-checked and sandboxed.",
        parameters: z.object({
          command: z.string().describe("Command to execute"),
          cwd: z.string().optional().describe("Relative working directory"),
        }),
        errorFunction: surfaceError,
        execute: async ({ command, cwd }) => {
          const result = await runCommand(command, cwd);
          return JSON.stringify(result);
        },
      }),
    );
  }

  return tools;
}
