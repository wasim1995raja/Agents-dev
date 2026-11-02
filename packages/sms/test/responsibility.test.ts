import { describe, expect, it } from "vitest";

import { isCheckerGranted, isMakerGranted, resolvePermission, resolveSubmitPermission } from "../src/responsibility.js";
import type { SmsResponsibility } from "../src/domain.js";

function responsibility(overrides: Partial<SmsResponsibility>): SmsResponsibility {
  return {
    id: "resp-1",
    responsibilityName: "Student management",
    moduleName: "student",
    tableName: "sms_students",
    flags: { canAdd: false, canEdit: false, canView: false, canDelete: false },
    makerCheckerRequired: false,
    makerUserId: null,
    checkerUserId: null,
    checkerRoleId: null,
    effectiveFrom: null,
    effectiveTo: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const ACTOR = { userId: "user-maker", roleIds: ["role-admission-maker"] };

describe("resolvePermission", () => {
  it("denies by default when no responsibility applies", () => {
    const decision = resolvePermission({
      actor: ACTOR,
      tableName: "sms_students",
      operation: "add",
      responsibilities: [],
      nowIso: "2026-11-01T10:00:00.000Z",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("deny_by_default");
  });

  it("allows add only when the flag is set and responsibility is effective", () => {
    const decision = resolvePermission({
      actor: ACTOR,
      tableName: "sms_students",
      operation: "add",
      responsibilities: [
        responsibility({ flags: { canAdd: true, canEdit: true, canView: true, canDelete: true } }),
      ],
      nowIso: "2026-11-01T10:00:00.000Z",
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("ok");
  });

  it("requires the maker-checker flag to be respected as a gate decision", () => {
    const decision = resolvePermission({
      actor: ACTOR,
      tableName: "sms_students",
      operation: "edit",
      responsibilities: [
        responsibility({ makerCheckerRequired: true, flags: { canAdd: true, canEdit: true, canView: true, canDelete: true } }),
      ],
      nowIso: "2026-11-01T10:00:00.000Z",
    });

    // A maker-checker-required operation does not bypass the gate.
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("checker_required");
    expect(decision.requiresApproval).toBe(true);
  });

  it("ignores responsibilities outside their effective window", () => {
    const decision = resolvePermission({
      actor: ACTOR,
      tableName: "sms_students",
      operation: "view",
      responsibilities: [
        responsibility({
          flags: { canAdd: true, canEdit: true, canView: true, canDelete: true },
          effectiveFrom: "2026-12-01T00:00:00.000Z",
        }),
      ],
      nowIso: "2026-11-01T10:00:00.000Z",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("not_effective");
  });
});

describe("resolveSubmitPermission", () => {
  it("allows a maker to submit when the operation requires approval", () => {
    const decision = resolveSubmitPermission({
      actor: ACTOR,
      tableName: "sms_students",
      operation: "add",
      responsibilities: [
        responsibility({
          makerCheckerRequired: true,
          flags: { canAdd: true, canEdit: false, canView: false, canDelete: false },
        }),
      ],
      nowIso: "2026-11-01T10:00:00.000Z",
    });

    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.reason).toBe("ok");
  });

  it("allows direct operations to submit as well", () => {
    const decision = resolveSubmitPermission({
      actor: ACTOR,
      tableName: "sms_students",
      operation: "add",
      responsibilities: [
        responsibility({
          flags: { canAdd: true, canEdit: false, canView: false, canDelete: false },
        }),
      ],
      nowIso: "2026-11-01T10:00:00.000Z",
    });

    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(false);
  });

  it("still denies a missing operation flag", () => {
    const decision = resolveSubmitPermission({
      actor: ACTOR,
      tableName: "sms_students",
      operation: "delete",
      responsibilities: [
        responsibility({
          makerCheckerRequired: true,
          flags: { canAdd: true, canEdit: false, canView: false, canDelete: false },
        }),
      ],
      nowIso: "2026-11-01T10:00:00.000Z",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("missing_flag");
  });
});

describe("assignment grants", () => {
  it("restricts submission to the named maker", () => {
    const assigned = responsibility({ makerUserId: "user-maker" });
    expect(isMakerGranted(assigned, ACTOR)).toBe(true);
    expect(isMakerGranted(assigned, { userId: "other", roleIds: [] })).toBe(false);
    expect(isMakerGranted(responsibility({}), { userId: "other", roleIds: [] })).toBe(true);
  });

  it("restricts checking to the named checker or checker role", () => {
    const byUser = responsibility({ checkerUserId: "user-checker" });
    expect(isCheckerGranted(byUser, { userId: "user-checker", roleIds: [] })).toBe(true);
    expect(isCheckerGranted(byUser, { userId: "other", roleIds: [] })).toBe(false);

    const byRole = responsibility({ checkerRoleId: "role-checker" });
    expect(isCheckerGranted(byRole, { userId: "any", roleIds: ["role-checker"] })).toBe(true);
    expect(isCheckerGranted(byRole, { userId: "any", roleIds: ["role-other"] })).toBe(false);

    expect(isCheckerGranted(responsibility({}), { userId: "any", roleIds: [] })).toBe(true);
  });
});
