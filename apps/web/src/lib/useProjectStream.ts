"use client";

import { useEffect, useRef, useState } from "react";

import { ACTIVITY_EVENT_TYPES } from "@autodev/shared/domain";

import { api } from "./api";
import type { ActivityEvent } from "./types";

export type StreamStatus = "connecting" | "live" | "reconnecting" | "closed";

/**
 * Subscribes to the project's SSE stream. The API sends one named event per
 * activity type, so the listener set is derived from the shared vocabulary
 * instead of hard-coded strings on the client.
 */
export function useProjectStream(
  projectId: string,
  onEvent: (event: ActivityEvent) => void,
  enabled = true,
): StreamStatus {
  const handlerRef = useRef(onEvent);
  const [status, setStatus] = useState<StreamStatus>(enabled ? "connecting" : "closed");

  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled) {
      setStatus("closed");
      return;
    }

    setStatus("connecting");
    const source = new EventSource(api.streamUrl(projectId));

    const handleOpen = () => setStatus("live");
    const handleError = () => {
      // EventSource reconnects on its own; surface that honestly.
      setStatus(source.readyState === EventSource.CLOSED ? "closed" : "reconnecting");
    };

    source.addEventListener("open", handleOpen);
    source.addEventListener("error", handleError);

    const detach = ACTIVITY_EVENT_TYPES.map((type) => {
      const listener = (raw: Event) => {
        const message = raw as MessageEvent<string>;
        try {
          handlerRef.current(JSON.parse(message.data) as ActivityEvent);
        } catch {
          // A malformed frame must never break the live feed.
        }
      };
      source.addEventListener(type, listener);
      return () => source.removeEventListener(type, listener);
    });

    return () => {
      source.removeEventListener("open", handleOpen);
      source.removeEventListener("error", handleError);
      for (const remove of detach) remove();
      source.close();
      setStatus("closed");
    };
  }, [enabled, projectId]);

  return status;
}
