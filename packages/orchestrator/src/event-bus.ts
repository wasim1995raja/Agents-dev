import type { ActivityEvent, ActivityEventType, EventLevel } from "@autodev/shared";
import type { EventsRepository } from "@autodev/db";
import type { EventPublisher, EventSubscriber, PublishEventInput } from "@autodev/shared";

export interface EventBusOptions {
  events: EventsRepository;
  /** How many recent events to retain per project for SSE reconnects. */
  bufferSize?: number;
  onListenerError?: (error: unknown) => void;
}

/**
 * Persists every activity event and fans it out to live subscribers.
 *
 * Persistence is the source of truth: if a subscriber throws or is slow, the
 * event is still recorded and other subscribers still receive it. A small
 * per-project ring buffer lets an SSE client catch up after a reconnect.
 */
export class EventBus implements EventPublisher {
  private readonly events: EventsRepository;
  private readonly bufferSize: number;
  private readonly onListenerError: (error: unknown) => void;
  private readonly subscribers = new Map<string, Set<EventSubscriber>>();
  private readonly buffers = new Map<string, ActivityEvent[]>();

  constructor(options: EventBusOptions) {
    this.events = options.events;
    this.bufferSize = options.bufferSize ?? 200;
    this.onListenerError =
      options.onListenerError ??
      ((error) => {
        console.error("[event-bus] subscriber failed", error);
      });
  }

  async publish(input: PublishEventInput): Promise<ActivityEvent> {
    const event = await this.events.append({
      projectId: input.projectId,
      type: input.type,
      level: input.level ?? "info",
      message: input.message,
      payload: input.payload ?? {},
    });
    this.remember(event);
    this.dispatch(event);
    return event;
  }

  /** Convenience wrapper used throughout the orchestrator. */
  async log(
    projectId: string,
    message: string,
    options: {
      level?: EventLevel;
      type?: ActivityEventType;
      payload?: Record<string, unknown>;
    } = {},
  ): Promise<ActivityEvent> {
    return this.publish({
      projectId,
      type: options.type ?? "log",
      message,
      level: options.level ?? "info",
      payload: options.payload ?? {},
    });
  }

  subscribe(projectId: string, subscriber: EventSubscriber): () => void {
    const set = this.subscribers.get(projectId) ?? new Set<EventSubscriber>();
    set.add(subscriber);
    this.subscribers.set(projectId, set);

    return () => {
      const current = this.subscribers.get(projectId);
      if (!current) return;
      current.delete(subscriber);
      if (current.size === 0) this.subscribers.delete(projectId);
    };
  }

  /** Buffered events for a project, oldest first. */
  recent(projectId: string): ActivityEvent[] {
    return [...(this.buffers.get(projectId) ?? [])];
  }

  subscriberCount(projectId: string): number {
    return this.subscribers.get(projectId)?.size ?? 0;
  }

  private remember(event: ActivityEvent): void {
    const buffer = this.buffers.get(event.projectId) ?? [];
    buffer.push(event);
    if (buffer.length > this.bufferSize) {
      buffer.splice(0, buffer.length - this.bufferSize);
    }
    this.buffers.set(event.projectId, buffer);
  }

  private dispatch(event: ActivityEvent): void {
    const set = this.subscribers.get(event.projectId);
    if (!set) return;
    for (const subscriber of [...set]) {
      try {
        subscriber(event);
      } catch (error) {
        this.onListenerError(error);
      }
    }
  }
}
