import type { EngineName } from "@autodev/shared";

import { CodexEngine } from "./codex-engine.js";
import { ScaffoldEngine } from "./scaffold-engine.js";
import type { CodingEngine } from "./types.js";

export * from "./types.js";
export * from "./scaffold-engine.js";
export * from "./codex-engine.js";
export * from "./templates.js";

export interface EngineFactoryOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export function createCodingEngine(
  name: EngineName,
  options: EngineFactoryOptions = {},
): CodingEngine {
  switch (name) {
    case "codex":
      return new CodexEngine(options);
    case "scaffold":
      return new ScaffoldEngine();
    case "openai-agents":
      // The agents package owns this engine; wiring is done by the orchestrator.
      throw new Error(
        "The openai-agents engine must be constructed by @autodev/agents, not @autodev/coding",
      );
    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown engine: ${String(exhaustive)}`);
    }
  }
}
