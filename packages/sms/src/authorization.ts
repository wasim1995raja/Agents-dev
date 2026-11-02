/**
 * SMS Maker–Checker workflow service.
 *
 * Composes the responsibility gate (who may act) with the authorization
 * state machine (what happens to a proposed mutation) and the audit trail.
 *
 * Flow (BRD §5):
 *  - Maker submits an operation → submission gate → pending_approval request
 *    persisted; approved records untouched.
 *  - Checker approves  → conditional transition → apply mutation.
 *  - Checker rejects   → mark rejected; proposed mutation NOT applied.
 *  - Maker resubmits after reject/cancel → new/resubmitted request.
 *
 * Separation of duties is enforced here: a maker can never decide their own
 * transaction, and the persistence layer performs the status change with a
 * conditional `WHERE status = 'pending_approval'` update so a decided request
 * can never be applied twice.
 */

import type {
  SmsActor,
  SmsAuditEntry,
  SmsAuthorizationRequest,
  SmsResponsibility,
} from "./domain.js";
import { decideAuthorization } from "./maker-checker.js";
import { resolveSubmitPermission } from "./responsibility.js";

export interface SmsAuditPort {
  write(entry: SmsAuditEntry): Promise<void>;
}

export interface SmsPendingInput {
  transactionId: string;
  tableName: string;
  operationType: "add" | "edit" | "delete";
  makerUserId: string;
  checkerUserId: string | null;
  submittedAt: string;
  /** Proposed record payload (new values, or `id` for delete). */
  payload: Record<string, unknown>;
}

export interface SmsTransitionInput {
  transactionId: string;
  to: "approved" | "rejected";
  checkerUserId: string;
  decidedAt: string;
  note: string | null;
}

export interface SmsTransitionResult {
  /** False when the row was no longer `pending_approval` (raced/duplicate). */
  transitioned: boolean;
  /** True when the business mutation was applied (approved + supported table). */
  applied: boolean;
}

export interface SmsAuthorizationPort {
  /** Persist a proposed mutation as a pending request. Returns the request. */
  savePending(input: SmsPendingInput): Promise<SmsAuthorizationRequest>;
  /** Atomic status transition with row-count guard. */
  transition(input: SmsTransitionInput): Promise<SmsTransitionResult>;
}

export interface SmsAuthorizationServiceDeps {
  actor: SmsActor;
  responsibilities: SmsResponsibility[];
  audit: SmsAuditPort;
  nowIso: () => string;
  savePending: SmsAuthorizationPort["savePending"];
  transition: SmsAuthorizationPort["transition"];
  /**
   * Applies a mutation immediately when the matching responsibility does not
   * require maker–checker approval. Omitted by pure domain tests, in which case
   * every accepted submission still goes through the approval queue.
   */
  applyDirect?: (input: {
    transactionId: string;
    tableName: string;
    operationType: "add" | "edit" | "delete";
    payload: Record<string, unknown>;
    makerUserId: string;
    nowIso: string;
  }) => Promise<boolean>;
}

export interface SmsSubmitInput {
  tableName: string;
  operationType: "add" | "edit" | "delete";
  payload: Record<string, unknown>;
  nowIso: string;
}

export interface SmsSubmitResult {
  ok: boolean;
  transactionId?: string;
  status?: string;
  /** True when the matched responsibility routes through maker–checker. */
  requiresApproval?: boolean;
  reason?: string;
}

export interface SmsApproveResult {
  ok: boolean;
  applied: boolean;
  status?: string;
  reason?: string;
}

export interface SmsRejectResult {
  ok: boolean;
  status?: string;
  reason?: string;
}

function recordIdFor(payload: Record<string, unknown>): string {
  const candidate = payload.id ?? payload.studentId ?? payload.admissionNumber;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : "unknown";
}

export class SmsAuthorizationService {
  constructor(private readonly deps: SmsAuthorizationServiceDeps) {}

