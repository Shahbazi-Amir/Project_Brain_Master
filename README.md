# Project Brain Master

Project Brain is a **local-first project operating system** for long-running AI-assisted work. It is designed to replace the manual pattern of opening many chats, copying prompts between a supervisor and an executor, repeatedly reviewing results, and rebuilding context.

It does **not** try to replace ChatGPT or Codex. It sits above an executor and manages project definition, memory, delegation, review, iteration limits, and human intervention.

## MVP workflow

```text
Raw idea
  ↓
Project Architect
  ↓
Approved Project Definition
  ↓
Project Memory
  ↓
Supervisor (read-only)
  ↓
Executor (Codex workspace-write OR manual ChatGPT/Work)
  ↓
Reviewer (read-only)
  ↓
Deterministic Loop Policy
  ↓
Continue / Ask User / Pause / Complete
```

Supported project profiles:

- Coding
- Writing / Book
- Research
- Planning
- General project work

## What the MVP already does

- Converts a rough idea into a structured project definition before execution.
- Suggests goals, approaches, complexity, workload, missing decisions, and research needs.
- Can optionally allow current web research during project discovery.
- Stores each project independently.
- Persists operational state in SQLite and human-readable memory in Markdown.
- Separates Supervisor, Executor, and Reviewer responsibilities.
- Lets only the Executor receive `workspace-write`; oversight roles are read-only.
- Supports automatic Codex execution loops.
- Supports Manual Executor mode for sending the generated prompt to ChatGPT/Work yourself and pasting the result back for review.
- Accepts human directives while a project evolves.
- Stops on human decisions, project completion, stagnation, iteration limits, errors, pause, or stop.
- Tracks Codex token usage and run duration in the local database.
- Keeps hidden chain-of-thought out of persisted state; only structured decision summaries are stored.

## Requirements

The application targets:

- Node.js `24.12+` (Node 24 LTS)
- Codex CLI available on `PATH`
- A local Codex login for AI-backed Project Brain roles

Before changing your Mac toolchain, first check what is already installed:

```bash
node --version
which node
codex --version
which codex
codex login status
```

Do not paste GitHub tokens, OpenAI credentials, or other long-lived secrets into Project Brain or chat.

## Install

From the repository root:

```bash
npm install
npm run ci
```

`npm install` is only needed for TypeScript development/typechecking dependencies. The application itself intentionally uses Node built-ins for the HTTP server and SQLite database.

## Run locally

```bash
npm start
```

Then open:

```text
http://127.0.0.1:3000
```

Development mode:

```bash
npm run dev
```

## First project

1. Click **New Project**.
2. Describe the result you want in normal language.
3. Optionally choose a profile hint; otherwise let Architect detect it.
4. Optionally enable current web research for discovery.
5. Click **Analyze Project**.
6. Review the suggested type, approaches, workload, missing decisions, and draft Project Definition.
7. Edit the definition if needed.
8. Select an Executor mode:
   - **Codex**: Project Brain sends execution work directly to Codex.
   - **Manual**: Project Brain generates the execution prompt; you run it in ChatGPT/Work and paste the result back.
9. Approve/create the project.
10. Use **Run one iteration** while testing a workflow, or **Run loop** once the project definition is trustworthy.

## Existing coding repository as workspace

When creating a coding project, enter the absolute local repository path in **Local workspace path**, for example:

```text
/Users/you/Projects/my-app
```

Project Brain verifies that the directory exists. Supervisor and Reviewer operate read-only; Executor can modify files inside the selected workspace according to Codex sandbox rules.

For non-code work, leaving the workspace blank creates an isolated internal workspace under `.project-brain/`.

## Project memory

Runtime state is stored under:

```text
.project-brain/
```

This directory is gitignored.

For each project, Project Brain creates readable memory files such as:

```text
project.md
goals.md
rules.md
style.md
scope.md
decisions.md
state.md
research.md
directives.md
lessons.md
```

Operational history is stored in:

```text
.project-brain/project-brain.sqlite
```

The database includes project, task, iteration, agent-run, prompt, result, review, decision, directive, event, and usage tables.

## Human directives

You can add a directive such as:

```text
Do not change the public API.
```

or:

```text
The author's voice in chapter 4 is becoming too formal; preserve the approved voice.
```

Active directives are stored and loaded into later Supervisor/Reviewer iterations.

## Loop safety

The loop is controlled by code rather than letting a model decide to run forever.

Current controls include:

- maximum iterations
- minimum quality score
- maximum stagnant iterations
- human-decision stop
- project-complete stop
- pause / stop
- provider error stop

A Reviewer PASS on one task does not automatically mark the whole project complete. Whole-project completion must also satisfy the approved project success criteria and quality threshold.

## Codex permissions

Project Brain uses these defaults:

```text
Architect     read-only
Supervisor    read-only
Reviewer      read-only
Executor      workspace-write
```

It intentionally does not use `danger-full-access`, `--yolo`, automatic production deployment, automatic GitHub merge, or sudo.

## Configuration

Copy values from `.env.example` into your environment as needed. The MVP does not require an `.env` file.

Available variables:

```text
PROJECT_BRAIN_HOST
PROJECT_BRAIN_PORT
PROJECT_BRAIN_DATA_DIR
PROJECT_BRAIN_CODEX_COMMAND
PROJECT_BRAIN_DEFAULT_MAX_ITERATIONS
PROJECT_BRAIN_DEFAULT_MIN_QUALITY
PROJECT_BRAIN_CODEX_TIMEOUT_MS
```

The default server bind is `127.0.0.1`, not a public network interface.

## Quality checks

```bash
npm run typecheck
npm test
npm run ci
```

GitHub Actions runs the same typecheck/test gate on Node 24 for pushes and pull requests.

## Architecture and guardrails

- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Agent rules: [`AGENTS.md`](AGENTS.md)
- GitHub / CI guardrail: [`docs/guardrails/01_GITHUB_CI_GUARDRAIL.md`](docs/guardrails/01_GITHUB_CI_GUARDRAIL.md)
- Mac / DevFix / CLI guardrail: [`docs/guardrails/02_MAC_DEVFIX_HOMEBREW_CLI_GUARDRAIL.md`](docs/guardrails/02_MAC_DEVFIX_HOMEBREW_CLI_GUARDRAIL.md)
- Execution-environment guardrail: [`docs/guardrails/03_GENERAL_EXECUTION_ENVIRONMENT_GUARDRAIL.md`](docs/guardrails/03_GENERAL_EXECUTION_ENVIRONMENT_GUARDRAIL.md)

## Important MVP limitations

This is deliberately a focused first version. It does not yet include:

- cloud hosting or multi-user authentication
- n8n orchestration
- Docker sandboxing
- GitHub trend/hotspot analysis
- automatic repository clone/push/PR flows inside Project Brain
- provider/model routing across multiple vendors
- scheduled/background project runs
- a vector database or large RAG system
- automatic merging or production deployment

Those should be added only after the core Architect → Supervisor → Executor → Reviewer loop proves useful in real projects.

## Development principle

Project Brain should remain a **Project Operating System**, not grow into another generic AI chat interface. New features should improve one of these capabilities:

```text
understand
remember
plan
delegate
review
correct
track
```
