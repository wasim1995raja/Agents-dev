# Student Management System (SMS) — Business Requirements Document (BRD)

**Project:** SMS MVP
**Source:** User-provided requirements (Student Management System)
**Date:** 2026-11-01
**Status:** Draft for Phase 2 (Functional Design)

---

## 1. Purpose

Build an enterprise-grade Student Management System that manages student information, admissions, academic details, courses, departments, fees, attendance, and related student activities — with configurable table-wise access control and a Maker–Checker authorization workflow.

The primary objective: users can perform Add, Edit, View, and Delete only when authorized. Maker–Checker operations must be submitted for approval before the database record is created/modified/deleted.

## 2. Scope

### In scope (MVP)
- User Management (users, roles, user↔role, status, audit).
- Role Management + Responsibility Management (table-wise CRUD permissions, effective dating, least privilege).
- Student Management (master data CRUD, search, filter, export, auth history).
- Admission, Course, Department, Academic Year, Fee Structure, Attendance modules.
- Maker–Checker workflow for Add / Edit / Delete with pending-approval persistence.
- Checker dashboard (queue, compare old vs new, approve/reject/comment/history).
- Audit trail (append-only, immutable).
- Dashboard + Reports.
- Functional tests (22 scenarios) + typecheck + E2E.

### Out of scope (MVP)
- Multi-tenancy (enterprise-grade claim, deferred).
- Email/SMS real delivery (NOTIFICATION table + plumbing, simulated/internal).
- Password reset, self-service account flows (auth lifecycle hardening landed separately).
- Reporting engine beyond dashboard summaries.

## 3. Functional Requirements Summary

| ID | Requirement |
|---|---|
| FR-1 | User management with roles (SUPER_ADMIN, ADMIN, ADMISSION_MAKER, ADMISSION_CHECKER, ACADEMIC_MAKER, ACADEMIC_CHECKER, FEE_MAKER, FEE_CHECKER, VIEWER) + custom roles. |
| FR-2 | Table-wise responsibility configuration: Add/Edit/View/Delete flags per table, Maker-Checker flag, Maker user, Checker user/role, Effective From/To, Status. |
| FR-3 | Independent CRUD permissions per table; deny-by-default; least privilege; effective dating. |
| FR-4 | Maker–Checker Add: validate → store proposed in pending (AUTHORIZATION_REQUEST) → PENDING_APPROVAL → checker approve (apply) / reject (discard). |
| FR-5 | Maker–Checker Edit: capture old vs new → pending → approve (update) / reject (retain original). |
| FR-6 | Maker–Checker Delete: pending → approve (soft delete) / reject (retain). |
| FR-7 | Maker cannot approve own transaction; no duplicate approvals; atomic conditional transitions. |
| FR-8 | Authorization statuses: DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, CANCELLED, RESUBMITTED. |
| FR-9 | View permission independent; unauthorized → access denied; pending not visible as approved. |
| FR-10 | Audit trail: transaction, table, record, operation, old/new values, maker/checker, timestamps, status, rejection comments, IP, activity. Append-only. |
| FR-11 | Dashboard + reports. |

## 4. User Stories (MVP subset)

- US-1: Admission maker submits student creation → pending → admission checker approves → student created.
- US-2: Fee maker submits fee structure change → fee checker approves → applied.
- US-3: Academic maker submits attendance correction → academic checker approves → applied.
- US-4: Viewer with View permission reads authorized student records only.
- US-5: Admin configures responsibility matrix for a role/table.

## 5. Acceptance Criteria (from source spec, summarized)

- All functional requirements implemented.
- Tests green; TypeScript clean; DB ops end-to-end.
- Maker-checker works correctly (incl. self-approval prevention, duplicate prevention).
- RBAC + table-wise permissions enforced backend-side.
- Responsive UI with validation + error handling.
- Definition of Done: app starts; migrations run; auth; perms; MC; view; audit; UI integrated; tests pass; typecheck clean; no critical security defects.

## 6. Out of BRD

This BRD feeds Phase 2 (FSD + DB schema design). Implementation phases follow in the blueprint plan (`plans/sms-build-mvp.md`).
