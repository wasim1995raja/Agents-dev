# Blueprint Plan: Student Management System (SMS) MVP

**Objective:** Build the MVP of an enterprise-grade Student Management System (SMS) managing student information, admissions, academic details, courses, departments, fees, attendance, and related student activities — including configurable table-wise Maker–Checker authorization, audit trail, and dashboard/reports.

**Source spec:** User-provided requirements covering 14 functional modules, 22 functional test scenarios, 11 final deliverables, and a Definition of Done.

**Mode:** Direct mode (no git remote expected in this workspace) — edit-in-place, no branches.

---

## Phase Mapping (spec → Blueprint build phases)

| Build phase (user spec) | Blueprint phase alignment |
|---|---|
| Phase 1: Analyze requirements, generate BRD | Blueprint Research + Design |
| Phase 2: Functional design + DB schema | Design (data model step) |
| Phase 3: Architecture | Design (architecture step) |
| Phase 4: Auth + user management | Implementation step (foundational) |
| Phase 5: Responsibility configuration | Implementation step |
| Phase 6: Maker–Checker authorization engine | Implementation step (core) |
| Phase 7: Student + other modules | Implementation steps |
| Phase 8: Audit trail + reporting | Implementation step |
| Phase 9: Frontend/backend integration | Implementation step |
| Phase 10: Tests + defect fixing, end-to-end validation | Verification step |
| Final deliverables | Documentation step |

---

## Construction Plan (post-adversarial-review revision)

### Step 0 — Decision D1 resolution + bootstrap prerequisites (NEW owner: user)
- **Context brief:** Resolve SMS workspace placement & stack before any scaffold code.
- **Options:** (a) New SMS app inside existing pnpm monorepo following AutoDev conventions; (b) Standalone per spec preferred stack (React + Express/NestJS + Prisma + PostgreSQL + MUI + JWT + Zod).
- **Exit criteria:** Decision recorded.

### Step 1 — Project scaffold: SMS application workspace
- **Context brief:** Scaffold backend + frontend once D1 resolved.
- **Task list:** Scaffold backend service (REST API) and frontend app; wire shared packages (DB schema, Zod contracts, auth).
- **Verification:** `pnpm install` clean; service boots; frontend builds.
- **Exit criteria:** Scaffold compiles; no business logic yet.

### Step 2 — Database schema + migrations + seed
- **Context brief:** 17 tables: USERS, ROLES, USER_ROLES, RESPONSIBILITY_MASTER, ROLE_RESPONSIBILITIES, USER_RESPONSIBILITIES, STUDENT_MASTER, ADMISSION_MASTER, COURSE_MASTER, DEPARTMENT_MASTER, ACADEMIC_YEAR, FEE_STRUCTURE, ATTENDANCE, AUTHORIZATION_REQUEST, AUTHORIZATION_REQUEST_DETAILS, AUDIT_LOG, NOTIFICATION. Auth + audit design decisions needed.
- **Task list:** Migrations; soft-delete support; seed default roles (SUPER_ADMIN, ADMIN, ADMISSION_MAKER, ADMISSION_CHECKER, ACADEMIC_MAKER, ACADEMIC_CHECKER, FEE_MAKER, FEE_CHECKER, VIEWER) + initial SUPER_ADMIN user; NOTIFICATION table created.
- **Verification:** Migrations up/down against Postgres; typecheck.
- **Exit criteria:** Schema migrates cleanly; bootstrap data present.

### Step 3 — Auth + User/Role management (+ session lifecycle, security hardening)
- **Context brief:** JWT auth, secure password hashing, USERS fields, role CRUD, user↔role mapping; ADD session lifecycle (refresh token/expiry/revocation/logout), password reset, account lockout, failed-attempt throttling, rate limiting on all endpoints (security policy).
- **Task list:** Auth APIs, user CRUD, role CRUD, session lifecycle, password reset, rate limiting.
- **Verification:** Auth + user/role tests; typecheck.
- **Exit criteria:** Auth + user/role management green (incl. lifecycle).

### Step 4 — Table-wise responsibility engine (deny-by-default resolved)
- **Context brief:** SUPER_ADMIN configures per-table Add/Edit/View/Delete + Maker-Checker flags, Maker, Checker, Effective From/To, Status; independent CRUD; effective-dating (as-of query strategy); least privilege; deny-by-default (zero responsibilities → deny all); SUPER_ADMIN bypass semantics.
- **Task list:** Responsibility service + API + persistence.
- **Verification:** Permission unit tests incl. deny-by-default.
- **Exit criteria:** Responsibility engine green.

### Step 5 — Maker–Checker authorization engine (core, fully specified)
- **Context brief:** Add/Edit/Delete flows with fully specified state machine:
  - DRAFT = unsaved/new proposal created by maker (or explicit draft).
  - Maker submit → validate → store proposed record in AUTHORIZATION_REQUEST (+ details) → PENDING_APPROVAL; approved records untouched.
  - Edit: old values vs new values captured; RESUBMITTED = re-submit after REJECTED/CANCELLED.
  - Delete: proposed deletion stored; on approve → soft delete (status update); on reject → original retained.
  - Checker approve → conditional transition `UPDATE ... SET status='APPROVED' WHERE status='PENDING_APPROVAL' AND checker=...` with row-count guard (prevents duplicates/races); reject → REJECTED (record not applied); cancel → CANCELLED (maker may resubmit → RESUBMITTED).
  - Maker cannot approve own transaction.
- **Task list:** Request service, status machine, approve/reject logic, atomic conditional transactions, notifications trigger (see Step 7 deps).
- **Verification:** Functional scenarios at service layer.
- **Exit criteria:** Maker-checker engine green (incl. self-approval prevention, duplicate prevention).

