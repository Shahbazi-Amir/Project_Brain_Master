# Project Brain v0.8.1 — Paused Handoff

Date: 2026-08-20
Status: PAUSED BY USER — DO NOT AUTO-RESUME

## 1) Repository / PR state

Repository: `Shahbazi-Amir/Project_Brain_Master`
Current implementation branch: `agent/execution-progress-dashboard`
PR: `#17`
PR state: OPEN / DRAFT / NOT MERGED
Current implementation head at pause: `9f98ec5df9f900b1bc357a281b6efa6033f6aa16`
Base: `main` at `a6297bab6996f27a287c026719d685537359232b`

A reserved branch `agent/remote-worker-vnext` was created from the paused implementation head, but no remote-worker implementation work should continue without explicit user instruction.

## 2) What is confirmed working in v0.8.1

- Architect -> Supervisor -> Executor -> Reviewer loop is real, not UI-only.
- Executor can work in a Project Brain-managed isolated GitHub clone.
- Execution repository is separated from resource/source repositories.
- Source GitHub repositories can be fetched into managed source workspaces and inventoried/classified.
- Execution stages are persisted with concrete tasks and estimated time.
- Per-task state is persisted in SQLite (`PENDING`, `RUNNING`, `DONE`, `WAITING`, `ATTENTION`, `PAUSED`).
- Runtime lifecycle events are persisted for Supervisor, Executor, Reviewer, GitHub checkpoints, blockers, errors and completion.
- Safe GitHub delivery exists:
  - only `brain/*` branches
  - no direct work on `main/master`
  - no force-push
  - no auto-merge
  - no deploy
  - secret/path guards before push
  - reviewed PASS checkpoint before commit/push
- SQLite legacy migration bug (`no such column: stage_index`) was fixed and regression-tested.
- Browser full-page jump caused by periodic full `#main` re-render was fixed on the paused implementation branch and covered by a regression test.

## 3) Real end-to-end evidence

The live test project used:
- source/resource repository: `Shahbazi-Amir/Book_Production`
- execution repository: `Shahbazi-Amir/Brain_Agent_Book`

Project Brain created and pushed a safe execution branch in the target repository and produced real files. This proves the loop passed beyond Supervisor and UI-only state into Executor/Reviewer/GitHub delivery.

## 4) Known problems / incomplete behavior

### P0 — Runtime still depends on the local Mac process

Current Brain server and Codex CLI run locally. If the Mac process is killed, VS Code/terminal process ends, or the machine sleeps/shuts down, the current loop cannot continue.

User requirement for next architecture:
- execution must not depend on an open VS Code terminal or browser tab
- browser should be a control/view layer only
- do not implement this automatically; design/implementation requires a later explicit user instruction

### P0 — Durable pause/resume across process restart is not yet the final model

Task state is persisted, but the overall worker lifecycle is still process-local. A future runtime must safely resume from a durable checkpoint rather than depending on in-memory controller state.

Required next behavior:
- `PAUSE` must persist durably
- restart must not silently resume unless policy explicitly says so
- resume must continue from the last reviewed checkpoint
- active executor process must be cancellable/terminable safely

### P1 — Reload/navigation persistence

Refreshing the browser can lose the selected/open project context. The selected project should be stored in URL state and/or localStorage so reload returns to the same project.

Required:
- project URL such as `/?project=<id>` or equivalent
- restore current project after refresh
- no disappearance of control buttons after reload

### P1 — UI should be stage-first, not log-first

User does not want continuous verbose operational text as the primary UI.

Target UX:
- top: `مرحله X از Y`
- stage goal
- checklist of tasks for the active stage
- status icon (`○`, `●`, `✓`, waiting/attention)
- detailed logs and technical explanation collapsed by default
- completed stage becomes a compact summary

### P1 — Feedback should happen primarily at stage completion

User preference:
- normal operation should continue without constant visible chatter
- when a stage completes, provide one concise report containing:
  - stage number/name
  - tasks completed
  - Reviewer result
  - GitHub commits/push checkpoint
  - blocker or next stage

Do not implement notifications/automation without explicit authorization.

### P1 — Resource ingestion needs stronger semantic organization

Current source repository support inventories and classifies by broad file type. Future version should support richer source organization, for example:
- canonical source identity
- author/title/type/version
- duplicate detection
- source integrity/hash
- book/article/audio/video/transcript distinction
- approved vs excluded corpus
- mapping resource items to execution-stage tasks

### P1 — Execution target must remain explicit

The UI/preflight should always show, before execution:
- resource repository/repositories
- execution repository
- actual local/remote workspace identity
- safe work branch
- blockers

Source repos must never be confused with the repository where outputs are written.

### P2 — Create-new-GitHub-repository flow is not implemented in Brain

Desired future flow:
`new repository name -> create GitHub repository -> create safe branch/workspace -> run project -> reviewed checkpoint pushes -> Draft PR`

This must remain disabled until explicitly requested.

### P2 — Mac resource usage / browser load

The live local run appeared to noticeably load the user's Mac and Chrome. The previous full-page polling bug contributed to browser jumping. Future architecture should reduce local load by separating execution worker from UI and using lightweight state updates/event streaming.

## 5) Safety / continuation guardrails

Until the user explicitly asks to continue:

- DO NOT merge PR #17.
- DO NOT resume the book execution automatically.
- DO NOT create a remote worker automatically.
- DO NOT deploy anything.
- DO NOT move changes to `main`.
- DO NOT force-push or rewrite history.
- DO NOT create/merge a PR in `Brain_Agent_Book` unless explicitly requested.
- Preserve existing execution checkpoints and branches as evidence.

## 6) Proposed next-version work order — documentation only

This is backlog, not authorization to implement.

1. Durable execution state / pause-resume contract.
2. Worker/UI separation and a non-Mac-dependent execution architecture.
3. Reload-safe project routing/state persistence.
4. Stage-first compact UI and collapsed technical logs.
5. Stage-completion summary/report event.
6. Stronger semantic resource catalog and corpus decisions.
7. New GitHub repository creation flow.
8. Full end-to-end test with shutdown/restart/resume and GitHub checkpoint verification.

## 7) Resume checklist for the next session

Before changing code:

1. Read this document.
2. Inspect PR #17 current head and CI.
3. Inspect `Brain_Agent_Book` checkpoint branch and compare with `main`.
4. Confirm no local/background execution is being assumed.
5. Ask/confirm which backlog item the user wants implemented first.
6. Work on a feature branch; no merge without explicit permission.

## 8) User intent at pause

The user explicitly requested that work stop here and that the current version, known issues, and continuation plan be documented. The user does NOT want the assistant to proceed into automatic execution or remote-worker implementation at this time.
