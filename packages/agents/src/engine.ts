import type { CodingEngine, CodingEventHandler, CodingResult, CodingTask } from "@autodev/coding";
import { CodingEngineUnavailableError } from "@autodev/coding";

import { getAgentPrompt } from "./prompts.js";
import { AgentRuntime, type AgentRuntimeOptions } from "./runtime.js";
import { createWorkspaceTools, listWorkspaceFiles } from "./tools.js";

/**
 * LLM implementation engine backed by the OpenAI Agents SDK.
 * Agents can read and write project files through explicit tools; they cannot
 * execute host commands. All command execution stays in the Docker sandbox.
 */
export class AgentsCodingEngine implements CodingEngine {
  readonly name = "openai-agents" as const;
  private readonly runtime: AgentRuntime;

  constructor(options: AgentRuntimeOptions = {}) {
    this.runtime = new AgentRuntime(options);
  }

  isAvailable(): boolean {
    return this.runtime.isAvailable();
  }

  unavailableReason(): string | null {
    return this.runtime.unavailableReason();
  }

  async run(task: CodingTask, onEvent: CodingEventHandler): Promise<CodingResult> {
    if (!this.isAvailable()) {
      throw new CodingEngineUnavailableError("openai-agents", this.unavailableReason() ?? "unavailable");
    }

    const before = new Set(await listWorkspaceFiles(task.workspacePath, 1000));
    const tools = createWorkspaceTools({ workspacePath: task.workspacePath });
    const transcripts: string[] = [];

    const roles = ["frontend_developer", "backend_developer"] as const;

    for (const role of roles) {
      const prompt = getAgentPrompt(role);
      onEvent({ type: "log", message: `${prompt.name} started` });

      const result = await this.runtime.runAgent({
        name: prompt.name,
        instructions: prompt.instructions,
        input: buildImplementationInput(task, role),
        tools,
        maxTurns: 16,
      });

      transcripts.push(`## ${prompt.name}\n${result.text}`);
      onEvent({ type: "log", message: `${prompt.name} finished (${result.toolCalls} tool calls)` });
    }

    const after = await listWorkspaceFiles(task.workspacePath, 1000);
    const filesWritten = after.filter((file) => !before.has(file)).sort();
    for (const file of filesWritten) onEvent({ type: "file", path: file });

    return {
      engine: "openai-agents",
      summary: transcripts.join("\n\n").slice(0, 4000),
      filesWritten,
      commandsRun: [],
      transcript: transcripts.join("\n\n"),
    };
  }
}

function buildImplementationInput(task: CodingTask, role: "frontend_developer" | "backend_developer"): string {
  const { brd, architecture, ux, reviewFeedback } = task.phaseContext;
  return [
    `Application: ${task.appName}`,
    `Stack: ${task.techStack.join(", ")}`,
    `Requirements:\n${task.requirements}`,
    brd ? `BRD:\n${brd}` : "",
    architecture ? `Architecture:\n${architecture}` : "",
    ux ? `UX:\n${ux}` : "",
    reviewFeedback?.length ? `Review feedback to address:\n- ${reviewFeedback.join("\n- ")}` : "",
    `Your assignment (${role}): ${task.instruction}`,
    "Work directly in the current project workspace using the provided tools.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
