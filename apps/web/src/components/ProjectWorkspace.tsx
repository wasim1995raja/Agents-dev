"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PHASE_LABELS } from "@autodev/shared/domain";

import { ActivityFeed } from "@/components/ActivityFeed";
import { ApprovalPanel } from "@/components/ApprovalPanel";
import { CommitList } from "@/components/CommitList";
import { FileExplorer } from "@/components/FileExplorer";
import { PhaseStepper } from "@/components/PhaseStepper";
import { PreviewPanel } from "@/components/PreviewPanel";
import { RequirementsPanel } from "@/components/RequirementsPanel";
import { TaskList } from "@/components/TaskList";
import { TerminalPanel } from "@/components/TerminalPanel";
import { TestResults } from "@/components/TestResults";
import { Badge, EmptyState, ProgressBar, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { mergeEvents, shouldRefreshDetail } from "@/lib/events";
import { formatDateTime, formatDuration, statusLabel } from "@/lib/format";
import { summarizeTasks } from "@/lib/progress";
import type {
  ActivityEvent,
  Deployment,
  GitCheckpoint,
  ProjectDetail,
} from "@/lib/types";
import { useProjectStream } from "@/lib/useProjectStream";

const TABS = [
  { key: "activity", label: "Agent activity" },
  { key: "files", label: "Files" },
  { key: "tests", label: "Tests" },
  { key: "terminal", label: "Terminal" },
  { key: "tasks", label: "Tasks" },
  { key: "requirements", label: "Requirements" },
  { key: "commits", label: "Checkpoints" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function DeploymentCard({ deployments }: { deployments: Deployment[] }) {
  if (deployments.length === 0) {
    return (
      <EmptyState title="No deployment artifacts">
        The Deployment agent prepares a Dockerfile and release notes, then requests
        owner approval before production deployment.
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      {deployments.map((deployment) => (
        <article className="task-row" key={deployment.id}>
          <div className="task-top">
            <span className="task-title">
              {deployment.version} {deployment.image ? `· ${deployment.image}` : ""}
            </span>
            <Badge
              small
              tone={
                deployment.status === "deployed"
                  ? "positive"
                  : deployment.status === "failed"
                    ? "negative"
                    : deployment.status === "prepared"
                      ? "warning"
                      : "neutral"
              }
            >
              {deployment.status}
            </Badge>
          </div>
          <div className="task-meta">
            <span>prepared {formatDateTime(deployment.createdAt)}</span>
          </div>
          {Object.keys(deployment.details ?? {}).length > 0 ? (
            <pre className="doc-json mt-8">{JSON.stringify(deployment.details, null, 2)}</pre>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const router = useRouter();

  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [commits, setCommits] = useState<GitCheckpoint[]>([]);
  const [fileCount, setFileCount] = useState<number | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("activity");
  const [busy, setBusy] = useState<string | null>(null);
  const [filesKey, setFilesKey] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const refreshTimer = useRef<number | null>(null);

  const loadDetail = useCallback(async () => {
    try {
      const [nextDetail, nextCommits, nextFiles] = await Promise.all([
        api.getProject(projectId),
        api.listCommits(projectId).catch(() => ({ items: [] as GitCheckpoint[] })),
        api.listFiles(projectId).catch(() => ({ items: [], count: 0 })),
      ]);
      setDetail(nextDetail);
      setCommits(nextCommits.items);
      setFileCount(nextFiles.count);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  const loadEvents = useCallback(async () => {
    try {
      const { items } = await api.listEvents(projectId, 500);
      setEvents((current) => mergeEvents(current, items));
    } catch {
      // The live stream is the primary source; a failed replay is not fatal.
    }
  }, [projectId]);

  useEffect(() => {
    void loadDetail();
    void loadEvents();
  }, [loadDetail, loadEvents]);

  const handleEvent = useCallback(
    (event: ActivityEvent) => {
      setEvents((current) => mergeEvents(current, event));

      if (
        event.type === "file.written" ||
        event.type === "checkpoint.created" ||
        event.type === "project.completed"
      ) {
        setFilesKey((key) => key + 1);
      }

      if (shouldRefreshDetail(event.type)) {
        if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(() => {
          refreshTimer.current = null;
          void loadDetail();
        }, 600);
      }
    },
    [loadDetail],
  );

  const streamStatus = useProjectStream(projectId, handleEvent);

  const project = detail?.project;
  const running = project?.status === "running" || project?.status === "queued";

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void loadDetail(), 5_000);
    return () => window.clearInterval(timer);
  }, [running, loadDetail]);

  useEffect(
    () => () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    },
    [],
  );

  const summary = useMemo(() => summarizeTasks(detail?.tasks ?? []), [detail?.tasks]);
  const pendingApproval = detail?.approvals.find((approval) => approval.status === "pending");
  const latestTest = detail?.tests[0];

  async function start() {
    setBusy("start");
    setNotice(null);
    setError(null);
    try {
      await api.startProject(projectId);
      setNotice("Run accepted by the orchestrator. Progress streams below as it happens.");
      await loadDetail();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    setBusy("cancel");
    setNotice(null);
    setError(null);
    try {
      await api.cancelProject(projectId);
      setNotice("Cancellation requested. The orchestrator stops after the current step.");
      await loadDetail();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!project) return;
    const confirmed = window.confirm(
      `Delete "${project.name}" and its generated workspace? This cannot be undone.`,
    );
    if (!confirmed) return;

    setBusy("delete");
    setError(null);
    try {
      await api.deleteProject(projectId);
      router.push("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(null);
    }
  }

  if (!loaded && !detail) {
    return (
      <div className="shell page">
        <div className="skeleton" style={{ height: 40, width: 260, marginBottom: 18 }} />
        <div className="skeleton" style={{ height: 190, marginBottom: 18 }} />
        <div className="skeleton" style={{ height: 420 }} />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="shell page">
        <div className="alert alert-error" role="alert">
          {error ?? "Project not found."}
        </div>
        <Link className="btn mt-16" href="/">
          Back to projects
        </Link>
      </div>
    );
  }

  return (
    <div className="shell page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Projects</Link>
        <span aria-hidden="true">/</span>
        <span>{project.name}</span>
      </nav>

      <div className="project-hero">
        <div>
          <h1>{project.name}</h1>
          <p className="description">{project.description}</p>
          <div className="project-hero-meta">
            <StatusBadge status={project.status} />
            <Badge tone="neutral" small>
              <span className="mono">{project.engine}</span> engine
            </Badge>
            {project.phase ? (
              <Badge tone="active" small>
                {PHASE_LABELS[project.phase]}
              </Badge>
            ) : null}
            <span className="panel-sub">created {formatDateTime(project.createdAt)}</span>
            <Badge
              tone={
                streamStatus === "live"
                  ? "positive"
                  : streamStatus === "reconnecting"
                    ? "warning"
                    : "neutral"
              }
              small
            >
              <span
                className={`dot${streamStatus === "live" ? " dot-pulse" : ""}`}
                aria-hidden="true"
              />
              {streamStatus === "live"
                ? "live stream"
                : streamStatus === "reconnecting"
                  ? "reconnecting"
                  : "stream off"}
            </Badge>
          </div>
        </div>

        <div className="btn-row">
          {running ? (
            <button className="btn btn-danger" type="button" onClick={() => void cancel()} disabled={busy !== null}>
              {busy === "cancel" ? <span className="spinner" aria-hidden="true" /> : null}
              Cancel run
            </button>
          ) : (
            <button className="btn btn-primary" type="button" onClick={() => void start()} disabled={busy !== null}>
              {busy === "start" ? <span className="spinner" aria-hidden="true" /> : null}
              {project.status === "draft" ? "Start development" : "Run again"}
            </button>
          )}
          <a className="btn" href={api.sourceUrl(projectId)}>
            Download source
          </a>
          <button className="btn btn-ghost" type="button" onClick={() => void loadDetail()}>
            Refresh
          </button>
          <button
            className="btn btn-danger btn-ghost"
            type="button"
            onClick={() => void remove()}
            disabled={busy !== null || running}
            title={running ? "Cancel the run before deleting" : "Delete project and workspace"}
          >
            Delete
          </button>
        </div>
      </div>

      {pendingApproval ? (
        <div className="approval-banner" role="status">
          <div>
            <strong>Owner approval required.</strong>{" "}
            <span className="muted">
              {pendingApproval.title} — the orchestrator is paused until you decide.
            </span>
          </div>
          <a className="btn btn-primary btn-sm" href="#approvals">
            Review approval
          </a>
        </div>
      ) : null}

      {project.error ? (
        <div className="alert alert-error mb-16" role="alert">
          <strong>Run error.</strong> {project.error}
        </div>
      ) : null}

      {error ? (
        <div className="alert alert-error mb-16" role="alert">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="alert alert-success mb-16" role="status">
          {notice}
        </div>
      ) : null}

      <section className="panel overview-panel">
        <div className="panel-header">
          <div>
            <h2>Development progress</h2>
            <p className="panel-sub">
              {project.status === "completed"
                ? "Every phase completed and recorded."
                : project.phase
                  ? `${PHASE_LABELS[project.phase]} · ${statusLabel(project.status)}`
                  : "Waiting for the run to start."}
            </p>
          </div>
          <span className="badge badge-neutral mono">{project.progress}%</span>
        </div>
        <div className="panel-body">
          <ProgressBar value={project.progress} large label="Overall progress" />
          <PhaseStepper project={project} tasks={detail.tasks} />

          <div className="stat-grid">
            <div className="stat">
              <div className="stat-value">
                {summary.succeeded}/{summary.total}
              </div>
              <div className="stat-label">Tasks succeeded</div>
            </div>
            <div className="stat">
              <div className="stat-value">{summary.failed}</div>
              <div className="stat-label">Tasks failed</div>
            </div>
            <div className="stat">
              <div className="stat-value">
                {latestTest ? `${latestTest.passed}/${latestTest.total}` : "—"}
              </div>
              <div className="stat-label">Tests passing</div>
            </div>
            <div className="stat">
              <div className="stat-value">{commits.length}</div>
              <div className="stat-label">Git checkpoints</div>
            </div>
            <div className="stat">
              <div className="stat-value">{fileCount ?? "—"}</div>
              <div className="stat-label">Generated files</div>
            </div>
            <div className="stat">
              <div className="stat-value">
                {latestTest ? formatDuration(latestTest.durationMs) : "—"}
              </div>
              <div className="stat-label">Latest test duration</div>
            </div>
          </div>
        </div>
      </section>

      <div className="workspace-grid">
        <section className="panel" style={{ minWidth: 0 }}>
          <div className="tabs" role="tablist" aria-label="Project panels">
            {TABS.map((entry) => {
              const count =
                entry.key === "activity"
                  ? events.length
                  : entry.key === "files"
                    ? (fileCount ?? 0)
                    : entry.key === "tests"
                      ? (detail?.tests.length ?? 0)
                      : entry.key === "tasks"
                        ? (detail?.tasks.length ?? 0)
                        : entry.key === "commits"
                          ? commits.length
                          : null;
              return (
                <button
                  key={entry.key}
                  type="button"
                  role="tab"
                  className="tab"
                  aria-selected={tab === entry.key}
                  onClick={() => setTab(entry.key)}
                >
                  {entry.label}
                  {count !== null ? <span className="tab-count">{count}</span> : null}
                </button>
              );
            })}
          </div>

          <div className="tab-panel" role="tabpanel">
            {tab === "activity" ? <ActivityFeed events={events} /> : null}
            {tab === "files" ? <FileExplorer projectId={projectId} refreshKey={filesKey} /> : null}
            {tab === "tests" ? <TestResults tests={detail?.tests ?? []} /> : null}
            {tab === "terminal" ? (
              <TerminalPanel
                projectId={projectId}
                events={events}
                canRun={Boolean(project.startedAt)}
              />
            ) : null}
            {tab === "tasks" ? <TaskList tasks={detail?.tasks ?? []} /> : null}
            {tab === "requirements" ? (
              <RequirementsPanel requirements={detail?.requirements ?? null} />
            ) : null}
            {tab === "commits" ? <CommitList commits={commits} /> : null}
          </div>
        </section>

        <aside className="workspace-side">
          <section className="panel" id="preview">
            <div className="panel-header">
              <div>
                <h3>Application preview</h3>
                <p className="panel-sub">Served from the project container.</p>
              </div>
            </div>
            <div className="panel-body">
              <PreviewPanel
                projectId={projectId}
                status={project.status}
                refreshKey={filesKey + events.length}
              />
            </div>
          </section>

          <section className="panel" id="approvals">
            <div className="panel-header">
              <div>
                <h3>Approvals</h3>
                <p className="panel-sub">Destructive actions and releases are gated.</p>
              </div>
              {pendingApproval ? <Badge tone="warning" small>1 pending</Badge> : null}
            </div>
            <div className="panel-body">
              <ApprovalPanel
                approvals={detail?.approvals ?? []}
                onDecided={() => {
                  void loadDetail();
                  setNotice("Decision recorded. The orchestrator resumes on approval.");
                }}
              />
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h3>Deployment history</h3>
                <p className="panel-sub">Prepared artifacts and release status.</p>
              </div>
            </div>
            <div className="panel-body">
              <DeploymentCard deployments={detail?.deployments ?? []} />
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
