# Project Brain — Agent Instructions

## Product intent
Project Brain is a local-first project operating system. It is not another chat UI. It defines projects, preserves project memory, delegates work, independently reviews results, and controls bounded iteration loops.

## Non-negotiable architecture
- Keep Core provider-independent; Codex CLI is the first provider, not the architecture.
- Architect, Supervisor and Reviewer are read-only roles. Only Executor may receive workspace-write access.
- Never use `danger-full-access`, `--yolo`, sudo, automatic production deploy, automatic merge, or force-push.
- Human directives outrank inferred preferences. Do not silently change approved scope or success criteria.
- Never expose or persist model chain-of-thought. Store concise decision/reasoning summaries only.
- Project data is isolated by project ID under `.project-brain/` and must never be committed.
- Secrets must never be committed, logged, copied from one execution environment to another, or requested in chat.

## Execution-environment rule
Before technical work, choose the environment that owns the state. Repository/CI work prefers GitHub Connector/App and GitHub Actions. User-Mac work is only for genuinely local state such as local Codex auth, filesystem paths, macOS permissions, Homebrew/DevFix, or device behavior. Missing local `gh` is not a GitHub blocker.

Read the full guardrails in `docs/guardrails/` before GitHub/CI or Mac tooling work.

## Runtime constraints
- Target Node.js 24 LTS (>=24.12) and use stable native TypeScript type stripping.
- Use `node:sqlite`; do not add a native SQLite npm dependency unless there is a proven requirement.
- Keep runtime dependencies near zero. New production dependencies require a clear justification.
- Bind the server to `127.0.0.1` by default.

## Codex integration
- Use `codex login status` for local auth health; never inspect or copy `~/.codex/auth.json`.
- Use `codex exec --json` for machine-readable events.
- Use JSON Schema output for Architect/Supervisor/Reviewer.
- Use `read-only` sandbox for non-executor roles and `workspace-write` for Executor.
- For unattended local runs use `--ask-for-approval never` only together with the sandbox constraints above.
- External web research must be opt-in or explicitly justified by the project task.

## Quality gates
Before publishing changes, run:

```bash
npm install
npm run ci
```

CI must pass on GitHub Actions. Do not disable tests, weaken validation, or remove checks merely to get green CI.
