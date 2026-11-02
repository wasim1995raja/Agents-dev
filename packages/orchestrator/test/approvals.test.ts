import { afterEach, describe, expect, it, vi } from "vitest";

import { ApprovalRegistry } from "../src/approvals.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("ApprovalRegistry", () => {
  it("resolves an approval as approved", async () => {
    const registry = new ApprovalRegistry();
    const pending = registry.wait("approval-1", "project-1", 60_000);

    expect(registry.settle("approval-1", "approved")).toBe(true);
    await expect(pending).resolves.toEqual({ approvalId: "approval-1", status: "approved" });
    expect(registry.pendingCount()).toBe(0);
  });

  it("resolves a rejection and reports unknown ids", async () => {
    const registry = new ApprovalRegistry();
    const pending = registry.wait("approval-1", "project-1", 60_000);

    expect(registry.settle("unknown", "approved")).toBe(false);
    expect(registry.settle("approval-1", "rejected")).toBe(true);
    await expect(pending).resolves.toMatchObject({ status: "rejected" });
  });

  it("expires a pending approval after the timeout", async () => {
    vi.useFakeTimers();
    const registry = new ApprovalRegistry();
    const pending = registry.wait("approval-1", "project-1", 1_000);

    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toEqual({ approvalId: "approval-1", status: "expired" });
    expect(registry.pendingCount()).toBe(0);
  });

  it("cancels every pending approval for one project only", async () => {
    const registry = new ApprovalRegistry();
    const one = registry.wait("approval-1", "project-1", 60_000);
    const two = registry.wait("approval-2", "project-1", 60_000);
    const other = registry.wait("approval-3", "project-2", 60_000);

    expect(registry.cancelProject("project-1")).toBe(2);
    await expect(one).resolves.toMatchObject({ status: "rejected" });
    await expect(two).resolves.toMatchObject({ status: "rejected" });
    expect(registry.pendingCount()).toBe(1);

    registry.settle("approval-3", "approved");
    await expect(other).resolves.toMatchObject({ status: "approved" });
  });

  it("supersedes an earlier waiter for the same approval id", async () => {
    const registry = new ApprovalRegistry();
    const first = registry.wait("approval-1", "project-1", 60_000);
    const second = registry.wait("approval-1", "project-1", 60_000);

    await expect(first).resolves.toMatchObject({ status: "expired" });
    expect(registry.pendingCount()).toBe(1);

    registry.settle("approval-1", "approved");
    await expect(second).resolves.toMatchObject({ status: "approved" });
  });
});
