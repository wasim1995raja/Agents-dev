# Architecture

AutoDev Agent is a pnpm monorepo with a strict separation between the HTTP
surface, the delivery pipeline, the coding engines and the execution sandbox. The
orchestrator depends on interfaces, not on a specific model vendor or on Docker
details.

```
┌──────────────────────────┐        REST + SSE        ┌──────────────────────┐
│ apps/web (Next.js 16)    │ ───────────────────────► │ apps/api (Fastify 5) │
│ dashboard, live stream   │ ◄─────────────────────── │ validation, SSE hub  │
└──────────────────────────┘                          └──────────┬───────────┘
                                                                 │
                                                    ┌────────────▼───────────┐
                                                    │ @autodev/orchestrator  │
                                                    │ pipeline, QA, approval │
                                                    └───┬────────┬───────┬───┘
                                                        │        │       │
                                        ┌───────────────▼──┐ ┌───▼────┐ ┌▼──────────────┐
                                        │ @autodev/coding  │ │ git    │ │ @autodev/agents│
                                        │ CodingEngine     │ │ check- │ │ prompts+tools  │
                                        │ scaffold / codex │ │ points │ │ (Agents SDK)   │
                                        └──────────────────┘ └───┬────┘ └───────────────┘
                                                                 │
                                                    ┌────────────▼───────────┐
                                                    │ @autodev/sandbox       │
                                                    │ Docker per project     │
                                                    └────────────┬───────────┘
                                                                 │
                                              ┌──────────────────▼─────────────────┐
                                              │ PostgreSQL (@autodev/db, Drizzle)  │
                                              └────────────────────────────────────┘
```

---

## Packages

| Package | Responsibility | Depends on |
| --- | --- | --- |
| `@autodev/shared` | Domain enums/types, Zod request contracts, environment config, SSE framing | — (zod only, plus a dependency-free `./options` subpath) |
| `@autodev/db` | Drizzle schema, SQL migrations, repositories, local setup | shared |
| `@autodev/sandbox` | Docker container lifecycle, command policy, exec with timeout | shared |
| `@autodev/coding` | `CodingEngine` contract, scaffold engine, Codex engine, templates | shared |
| `@autodev/agents` | Agent prompts, workspace tools, OpenAI Agents engine, deterministic specialists | shared, coding |
| `@autodev/git` | Repository init, checkpoint commits, history | — |
| `@autodev/orchestrator` | Manager pipeline, plan, QA runner, approval registry, workspace helpers, event bus | all of the above |
| `@autodev/api` | Fastify app, routes, serializers, SSE, health/runtime | orchestrator and repositories |
| `@autodev/web` | Next.js dashboard and browser-side data layer | shared (domain/options) |

### Why an interface for the coding engine

`packages/coding/src/types.ts` defines `CodingEngine`:

```ts
interface CodingEngine {
  readonly name: EngineName;
  isAvailable(): boolean;
  unavailableReason(): string | null;
  run(task: CodingTask, onEvent: CodingEventHandler): Promise<CodingResult>;
}
```

The orchestrator asks `engineFor(project.engine)` for an implementation and
streams `CodingEvent`s (`log`, `file`, `command`) into activity events. Adding a
new vendor means adding one class; the pipeline, database and dashboard stay
unchanged.

---

## Run lifecycle

`Orchestrator.start(projectId)`:

1. Loads the project and asserts it is not already active.
2. Ensures the workspace directory, Git repository and Docker container exist.
3. Persists the phase plan as `agent_tasks` (one task per orchestration step).
4. Walks `ORCHESTRATION_STEPS`:

| Step | Role | What is persisted |
| --- | --- | --- |
| `intake` | manager | plan summary, project status `running` |
| `brd` | business_analyst | `requirements` row (BRD, user stories, acceptance criteria) |
| `architecture` | solution_architect | architecture artifact on the task output |
| `ux` | ui_ux | UX artifact on the task output |
| `implementation` | frontend_developer | `generated_files` rows, `file.written` events |
| `testing` | qa_automation | `test_results` row, parsed Playwright report |
| `review` | code_review | review artifact, optional repair feedback |
| `deployment` | deployment | `deployment_history` row, Dockerfile + notes |
| `approval` | manager | `approval_requests` row; run pauses |

