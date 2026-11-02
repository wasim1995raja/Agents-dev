# AI Automation Testing Platform

Commercial-style AI Automation Testing Platform (MVP scaffold).

Phase 1–3 of the master plan: market research, requirements, architecture, then iterative engineering.

## Current milestone: M0 — platform shell

- Fastify HTTP app with `/api/health`.
- Postgres database handle via `@autodev/db`.
- Vitest unit tests via `app.inject`.

## Commands

```bash
pnpm --filter @autodev/ai-automation-testing-platform typecheck
pnpm --filter @autodev/ai-automation-testing-platform test
pnpm --filter @autodev/ai-automation-testing-platform dev
```
