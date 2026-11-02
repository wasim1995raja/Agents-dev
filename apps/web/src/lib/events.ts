import type { ActivityEvent } from "./types";

export const MAX_EVENTS = 800;

/**
 * Merges event batches by id and keeps chronological order. SSE reconnects can
 * replay buffered events, so deduplication is required to avoid a feed that
 * shows the same line twice.
 */
export function mergeEvents(
  current: ActivityEvent[],
  incoming: ActivityEvent | ActivityEvent[],
  limit = MAX_EVENTS,
): ActivityEvent[] {
  const batch = Array.isArray(incoming) ? incoming : [incoming];
  if (batch.length === 0) return current;

  const byId = new Map<string, ActivityEvent>();
  for (const event of current) byId.set(event.id, event);
  for (const event of batch) byId.set(event.id, event);

  const merged = [...byId.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  return merged.length > limit ? merged.slice(merged.length - limit) : merged;
}

export type TerminalTone = "stdout" | "stderr" | "system" | "success" | "warning";

export interface TerminalEntry {
  id: string;
  tone: TerminalTone;
  text: string;
  at: string;
}

const TERMINAL_TYPES = new Set<ActivityEvent["type"]>([
  "command.started",
  "command.output",
  "command.completed",
  "log",
  "agent.message",
  "tool.call",
  "test.started",
  "test.completed",
]);

const MAX_LINE = 4_000;

function clamp(text: string): string {
  if (text.length <= MAX_LINE) return text;
  return `${text.slice(0, MAX_LINE)}\n… truncated ${text.length - MAX_LINE} characters`;
}

/** Turns raw activity into the monospace terminal stream shown in the UI. */
export function terminalEntries(events: ActivityEvent[], limit = 400): TerminalEntry[] {
  const entries: TerminalEntry[] = [];

  for (const event of events) {
    if (!TERMINAL_TYPES.has(event.type)) continue;
    const payload = event.payload ?? {};

    if (event.type === "command.output") {
      const stream = payload.stream === "stderr" ? "stderr" : "stdout";
      entries.push({ id: event.id, tone: stream, text: clamp(event.message), at: event.createdAt });
      continue;
    }

    if (event.type === "command.started") {
      entries.push({ id: event.id, tone: "system", text: event.message, at: event.createdAt });
      continue;
    }

    if (event.type === "command.completed") {
      const exitCode = typeof payload.exitCode === "number" ? payload.exitCode : null;
      entries.push({
        id: event.id,
        tone: exitCode === 0 ? "success" : exitCode === null ? "warning" : "stderr",
        text: event.message,
        at: event.createdAt,
      });
      continue;
    }

    if (event.type === "test.completed") {
      const failed = typeof payload.failed === "number" ? payload.failed : 0;
      entries.push({
        id: event.id,
        tone: failed > 0 ? "warning" : "success",
        text: event.message,
        at: event.createdAt,
      });
      continue;
    }

    entries.push({
      id: event.id,
      tone: event.level === "error" ? "stderr" : event.level === "warn" ? "warning" : "system",
      text: clamp(event.message),
      at: event.createdAt,
    });
  }

  return entries.length > limit ? entries.slice(entries.length - limit) : entries;
}

/** Event types that should trigger a REST refresh of a given panel. */
export function shouldRefreshDetail(type: ActivityEvent["type"]): boolean {
  return (
    type.startsWith("project.") ||
    type.startsWith("phase.") ||
    type.startsWith("task.") ||
    type.startsWith("test.") ||
    type.startsWith("approval.")
  );
}
