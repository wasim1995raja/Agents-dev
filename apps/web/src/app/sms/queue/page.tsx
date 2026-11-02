"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { Badge } from "@/components/ui";
import { api } from "@/lib/api";
import {
  errorMessage,
  formatDateTime,
  smsAuthorizationStatusLabel,
  smsAuthorizationStatusTone,
  smsOperationLabel,
  smsTableLabel,
} from "@/lib/format";
import type { SmsAuthorizationDetail, SmsAuthorizationRequest, SmsOperationType } from "@/lib/types";

type QueueFilter = "pending" | "decided" | "all";

const FILTERS: Array<{ id: QueueFilter; label: string }> = [
  { id: "pending", label: "Pending" },
  { id: "decided", label: "Decided" },
  { id: "all", label: "All" },
];

const TABLE_OPTIONS = [
  "sms_students",
  "sms_admissions",
  "sms_courses",
  "sms_departments",
  "sms_academic_years",
  "sms_fees",
  "sms_attendance",
] as const;

const DEFAULT_PAYLOAD = JSON.stringify(
  {
    admissionNumber: "ADM-1001",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.test",
  },
  null,
  2,
);

const ROW_STYLE: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  flexWrap: "wrap",
  padding: "10px 0",
  borderBottom: "1px solid var(--border)",
};

function formatChangeValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function changeRows(detail: SmsAuthorizationDetail): Array<{ key: string; oldValue: unknown; newValue: unknown }> {
  const oldValues = detail.oldValues ?? {};
  const newValues = detail.newValues ?? {};
  const keys = Array.from(new Set([...Object.keys(oldValues), ...Object.keys(newValues)]));
  return keys.map((key) => ({
    key,
    oldValue: oldValues[key] ?? null,
    newValue: newValues[key] ?? null,
  }));
}