5. Marks phases `running` → `completed`, updates progress from
   `STEP_PROGRESS_WEIGHT`, and emits `phase.*`, `task.*`, `agent.message`,
   `file.written`, `checkpoint.created`, `test.*`, `approval.*`, `project.*`.
6. On a failed test run, feeds the failures back into another implementation
   attempt (bounded loop) before the review step.
7. Ends `completed`, `failed` or `cancelled`, with `error` populated on failure.

The manager's workspace, a `GitRepo`, commits after each milestone. Checkpoints
are mirrored into the API as commit rows sourced from `git log`.

### Approval gate

`packages/orchestrator/src/approvals.ts` owns a live `ApprovalRegistry`:

- The deployment step calls `requestApproval`, persists the request, publishes
  `approval.requested` and **awaits** a promise.
- `POST /api/approvals/:id/decision` resolves that promise. The database row is
  the durable record; the in-memory promise is what actually blocks the run.
- A rejected decision fails the run; an approved decision continues to
  `project.completed`.
- If the API restarts while a run is waiting, the run does not silently continue;
  `AUTODEV_RESUME_ON_BOOT=true` opts into resuming.

---

## Data model

PostgreSQL, migrations under `packages/db/drizzle/`.

| Table | Purpose |
| --- | --- |
| `users` | Owner identity (default `owner@autodev.local`) |
| `projects` | Name, requirements, stack, engine, status, phase, progress, workspace path, container id |
| `requirements` | BRD text, user stories, acceptance criteria |
| `agent_tasks` | One row per workflow step with status, attempt, output, error, timings |
| `agent_executions` | Individual agent/tool executions, tokens and durations |
| `generated_files` | Indexed files written by the implementation |
| `test_results` | Suite status, totals, duration, failure payload, raw output |
| `approval_requests` | Type, status, payload, decision identity and note |
| `deployment_history` | Prepared version, image, details, status |
| `activity_events` | Append-only activity log that also feeds SSE replay |

Enums in `schema.ts` are intentionally duplicated from `@autodev/shared`; a
schema sync test fails if they drift.

---

## HTTP API

All request bodies and query strings are validated with the shared Zod contracts.
Errors use one envelope:

```json
{ "error": { "code": "bad_request", "message": "...", "details": [], "requestId": "req-1" } }
```

| Method & path | Purpose |
| --- | --- |
| `GET /api/health` | Database probe; 200 healthy / 503 degraded |
| `GET /api/runtime` | Docker availability, engine availability, key presence |
| `POST /api/projects` | Create a project (optionally auto-start) |
| `GET /api/projects` | List projects with status/progress |
| `GET /api/projects/:id` | Project detail with tasks, tests, approvals and requirements |
| `POST /api/projects/:id/start` | Start or restart a run |
| `POST /api/projects/:id/cancel` | Request cancellation |
| `DELETE /api/projects/:id` | Delete the project, workspace and container |
| `GET /api/projects/:id/tasks` | Task ledger |
| `GET /api/projects/:id/tests` | Test results |
| `GET /api/projects/:id/executions` | Agent executions |
| `GET /api/projects/:id/deployments` | Deployment history |
| `GET /api/projects/:id/approvals` | Approval requests |
| `GET /api/projects/:id/commits` | Git checkpoints |
| `GET /api/projects/:id/events` | Activity replay with cursor |
| `GET /api/projects/:id/events/stream` | SSE stream (replay + live + heartbeat) |
| `GET /api/projects/:id/files` | Filtered file index |
| `GET /api/projects/:id/files/content` | One file, path-validated and secret-filtered |
| `POST /api/projects/:id/commands` | Run one sandboxed command |
| `GET /api/projects/:id/preview` | Preview URL and command |
| `POST /api/projects/:id/preview/start` | Start the generated app’s server |
| `POST /api/projects/:id/preview/stop` | Stop the preview process |
| `GET /api/projects/:id/source` | Filtered zip archive of the workspace |
| `POST /api/approvals/:id/decision` | Approve or reject a pending gate |

