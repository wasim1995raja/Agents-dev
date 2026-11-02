import { Agent, run, setDefaultOpenAIKey } from "@openai/agents";

export class AgentUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentUnavailableError";
  }
}

export interface AgentRuntimeOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export interface RunAgentInput {
  name: string;
  instructions: string;
  input: string;
  /** Tool definitions created with the Agents SDK `tool()` helper. */
  tools?: unknown[];
  maxTurns?: number;
}

export interface RunAgentResult {
  text: string;
  toolCalls: number;
  raw: unknown;
}

/**
 * Thin wrapper around the OpenAI Agents SDK. No mock fallback: if credentials
 * are missing, callers get an explicit error and must choose another engine.
 */
export class AgentRuntime {
  constructor(private readonly options: AgentRuntimeOptions = {}) {
    if (options.apiKey) {
      setDefaultOpenAIKey(options.apiKey);
    }
    if (options.baseUrl) {
      process.env.OPENAI_BASE_URL = options.baseUrl;
    }
  }

  isAvailable(): boolean {
    return Boolean(this.options.apiKey && this.options.apiKey.trim().length > 0);
  }

  unavailableReason(): string | null {
    return this.isAvailable() ? null : "OPENAI_API_KEY is not set";
  }

  async runAgent(input: RunAgentInput): Promise<RunAgentResult> {
    if (!this.isAvailable()) {
      throw new AgentUnavailableError(this.unavailableReason() ?? "agent runtime unavailable");
    }

    const agent = new Agent({
      name: input.name,
      instructions: input.instructions,
      ...(this.options.model ? { model: this.options.model } : {}),
      tools: (input.tools ?? []) as never,
    });

    const result = await run(agent, input.input, { maxTurns: input.maxTurns ?? 10 });
    const text = typeof result.finalOutput === "string" ? result.finalOutput : JSON.stringify(result.finalOutput);

    const toolCalls = (result.newItems as Array<{ type: string }>).filter(
      (item) => item.type === "tool_call_item",
    ).length;

    return { text, toolCalls, raw: result };
  }
}
