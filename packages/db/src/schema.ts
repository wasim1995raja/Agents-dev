import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Enum values are duplicated here because drizzle-kit loads this file through a
 * CJS require that cannot resolve cross-package `.js` specifiers. A unit test in
 * `packages/db/test/schema-enums.test.ts` asserts they stay in sync with
 * `@autodev/shared`.
 */
export const PROJECT_STATUS_VALUES = [
  "draft",
  "queued",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
] as const;

export const PHASE_VALUES = [
  "intake",
  "brd",
  "architecture",
  "ux",
  "implementation",
  "testing",
  "review",
  "deployment",
  "approval",
] as const;

export const AGENT_ROLE_VALUES = [
  "manager",
  "business_analyst",
  "solution_architect",
  "ui_ux",
  "frontend_developer",
  "backend_developer",
  "qa_automation",
  "code_review",
  "deployment",
] as const;

export const TASK_STATUS_VALUES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "blocked",
] as const;

export const ENGINE_VALUES = ["codex", "openai-agents", "scaffold"] as const;
export const APPROVAL_TYPE_VALUES = [
  "dependency_install",
  "destructive_command",
  "production_deployment",
] as const;
export const APPROVAL_STATUS_VALUES = ["pending", "approved", "rejected", "expired"] as const;
export const EVENT_LEVEL_VALUES = ["debug", "info", "warn", "error"] as const;

export const projectStatusEnum = pgEnum("project_status", PROJECT_STATUS_VALUES);
export const phaseEnum = pgEnum("workflow_phase", PHASE_VALUES);
export const agentRoleEnum = pgEnum("agent_role", AGENT_ROLE_VALUES);
export const taskStatusEnum = pgEnum("task_status", TASK_STATUS_VALUES);
export const engineEnum = pgEnum("engine_name", ENGINE_VALUES);
export const approvalTypeEnum = pgEnum("approval_type", APPROVAL_TYPE_VALUES);
export const approvalStatusEnum = pgEnum("approval_status", APPROVAL_STATUS_VALUES);
export const eventLevelEnum = pgEnum("event_level", EVENT_LEVEL_VALUES);
export const testStatusEnum = pgEnum("test_status", ["passed", "failed", "error"]);
export const deploymentStatusEnum = pgEnum("deployment_status", [
  "prepared",
  "building",
  "built",
  "failed",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description").notNull(),
    requirements: text("requirements").notNull(),
    techStack: jsonb("tech_stack").$type<string[]>().notNull().default([]),
    status: projectStatusEnum("status").notNull().default("draft"),
    phase: phaseEnum("phase"),
    engine: engineEnum("engine").notNull().default("scaffold"),
    progress: integer("progress").notNull().default(0),
    workspacePath: text("workspace_path").notNull(),
    containerId: text("container_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("projects_status_idx").on(table.status),
    index("projects_created_at_idx").on(table.createdAt),
  ],
);

export const requirements = pgTable("requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  brd: text("brd"),
  userStories: jsonb("user_stories").$type<unknown[]>().notNull().default([]),
  acceptanceCriteria: jsonb("acceptance_criteria").$type<unknown[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentTasks = pgTable(
  "agent_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    phase: phaseEnum("phase").notNull(),
    role: agentRoleEnum("role").notNull(),
    title: text("title").notNull(),
    status: taskStatusEnum("status").notNull().default("pending"),
    orderIndex: integer("order_index").notNull(),
    attempt: integer("attempt").notNull().default(1),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb("output").$type<Record<string, unknown>>(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("agent_tasks_project_order_idx").on(table.projectId, table.orderIndex),
    index("agent_tasks_project_status_idx").on(table.projectId, table.status),
  ],
);

export const agentExecutions = pgTable(
  "agent_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => agentTasks.id, { onDelete: "cascade" }),
    agentName: varchar("agent_name", { length: 80 }).notNull(),
    engine: engineEnum("engine").notNull(),
    model: varchar("model", { length: 120 }),
    status: taskStatusEnum("status").notNull().default("running"),
    prompt: text("prompt"),
    response: text("response"),
    toolCalls: jsonb("tool_calls").$type<unknown[]>().notNull().default([]),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    durationMs: integer("duration_ms"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("agent_executions_project_idx").on(table.projectId, table.startedAt)],
);

export const generatedFiles = pgTable(
  "generated_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    language: varchar("language", { length: 40 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("generated_files_project_path_idx").on(table.projectId, table.path)],
);

export const testResults = pgTable("test_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").references(() => agentTasks.id, { onDelete: "set null" }),
  suite: varchar("suite", { length: 120 }).notNull(),
  status: testStatusEnum("status").notNull(),
  total: integer("total").notNull().default(0),
  passed: integer("passed").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  report: jsonb("report").$type<Record<string, unknown>>(),
  artifacts: jsonb("artifacts").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: approvalTypeEnum("type").notNull(),
    status: approvalStatusEnum("status").notNull().default("pending"),
    title: text("title").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: varchar("decided_by", { length: 120 }),
    note: text("note"),
  },
  (table) => [index("approval_project_status_idx").on(table.projectId, table.status)],
);

export const deploymentHistory = pgTable("deployment_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  version: varchar("version", { length: 40 }).notNull(),
  status: deploymentStatusEnum("status").notNull().default("prepared"),
  image: varchar("image", { length: 255 }),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 60 }).notNull(),
    level: eventLevelEnum("level").notNull().default("info"),
    message: text("message").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("activity_events_project_created_idx").on(table.projectId, table.createdAt)],
);