### Live events

`EventBus` writes to `activity_events`, keeps a per-project in-memory ring buffer
for replay and notifies SSE subscribers. Frames are named events
(`event: <type>`), which lets the browser subscribe by the shared
`ACTIVITY_EVENT_TYPES` vocabulary rather than hard-coded strings.

Because the SSE handler calls `reply.hijack()`, it writes the CORS header itself
using the same allow-list as the REST routes. Without that, browsers block the
stream and the dashboard would only ever show the initial replay snapshot.

### Wire shapes

`apps/api/src/serializers.ts` defines explicit DTOs. Host paths, container ids and
other internals never leave the server; the browser receives only fields it can
render.

---

## Sandbox and safety

`SandboxManager` creates one long-lived container per project:

- Image `autodev/workspace:latest` (Node 22, pnpm, git, Playwright pre-installed).
- Bind mount: only `WORKSPACES_ROOT/<projectId>` at `/workspace`.
- `ReadonlyRootfs: true`, `CapDrop: ["ALL"]`,
  `SecurityOpt: ["no-new-privileges:true"]`.
- `Memory`, `NanoCpus`, `PidsLimit` from config.
- Preview port published on `127.0.0.1:<random>` only.
- `exec` wraps commands with `timeout` and enforces `COMMAND_TIMEOUT_MS`.

Command policy (`packages/sandbox/src/policy.ts`) runs on the host before Docker:

- **deny** — privileged/system binaries (`sudo`, `mount`, `docker`, `systemctl`, …).
- **requires approval** — destructive commands (`rm`, `dd`, …) and dependency
  installs (`npm/pnpm/yarn install`, `pip install`, system package managers).
- **allow** — everything else, still inside the container.

The command counter is capped per project (`MAX_COMMANDS_PER_PROJECT`). Tests run
through the preinstalled Playwright CLI so a generated project needs no network
or extra approval to verify itself.

---

## Dashboard

`apps/web` is a client-rendered App Router app that reads the API directly:

- `lib/api.ts` — typed fetch client and URL builders.
- `lib/useProjectStream.ts` — subscribes to named SSE events derived from shared
  domain constants.
- `lib/events.ts` — dedupe/merge, terminal projection, refresh rules.
- `lib/progress.ts` — phase stepper and task summary derived from persisted rows.
- `components/ProjectWorkspace.tsx` — orchestrates detail polling, SSE, tabs and
  actions.

The dashboard never computes success itself: status, progress, tests, checkpoints
and file counts come from the API. There are no placeholder metrics.

---

## Design decisions

| Decision | Rationale |
| --- | --- |
| pnpm monorepo with TypeScript sources | One type system across API, pipeline and UI; no build step between packages |
| Drizzle + SQL migrations | Typed queries with reviewable SQL; schema sync test guards enums |
| One container per project | Isolation and reuse of the installed toolchain; cheap repeated runs |
| Manual start of preview server | Avoids surprising long-running processes; owner can start/stop from the UI |
| Approval is a live block, not a flag | A record alone would let the run continue; the registry makes the gate real |
| No silent engine fallback | Missing credentials fail loudly so a "successful" run is never fake |
| SSE + REST replay | Live updates without polling storms; reconnect replay keeps the feed complete |
| Shared vocabulary package | API, orchestrator and dashboard cannot drift on event names or enums |
| Zod v4 across the workspace | `@openai/agents-core` peer-requires v4; one version avoids duplicate types |

---

## Failure handling

- A missing Docker image or daemon surfaces as `sandbox` errors at container
  creation, and `GET /api/runtime` reports it before a run starts.
- A missing model key is reported by `/api/runtime` and rejected by
  `POST /api/projects/:id/start` when the engine needs it.
- A failed phase marks the task failed, sets the project `failed`, stores the
  error and publishes `project.failed`; the dashboard shows the exact message.
- A failed test run is not a fake pass: the report is persisted and the repair
  loop is bounded.
- Unhandled 5xx responses return a generic message plus the request id; details
  stay in the structured server log.
