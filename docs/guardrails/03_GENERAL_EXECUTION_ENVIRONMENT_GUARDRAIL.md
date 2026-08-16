# General Execution Environment Guardrail
## Permanent Agent Constraint — Decide Where Work Should Run Before Running It

Use this guardrail before every technical task in this project.

Its purpose is to prevent work from being executed in the wrong environment and to avoid needless user handoffs, local dependencies, authentication dead ends, and destructive retries.

---

## 1. First Question: Where Should This Task Run?

Before taking action, classify the task.

Available environments:

```text
A. Agent Workspace
B. User Mac
C. GitHub Connector / App
D. GitHub Actions Runner
E. External service / authoritative web source
```

Do not assume one environment can substitute for another.

---

## 2. Default Routing Matrix

### Repository / CI / Release / GitHub Metadata

Prefer:

```text
GitHub Connector / App
→ GitHub Actions if execution/build/runtime is required
```

Do not require the User Mac unless the task is explicitly local.

### Local macOS Package / Binary / Filesystem / Keychain / Device Task

Prefer:

```text
User Mac
```

Examples:

```text
Homebrew
DevFix
local gh authentication
FFmpeg runtime
local filesystem
macOS permissions
Keychain
hardware-specific behavior
```

### Build/Test That Must Be Reproducible and Repository-Centric

Prefer:

```text
GitHub Actions
```

when a suitable runner exists.

### Analysis / Drafting / Small File Transformation

Prefer:

```text
Agent Workspace
```

unless the source exists only elsewhere.

### Current External Facts / Releases / Documentation

Use:

```text
authoritative web/API/official source
```

and do not rely on stale memory for changing facts.

---

## 3. Never Infer Cross-Environment State

These statements are invalid:

```text
gh fails in Workspace
→ gh fails on User Mac

Connector is authenticated
→ local gh is authenticated

Homebrew works on User Mac
→ GitHub Actions has the same packages

file exists in GitHub
→ file exists in Agent Workspace

workflow artifact exists
→ local Mac has it
```

Verify state in the environment where the action will occur.

---

## 4. Prefer the Environment with the Fewest Unnecessary Dependencies

Choose the execution path that:

```text
requires the fewest user actions
uses native credentials for that environment
is reproducible
is least destructive
keeps secrets out of Chat
avoids needless local setup
```

Example:

A repository release should not depend on installing `gh` on the User Mac if GitHub Actions + `GITHUB_TOKEN` can perform it.

A local macOS binary test should not be “validated” only on a Linux runner.

---

## 5. User Mac Is Not a Generic Fallback

Do not send the user to Terminal simply because an Agent-side tool is unavailable.

Use the Mac only when:

```text
the task is inherently local
real Mac hardware/OS state matters
local credential/keychain interaction is required
the user explicitly asks for local execution
no GitHub-native/Agent-native route can satisfy the task
```

---

## 6. GitHub Is Not a Generic Local-Mac Substitute

Do not use GitHub Actions to pretend a Mac-local condition has been verified if the task specifically depends on:

```text
the user's installed binaries
the user's network
the user's Homebrew prefix
the user's keychain
the user's device state
the user's local filesystem
```

A CI success does not prove the User Mac works.

---

## 7. Authentication Rule

Authentication belongs to the environment that consumes it.

Examples:

```text
GitHub Connector auth
→ Connector only

GITHUB_TOKEN
→ GitHub Actions job only

local gh OAuth
→ User Mac only

local Keychain credential
→ User Mac only
```

Never copy credentials between environments as a shortcut.

Never ask the user to paste long-lived secrets into Chat.

---

## 8. Network Rule

Do not assume every environment shares the same reachability.

A destination may be:

```text
reachable directly from User Mac
blocked directly but reachable through DevFix/Snowflake
reachable from GitHub Actions
reachable from Agent Workspace
```

Test the route that matters.

For local Mac network work, follow the separate Mac/DevFix guardrail.

---

## 9. Evidence Before Action

Before destructive or expensive changes, collect enough evidence to answer:

```text
What failed?
Where did it fail?
Which environment failed?
Was it authentication, networking, compatibility, source metadata, build, or permissions?
What evidence supports that classification?
```

Do not reinstall or rewrite infrastructure when the evidence points to a narrower problem.

---

## 10. Retry Policy

Do not repeat an expensive step without changing the hypothesis.

Each retry must answer a specific question.

Examples:

```text
retry with fresh Snowflake session
→ tests stochastic transport/session failure

retry with authoritative direct binary
→ tests Homebrew source-build dependency path

run in GitHub Actions
→ tests whether the failure is local-environment specific
```

Avoid random retry loops.

---

## 11. Preserve Successful Layers

If a lower layer has already been proven working, do not keep reopening it without evidence.

Example:

```text
Homebrew update works
Portable Ruby works
Snowflake route validation works
```

A later FFmpeg formula failure should not automatically trigger a Homebrew reinstall or a new DevFix release.

Build on proven facts.

---

## 12. Source of Truth Hierarchy

For environment state:

```text
actual command output from that environment
> assumption
```

For repository state:

```text
GitHub API / Connector
> local guess
```

For package/release versions:

```text
authoritative upstream source
> stale cached knowledge
```

For local Mac behavior:

```text
real User Mac test
> CI approximation
```

---

## 13. Minimal User Interruption

When user action is required:

```text
give one complete command block when practical
avoid repeating commands already run
state exactly when to wait
state what success looks like
state when not to continue
```

Do not force the user through a long sequence of one-command-at-a-time steps unless the next step genuinely depends on the previous result.

---

## 14. Safety Boundaries

Do not use convenience as a reason to:

```text
disable security protections
expose credentials
force-push
erase working state
delete backups before validation
overwrite a working binary without verification
```

Prefer reversible actions and backups for uncertain repairs.

---

## 15. Before Declaring a Blocker

A blocker must be tied to the correct environment.

Report:

```text
environment
required capability
exact failed operation
exact error
alternatives attempted
why other environments cannot satisfy the task
safe next action
```

Do not call something blocked merely because the first chosen environment lacks a tool.

---

## 16. Final Execution Report

For meaningful technical tasks, report:

```text
Task
Execution environment selected
Why that environment was selected

Tools/connectors used
Authentication mechanism used
Network route used when relevant

What was verified
What remains unverified
Cleanup performed
Any future maintenance/update implications
```

---

## Final Rule

```text
Choose the execution environment before choosing the command.

Do not move a task to the User Mac just because the Agent lacks a tool.

Do not move a local Mac problem to GitHub just because CI is convenient.

Use the environment that actually owns the state, credential, network, or runtime being tested.
```
