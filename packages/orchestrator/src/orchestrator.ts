import {
  AgentsCodingEngine,
  ManagerAgent,
  SpecialistBench,
  architectureSchema,
  businessAnalysisSchema,
  deploymentSchema,
  managerPlanSchema,
  qaPlanSchema,
  reviewSchema,
  uxSchema,
  type Architecture,
  type BusinessAnalysis,
  type DeploymentPlan,
  type ManagerPlan,
  type QaPlan,
  type ReviewResult,
  type UxSpec,
} from "@autodev/agents";
import {
  ScaffoldEngine,
  createCodingEngine,
  type CodingEngine,
  type CodingEvent,
  type CodingTask,
} from "@autodev/coding";
import type {
  ArtifactsRepository,
  Database,
  ProjectRecord,
  ProjectsRepository,
  RequirementsRepository,
  TaskRecord,
  TasksRepository,
} from "@autodev/db";
import { GitRepo, type GitCheckpoint } from "@autodev/git";
import {
  SandboxManager,
  classifyCommand,
  type CommandRequest,
  type CommandResult,
} from "@autodev/sandbox";
import {
  PHASE_LABELS,
  type AppConfig,
  type EngineName,
  type Phase,
} from "@autodev/shared";

import { ApprovalRegistry } from "./approvals.js";
import { EventBus } from "./event-bus.js";
import { ORCHESTRATION_STEPS, STEP_PROGRESS_WEIGHT, stepKeyFromTaskInput, type OrchestrationStepKey } from "./plan.js";
import { runPlaywrightTests, type TestRunSummary } from "./qa-runner.js";
import {
  renderArchitecture,
  renderBusinessAnalysis,
  renderDeployment,
  renderEnvExample,
  renderManagerPlan,
  renderQaPlan,
  renderReview,
  renderUx,
} from "./render.js";
import {
  collectSourceFiles,
  ensureWorkspace,
  listWorkspaceFiles,
  loadArtifact,
  readWorkspaceText,
  resolveWorkspacePath,
  saveArtifact,
  writeWorkspaceFile,
} from "./workspace.js";

export class OrchestratorError extends Error {
  constructor(message: string, readonly details?: unknown) {
    super(message);
    this.name = "OrchestratorError";
  }
}

export class ApprovalRejectedError extends OrchestratorError {
  constructor(readonly approvalId: string, message = "The owner rejected the request") {
    super(message);
    this.name = "ApprovalRejectedError";
  }
}

export class OrchestratorCancelledError extends OrchestratorError {
  constructor(message = "The run was cancelled") {
    super(message);
    this.name = "OrchestratorCancelledError";
  }
}

export interface ProjectFacts {
  appName: string;
  description: string;
  requirements: string;
  techStack: string[];
}

export interface ArtifactEnvelopeLike<T> {
  artifact: T;
  source: "llm" | "local";
  fallbackReason?: string;
}

export interface ManagerPort {
  plan(facts: ProjectFacts): Promise<{
    plan: ManagerPlan;
    source: "llm" | "local";
    fallbackReason?: string;
  }>;
}

export interface BenchPort {
  businessAnalysis(facts: ProjectFacts): Promise<ArtifactEnvelopeLike<BusinessAnalysis>>;
  architecture(facts: ProjectFacts, analysis?: BusinessAnalysis): Promise<ArtifactEnvelopeLike<Architecture>>;
  ux(
    facts: ProjectFacts,
    analysis?: BusinessAnalysis,
    architecture?: Architecture,
  ): Promise<ArtifactEnvelopeLike<UxSpec>>;
  qa(facts: ProjectFacts, acceptanceCriteria: string[]): Promise<ArtifactEnvelopeLike<QaPlan>>;
  review(input: {
    facts: ProjectFacts;
    files: Array<{ path: string; content: string }>;
    testSummary: { total: number; passed: number; failed: number } | null;
  }): Promise<ArtifactEnvelopeLike<ReviewResult>>;
  deployment(facts: ProjectFacts): Promise<ArtifactEnvelopeLike<DeploymentPlan>>;
}

export interface GitPort {
  init(): Promise<void>;
  checkpoint(label: string): Promise<{ committed: boolean; commit: string | null }>;
  log(limit?: number): Promise<GitCheckpoint[]>;
}

export interface OrchestratorOptions {
  config: AppConfig;
  projects: ProjectsRepository;
  tasks: TasksRepository;
  artifacts: ArtifactsRepository;
  requirements: RequirementsRepository;
  events: EventBus;
  sandbox: SandboxManager;
  manager?: ManagerPort;
  bench?: BenchPort;
  engineFactory?: (name: EngineName) => CodingEngine;
  gitFactory?: (workspacePath: string) => GitPort;
  /** Bounded test-repair loop. Default 2. */
  maxRepairAttempts?: number;
  /** Bounded review-fix loop. Default 2. */
  maxReviewRounds?: number;
  /** How long an approval request may stay pending. Default 30 minutes. */
  approvalTimeoutMs?: number;
  logger?: (message: string, detail?: unknown) => void;
}

interface TestSnapshot {
  total: number;
  passed: number;
  failed: number;
}

interface RunState {
  managerPlan: ManagerPlan | null;
  analysis: BusinessAnalysis | null;
  architecture: Architecture | null;
  ux: UxSpec | null;
  qa: QaPlan | null;
  review: ReviewResult | null;
  deployment: DeploymentPlan | null;
  testSnapshot: TestSnapshot | null;
  lastCommit: string | null;
}

