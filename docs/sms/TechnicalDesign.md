# Student Management System (SMS) — Technical Design Document

**Note:** This document is the Technical Design Doc (TDD). It is distinct from "TDD" as Test-Driven Development (an ECC workflow) — where TDD is a process, this document is a design artifact. Both apply: design first, then test-driven implementation.

**Parent:** BRD (`docs/sms/BRD.md`) + FSD (`docs/sms/FSD.md`)
**Stack decision (D1):** Adopt the existing Blueprint stack of this repository — Node.js + Fastify 5 REST API, PostgreSQL + Drizzle ORM, Next.js 16 App Router frontend, Zod validation, pino logging, Vitest + Playwright, Docker sandbox — unless the user overrides before build.

---

## 1. Architecture

- Layers: API routes → services (auth, responsibility, maker-checker, audit, notification) → repositories (Drizzle) → DB.
- MQ pattern: proposed ops persisted in AUTHORIZATION_REQUEST/ADMISSION_REQUEST_DETAILS; approved ops applied to master tables in a single DB transaction.

## 2. Data Model (core aggregates)

- USERS, ROLES, USER_ROLES, RESPONSIBILITY_MASTER, ROLE_RESPONSIBILITIES, USER_RESPONSIBILITIES, STUDENT_MASTER, ADMISSION_MASTER, COURSE_MASTER, DEPARTMENT_MASTER, ACADEMIC_YEAR, FEE_STRUCTURE, ATTENDANCE, AUTHORIZATION_REQUEST, AUTHORIZATION_REQUEST_DETAILS, AUDIT_LOG, NOTIFICATION.

### 2.1 Maker–Checker state machine (finalized)

- DRAFT → (maker submits) → PENDING_APPROVAL → (checker approves) → APPROVED → applied.
- PENDING_APPROVAL → (checker rejects) → REJECTED (not applied; resubmit → RESUBMITTED).
- PENDING_APPROVAL → (maker/checker cancels) → CANCELLED → maker may resubmit → RESUBMITTED.
- Conditional transition: `UPDATE authorization_request SET status='APPROVED', ... WHERE status='PENDING_APPROVAL' AND checker_user_id=:checker AND transaction_id=:tx` with row-count check → prevents duplicates/races.

## 3. API design (REST)

- Auth: POST /auth/login, refresh, logout, me.
- Users: CRUD + role assignment.
- Responsibilities: CRUD + effective-dating queries.
- MC: POST /authorizations (submit), GET /authorizations (queue), POST /authorizations/:id/approve, POST /authorizations/:id/reject, GET /authorizations/:id/history.
- Business: CRUD per module honoring table-wise permissions.
- Audit: GET /audit (append-only read).
- Reports/Dashboard: aggregated read models.

## 4. Security

- JWT (access + refresh), secure hashing, lockout, rate limit, deny-by-default, append-only audit, least privilege, self-approval prevention.

## 5. Error handling / API error envelope

- Consistent envelope: success, data, error, message, pagination.

## 6. Testing strategy

- Unit (services, permission, MC state machine), integration (DB), E2E (22 scenarios via Playwright where applicable).

## 7. Deployment

- Migrations via drizzle-kit; env config; sandbox image.
