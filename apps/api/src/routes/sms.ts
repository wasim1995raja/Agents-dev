import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  createDatabase,
  resolveDatabaseUrl,
  type DatabaseHandle,
  smsAuditLogs,
  smsAuthorizationDetails,
  smsAuthorizationRequests,
  smsNotifications,
  smsResponsibilities,
  smsRoleResponsibilities,
  smsRoles,
  smsUserResponsibilities,
  smsAcademicYears,
  smsAdmissions,
  smsAttendance,
  smsCourses,
  smsDepartments,
  smsFees,
  smsStudents,
  smsUsers,
} from "@autodev/db";
import {
  SmsAuthorizationService,
  hashPassword,
  isCheckerGranted,
  isMakerGranted,
} from "@autodev/sms";
import type {
  SmsActor,
  SmsAuthorizationRequest,
  SmsResponsibility,
} from "@autodev/sms";
import { badRequest, conflict, forbidden, notFound, parse } from "../http.js";
import type { RouteContext } from "../types.js";

const DEFAULT_MAKER = "sms-local-maker";
const DEFAULT_CHECKER = "sms-local-checker";

const createSmsUserSchema = z.object({
  username: z.string().trim().min(3).max(40),
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(128),
  roleId: z.string().uuid(),
  departmentId: z.string().uuid().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const createSmsRoleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
});

const createSmsResponsibilitySchema = z.object({
  responsibilityName: z.string().trim().min(2).max(160),
  moduleName: z.string().trim().min(2).max(120),
  tableName: z.string().trim().min(2).max(120),
  canAdd: z.boolean(),
  canEdit: z.boolean(),
  canView: z.boolean(),
  canDelete: z.boolean(),
  makerCheckerRequired: z.boolean(),
  makerUserId: z.string().trim().max(120).optional(),
  checkerUserId: z.string().trim().max(120).optional(),
  checkerRoleId: z.string().uuid().optional(),
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo: z.string().datetime().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const submitAuthorizationSchema = z.object({
  tableName: z.string().trim().min(2).max(120),
  operationType: z.enum(["add", "edit", "delete"]),
  payload: z.record(z.string(), z.unknown()),
});

const rejectAuthorizationSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});

const roleResponsibilitySchema = z.object({
  roleId: z.string().uuid(),
  responsibilityId: z.string().uuid(),
});

const userResponsibilitySchema = z.object({
  userId: z.string().uuid(),
  responsibilityId: z.string().uuid(),
});

/** Tables whose approved mutations can be applied by this API today. */
const APPLY_SUPPORTED_TABLES = new Set([
  "sms_students",
  "sms_departments",
  "sms_courses",
  "sms_academic_years",
  "sms_admissions",
  "sms_fees",
  "sms_attendance",
]);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const studentFields = {
  admissionNumber: z.string().trim().min(1).max(80),
  firstName: z.string().trim().min(1).max(120),
  middleName: z.string().trim().max(120).nullable().optional(),
  lastName: z.string().trim().min(1).max(120),
  dateOfBirth: isoDate.nullable().optional(),
  gender: z.enum(["male", "female", "other", "prefer_not_to_say"]).nullable().optional(),
  email: z.string().trim().email().max(320).nullable().optional(),
  mobileNumber: z.string().trim().max(40).nullable().optional(),
  address: z.string().trim().max(2000).nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  courseId: z.string().uuid().nullable().optional(),
  academicYearId: z.string().uuid().nullable().optional(),
  admissionDate: isoDate.nullable().optional(),
  guardianName: z.string().trim().max(160).nullable().optional(),
  guardianContact: z.string().trim().max(40).nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
};

const addStudentSchema = z.object(studentFields);
const editStudentSchema = z.object({ id: z.string().uuid(), ...studentFields }).partial({
  admissionNumber: true,
  firstName: true,
  lastName: true,
});
const deleteStudentSchema = z.object({ id: z.string().uuid() });

const departmentFields = {
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
};
const addDepartmentSchema = z.object(departmentFields);
const editDepartmentSchema = z.object({ id: z.string().uuid(), ...departmentFields }).partial({
  code: true,
  name: true,
});

const courseFields = {
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
};
const addCourseSchema = z.object(courseFields);
const editCourseSchema = z.object({ id: z.string().uuid(), ...courseFields }).partial({
  code: true,
  name: true,
});

