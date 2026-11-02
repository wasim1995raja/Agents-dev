import { describe, expect, it } from "vitest";

import { decideAuthorization } from "../src/maker-checker.js";
import type { SmsAuthorizationRequest } from "../src/domain.js";

function pendingRequest(overrides: Partial<SmsAuthorizationRequest>): SmsAuthorizationRequest {
  return {
    transactionId: "TX-1",
    tableName: "sms_students",
    operationType: "add",
    status: "pending_approval",
    makerUserId: "user-maker",
    checkerUserId: "user-checker",
    submittedAt: "2026-11-01T09:00:00.000Z",
    decidedAt: null,
    decisionNote: null,
    ...overrides,
  };
}

describe("decideAuthorization", () => {
  it("approves a pending request", () => {
    const result = decideAuthorization({
      request: pendingRequest({}),
      decision: { approved: true, note: null },
      checkerUserId: "user-checker",
      nowIso: "2026-11-01T10:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("approved");
    expect(result.duplicate).toBe(false);
  });

  it("rejects a pending request and does not apply the mutation", () => {
    const result = decideAuthorization({
      request: pendingRequest({}),
      decision: { approved: false, note: "insufficient data" },
      checkerUserId: "user-checker",
      nowIso: "2026-11-01T10:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("rejected");
    expect(result.duplicate).toBe(false);
  });

  it("refuses to decide twice (duplicate protection)", () => {
    const once = decideAuthorization({
      request: pendingRequest({}),
      decision: { approved: true, note: null },
      checkerUserId: "user-checker",
      nowIso: "2026-11-01T10:00:00.000Z",
    });
    const twice = decideAuthorization({
      request: { ...pendingRequest({}), status: once.status },
      decision: { approved: true, note: null },
      checkerUserId: "user-checker",
      nowIso: "2026-11-01T10:01:00.000Z",
    });

    expect(twice.ok).toBe(false);
    expect(twice.duplicate).toBe(true);
  });

  it("refuses decisions on requests that are not pending", () => {
    const result = decideAuthorization({
      request: pendingRequest({ status: "approved" }),
      decision: { approved: true, note: null },
      checkerUserId: "user-checker",
      nowIso: "2026-11-01T10:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    expect(result.duplicate).toBe(true);
    expect(result.reason).toBe("already_approved");
  });

  it("prevents the maker from approving their own transaction", () => {
    const result = decideAuthorization({
      request: pendingRequest({ makerUserId: "user-maker" }),
      decision: { approved: true, note: null },
      checkerUserId: "user-maker",
      nowIso: "2026-11-01T10:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    expect(result.duplicate).toBe(false);
    expect(result.reason).toBe("self_approval");
  });

  it("prevents the maker from rejecting their own transaction", () => {
    const result = decideAuthorization({
      request: pendingRequest({ makerUserId: "user-maker" }),
      decision: { approved: false, note: "nope" },
      checkerUserId: "user-maker",
      nowIso: "2026-11-01T10:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("self_approval");
  });
});
