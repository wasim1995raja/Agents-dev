/**
 * Maker–Checker authorization engine for the Student Management System.
 *
 * State machine (BRD §5 + Technical Design §2):
 *   draft ──(maker submits)──> pending_approval
 *   pending_approval ──(checker approves)──> approved ──(apply)──> applied
 *   pending_approval ──(checker rejects)──> rejected ──(not applied)
 *   pending_approval ──(cancel)──> cancelled ──(maker resubmits)──> resubmitted
 *
 * Approve is implemented as a conditional transition so duplicate approval
 * attempts cannot double-apply: the persisted row must still be
 * `pending_approval` when the conditional update runs (WHERE status =
 * 'pending_approval'); a zero-row update counts as already-decided.
 */

import type {
  SmsAuthorizationDecision,
  SmsAuthorizationRequest,
  SmsAuthorizationStatus,
} from "./domain.js";

export interface SmsDecideInput {
  request: SmsAuthorizationRequest;
  decision: SmsAuthorizationDecision;
  /** The user attempting the decision (for self-approval prevention). */
  checkerUserId: string;
  nowIso: string;
}

export interface SmsDecideResult {
  ok: boolean;
  /** Terminal-ish status after the decision. */
  status: SmsAuthorizationStatus;
  /** True when the request was not in `pending_approval` (already decided). */
  duplicate: boolean;
  reason?: string;
}

export function decideAuthorization(input: SmsDecideInput): SmsDecideResult {
  const { request, decision, checkerUserId } = input;

  if (request.makerUserId === checkerUserId) {
    // Separation of duties: a maker can never decide their own transaction.
    return {
      ok: false,
      status: request.status,
      duplicate: false,
      reason: "self_approval",
    };
  }

  if (request.status === "approved") {
    // Terminal status reached: any further decision is a duplicate.
    return { ok: false, status: "approved", duplicate: true, reason: "already_approved" };
  }

  if (request.status !== "pending_approval") {
    return { ok: false, status: request.status, duplicate: false, reason: "not_pending" };
  }

  const status: SmsAuthorizationStatus = decision.approved ? "approved" : "rejected";

  if (decision.approved) {
    // Conditional apply: only rows still pending_approval transition.
    // The persistence layer performs
    //   UPDATE sms_authorization_requests SET status='approved', ... WHERE id=:id AND status='pending_approval'
    // and treats rowCount 0 as a duplicate/rejected-race.
    return { ok: true, status, duplicate: false };
  }

  // Reject: record decision, do NOT apply the proposed mutation.
  return { ok: true, status, duplicate: false };
}

export function submissionState(request: SmsAuthorizationRequest): SmsAuthorizationStatus {
  return request.status;
}
