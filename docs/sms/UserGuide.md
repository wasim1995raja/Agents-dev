# Student Management System (SMS) — Draft User Guide

Status: **Draft (MVP)** — reflects the current build in `plans/sms-build-mvp.md`.

---

## 1. What the SMS does

The SMS is the table-wise permission and approval surface for school operations:

- **Deny-by-default**: a user can act on a table (students, admissions, courses, departments,
  academic years, fees, attendance) only through an effective responsibility grant. No grant → denied.
- **Maker–Checker**: when a responsibility requires maker–checker approval, writes are proposed,
  queued, and applied only after a checker approves. Rejected proposals keep the original data.
- **Self-approval prevention**: a maker cannot approve their own transaction.
- **Duplicate protection**: an approval/decision can only happen once per transaction.
- **Audit + notifications**: every submit/decide writes an audit entry and an in-app notification.

## 2. Starting the application

```bash
pnpm install
pnpm --filter @autodev/db run setup   # apply SMS migrations
pnpm --filter @autodev/api start     # API on http://127.0.0.1:3001
pnpm --filter @autodev/web dev       # Web on http://127.0.0.1:3000
```

Local bootstrap admin (username `superadmin`, password from `SMS_ADMIN_PASSWORD` or `ChangeMe123!`
in local-only setups).

Demo maker/checker identities used by the MVP API (`x-sms-user-id` / `x-sms-checker-id` headers):
`sms-local-maker` and `sms-local-checker`.

## 3. Step-by-step usage

### Step 1 — Open the dashboard (`/sms`)

The control centre shows:

- Stat cards: active users, roles, responsibilities, pending approvals, audit events.
- **Pending approvals** — transactions awaiting a decision.
- **Pending by table** — open proposals grouped by table.
- **Recent audit** — latest submit/decide events.
- **Notifications** — maker/checker inbox; unread items can be marked read.
- **Responsibility matrix** — configured grants and their Add/Edit/View/Delete flags.

### Step 2 — Propose a transaction (`/sms/queue`)

1. **Propose a transaction** form:
   - *Table*: which SMS table the change targets.
   - *Operation*: `add`, `edit`, or `delete`.
   - *Proposed values*: JSON object. `add` sends the new record; `edit` needs its `id` plus changed
     fields; `delete` needs only `id`.
2. Submit → the proposal is validated and queued as `pending_approval` (or applied directly when the
   responsibility has maker–checker disabled).
3. The checker receives a notification and sees the transaction under **Awaiting decision**.
4. Open a pending item and:
   - Add a **checker comment** (recorded on decision).
   - **Approve** → conditional transition applies the mutation atomically; duplicates → 409.
   - **Reject** → mutation is not applied; original record stays untouched.

### Step 3 — Review an edit before deciding

Pending proposals carry a proposed change with `oldValues` / `newValues`. The queue renders an
old → new field comparison so checkers can review exactly what changes before approving.

### Step 4 — Assign responsibilities (`/sms/users`)

Admin workflow:

1. **Create role** — e.g. `ADMISSION_CHECKER`.
2. **Create user** — with a temporary password and a role.
3. **Configure responsibility** — module, table, Add/Edit/View/Delete flags, maker–checker flag,
   maker/checker references, effective from/to, status.
4. **Assign responsibilities** — link a role ↔ responsibility or a user ↔ responsibility.
   Assigned grants overlay the legacy maker/checker fields.

### Step 5 — End-to-end example (maker adds a student)

1. Maker submits an `add` proposal on `sms_students` through the queue.
2. Self-approval is refused (maker ≠ checker).
3. Checker approves → mutation applied, audit written, notification sent.
4. Re-approving the same transaction → 409 duplicate.

## 4. Recommended operator flow

1. Admin configures responsibilities (Step 4) and assigns makers/checkers.
2. Makers propose changes via `/sms/queue`.
3. Checkers review (old/new comparison, comment) and decide.
4. Auditors read `/sms` recent audit entries; operators watch notifications.

## 5. Known MVP limitations

- Identity is header-based (`x-sms-user-id` / `x-sms-checker-id`); JWT subject wiring is pending.
- Audit is append-only by convention, not yet DB-enforced.
- Direct application when maker–checker is not required is audited but bypasses the queue.
