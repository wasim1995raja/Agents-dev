import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDatabase,
  resolveDatabaseUrl,
  smsAuditLogs,
  smsAuthorizationRequests,
  smsCourses,
  smsDepartments,
  smsNotifications,
  smsResponsibilities,
  smsRoles,
  smsStudents,
  smsUsers,
} from "@autodev/db";

import { buildServer } from "../src/app.js";
import { createFakeDeps } from "./fakes.js";

const WORKSPACE_ROOT = `/tmp/opencode/sms-api-${process.pid}-${Date.now()}`;
const suffix = randomUUID().slice(0, 8);
const RESPONSIBILITY_NAME = `Students MC ${suffix}`;
const MAKER = `maker-${suffix}`;
const CHECKER = `checker-${suffix}`;

let app: FastifyInstance;
let responsibilityId: string | null = null;
let directResponsibilityId: string | null = null;
let mappedRoleId: string | null = null;
let mappedUserId: string | null = null;
const extraResponsibilityIds: string[] = [];
let dbAvailable = false;
const transactionIds: string[] = [];
const admissionNumbers: string[] = [];

const handle = createDatabase(resolveDatabaseUrl(), { max: 2 });

// Evaluated at collection time: `describe.skipIf` cannot see a beforeAll result.
try {
  await handle.pool.query("select 1 from sms_students limit 1");
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

beforeAll(async () => {
  const fake = createFakeDeps({ workspaceRoot: WORKSPACE_ROOT });
  app = await buildServer({ deps: fake.deps, logger: false });

  if (!dbAvailable) return;

  const response = await app.inject({
    method: "POST",
    url: "/api/sms/responsibilities",
    payload: {
      responsibilityName: RESPONSIBILITY_NAME,
      moduleName: "student",
      tableName: "sms_students",
      canAdd: true,
      canEdit: true,
      canView: true,
      canDelete: true,
      makerCheckerRequired: true,
      makerUserId: MAKER,
      checkerUserId: CHECKER,
    },
  });
  expect(response.statusCode).toBe(201);
  responsibilityId = response.json().responsibility.id as string;

  for (const tableName of ["sms_departments"]) {
    const created = await app.inject({
      method: "POST",
      url: "/api/sms/responsibilities",
      payload: {
        responsibilityName: `${tableName} MC ${suffix}`,
        moduleName: "master-data",
        tableName,
        canAdd: true,
        canEdit: true,
        canView: true,
        canDelete: true,
        makerCheckerRequired: true,
        makerUserId: MAKER,
        checkerUserId: CHECKER,
      },
    });
    expect(created.statusCode).toBe(201);
    extraResponsibilityIds.push(created.json().responsibility.id as string);
  }

  const direct = await app.inject({
    method: "POST",
    url: "/api/sms/responsibilities",
    payload: {
      responsibilityName: `sms_courses direct ${suffix}`,
      moduleName: "master-data",
      tableName: "sms_courses",
      canAdd: true,
      canEdit: true,
      canView: true,
      canDelete: true,
      makerCheckerRequired: false,
      makerUserId: MAKER,
    },
  });
  expect(direct.statusCode).toBe(201);
  directResponsibilityId = direct.json().responsibility.id as string;
  extraResponsibilityIds.push(directResponsibilityId);
});

afterAll(async () => {
  if (app) await app.close();
  if (dbAvailable) {
    if (transactionIds.length > 0) {
      await handle.db
        .delete(smsAuditLogs)
        .where(inArray(smsAuditLogs.transactionId, transactionIds));
      await handle.db
        .delete(smsAuthorizationRequests)
        .where(inArray(smsAuthorizationRequests.transactionId, transactionIds));
    }
    if (admissionNumbers.length > 0) {
      await handle.db.delete(smsStudents).where(inArray(smsStudents.admissionNumber, admissionNumbers));
    }
    await handle.db.delete(smsDepartments).where(eq(smsDepartments.code, `DPT-${suffix}`));
    await handle.db.delete(smsCourses).where(eq(smsCourses.code, `CRS-${suffix}`));
    await handle.db.delete(smsCourses).where(eq(smsCourses.code, `CRS-MAP-${suffix}`));
    if (responsibilityId) {
      await handle.db.delete(smsResponsibilities).where(eq(smsResponsibilities.id, responsibilityId));
    }
    if (extraResponsibilityIds.length > 0) {
      await handle.db
        .delete(smsResponsibilities)
        .where(inArray(smsResponsibilities.id, extraResponsibilityIds));
    }
    if (mappedUserId) {
      await handle.db.delete(smsUsers).where(eq(smsUsers.id, mappedUserId));
    }
    if (mappedRoleId) {
      await handle.db.delete(smsRoles).where(eq(smsRoles.id, mappedRoleId));
    }
    await handle.db.delete(smsNotifications).where(inArray(smsNotifications.userId, [MAKER, CHECKER]));
  }
  await handle.close();
});

function submit(admissionNumber: string, maker = MAKER) {
  return app.inject({
    method: "POST",
    url: "/api/sms/authorization/submit",
    headers: { "x-sms-user-id": maker },
    payload: {
      tableName: "sms_students",
      operationType: "add",
      payload: {
        admissionNumber,
        firstName: "Ada",
        lastName: "Lovelace",
        email: `${admissionNumber.toLowerCase()}@example.test`,
      },
    },
  });
}

function submitProposal(
  tableName: string,
  operationType: "add" | "edit" | "delete",
  payload: Record<string, unknown>,
  maker = MAKER,
) {
  return app.inject({
    method: "POST",
    url: "/api/sms/authorization/submit",
    headers: { "x-sms-user-id": maker },
    payload: { tableName, operationType, payload },
  });
}

function approveProposal(transactionId: string) {
  return app.inject({
    method: "POST",
    url: `/api/sms/authorizations/${transactionId}/approve`,
    headers: { "x-sms-checker-id": CHECKER },
  });
}

async function requestIdFor(transactionId: string): Promise<string> {
  const [row] = await handle.db
    .select({ id: smsAuthorizationRequests.id })
    .from(smsAuthorizationRequests)
    .where(eq(smsAuthorizationRequests.transactionId, transactionId))
    .limit(1);
  if (!row) throw new Error(`missing authorization request ${transactionId}`);
  return row.id;
}

describe.skipIf(!dbAvailable)("SMS maker–checker API", () => {
  it("submits, approves and applies a student creation exactly once", async () => {
    const admissionNumber = `ADM-${suffix}-A`;
    admissionNumbers.push(admissionNumber);

    const submitted = await submit(admissionNumber);
    expect(submitted.statusCode).toBe(201);
    const { id, transactionId, status, requiresApproval } = submitted.json();
    expect(status).toBe("pending_approval");
    expect(requiresApproval).toBe(true);
    transactionIds.push(transactionId);

    const requestId = await requestIdFor(transactionId);
    expect(id).toBe(requestId);

    // The route accepts either the row id or the human-readable transaction id.
    const approved = await app.inject({
      method: "POST",
      url: `/api/sms/authorizations/${transactionId}/approve`,
      headers: { "x-sms-checker-id": CHECKER },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toEqual({ status: "approved", applied: true });

    const detail = await app.inject({ method: "GET", url: `/api/sms/authorizations/${transactionId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().authorization.status).toBe("approved");

    const [student] = await handle.db
      .select()
      .from(smsStudents)
      .where(eq(smsStudents.admissionNumber, admissionNumber))
      .limit(1);
    expect(student?.firstName).toBe("Ada");

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/sms/authorizations/${requestId}/approve`,
      headers: { "x-sms-checker-id": CHECKER },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("conflict");
  });

  it("lists authorizations together with their proposed old/new values", async () => {
    const admissionNumber = `ADM-${suffix}-D`;
    admissionNumbers.push(admissionNumber);

    const submitted = await submit(admissionNumber);
    expect(submitted.statusCode).toBe(201);
    const { transactionId } = submitted.json();
    transactionIds.push(transactionId);

    const list = await app.inject({ method: "GET", url: "/api/sms/authorizations" });
    expect(list.statusCode).toBe(200);
    const found = list.json().authorizations.find(
      (item: { transactionId: string }) => item.transactionId === transactionId,
    );
    expect(found).toBeDefined();
    expect(found.detail).toBeDefined();
    expect(found.detail.oldValues).toEqual({});
    expect(found.detail.newValues).toMatchObject({
      admissionNumber,
      firstName: "Ada",
      lastName: "Lovelace",
    });

    const decision = await app.inject({
      method: "POST",
      url: `/api/sms/authorizations/${transactionId}/reject`,
      headers: { "x-sms-checker-id": CHECKER },
      payload: { note: "cleanup after list assertion" },
    });
    expect(decision.statusCode).toBe(200);
  });

  it("refuses self-approval by the maker", async () => {
    const admissionNumber = `ADM-${suffix}-B`;
    admissionNumbers.push(admissionNumber);

    const submitted = await submit(admissionNumber);
    expect(submitted.statusCode).toBe(201);
    const { transactionId } = submitted.json();
    transactionIds.push(transactionId);
    const requestId = await requestIdFor(transactionId);

    const selfApproved = await app.inject({
      method: "POST",
      url: `/api/sms/authorizations/${requestId}/approve`,
      headers: { "x-sms-checker-id": MAKER },
    });
    expect(selfApproved.statusCode).toBe(403);
    expect(selfApproved.json().error.message).toContain("cannot approve their own");

    const [stillPending] = await handle.db
      .select({ status: smsAuthorizationRequests.status })
      .from(smsAuthorizationRequests)
      .where(eq(smsAuthorizationRequests.transactionId, transactionId))
      .limit(1);
    expect(stillPending?.status).toBe("pending_approval");
  });

  it("rejects a request and never applies the mutation", async () => {
    const admissionNumber = `ADM-${suffix}-C`;
    admissionNumbers.push(admissionNumber);

    const submitted = await submit(admissionNumber);
    expect(submitted.statusCode).toBe(201);
    const { transactionId } = submitted.json();
    transactionIds.push(transactionId);
    const requestId = await requestIdFor(transactionId);

    const rejected = await app.inject({
      method: "POST",
      url: `/api/sms/authorizations/${requestId}/reject`,
      headers: { "x-sms-checker-id": CHECKER },
      payload: { note: "duplicate admission number" },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().status).toBe("rejected");

    const students = await handle.db
      .select()
      .from(smsStudents)
      .where(eq(smsStudents.admissionNumber, admissionNumber));
    expect(students).toHaveLength(0);

    const audit = await handle.db
      .select()
      .from(smsAuditLogs)
      .where(
        and(
          eq(smsAuditLogs.transactionId, transactionId),
          eq(smsAuditLogs.status, "rejected"),
        ),
      );
    expect(audit[0]?.rejectionComment).toBe("duplicate admission number");
  });

  it("applies a department add, edit and delete through approvals", async () => {
    const code = `DPT-${suffix}`;

    const added = await submitProposal("sms_departments", "add", {
      code,
      name: "Smoke Department",
    });
    expect(added.statusCode).toBe(201);
    const addTx = added.json().transactionId as string;
    transactionIds.push(addTx);
    expect((await approveProposal(addTx)).json()).toEqual({ status: "approved", applied: true });

    const [created] = await handle.db
      .select()
      .from(smsDepartments)
      .where(eq(smsDepartments.code, code));
    expect(created?.name).toBe("Smoke Department");

    const edited = await submitProposal("sms_departments", "edit", {
      id: created?.id,
      name: "Renamed Department",
    });
    expect(edited.statusCode).toBe(201);
    const editTx = edited.json().transactionId as string;
    transactionIds.push(editTx);
    expect((await approveProposal(editTx)).statusCode).toBe(200);

    const [renamed] = await handle.db
      .select()
      .from(smsDepartments)
      .where(eq(smsDepartments.id, created?.id ?? ""));
    expect(renamed?.name).toBe("Renamed Department");

    const deleted = await submitProposal("sms_departments", "delete", { id: created?.id });
    expect(deleted.statusCode).toBe(201);
    const deleteTx = deleted.json().transactionId as string;
    transactionIds.push(deleteTx);
    expect((await approveProposal(deleteTx)).statusCode).toBe(200);

    const remaining = await handle.db
      .select()
      .from(smsDepartments)
      .where(eq(smsDepartments.id, created?.id ?? ""));
    expect(remaining).toHaveLength(0);
  });

  it("rejects an invalid proposal before it reaches the queue", async () => {
    const before = await handle.db
      .select({ id: smsAuthorizationRequests.id })
      .from(smsAuthorizationRequests)
      .where(eq(smsAuthorizationRequests.makerUserId, MAKER));

    const response = await submitProposal("sms_departments", "add", { code: `ONLY-${suffix}` });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("bad_request");

    const after = await handle.db
      .select({ id: smsAuthorizationRequests.id })
      .from(smsAuthorizationRequests)
      .where(eq(smsAuthorizationRequests.makerUserId, MAKER));
    expect(after).toHaveLength(before.length);
  });

  it("applies immediately when the responsibility does not require a checker", async () => {
    const code = `CRS-${suffix}`;
    const response = await submitProposal("sms_courses", "add", { code, name: "Direct Course" });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ status: "applied", requiresApproval: false });

    const [course] = await handle.db.select().from(smsCourses).where(eq(smsCourses.code, code));
    expect(course?.name).toBe("Direct Course");
  });

  it("grants a responsibility through a role assignment", async () => {
    const role = await app.inject({
      method: "POST",
      url: "/api/sms/roles",
      payload: { name: `mapper-role-${suffix}` },
    });
    expect(role.statusCode).toBe(201);
    mappedRoleId = role.json().role.id as string;

    const username = `mapper-${suffix}`;
    const user = await app.inject({
      method: "POST",
      url: "/api/sms/users",
      payload: {
        username,
        fullName: "Role Mapper",
        email: `${username}@example.test`,
        password: "password123",
        roleId: mappedRoleId,
      },
    });
    expect(user.statusCode).toBe(201);
    mappedUserId = user.json().user.id as string;

    const assignment = await app.inject({
      method: "POST",
      url: "/api/sms/role-responsibilities",
      payload: { roleId: mappedRoleId, responsibilityId: directResponsibilityId },
    });
    expect(assignment.statusCode).toBe(201);

    // The course responsibility names a different maker, so only the role
    // assignment can grant this user access.
    const code = `CRS-MAP-${suffix}`;
    const response = await submitProposal(
      "sms_courses",
      "add",
      { code, name: "Mapped Course" },
      username,
    );
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ status: "applied", requiresApproval: false });

    const [course] = await handle.db.select().from(smsCourses).where(eq(smsCourses.code, code));
    expect(course?.name).toBe("Mapped Course");
  });

  it("denies submission without a responsibility", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/sms/authorization/submit",
      headers: { "x-sms-user-id": `nobody-${suffix}` },
      payload: {
        tableName: "sms_courses",
        operationType: "add",
        payload: { code: "C-1", name: "Course" },
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("forbidden");
  });
});
