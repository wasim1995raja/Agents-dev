/**
 * Table-wise responsibility resolution for the Student Management System.
 *
 * Rules implemented (BRD §4):
 * - Permissions are independent per operation (Add/Edit/View/Delete).
 * - Deny by default: a user with no applicable responsibility is denied.
 * - Effective dating: a responsibility only applies within its validity window.
 * - A maker–checker requirement on a responsibility means the operation must
 *   flow through the Maker–Checker state machine rather than executing directly.
 */

import type {
  SmsActor,
  SmsPermissionCheckInput,
  SmsPermissionDecision,
  SmsPermissionOperation,
  SmsResponsibility,
  SmsResponsibilityFlags,
} from "./domain.js";

const FLAG_BY_OPERATION: Record<SmsPermissionOperation, keyof SmsResponsibilityFlags> = {
  add: "canAdd",
  edit: "canEdit",
  view: "canView",
  delete: "canDelete",
};

/**
 * A responsibility names the maker who may propose work. When no maker is
 * named the responsibility is open to any actor (deny-by-default still applies
 * at the table/flag level).
 */
export function isMakerGranted(responsibility: SmsResponsibility, actor: SmsActor): boolean {
  if (!responsibility.makerUserId) return true;
  return responsibility.makerUserId === actor.userId;
}

/**
 * A responsibility names either a checker user or a checker role. When neither
 * is named, any actor may check (still blocked from approving their own work).
 */
export function isCheckerGranted(responsibility: SmsResponsibility, actor: SmsActor): boolean {
  if (responsibility.checkerUserId) {
    return responsibility.checkerUserId === actor.userId;
  }
  if (responsibility.checkerRoleId) {
    return actor.roleIds.includes(responsibility.checkerRoleId);
  }
  return true;
}

function isWithinWindow(responsibility: SmsResponsibility, nowIso: string): boolean {
  if (responsibility.status !== "active") return false;
  const from = responsibility.effectiveFrom;
  const to = responsibility.effectiveTo;
  if (from && nowIso < from) return false;
  if (to && nowIso > to) return false;
  return true;
}

/**
 * Resolves whether `actor` may perform `operation` on `tableName`.
 *
 * Lookup order for a single actor:
 *  1. User-scoped responsibilities (maker/checker assignments on the user).
 *  2. Role-scoped responsibilities (via assigned roles).
 * Deny-by-default: no match → denied.
 */
export function resolvePermission(
  input: SmsPermissionCheckInput,
): SmsPermissionDecision {
  const nowIso = input.nowIso;
  const candidates = input.responsibilities.filter(
    (r) => r.tableName === input.tableName,
  );
  const applicable = candidates.filter((r) => isWithinWindow(r, nowIso));

  const decision: SmsPermissionDecision = {
    allowed: false,
    responsibilityId: null,
    requiresApproval: false,
    reason: candidates.length > 0 ? "not_effective" : "deny_by_default",
  };

  for (const responsibility of applicable) {
    const flagKey = FLAG_BY_OPERATION[input.operation];
    const hasFlag = responsibility.flags[flagKey];
    if (!hasFlag) {
      decision.reason = "missing_flag";
      continue;
    }
    if (responsibility.makerCheckerRequired) {
      // Direct execution is refused: the operation must go through the
      // maker–checker queue instead (see resolveSubmitPermission).
      decision.requiresApproval = true;
      decision.reason = "checker_required";
      continue;
    }
    decision.allowed = true;
    decision.responsibilityId = responsibility.id;
    decision.reason = "ok";
    break;
  }

  return decision;
}

/**
 * Resolves whether `actor` may *start* maker–checker work for `tableName`.
 *
 * Unlike direct execution, a maker–checker-required responsibility permits the
 * maker to submit a proposal — it just cannot be applied until a checker
 * approves it. The returned `requiresApproval` tells the caller which path to
 * take: create a pending authorization request, or apply directly.
 */
export function resolveSubmitPermission(
  input: SmsPermissionCheckInput,
): SmsPermissionDecision {
  const candidates = input.responsibilities.filter(
    (r) => r.tableName === input.tableName,
  );
  const applicable = candidates.filter((r) => isWithinWindow(r, input.nowIso));

  const decision: SmsPermissionDecision = {
    allowed: false,
    responsibilityId: null,
    requiresApproval: false,
    reason: candidates.length > 0 ? "not_effective" : "deny_by_default",
  };

  for (const responsibility of applicable) {
    const flagKey = FLAG_BY_OPERATION[input.operation];
    if (!responsibility.flags[flagKey]) {
      decision.reason = "missing_flag";
      continue;
    }
    decision.allowed = true;
    decision.responsibilityId = responsibility.id;
    decision.requiresApproval = responsibility.makerCheckerRequired;
    decision.reason = "ok";
    break;
  }

  return decision;
}