interface HandlerContext {
  project: ProjectRecord;
  task: TaskRecord;
  workspace: string;
  containerId: string;
  engine: CodingEngine;
  git: GitPort;
  state: RunState;
  facts: ProjectFacts;
}

type Handler = (context: HandlerContext) => Promise<Record<string, unknown>>;

export interface PreviewInfo {
  url: string | null;
  command: string;
}

/**
 * Owns the end-to-end pipeline: workspace, container, tasks, phases, repairs,
 * checkpoints and the owner approval gate.
 *
 * The orchestrator never runs code on the host. Every command and test goes
 * through `SandboxManager`, and every phase is persisted before it is announced
 * so the dashboard can reconstruct what happened from the database alone.
 */
export class Orchestrator {
  private readonly config: AppConfig;
  private readonly projects: ProjectsRepository;
  private readonly tasks: TasksRepository;
  private readonly artifacts: ArtifactsRepository;
  private readonly requirements: RequirementsRepository;
  private readonly events: EventBus;
  private readonly sandbox: SandboxManager;
  private readonly manager: ManagerPort;
  private readonly bench: BenchPort;
  private readonly engineFactory: (name: EngineName) => CodingEngine;
  private readonly gitFactory: (workspacePath: string) => GitPort;
  private readonly maxRepairAttempts: number;
  private readonly maxReviewRounds: number;
  private readonly approvalTimeoutMs: number;
  private readonly logger: (message: string, detail?: unknown) => void;

  private readonly approvals = new ApprovalRegistry();
  private readonly activeRuns = new Map<string, Promise<void>>();
  private readonly cancelled = new Set<string>();
  private readonly engines = new Map<EngineName, CodingEngine>();
  private readonly gitRepos = new Map<string, GitPort>();

  constructor(options: OrchestratorOptions) {
    this.config = options.config;
    this.projects = options.projects;
    this.tasks = options.tasks;
    this.artifacts = options.artifacts;
    this.requirements = options.requirements;
    this.events = options.events;
    this.sandbox = options.sandbox;
    this.logger = options.logger ?? ((message) => console.log(message));

    const runtime = {
      apiKey: this.config.OPENAI_API_KEY,
      model: this.config.AUTODEV_MODEL,
      baseUrl: this.config.OPENAI_BASE_URL,
    };
    this.manager = options.manager ?? new ManagerAgent(runtime);
    this.bench = options.bench ?? new SpecialistBench(runtime);
    this.engineFactory =
      options.engineFactory ??
      ((name) => (name === "openai-agents" ? new AgentsCodingEngine(runtime) : createCodingEngine(name, runtime)));
    this.gitFactory = options.gitFactory ?? ((workspacePath) => new GitRepo({ repoPath: workspacePath }));
    this.maxRepairAttempts = clampInt(options.maxRepairAttempts ?? 2, 0, 5);
    this.maxReviewRounds = clampInt(options.maxReviewRounds ?? 2, 0, 5);
    this.approvalTimeoutMs = options.approvalTimeoutMs ?? 30 * 60 * 1000;
  }

  isActive(projectId: string): boolean {
    return this.activeRuns.has(projectId);
  }

  /** Runs (or resumes) the pipeline. Concurrent calls share one run. */
  start(projectId: string): Promise<void> {
    const running = this.activeRuns.get(projectId);
    if (running) return running;

    this.cancelled.delete(projectId);
    const run = this.execute(projectId).finally(() => {
      this.activeRuns.delete(projectId);
    });
    this.activeRuns.set(projectId, run);
    return run;
  }

  async stop(projectId: string): Promise<void> {
    this.cancelled.add(projectId);
    this.approvals.cancelProject(projectId);

    const project = await this.requireProject(projectId);
    if (project.containerId) {
      await this.sandbox.removeContainer(project.containerId).catch((error) => {
        this.logger(`[orchestrator] failed to remove container for ${projectId}`, error);
      });
      await this.projects.update(projectId, { containerId: null });
    }

    await this.projects.setStatus(projectId, "cancelled", {
      finishedAt: new Date(),
      phase: null,
      progress: project.progress,
    });
    await this.events.publish({
      projectId,
      type: "project.cancelled",
      level: "warn",
      message: "Project cancelled by the owner",
      payload: {},
    });
  }

  /** Records the owner's decision and wakes a waiting run. */
  async decideApproval(
    approvalId: string,
    decision: "approved" | "rejected",
    decidedBy: string,
    note?: string,
  ): Promise<void> {
    const approval = await this.artifacts.findApproval(approvalId);
    if (!approval) throw new OrchestratorError(`Approval ${approvalId} not found`);
    if (approval.status !== "pending") {
      throw new OrchestratorError(`Approval ${approvalId} is already ${approval.status}`);
    }

    await this.artifacts.decideApproval(approvalId, decision, decidedBy, note);
    await this.events.publish({
      projectId: approval.projectId,
      type: "approval.decided",
      level: decision === "approved" ? "info" : "warn",
      message: `${approval.title}: ${decision}${note ? ` — ${note}` : ""}`,
      payload: { approvalId, decision, decidedBy },
    });
    this.approvals.settle(approvalId, decision);
  }

