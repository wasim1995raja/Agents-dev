import type {
  ActivityEvent,
  ApiErrorBody,
  Approval,
  CommandResult,
  CreateProjectRequest,
  FieldIssue,
  FileContent,
  GeneratedFile,
  GitCheckpoint,
  HealthInfo,
  PreviewInfo,
  Project,
  ProjectDetail,
  ProjectList,
  RuntimeInfo,
  CreateSmsResponsibilityRequest,
  CreateSmsRoleRequest,
  CreateSmsUserRequest,
  SmsAuthorizationRequest,
  SmsAuditEntry,
  SmsNotificationResponse,
  SmsAssignments,
  SmsOperationType,
  SmsResponsibility,
  SmsRole,
  SmsRoleResponsibilityResponse,
  SmsUser,
  SmsUserResponsibilityResponse,
} from "./types";

/**
 * Absolute base URL of the Fastify API. Defaults to the local development API
 * so `pnpm dev:web` works with `pnpm dev:api` without extra configuration.
 */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001"
).replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Validation issues returned by the API, ready for inline form display. */
export function fieldIssues(error: unknown): FieldIssue[] {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return [];
  return error.details.flatMap((issue) => {
    if (typeof issue !== "object" || issue === null) return [];
    const candidate = issue as { path?: unknown; message?: unknown };
    if (typeof candidate.message !== "string") return [];
    return [
      {
        path: typeof candidate.path === "string" ? candidate.path : "(root)",
        message: candidate.message,
      },
    ];
  });
}

function parseBody(text: string, contentType: string): unknown {
  if (!text) return null;
  if (!contentType.includes("application/json")) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  const text = await response.text();
  const body = parseBody(text, response.headers.get("content-type") ?? "");

  if (!response.ok) {
    const envelope = body as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      envelope?.error?.code ?? `http_${response.status}`,
      envelope?.error?.message ?? (response.statusText || `Request failed with ${response.status}`),
      envelope?.error?.details,
      envelope?.error?.requestId,
    );
  }

  return body as T;
}

