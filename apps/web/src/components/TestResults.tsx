"use client";

import { formatDateTime, formatDuration } from "@/lib/format";
import type { TestResult } from "@/lib/types";
import { EmptyState } from "./ui";

const STATUS_TONE: Record<string, string> = {
  passed: "badge-positive",
  failed: "badge-warning",
  error: "badge-negative",
};

/** Test evidence: counts, duration and the raw failure payloads. */
export function TestResults({ tests }: { tests: TestResult[] }) {
  if (tests.length === 0) {
    return (
      <EmptyState title="No test runs yet">
        The QA agent writes Playwright suites, runs them inside the sandbox and records
        the real report here. Failures are sent back to the developer agents.
      </EmptyState>
    );
  }

  const latest = tests[0];
  const passing = tests.filter((test) => test.status === "passed").length;

  return (
    <div>
      <div className="stat-grid mb-16">
        <div className="stat">
          <div className="stat-value">{tests.length}</div>
          <div className="stat-label">Runs</div>
        </div>
        <div className="stat">
          <div className="stat-value">{passing}</div>
          <div className="stat-label">Passing runs</div>
        </div>
        <div className="stat">
          <div className="stat-value">{latest?.passed ?? 0}</div>
          <div className="stat-label">Tests passed (latest)</div>
        </div>
        <div className="stat">
          <div className="stat-value">{latest?.failed ?? 0}</div>
          <div className="stat-label">Failed (latest)</div>
        </div>
        <div className="stat">
          <div className="stat-value">{formatDuration(latest?.durationMs)}</div>
          <div className="stat-label">Latest duration</div>
        </div>
      </div>

      <div className="test-list">
        {tests.map((test) => (
          <article className="test-card" key={test.id}>
            <div className="test-card-top">
              <div className="test-title">
                <span className={`badge ${STATUS_TONE[test.status] ?? "badge-neutral"}`}>
                  {test.status}
                </span>
                <span className="mono">{test.suite}</span>
                <span className="faint">
                  {test.total} total · {formatDuration(test.durationMs)}
                </span>
              </div>
              <span className="faint">{formatDateTime(test.createdAt)}</span>
            </div>

            <div className="test-counts">
              <span className="ok">{test.passed} passed</span>
              <span className={test.failed > 0 ? "bad" : ""}>{test.failed} failed</span>
              <span>{test.skipped} skipped</span>
              <span>{test.total} total</span>
            </div>

            {test.failures.length > 0 ? (
              <details className="test-failures" open>
                <summary>{test.failures.length} failure detail(s)</summary>
                <pre className="mt-8">{JSON.stringify(test.failures, null, 2)}</pre>
              </details>
            ) : null}

            {test.output ? (
              <details className="test-failures">
                <summary>Raw report output</summary>
                <pre className="mt-8">{test.output}</pre>
              </details>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
