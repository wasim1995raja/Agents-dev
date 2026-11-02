"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { RuntimeInfo } from "@/lib/types";
import { CreateProjectForm } from "@/components/CreateProjectForm";
import { ProjectHistory } from "@/components/ProjectHistory";

const CAPABILITIES = [
  { role: "Manager", note: "plans phases and delegates" },
  { role: "Business analyst", note: "BRD, user stories, acceptance criteria" },
  { role: "Solution architect", note: "stack, schema, API contracts" },
  { role: "UI/UX", note: "screens, navigation, layout" },
  { role: "Frontend + backend", note: "real files in a Docker workspace" },
  { role: "QA automation", note: "Playwright suites, failure feedback" },
  { role: "Code review", note: "security and requirement checks" },
  { role: "Deployment", note: "Dockerfile, release gate, owner approval" },
];

export default function HomePage() {
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [projectCount, setProjectCount] = useState<number | null>(null);

  useEffect(() => {
    api
      .runtime()
      .then((info) => {
        setRuntime(info);
        setRuntimeError(null);
      })
      .catch((error: unknown) => {
        setRuntime(null);
        setRuntimeError(error instanceof Error ? error.message : String(error));
      });
  }, []);

  const handleCount = useCallback((count: number) => setProjectCount(count), []);

  return (
    <div className="shell page">
      <section className="hero">
        <div>
          <p className="kicker">Manager + specialist agents</p>
          <h1>From an idea to a tested, reviewed application.</h1>
          <p className="lede">
            Describe the product and the stack. AutoDev Agent analyses the
            requirements, writes the BRD and architecture, builds the app, runs
            Playwright tests, repairs failures, reviews the code and prepares a
            deployment — then waits for your approval.
          </p>
          <ul className="hero-points">
            <li>Per-project Docker workspace</li>
            <li>Git checkpoints at every milestone</li>
            <li>Destructive actions gated on approval</li>
            <li>Full activity log and live stream</li>
          </ul>
        </div>

        <div className="panel pad">
          <h2 style={{ fontSize: 15, marginBottom: 4 }}>Agents on this run</h2>
          <p className="panel-sub" style={{ marginBottom: 14 }}>
            Every specialist produces a persisted artifact — nothing is simulated.
          </p>
          <ul className="stack" style={{ gap: 9 }}>
            {CAPABILITIES.map((capability) => (
              <li key={capability.role} style={{ display: "flex", gap: 10 }}>
                <span
                  className="dot"
                  style={{ color: "var(--accent)", marginTop: 8, flex: "none" }}
                  aria-hidden="true"
                />
                <span style={{ fontSize: 13.5 }}>
                  <strong style={{ fontWeight: 620 }}>{capability.role}</strong>{" "}
                  <span className="faint">— {capability.note}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {runtimeError ? (
        <div className="alert alert-error mb-16" role="alert">
          The API is not reachable at the configured base URL: {runtimeError}. Start it
          with <code className="mono">pnpm dev:api</code> or set{" "}
          <code className="mono">NEXT_PUBLIC_API_BASE_URL</code>.
        </div>
      ) : null}

      {runtime && !runtime.sandbox.dockerAvailable ? (
        <div className="alert alert-warning mb-16" role="status">
          Docker is not available, so runs cannot execute commands inside the sandbox.
          {runtime.sandbox.dockerError ? ` (${runtime.sandbox.dockerError})` : ""}
        </div>
      ) : null}

      <div className="grid-2" style={{ gap: 20, alignItems: "start", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1.4fr)" }}>
        <section className="panel" id="new-project">
          <div className="panel-header">
            <div>
              <h2>Create new project</h2>
              <p className="panel-sub">Idea → requirements → stack → start development.</p>
            </div>
            <span className="badge badge-info badge-sm">
              {runtime ? `${runtime.engine} engine` : "engine check"}
            </span>
          </div>
          <div className="panel-body">
            <CreateProjectForm
              runtime={runtime}
              onCreated={() => setRefreshKey((key) => key + 1)}
            />
          </div>
        </section>

        <section className="panel" id="projects">
          <div className="panel-header">
            <div>
              <h2>Project history</h2>
              <p className="panel-sub">
                Every project, its live phase and available artifacts.
              </p>
            </div>
            <span className="badge badge-neutral badge-sm">
              {projectCount === null ? "…" : `${projectCount} total`}
            </span>
          </div>
          <ProjectHistory refreshKey={refreshKey} onCount={handleCount} />
        </section>
      </div>
    </div>
  );
}
