import { describe, expect, it } from "vitest";

import {
  ORCHESTRATION_STEPS,
  STEP_PROGRESS_WEIGHT,
  stepKeyFromTaskInput,
} from "../src/plan.js";

describe("orchestration plan", () => {
  it("walks the documented phases in order", () => {
    expect(ORCHESTRATION_STEPS.map((step) => step.phase)).toEqual([
      "intake",
      "brd",
      "architecture",
      "ux",
      "implementation",
      "testing",
      "review",
      "deployment",
      "approval",
    ]);
  });

  it("uses unique keys and assigns an agent role to every step", () => {
    const keys = ORCHESTRATION_STEPS.map((step) => step.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(ORCHESTRATION_STEPS.every((step) => step.role.length > 0)).toBe(true);
    expect(ORCHESTRATION_STEPS.every((step) => step.title.length > 0)).toBe(true);
  });

  it("weights every step and totals 100", () => {
    const total = Object.values(STEP_PROGRESS_WEIGHT).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBe(100);
    for (const step of ORCHESTRATION_STEPS) {
      expect(STEP_PROGRESS_WEIGHT[step.key]).toBeGreaterThan(0);
    }
  });

  it("round-trips a step key from persisted task input", () => {
    expect(stepKeyFromTaskInput({ key: "testing" })).toBe("testing");
    expect(stepKeyFromTaskInput({ key: "unknown" })).toBeNull();
    expect(stepKeyFromTaskInput(null)).toBeNull();
    expect(stepKeyFromTaskInput("testing")).toBeNull();
    expect(stepKeyFromTaskInput({})).toBeNull();
  });
});
