"use client";

import { formatDateTime, shortCommit } from "@/lib/format";
import type { GitCheckpoint } from "@/lib/types";
import { EmptyState } from "./ui";

/** Git checkpoints recorded by the orchestrator after each milestone. */
export function CommitList({ commits }: { commits: GitCheckpoint[] }) {
  if (commits.length === 0) {
    return (
      <EmptyState title="No checkpoints yet">
        The orchestrator commits the workspace after every milestone, before major
        modifications and before the review phase.
      </EmptyState>
    );
  }

  return (
    <div className="commit-list">
      {commits.map((commit) => (
        <div className="commit-row" key={commit.commit}>
          <span className="commit-sha" title={commit.commit}>
            {shortCommit(commit.commit)}
          </span>
          <span className="commit-subject" title={commit.subject}>
            {commit.subject}
          </span>
          <span className="commit-date">{formatDateTime(commit.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}