### Step 6 — Business modules wired to permissions (split into submodule steps)
- **Context brief:** Student Management (CRUD + search/filter/export + auth history); Admission; Course; Department; Academic Year; Fee Structure; Attendance.
- **Task list:** Master-data modules + student/admission/fee/attendance operational modules behind permission checks.
- **Verification:** Permission-denied tests.
- **Exit criteria:** Modules operate only with granted permissions.

### Step 7 — Authorization queue + notification + audit trail (cross-cutting wiring)
- **Context brief:** Checker dashboard data + actions (view/compare/approve/reject/comment/history); NOTIFICATION delivery triggers on submit/approve/reject; AUDIT_LOG append-only design (append-only table + read-only DB role or trigger) covering transaction, old/new values, maker/checker, timestamps, status, rejection comments, IP, activity; permission-change audit events cross-cutting with responsibility changes.
- **Task list:** Queue API + UI; notification service; audit service.
- **Verification:** Audit + queue tests.
- **Exit criteria:** Queue + audit green.

### Step 8 — Dashboard + reports + frontend integration (split: UI shell / feature wiring)
- **Context brief:** Dashboard summary cards, searchable/sortable/paginated/filterable tables, forms, dialogs, status indicators, notifications UI, responsive layout; route guards + auth context + token handling; permission-based navigation.
- **Task list:** Frontend app scaffold, auth context/route guards, feature screens.
- **Verification:** E2E smoke.
- **Exit criteria:** UI↔API integrated, responsive.

### Step 9 — Tests, typecheck, defect fixing, end-to-end validation
- **Context brief:** 22 functional scenarios mapped across MC/permission/audit/module steps; typecheck clean; migrations; end-to-end maker-checker flow.
- **Task list:** Write/execute tests; fix defects; final verification.
- **Exit criteria:** All green per Definition of Done.

---

## Dependency graph (post-review revision)

- Step 3 → Step 2
- Step 4 → Step 2, Step 3 (permission config needs users/roles)
- Step 5 → Step 4, Step 3 (engine checks permissions; makers/checkers from user mgmt)
- Step 6 → Step 3, Step 4, Step 5
- Step 7 → Step 5, Step 6 (audit/queue consume MC + module activity)
- Step 8 → Step 6, Step 7
- Step 9 → all prior

---

## Rollback strategy

- Versioned migrations; per-step code boundaries; feature flags for risky authorization changes; append-only audit design keeps business data reversible.

---

## Verification commands (canonical)

- `pnpm install`
- `pnpm --filter <pkg> typecheck`
- `pnpm --filter <pkg> test`
- Migration: `pnpm --filter @autodev/db run setup`

---

## Review outcome (Phase 4 — incorporated)

Critical findings addressed: C1 (conditional approve transition), C2 (explicit status machine), C3 (notification ownership), C4 (auth lifecycle + rate limit), C5 (append-only audit design + cross-cutting events), C6 (seed/bootstrap), C7 (deny-by-default). Major findings addressed: M1 (dep graph fixed), M2 (step splitting), M3 (frontend auth/routing), M4 (soft-delete semantics), M5 (reports catalog), M6 (scenario mapping).

## Next actions

1. User confirms Decision D1 (stack / workspace placement).
2. Execute blueprint steps in order starting at Step 0/1.

---

## Build status log

**2026-11-02 — Session 2: assignment UI, queue old/new detail, dashboard aggregate, SMS E2E**

- `/sms/users`: added the responsibility assignment surface — `GET/POST /api/sms/assignments`,
  `POST/DELETE /api/sms/role-responsibilities/:id`, `POST/DELETE /api/sms/user-responsibilities/:id`
  are wired into the web client and rendered as assign-to-role / assign-to-user forms plus
  remove controls over the live assignment lists. Typecheck + full web build green.
- `GET /api/sms/authorizations` now returns each authorization together with its proposed
  `detail` (old/new values) so checkers can compare before deciding; covered by a new API test
  (`lists authorizations together with their proposed old/new values`). Queue UI renders the
  old → new field comparison per proposal.
- `/sms` dashboard gained a "Pending by table" aggregate panel (pending proposals grouped by table).
- Playwright SMS E2E added (`apps/web/e2e/sms.spec.ts`): control centre snapshot, users & access
  assignment surface, queue proposal flow — all 3 pass against the live API + Postgres.
- Full verification this session: `pnpm typecheck` green, `pnpm test` green (36 API incl. 9 SMS,
  27 packages/sms, web 16), `pnpm --filter @autodev/web build` green.

**Known gaps / next build targets**

1. ~~Approved mutations apply only to `sms_students`~~ **DONE**: `APPLY_SUPPORTED_TABLES` now covers
   all seven SMS tables (students, departments, courses, academic years, admissions, fees, attendance).
2. ~~Permission checks are table-level but not yet actor-scoped~~ **DONE**: role↔responsibility and
   user↔responsibility mappings are enforced (`resolvePermission` honours assigned grants overlaid
   with maker/checker refs); wired through the new assignment endpoints + `/sms/users` UI.
3. Identity is header-based (`x-sms-user-id` / `x-sms-checker-id`) for the MVP; replace with JWT subject in Step 3 hardening.
4. Audit table is append-only by convention, not yet enforced by DB permissions/trigger.
5. ~~Reporting/dashboard aggregates and notifications UI~~ **DONE**: dashboard aggregates (pending by
   table, stats) + notifications panel with mark-read are live; queue old/new detail comparison added;
   Playwright SMS E2E added and green.