// ---------------------------------------------------------------------------
// Student Management System (SMS) — business schema (see docs/sms/*)
// ---------------------------------------------------------------------------

export const smsUserStatuses = ["active", "inactive"] as const;
export const smsGenderValues = ["male", "female", "other", "prefer_not_to_say"] as const;
export const smsOperationTypes = ["add", "edit", "delete"] as const;
export const smsAuthorizationStatuses = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "cancelled",
  "resubmitted",
] as const;
export const smsRequestStatus = smsAuthorizationStatuses;
export const smsAuditEntryStatus = ["pending", "approved", "rejected", "cancelled"] as const;

export const smsUserStatusEnum = pgEnum("sms_user_status", smsUserStatuses);
export const smsGenderEnum = pgEnum("sms_gender", smsGenderValues);
export const smsOperationTypeEnum = pgEnum("sms_operation_type", smsOperationTypes);
export const smsAuthorizationStatusEnum = pgEnum("sms_authorization_status", smsAuthorizationStatuses);
export const smsAuditStatusEnum = pgEnum("sms_audit_status", smsAuditEntryStatus);

export const smsDepartments = pgTable(
  "sms_departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 40 }).notNull().unique(),
    name: varchar("name", { length: 160 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sms_departments_code_idx").on(table.code)],
);

export const smsCourses = pgTable(
  "sms_courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 40 }).notNull().unique(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sms_courses_code_idx").on(table.code)],
);

export const smsAcademicYears = pgTable(
  "sms_academic_years",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 40 }).notNull().unique(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sms_academic_years_name_idx").on(table.name)],
);

export const smsRoles = pgTable(
  "sms_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 80 }).notNull().unique(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sms_roles_name_idx").on(table.name)],
);

export const smsUsers = pgTable(
  "sms_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: varchar("username", { length: 80 }).notNull().unique(),
    fullName: varchar("full_name", { length: 160 }).notNull(),
    email: varchar("email", { length: 320 }).notNull().unique(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => smsRoles.id, { onDelete: "restrict" }),
    departmentId: uuid("department_id").references(() => smsDepartments.id, { onDelete: "set null" }),
    status: smsUserStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sms_users_role_idx").on(table.roleId),
    index("sms_users_status_idx").on(table.status),
  ],
);

export const smsUserRoles = pgTable(
  "sms_user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => smsUsers.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => smsRoles.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("sms_user_roles_user_role_uidx").on(table.userId, table.roleId),
    index("sms_user_roles_user_idx").on(table.userId),
  ],
);