function json(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

/**
 * Health is reported with a 503 when the database is down. The dashboard wants
 * to render that state rather than treat it as a transport failure, so this
 * probe never throws and reports `reachable: false` only for network errors.
 */
export async function probeHealth(): Promise<
  (HealthInfo & { reachable: true }) | { reachable: false; error: string }
> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/health`, { cache: "no-store" });
    const body = parseBody(await response.text(), response.headers.get("content-type") ?? "");
    if (typeof body === "object" && body !== null && "status" in body) {
      return { reachable: true, ...(body as HealthInfo) };
    }
    return { reachable: false, error: `Unexpected health payload (${response.status})` };
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export const api = {
  runtime: (): Promise<RuntimeInfo> => request<RuntimeInfo>("/api/runtime"),

  listProjects: (limit = 50): Promise<ProjectList> =>
    request<ProjectList>(`/api/projects?limit=${limit}`),

  getProject: (id: string): Promise<ProjectDetail> =>
    request<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`),

  createProject: (input: CreateProjectRequest): Promise<{ project: Project }> =>
    request<{ project: Project }>("/api/projects", json(input)),

  startProject: (id: string, engine?: string): Promise<{ id: string; accepted: boolean }> =>
    request<{ id: string; accepted: boolean }>(
      `/api/projects/${encodeURIComponent(id)}/start`,
      json(engine ? { engine } : {}),
    ),

  cancelProject: (id: string): Promise<{ project: Project }> =>
    request<{ project: Project }>(`/api/projects/${encodeURIComponent(id)}/cancel`, { method: "POST" }),

  deleteProject: (id: string): Promise<{ deleted: boolean; workspaceRemoved: boolean }> =>
    request<{ deleted: boolean; workspaceRemoved: boolean }>(
      `/api/projects/${encodeURIComponent(id)}?deleteWorkspace=true`,
      { method: "DELETE" },
    ),

  listEvents: (id: string, limit = 500): Promise<{ items: ActivityEvent[] }> =>
    request<{ items: ActivityEvent[] }>(
      `/api/projects/${encodeURIComponent(id)}/events?limit=${limit}`,
    ),

  listFiles: (id: string): Promise<{ items: GeneratedFile[]; count: number }> =>
    request<{ items: GeneratedFile[]; count: number }>(
      `/api/projects/${encodeURIComponent(id)}/files`,
    ),

  readFile: (id: string, filePath: string): Promise<FileContent> =>
    request<FileContent>(
      `/api/projects/${encodeURIComponent(id)}/files/content?path=${encodeURIComponent(filePath)}`,
    ),

  listCommits: (id: string): Promise<{ items: GitCheckpoint[] }> =>
    request<{ items: GitCheckpoint[] }>(`/api/projects/${encodeURIComponent(id)}/commits`),

  decideApproval: (
    approvalId: string,
    decision: "approved" | "rejected",
    note?: string,
  ): Promise<{ approval: Approval }> =>
    request<{ approval: Approval }>(
      `/api/approvals/${encodeURIComponent(approvalId)}/decision`,
      json({ decision, ...(note ? { note } : {}) }),
    ),

  runCommand: (id: string, command: string, cwd?: string): Promise<{ result: CommandResult }> =>
    request<{ result: CommandResult }>(
      `/api/projects/${encodeURIComponent(id)}/commands`,
      json({ command, ...(cwd ? { cwd } : {}) }),
    ),

  previewInfo: (id: string): Promise<PreviewInfo> =>
    request<PreviewInfo>(`/api/projects/${encodeURIComponent(id)}/preview`),

  startPreview: (id: string, command?: string): Promise<PreviewInfo> =>
    request<PreviewInfo>(
      `/api/projects/${encodeURIComponent(id)}/preview/start`,
      json(command ? { command } : {}),
    ),

  stopPreview: (id: string): Promise<{ stopped: boolean }> =>
    request<{ stopped: boolean }>(`/api/projects/${encodeURIComponent(id)}/preview/stop`, {
      method: "POST",
    }),

  // ---------------------------------------------------------------------
  // Student Management System (SMS) — users, roles, responsibilities,
  // maker–checker authorization queue, audit trail.
  // ---------------------------------------------------------------------

  listSmsUsers: (): Promise<{ users: SmsUser[] }> =>
    request<{ users: SmsUser[] }>("/api/sms/users"),

  createSmsUser: (input: CreateSmsUserRequest): Promise<{ user: SmsUser }> =>
    request<{ user: SmsUser }>("/api/sms/users", json(input)),

  listSmsRoles: (): Promise<{ roles: SmsRole[] }> =>
    request<{ roles: SmsRole[] }>("/api/sms/roles"),

  createSmsRole: (input: CreateSmsRoleRequest): Promise<{ role: SmsRole }> =>
    request<{ role: SmsRole }>("/api/sms/roles", json(input)),

  listSmsResponsibilities: (): Promise<{ responsibilities: SmsResponsibility[] }> =>
    request<{ responsibilities: SmsResponsibility[] }>("/api/sms/responsibilities"),

  createSmsResponsibility: (
    input: CreateSmsResponsibilityRequest,
  ): Promise<{ responsibility: SmsResponsibility }> =>
    request<{ responsibility: SmsResponsibility }>("/api/sms/responsibilities", json(input)),

  listSmsAssignments: (): Promise<SmsAssignments> => request<SmsAssignments>("/api/sms/assignments"),

  createSmsRoleResponsibility: (
    input: { roleId: string; responsibilityId: string },
  ): Promise<SmsRoleResponsibilityResponse> =>
    request<SmsRoleResponsibilityResponse>("/api/sms/role-responsibilities", json(input)),

  deleteSmsRoleResponsibility: (id: string): Promise<{ deleted: boolean }> =>
    request<{ deleted: boolean }>(
      `/api/sms/role-responsibilities/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),

  createSmsUserResponsibility: (
    input: { userId: string; responsibilityId: string },
  ): Promise<SmsUserResponsibilityResponse> =>
    request<SmsUserResponsibilityResponse>("/api/sms/user-responsibilities", json(input)),

  deleteSmsUserResponsibility: (id: string): Promise<{ deleted: boolean }> =>
    request<{ deleted: boolean }>(
      `/api/sms/user-responsibilities/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),

  listSmsAuthorizations: (): Promise<{ authorizations: SmsAuthorizationRequest[] }> =>
    request<{ authorizations: SmsAuthorizationRequest[] }>("/api/sms/authorizations"),

  submitSmsAuthorization: (input: {
    tableName: string;
    operationType: SmsOperationType;
    payload: Record<string, unknown>;
  }): Promise<{ id?: string; transactionId: string; status: string; requiresApproval?: boolean }> =>
    request<{ id?: string; transactionId: string; status: string; requiresApproval?: boolean }>(
      "/api/sms/authorization/submit",
      json(input),
    ),

  decideSmsAuthorization: (
    id: string,
    decision: "approved" | "rejected",
    note?: string,
  ): Promise<{ status: string; applied?: boolean }> =>
    request<{ status: string; applied?: boolean }>(
      `/api/sms/authorizations/${encodeURIComponent(id)}/${
        decision === "approved" ? "approve" : "reject"
      }`,
      json({ ...(note ? { note } : {}) }),
    ),

  listSmsAudit: (): Promise<{ audit: SmsAuditEntry[] }> =>
    request<{ audit: SmsAuditEntry[] }>("/api/sms/audit"),

  listSmsNotifications: (userId?: string): Promise<SmsNotificationResponse> =>
    request<SmsNotificationResponse>(
      `/api/sms/notifications${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`,
    ),

  markSmsNotificationRead: (id: string): Promise<{ notification: { id: string; readAt: string | null } }> =>
    request<{ notification: { id: string; readAt: string | null } }>(
      `/api/sms/notifications/${encodeURIComponent(id)}/read`,
      json({}),
    ),

  sourceUrl: (id: string): string =>
    `${API_BASE_URL}/api/projects/${encodeURIComponent(id)}/source`,

  streamUrl: (id: string): string =>
    `${API_BASE_URL}/api/projects/${encodeURIComponent(id)}/events/stream`,
};
