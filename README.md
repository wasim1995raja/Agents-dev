# AutoDev Agent

An autonomous AI software-delivery platform. You describe an application, choose a
technology stack, and a manager agent plus specialist agents analyse the
requirements, write the business requirements document and architecture, implement
the app, run Playwright tests, repair failures, review the code, prepare deployment
artifacts and then wait for an explicit owner approval.

Everything the platform reports is backed by persisted rows and real execution:
generated files exist on disk, tests run inside a Docker sandbox, git checkpoints
are real commits, and the dashboard shows the actual event stream. There are no
mock success responses.

---

## What it does

| Capability | Implementation |
| --- | --- |
| Project intake | Validated REST API + dashboard form (name, description, requirements, stack, engine) |
| Workflow orchestration | Manager-driven phase plan persisted as `agent_tasks` and walked by the orchestrator |
| Specialists | Business Analyst, Solution Architect, UI/UX, Frontend, Backend, QA Automation, Code Review, Deployment |
| Implementation | Pluggable `CodingEngine`: deterministic `scaffold`, `codex` (Codex SDK), `openai-agents` (OpenAI Agents SDK) |
| Isolated execution | One persistent Docker container per project; only the project workspace is mounted |
| Verification | Real Playwright runs inside the container, JSON report parsed into `test_results` |
| Repair loop | Failed tests feed back into the implementation step until the cap is reached |
| Review | Code review step records findings and can request another implementation pass |
| Safety | Command policy, approval gates, read-only root filesystem, dropped capabilities, resource limits |
| Live monitoring | Server-sent events for every activity type; dashboard activity feed, terminal, tests, files, tasks |
| Deployment prep | Dockerfile + release notes prepared; production deploy is never performed automatically |
| Source download | Filtered zip of the generated workspace (secrets and dependencies excluded) |

---

## Stack

- **Language:** TypeScript (strict, ESM) on Node.js 22+
- **Monorepo:** pnpm workspaces (`packages/*`, `apps/*`)
- **API:** Fastify 5, Zod validation, pino structured logs, SSE
- **Database:** PostgreSQL 17 with Drizzle ORM and SQL migrations
- **Dashboard:** Next.js 16 (App Router) + React 19, custom CSS, no UI framework
- **Execution:** Docker Engine, one container per project
- **Testing:** Vitest (unit/integration), Playwright (generated app + dashboard E2E)
- **Agents:** OpenAI Agents SDK and Codex SDK, both behind the same engine interface

---

## Quick start

### 1. Prerequisites

- Node.js >= 22 and pnpm 9.15.9 (`corepack enable && corepack prepare pnpm@9.15.9 --activate`)
- Docker Engine with the current user able to talk to the daemon
- PostgreSQL 17 reachable on `127.0.0.1:5432`

### 2. Install and configure

```bash
pnpm install
cp .env.example .env
```

Edit `.env` if your database credentials differ. `OPENAI_API_KEY` is optional:
without it the platform runs the deterministic `scaffold` engine and reports the
model-backed engines as unavailable.

### 3. Create the database and apply migrations

```bash
# Creates the autodev role + database (needs postgres superuser access)
./scripts/bootstrap-db.sh

# Applies migrations and ensures the default owner row exists.
# Note the explicit `run`: pnpm has a built-in `setup` command.
pnpm --filter @autodev/db run setup
```

### 4. Build the sandbox image

```bash
pnpm sandbox:build
```

This builds `autodev/workspace:latest`: Node 22, Playwright browsers and the
Playwright test package pre-installed at `/opt/autodev`. Generated projects run
with `NODE_PATH` pointing there, so they need no network access to test.

### 5. Run

```bash
# API on http://127.0.0.1:3001
pnpm dev:api

# Dashboard on http://localhost:3000 (second terminal)
pnpm dev:web
```

Open <http://localhost:3000>, create a project with **Start development
immediately** checked, and watch it run. The run pauses at the owner-approval
gate. Approve it in the dashboard and the project completes.

---

## Repository layout