  async runCommand(
    projectId: string,
    request: Omit<CommandRequest, "projectId">,
  ): Promise<CommandResult> {
    const project = await this.requireProject(projectId);
    if (!project.containerId) throw new OrchestratorError("Project has no running sandbox container");

    const verdict = classifyCommand(request.command);
    if (verdict.decision === "deny") {
      throw new OrchestratorError(`Command blocked by policy: ${verdict.reason}`);
    }

    let approvalToken = request.approvalToken;
    if (verdict.decision === "requires_approval" && !approvalToken) {
      const outcome = await this.requestApproval({
        projectId,
        type: verdict.category,
        title: `Approve command: ${truncate(request.command, 80)}`,
        payload: { command: request.command, reason: verdict.reason },
      });
      if (outcome !== "approved") {
        throw new ApprovalRejectedError("", "Command was not approved");
      }
      approvalToken = "owner-approval";
    }

    await this.events.publish({
      projectId,
      type: "command.started",
      message: `$ ${request.command}`,
      payload: { command: request.command },
    });

    const result = await this.sandbox.exec(
      { ...request, projectId, containerId: project.containerId, approvalToken },
      {
        onChunk: (chunk) => {
          void this.events.publish({
            projectId,
            type: "command.output",
            level: "debug",
            message: chunk.chunk,
            payload: { stream: chunk.stream },
          });
        },
      },
    );

    await this.events.publish({
      projectId,
      type: "command.completed",
      level: result.exitCode === 0 ? "info" : "warn",
      message: `$ ${request.command} exited ${result.exitCode ?? "?"}`,
      payload: {
        command: request.command,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
      },
    });
    return result;
  }

  async previewInfo(projectId: string): Promise<PreviewInfo> {
    const project = await this.requireProject(projectId);
    if (!project.containerId) return { url: null, command: "" };
    const info = await this.sandbox.getInfo(project.containerId);
    return {
      url: info.previewPort ? `http://127.0.0.1:${info.previewPort}` : null,
      command: "node server.mjs",
    };
  }

  /** Starts the generated app inside the container on the published port. */
  async startPreview(projectId: string, command = "node server.mjs"): Promise<PreviewInfo> {
    const project = await this.requireProject(projectId);
    if (!project.containerId) throw new OrchestratorError("Project has no running sandbox container");

    const verdict = classifyCommand(command);
    if (verdict.decision === "deny") {
      throw new OrchestratorError(`Preview command blocked by policy: ${verdict.reason}`);
    }
    if (verdict.decision === "requires_approval") {
      throw new OrchestratorError(`Preview command requires approval: ${verdict.reason}`);
    }

    await this.sandbox.startDetached({
      containerId: project.containerId,
      projectId,
      command: `${command} > /tmp/preview.log 2>&1`,
    });

    const info = await this.sandbox.getInfo(project.containerId);
    const url = info.previewPort ? `http://127.0.0.1:${info.previewPort}` : null;

    await this.events.publish({
      projectId,
      type: "log",
      message: `Preview started: ${command}`,
      payload: { url, command },
    });
    return { url, command };
  }

  async stopPreview(projectId: string): Promise<void> {
    const project = await this.requireProject(projectId);
    if (!project.containerId) return;
    await this.sandbox.restartContainer(project.containerId);
    await this.events.publish({
      projectId,
      type: "log",
      message: "Preview stopped (container restarted)",
      payload: {},
    });
  }

  private async execute(projectId: string): Promise<void> {
    const project = await this.requireProject(projectId);
    const engine = this.engineFor(project.engine);

    await this.projects.setStatus(projectId, "running", {
      startedAt: project.startedAt ?? new Date(),
      finishedAt: null,
      error: null,
      phase: "intake",
    });

    try {
      if (!engine.isAvailable()) {
        throw new OrchestratorError(
          `Engine ${engine.name} is unavailable: ${engine.unavailableReason() ?? "missing credentials"}`,
        );
      }

      await this.events.publish({
        projectId,
        type: "project.started",
        message: `Starting ${project.name} with the ${engine.name} engine`,
        payload: { engine: engine.name, resumed: project.status !== "draft" },
      });

      const workspace = await ensureWorkspace(
        resolveWorkspacePath(this.config.workspacesRoot, projectId),
      );
      const git = await this.prepareGit(workspace);
      const container = await this.ensureContainer(project, workspace, project.containerId !== null);

      const state = await this.hydrateState(workspace);
      const tasks = await this.ensureTasks(projectId);
      const facts = projectFacts(project);

      await this.runTasks({
        project,
        tasks,
        workspace,
        containerId: container,
        engine,
        git,
        state,
        facts,
      });

      await this.projects.setStatus(projectId, "completed", {
        progress: 100,
        phase: null,
        finishedAt: new Date(),
        error: null,
      });
      await this.events.publish({
        projectId,
        type: "project.completed",
        message: `${project.name} is ready for owner review`,
        payload: {
          engine: engine.name,
          commit: state.lastCommit,
          tests: state.testSnapshot,
          review: state.review?.verdict ?? null,
        },
      });
    } catch (error) {
      await this.handleFailure(projectId, error);
      throw error;
    }
  }

  private async handleFailure(projectId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const wasCancelled =
      error instanceof OrchestratorCancelledError ||
      error instanceof ApprovalRejectedError ||
      this.cancelled.has(projectId);

    if (wasCancelled) {
      await this.projects.setStatus(projectId, "cancelled", {
        finishedAt: new Date(),
        phase: null,
        error: message,
      });
      await this.events.publish({
        projectId,
        type: "project.cancelled",
        level: "warn",
        message,
        payload: {},
      });
      return;
    }

    await this.projects.setStatus(projectId, "failed", {
      finishedAt: new Date(),
      error: message,
    });
    await this.events.publish({
      projectId,
      type: "project.failed",
      level: "error",
      message,
      payload: { error: message },
    });
  }

