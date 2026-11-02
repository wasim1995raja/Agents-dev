import type {
  ActivityEvent,
  ActivityEventType,
  AgentRole,
  ApprovalStatus,
  ApprovalType,
  EngineName,
  EventLevel,
  Phase,
  ProjectStatus,
  TaskStatus,
} from "@autodev/shared/domain";

export type {
  ActivityEvent,
  ActivityEventType,
  AgentRole,
  ApprovalStatus,
  ApprovalType,
  EngineName,
  EventLevel,
  Phase,
  ProjectStatus,
  TaskStatus,
};

export interface Project {
  id: string;
  name: string;
  description: string;
  requirements: string;
  techStack: string[];
  status: ProjectStatus;
  phase: Phase | null;
  engine: EngineName;
  progress: number;
  error: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Task {
  id: string;
  phase: Phase;
  role: AgentRole;
  title: string;
  status: TaskStatus;
  orderIndex: number;
  attempt: number;
  output: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface TestResult {
  id: string;
  suite: string;
  status: "passed" | "failed" | "error";
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failures: unknown[];
  output: string | null;
  createdAt: string;
}

export interface Approval {
  id: string;
  projectId: string;
  type: ApprovalType;
  status: ApprovalStatus;
  title: string;
  payload: Record<string, unknown>;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  note: string | null;
}

export interface Deployment {
  id: string;
  version: string;
  status: "prepared" | "deployed" | "failed" | "rolled_back";
  image: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface Requirements {
  brd: string | null;
  userStories: unknown[];
  acceptanceCriteria: unknown[];
  createdAt: string;
}

export interface ProjectDetail {
  project: Project;
  requirements: Requirements | null;
  tasks: Task[];
  tests: TestResult[];
  approvals: Approval[];
  deployments: Deployment[];
}

export interface GeneratedFile {
  path: string;
  sha256: string;
  sizeBytes: number;
  language: string | null;
}

export interface FileContent {
  path: string;
  sizeBytes: number;
  content: string;
}

export interface GitCheckpoint {
  commit: string;
  subject: string;
  createdAt: string;
}

export interface PreviewInfo {
  url: string | null;
  command: string;
}

export interface CommandResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

export interface EngineAvailability {
  name: EngineName;
  available: boolean;
  reason: string;
}

export interface RuntimeInfo {
  engine: EngineName;
  configuredEngine: EngineName | "auto";
  hasOpenAIKey: boolean;
  availableEngines: EngineAvailability[];
  sandbox: {
    image: string;
    dockerAvailable: boolean;
    memoryMb: number;
    cpus: number;
    pidsLimit: number;
    commandTimeoutMs: number;
    dockerError?: string;
  };
  workspacesRoot: string;
}

export interface HealthInfo {
  status: "ok" | "degraded";
  version: string;
  database: "up" | "down";
  engine: EngineName;
  detail?: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface ProjectList {
  items: Project[];
  nextCursor: string | null;
}

export interface CreateProjectRequest {
  name: string;
  description: string;
  requirements: string;
  techStack?: string[];
  engine?: EngineName;
  autoStart?: boolean;
}

export interface FieldIssue {
  path: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Student Management System (SMS) — API contract mirrors (docs/sms/*)
// ---------------------------------------------------------------------------

export interface SmsUser {
  id: string;
  username: string;
  fullName: string;
  email: string;
  roleId: string;
  departmentId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SmsRole {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface SmsResponsibility {
  id: string;
  responsibilityName: string;
  moduleName: string;
  tableName: string;
  canAdd: boolean;
  canEdit: boolean;
  canView: boolean;
  canDelete: boolean;
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

export type SmsOperationType = "add" | "edit" | "delete";

export type SmsAuthorizationStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "cancelled"
  | "resubmitted";

export interface SmsAuthorizationRequest {
  id: string;
  transactionId: string;
  tableName: string;
  operationType: SmsOperationType;
  status: SmsAuthorizationStatus;
  makerUserId: string;
  checkerUserId: string | null;
  submittedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  detail?: SmsAuthorizationDetail | null;
}

export interface SmsAuthorizationDetail {
  id: string;
  requestId: string;
  recordId: string;
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  createdAt: string;
}

export interface SmsAuditEntry {
  id: string;
  transactionId: string;
  tableName: string;
  recordId: string;
  operationType: SmsOperationType;
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  makerUserId: string | null;
  checkerUserId: string | null;
  status: string;
  rejectionComment: string | null;
  ipAddress: string | null;
  activityDescription: string;
  createdAt: string;
}

export interface SmsNotification {
  id: string;
  userId: string;
  channel: string;
  title: string;
  body: string;
  status: "active" | "inactive";
  readAt: string | null;
  createdAt: string;
}

export interface SmsUserResponse {
  user: SmsUser;
}

export interface SmsRoleResponse {
  role: SmsRole;
}

export interface SmsResponsibilityResponse {
  responsibility: SmsResponsibility;
}

export interface SmsAuthorizationsResponse {
  authorizations: SmsAuthorizationRequest[];
}

export interface SmsAuditResponse {
  audit: SmsAuditEntry[];
}

export interface SmsNotificationResponse {
  notifications: SmsNotification[];
  userId: string;
}

export interface SmsRoleResponsibility {
  id: string;
  roleId: string;
  responsibilityId: string;
  assignedAt: string;
}

export interface SmsUserResponsibility {
  id: string;
  userId: string;
  responsibilityId: string;
  assignedAt: string;
}

export interface SmsAssignments {
  roleResponsibilities: SmsRoleResponsibility[];
  userResponsibilities: SmsUserResponsibility[];
}

export interface SmsRoleResponsibilityResponse {
  assignment: SmsRoleResponsibility;
}

export interface SmsUserResponsibilityResponse {
  assignment: SmsUserResponsibility;
}

export interface CreateSmsUserRequest {
  username: string;
  fullName: string;
  email: string;
  password: string;
  roleId: string;
  departmentId?: string | null;
  status?: string;
}

export interface CreateSmsRoleRequest {
  name: string;
  description?: string | null;
}

export interface CreateSmsResponsibilityRequest {
  responsibilityName: string;
  moduleName: string;
  tableName: string;
  canAdd: boolean;
  canEdit: boolean;
  canView: boolean;
  canDelete: boolean;
  makerCheckerRequired: boolean;
  makerUserId?: string | null;
  checkerUserId?: string | null;
  checkerRoleId?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  status?: string;
}