const academicYearFields = {
  name: z.string().trim().min(1).max(40),
  startDate: isoDate,
  endDate: isoDate,
};
const academicYearOrder = <T extends { startDate?: string; endDate?: string }>(value: T): T => {
  if (value.startDate && value.endDate && value.startDate > value.endDate) {
    throw badRequest("Academic year start date must be on or before its end date");
  }
  return value;
};
const addAcademicYearSchema = z
  .object(academicYearFields)
  .transform((value) => academicYearOrder(value));
const editAcademicYearSchema = z
  .object({ id: z.string().uuid(), ...academicYearFields })
  .partial({ name: true, startDate: true, endDate: true })
  .transform((value) => academicYearOrder(value));

const admissionFields = {
  studentId: z.string().uuid(),
  admissionNumber: z.string().trim().min(1).max(80),
  academicYearId: z.string().uuid().nullable().optional(),
  courseId: z.string().uuid().nullable().optional(),
  admissionDate: isoDate.nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
};
const addAdmissionSchema = z.object(admissionFields);
const editAdmissionSchema = z.object({ id: z.string().uuid(), ...admissionFields }).partial({
  studentId: true,
  admissionNumber: true,
});

const feeFields = {
  studentId: z.string().uuid(),
  academicYearId: z.string().uuid().nullable().optional(),
  feeStructureCode: z.string().trim().min(1).max(80),
  amount: z.number().int().nonnegative(),
  currency: z.string().trim().min(1).max(8).optional(),
  dueDate: isoDate.nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
};
const addFeeSchema = z.object(feeFields);
const editFeeSchema = z.object({ id: z.string().uuid(), ...feeFields }).partial({
  studentId: true,
  feeStructureCode: true,
  amount: true,
});

const attendanceFields = {
  studentId: z.string().uuid(),
  academicYearId: z.string().uuid().nullable().optional(),
  courseId: z.string().uuid().nullable().optional(),
  date: isoDate,
  status: z.string().trim().min(1).max(40),
  recordedBy: z.string().trim().max(120).nullable().optional(),
};
const addAttendanceSchema = z.object(attendanceFields);
const editAttendanceSchema = z.object({ id: z.string().uuid(), ...attendanceFields }).partial({
  studentId: true,
  date: true,
  status: true,
});
const deleteByIdSchema = z.object({ id: z.string().uuid() });

/** Per-table proposal schemas so invalid proposals are rejected before queuing. */
const proposalSchemas: Record<
  string,
  Record<"add" | "edit" | "delete", z.ZodType> | undefined
> = {
  sms_students: {
    add: addStudentSchema,
    edit: editStudentSchema,
    delete: deleteStudentSchema,
  },
  sms_departments: {
    add: addDepartmentSchema,
    edit: editDepartmentSchema,
    delete: deleteByIdSchema,
  },
  sms_courses: {
    add: addCourseSchema,
    edit: editCourseSchema,
    delete: deleteByIdSchema,
  },
  sms_academic_years: {
    add: addAcademicYearSchema,
    edit: editAcademicYearSchema,
    delete: deleteByIdSchema,
  },
  sms_admissions: {
    add: addAdmissionSchema,
    edit: editAdmissionSchema,
    delete: deleteByIdSchema,
  },
  sms_fees: {
    add: addFeeSchema,
    edit: editFeeSchema,
    delete: deleteByIdSchema,
  },
  sms_attendance: {
    add: addAttendanceSchema,
    edit: editAttendanceSchema,
    delete: deleteByIdSchema,
  },
};

function validateProposal(
  tableName: string,
  operationType: "add" | "edit" | "delete",
  payload: Record<string, unknown>,
  strict: boolean,
): Record<string, unknown> {
  const schema = proposalSchemas[tableName]?.[operationType];
  if (!schema) {
    if (strict) throw badRequest(`Approved mutations are not implemented for ${tableName} yet`);
    return payload;
  }
  return parse(schema, payload, `${tableName} ${operationType} payload`) as Record<string, unknown>;
}



/**
 * Columns safe to return from `sms_users`. `password_hash` is deliberately
 * excluded so a credential can never leak through the API.
 */