export const smsStudents = pgTable(
  "sms_students",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    admissionNumber: varchar("admission_number", { length: 80 }).notNull().unique(),
    firstName: varchar("first_name", { length: 120 }).notNull(),
    middleName: varchar("middle_name", { length: 120 }),
    lastName: varchar("last_name", { length: 120 }).notNull(),
    dateOfBirth: date("date_of_birth"),
    gender: smsGenderEnum("gender"),
    email: varchar("email", { length: 320 }),
    mobileNumber: varchar("mobile_number", { length: 40 }),
    address: text("address"),
    departmentId: uuid("department_id").references(() => smsDepartments.id, { onDelete: "set null" }),
    courseId: uuid("course_id").references(() => smsCourses.id, { onDelete: "set null" }),
    academicYearId: uuid("academic_year_id").references(() => smsAcademicYears.id, { onDelete: "set null" }),
    admissionDate: date("admission_date"),
    guardianName: varchar("guardian_name", { length: 160 }),
    guardianContact: varchar("guardian_contact", { length: 40 }),
    status: smsUserStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sms_students_admission_number_idx").on(table.admissionNumber),
    index("sms_students_status_idx").on(table.status),
  ],
);

export const smsAdmissions = pgTable(
  "sms_admissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id").notNull().references(() => smsStudents.id, { onDelete: "cascade" }),
    admissionNumber: varchar("admission_number", { length: 80 }).notNull(),
    academicYearId: uuid("academic_year_id").references(() => smsAcademicYears.id, { onDelete: "set null" }),
    courseId: uuid("course_id").references(() => smsCourses.id, { onDelete: "set null" }),
    admissionDate: date("admission_date"),
    status: smsUserStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sms_admissions_student_idx").on(table.studentId)],
);

export const smsFees = pgTable(
  "sms_fees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id").notNull().references(() => smsStudents.id, { onDelete: "cascade" }),
    academicYearId: uuid("academic_year_id").references(() => smsAcademicYears.id, { onDelete: "set null" }),
    feeStructureCode: varchar("fee_structure_code", { length: 80 }).notNull(),
    amount: integer("amount").notNull(),
    currency: varchar("currency", { length: 8 }).notNull().default("USD"),
    dueDate: date("due_date"),
    status: smsUserStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sms_fees_student_idx").on(table.studentId)],
);

export const smsAttendance = pgTable(
  "sms_attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id").notNull().references(() => smsStudents.id, { onDelete: "cascade" }),
    academicYearId: uuid("academic_year_id").references(() => smsAcademicYears.id, { onDelete: "set null" }),
    courseId: uuid("course_id").references(() => smsCourses.id, { onDelete: "set null" }),
    date: date("date").notNull(),
    status: varchar("status", { length: 40 }).notNull(),
    recordedBy: varchar("recorded_by", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sms_attendance_student_date_idx").on(table.studentId, table.date)],
);

export const smsResponsibilities = pgTable(
  "sms_responsibilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    responsibilityName: varchar("responsibility_name", { length: 160 }).notNull(),
    moduleName: varchar("module_name", { length: 120 }).notNull(),
    tableName: varchar("table_name", { length: 120 }).notNull(),
    canAdd: boolean("can_add").notNull().default(false),
    canEdit: boolean("can_edit").notNull().default(false),
    canView: boolean("can_view").notNull().default(false),
    canDelete: boolean("can_delete").notNull().default(false),
    makerCheckerRequired: boolean("maker_checker_required").notNull().default(false),
    makerUserId: varchar("maker_user_id", { length: 120 }),
    checkerUserId: varchar("checker_user_id", { length: 120 }),
    checkerRoleId: uuid("checker_role_id").references(() => smsRoles.id, { onDelete: "set null" }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    status: smsUserStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sms_responsibilities_table_idx").on(table.tableName),
    index("sms_responsibilities_status_idx").on(table.status),
  ],
);

