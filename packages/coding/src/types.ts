import type { EngineName } from "@autodev/shared";

export interface CodingPhaseContext {
  brd?: string;
  architecture?: string;
  ux?: string;
  reviewFeedback?: string[];
}

export interface CodingTask {
  projectId: string;
  workspacePath: string;
  appName: string;
  requirements: string;
  techStack: string[];
  phaseContext: CodingPhaseContext;
  instruction: string;
}

export type CodingEvent =
  | { type: "log"; message: string; level?: "info" | "warn" | "error" }
  | { type: "file"; path: string }
  | { type: "command"; command: string; exitCode?: number | null };

export interface CodingResult {
  engine: EngineName;
  summary: string;
  filesWritten: string[];
  commandsRun: string[];
  transcript: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
}

export type CodingEventHandler = (event: CodingEvent) => void;

export interface CodingEngine {
  readonly name: EngineName;
  /** False when required credentials or binaries are missing. */
  isAvailable(): boolean;
  /** Human-readable reason when unavailable. */
  unavailableReason(): string | null;
  run(task: CodingTask, onEvent: CodingEventHandler): Promise<CodingResult>;
}

export class CodingEngineUnavailableError extends Error {
  constructor(
    readonly engine: EngineName,
    message: string,
  ) {
    super(message);
    this.name = "CodingEngineUnavailableError";
  }
}