const safeSmsUserColumns = {
  id: smsUsers.id,
  username: smsUsers.username,
  fullName: smsUsers.fullName,
  email: smsUsers.email,
  roleId: smsUsers.roleId,
  departmentId: smsUsers.departmentId,
  status: smsUsers.status,
  createdAt: smsUsers.createdAt,
  updatedAt: smsUsers.updatedAt,
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Looks up an authorization request by its row id or its transaction id.
 * Guards the uuid column from non-uuid input so a transaction id cannot
 * trigger a Postgres cast error.
 */
async function findAuthorization(db: DatabaseHandle, id: string) {
  const column = uuidPattern.test(id)
    ? smsAuthorizationRequests.id
    : smsAuthorizationRequests.transactionId;
  const [found] = await db.db
    .select()
    .from(smsAuthorizationRequests)
    .where(eq(column, id))
    .limit(1);
  return found;
}

/** Maps a persisted sms_authorization_requests row to the domain shape (ISO strings). */
function toAuthorizationRequest(row: {
  transactionId: string;
  tableName: string;
  operationType: "add" | "edit" | "delete";
  status: string;
  makerUserId: string;
  checkerUserId: string | null;
  submittedAt: Date;
  decidedAt: Date | null;
  decisionNote: string | null;
}): SmsAuthorizationRequest {
  return {
    transactionId: row.transactionId,
    tableName: row.tableName,
    operationType: row.operationType,
    status: row.status as SmsAuthorizationRequest["status"],
    makerUserId: row.makerUserId,
    checkerUserId: row.checkerUserId,
    submittedAt: row.submittedAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    decisionNote: row.decisionNote,
  };
}

function headerValue(request: FastifyRequest, name: string): string | null {
  const raw = request.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * MVP identity: a real deployment replaces these headers with the JWT subject.
 * Keeping them explicit makes self-approval tests and local demos possible.
 */
function userIdFrom(request: FastifyRequest): string {
  return headerValue(request, "x-sms-user-id") ?? DEFAULT_MAKER;
}

function checkerId(request: FastifyRequest): string {
  return headerValue(request, "x-sms-checker-id") ?? DEFAULT_CHECKER;
}

function recordIdFor(payload: Record<string, unknown>): string {
  const candidate =
    payload.id ??
    payload.studentId ??
    payload.admissionNumber ??
    payload.code ??
    payload.feeStructureCode ??
    payload.name;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : "unknown";
}

function toDomainResponsibility(row: typeof smsResponsibilities.$inferSelect): SmsResponsibility {
  return {
    id: row.id,
    responsibilityName: row.responsibilityName,
    moduleName: row.moduleName,
    tableName: row.tableName,
    flags: {
      canAdd: row.canAdd,
      canEdit: row.canEdit,
      canView: row.canView,
      canDelete: row.canDelete,
    },
    makerCheckerRequired: row.makerCheckerRequired,
    makerUserId: row.makerUserId,
    checkerUserId: row.checkerUserId,
    checkerRoleId: row.checkerRoleId,
    effectiveFrom: row.effectiveFrom ? row.effectiveFrom.toISOString() : null,
    effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString() : null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type Tx = Parameters<Parameters<ReturnType<typeof createDatabase>["db"]["transaction"]>[0]>[0];

function assertEditChanges(changes: object): void {
  if (Object.keys(changes).length === 0) {
    throw badRequest("An edit proposal must change at least one field");
  }
}

/** Applies an approved mutation. Unknown/unsupported tables are rejected earlier. */
async function applyMutation(
  tx: Tx,
  tableName: string,
  operationType: "add" | "edit" | "delete",
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (tableName === "sms_students") {
    if (operationType === "add") {
      const input = addStudentSchema.parse(payload);
      const [row] = await tx.insert(smsStudents).values(input).returning({ id: smsStudents.id });
      return Boolean(row);
    }

    if (operationType === "edit") {
      const { id, ...changes } = editStudentSchema.parse(payload);
      assertEditChanges(changes);
      const [row] = await tx
        .update(smsStudents)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(smsStudents.id, id))
        .returning({ id: smsStudents.id });
      if (!row) throw notFound("SMS student");
      return true;
    }

    const { id } = deleteStudentSchema.parse(payload);
    const [row] = await tx
      .update(smsStudents)
      .set({ status: "inactive", updatedAt: new Date() })
      .where(eq(smsStudents.id, id))
      .returning({ id: smsStudents.id });
    if (!row) throw notFound("SMS student");
    return true;
  }

  if (tableName === "sms_departments") {
    if (operationType === "add") {
      const input = addDepartmentSchema.parse(payload);
      const [row] = await tx
        .insert(smsDepartments)
        .values(input)
        .returning({ id: smsDepartments.id });
      return Boolean(row);
    }
    if (operationType === "edit") {
      const { id, ...changes } = editDepartmentSchema.parse(payload);
      assertEditChanges(changes);
      const [row] = await tx
        .update(smsDepartments)
        .set(changes)
        .where(eq(smsDepartments.id, id))
        .returning({ id: smsDepartments.id });
      if (!row) throw notFound("SMS department");
      return true;
    }
    const { id } = deleteByIdSchema.parse(payload);
    const [row] = await tx
      .delete(smsDepartments)
      .where(eq(smsDepartments.id, id))
      .returning({ id: smsDepartments.id });
    if (!row) throw notFound("SMS department");
    return true;
  }

  if (tableName === "sms_courses") {
    if (operationType === "add") {
      const input = addCourseSchema.parse(payload);
      const [row] = await tx.insert(smsCourses).values(input).returning({ id: smsCourses.id });
      return Boolean(row);
    }
    if (operationType === "edit") {
      const { id, ...changes } = editCourseSchema.parse(payload);
      assertEditChanges(changes);
      const [row] = await tx
        .update(smsCourses)
        .set(changes)
        .where(eq(smsCourses.id, id))
        .returning({ id: smsCourses.id });
      if (!row) throw notFound("SMS course");
      return true;
    }
    const { id } = deleteByIdSchema.parse(payload);
    const [row] = await tx
      .delete(smsCourses)
      .where(eq(smsCourses.id, id))
      .returning({ id: smsCourses.id });
    if (!row) throw notFound("SMS course");
    return true;
  }

  if (tableName === "sms_academic_years") {
    if (operationType === "add") {
      const input = addAcademicYearSchema.parse(payload);
      const [row] = await tx
        .insert(smsAcademicYears)
        .values(input)
        .returning({ id: smsAcademicYears.id });
      return Boolean(row);
    }
    if (operationType === "edit") {
      const { id, ...changes } = editAcademicYearSchema.parse(payload);
      assertEditChanges(changes);
      const [row] = await tx
        .update(smsAcademicYears)
        .set(changes)
        .where(eq(smsAcademicYears.id, id))
        .returning({ id: smsAcademicYears.id });
      if (!row) throw notFound("SMS academic year");
      return true;
    }
    const { id } = deleteByIdSchema.parse(payload);
    const [row] = await tx
      .delete(smsAcademicYears)
      .where(eq(smsAcademicYears.id, id))
      .returning({ id: smsAcademicYears.id });
    if (!row) throw notFound("SMS academic year");
    return true;
  }

  if (tableName === "sms_admissions") {
    if (operationType === "add") {
      const input = addAdmissionSchema.parse(payload);
      const [row] = await tx.insert(smsAdmissions).values(input).returning({ id: smsAdmissions.id });
      return Boolean(row);
    }
    if (operationType === "edit") {
      const { id, ...changes } = editAdmissionSchema.parse(payload);
      assertEditChanges(changes);
      const [row] = await tx
        .update(smsAdmissions)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(smsAdmissions.id, id))
        .returning({ id: smsAdmissions.id });
      if (!row) throw notFound("SMS admission");
      return true;
    }
    const { id } = deleteByIdSchema.parse(payload);
    const [row] = await tx
      .update(smsAdmissions)
      .set({ status: "inactive", updatedAt: new Date() })
      .where(eq(smsAdmissions.id, id))
      .returning({ id: smsAdmissions.id });
    if (!row) throw notFound("SMS admission");
    return true;
  }

  if (tableName === "sms_fees") {
    if (operationType === "add") {
      const input = addFeeSchema.parse(payload);
      const [row] = await tx.insert(smsFees).values(input).returning({ id: smsFees.id });
      return Boolean(row);
    }
    if (operationType === "edit") {
      const { id, ...changes } = editFeeSchema.parse(payload);
      assertEditChanges(changes);
      const [row] = await tx
        .update(smsFees)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(smsFees.id, id))
        .returning({ id: smsFees.id });
      if (!row) throw notFound("SMS fee");
      return true;
    }
    const { id } = deleteByIdSchema.parse(payload);
    const [row] = await tx
      .update(smsFees)
      .set({ status: "inactive", updatedAt: new Date() })
      .where(eq(smsFees.id, id))
      .returning({ id: smsFees.id });
    if (!row) throw notFound("SMS fee");
    return true;
  }

  if (tableName === "sms_attendance") {
    if (operationType === "add") {
      const input = addAttendanceSchema.parse(payload);
      const [row] = await tx
        .insert(smsAttendance)
        .values(input)
        .returning({ id: smsAttendance.id });
      return Boolean(row);
    }
    if (operationType === "edit") {
      const { id, ...changes } = editAttendanceSchema.parse(payload);
      assertEditChanges(changes);
      const [row] = await tx
        .update(smsAttendance)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(smsAttendance.id, id))
        .returning({ id: smsAttendance.id });
      if (!row) throw notFound("SMS attendance");
      return true;
    }
    const { id } = deleteByIdSchema.parse(payload);
    const [row] = await tx
      .update(smsAttendance)
      .set({ status: "inactive", updatedAt: new Date() })
      .where(eq(smsAttendance.id, id))
      .returning({ id: smsAttendance.id });
    if (!row) throw notFound("SMS attendance");
    return true;
  }

  throw badRequest(`Approved mutations are not implemented for ${tableName} yet`);
}


