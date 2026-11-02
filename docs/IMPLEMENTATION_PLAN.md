# Implementation Plan

This document records what was built, how it was verified, and what remains. It is
deliberately honest: unverified paths are listed as unverified.

---

## Strategy

Ship a working vertical slice first, then deepen each specialist:

1. **Foundation** — shared domain contracts, database schema, sandbox, git, config.
2. **MVP** — dashboard, project creation, manager agent, one coding engine, Docker
   execution, Playwright verification, live status/logs.
3. **Specialists** — BRD, architecture, UX, review and deployment artifacts, each
   persisted and shown in the UI.
4. **Hardening** — approval gates, command policy, secret filtering, repair loop,
   end-to-end coverage on the real stack.

The manager pipeline only calls interfaces (`CodingEngine`, `SandboxManager`,
repositories), so each phase could land without rewriting the previous one.

---

## Phase 0 — Foundation (done)

- [x] pnpm workspace, strict TypeScript base config, shared ESM conventions.
- [x] `@autodev/shared`: statuses, phases, roles, engines, event types, request
      contracts, environment parsing, SSE framing.
- [x] `@autodev/db`: full schema for users, projects, requirements, tasks,
      executions, files, tests, approvals, deployments, activity events.
- [x] SQL migration + idempotent `db setup` that ensures the default owner.
- [x] `@autodev/sandbox`: image, container lifecycle, command policy, timed exec.
- [x] `@autodev/git`: repository init and milestone checkpoints.
- [x] Bootstrap script for the local PostgreSQL role/database.

## Phase 1 — MVP vertical slice (done)

- [x] `@autodev/coding`: `CodingEngine` contract and deterministic `scaffold`
      engine that writes a real Node app and Playwright suite.
- [x] `@autodev/agents`: manager plan, prompt library, workspace tools,
      deterministic specialist artifacts, Agents SDK engine.
- [x] `@autodev/orchestrator`: nine-step pipeline, progress weights, event bus,
      QA runner that parses the Playwright JSON report, repair loop.
- [x] Fastify API with validated inputs, structured logging, SSE, health/runtime
      truth-reporting, project CRUD, artifacts, files, commands, preview, source
      archive.
- [x] Next.js dashboard: create project, history, live activity, phase stepper,
      terminal, file explorer, test results, approvals, preview, checkpoints,
      tasks, requirements, deployment history, source download.
- [x] Docker preview: generated app served on a random loopback port.

## Phase 2 — Specialists (done)

- [x] Business Analyst artifact: BRD, user stories, acceptance criteria in the DB.
- [x] Solution Architect artifact: stack, data model, API contracts.
- [x] UI/UX artifact: screens, navigation, accessibility requirements.
- [x] Code Review artifact: findings recorded; failures can trigger another
      implementation pass.
- [x] Deployment artifact: Dockerfile + release notes; production deploy is never
      executed automatically.
- [x] Owner approval gate that genuinely blocks the live run and resumes on a
      recorded decision.

## Phase 3 — Hardening (done)

- [x] Per-project container: read-only root filesystem, dropped capabilities,
      `no-new-privileges`, memory/CPU/PID limits, timeout-wrapped commands.
- [x] Host-side command policy with deny / requires-approval / allow verdicts.
- [x] Secret and dependency filtering for file browsing and source archives.
- [x] Explicit DTOs: no host paths or container ids leak to the browser.
- [x] CORS allow-list applied to both REST and the hijacked SSE response.
- [x] Vitest coverage for every package, API route tests, API E2E, orchestrator
      E2E and a dashboard Playwright scenario on the real stack.
- [x] Unit-test isolation so generated project suites never run as API tests.

---

## Verification evidence

| Layer | Tests | Notes |
| --- | --- | --- |
| `@autodev/shared` | 9 unit | Domain/config/contracts/SSE |
| `@autodev/db` | 7 unit | Includes schema/enum sync |
| `@autodev/sandbox` | 10 unit + 14 Docker | Real container lifecycle and policy |
| `@autodev/coding` | 4 unit | Scaffold output and file safety |
| `@autodev/agents` | 16 unit | Prompts, tools, deterministic artifacts |
| `@autodev/git` | 12 unit | Real repositories/commits |
| `@autodev/orchestrator` | 36 unit + 13 E2E | Full pipeline and approval gate |
| `@autodev/api` | 27 route tests + 15 E2E checks | Real Postgres and Docker |
| `@autodev/web` | 16 unit + 1 Playwright E2E | E2E creates, approves, verifies artifacts |

The numbers above are the suites as implemented; run `pnpm test` for the current
count in your environment.

### What the dashboard E2E actually proves

`apps/web/e2e/dashboard.spec.ts`:

1. Creates a project through the real form and API.
2. Waits for the orchestrator to reach the owner-approval gate.
3. Approves the gate in the UI and waits for `Completed`.
4. Asserts 100% progress and all nine phases done.
5. Asserts non-placeholder checkpoint, test and file statistics.
6. Reads a generated file (`server.mjs`) through the explorer.
7. Confirms a passing Playwright result produced inside the sandbox.
8. Confirms the terminal shows real sandbox/test output.
9. Confirms requirements, checkpoints, approval record, source link and the
   loopback preview URL.
10. Confirms the project appears in history with the real status.

### Known unverified path

- **Live model-backed engines (`codex`, `openai-agents`)** are implemented and
  availability-checked, but this environment has no `OPENAI_API_KEY`, so their
  model output has not been exercised end to end. The verified path is the
  deterministic `scaffold` engine. No success is claimed for the LLM path.

---

## Remaining work / roadmap

### Near term

- [ ] Multi-user authentication and project ownership (the current API is
      single-owner by design).
- [ ] Real deployment targets (registry push, cloud run) behind a second
      approval gate; today only artifacts are prepared.
- [ ] Model-backed engine evaluation harness: golden projects, pass-rate, cost and
      latency tracking before claiming LLM parity.
- [ ] Streaming token/command output from the coding engines at finer granularity.
- [ ] Cancellation that interrupts an in-flight container command, not just the
      next step.
- [ ] Retention policy and cleanup job for workspaces, containers and events.

### Medium term

- [ ] Queue/worker split so multiple projects can run concurrently with fair
      resource limits.
- [ ] Rich code review findings with file/line anchors and one-click fixes.
- [ ] Requirement traceability: map each acceptance criterion to a test and a
      generated file.
- [ ] Preview screenshot capture and visual diffing.
- [ ] Per-project resource quotas and cost accounting.

### Explicit non-goals (for now)

- Unrestricted host shell access.
- Automatic production deployment without human approval.
- Hidden retries that turn failures into apparent successes.

---

## Local setup checklist

```bash
pnpm install
cp .env.example .env
./scripts/bootstrap-db.sh
pnpm --filter @autodev/db run setup
pnpm sandbox:build
pnpm typecheck
pnpm test
pnpm dev:api   # terminal 1
pnpm dev:web   # terminal 2
```

Then run the E2E suites with PostgreSQL, Docker and the API up:

```bash
pnpm --filter @autodev/api e2e
pnpm --filter @autodev/orchestrator e2e
pnpm --filter @autodev/web e2e
```
