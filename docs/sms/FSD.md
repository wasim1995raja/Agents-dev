# Student Management System (SMS) — Functional Specification Document (FSD)

**Parent:** BRD (`docs/sms/BRD.md`)
**Status:** Draft for Phase 3
**MVP modules covered:** User, Role, Responsibility, Table Access, Student, Admission, Course, Department, Academic Year, Fee, Attendance, Maker–Checker, Audit, Dashboard/Reports.

---

## 1. Functional Requirements Detail

### FR-1 User Management
- CRUD for users: User ID, Username, Full Name, Email, Password (hash), Role, Department, Status (Active/Inactive), Created Date.
- Assign roles; custom roles creatable by admin.

### FR-2 Responsibility Management
- Configure per table: Add/Edit/View/Delete booleans, Maker-Checker Required, Maker User, Checker User/Checker Role, Effective From/To, Status.
- Per responsibility: Responsibility ID, name, user/role scope, module, table, flags, workflow refs, validity, status.

### FR-3 Enforcement
- Independent CRUD flags; deny-by-default; least privilege; effective dating; SUPER_ADMIN override.
- Permission changes audit-logged; themselves subject to maker-checker.

### FR-4–FR-9 Maker–Checker + operations
(Summarized from BRD; state machine formalized in Technical Design.)

## 2. Module Specifications

### 2.1 Student Management
- Add/Edit/View/Delete (+Delete via MC soft delete), Search, Filter, Export, Authorization History.
- Fields per source spec table.

### 2.2 Admission / Course / Department / Academic Year / Fee / Attendance
- Master-data CRUD where flagged; operational flows for Admission, Fees, Attendance.

## 3. Authorization Queue (Checker Dashboard)
- List by transaction/table/operation/maker/date/status filters.
- Actions: View Details, Compare Changes (old vs new), Approve, Reject, Add Comments, View History.

## 4. Audit Trail
- Immutable append-only records; cross-cutting events (auth, permission changes).

## 5. Dashboard & Reports
- Summary cards, searchable/sortable/paginated/filterable tables, status indicators, notifications, responsive UI.

## 6. Functional Test Scenarios
- 22 scenarios mapped (see blueprint plan, Step 9 / Step 5).