export default function SmsQueuePage() {
  const [items, setItems] = useState<SmsAuthorizationRequest[] | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("pending");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [tableName, setTableName] = useState<(typeof TABLE_OPTIONS)[number]>("sms_students");
  const [operationType, setOperationType] = useState<SmsOperationType>("add");
  const [payloadText, setPayloadText] = useState(DEFAULT_PAYLOAD);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { authorizations } = await api.listSmsAuthorizations();
      setItems(authorizations);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const list = items ?? [];
    if (filter === "all") return list;
    return list.filter((item) =>
      filter === "pending"
        ? item.status === "pending_approval" || item.status === "draft" || item.status === "resubmitted"
        : item.status !== "pending_approval" && item.status !== "draft" && item.status !== "resubmitted",
    );
  }, [filter, items]);

  async function submitProposal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      let payload: Record<string, unknown>;
      try {
        const parsed = JSON.parse(payloadText) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("payload must be a JSON object");
        }
        payload = parsed as Record<string, unknown>;
      } catch (parseError) {
        setError(
          `Payload is not valid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        );
        setSubmitting(false);
        return;
      }

      const result = await api.submitSmsAuthorization({
        tableName,
        operationType,
        payload,
      });
      setNotice(
        `${result.transactionId} submitted — status ${result.status}${
          result.requiresApproval ? " (checker approval required)" : ""
        }.`,
      );
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function decide(item: SmsAuthorizationRequest, decision: "approved" | "rejected") {
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      const note = notes[item.id]?.trim();
      const result = await api.decideSmsAuthorization(item.id, decision, note || undefined);
      setNotice(
        `${item.transactionId} ${decision === "approved" ? "approved" : "rejected"} — status ${result.status}${
          result.applied ? " (mutation applied)" : ""
        }.`,
      );
      setNotes((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="stack">
      <section className="project-hero">
        <div>
          <p className="kicker">Maker–Checker</p>
          <h1>Authorization queue</h1>
          <p className="lede">
            Checkers review proposed Add/Edit/Delete transactions. Approving applies the
            mutation; rejecting keeps the original record untouched. A maker can never
            approve their own transaction, and a decided transaction cannot be decided twice.
          </p>
        </div>
        <div className="btn-row">
          <button className="btn" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </section>

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <h2>Propose a transaction</h2>
          <span className="panel-sub">Maker step — nothing is applied until a checker approves</span>
        </div>
        <div className="panel-body">
          <form className="form" onSubmit={submitProposal}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="proposal-table">Table</label>
                <select
                  id="proposal-table"
                  className="select"
                  value={tableName}
                  onChange={(event) =>
                    setTableName(event.target.value as (typeof TABLE_OPTIONS)[number])
                  }
                >
                  {TABLE_OPTIONS.map((table) => (
                    <option key={table} value={table}>
                      {table}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="proposal-operation">Operation</label>
                <select
                  id="proposal-operation"
                  className="select"
                  value={operationType}
                  onChange={(event) =>
                    setOperationType(event.target.value as SmsOperationType)
                  }
                >
                  <option value="add">Add</option>
                  <option value="edit">Edit</option>
                  <option value="delete">Delete</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="proposal-payload">Proposed values (JSON object)</label>
              <textarea
                id="proposal-payload"
                className="textarea"
                rows={10}
                value={payloadText}
                onChange={(event) => setPayloadText(event.target.value)}
                spellCheck={false}
              />
              <span className="field-hint">
                Add sends the new record; edit needs its <code>id</code> plus changed fields;
                delete needs only <code>id</code>. Student, department, course, academic year,
                admission, fee and attendance proposals are all applied on approval.
              </span>
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" type="submit" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit for approval"}
              </button>
            </div>
          </form>
        </div>
      </section>

      <div className="tabs" role="tablist" aria-label="Queue filter">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            className="tab"
            role="tab"
            type="button"
            aria-selected={filter === entry.id}
            onClick={() => setFilter(entry.id)}
          >
            {entry.label}
            <span className="tab-count">
              {(items ?? []).filter((item) =>
                entry.id === "all"
                  ? true
                  : entry.id === "pending"
                    ? item.status === "pending_approval" ||
                      item.status === "draft" ||
                      item.status === "resubmitted"
                    : item.status !== "pending_approval" &&
                      item.status !== "draft" &&
                      item.status !== "resubmitted",
              ).length}
            </span>
          </button>
        ))}
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2>
            {filter === "pending" ? "Awaiting decision" : filter === "decided" ? "Decided" : "All transactions"}
          </h2>
          <span className="panel-sub">{visible.length} shown</span>
        </div>
        <div className="panel-body">
          {loading && !items ? (
            <div className="empty">
              <strong>Loading queue…</strong>
            </div>
          ) : visible.length === 0 ? (
            <div className="empty">
              <strong>Nothing to show</strong>
              <p>
                {filter === "pending"
                  ? "No transactions are waiting for a checker right now."
                  : "No transactions match this filter yet."}
              </p>
            </div>
          ) : (
            <div className="stack">
              {visible.map((item) => {
                const isPending = item.status === "pending_approval";
                const busy = busyId === item.id;
                const changeList = item.detail ? changeRows(item.detail) : [];
                return (
                  <div key={item.id} className="panel pad">
                    <div className="btn-row" style={{ justifyContent: "space-between" }}>
                      <div>
                        <strong>{item.transactionId}</strong>
                        <div className="panel-sub">
                          {smsOperationLabel(item.operationType)} · {smsTableLabel(item.tableName)} · maker{" "}
                          {item.makerUserId} · {formatDateTime(item.submittedAt)}
                        </div>
                      </div>
                      <Badge tone={smsAuthorizationStatusTone(item.status)}>
                        {smsAuthorizationStatusLabel(item.status)}
                      </Badge>
                    </div>

                    {item.decidedAt ? (
                      <p className="panel-sub" style={{ marginTop: 8 }}>
                        Decided {formatDateTime(item.decidedAt)}
                        {item.checkerUserId ? ` by ${item.checkerUserId}` : ""}
                        {item.decisionNote ? ` — ${item.decisionNote}` : ""}
                      </p>
                    ) : null}

                    {item.detail ? (
                      <div style={{ ...ROW_STYLE, borderBottom: "none", paddingTop: 4 }}>
                        <div>
                          <strong>Proposed change</strong>
                          <div className="stack" style={{ marginTop: 8 }}>
                            {changeList.length === 0 ? (
                              <p className="panel-sub">No field changes recorded.</p>
                            ) : (
                              changeList.map((row) => (
                                <div key={row.key} style={{ paddingBottom: 8 }}>
                                  <strong>{row.key}</strong>
                                  <div className="panel-sub">
                                    Old: {formatChangeValue(row.oldValue)} → New:{" "}
                                    {formatChangeValue(row.newValue)}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {isPending ? (
                      <div className="stack" style={{ marginTop: 12 }}>
                        <label className="field">
                          <span className="field-label">Checker comment (optional)</span>
                          <input
                            className="input"
                            value={notes[item.id] ?? ""}
                            placeholder="Reason for the decision"
                            onChange={(event) =>
                              setNotes((current) => ({ ...current, [item.id]: event.target.value }))
                            }
                          />
                        </label>
                        <div className="btn-row">
                          <button
                            className="btn btn-primary"
                            type="button"
                            disabled={busy}
                            onClick={() => void decide(item, "approved")}
                          >
                            {busy ? "Working…" : "Approve"}
                          </button>
                          <button
                            className="btn btn-danger"
                            type="button"
                            disabled={busy}
                            onClick={() => void decide(item, "rejected")}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
