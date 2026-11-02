import type { ActivityEvent, ActivityEventType, EventLevel } from "./domain.js";

export interface PublishEventInput {
  projectId: string;
  type: ActivityEventType;
  message: string;
  level?: EventLevel;
  payload?: Record<string, unknown>;
}

/** Anything that can record and broadcast activity (orchestrator, sandbox, API). */
export interface EventPublisher {
  publish(input: PublishEventInput): Promise<ActivityEvent>;
}

export type EventSubscriber = (event: ActivityEvent) => void;

export interface SseEnvelope {
  /** "event" for named SSE events, "heartbeat" to keep proxies alive. */
  kind: "event" | "heartbeat";
  data?: ActivityEvent;
}

export function toSseFrame(envelope: SseEnvelope): string {
  if (envelope.kind === "heartbeat" || !envelope.data) {
    return `: heartbeat ${Date.now()}\n\n`;
  }
  const event = envelope.data;
  return [
    `id: ${event.id}`,
    `event: ${event.type}`,
    `data: ${JSON.stringify(event)}`,
    "",
    "",
  ].join("\n");
}
