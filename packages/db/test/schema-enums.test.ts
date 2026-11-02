import { describe, expect, it } from "vitest";

import {
  AGENT_ROLES,
  APPROVAL_STATUSES,
  APPROVAL_TYPES,
  ENGINE_NAMES,
  EVENT_LEVELS,
  PHASES,
  PROJECT_STATUSES,
  TASK_STATUSES,
} from "@autodev/shared";

import {
  AGENT_ROLE_VALUES,
  APPROVAL_STATUS_VALUES,
  APPROVAL_TYPE_VALUES,
  ENGINE_VALUES,
  EVENT_LEVEL_VALUES,
  PHASE_VALUES,
  PROJECT_STATUS_VALUES,
  TASK_STATUS_VALUES,
} from "../src/schema.js";

/**
 * drizzle-kit loads schema.ts through a CJS require that cannot resolve
 * cross-package `.js` specifiers, so enum values are duplicated there.
 * This test is the guard that keeps the copies honest.
 */
describe("schema enums stay in sync with @autodev/shared", () => {
  it("project statuses", () => {
    expect([...PROJECT_STATUS_VALUES]).toEqual([...PROJECT_STATUSES]);
  });

  it("phases", () => {
    expect([...PHASE_VALUES]).toEqual([...PHASES]);
  });

  it("agent roles", () => {
    expect([...AGENT_ROLE_VALUES]).toEqual([...AGENT_ROLES]);
  });

  it("task statuses", () => {
    expect([...TASK_STATUS_VALUES]).toEqual([...TASK_STATUSES]);
  });

  it("engine names", () => {
    expect([...ENGINE_VALUES]).toEqual([...ENGINE_NAMES]);
  });

  it("approval enums", () => {
    expect([...APPROVAL_TYPE_VALUES]).toEqual([...APPROVAL_TYPES]);
    expect([...APPROVAL_STATUS_VALUES]).toEqual([...APPROVAL_STATUSES]);
  });

  it("event levels", () => {
    expect([...EVENT_LEVEL_VALUES]).toEqual([...EVENT_LEVELS]);
  });
});
