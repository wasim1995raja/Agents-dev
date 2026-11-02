import { describe, expect, it } from "vitest";

import { SmsAuthorizationService } from "../src/authorization.js";
import type { SmsAuthorizationPort } from "../src/authorization.js";
import type {
  SmsAuditEntry,
  SmsAuthorizationRequest,
  SmsResponsibility,
} from "../src/domain.js";

function responsibility(overrides: Partial<SmsResponsibility> = {}): SmsResponsibility {
  return {
    id: "resp-students",
    responsibilityName: "Student management",
    moduleName: "student",
    tableName: "sms_students",
    flags: { canAdd: true, canEdit: true, canView: true, canDelete: true },
    makerCheckerRequired: true,
    makerUserId: null,
    checkerUserId: "user-checker",
    checkerRoleId: null,
    effectiveFrom: null,
    effectiveTo: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

interface Harness {
  service: SmsAuthorizationService;
  audit: SmsAuditEntry[];
  requests: SmsAuthorizationRequest[];
  transitions: Array<{ transactionId: string; to: string; checkerUserId: string }>;
}

function harness(options: { makerUserId?: string; transitioned?: boolean; applied?: boolean } = {}): Harness {
  const audit: SmsAuditEntry[] = [];
  const requests: SmsAuthorizationRequest[] = [];
  const transitions: Array<{ transactionId: string; to: string; checkerUserId: string }> = [];
  let sequence = 0;

  const port: SmsAuthorizationPort = {
    savePending: async (input) => {
      sequence += 1;
      const request: SmsAuthorizationRequest = {
        transactionId: input.transactionId,
        tableName: input.tableName,
        operationType: input.operationType,
        status: "pending_approval",
        makerUserId: input.makerUserId,
        checkerUserId: input.checkerUserId,
        submittedAt: input.submittedAt,
        decidedAt: null,
        decisionNote: null,
      };
      requests.push(request);
      return request;
    },
    transition: async (input) => {
      transitions.push({
        transactionId: input.transactionId,
        to: input.to,
        checkerUserId: input.checkerUserId,
      });
      return {
        transitioned: options.transitioned ?? true,
        applied: options.applied ?? true,
      };
    },
  };

  const service = new SmsAuthorizationService({
    actor: {
      userId: options.makerUserId ?? "user-maker",
      roleIds: ["role-admission-maker"],
    },
    responsibilities: [responsibility()],
    audit: { write: async (entry) => void audit.push(entry) },
    nowIso: () => "2026-11-01T10:00:00.000Z",
    savePending: port.savePending,
    transition: port.transition,
  });

  return { service, audit, requests, transitions };
}

describe("SmsAuthorizationService", () => {
  it("lets a maker submit a maker-checker-required operation", async () => {
    const { service, requests, audit } = harness();

    const result = await service.submit({
      tableName: "sms_students",
      operationType: "add",
      payload: { admissionNumber: "ADM-001", firstName: "Ada" },
      nowIso: "2026-11-01T10:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("pending_approval");
    expect(result.requiresApproval).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.checkerUserId).toBe("user-checker");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.status).toBe("pending");
  });

  it("denies a submission without the table permission", async () => {
    const { service } = harness();
    // Restrict the responsibility to view-only, so Add is denied.
    const restricted = new SmsAuthorizationService({
      actor: { userId: "user-maker", roleIds: [] },
      responsibilities: [
        responsibility({
          flags: { canAdd: false, canEdit: false, canView: true, canDelete: false },
        }),
      ],
      audit: { write: async () => undefined },
      nowIso: () => "2026-11-01T10:00:00.000Z",
      savePending: async () => {
        throw new Error("should not persist");
      },
      transition: async () => ({ transitioned: false, applied: false }),
    });

    const result = await restricted.submit({
      tableName: "sms_students",
      operationType: "add",
      payload: {},
      nowIso: "2026-11-01T10:00:00.000Z",
    });

    expect(service).toBeDefined();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_flag");
  });

  it("approves and applies a pending request as a different checker", async () => {
    const { service, transitions, audit } = harness();
    const request: SmsAuthorizationRequest = {
      transactionId: "TX-1",
      tableName: "sms_students",
      operationType: "add",
      status: "pending_approval",
      makerUserId: "user-maker",
      checkerUserId: "user-checker",
      submittedAt: "2026-11-01T09:00:00.000Z",
      decidedAt: null,
      decisionNote: null,
    };

    const result = await service.approve(request, "user-checker");

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.status).toBe("approved");
    expect(transitions).toEqual([
      { transactionId: "TX-1", to: "approved", checkerUserId: "user-checker" },
    ]);
    expect(audit[0]?.status).toBe("approved");
    expect(audit[0]?.checkerUserId).toBe("user-checker");
  });

  it("refuses self-approval and never transitions the row", async () => {
    const { service, transitions } = harness();
    const request: SmsAuthorizationRequest = {
      transactionId: "TX-1",
      tableName: "sms_students",
      operationType: "add",
      status: "pending_approval",
      makerUserId: "user-maker",
      checkerUserId: null,
      submittedAt: "2026-11-01T09:00:00.000Z",
      decidedAt: null,
      decisionNote: null,
    };

    const result = await service.approve(request, "user-maker");

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("self_approval");
    expect(transitions).toHaveLength(0);
  });

  it("reports a race when the row is no longer pending", async () => {
    const { service } = harness({ transitioned: false });
    const request: SmsAuthorizationRequest = {
      transactionId: "TX-1",
      tableName: "sms_students",
      operationType: "add",
      status: "pending_approval",
      makerUserId: "user-maker",
      checkerUserId: "user-checker",
      submittedAt: "2026-11-01T09:00:00.000Z",
      decidedAt: null,
      decisionNote: null,
    };

    const result = await service.approve(request, "user-checker");

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("already_decided");
  });

  it("rejects a pending request without applying it", async () => {
    const { service, transitions, audit } = harness();
    const request: SmsAuthorizationRequest = {
      transactionId: "TX-1",
      tableName: "sms_students",
      operationType: "delete",
      status: "pending_approval",
      makerUserId: "user-maker",
      checkerUserId: "user-checker",
      submittedAt: "2026-11-01T09:00:00.000Z",
      decidedAt: null,
      decisionNote: null,
    };

    const result = await service.reject(request, "invalid record", "user-checker");

    expect(result.ok).toBe(true);
    expect(result.status).toBe("rejected");
    expect(transitions[0]?.to).toBe("rejected");
    expect(audit[0]?.status).toBe("rejected");
    expect(audit[0]?.rejectionComment).toBe("invalid record");
  });

  it("applies directly when maker-checker is not required", async () => {
    const audit: SmsAuditEntry[] = [];
    const direct: Array<{ operationType: string; payload: Record<string, unknown> }> = [];
    let saved = 0;

    const service = new SmsAuthorizationService({
      actor: { userId: "user-maker", roleIds: [] },
      responsibilities: [responsibility({ makerCheckerRequired: false })],
      audit: { write: async (entry) => void audit.push(entry) },
      nowIso: () => "2026-11-01T10:00:00.000Z",
      savePending: async () => {
        saved += 1;
        throw new Error("direct execution must not queue a request");
      },
      transition: async () => ({ transitioned: false, applied: false }),
      applyDirect: async (input) => {
        direct.push({ operationType: input.operationType, payload: input.payload });
        return true;
      },
    });

    const result = await service.submit({
      tableName: "sms_students",
      operationType: "add",
      payload: { admissionNumber: "ADM-002", firstName: "Grace" },
      nowIso: "2026-11-01T10:00:00.000Z",
    });

    expect(result).toMatchObject({ ok: true, status: "applied", requiresApproval: false });
    expect(saved).toBe(0);
    expect(direct).toHaveLength(1);
    expect(audit[0]?.status).toBe("approved");
    expect(audit[0]?.activityDescription).toContain("directly");
  });
});