export function registerSmsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  // SMS API: database-backed handlers for user/role/responsibility management,
  // maker–checker authorization and audit. Full auth wiring lands with the auth phase.
  const { deps } = ctx;
  void deps;

  const db = createDatabase(resolveDatabaseUrl());

  app.addHook("onClose", async () => {
    await db.close();
  });

  /** Resolves the actor's assigned roles (MVP headers may carry a username or id). */
  async function actorFor(identifier: string): Promise<SmsActor> {
    const column = uuidPattern.test(identifier) ? smsUsers.id : smsUsers.username;
    const [row] = await db.db
      .select({ roleId: smsUsers.roleId })
      .from(smsUsers)
      .where(eq(column, identifier))
      .limit(1);
    return { userId: identifier, roleIds: row ? [row.roleId] : [] };
  }

  /**
   * Responsibility ids granted to the actor through user or role assignments.
   * These overlay the legacy maker/checker fields on the responsibility itself.
   */
  async function grantedResponsibilityIds(actor: SmsActor): Promise<Set<string>> {
    const column = uuidPattern.test(actor.userId) ? smsUsers.id : smsUsers.username;
    const [user] = await db.db
      .select({ id: smsUsers.id, roleId: smsUsers.roleId })
      .from(smsUsers)
      .where(eq(column, actor.userId))
      .limit(1);

    const roleIds = user ? [user.roleId] : actor.roleIds;
    const granted = new Set<string>();

    if (user) {
      const rows = await db.db
        .select({ responsibilityId: smsUserResponsibilities.responsibilityId })
        .from(smsUserResponsibilities)
        .where(eq(smsUserResponsibilities.userId, user.id));
      for (const row of rows) granted.add(row.responsibilityId);
    }

    if (roleIds.length > 0) {
      const rows = await db.db
        .select({ responsibilityId: smsRoleResponsibilities.responsibilityId })
        .from(smsRoleResponsibilities)
        .where(inArray(smsRoleResponsibilities.roleId, roleIds));
      for (const row of rows) granted.add(row.responsibilityId);
    }

    return granted;
  }

  const serviceFor = (actor: SmsActor, responsibilities: SmsResponsibility[]) =>
    new SmsAuthorizationService({
      actor,
      responsibilities,
      nowIso: () => new Date().toISOString(),
      audit: {
        write: async (entry) => {
          await db.db.insert(smsAuditLogs).values({
            transactionId: entry.transactionId,
            tableName: entry.tableName,
            recordId: entry.recordId,
            operationType: entry.operationType,
            oldValues: entry.oldValues,
            newValues: entry.newValues,
            makerUserId: entry.makerUserId,
            checkerUserId: entry.checkerUserId,
            status: entry.status as "pending" | "approved" | "rejected" | "cancelled",
            rejectionComment: entry.rejectionComment,
            ipAddress: entry.ipAddress,
            activityDescription: entry.activityDescription,
            createdAt: new Date(entry.createdAt),
          });
        },
      },
      savePending: async (input) => {
        const [row] = await db.db
          .insert(smsAuthorizationRequests)
          .values({
            transactionId: input.transactionId,
            tableName: input.tableName,
            operationType: input.operationType,
            makerUserId: input.makerUserId,
            checkerUserId: input.checkerUserId,
            submittedAt: new Date(input.submittedAt),
            status: "pending_approval",
          })
          .returning();
        if (!row) throw notFound("SMS authorization request");
        await db.db.insert(smsAuthorizationDetails).values({
          requestId: row.id,
          recordId: recordIdFor(input.payload),
          oldValues: {},
          newValues: input.payload,
        });
        return toAuthorizationRequest(row);
      },
      transition: async (input) => {
        return db.db.transaction(async (tx) => {
          // Conditional update: a row that was already decided never transitions
          // twice, which makes duplicate approvals impossible under races.
          const [updated] = await tx
            .update(smsAuthorizationRequests)
            .set({
              status: input.to,
              checkerUserId: input.checkerUserId,
              decidedAt: new Date(input.decidedAt),
              decisionNote: input.note,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(smsAuthorizationRequests.transactionId, input.transactionId),
                eq(smsAuthorizationRequests.status, "pending_approval"),
              ),
            )
            .returning();
          if (!updated) return { transitioned: false, applied: false };

          if (input.to !== "approved") return { transitioned: true, applied: false };

          const [detail] = await tx
            .select()
            .from(smsAuthorizationDetails)
            .where(eq(smsAuthorizationDetails.requestId, updated.id))
            .limit(1);
          if (!detail) throw conflict("Authorization request has no proposed payload");

          const applied = await applyMutation(
            tx,
            updated.tableName,
            updated.operationType,
            detail.newValues,
          );
          return { transitioned: true, applied };
        });
      },
      applyDirect: async (input) => {
        return db.db.transaction(async (tx) => {
          const applied = await applyMutation(
            tx,
            input.tableName,
            input.operationType,
            input.payload,
          );
          return applied;
        });
      },
    });

  async function notify(userId: string, title: string, body: string): Promise<void> {
    await db.db.insert(smsNotifications).values({
      userId,
      channel: "in_app",
      title,
      body,
    });
  }

  app.post("/api/sms/users", async (request, reply) => {
    const input = parse(createSmsUserSchema, request.body, "sms user body");
    const [row] = await db.db
      .insert(smsUsers)
      .values({
        username: input.username,
        fullName: input.fullName,
        email: input.email,
        passwordHash: hashPassword(input.password),
        roleId: input.roleId,
        departmentId: input.departmentId ?? null,
        status: input.status ?? "active",
      })
      .returning(safeSmsUserColumns);
    if (!row) throw notFound("SMS user");
    return reply.status(201).send({ user: row });
  });

  app.get("/api/sms/users", async () => {
    const users = await db.db
      .select(safeSmsUserColumns)
      .from(smsUsers)
      .orderBy(desc(smsUsers.createdAt));
    return { users };
  });

  app.post("/api/sms/roles", async (request, reply) => {
    const input = parse(createSmsRoleSchema, request.body, "sms role body");
    const [row] = await db.db
      .insert(smsRoles)
      .values({ name: input.name, description: input.description ?? null })
      .returning();
    if (!row) throw notFound("SMS role");
    return reply.status(201).send({ role: row });
  });

  app.get("/api/sms/roles", async () => {
    const roles = await db.db.select().from(smsRoles);
    return { roles };
  });

  app.post("/api/sms/responsibilities", async (request, reply) => {
    const input = parse(createSmsResponsibilitySchema, request.body, "sms responsibility body");
    const [row] = await db.db
      .insert(smsResponsibilities)
      .values({
        responsibilityName: input.responsibilityName,
        moduleName: input.moduleName,
        tableName: input.tableName,
        canAdd: input.canAdd,
        canEdit: input.canEdit,
        canView: input.canView,
        canDelete: input.canDelete,
        makerCheckerRequired: input.makerCheckerRequired,
        makerUserId: input.makerUserId ?? null,
        checkerUserId: input.checkerUserId ?? null,
        checkerRoleId: input.checkerRoleId ?? null,
        effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : null,
        effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
        status: input.status ?? "active",
      })
      .returning();
    if (!row) throw notFound("SMS responsibility");
    return reply.status(201).send({ responsibility: row });
  });

  app.get("/api/sms/responsibilities", async () => {
    const rows = await db.db.select().from(smsResponsibilities);
    return { responsibilities: rows };
  });

  app.get("/api/sms/assignments", async () => {
    const [roleResponsibilities, userResponsibilities] = await Promise.all([
      db.db.select().from(smsRoleResponsibilities),
      db.db.select().from(smsUserResponsibilities),
    ]);
    return { roleResponsibilities, userResponsibilities };
  });

  app.post("/api/sms/role-responsibilities", async (request, reply) => {
    const input = parse(roleResponsibilitySchema, request.body, "role responsibility body");
    const [row] = await db.db
      .insert(smsRoleResponsibilities)
      .values(input)
      .onConflictDoNothing()
      .returning();
    return reply.status(row ? 201 : 200).send({ assignment: row ?? null });
  });

  app.delete("/api/sms/role-responsibilities/:id", async (request) => {
    const { id } = parse(
      z.object({ id: z.string().uuid() }),
      request.params,
      "role responsibility id",
    );
    const [row] = await db.db
      .delete(smsRoleResponsibilities)
      .where(eq(smsRoleResponsibilities.id, id))
      .returning({ id: smsRoleResponsibilities.id });
    if (!row) throw notFound("Role responsibility assignment");
    return { deleted: true };
  });

  app.post("/api/sms/user-responsibilities", async (request, reply) => {
    const input = parse(userResponsibilitySchema, request.body, "user responsibility body");
    const [row] = await db.db
      .insert(smsUserResponsibilities)
      .values(input)
      .onConflictDoNothing()
      .returning();
    return reply.status(row ? 201 : 200).send({ assignment: row ?? null });
  });

  app.delete("/api/sms/user-responsibilities/:id", async (request) => {
    const { id } = parse(
      z.object({ id: z.string().uuid() }),
      request.params,
      "user responsibility id",
    );
    const [row] = await db.db
      .delete(smsUserResponsibilities)
      .where(eq(smsUserResponsibilities.id, id))
      .returning({ id: smsUserResponsibilities.id });
    if (!row) throw notFound("User responsibility assignment");
    return { deleted: true };
  });

  app.post("/api/sms/authorization/submit", async (request, reply) => {
    const input = parse(submitAuthorizationSchema, request.body, "sms authorization submit body");

    const responsibilityRows = await db.db
      .select()
      .from(smsResponsibilities)
      .where(eq(smsResponsibilities.tableName, input.tableName));
    const responsibilities = responsibilityRows.map(toDomainResponsibility);

    // A configured table gets its proposal validated before it is queued, so a
    // checker never approves something that cannot be applied. Tables with no
    // responsibility fall through to the normal deny-by-default 403.
    const payload = validateProposal(
      input.tableName,
      input.operationType,
      input.payload,
      responsibilities.length > 0,
    );

    const actor = await actorFor(userIdFrom(request));
    const assignments = await grantedResponsibilityIds(actor);
    const granted = responsibilities.filter(
      (item) => assignments.has(item.id) || isMakerGranted(item, actor),
    );
    const service = serviceFor(actor, granted);
    const result = await service.submit({
      tableName: input.tableName,
      operationType: input.operationType,
      payload,
      nowIso: new Date().toISOString(),
    });

    if (!result.ok) {
      throw forbidden(
        `Permission denied for ${input.operationType} on ${input.tableName} (${result.reason ?? "denied"})`,
      );
    }

    const [saved] = await db.db
      .select()
      .from(smsAuthorizationRequests)
      .where(eq(smsAuthorizationRequests.transactionId, result.transactionId ?? ""))
      .limit(1);

    if (saved?.checkerUserId) {
      await notify(
        saved.checkerUserId,
        "Authorization pending",
        `${saved.makerUserId} submitted ${saved.operationType} on ${saved.tableName} (${saved.transactionId}).`,
      );
    }

    return reply.status(201).send({
      id: saved?.id,
      transactionId: result.transactionId,
      status: result.status,
      requiresApproval: result.requiresApproval,
    });
  });

  app.get("/api/sms/authorizations", async () => {
    const rows = await db.db
      .select()
      .from(smsAuthorizationRequests)
      .orderBy(desc(smsAuthorizationRequests.submittedAt));
    const withDetails = await Promise.all(
      rows.map(async (row) => {
        const [detail] = await db.db
          .select()
          .from(smsAuthorizationDetails)
          .where(eq(smsAuthorizationDetails.requestId, row.id))
          .limit(1);
        return { ...row, detail: detail ?? null };
      }),
    );
    return { authorizations: withDetails };
  });

  app.get("/api/sms/authorizations/:id", async (request) => {
    const { id } = request.params as { id: string };
    const found = await findAuthorization(db, id);
    if (!found) throw notFound("SMS authorization request");

    const [detail] = await db.db
      .select()
      .from(smsAuthorizationDetails)
      .where(eq(smsAuthorizationDetails.requestId, found.id))
      .limit(1);

    return {
      authorization: found,
      detail: detail ?? null,
    };
  });

  async function decide(
    request: FastifyRequest,
    decision: "approved" | "rejected",
    note: string | undefined,
  ): Promise<{ status: string; applied: boolean }> {
    const id = (request.params as { id: string }).id;
    const found = await findAuthorization(db, id);
    if (!found) throw notFound("SMS authorization request");

    if (decision === "approved" && !APPLY_SUPPORTED_TABLES.has(found.tableName)) {
      throw badRequest(`Approved mutations are not implemented for ${found.tableName} yet`);
    }

    const authRequest = toAuthorizationRequest(found);
    const checker = checkerId(request);

    // Separation of duties is checked before authorization so a maker always
    // gets the precise "cannot decide your own work" message.
    if (checker === found.makerUserId) {
      throw forbidden(
        `A maker cannot ${decision === "approved" ? "approve" : "reject"} their own transaction`,
      );
    }

    const checkerActor = await actorFor(checker);
    const checkerAssignments = await grantedResponsibilityIds(checkerActor);
    const checkerResponsibilities = (
      await db.db
        .select()
        .from(smsResponsibilities)
        .where(eq(smsResponsibilities.tableName, found.tableName))
    )
      .map(toDomainResponsibility)
      .filter(
        (item) => checkerAssignments.has(item.id) || isCheckerGranted(item, checkerActor),
      );

    if (checkerResponsibilities.length === 0) {
      throw forbidden(`Not an authorized checker for ${found.tableName}`);
    }

    const service = serviceFor(checkerActor, checkerResponsibilities);

    if (decision === "approved") {
      const result = await service.approve(authRequest, checker);
      if (!result.ok) {
        if (result.reason === "self_approval") {
          throw forbidden("A maker cannot approve their own transaction");
        }
        if (result.reason === "already_decided" || result.reason === "already_approved") {
          throw conflict("Authorization request was already decided");
        }
        throw badRequest(
          `Authorization cannot be approved in its current state (${result.reason ?? result.status ?? "unknown"})`,
        );
      }
      await notify(
        authRequest.makerUserId,
        "Authorization approved",
        `Your ${authRequest.operationType} on ${authRequest.tableName} was approved.`,
      );
      return { status: result.status ?? "approved", applied: result.applied };
    }

    const result = await service.reject(
      authRequest,
      note ?? "rejected",
      checker,
    );
    if (!result.ok) {
      if (result.reason === "self_approval") {
        throw forbidden("A maker cannot reject their own transaction");
      }
      if (result.reason === "already_decided" || result.reason === "already_approved") {
        throw conflict("Authorization request was already decided");
      }
      throw badRequest(
        `Authorization cannot be rejected in its current state (${result.reason ?? result.status ?? "unknown"})`,
      );
    }
    await notify(
      authRequest.makerUserId,
      "Authorization rejected",
      `Your ${authRequest.operationType} on ${authRequest.tableName} was rejected${note ? `: ${note}` : "."}`,
    );
    return { status: result.status ?? "rejected", applied: false };
  }

  app.post("/api/sms/authorizations/:id/approve", async (request, reply) => {
    const result = await decide(request, "approved", undefined);
    return reply.status(200).send(result);
  });

  app.post("/api/sms/authorizations/:id/reject", async (request, reply) => {
    const body = parse(rejectAuthorizationSchema, request.body, "sms authorization reject body");
    const result = await decide(request, "rejected", body.note);
    return reply.status(200).send(result);
  });

  app.get("/api/sms/notifications", async (request) => {
    const query = parse(
      z.object({ userId: z.string().trim().min(1).max(120).optional() }),
      request.query ?? {},
      "sms notification query",
    );
    const userId = query.userId ?? userIdFrom(request);
    const rows = await db.db
      .select()
      .from(smsNotifications)
      .where(eq(smsNotifications.userId, userId))
      .orderBy(desc(smsNotifications.createdAt));
    return { notifications: rows, userId };
  });

  app.post("/api/sms/notifications/:id/read", async (request) => {
    const { id } = parse(
      z.object({ id: z.string().uuid() }),
      request.params,
      "sms notification id",
    );
    const [row] = await db.db
      .update(smsNotifications)
      .set({ readAt: new Date() })
      .where(eq(smsNotifications.id, id))
      .returning({ id: smsNotifications.id, readAt: smsNotifications.readAt });
    if (!row) throw notFound("SMS notification");
    return { notification: row };
  });

  app.get("/api/sms/audit", async () => {
    const rows = await db.db
      .select()
      .from(smsAuditLogs)
      .orderBy(desc(smsAuditLogs.createdAt));
    return { audit: rows };
  });
}
