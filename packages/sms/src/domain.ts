/**
 * Student Management System (SMS) — core domain vocabulary.
 *
 * Dependency-free constants and types shared by the SMS responsibility,
 * maker-checker and audit building blocks. Mirrors the schema added to
 * `@autodev/db` (sms_* tables) and the BRD/FSD docs under `docs/sms/`.
 */

export const SMS_TABLES = [
  "sms_students",
  "sms_admissions",
  "sms_courses",
  "sms_departments",
  "sms_academic_years",
  "sms_fees",
  "sms_attendance",
] as const;

export type SmsTableName = (typeof SMS_TABLES)[number];

export const SMS_OPERATIONS = ["add", "edit", "delete"] as const;

export type SmsOperation = (typeof SMS_OPERATIONS)[number];

/** Permission-level operations (view is read-only and not maker-checker gated). */
export const SMS_PERMISSION_OPERATIONS = ["add", "edit", "view", "delete"] as const;

export type SmsPermissionOperation = (typeof SMS_PERMISSION_OPERATIONS)[number];

export const SMS_AUTHORIZATION_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "cancelled",
  "resubmitted",
] as const;

export type SmsAuthorizationStatus = (typeof SMS_AUTHORIZATION_STATUSES)[number];

/** CRUD flags on a responsibility. Independent per operation. */
export interface SmsResponsibilityFlags {
  canAdd: boolean;
  canEdit: boolean;
  canView: boolean;
  canDelete: boolean;
}

export interface SmsResponsibility {
  id: string;
  responsibilityName: string;
  moduleName: string;
  tableName: SmsTableName | string;
  flags: SmsResponsibilityFlags;
  makerCheckerRequired: boolean;
  makerUserId: string | null;
  checkerUserId: string | null;
  checkerRoleId: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SmsUserResponsibilityRef {
  userId: string;
  responsibilityId: string;
}

export interface SmsCheckerAssignment {
  checkerUserId: string | null;
  checkerRoleId: string | null;
}

/** Who is acting: a concrete user id, or a role that may act. */
export interface SmsActor {
  userId: string;
  roleIds: string[];
}

export interface SmsPermissionCheckInput {
  actor: SmsActor;
  tableName: string;
  operation: SmsPermissionOperation;
  responsibilities: SmsResponsibility[];
  nowIso: string;
}

export interface SmsPermissionDecision {
  allowed: boolean;
  responsibilityId: string | null;
  /** True when the matched responsibility routes this operation through maker–checker. */
  requiresApproval: boolean;
  reason: "deny_by_default" | "missing_flag" | "not_effective" | "checker_required" | "ok";
}

/** A proposed business mutation awaiting maker–checker disposition. */
export interface SmsAuthorizationRequest {
  transactionId: string;
  tableName: string;
  operationType: SmsOperation;
  status: SmsAuthorizationStatus;
  makerUserId: string;
  checkerUserId: string | null;
  submittedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface SmsAuthorizationDecision {
  approved: boolean;
  note?: string | null;
}

/** Immutable-ish audit record for a maker/checker transaction. */
export interface SmsAuditEntry {
  transactionId: string;
  tableName: string;
  recordId: string;
  operationType: SmsOperation;
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  makerUserId: string;
  checkerUserId: string | null;
  status: string;
  rejectionComment: string | null;
  ipAddress: string | null;
  activityDescription: string;
  createdAt: string;
}

export const EMPTY_SMS_FLAGS: SmsResponsibilityFlags = {
  canAdd: false,
  canEdit: false,
  canView: false,
  canDelete: false,
};
