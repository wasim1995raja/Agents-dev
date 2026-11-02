"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui";
import { api } from "@/lib/api";
import { errorMessage, formatDateTime } from "@/lib/format";
import type {
  SmsAssignments,
  SmsResponsibility,
  SmsRole,
  SmsUser,
  SmsUserResponsibility,
  SmsUserResponsibilityResponse,
  SmsRoleResponsibility,
  SmsRoleResponsibilityResponse,
} from "@/lib/types";

const SMS_TABLE_OPTIONS = [
  "sms_students",
  "sms_admissions",
  "sms_courses",
  "sms_departments",
  "sms_academic_years",
  "sms_fees",
  "sms_attendance",
] as const;

const EMPTY_RESPONSIBILITY = {
  responsibilityName: "",
  moduleName: "student",
  tableName: "sms_students" as (typeof SMS_TABLE_OPTIONS)[number],
  canAdd: true,
  canEdit: false,
  canView: true,
  canDelete: false,
  makerCheckerRequired: true,
  makerUserId: "",
  checkerUserId: "",
  effectiveFrom: "",
  effectiveTo: "",
  status: "active" as "active" | "inactive",
};

export default function SmsUsersPage() {
  const [roles, setRoles] = useState<SmsRole[]>([]);
  const [users, setUsers] = useState<SmsUser[]>([]);
  const [responsibilities, setResponsibilities] = useState<SmsResponsibility[]>([]);
  const [assignments, setAssignments] = useState<SmsAssignments | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [savingRole, setSavingRole] = useState(false);

  const [userForm, setUserForm] = useState({
    username: "",
    fullName: "",
    email: "",
    password: "",
    roleId: "",
    status: "active" as "active" | "inactive",
  });
  const [savingUser, setSavingUser] = useState(false);

  const [responsibility, setResponsibility] = useState({ ...EMPTY_RESPONSIBILITY });
  const [savingResponsibility, setSavingResponsibility] = useState(false);

  const [roleIdForAssignment, setRoleIdForAssignment] = useState("");
  const [responsibilityIdForAssignment, setResponsibilityIdForAssignment] = useState("");
  const [savingRoleAssignment, setSavingRoleAssignment] = useState(false);

  const [userIdForAssignment, setUserIdForAssignment] = useState("");
  const [responsibilityIdForUserAssignment, setResponsibilityIdForUserAssignment] = useState("");
  const [savingUserAssignment, setSavingUserAssignment] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [roleResult, userResult, responsibilityResult, assignmentResult] = await Promise.all([
        api.listSmsRoles(),
        api.listSmsUsers(),
        api.listSmsResponsibilities(),
        api.listSmsAssignments(),
      ]);
      setRoles(roleResult.roles);
      setUsers(userResult.users);
      setResponsibilities(responsibilityResult.responsibilities);
      setAssignments(assignmentResult);
      setUserForm((current) =>
        current.roleId || roleResult.roles.length === 0
          ? current
          : { ...current, roleId: roleResult.roles[0]?.id ?? "" },
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const roleNameById = useMemo(
    () => new Map(roles.map((role) => [role.id, role.name])),
    [roles],
  );

  async function createRole(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingRole(true);
    setError(null);
    setNotice(null);
    try {
      await api.createSmsRole({
        name: roleName,
        ...(roleDescription.trim() ? { description: roleDescription.trim() } : {}),
      });
      setRoleName("");
      setRoleDescription("");
      setNotice("Role created.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingRole(false);
    }
  }

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingUser(true);
    setError(null);
    setNotice(null);
    try {
      await api.createSmsUser({
        username: userForm.username,
        fullName: userForm.fullName,
        email: userForm.email,
        password: userForm.password,
        roleId: userForm.roleId,
        status: userForm.status,
      });
      setUserForm((current) => ({
        ...current,
        username: "",
        fullName: "",
        email: "",
        password: "",
      }));
      setNotice("User created. The password is stored only as a scrypt hash.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingUser(false);
    }
  }

  async function createResponsibility(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingResponsibility(true);
    setError(null);
    setNotice(null);
    try {
      await api.createSmsResponsibility({
        responsibilityName: responsibility.responsibilityName,
        moduleName: responsibility.moduleName,
        tableName: responsibility.tableName,
        canAdd: responsibility.canAdd,
        canEdit: responsibility.canEdit,
        canView: responsibility.canView,
        canDelete: responsibility.canDelete,
        makerCheckerRequired: responsibility.makerCheckerRequired,
        ...(responsibility.makerUserId.trim()
          ? { makerUserId: responsibility.makerUserId.trim() }
          : {}),
        ...(responsibility.checkerUserId.trim()
          ? { checkerUserId: responsibility.checkerUserId.trim() }
          : {}),
        ...(responsibility.effectiveFrom
          ? { effectiveFrom: new Date(responsibility.effectiveFrom).toISOString() }
          : {}),
        ...(responsibility.effectiveTo
          ? { effectiveTo: new Date(responsibility.effectiveTo).toISOString() }
          : {}),
        status: responsibility.status,
      });
      setResponsibility({ ...EMPTY_RESPONSIBILITY });
      setNotice("Responsibility configured. Deny-by-default now has an explicit grant.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingResponsibility(false);
    }
  }

  async function assignResponsibilityToRole(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roleIdForAssignment || !responsibilityIdForAssignment) {
      setError("Select both a role and a responsibility to assign.");
      return;
    }
    setSavingRoleAssignment(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.createSmsRoleResponsibility({
        roleId: roleIdForAssignment,
        responsibilityId: responsibilityIdForAssignment,
      });
      setNotice(
        result.assignment
          ? "Responsibility assigned to role."
          : "Responsibility was already assigned to that role.",
      );
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingRoleAssignment(false);
    }
  }

  async function unassignRoleResponsibility(id: string) {
    setError(null);
    setNotice(null);
    try {
      await api.deleteSmsRoleResponsibility(id);
      setNotice("Role responsibility assignment removed.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function assignResponsibilityToUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userIdForAssignment || !responsibilityIdForUserAssignment) {
      setError("Select both a user and a responsibility to assign.");
      return;
    }
    setSavingUserAssignment(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.createSmsUserResponsibility({
        userId: userIdForAssignment,
        responsibilityId: responsibilityIdForUserAssignment,
      });
      setNotice(
        result.assignment
          ? "Responsibility assigned to user."
          : "Responsibility was already assigned to that user.",
      );
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingUserAssignment(false);
    }
  }

  async function unassignUserResponsibility(id: string) {
    setError(null);
    setNotice(null);
    try {
      await api.deleteSmsUserResponsibility(id);
      setNotice("User responsibility assignment removed.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function toggleFlag(key: "canAdd" | "canEdit" | "canView" | "canDelete") {
    setResponsibility((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <div className="stack">
      <section className="project-hero">
        <div>
          <p className="kicker">Users &amp; access</p>
          <h1>Roles, users and table responsibilities</h1>
          <p className="lede">
            Permissions are deny-by-default. A user can act on a table only through an
            effective responsibility grant; maker–checker routes the write through the queue.
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

      <div className="grid-2">
        <section className="panel">
          <div className="panel-header">
            <h2>Create role</h2>
            <span className="panel-sub">{roles.length} configured</span>
          </div>
          <div className="panel-body">
            <form className="form" onSubmit={createRole}>
              <div className="field">
                <label htmlFor="role-name">Role name</label>
                <input
                  id="role-name"
                  className="input"
                  value={roleName}
                  onChange={(event) => setRoleName(event.target.value)}
                  placeholder="ADMISSION_CHECKER"
                  required
                  minLength={2}
                />
              </div>
              <div className="field">
                <label htmlFor="role-description">Description</label>
                <input
                  id="role-description"
                  className="input"
                  value={roleDescription}
                  onChange={(event) => setRoleDescription(event.target.value)}
                  placeholder="Reviews admission proposals"
                />
              </div>
              <div className="btn-row">
                <button className="btn btn-primary" type="submit" disabled={savingRole}>
                  {savingRole ? "Creating…" : "Create role"}
                </button>
              </div>
            </form>

            <div className="stack" style={{ marginTop: 16 }}>
              {roles.length === 0 ? (
                <p className="panel-sub">No roles yet. Create one before adding users.</p>
              ) : (
                roles.map((role) => (
                  <div
                    key={role.id}
                    style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
                  >
                    <strong>{role.name}</strong>
                    <span className="panel-sub">{role.description ?? "—"}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Create user</h2>
            <span className="panel-sub">{users.length} users</span>
          </div>
          <div className="panel-body">
            <form className="form" onSubmit={createUser}>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="user-username">Username</label>
                  <input
                    id="user-username"
                    className="input"
                    value={userForm.username}
                    onChange={(event) =>
                      setUserForm((current) => ({ ...current, username: event.target.value }))
                    }
                    required
                    minLength={3}
                  />
                </div>
                <div className="field">
                  <label htmlFor="user-full-name">Full name</label>
                  <input
                    id="user-full-name"
                    className="input"
                    value={userForm.fullName}
                    onChange={(event) =>
                      setUserForm((current) => ({ ...current, fullName: event.target.value }))
                    }
                    required
                    minLength={2}
                  />
                </div>
                <div className="field">
                  <label htmlFor="user-email">Email</label>
                  <input
                    id="user-email"
                    className="input"
                    type="email"
                    value={userForm.email}
                    onChange={(event) =>
                      setUserForm((current) => ({ ...current, email: event.target.value }))
                    }
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="user-password">Temporary password</label>
                  <input
                    id="user-password"
                    className="input"
                    type="password"
                    value={userForm.password}
                    onChange={(event) =>
                      setUserForm((current) => ({ ...current, password: event.target.value }))
                    }
                    required
                    minLength={8}
                  />
                </div>
                <div className="field">
                  <label htmlFor="user-role">Role</label>
                  <select
                    id="user-role"
                    className="select"
                    value={userForm.roleId}
                    onChange={(event) =>
                      setUserForm((current) => ({ ...current, roleId: event.target.value }))
                    }
                    required
                  >
                    <option value="" disabled>
                      Select a role
                    </option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="user-status">Status</label>
                  <select
                    id="user-status"
                    className="select"
                    value={userForm.status}
                    onChange={(event) =>
                      setUserForm((current) => ({
                        ...current,
                        status: event.target.value as "active" | "inactive",
                      }))
                    }
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="btn-row">
                <button className="btn btn-primary" type="submit" disabled={savingUser}>
                  {savingUser ? "Creating…" : "Create user"}
                </button>
              </div>
            </form>

            <div className="stack" style={{ marginTop: 16 }}>
              {users.map((user) => (
                <div
                  key={user.id}
                  style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
                >
                  <div>
                    <strong>{user.fullName}</strong>
                    <div className="panel-sub">
                      {user.username} · {user.email}
                    </div>
                  </div>
                  <div className="btn-row">
                    <Badge tone={user.status === "active" ? "positive" : "neutral"} small>
                      {user.status}
                    </Badge>
                    <Badge tone="info" small>
                      {roleNameById.get(user.roleId) ?? "role"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2>Configure table responsibility</h2>
          <span className="panel-sub">{responsibilities.length} grants</span>
        </div>
        <div className="panel-body">
          <form className="form" onSubmit={createResponsibility}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="resp-name">Responsibility name</label>
                <input
                  id="resp-name"
                  className="input"
                  value={responsibility.responsibilityName}
                  onChange={(event) =>
                    setResponsibility((current) => ({
                      ...current,
                      responsibilityName: event.target.value,
                    }))
                  }
                  placeholder="Admission maker — students"
                  required
                  minLength={2}
                />
              </div>
              <div className="field">
                <label htmlFor="resp-module">Module</label>
                <input
                  id="resp-module"
                  className="input"
                  value={responsibility.moduleName}
                  onChange={(event) =>
                    setResponsibility((current) => ({
                      ...current,
                      moduleName: event.target.value,
                    }))
                  }
                  required
                  minLength={2}
                />
              </div>
              <div className="field">
                <label htmlFor="resp-table">Table</label>
                <select
                  id="resp-table"
                  className="select"
                  value={responsibility.tableName}
                  onChange={(event) =>
                    setResponsibility((current) => ({
                      ...current,
                      tableName: event.target.value as (typeof SMS_TABLE_OPTIONS)[number],
                    }))
                  }
                >
                  {SMS_TABLE_OPTIONS.map((table) => (
                    <option key={table} value={table}>
                      {table}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="resp-status">Status</label>
                <select
                  id="resp-status"
                  className="select"
                  value={responsibility.status}
                  onChange={(event) =>
                    setResponsibility((current) => ({
                      ...current,
                      status: event.target.value as "active" | "inactive",
                    }))
                  }
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="resp-maker">Maker user id (optional)</label>
                <input
                  id="resp-maker"
                  className="input"
                  value={responsibility.makerUserId}
                  onChange={(event) =>
                    setResponsibility((current) => ({
                      ...current,
                      makerUserId: event.target.value,
                    }))
                  }
                  placeholder="Blank = any authorised maker"
                />
              </div>
              <div className="field">
                <label htmlFor="resp-checker">Checker user id (optional)</label>
                <input
                  id="resp-checker"
                  className="input"
                  value={responsibility.checkerUserId}
                  onChange={(event) =>
                    setResponsibility((current) => ({
                      ...current,
                      checkerUserId: event.target.value,
                    }))
                  }
                  placeholder="Receives the pending notification"
                />
              </div>
              <div className="field">
                <label htmlFor="resp-from">Effective from (optional)</label>
                <input
                  id="resp-from"
                  className="input"
                  type="datetime-local"
                  value={responsibility.effectiveFrom}
                  onChange={(event) =>
                    setResponsibility((current) => ({
                      ...current,
                      effectiveFrom: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="resp-to">Effective to (optional)</label>
                <input
                  id="resp-to"
                  className="input"
                  type="datetime-local"
                  value={responsibility.effectiveTo}
                  onChange={(event) =>
                    setResponsibility((current) => ({
                      ...current,
                      effectiveTo: event.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="btn-row" style={{ flexWrap: "wrap" }}>
              {(
                [
                  ["canAdd", "Add"],
                  ["canEdit", "Edit"],
                  ["canView", "View"],
                  ["canDelete", "Delete"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={responsibility[key]}
                    onChange={() => toggleFlag(key)}
                  />
                  <span>{label}</span>
                </label>
              ))}
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={responsibility.makerCheckerRequired}
                  onChange={() =>
                    setResponsibility((current) => ({
                      ...current,
                      makerCheckerRequired: !current.makerCheckerRequired,
                    }))
                  }
                />
                <span>Maker–Checker required</span>
              </label>
            </div>

            <div className="btn-row">
              <button
                className="btn btn-primary"
                type="submit"
                disabled={savingResponsibility}
              >
                {savingResponsibility ? "Saving…" : "Save responsibility"}
              </button>
            </div>
          </form>

          <div className="stack" style={{ marginTop: 16 }}>
            {responsibilities.length === 0 ? (
              <p className="panel-sub">
                No grants yet — every operation is denied until a responsibility is configured.
              </p>
            ) : (
              responsibilities.map((item) => (
                <div
                  key={item.id}
                  style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
                >
                  <div>
                    <strong>{item.responsibilityName}</strong>
                    <div className="panel-sub">
                      {item.tableName} · {formatDateTime(item.createdAt)}
                    </div>
                  </div>
                  <div className="btn-row">
                    {item.canAdd ? <Badge tone="info" small>Add</Badge> : null}
                    {item.canEdit ? <Badge tone="info" small>Edit</Badge> : null}
                    {item.canView ? <Badge tone="neutral" small>View</Badge> : null}
                    {item.canDelete ? <Badge tone="negative" small>Delete</Badge> : null}
                    {item.makerCheckerRequired ? (
                      <Badge tone="warning" small>
                        Maker–Checker
                      </Badge>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Assign responsibilities</h2>
          <span className="panel-sub">
            {assignments?.roleResponsibilities.length ?? 0} role grants ·{" "}
            {assignments?.userResponsibilities.length ?? 0} user grants
          </span>
        </div>
        <div className="panel-body">
          <div className="grid-2">
            <form className="form" onSubmit={assignResponsibilityToRole}>
              <h3>Assign to role</h3>
              <div className="field">
                <label htmlFor="assign-role">Role</label>
                <select
                  id="assign-role"
                  className="select"
                  value={roleIdForAssignment}
                  onChange={(event) => setRoleIdForAssignment(event.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select a role
                  </option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="assign-responsibility">Responsibility</label>
                <select
                  id="assign-responsibility"
                  className="select"
                  value={responsibilityIdForAssignment}
                  onChange={(event) => setResponsibilityIdForAssignment(event.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select a responsibility
                  </option>
                  {responsibilities.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.responsibilityName} · {item.tableName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="btn-row">
                <button className="btn btn-primary" type="submit" disabled={savingRoleAssignment}>
                  {savingRoleAssignment ? "Assigning…" : "Assign to role"}
                </button>
              </div>
            </form>

            <form className="form" onSubmit={assignResponsibilityToUser}>
              <h3>Assign to user</h3>
              <div className="field">
                <label htmlFor="assign-user">User</label>
                <select
                  id="assign-user"
                  className="select"
                  value={userIdForAssignment}
                  onChange={(event) => setUserIdForAssignment(event.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select a user
                  </option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.fullName} ({user.username})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="assign-user-responsibility">Responsibility</label>
                <select
                  id="assign-user-responsibility"
                  className="select"
                  value={responsibilityIdForUserAssignment}
                  onChange={(event) => setResponsibilityIdForUserAssignment(event.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select a responsibility
                  </option>
                  {responsibilities.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.responsibilityName} · {item.tableName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="btn-row">
                <button className="btn btn-primary" type="submit" disabled={savingUserAssignment}>
                  {savingUserAssignment ? "Assigning…" : "Assign to user"}
                </button>
              </div>
            </form>
          </div>

          <div className="grid-2" style={{ marginTop: 16 }}>
            <div className="stack">
              <h3>Role assignments</h3>
              {(assignments?.roleResponsibilities ?? []).length === 0 ? (
                <p className="panel-sub">No responsibilities are assigned to roles yet.</p>
              ) : (
                (assignments?.roleResponsibilities ?? []).map((item) => {
                  const role = roles.find((candidate) => candidate.id === item.roleId);
                  const target = responsibilities.find(
                    (candidate) => candidate.id === item.responsibilityId,
                  );
                  return (
                    <div
                      key={item.id}
                      style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
                    >
                      <div>
                        <strong>{role?.name ?? item.roleId}</strong>
                        <div className="panel-sub">
                          {target?.responsibilityName ?? item.responsibilityId} ·{" "}
                          {target?.tableName ?? "—"}
                        </div>
                      </div>
                      <div className="btn-row">
                        <button
                          className="btn btn-ghost"
                          type="button"
                          onClick={() => void unassignRoleResponsibility(item.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="stack">
              <h3>User assignments</h3>
              {(assignments?.userResponsibilities ?? []).length === 0 ? (
                <p className="panel-sub">No responsibilities are assigned to users yet.</p>
              ) : (
                (assignments?.userResponsibilities ?? []).map((item) => {
                  const user = users.find((candidate) => candidate.id === item.userId);
                  const target = responsibilities.find(
                    (candidate) => candidate.id === item.responsibilityId,
                  );
                  return (
                    <div
                      key={item.id}
                      style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
                    >
                      <div>
                        <strong>{user?.fullName ?? item.userId}</strong>
                        <div className="panel-sub">
                          {user ? `${user.username} · ` : ""}
                          {target?.responsibilityName ?? item.responsibilityId} ·{" "}
                          {target?.tableName ?? "—"}
                        </div>
                      </div>
                      <div className="btn-row">
                        <button
                          className="btn btn-ghost"
                          type="button"
                          onClick={() => void unassignUserResponsibility(item.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