  private async prepareGit(workspace: string): Promise<GitPort> {
    const cached = this.gitRepos.get(workspace);
    if (cached) return cached;
    const git = this.gitFactory(workspace);
    await git.init();
    this.gitRepos.set(workspace, git);
    return git;
  }

  private async ensureContainer(
    project: ProjectRecord,
    workspace: string,
    restartExisting: boolean,
  ): Promise<string> {
    if (project.containerId) {
      const info = await this.sandbox.getInfo(project.containerId);
      if (info.running) {
        if (restartExisting) await this.sandbox.restartContainer(project.containerId);
        return project.containerId;
      }
    }

    const info = await this.sandbox.createContainer(project.id, workspace);
    await this.projects.update(project.id, { containerId: info.id });
    await this.events.publish({
      projectId: project.id,
      type: "log",
      message: `Sandbox container ${info.id.slice(0, 12)} started`,
      payload: { containerId: info.id, previewPort: info.previewPort },
    });
    return info.id;
  }

  private async ensureTasks(projectId: string): Promise<TaskRecord[]> {
    const existing = await this.tasks.listByProject(projectId);
    if (existing.length > 0) return existing;

    return this.tasks.createMany(
      projectId,
      ORCHESTRATION_STEPS.map((step, index) => ({
        phase: step.phase,
        role: step.role,
        title: step.title,
        orderIndex: index,
        input: { key: step.key },
      })),
    );
  }

  private async runTasks(input: {
    project: ProjectRecord;
    tasks: TaskRecord[];
    workspace: string;
    containerId: string;
    engine: CodingEngine;
    git: GitPort;
    state: RunState;
    facts: ProjectFacts;
  }): Promise<void> {
    const { project, tasks, state } = input;
    const handlers = this.handlers();
    const totalWeight = tasks.reduce((sum, task) => {
      const key = stepKeyFromTaskInput(task.input);
      return sum + (key ? STEP_PROGRESS_WEIGHT[key] : 0);
    }, 0);

    let completedWeight = 0;
    let currentPhase: Phase | null = null;

    for (const task of tasks) {
      if (this.cancelled.has(project.id)) {
        throw new OrchestratorCancelledError();
      }

      const key = stepKeyFromTaskInput(task.input);
      if (!key) throw new OrchestratorError(`Task ${task.id} has no recognised step key`);

      if (task.status === "succeeded" || task.status === "skipped") {
        completedWeight += STEP_PROGRESS_WEIGHT[key];
        const skippedPhase = task.phase;
        if (currentPhase && currentPhase !== skippedPhase) {
          await this.finishPhase(project.id, currentPhase);
        }
        currentPhase = skippedPhase;
        continue;
      }

      if (currentPhase && currentPhase !== task.phase) {
        await this.finishPhase(project.id, currentPhase);
      }
      if (currentPhase !== task.phase) {
        currentPhase = task.phase;
        await this.projects.setPhase(project.id, task.phase);
        await this.events.publish({
          projectId: project.id,
          type: "phase.started",
          message: `${PHASE_LABELS[task.phase]} started`,
          payload: { phase: task.phase },
        });
      }

      const handler = handlers[key];
      await this.executeTask(task, () =>
        handler({
          project,
          task,
          workspace: input.workspace,
          containerId: input.containerId,
          engine: input.engine,
          git: input.git,
          state,
          facts: input.facts,
        }),
      );

      completedWeight += STEP_PROGRESS_WEIGHT[key];
      const progress = totalWeight > 0 ? Math.min(99, Math.round((completedWeight / totalWeight) * 100)) : 0;
      await this.projects.setProgress(project.id, progress);
    }

    if (currentPhase) await this.finishPhase(project.id, currentPhase);
  }

  private async finishPhase(projectId: string, phase: Phase): Promise<void> {
    await this.events.publish({
      projectId,
      type: "phase.completed",
      message: `${PHASE_LABELS[phase]} completed`,
      payload: { phase },
    });
  }

  private async executeTask(
    task: TaskRecord,
    run: () => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const started = Date.now();
    await this.tasks.setStatus(task.id, "running", {
      startedAt: new Date(),
      error: null,
      attempt: task.attempt + 1,
    });
    await this.events.publish({
      projectId: task.projectId,
      type: "task.started",
      message: `[${task.role}] ${task.title}`,
      payload: { taskId: task.id, phase: task.phase, role: task.role },
    });

    try {
      const output = await run();
      await this.tasks.markSucceeded(task.id, output);
      await this.events.publish({
        projectId: task.projectId,
        type: "task.completed",
        message: `Completed: ${task.title}`,
        payload: { taskId: task.id, durationMs: Date.now() - started, output },
      });
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.tasks.markFailed(task.id, message);
      await this.events.publish({
        projectId: task.projectId,
        type: "task.failed",
        level: "error",
        message: `Failed: ${task.title} — ${message}`,
        payload: { taskId: task.id, error: message },
      });
      throw error;
    }
  }

  private handlers(): Record<OrchestrationStepKey, Handler> {
    return {
      intake: (ctx) => this.handleIntake(ctx),
      brd: (ctx) => this.handleBrd(ctx),
      architecture: (ctx) => this.handleArchitecture(ctx),
      ux: (ctx) => this.handleUx(ctx),
      implementation: (ctx) => this.handleImplementation(ctx),
      testing: (ctx) => this.handleTesting(ctx),
      review: (ctx) => this.handleReview(ctx),
      deployment: (ctx) => this.handleDeployment(ctx),
      approval: (ctx) => this.handleApproval(ctx),
    };
  }

