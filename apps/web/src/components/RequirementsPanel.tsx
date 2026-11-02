"use client";

import { formatDateTime } from "@/lib/format";
import type { Requirements } from "@/lib/types";
import { EmptyState } from "./ui";

function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;
  return <pre className="doc-json">{JSON.stringify(value, null, 2)}</pre>;
}

/** Business analysis artifacts produced by the Business Analyst agent. */
export function RequirementsPanel({ requirements }: { requirements: Requirements | null }) {
  if (!requirements) {
    return (
      <EmptyState title="No requirements document yet">
        Once the Business Analyst agent completes the BRD phase, the document, user
        stories and acceptance criteria appear here.
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      <div className="panel-toolbar" style={{ marginBottom: 0 }}>
        <span className="panel-sub">Generated {formatDateTime(requirements.createdAt)}</span>
        <span className="badge badge-neutral badge-sm">
          {requirements.userStories.length} user stories ·{" "}
          {requirements.acceptanceCriteria.length} acceptance criteria
        </span>
      </div>

      <div className="doc-section">
        <h4>Business requirements document</h4>
        {requirements.brd ? (
          <div className="doc">{requirements.brd}</div>
        ) : (
          <p className="panel-sub">No BRD text was recorded.</p>
        )}
      </div>

      <div className="doc-section">
        <h4>User stories</h4>
        {requirements.userStories.length > 0 ? (
          <JsonBlock value={requirements.userStories} />
        ) : (
          <p className="panel-sub">No user stories were recorded.</p>
        )}
      </div>

      <div className="doc-section">
        <h4>Acceptance criteria</h4>
        {requirements.acceptanceCriteria.length > 0 ? (
          <JsonBlock value={requirements.acceptanceCriteria} />
        ) : (
          <p className="panel-sub">No acceptance criteria were recorded.</p>
        )}
      </div>
    </div>
  );
}
