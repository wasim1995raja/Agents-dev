import { describe, expect, it, vi } from "vitest";

import type { ActivityEvent, ActivityEventType, EventLevel } from "@autodev/shared";
import type { EventsRepository } from "@autodev/db";

import { EventBus } from "../src/event-bus.js";

interface AppendInput {
  projectId: string;
  type: ActivityEventType;
  level?: EventLevel;
  message: string;
  payload?: Record<string, unknown>;
}

function fakeRepository(options: { failAfter?: number } = {}) {
  const rows: ActivityEvent[] = [];
  let counter = 0;
  const repository = {
    append: async (input: AppendInput): Promise<ActivityEvent> => {
      counter += 1;
      if (options.failAfter !== undefined && counter > options.failAfter) {
        throw new Error("database is down");
      }
      const event: ActivityEvent = {
        id: `event-${counter}`,
        projectId: input.projectId,
        type: input.type,
        level: input.level ?? "info",
        message: input.message,
        payload: input.payload ?? {},
        createdAt: new Date(1_700_000_000_000 + counter).toISOString(),
      };
      rows.push(event);
      return event;
    },
  } as unknown as EventsRepository;
  return { repository, rows };
}

describe("EventBus", () => {
  it("persists an event before announcing it", async () => {
    const { repository, rows } = fakeRepository();
    const bus = new EventBus({ events: repository });

    const seen: string[] = [];
    bus.subscribe("project-1", (event) => {
      // The row must already exist when the subscriber fires.
      expect(rows.map((row) => row.id)).toContain(event.id);
      seen.push(event.type);
    });

    const event = await bus.publish({
      projectId: "project-1",
      type: "phase.started",
      message: "Intake started",
    });

    expect(event.level).toBe("info");
    expect(event.payload).toEqual({});
    expect(seen).toEqual(["phase.started"]);
    expect(rows).toHaveLength(1);
  });

  it("only notifies subscribers of the same project", async () => {
    const { repository } = fakeRepository();
    const bus = new EventBus({ events: repository });

    const projectOne = vi.fn();
    const projectTwo = vi.fn();
    bus.subscribe("project-1", projectOne);
    bus.subscribe("project-2", projectTwo);

    await bus.log("project-1", "hello");
    expect(projectOne).toHaveBeenCalledTimes(1);
    expect(projectTwo).not.toHaveBeenCalled();
  });

  it("keeps dispatching when one subscriber throws", async () => {
    const { repository } = fakeRepository();
    const onListenerError = vi.fn();
    const bus = new EventBus({ events: repository, onListenerError });

    const healthy = vi.fn();
    bus.subscribe("project-1", () => {
      throw new Error("boom");
    });
    bus.subscribe("project-1", healthy);

    await bus.log("project-1", "still delivered");
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(onListenerError).toHaveBeenCalledTimes(1);
  });

  it("stops delivering after unsubscribe", async () => {
    const { repository } = fakeRepository();
    const bus = new EventBus({ events: repository });
    const listener = vi.fn();
    const unsubscribe = bus.subscribe("project-1", listener);

    await bus.log("project-1", "one");
    unsubscribe();
    await bus.log("project-1", "two");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(bus.subscriberCount("project-1")).toBe(0);
  });

  it("buffers recent events with a bounded size", async () => {
    const { repository } = fakeRepository();
    const bus = new EventBus({ events: repository, bufferSize: 3 });

    for (let index = 0; index < 5; index += 1) {
      await bus.log("project-1", `message ${index}`);
    }

    const recent = bus.recent("project-1");
    expect(recent.map((event) => event.message)).toEqual([
      "message 2",
      "message 3",
      "message 4",
    ]);
    expect(bus.recent("unknown")).toEqual([]);
  });

  it("propagates persistence failures to the caller", async () => {
    const { repository } = fakeRepository({ failAfter: 0 });
    const bus = new EventBus({ events: repository });
    await expect(bus.log("project-1", "will fail")).rejects.toThrow(/database is down/);
  });
});