  private async handleIntake(ctx: HandlerContext): Promise<Record<string, unknown>> {
    const result = await this.manager.plan(ctx.facts);
    ctx.state.managerPlan = result.plan;

    await this.writeDoc(ctx, "docs/DELIVERY-PLAN.md", renderManagerPlan(result.plan));
    await saveArtifact(ctx.workspace, "manager-plan", result.plan);

    await this.events.publish({
      projectId: ctx.project.id,
      type: "agent.message",
      level: result.source === "llm" ? "info" : "warn",
      message:
        result.source === "llm"
          ? `Manager Agent produced a delivery plan with ${result.plan.milestones.length} milestones`
          : `Manager Agent used the deterministic plan (${result.fallbackReason ?? "no LLM configured"})`,
      payload: { source: result.source, strategy: result.plan.strategy },
    });

    await this.checkpoint(ctx, "delivery plan");
    return {
      source: result.source,
      milestones: result.plan.milestones.length,
      risks: result.plan.risks.length,
    };
  }

  private async handleBrd(ctx: HandlerContext): Promise<Record<string, unknown>> {
    const envelope = await this.bench.businessAnalysis(ctx.facts);
    ctx.state.analysis = envelope.artifact;

    await this.requirements.save({
      projectId: ctx.project.id,
      brd: envelope.artifact.brd,
      userStories: envelope.artifact.userStories,
      acceptanceCriteria: envelope.artifact.acceptanceCriteria,
    });
    await this.writeDoc(ctx, "docs/BRD.md", renderBusinessAnalysis(envelope.artifact));
    await saveArtifact(ctx.workspace, "brd", envelope.artifact);
    await this.reportArtifact(ctx, "Business Analyst", envelope);
    await this.checkpoint(ctx, "business requirements");

    return {
      source: envelope.source,
      userStories: envelope.artifact.userStories.length,
      acceptanceCriteria: envelope.artifact.acceptanceCriteria.length,
    };
  }

  private async handleArchitecture(ctx: HandlerContext): Promise<Record<string, unknown>> {
    const analysis = ctx.state.analysis ?? (await this.loadAnalysis(ctx.project.id));
    const envelope = await this.bench.architecture(ctx.facts, analysis ?? undefined);
    ctx.state.architecture = envelope.artifact;

    await this.writeDoc(ctx, "docs/ARCHITECTURE.md", renderArchitecture(envelope.artifact));
    await saveArtifact(ctx.workspace, "architecture", envelope.artifact);
    await this.reportArtifact(ctx, "Solution Architect", envelope);
    await this.checkpoint(ctx, "solution architecture");

    return {
      source: envelope.source,
      components: envelope.artifact.components.length,
      endpoints: envelope.artifact.api.length,
    };
  }

  private async handleUx(ctx: HandlerContext): Promise<Record<string, unknown>> {
    const analysis = ctx.state.analysis ?? (await this.loadAnalysis(ctx.project.id));
    const envelope = await this.bench.ux(
      ctx.facts,
      analysis ?? undefined,
      ctx.state.architecture ?? (await this.loadArchitecture(ctx.workspace)) ?? undefined,
    );
    ctx.state.ux = envelope.artifact;

    await this.writeDoc(ctx, "docs/UX.md", renderUx(envelope.artifact));
    await saveArtifact(ctx.workspace, "ux", envelope.artifact);
    await this.reportArtifact(ctx, "UI/UX Designer", envelope);
    await this.checkpoint(ctx, "ux specification");

    return { source: envelope.source, screens: envelope.artifact.screens.length };
  }

  private async handleImplementation(ctx: HandlerContext): Promise<Record<string, unknown>> {
    const task: CodingTask = {
      projectId: ctx.project.id,
      workspacePath: ctx.workspace,
      appName: ctx.project.name,
      requirements: ctx.project.requirements,
      techStack: ctx.project.techStack,
      phaseContext: {
        brd: ctx.state.analysis ? renderBusinessAnalysis(ctx.state.analysis) : undefined,
        architecture: ctx.state.architecture
          ? renderArchitecture(ctx.state.architecture)
          : undefined,
        ux: ctx.state.ux ? renderUx(ctx.state.ux) : undefined,
      },
      instruction:
        "Implement the application described by the BRD, architecture and UX specification. " +
        "Deliver a runnable app with a health endpoint, responsive UI and Playwright tests.",
    };

    const sink = this.createCodingSink(ctx.project.id);
    let result;
    try {
      result = await ctx.engine.run(task, sink.push);
    } finally {
      await sink.flush();
    }

    const files = await listWorkspaceFiles(ctx.workspace);
    for (const file of files) {
      await this.artifacts.upsertFile({
        projectId: ctx.project.id,
        path: file.path,
        sha256: file.sha256,
        sizeBytes: file.sizeBytes,
        language: file.language,
      });
    }

    await this.checkpoint(ctx, "implementation");

    return {
      engine: result.engine,
      files: files.length,
      written: result.filesWritten.length,
      summary: truncate(result.summary, 1_000),
    };
  }

