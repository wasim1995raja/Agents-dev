"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { TECH_STACK_OPTIONS } from "@autodev/shared/options";

import { ApiError, api, fieldIssues } from "@/lib/api";
import type { EngineName, FieldIssue, RuntimeInfo } from "@/lib/types";

const ENGINE_COPY: Record<EngineName, string> = {
  scaffold: "Deterministic generator · no credentials, real files, runs offline",
  codex: "Codex SDK · model-driven coding inside the sandbox",
  "openai-agents": "OpenAI Agents SDK · tool-using specialist agents",
};

const DEFAULT_STACK = ["typescript", "nodejs", "playwright"] as const;

export function CreateProjectForm({
  runtime,
  onCreated,
}: {
  runtime: RuntimeInfo | null;
  onCreated?: () => void;
}) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [requirements, setRequirements] = useState("");
  const [stack, setStack] = useState<string[]>([...DEFAULT_STACK]);
  const [engine, setEngine] = useState<EngineName | "">("");
  const [autoStart, setAutoStart] = useState(true);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (engine || !runtime) return;
    setEngine(runtime.engine);
  }, [engine, runtime]);

  const engines = useMemo(() => {
    const list = runtime?.availableEngines ?? [
      { name: "scaffold" as EngineName, available: true, reason: ENGINE_COPY.scaffold },
    ];
    return list;
  }, [runtime]);

  const issuesFor = (path: string) => issues.filter((issue) => issue.path === path);

  function toggleStack(value: string) {
    setStack((current) =>
      current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value],
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setIssues([]);

    if (stack.length === 0) {
      setFormError("Select at least one technology for the generated project.");
      return;
    }

    setSubmitting(true);
    try {
      const { project } = await api.createProject({
        name,
        description,
        requirements,
        techStack: stack,
        ...(engine ? { engine } : {}),
        autoStart,
      });
      onCreated?.();
      router.push(`/projects/${project.id}`);
    } catch (error) {
      if (error instanceof ApiError) {
        setIssues(fieldIssues(error));
        setFormError(error.message);
      } else {
        setFormError(error instanceof Error ? error.message : String(error));
      }
      setSubmitting(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="project-name">Project name</label>
          <input
            id="project-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Field service tracker"
            required
            minLength={2}
            maxLength={80}
            aria-invalid={issuesFor("name").length > 0}
          />
          {issuesFor("name").map((issue) => (
            <span className="field-error" key={issue.message}>
              {issue.message}
            </span>
          ))}
        </div>

        <div className="field">
          <label htmlFor="project-engine">Coding engine</label>
          <select
            id="project-engine"
            className="select"
            value={engine}
            onChange={(event) => setEngine(event.target.value as EngineName)}
          >
            {engines.map((option) => (
              <option key={option.name} value={option.name} disabled={!option.available}>
                {option.name}
                {option.available ? "" : " (unavailable)"}
              </option>
            ))}
          </select>
          <span className="field-hint">
            {engines.find((option) => option.name === engine)?.reason ??
              "The API decides which engines can actually run."}
          </span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="project-description">One-line description</label>
        <input
          id="project-description"
          className="input"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Dispatch jobs, track technicians and capture photo evidence"
          required
          minLength={10}
          maxLength={2000}
          aria-invalid={issuesFor("description").length > 0}
        />
        {issuesFor("description").map((issue) => (
          <span className="field-error" key={issue.message}>
            {issue.message}
          </span>
        ))}
      </div>

      <div className="field">
        <label htmlFor="project-requirements">Application requirements</label>
        <textarea
          id="project-requirements"
          className="textarea textarea-tall"
          value={requirements}
          onChange={(event) => setRequirements(event.target.value)}
          placeholder={
            "Describe the product, the users, the main screens and any hard rules.\n\n" +
            "Example: A dispatcher creates jobs with a location and priority. Technicians claim jobs from a mobile view, " +
            "mark them in progress and complete them with notes. The dashboard shows today's jobs and overdue jobs. " +
            "Only a dispatcher can create or reassign jobs."
          }
          required
          minLength={20}
          maxLength={20000}
          aria-describedby="requirements-hint"
          aria-invalid={issuesFor("requirements").length > 0}
        />
        <span className="field-hint" id="requirements-hint">
          {requirements.trim().length}/20000 characters · minimum 20. The Business Analyst
          agent turns this into a BRD, user stories and acceptance criteria.
        </span>
        {issuesFor("requirements").map((issue) => (
          <span className="field-error" key={issue.message}>
            {issue.message}
          </span>
        ))}
      </div>

      <div className="field">
        <span className="field-label">Technology stack</span>
        <div className="chip-grid" role="group" aria-label="Technology stack">
          {TECH_STACK_OPTIONS.map((option) => {
            const checked = stack.includes(option);
            return (
              <label className="chip" data-checked={checked} key={option}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleStack(option)}
                />
                {option}
              </label>
            );
          })}
        </div>
        <span className="field-hint">
          The recorded stack is passed to the architecture and implementation phases.
        </span>
      </div>

      <label className="checkbox-row" htmlFor="auto-start">
        <input
          id="auto-start"
          type="checkbox"
          checked={autoStart}
          onChange={(event) => setAutoStart(event.target.checked)}
        />
        <span>
          <strong>Start development immediately</strong>
          <span>
            The orchestrator begins as soon as the project is created. Uncheck to create a
            draft and start it from the project workspace.
          </span>
        </span>
      </label>

      {formError ? (
        <div className="alert alert-error" role="alert">
          {formError}
        </div>
      ) : null}

      <div className="btn-row">
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? (
            <>
              <span className="spinner" aria-hidden="true" /> Creating project
            </>
          ) : (
            "Create project"
          )}
        </button>
        <span className="field-hint">
          A workspace, Docker container and Git repository are created by the API.
        </span>
      </div>
    </form>
  );
}
