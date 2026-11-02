# Agents Organization

This folder organizes the agent definitions used by the OpenCode / ECC agent runtime into
responsibility layers. The source definitions live in the ECC install (`/home/wasim_raja/ECC/agents`);
this repository keeps a curated, organized copy.

## Layers

### 1. `managers/` — Manager responsibility layer

Agents that hold a **responsibility** or orchestrate other agents. They own planning, architecture,
evaluation, security, data, performance, marketing, documentation, network, release or clinical-safety
concerns, and delegate execution to teams.

Current managers (26):

- Process / orchestration: `chief-of-staff`, `loop-operator`, `harness-optimizer`, `agent-evaluator`, `conversation-analyzer`
- Architecture / planning / requirements: `architect`, `code-architect`, `planner`, `spec-miner`, `homelab-architect`, `network-architect`
- Data / AI / quality ownership: `database-reviewer`, `mle-reviewer`, `rag-pipeline-reviewer`, `performance-optimizer`, `pytorch-build-resolver`
- Security / safety: `security-reviewer`, `healthcare-reviewer`
- Marketing / content: `marketing-agent`, `seo-specialist`
- Release / operations: `opensource-forker`, `opensource-packager`, `opensource-sanitizer`, `network-config-reviewer`, `network-troubleshooter`
- Docs: `docs-lookup`, `doc-updater`

### 2. `teams/` — Team execution layer

Teams own **execution**. Each team pairs a manager (the responsibility owner) with specialist
members that perform the work.

Current teams:

- `engineering/` — manager: `code-architect`; members: `a11y-architect`, `bengali-reviewer`, `build-error-resolver`, `code-explorer`, `code-reviewer`, `code-simplifier`, `comment-analyzer`, `commit-reviewer`, `cpp-build-resolver`, `cpp-reviewer`, `csharp-reviewer`, `dart-build-resolver`, `django-build-resolver`, `django-reviewer`, `fastapi-reviewer`, `flutter-reviewer`, `fsharp-reviewer`, `go-build-resolver`, `go-reviewer`, `harmonyos-app-resolver`, `java-build-resolver`, `java-reviewer`, `kotlin-build-resolver`, `kotlin-reviewer`, `php-reviewer`, `pr-test-analyzer`, `python-reviewer`, `react-build-resolver`, `react-reviewer`, `refactor-cleaner`, `ruby-reviewer`, `rust-build-resolver`, `rust-reviewer`, `silent-failure-hunter`, `swift-build-resolver`, `swift-reviewer`, `tdd-guide`, `type-design-analyzer`, `typescript-reviewer`, `vue-reviewer`.
- `ai/` — manager: `mle-reviewer`; members: `gan-evaluator`, `gan-generator`, `gan-planner`, `pytorch-build-resolver`.

### 3. `applications/` — Application-scoped agent layer

Application-specific agent sets. Each application groups the managers and teams relevant to that
product so agents stay scoped to a single application.

Current applications:

- `sms/` — Student Management System build/operate agent set (manager: `planner`; members:
  `build-error-resolver`, `code-reviewer`, `database-reviewer`, `e2e-runner`, `performance-optimizer`,
  `security-reviewer`, `silent-failure-hunter`, `tdd-guide`).

## Adding new agents

1. Add the agent definition file under the appropriate layer (`managers/`, `teams/<team>/members/`,
   or `applications/<app>/members/`).
2. Update the layer indexes above and this README when new managers, teams, or applications appear.

## Note

Agent prompt content is copied from the ECC install and must be reviewed before use. Responsibility
boundaries live here; execution detail lives in teams; product scope lives in applications.