  private async handleTesting(ctx: HandlerContext): Promise<Record<string, unknown>> {
    const criteria = await this.acceptanceCriteria(ctx.project.id);
    const envelope = await this.bench.qa(ctx.facts, criteria);
    ctx.state.qa = envelope.artifact;
    await this.writeDoc(ctx, "docs/QA-PLAN.md", renderQaPlan(envelope.artifact));
    await saveArtifact(ctx.workspace, "qa-plan", envelope.artifact);
    await this.reportArtifact(ctx, "QA Automation", envelope);

    let summary = await this.runTests(ctx, "initial suite");
    let repairs = 0;

    while (summary.status !== "passed" && repairs < this.maxRepairAttempts) {
      repairs += 1;
      await this.events.publish({
        projectId: ctx.project.id,
        type: "log",
        level: "warn",
        message: `Repair attempt ${repairs}/${this.maxRepairAttempts}: ${summary.failed} failing test(s)`,
        payload: { failures: summary.failures },
      });

      await this.implementFix(ctx, `Fix the failing Playwright tests.\n\n${failureFeedback(summary)}`);
      await this.checkpoint(ctx, `test repair ${repairs}`);
      summary = await this.runTests(ctx, `repair ${repairs}`);
    }

    ctx.state.testSnapshot = {
      total: summary.total,
      passed: summary.passed,
      failed: summary.failed,
    };

    if (summary.status !== "passed") {
      throw new OrchestratorError(
        `Playwright suite did not pass after ${repairs} repair attempt(s): ${summary.failed} failing, ${summary.passed} passing`,
      );
    }
    if (summary.total === 0) {
      throw new OrchestratorError("Playwright collected no tests — treating this as a failure");
    }

    return {
      status: summary.status,
      total: summary.total,
      passed: summary.passed,
      failed: summary.failed,
      skipped: summary.skipped,
      repairs,
    };
  }

  private async handleReview(ctx: HandlerContext): Promise<Record<string, unknown>> {
    const testSummary = ctx.state.testSnapshot;
    let files = await collectSourceFiles(ctx.workspace);
    let envelope = await this.bench.review({ facts: ctx.facts, files, testSummary });

    let rounds = 0;
    while (envelope.artifact.verdict === "changes_requested" && rounds < this.maxReviewRounds) {
      const blocking = blockingIssues(envelope.artifact);
      if (blocking.length === 0) break;
      rounds += 1;

      await this.events.publish({
        projectId: ctx.project.id,
        type: "log",
        level: "warn",
        message: `Applying review fixes (round ${rounds}/${this.maxReviewRounds}) for ${blocking.length} blocking issue(s)`,
        payload: { issues: blocking },
      });

      await this.implementFix(
        ctx,
        [
          "Address the code review findings below, then keep the Playwright suite green.",
          ...envelope.artifact.issues.map(
            (issue) => `- [${issue.severity}] ${issue.file ?? "project"}: ${issue.issue} — ${issue.recommendation}`,
          ),
        ].join("\n"),
      );
      await this.checkpoint(ctx, `review fixes ${rounds}`);
      await this.runTests(ctx, `review round ${rounds}`);

      files = await collectSourceFiles(ctx.workspace);
      envelope = await this.bench.review({ facts: ctx.facts, files, testSummary });
    }

    ctx.state.review = envelope.artifact;
    await this.writeDoc(ctx, "docs/REVIEW.md", renderReview(envelope.artifact));
    await saveArtifact(ctx.workspace, "review", envelope.artifact);
    await this.reportArtifact(ctx, "Code Review", envelope);
    await this.checkpoint(ctx, "code review");

    const blocking = blockingIssues(envelope.artifact);
    if (blocking.length > 0) {
      throw new OrchestratorError(
        `Code review still reports ${blocking.length} critical/high issue(s): ${blocking
          .map((issue) => issue.issue)
          .join("; ")}`,
      );
    }

    return {
      source: envelope.source,
      verdict: envelope.artifact.verdict,
      issues: envelope.artifact.issues.length,
      rounds,
    };
  }

  private async handleDeployment(ctx: HandlerContext): Promise<Record<string, unknown>> {
    const envelope = await this.bench.deployment(ctx.facts);
    ctx.state.deployment = envelope.artifact;

    await this.writeDoc(ctx, "docs/DEPLOYMENT.md", renderDeployment(envelope.artifact));
    await this.writeDoc(ctx, ".env.example", renderEnvExample(envelope.artifact.envVars));
    if (envelope.artifact.compose.trim()) {
      await this.writeDoc(ctx, "deploy/compose.yaml", `${envelope.artifact.compose.trim()}\n`);
    }
    const hasDockerfile = (await readWorkspaceText(ctx.workspace, "Dockerfile")) !== null;
    if (!hasDockerfile && envelope.artifact.dockerfile.trim()) {
      await this.writeDoc(ctx, "Dockerfile", `${envelope.artifact.dockerfile.trim()}\n`);
    }

    await saveArtifact(ctx.workspace, "deployment", envelope.artifact);
    await this.reportArtifact(ctx, "Deployment Engineer", envelope);

    const version = ctx.state.lastCommit?.slice(0, 7) ?? `local-${Date.now().toString(36)}`;
    await this.artifacts.createDeployment({
      projectId: ctx.project.id,
      version,
      status: "prepared",
      details: {
        source: envelope.source,
        readyForProduction: envelope.artifact.readyForProduction,
        envVars: envelope.artifact.envVars.map((variable) => variable.name),
      },
    });

    await this.checkpoint(ctx, "deployment artifacts");

    return {
      source: envelope.source,
      version,
      envVars: envelope.artifact.envVars.length,
      readyForProduction: envelope.artifact.readyForProduction,
    };
  }

