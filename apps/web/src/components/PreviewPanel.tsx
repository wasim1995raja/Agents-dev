"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { PreviewInfo, ProjectStatus } from "@/lib/types";

/**
 * Live preview of the generated application. The URL is the sandbox's published
 * loopback port, so the iframe can only reach the project's own container.
 */
export function PreviewPanel({
  projectId,
  status,
  refreshKey,
}: {
  projectId: string;
  status: ProjectStatus;
  refreshKey: number;
}) {
  const [info, setInfo] = useState<PreviewInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.previewInfo(projectId);
      setInfo(result);
      setError(null);
    } catch (cause) {
      setInfo(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (status !== "running" || info?.url) return;
    const timer = window.setInterval(load, 4_000);
    return () => window.clearInterval(timer);
  }, [info?.url, load, status]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.startPreview(projectId);
      setInfo(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      await api.stopPreview(projectId);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="preview-frame">
        {info?.url ? (
          <iframe src={info.url} title="Application preview" loading="lazy" />
        ) : (
          <div className="preview-placeholder">
            <strong>{status === "running" ? "Starting the dev server…" : "No preview running"}</strong>
            <span>
              The generated app is served by a process inside the project's Docker
              container. Start it to inspect the running application.
            </span>
          </div>
        )}
      </div>

      {error ? (
        <div className="alert alert-error mt-12" role="alert">
          {error}
        </div>
      ) : null}

      {info?.url ? (
        <div className="preview-url">
          <span className="badge badge-positive badge-sm">live</span>
          <a href={info.url} target="_blank" rel="noreferrer">
            {info.url}
          </a>
        </div>
      ) : null}

      <div className="btn-row mt-12">
        <button className="btn btn-sm" type="button" onClick={() => void start()} disabled={busy}>
          {busy ? <span className="spinner" aria-hidden="true" /> : "Start preview"}
        </button>
        <button
          className="btn btn-sm btn-ghost"
          type="button"
          onClick={() => void stop()}
          disabled={busy || !info?.url}
        >
          Stop
        </button>
        <button className="btn btn-sm btn-ghost" type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <p className="field-hint mt-8">
        Command: <code className="mono">{info?.command ?? "—"}</code>
      </p>
    </div>
  );
}
