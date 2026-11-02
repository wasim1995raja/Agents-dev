# SMS — UI Demo Walkthrough

Step-by-step demo of the Student Management System UI (`/sms`, `/sms/queue`, `/sms/users`).
All pages run against the live stack: web on `http://127.0.0.1:3000`, API on `http://127.0.0.1:3001`.

## Prerequisites for a live demo

1. API + web running (already running during demo sessions).
2. A maker responsibility configured for a table, e.g. on `sms_students`:

   - Responsibility name: `Demo maker — students`
   - Module: `student`
   - Table: `sms_students`
   - Flags: Add ✓, Edit ✗, View ✓, Delete ✗
   - Maker–Checker required: ✓
   - Maker user id: `sms-local-maker`
   - Checker user id: `sms-local-checker`
   - Status: `active`

   (Created via `/sms/users` → *Configure table responsibility*, or via the API.)

## Demo sequence

### Step 1 — Dashboard (`/sms`)

1. Open `http://127.0.0.1:3000/sms`.
2. Expect the stat cards: Active users, Roles, Responsibilities, Pending approvals, Audit events.
3. Expect panels: *Pending approvals*, *Pending by table*, *Recent audit*, *Notifications*, *Responsibility matrix*.
4. If nothing is pending, the *Pending approvals* panel shows the empty state.

### Step 2 — Create a responsibility (`/sms/users`)

1. Open `http://127.0.0.1:3000/sms/users`.
2. *Configure table responsibility* form:
   - Responsibility name, module, table (`sms_students`), status.
   - Toggle Add/Edit/View/Delete flags.
   - Enable *Maker–Checker required*.
   - Fill maker/checker user ids (`sms-local-maker`, `sms-local-checker`).
3. Save → *Responsibility configured. Deny-by-default now has an explicit grant.*

### Step 3 — Propose a transaction (`/sms/queue`)

1. Open `http://127.0.0.1:3000/sms/queue`.
2. *Propose a transaction*:
   - Table: `sms_students`
   - Operation: `add`
   - Payload (JSON): e.g. `{ "admissionNumber": "ADM-1001", "firstName": "Ada", "lastName": "Lovelace", "email": "ada@example.test" }`
3. Submit for approval → status `pending_approval` with a `TX-…` transaction id.

### Step 4 — Checker decides (`/sms/queue`)

1. The pending item appears under *Awaiting decision* with the *Proposed change* old → new comparison.
2. Checker adds an optional comment and clicks **Approve** (or **Reject**).
3. Approve → mutation applied (`applied: true`), notification written, audit entry created.
4. Reject → mutation **not** applied; original data retained.

### Step 5 — Observe effects (`/sms`)

1. *Pending approvals* now empty (or updated).
2. *Recent audit* shows submit/decide entries.
3. *Notifications* shows the maker/checker inbox; unread items can be marked read.

### Step 6 — Assignment management (`/sms/users`)

1. *Assign responsibilities* → assign a responsibility to a role or user.
2. Remove assignments via the *Remove* button.

## Expected live outcomes

- Maker self-approve → `403` "cannot approve their own transaction".
- Checker approve → `200` `{ status: "approved", applied: true }`; duplicate approve → `409`.
- Reject → status `rejected`; row unchanged.
- No responsibility → deny-by-default `403` on submit.

## Demo commands (services)

```bash
pnpm --filter @autodev/db run setup
pnpm --filter @autodev/api start     # http://127.0.0.1:3001
pnpm --filter @autodev/web dev       # http://127.0.0.1:3000
```