  private async handleApproval(ctx: HandlerContext): Promise<Record<string, unknown>> {
    const existing = (await this.artifacts.listApprovals(ctx.project.id)).find(
      (approval) =>
        approval.type === "production_deployment" &&
        (approval.status === "pending" || approval.status === "approved"),
    );

    if (existing?.status === "approved") {
      return { approvalId: existing.id, decision: "approved", resumed: true };
    }

    const approval =
      existing ??
      (await this.artifacts.createApproval({
        projectId: ctx.project.id,
        type: "production_deployment",
        title: `Approve production deployment of ${ctx.project.name}`,
        payload: {
          commit: ctx.state.lastCommit,
          engine: ctx.engine.name,
          tests: ctx.state.testSnapshot,
          review: ctx.state.review?.verdict ?? null,
        },
      }));

    await this.projects.setStatus(ctx.project.id, "awaiting_approval");
    await this.events.publish({
      projectId: ctx.project.id,
      type: "approval.requested",
      message: `Owner approval requested: ${approval.title}`,
      payload: { approvalId: approval.id, type: approval.type },
    });

    const outcome = await this.approvals.wait(approval.id, ctx.project.id, this.approvalTimeoutMs);
    if (outcome.status === "expired") {
      await this.artifacts.decideApproval(approval.id, "expired", "system", "approval timed out");
      throw new OrchestratorError(`Approval ${approval.id} timed out`);
    }
    if (this.cancelled.has(ctx.project.id)) {
      throw new OrchestratorCancelledError();
    }
    if (outcome.status !== "approved") {
      throw new ApprovalRejectedError(approval.id);
    }

    await this.projects.setStatus(ctx.project.id, "running");
    await this.events.publish({
      projectId: ctx.project.id,
      type: "log",
      message:
        "Owner approved the deployment artifacts. AutoDev prepared them but does not push to any production target.",
      payload: { approvalId: approval.id },
    });

    return { approvalId: approval.id, decision: "approved" };
  }

  private async requestApproval(input: {
    projectId: string;
    type: "dependency_install" | "destructive_command" | "production_deployment";
    title: string;
    payload: Record<string, unknown>;
  }): Promise<"approved" | "rejected" | "expired"> {
    const approval = await this.artifacts.createApproval(input);
    await this.projects.setStatus(input.projectId, "awaiting_approval");
    await this.events.publish({
      projectId: input.projectId,
      type: "approval.requested",
      message: `Owner approval requested: ${approval.title}`,
      payload: { approvalId: approval.id, type: approval.type, ...input.payload },
    });

    const outcome = await this.approvals.wait(approval.id, input.projectId, this.approvalTimeoutMs);
    if (outcome.status === "expired") {
      await this.artifacts.decideApproval(approval.id, "expired", "system", "approval timed out");
      return "expired";
    }

    if (!this.cancelled.has(input.projectId)) {
      await this.projects.setStatus(input.projectId, "running");
    }
    return outcome.status;
  }

  private async runTests(ctx: HandlerContext, label: string): Promise<TestRunSummary> {
    await this.events.publish({
      projectId: ctx.project.id,
      type: "test.started",
      message: `Running Playwright tests (${label})`,
      payload: { label },
    });

    const summary = await runPlaywrightTests({
      sandbox: this.sandbox,
      containerId: ctx.containerId,
      projectId: ctx.project.id,
    });

    await this.artifacts.recordTest({
      projectId: ctx.project.id,
      taskId: ctx.task.id,
      suite: `playwright:${label}`,
      status: summary.status,
      total: summary.total,
      passed: summary.passed,
      failed: summary.failed,
      skipped: summary.skipped,
      durationMs: summary.durationMs,
      report: {
        failures: summary.failures,
        exitCode: summary.exitCode,
        timedOut: summary.timedOut,
        output: summary.output,
      },
      artifacts: [],
    });

    await this.events.publish({
      projectId: ctx.project.id,
      type: "test.completed",
      level: summary.status === "passed" ? "info" : "error",
      message:
        summary.status === "passed"
          ? `Playwright: ${summary.passed}/${summary.total} passed`
          : `Playwright: ${summary.failed} failed, ${summary.passed} passed, ${summary.skipped} skipped`,
      payload: {
        status: summary.status,
        total: summary.total,
        passed: summary.passed,
        failed: summary.failed,
        skipped: summary.skipped,
        failures: summary.failures,
      },
    });

    return summary;
  }

  private async implementFix(ctx: HandlerContext, instruction: string): Promise<void> {
    const sink = this.createCodingSink(ctx.project.id);
    try {
      await ctx.engine.run(
        {
          projectId: ctx.project.id,
          workspacePath: ctx.workspace,
          appName: ctx.project.name,
          requirements: ctx.project.requirements,
          techStack: ctx.project.techStack,
          phaseContext: {
            brd: ctx.state.analysis ? renderBusinessAnalysis(ctx.state.analysis) : undefined,
            architecture: ctx.state.architecture ? renderArchitecture(ctx.state.architecture) : undefined,
            ux: ctx.state.ux ? renderUx(ctx.state.ux) : undefined,
            reviewFeedback: [instruction],
          },
          instruction,
        },
        sink.push,
      );
    } finally {
      await sink.flush();
    }
  }

