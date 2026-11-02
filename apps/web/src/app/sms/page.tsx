"use client";

import Link from "next/link";
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
import type {
  SmsAuditEntry,
  SmsAuthorizationRequest,
  SmsNotification,
  SmsResponsibility,
  SmsRole,
  SmsUser,
} from "@/lib/types";

interface SmsSnapshot {
  users: SmsUser[];
  roles: SmsRole[];
  responsibilities: SmsResponsibility[];
  authorizations: SmsAuthorizationRequest[];
  audit: SmsAuditEntry[];
  notifications: SmsNotification[];
}

/** Local demo identities used by the API headers until JWT auth lands. */
const LOCAL_MAKER = "sms-local-maker";
const LOCAL_CHECKER = "sms-local-checker";

const ROW_STYLE: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  flexWrap: "wrap",
  padding: "10px 0",
  borderBottom: "1px solid var(--border)",
};

export default function SmsDashboardPage() {
  const [snapshot, setSnapshot] = useState<SmsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [users, roles, responsibilities, authorizations, audit, makerNotes, checkerNotes] =
        await Promise.all([
          api.listSmsUsers(),
          api.listSmsRoles(),
          api.listSmsResponsibilities(),
          api.listSmsAuthorizations(),
          api.listSmsAudit(),
          api.listSmsNotifications(LOCAL_MAKER),
          api.listSmsNotifications(LOCAL_CHECKER),
        ]);
      const notifications = [...makerNotes.notifications, ...checkerNotes.notifications].sort(
        (left, right) => right.createdAt.localeCompare(left.createdAt),
      );
      setSnapshot({
        users: users.users,
        roles: roles.roles,
        responsibilities: responsibilities.responsibilities,
        authorizations: authorizations.authorizations,
        audit: audit.audit,
        notifications,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const users = snapshot?.users ?? [];
  const roles = snapshot?.roles ?? [];
  const responsibilities = snapshot?.responsibilities ?? [];
  const authorizations = snapshot?.authorizations ?? [];
  const audit = snapshot?.audit ?? [];
  const notifications = snapshot?.notifications ?? [];

  const pending = authorizations.filter((item) => item.status === "pending_approval");
  const makerChecker = responsibilities.filter((item) => item.makerCheckerRequired);
  const activeUsers = users.filter((item) => item.status === "active");
  const unreadNotifications = notifications.filter((item) => !item.readAt);

  const pendingByTable = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of pending) {
      counts.set(item.tableName, (counts.get(item.tableName) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((left, right) => right[1] - left[1]);
  }, [pending]);

  const markNotificationRead = useCallback(async (id: string) => {
    try {
      await api.markSmsNotificationRead(id);
      setSnapshot((current) =>
        current
          ? {
              ...current,
              notifications: current.notifications.map((item) =>
                item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
              ),
            }
          : current,
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  return (
    <div className="stack">
      <section className="project-hero">
        <div>
          <p className="kicker">Student Management System</p>
          <h1>SMS control centre</h1>
          <p className="lede">
            Table-wise responsibilities, the maker–checker approval queue and an
            append-only audit trail — enforced backend-side.
          </p>
        </div>
        <div className="btn-row">
          <button className="btn" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <Link className="btn btn-primary" href="/sms/queue">
            Open checker queue
          </Link>
        </div>
      </section>

      {error ? (
        <div className="alert alert-error" role="alert">
          Could not load SMS data: {error}
        </div>
      ) : null}

      <section className="stat-grid" aria-label="SMS summary">
        <div className="stat">
          <div className="stat-value">{activeUsers.length}</div>
          <div className="stat-label">Active users</div>
        </div>
        <div className="stat">
          <div className="stat-value">{roles.length}</div>
          <div className="stat-label">Roles</div>
        </div>
        <div className="stat">
          <div className="stat-value">{responsibilities.length}</div>
          <div className="stat-label">Responsibilities</div>
        </div>
        <div className="stat">
          <div className="stat-value">{pending.length}</div>
          <div className="stat-label">Pending approvals</div>
        </div>
        <div className="stat">
          <div className="stat-value">{audit.length}</div>
          <div className="stat-label">Audit events</div>
        </div>
      </section>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-header">
            <h2>Pending approvals</h2>
            <span className="panel-sub">{pending.length} awaiting checker</span>
          </div>
          <div className="panel-body">
            {pending.length === 0 ? (
              <div className="empty">
                <strong>No pending approvals</strong>
                <p>Maker submissions will appear here until a checker decides.</p>
              </div>
            ) : (
              <div className="stack">
                {pending.slice(0, 6).map((item) => (
                  <div key={item.id} style={ROW_STYLE}>
                    <div>
                      <strong>{item.transactionId}</strong>
                      <div className="panel-sub">
                        {smsOperationLabel(item.operationType)} · {smsTableLabel(item.tableName)} · maker{" "}
                        {item.makerUserId}
                      </div>
                    </div>
                    <Badge tone={smsAuthorizationStatusTone(item.status)} small>
                      {smsAuthorizationStatusLabel(item.status)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Recent audit</h2>
            <span className="panel-sub">{audit.length} events</span>
          </div>
          <div className="panel-body">
            {audit.length === 0 ? (
              <div className="empty">
                <strong>No audit entries yet</strong>
                <p>Every maker submission and checker decision is recorded.</p>
              </div>
            ) : (
              <div className="stack">
                {audit.slice(0, 6).map((entry) => (
                  <div key={entry.id} style={ROW_STYLE}>
                    <div>
                      <strong>{entry.activityDescription}</strong>
                      <div className="panel-sub">
                        {smsTableLabel(entry.tableName)} · {entry.recordId} ·{" "}
                        {formatDateTime(entry.createdAt)}
                      </div>
                    </div>
                    <Badge tone={smsAuthorizationStatusTone(entry.status)} small>
                      {entry.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2>Pending by table</h2>
          <span className="panel-sub">
            {pendingByTable.length} table{pendingByTable.length === 1 ? "" : "s"} with open proposals
          </span>
        </div>
        <div className="panel-body">
          {pendingByTable.length === 0 ? (
            <div className="empty">
              <strong>No open proposals</strong>
              <p>Every pending maker submission lands here grouped by table.</p>
            </div>
          ) : (
            <div className="stack">
              {pendingByTable.map(([tableName, count]) => (
                <div key={tableName} style={ROW_STYLE}>
                  <div>
                    <strong>{smsTableLabel(tableName)}</strong>
                    <div className="panel-sub">{tableName}</div>
                  </div>
                  <Badge tone={count > 1 ? "warning" : "info"} small>
                    {count} pending
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Notifications</h2>
          <span className="panel-sub">
            {unreadNotifications.length} unread · maker and checker inboxes
          </span>
        </div>
        <div className="panel-body">
          {notifications.length === 0 ? (
            <div className="empty">
              <strong>No notifications yet</strong>
              <p>Submitting or deciding a transaction writes an in-app notification.</p>
            </div>
          ) : (
            <div className="stack">
              {notifications.slice(0, 8).map((item) => (
                <div key={item.id} style={ROW_STYLE}>
                  <div>
                    <strong>
                      {item.title}
                      {item.readAt ? null : (
                        <>
                          {" "}
                          <Badge tone="info" small>
                            New
                          </Badge>
                        </>
                      )}
                    </strong>
                    <div className="panel-sub">
                      {item.body} · {item.userId} · {formatDateTime(item.createdAt)}
                    </div>
                  </div>
                  {item.readAt ? (
                    <Badge tone="neutral" small>
                      Read
                    </Badge>
                  ) : (
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => void markNotificationRead(item.id)}
                    >
                      Mark read
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Responsibility matrix</h2>
          <span className="panel-sub">
            {responsibilities.length} configured · {makerChecker.length} maker–checker
          </span>
        </div>
        <div className="panel-body">
          {responsibilities.length === 0 ? (
            <div className="empty">
              <strong>No responsibilities configured</strong>
              <p>Add table-wise Add/Edit/View/Delete permissions in Users &amp; access.</p>
            </div>
          ) : (
            <div className="stack">
              {responsibilities.map((item) => (
                <div key={item.id} style={ROW_STYLE}>
                  <div>
                    <strong>{item.responsibilityName}</strong>
                    <div className="panel-sub">
                      {item.moduleName} · {smsTableLabel(item.tableName)}
                    </div>
                  </div>
                  <div className="btn-row">
                    {item.canAdd ? (
                      <Badge tone="info" small>
                        Add
                      </Badge>
                    ) : null}
                    {item.canEdit ? (
                      <Badge tone="info" small>
                        Edit
                      </Badge>
                    ) : null}
                    {item.canView ? (
                      <Badge tone="neutral" small>
                        View
                      </Badge>
                    ) : null}
                    {item.canDelete ? (
                      <Badge tone="negative" small>
                        Delete
                      </Badge>
                    ) : null}
                    {item.makerCheckerRequired ? (
                      <Badge tone="warning" small>
                        Maker–Checker
                      </Badge>
                    ) : null}
                    <Badge tone={item.status === "active" ? "positive" : "neutral"} small>
                      {item.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
