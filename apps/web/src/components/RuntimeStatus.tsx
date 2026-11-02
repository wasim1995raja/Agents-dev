"use client";

import { useEffect, useState } from "react";

import { api, probeHealth } from "@/lib/api";
import type { HealthInfo, RuntimeInfo } from "@/lib/types";

/**
 * Header truth-teller. It reports only what the API actually confirms:
 * database reachability, Docker availability and which coding engines can run
 * right now. When the API is unreachable it says so instead of guessing.
 */
export function RuntimeStatus() {
  const [health, setHealth] = useState<
    (HealthInfo & { reachable: true }) | { reachable: false; error: string } | null
  >(null);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [healthResult, runtimeResult] = await Promise.all([
        probeHealth(),
        api.runtime().catch(() => null),
      ]);
      if (cancelled) return;
      setHealth(healthResult);
      setRuntime(runtimeResult);
    }

    void load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!health) {
    return (
      <div className="header-meta">
        <span className="badge badge-neutral">
          <span className="spinner" aria-hidden="true" /> Checking API
        </span>
      </div>
    );
  }

  if (!health.reachable) {
    return (
      <div className="header-meta">
        <span className="badge badge-negative" title={health.error}>
          <span className="dot" aria-hidden="true" /> API unreachable
        </span>
        <span className="badge badge-neutral badge-hide-sm">Start the API on :3001</span>
      </div>
    );
  }

  const dbOk = health.database === "up";
  const dockerOk = runtime?.sandbox.dockerAvailable ?? null;
  const key = runtime?.hasOpenAIKey ?? false;

  return (
    <div className="header-meta">
      <span
        className={`badge ${dbOk ? "badge-positive" : "badge-negative"}`}
        title={health.detail ?? "Database probe"}
      >
        <span className="dot" aria-hidden="true" /> DB {dbOk ? "up" : "down"}
      </span>
      <span
        className={`badge ${dockerOk === null ? "badge-neutral" : dockerOk ? "badge-positive" : "badge-negative"}`}
        title={runtime?.sandbox.dockerError ?? "Docker sandbox probe"}
      >
        <span className="dot" aria-hidden="true" /> Docker{" "}
        {dockerOk === null ? "unknown" : dockerOk ? "ready" : "offline"}
      </span>
      <span className={`badge ${key ? "badge-info" : "badge-neutral"} badge-hide-sm`}>
        Engine {runtime?.engine ?? health.engine}
      </span>
      {runtime && !key ? (
        <span className="badge badge-warning badge-hide-sm" title="Set OPENAI_API_KEY to enable model engines">
          No OPENAI_API_KEY
        </span>
      ) : null}
    </div>
  );
}