  private createCodingSink(projectId: string): {
    push: (event: CodingEvent) => void;
    flush: () => Promise<void>;
  } {
    let chain: Promise<void> = Promise.resolve();

    const push = (event: CodingEvent): void => {
      chain = chain
        .then(async () => {
          if (event.type === "log") {
            await this.events.publish({
              projectId,
              type: "log",
              level: event.level ?? "info",
              message: event.message,
              payload: {},
            });
            return;
          }
          if (event.type === "file") {
            await this.events.publish({
              projectId,
              type: "file.written",
              message: `Wrote ${event.path}`,
              payload: { path: event.path },
            });
            return;
          }
          await this.events.publish({
            projectId,
            type: "command.completed",
            message: `$ ${event.command}`,
            payload: { command: event.command, exitCode: event.exitCode ?? null },
          });
        })
        .catch((error) => {
          this.logger(`[orchestrator] failed to publish coding event`, error);
        });
    };

    return { push, flush: () => chain };
  }

  private async writeDoc(ctx: HandlerContext, relativePath: string, content: string): Promise<void> {
    const written = await writeWorkspaceFile(ctx.workspace, relativePath, content);
    await this.artifacts.upsertFile({
      projectId: ctx.project.id,
      path: written.path,
      sha256: written.sha256,
      sizeBytes: written.sizeBytes,
      language: written.language,
    });
    await this.events.publish({
      projectId: ctx.project.id,
      type: "file.written",
      message: `Wrote ${written.path}`,
      payload: { path: written.path },
    });
  }

  private async checkpoint(ctx: HandlerContext, label: string): Promise<void> {
    const outcome = await ctx.git.checkpoint(label);
    if (!outcome.committed || !outcome.commit) return;
    ctx.state.lastCommit = outcome.commit;
    await this.events.publish({
      projectId: ctx.project.id,
      type: "checkpoint.created",
      message: `Git checkpoint: ${label} (${outcome.commit.slice(0, 7)})`,
      payload: { commit: outcome.commit, label },
    });
  }

  private async reportArtifact<T>(
    ctx: HandlerContext,
    label: string,
    envelope: ArtifactEnvelopeLike<T>,
  ): Promise<void> {
    await this.events.publish({
      projectId: ctx.project.id,
      type: "agent.message",
      level: envelope.source === "llm" ? "info" : "warn",
      message:
        envelope.source === "llm"
          ? `${label} produced its artifact with the LLM`
          : `${label} produced a deterministic artifact (${envelope.fallbackReason ?? "no LLM configured"})`,
      payload: { role: ctx.task.role, source: envelope.source },
    });
  }

  private async acceptanceCriteria(projectId: string): Promise<string[]> {
    const latest = await this.requirements.latest(projectId);
    if (!latest) return [];
    return latest.acceptanceCriteria.filter(
      (criterion): criterion is string => typeof criterion === "string" && criterion.trim().length > 0,
    );
  }

  private async loadAnalysis(projectId: string): Promise<BusinessAnalysis | null> {
    const latest = await this.requirements.latest(projectId);
    if (!latest) return null;
    const parsed = businessAnalysisSchema.safeParse({
      brd: latest.brd ?? "",
      userStories: latest.userStories,
      acceptanceCriteria: latest.acceptanceCriteria,
      openQuestions: [],
    });
    return parsed.success ? parsed.data : null;
  }

  private async loadArchitecture(workspace: string): Promise<Architecture | null> {
    return loadArtifact(workspace, "architecture", (value) => architectureSchema.parse(value));
  }

  private async hydrateState(workspace: string): Promise<RunState> {
    const state: RunState = {
      managerPlan: await loadArtifact(workspace, "manager-plan", (value) => managerPlanSchema.parse(value)),
      analysis: null,
      architecture: await loadArtifact(workspace, "architecture", (value) => architectureSchema.parse(value)),
      ux: await loadArtifact(workspace, "ux", (value) => uxSchema.parse(value)),
      qa: await loadArtifact(workspace, "qa-plan", (value) => qaPlanSchema.parse(value)),
      review: await loadArtifact(workspace, "review", (value) => reviewSchema.parse(value)),
      deployment: await loadArtifact(workspace, "deployment", (value) => deploymentSchema.parse(value)),
      testSnapshot: null,
      lastCommit: null,
    };
    return state;
  }

  private engineFor(name: EngineName): CodingEngine {
    const cached = this.engines.get(name);
    if (cached) return cached;
    const engine = this.engineFactory(name);
    if (!engine) throw new OrchestratorError(`No engine registered for ${name}`);
    this.engines.set(name, engine);
    return engine;
  }

  private async requireProject(projectId: string): Promise<ProjectRecord> {
    const project = await this.projects.findById(projectId);
    if (!project) throw new OrchestratorError(`Project ${projectId} not found`);
    return project;
  }
}

function projectFacts(project: ProjectRecord): ProjectFacts {
  return {
    appName: project.name,
    description: project.description,
    requirements: project.requirements,
    techStack: project.techStack,
  };
}

function blockingIssues(review: ReviewResult): ReviewResult["issues"] {
  return review.issues.filter((issue) => issue.severity === "critical" || issue.severity === "high");
}

function failureFeedback(summary: TestRunSummary): string {
  const lines = [
    `Playwright reported ${summary.failed} failing test(s) out of ${summary.total}.`,
    ...summary.failures.map((failure) => `- ${failure.title}: ${failure.message}`),
  ];
  if (summary.output) lines.push("Output tail:", summary.output.slice(-3_000));
  return lines.join("\n");
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** Unused import guard: keeps the type available for adapter construction. */
export type { Database };