  /**
   * Maker submits a proposed mutation. Denied → no request is created.
   * A maker–checker-required responsibility still allows submission; it just
   * creates a pending request instead of applying directly.
   */
  async submit(input: SmsSubmitInput): Promise<SmsSubmitResult> {
    const permission = resolveSubmitPermission({
      actor: this.deps.actor,
      tableName: input.tableName,
      operation: input.operationType,
      responsibilities: this.deps.responsibilities,
      nowIso: input.nowIso,
    });

    if (!permission.allowed) {
      return { ok: false, status: "denied", reason: permission.reason };
    }

    const responsibility = this.deps.responsibilities.find(
      (item) => item.id === permission.responsibilityId,
    );

    const transactionId = `TX-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    // No maker–checker requirement: execute now. Direct execution is still
    // audited under the same transaction id for traceability.
    if (!permission.requiresApproval && this.deps.applyDirect) {
      await this.deps.applyDirect({
        transactionId,
        tableName: input.tableName,
        operationType: input.operationType,
        payload: input.payload,
        makerUserId: this.deps.actor.userId,
        nowIso: input.nowIso,
      });

      await this.deps.audit.write({
        transactionId,
        tableName: input.tableName,
        recordId: recordIdFor(input.payload),
        operationType: input.operationType,
        oldValues: {},
        newValues: input.payload,
        makerUserId: this.deps.actor.userId,
        checkerUserId: null,
        status: "approved",
        rejectionComment: null,
        ipAddress: null,
        activityDescription: `maker applied ${input.operationType} for ${input.tableName} directly (maker-checker not required)`,
        createdAt: input.nowIso,
      });

      return {
        ok: true,
        transactionId,
        status: "applied",
        requiresApproval: false,
      };
    }

    const request = await this.deps.savePending({
      transactionId,
      tableName: input.tableName,
      operationType: input.operationType,
      makerUserId: this.deps.actor.userId,
      checkerUserId: responsibility?.checkerUserId ?? null,
      submittedAt: input.nowIso,
      payload: input.payload,
    });

    await this.deps.audit.write({
      transactionId: request.transactionId,
      tableName: request.tableName,
      recordId: recordIdFor(input.payload),
      operationType: request.operationType,
      oldValues: {},
      newValues: input.payload,
      makerUserId: request.makerUserId,
      checkerUserId: request.checkerUserId,
      status: "pending",
      rejectionComment: null,
      ipAddress: null,
      activityDescription: `maker submitted ${request.operationType} for ${request.tableName}`,
      createdAt: input.nowIso,
    });

    return {
      ok: true,
      transactionId: request.transactionId,
      status: "pending_approval",
      requiresApproval: permission.requiresApproval,
    };
  }

  /** Checker approves a pending request → conditional transition + apply. */
  async approve(
    request: SmsAuthorizationRequest,
    checkerUserId: string,
  ): Promise<SmsApproveResult> {
    const nowIso = this.deps.nowIso();
    const decision = decideAuthorization({
      request,
      decision: { approved: true, note: null },
      checkerUserId,
      nowIso,
    });

    if (!decision.ok) {
      return {
        ok: false,
        applied: false,
        status: decision.status,
        reason: decision.reason,
      };
    }

    const transition = await this.deps.transition({
      transactionId: request.transactionId,
      to: "approved",
      checkerUserId,
      decidedAt: nowIso,
      note: null,
    });

    if (!transition.transitioned) {
      return {
        ok: false,
        applied: false,
        status: request.status,
        reason: "already_decided",
      };
    }

    await this.deps.audit.write({
      transactionId: request.transactionId,
      tableName: request.tableName,
      recordId: request.transactionId,
      operationType: request.operationType,
      oldValues: {},
      newValues: {},
      makerUserId: request.makerUserId,
      checkerUserId,
      status: "approved",
      rejectionComment: null,
      ipAddress: null,
      activityDescription: `checker approved ${request.operationType} for ${request.tableName}`,
      createdAt: nowIso,
    });

    return { ok: true, applied: transition.applied, status: "approved" };
  }

  /** Checker rejects a pending request → do NOT apply the mutation. */
  async reject(
    request: SmsAuthorizationRequest,
    note: string,
    checkerUserId: string,
  ): Promise<SmsRejectResult> {
    const nowIso = this.deps.nowIso();
    const decision = decideAuthorization({
      request,
      decision: { approved: false, note },
      checkerUserId,
      nowIso,
    });

    if (!decision.ok) {
      return { ok: false, status: decision.status, reason: decision.reason };
    }

    const transition = await this.deps.transition({
      transactionId: request.transactionId,
      to: "rejected",
      checkerUserId,
      decidedAt: nowIso,
      note,
    });

    if (!transition.transitioned) {
      return { ok: false, status: request.status, reason: "already_decided" };
    }

    await this.deps.audit.write({
      transactionId: request.transactionId,
      tableName: request.tableName,
      recordId: request.transactionId,
      operationType: request.operationType,
      oldValues: {},
      newValues: {},
      makerUserId: request.makerUserId,
      checkerUserId,
      status: "rejected",
      rejectionComment: note,
      ipAddress: null,
      activityDescription: `checker rejected ${request.operationType} for ${request.tableName}`,
      createdAt: nowIso,
    });

    return { ok: true, status: "rejected" };
  }
}
