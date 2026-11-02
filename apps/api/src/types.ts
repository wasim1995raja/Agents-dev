import type {
  AppConfig,
  CreateProjectInput,
  EngineName,
} from "@autodev/shared";
import type { CommandResult } from "@autodev/sandbox";
import type {
  ApprovalRecord,
  ArtifactsRepository,
  DeploymentRecord,
  EventsRepository,
  ExecutionRecord,
  GeneratedFileRecord,
  ProjectsRepository,
  RequirementsRecord,
  RequirementsRepository,
  TaskRecord,
  TasksRepository,
  TestResultRecord,
} from "@autodev/db";
import type { EventBus } from "@autodev/orchestrator";

export interface PreviewInfo {
  url: string | null;
  command: string;
}

/**
 * The HTTP layer depends on this narrow surface rather than the concrete
 * orchestrator, so routes can be tested without Docker, Postgres or a model.
 */
export interface OrchestratorPort {
  isActive(projectId: string): boolean;
  start(projectId: string): Promise<void>;
  stop(projectId: string): Promise<void>;
  decideApproval(
    approvalId: string,
    decision: "approved" | "rejected",
    decidedBy: string,
    note?: string,
  ): Promise<void>;
  runCommand(
    projectId: string,
    request: { command: string; cwd?: string; timeoutMs?: number },
  ): Promise<CommandResult>;
  previewInfo(projectId: string): Promise<PreviewInfo>;
  startPreview(projectId: string, command?: string): Promise<PreviewInfo>;
  stopPreview(projectId: string): Promise<void>;
}

export interface SandboxPort {
  assertAvailable(): Promise<void>;
  getInfo(containerId: string): Promise<{ running: boolean; previewPort: number | null }>;
}

/** Everything the API needs from persistence. */
export interface ApiRepositories {
  projects: ProjectsRepository;
  tasks: TasksRepository;
  artifacts: ArtifactsRepository;
  requirements: RequirementsRepository;
  events: EventsRepository;
}

export interface ApiDeps {
  config: AppConfig;
  repositories: ApiRepositories;
  eventBus: EventBus;
  orchestrator: OrchestratorPort;
  sandbox: SandboxPort;
  /** Resolves a project's absolute workspace directory. */
  workspaceFor(projectId: string): string;
  /** Verifies the database is reachable. */
  pingDatabase(): Promise<void>;
  /** Identity recorded against approvals in this single-owner deployment. */
  ownerIdentity: string;
}

export interface RouteContext {
  deps: ApiDeps;
}

export type ProjectRecord = NonNullable<
  Awaited<ReturnType<ProjectsRepository["findById"]>>
>;
export type {
  ApprovalRecord,
  DeploymentRecord,
  ExecutionRecord,
  GeneratedFileRecord,
  RequirementsRecord,
  TaskRecord,
  TestResultRecord,
};

/** Input accepted by POST /api/projects after validation. */
export type CreateProjectRequest = CreateProjectInput;

export interface RuntimeInfo {
  engine: EngineName;
  configuredEngine: AppConfig["AUTODEV_ENGINE"];
  hasOpenAIKey: boolean;
  availableEngines: Array<{ name: EngineName; available: boolean; reason: string }>;
  sandbox: {
    image: string;
    dockerAvailable: boolean;
    memoryMb: number;
    cpus: number;
    pidsLimit: number;
    commandTimeoutMs: number;
  };
  workspacesRoot: string;
}
