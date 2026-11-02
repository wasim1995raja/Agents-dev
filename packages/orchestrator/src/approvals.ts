export interface ApprovalOutcome {
  approvalId: string;
  status: "approved" | "rejected" | "expired";
}

interface Waiter {
  projectId: string;
  timer: NodeJS.Timeout;
  resolve: (outcome: ApprovalOutcome) => void;
}

/**
 * In-process registry of approval waits.
 *
 * The database is the durable record; this registry only bridges a live run to
 * the API call that records the owner's decision. If the process restarts, the
 * approval stays `pending` in the database and the next resume reattaches to it.
 */
export class ApprovalRegistry {
  private readonly waiters = new Map<string, Waiter>();

  wait(approvalId: string, projectId: string, timeoutMs: number): Promise<ApprovalOutcome> {
    this.cancel(approvalId, "superseded");

    return new Promise<ApprovalOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(approvalId);
        resolve({ approvalId, status: "expired" });
      }, timeoutMs);
      timer.unref?.();

      this.waiters.set(approvalId, { projectId, timer, resolve });
    });
  }

  settle(approvalId: string, status: "approved" | "rejected"): boolean {
    const waiter = this.waiters.get(approvalId);
    if (!waiter) return false;
    clearTimeout(waiter.timer);
    this.waiters.delete(approvalId);
    waiter.resolve({ approvalId, status });
    return true;
  }

  /** Resolves every pending approval for a project as rejected. */
  cancelProject(projectId: string): number {
    let cancelled = 0;
    for (const [approvalId, waiter] of [...this.waiters.entries()]) {
      if (waiter.projectId !== projectId) continue;
      clearTimeout(waiter.timer);
      this.waiters.delete(approvalId);
      waiter.resolve({ approvalId, status: "rejected" });
      cancelled += 1;
    }
    return cancelled;
  }

  /** Explicitly gives up on one approval (used when a run is superseded). */
  cancel(approvalId: string, _reason: string): void {
    const waiter = this.waiters.get(approvalId);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.waiters.delete(approvalId);
    waiter.resolve({ approvalId, status: "expired" });
  }

  pendingCount(): number {
    return this.waiters.size;
  }
}
