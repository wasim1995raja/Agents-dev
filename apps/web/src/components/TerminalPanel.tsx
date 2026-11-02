"use client";

import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { terminalEntries } from "@/lib/events";
import type { ActivityEvent, CommandResult } from "@/lib/types";

interface CommandRecord {
  id: string;
  command: string;
  result?: CommandResult;
  error?: string;
  running: boolean;
}

/**
 * Terminal panel: live command/test output from the SSE feed plus an explicit
 * command runner. Commands execute inside the project's Docker container via
 * the API; blocked commands surface the orchestrator's rejection verbatim.
 */
export function TerminalPanel({
  projectId,
  events,
  canRun,
}: {
  projectId: string;
  events: ActivityEvent[];
  canRun: boolean;
}) {
  const entries = terminalEntries(events);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<CommandRecord[]>([]);
  const [pending, setPending] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = bodyRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [entries.length, history.length]);

  async function run(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = command.trim();
    if (!value || pending) return;

    const id = `${Date.now()}-${history.length}`;
    setHistory((current) => [{ id, command: value, running: true }, ...current]);
    setCommand("");
    setPending(true);

    try {
      const { result } = await api.runCommand(projectId, value);
      setHistory((current) =>
        current.map((item) => (item.id === id ? { ...item, result, running: false } : item)),
      );
    } catch (error) {
      setHistory((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                running: false,
                error: error instanceof Error ? error.message : String(error),
              }
            : item,
        ),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <div className="terminal">
        <div className="terminal-head">
          <span className="terminal-lights" aria-hidden="true">
            <span /> <span /> <span />
          </span>
          <span>sandbox · /workspace</span>
          <span>{entries.length} lines</span>
        </div>
        <div className="terminal-body" ref={bodyRef}>
          {entries.length === 0 ? (
            <span className="terminal-empty">
              Waiting for command output. The orchestrator streams every sandbox command here.
            </span>
          ) : (
            entries.map((entry) => (
              <span className={`term-line tone-${entry.tone}`} key={entry.id}>
                {entry.text}
              </span>
            ))
          )}
        </div>
      </div>

      <form className="command-form" onSubmit={run}>
        <input
          className="input input-mono"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder={canRun ? "node --version" : "Start the project to run commands"}
          aria-label="Run a sandboxed command"
          disabled={!canRun || pending}
        />
        <button className="btn" type="submit" disabled={!canRun || pending || !command.trim()}>
          {pending ? <span className="spinner" aria-hidden="true" /> : "Run"}
        </button>
      </form>
      <p className="field-hint mt-8">
        Commands run with <code className="mono">timeout</code> and the sandbox command
        policy. Destructive or dependency-installing commands are rejected or require
        owner approval.
      </p>

      {history.length > 0 ? (
        <div className="stack mt-12">
          {history.map((item) => (
            <div className="command-result" key={item.id}>
              <div className="command-result-head">
                <span>$</span>
                <span style={{ flex: 1 }}>{item.command}</span>
                {item.running ? (
                  <span className="badge badge-active badge-sm">running</span>
                ) : item.error ? (
                  <span className="badge badge-negative badge-sm">rejected</span>
                ) : item.result ? (
                  <span
                    className={`badge badge-sm ${
                      item.result.exitCode === 0 ? "badge-positive" : "badge-negative"
                    }`}
                  >
                    exit {item.result.exitCode ?? "timeout"} · {item.result.durationMs}ms
                  </span>
                ) : null}
              </div>
              <pre>
                {item.running
                  ? "Executing inside the sandbox…"
                  : item.error
                    ? item.error
                    : `${item.result?.stdout ?? ""}${item.result?.stderr ?? ""}`.trim() ||
                      "(no output)"}
              </pre>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
