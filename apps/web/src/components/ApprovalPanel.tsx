"use client";

import { useState } from "react";

import { api } from "@/lib/api";
import { approvalTypeLabel, formatDateTime } from "@/lib/format";
import type { Approval } from "@/lib/types";
import { ApprovalStatusBadge, EmptyState } from "./ui";

/**
 * Approval gate. Decisions go to the API, which unblocks the orchestrator's
 * live wait. Nothing here can approve on the owner's behalf automatically.
 */
export function ApprovalPanel({
  approvals,
  onDecided,
}: {
  approvals: Approval[];
  onDecided: () => void;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = approvals.filter((approval) => approval.status === "pending");
  const decided = approvals.filter((approval) => approval.status !== "pending");

  async function decide(approval: Approval, decision: "approved" | "rejected") {
    setBusy(approval.id);
    setError(null);
    try {
      await api.decideApproval(approval.id, decision, notes[approval.id]?.trim() || undefined);
      onDecided();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  if (approvals.length === 0) {
    return (
      <EmptyState title="No approvals requested">
        The Deployment agent raises an approval request before release. Destructive
        commands and dependency installs also require your decision.
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}

      {pending.length === 0 ? (
        <div className="alert alert-success">
          No approval is waiting. {decided.length} decision
          {decided.length === 1 ? "" : "s"} recorded.
        </div>
      ) : null}

      <div className="approval-list">
        {[...pending, ...decided].map((approval) => (
          <article className="approval-card" data-status={approval.status} key={approval.id}>
            <div className="approval-top">
              <div>
                <div className="approval-title">{approval.title}</div>
                <div className="feed-meta">
                  <span className="badge badge-neutral badge-sm">
                    {approvalTypeLabel(approval.type)}
                  </span>
                  <span>requested {formatDateTime(approval.requestedAt)}</span>
                  {approval.decidedBy ? <span>by {approval.decidedBy}</span> : null}
                </div>
              </div>
              <ApprovalStatusBadge status={approval.status} />
            </div>

            {Object.keys(approval.payload ?? {}).length > 0 ? (
              <pre className="approval-payload">
                {JSON.stringify(approval.payload, null, 2)}
              </pre>
            ) : null}

            {approval.note ? (
              <p className="field-hint mt-8">Decision note: {approval.note}</p>
            ) : null}

            {approval.status === "pending" ? (
              <div className="approval-actions">
                <input
                  className="input"
                  placeholder="Optional decision note"
                  value={notes[approval.id] ?? ""}
                  onChange={(event) =>
                    setNotes((current) => ({ ...current, [approval.id]: event.target.value }))
                  }
                  aria-label={`Decision note for ${approval.title}`}
                />
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  disabled={busy === approval.id}
                  onClick={() => void decide(approval, "approved")}
                >
                  {busy === approval.id ? (
                    <span className="spinner" aria-hidden="true" />
                  ) : (
                    "Approve"
                  )}
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  type="button"
                  disabled={busy === approval.id}
                  onClick={() => void decide(approval, "rejected")}
                >
                  Reject
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
