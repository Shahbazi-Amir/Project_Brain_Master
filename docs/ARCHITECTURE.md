# Architecture

## Core loop

```text
Raw idea
  -> Project Architect
  -> approved Project Definition
  -> Project Memory
  -> Supervisor
  -> Executor (Codex or manual)
  -> Reviewer
  -> Loop Policy
  -> continue / ask user / pause / complete
```

## Why local-first
The application holds project files, SQLite state and local Codex authentication on the user's machine. The default HTTP bind is loopback-only. No cloud backend is required for the MVP.

## Role separation
- **Architect**: discovery, scope, goals, missing decisions, research needs.
- **Supervisor**: selects one next task and defines acceptance criteria. Read-only.
- **Executor**: performs the task. Only role with workspace-write permission.
- **Reviewer**: independently scores evidence against the approved definition. Read-only.
- **Loop Controller**: applies deterministic stop conditions; models do not control iteration budgets.

## Persistence
SQLite stores operational state and audit history. Markdown memory files under each project directory preserve human-readable project definition, goals, scope, directives, decisions, research and lessons.

## Provider boundary
`CodexProvider` is an adapter around `codex exec`. Core logic consumes structured outputs rather than depending on a model name. A future API, local-model, or other provider can implement the same boundary.

## Safety
The MVP intentionally has no auto-merge, production deployment, arbitrary credential management or danger-full-access mode. Long loops are bounded by max iterations, quality threshold and stagnation detection.