export const smsRoleResponsibilities = pgTable(
  "sms_role_responsibilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => smsRoles.id, { onDelete: "cascade" }),
    responsibilityId: uuid("responsibility_id")
      .notNull()
      .references(() => smsResponsibilities.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("sms_role_responsibilities_role_resp_uidx").on(table.roleId, table.responsibilityId),
    index("sms_role_responsibilities_role_idx").on(table.roleId),
  ],
);

export const smsUserResponsibilities = pgTable(
  "sms_user_responsibilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => smsUsers.id, { onDelete: "cascade" }),
    responsibilityId: uuid("responsibility_id")
      .notNull()
      .references(() => smsResponsibilities.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("sms_user_responsibilities_user_resp_uidx").on(table.userId, table.responsibilityId),
    index("sms_user_responsibilities_user_idx").on(table.userId),
  ],
);

export const smsAuthorizationRequests = pgTable(
  "sms_authorization_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: varchar("transaction_id", { length: 80 }).notNull().unique(),
    tableName: varchar("table_name", { length: 120 }).notNull(),
    operationType: smsOperationTypeEnum("operation_type").notNull(),
    status: smsAuthorizationStatusEnum("status").notNull().default("pending_approval"),
    makerUserId: varchar("maker_user_id", { length: 120 }).notNull(),
    checkerUserId: varchar("checker_user_id", { length: 120 }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sms_auth_requests_status_idx").on(table.status),
    index("sms_auth_requests_maker_idx").on(table.makerUserId),
  ],
);

export const smsAuthorizationDetails = pgTable(
  "sms_authorization_details",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => smsAuthorizationRequests.id, { onDelete: "cascade" }),
    recordId: varchar("record_id", { length: 120 }).notNull(),
    oldValues: jsonb("old_values").$type<Record<string, unknown>>().notNull().default({}),
    newValues: jsonb("new_values").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sms_auth_details_request_idx").on(table.requestId)],
);

export const smsAuditLogs = pgTable(
  "sms_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: varchar("transaction_id", { length: 80 }).notNull(),
    tableName: varchar("table_name", { length: 120 }).notNull(),
    recordId: varchar("record_id", { length: 120 }).notNull(),
    operationType: smsOperationTypeEnum("operation_type").notNull(),
    oldValues: jsonb("old_values").$type<Record<string, unknown>>().notNull().default({}),
    newValues: jsonb("new_values").$type<Record<string, unknown>>().notNull().default({}),
    makerUserId: varchar("maker_user_id", { length: 120 }),
    checkerUserId: varchar("checker_user_id", { length: 120 }),
    status: smsAuditStatusEnum("status").notNull(),
    rejectionComment: text("rejection_comment"),
    ipAddress: varchar("ip_address", { length: 45 }),
    activityDescription: text("activity_description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sms_audit_logs_created_idx").on(table.createdAt)],
);

export const smsNotifications = pgTable(
  "sms_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 120 }).notNull(),
    channel: varchar("channel", { length: 40 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body").notNull(),
    status: smsUserStatusEnum("status").notNull().default("active"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sms_notifications_user_idx").on(table.userId)],
);

export const projectsRelations = relations(projects, ({ many, one }) => ({
  tasks: many(agentTasks),
  files: many(generatedFiles),
  tests: many(testResults),
  approvals: many(approvalRequests),
  deployments: many(deploymentHistory),
  events: many(activityEvents),
  spec: one(requirements),
}));

export const tasksRelations = relations(agentTasks, ({ one, many }) => ({
  project: one(projects, { fields: [agentTasks.projectId], references: [projects.id] }),
  executions: many(agentExecutions),
}));

/**
 * AI Automation Testing Platform — Module 1 (Project Management).
 *
 * A testing project under the AI QA platform: the application under test, its
 * requirements and later execution targets. MVP slice keeps name/description/
 * app URL + lifecycle status.
 */
export const aiTestingProjects = pgTable(
  "ai_testing_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description").notNull().default(""),
    appUrl: text("app_url").notNull().default(""),
    status: varchar("status", { length: 32 }).notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ai_testing_projects_status_idx").on(table.status),
    index("ai_testing_projects_created_at_idx").on(table.createdAt),
  ],
);
