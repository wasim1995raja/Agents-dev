"use client";

import { useMemo, useState } from "react";

import { eventLabel, formatTime, levelTone, summarizePayload } from "@/lib/format";
import type { ActivityEvent } from "@/lib/types";
import { EmptyState } from "./ui";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "tasks", label: "Tasks" },
  { key: "commands", label: "Commands" },
  { key: "tests", label: "Tests" },
  { key: "approvals", label: "Approvals" },
  { key: "files", label: "Files" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function matchesFilter(event: ActivityEvent, filter: FilterKey): boolean {
  switch (filter) {
    case "tasks":
      return event.type.startsWith("task.") || event.type.startsWith("phase.");
    case "commands":
      return event.type.startsWith("command.");
    case "tests":
      return event.type.startsWith("test.");
    case "approvals":
      return event.type.startsWith("approval.");
    case "files":
      return event.type === "file.written" || event.type === "checkpoint.created";
    default:
      return true;
  }
}

/**
 * Newest-first activity monitor. Events are already deduplicated upstream, so
 * this component only filters and renders; it never invents status.
 */
export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events
      .filter((event) => matchesFilter(event, filter))
      .filter((event) =>
        needle ? `${event.message} ${event.type}`.toLowerCase().includes(needle) : true,
      )
      .slice()
      .reverse();
  }, [events, filter, query]);

  return (
    <div>
      <div className="panel-toolbar">
        <div className="chip-grid">
          {FILTERS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className="chip"
              data-checked={filter === entry.key}
              onClick={() => setFilter(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <input
          className="input"
          placeholder="Filter activity…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Filter activity"
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No activity matches">
          Events appear here as soon as the orchestrator starts working.
        </EmptyState>
      ) : (
        <div className="feed" aria-live="polite">
          {visible.map((event) => {
            const tone = levelTone(event.level);
            const summary = summarizePayload(event.payload ?? {});
            return (
              <div className="feed-row" key={event.id}>
                <span className="feed-time">{formatTime(event.createdAt)}</span>
                <span className={`feed-dot tone-${tone}`} aria-hidden="true" />
                <div className="feed-body">
                  <div className="feed-message">{event.message}</div>
                  <div className="feed-meta">
                    <span className="feed-type">{eventLabel(event)}</span>
                    {typeof event.payload?.role === "string" ? (
                      <span className="badge badge-neutral badge-sm">{event.payload.role}</span>
                    ) : null}
                    {event.level !== "info" ? (
                      <span className={`badge badge-${tone} badge-sm`}>{event.level}</span>
                    ) : null}
                    {summary ? <span>{summary}</span> : null}
                  </div>
                  {event.payload && Object.keys(event.payload).length > 2 ? (
                    <details className="feed-payload">
                      <summary>Payload</summary>
                      <pre className="doc-json mt-8">
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
