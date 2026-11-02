"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { formatDateTime, formatPercent, statusLabel } from "@/lib/format";
import type { Project } from "@/lib/types";
import { EmptyState, ProgressBar, StatusBadge } from "./ui";

/**
 * Project history backed by the API. It polls only while a project is running
 * so finished projects do not generate needless traffic.
 */
export function ProjectHistory({
  refreshKey = 0,
  onCount,
}: {
  refreshKey?: number;
  onCount?: (count: number) => void;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { items } = await api.listProjects(50);
      setProjects(items);
      setError(null);
      onCount?.(items.length);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setProjects([]);
    }
  }, [onCount]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const busy = projects?.some(
      (project) => project.status === "running" || project.status === "queued",
    );
    if (!busy) return;
    const timer = window.setInterval(load, 5_000);
    return () => window.clearInterval(timer);
  }, [load, projects]);

  if (projects === null) {
    return (
      <div className="stack">
        <div className="skeleton" style={{ height: 74 }} />
        <div className="skeleton" style={{ height: 74 }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-error" role="alert">
        Could not load projects: {error}
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <EmptyState title="No projects yet">
        Describe an application above and AutoDev Agent will plan, build, test and
        prepare it for deployment.
      </EmptyState>
    );
  }

  return (
    <div className="project-list divided">
      {projects.map((project) => (
        <div className="project-row" key={project.id}>
          <div>
            <Link className="project-name" href={`/projects/${project.id}`}>
              {project.name}
            </Link>
            <div className="project-meta">{project.description}</div>
          </div>

          <div className="col-status">
            <StatusBadge status={project.status} />
          </div>

          <div className="col-engine">
            <span className="badge badge-neutral badge-sm mono">{project.engine}</span>
          </div>

          <div className="col-progress">
            <ProgressBar value={project.progress} label={`${project.name} progress`} />
            <div className="project-meta">
              {project.phase ? statusLabel(project.status) : "not started"}
            </div>
          </div>

          <div className="project-meta col-updated">{formatDateTime(project.updatedAt)}</div>

          <div className="project-actions">
            <Link className="btn btn-sm" href={`/projects/${project.id}`}>
              Open
            </Link>
            <a
              className="btn btn-sm btn-ghost"
              href={api.sourceUrl(project.id)}
              title="Download generated source as a zip"
            >
              Source
            </a>
          </div>
        </div>
      ))}
      <div className="project-meta" style={{ padding: "10px 20px", borderTop: "1px solid var(--border)" }}>
        {projects.length} project{projects.length === 1 ? "" : "s"} ·{" "}
        {projects.filter((project) => project.status === "completed").length} completed ·{" "}
        {formatPercent(
          (projects.filter((project) => project.status === "completed").length /
            projects.length) *
            100,
        )}{" "}
        completion rate
      </div>
    </div>
  );
}