```
apps/
  api/            Fastify HTTP API, SSE, serializers, route tests, API E2E script
  web/            Next.js dashboard (App Router), unit tests, Playwright dashboard E2E
packages/
  shared/         Domain vocabulary, Zod contracts, config, SSE framing
  db/             Drizzle schema, migrations, repositories, setup
  sandbox/        Docker container lifecycle, command policy, exec
  coding/         CodingEngine interface + scaffold and Codex engines
  agents/         Agent prompts, workspace tools, OpenAI Agents engine
  git/            Git checkpoints and history
  orchestrator/   Manager pipeline, QA runner, approval registry, workspace helpers
docker/
  workspace/      Sandbox image (node, pnpm, git, Playwright)
scripts/
  bootstrap-db.sh Local Postgres role/database bootstrap
docs/
  ARCHITECTURE.md
  IMPLEMENTATION_PLAN.md
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the run lifecycle, data
model, safety model and API surface.

---

## Workflow

The orchestrator persists and walks these steps:

1. **Intake** — manager analyses requirements and produces the delivery plan.
2. **BRD** — business analyst writes requirements, user stories and acceptance criteria.
3. **Architecture** — solution architect defines stack, data model and API.
4. **UX** — screens, navigation and accessibility requirements.
5. **Implementation** — the selected coding engine writes real files into the workspace.
6. **Testing** — QA generates and runs Playwright suites inside Docker.
7. **Review** — code review records findings; failures trigger a bounded repair loop.
8. **Deployment** — Dockerfile and release notes are prepared.
9. **Approval** — a durable approval request pauses the run until the owner decides.

Progress is computed from task weights, and git checkpoints are created before
major changes and after milestones.

---

## Coding engines

The orchestrator depends only on the `CodingEngine` interface, so the engine is
replaced without touching the pipeline.

| Engine | Requires | Behaviour |
| --- | --- | --- |
| `scaffold` | nothing | Deterministic template implementation written directly to disk |
| `codex` | `OPENAI_API_KEY` | Codex SDK edits the workspace; commands still run only in Docker |
| `openai-agents` | `OPENAI_API_KEY` | Specialist agents use file read/write tools; no host command execution |

`AUTODEV_ENGINE=auto` selects `codex` when a key is present and `scaffold`
otherwise. A selected engine that cannot run fails loudly with the reason; it
never silently falls back.

---

## Safety model

- One Docker container per project, started with only the project workspace bind-mounted.
- `ReadonlyRootfs`, `CapDrop: ALL`, `no-new-privileges`, memory/CPU/PID limits, loopback-only preview port.
- Commands execute with a timeout inside the container, never on the host.
- Host-side command policy: forbidden binaries are denied; destructive and
  dependency-installing commands require a recorded owner approval.
- Approval requests are persisted and block the live run until decided.
- Secrets (`.env`, keys) and `node_modules` are excluded from file browsing and
  the source archive.
- Full activity log is persisted and streamed; the API never returns host paths
  or container ids to the browser.

---

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev:api` | Start the API with `tsx watch` |
| `pnpm dev:web` | Start the Next.js dashboard on :3000 |
| `pnpm typecheck` | Type-check every workspace package |
| `pnpm test` | Run every unit/integration suite |
| `pnpm build` | Build the shared packages and the dashboard |
| `pnpm sandbox:build` | Build the sandbox Docker image |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:setup` | Apply migrations and ensure the default owner |
| `pnpm --filter @autodev/api e2e` | API end-to-end script (real Postgres + Docker) |
| `pnpm --filter @autodev/orchestrator e2e` | Orchestrator end-to-end run |
| `pnpm --filter @autodev/web e2e` | Dashboard Playwright scenario (real stack) |

The E2E suites expect PostgreSQL, Docker and the API (`pnpm dev:api`) to be
running. The dashboard suite creates its own project, approves the gate through
the UI and verifies the generated artifacts.

---

## Configuration

All variables are documented in [`.env.example`](.env.example). The most important:

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://autodev:autodev@127.0.0.1:5432/autodev` | PostgreSQL connection string |
| `WORKSPACES_ROOT` | `./workspaces` | Resolved per app working directory; one folder per project |
| `CORS_ORIGIN` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated allowed origins |
| `AUTODEV_ENGINE` | `auto` | `auto`, `scaffold`, `codex`, `openai-agents` |
| `OPENAI_API_KEY` | empty | Enables the model-backed engines |
| `SANDBOX_IMAGE` | `autodev/workspace:latest` | Image built by `pnpm sandbox:build` |
| `OWNER_EMAIL` | `owner@autodev.local` | Identity recorded on approvals |
| `AUTODEV_RESUME_ON_BOOT` | `false` | Resume runs left `running` by a restart |

---

## Troubleshooting

- **Header shows “Docker offline”.** The daemon is unreachable or the image is
  missing. Run `docker info` and `pnpm sandbox:build`.
- **Header shows “No OPENAI_API_KEY”.** Expected without a key; use the
  `scaffold` engine or add a key and restart the API.
- **Dashboard cannot reach the API.** Check `NEXT_PUBLIC_API_BASE_URL` and that
  the API is listening on `127.0.0.1:3001`. The header badge reports failures
  instead of hiding them.
- **Approval never resumes.** A run only continues after a decision is POSTed to
  `/api/approvals/:id/decision`; the dashboard button does exactly that.
- **Tests cannot launch a browser.** Rebuild the sandbox image so the Playwright
  browser cache and the pinned `@playwright/test` version match.

---

## Verified state

The repository ships with verified behaviour, not just scaffolding:

- Unit/integration suites across all packages and both apps.
- API E2E against real PostgreSQL and Docker.
- Orchestrator E2E covering the full pipeline including the approval gate.
- Dashboard Playwright E2E that creates a project, waits for the gate, approves
  it in the UI, and checks files, tests, requirements, checkpoints, preview and
  the source download.

The live model-backed engines require `OPENAI_API_KEY`, which is intentionally
not committed. With no key, the scaffold engine is the verified path.
