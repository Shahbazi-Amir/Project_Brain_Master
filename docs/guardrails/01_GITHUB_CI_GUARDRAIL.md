# GitHub / CI / Repository Guardrail
## Permanent Agent Constraint — Prevent `gh`, Token, Workspace, and GitHub Environment Dead-Ends

Use this guardrail before every GitHub, repository, CI, release, artifact, workflow, commit, push, PR, or GitHub Actions task in this project.

---

## 1. Treat Execution Environments as Independent

Never assume these environments share tools, credentials, files, caches, or authentication:

```text
Agent Workspace
User Mac
GitHub Actions Runner
GitHub Connector / App
```

A fact about one environment proves nothing about another.

Examples:

```text
Local `gh auth status` fails
≠ GitHub Connector has no write access

`gh` is missing from Agent Workspace
≠ GitHub Actions cannot perform the task

User Mac has no PAT
≠ repository write is unavailable
```

Always test the capability of the environment that will actually execute the task.

---

## 2. Default Environment for Repository Work

For tasks involving:

```text
Repository changes
GitHub Actions
CI
Release
Artifacts
Workflow execution
Repository metadata
PR/Issue operations
```

the default execution environment is:

```text
GitHub Connector / App
or
GitHub Actions
```

not the User Mac.

Do not send the user to the Mac for work that can be completed GitHub-native.

---

## 3. Local `gh` Is Optional, Not Architectural

The absence of local `gh` is not a blocker.

The following are not blockers by themselves:

```text
gh is not installed
gh auth status fails
gh has no local credential
PAT is not present in Agent Workspace
User Mac is not logged into gh
```

For repository work, first use:

```text
GitHub Connector / App
→ Repository write
→ GitHub Actions
→ GITHUB_TOKEN
→ GitHub REST API
```

Only use local `gh` when the task is genuinely local-only or when the user explicitly wants a local GitHub CLI workflow.

---

## 4. Local `gh` Authentication Is Separate

GitHub Connector authentication and local `gh` authentication are independent.

Never infer one from the other.

If local `gh` needs authentication:

```text
perform OAuth/device login on the User Mac
store the credential in the local secure credential store
do not extract or copy connector credentials
do not ask the user to paste a PAT into Chat
```

If `gh` is installed directly rather than by Homebrew, do not reinstall it through Homebrew merely to authenticate it.

---

## 5. Required Resolution Order

Before declaring a GitHub task blocked, try the following order.

### A. GitHub Connector / App

Use the Connector first for supported repository read/write operations.

For code, config, workflow, branch, PR, issue, or repository metadata work, local `gh` is not required if the Connector can perform the operation.

### B. Repository Write Capability

Check actual repository permissions rather than local CLI authentication.

### C. GitHub Actions

If the task is better executed inside GitHub infrastructure, create or update a workflow on the allowed branch.

Respect project branch constraints exactly.

Examples:

```text
main only
no new branch
no PR
no force-push
```

must be treated as hard constraints when specified.

### D. Controlled Self-Trigger

If workflow dispatch cannot be invoked from the available tool, use a controlled one-time trigger.

Example:

```yaml
on:
  workflow_dispatch:
  push:
    branches:
      - main
    paths:
      - ".github/bootstrap/<task>.trigger"
```

Then:

```text
commit workflow + marker
→ push
→ workflow runs
→ verify result
→ remove marker
→ remove temporary push trigger or make workflow manual-only
```

Prevent loops.

### E. `GITHUB_TOKEN`

Inside GitHub Actions, prefer:

```text
GITHUB_TOKEN
```

Grant the minimum permissions needed, explicitly.

Example:

```yaml
permissions:
  contents: write
  actions: read
```

Never log the token.

### F. REST API Without `gh`

`gh` is not mandatory inside a runner.

For operations such as:

```text
create release
upload release asset
download asset
query workflow metadata
query release metadata
```

acceptable GitHub-native alternatives include:

```text
GitHub REST API
curl
Python urllib
Python standard-library HTTP
```

### G. Artifact / Release Fallbacks

If the Connector cannot perform an operation such as release-asset upload, move that operation into GitHub Actions rather than stopping the task.

---

## 6. Release Assets

For release and asset operations:

1. Resolve or create the release using GitHub APIs.
2. Upload using `GITHUB_TOKEN`.
3. Record actual size and SHA-256.
4. Make the process idempotent.
5. Reuse an existing asset if the name and checksum match.
6. If the same name exists with different content, fail clearly instead of silently replacing it.
7. Never expose credentials.

---

## 7. Large Artifacts

A large file not being present in Agent Workspace is not automatically a blocker.

If possible, build/download/package/hash/upload inside GitHub Actions.

If platform size limits are hit:

1. capture the exact error;
2. determine the actual platform limit;
3. split deterministically when appropriate;
4. hash each part;
5. include a manifest;
6. verify reconstruction/final SHA where applicable.

Declare blocked only after safe supported alternatives fail.

---

## 8. Secret Policy

Never ask the user to paste any of the following into Chat:

```text
PAT
GITHUB_TOKEN
HF_TOKEN
password
private credential
```

Never hard-code secrets.

Never write secrets into:

```text
logs
artifacts
manifests
workflow output
repository files
```

Prefer scoped GitHub-native credentials such as `GITHUB_TOKEN`.

---

## 9. `gh` on the User Mac

If a local-only task requires `gh`, first check:

```bash
which gh
gh --version
gh auth status
```

If `gh` already exists, do not reinstall it merely because authentication is missing.

If authentication is needed, use GitHub OAuth/device login.

If the Mac uses a network-routing wrapper such as DevFix, local GitHub CLI network operations may be executed through the approved local route.

Local `gh` auth failure does not invalidate Connector or Actions access.

---

## 10. Before Declaring “Blocked”

Before saying a task cannot continue, verify and report what happened with:

```text
A. GitHub Connector/App
B. Repository permission
C. Repository write
D. Commit/update workflow capability
E. Self-trigger through push/marker
F. GitHub Actions
G. GITHUB_TOKEN
H. GitHub REST API
I. Release/artifact alternative
```

If any valid path remains, the task is not blocked.

---

## 11. Real Blockers

Examples of legitimate blockers include:

```text
GitHub explicitly rejects required write permission
Repository settings prohibit the required operation
Branch protection prevents the requested action with no allowed path
License forbids required redistribution
A hard platform limit remains after supported alternatives
Required external source is genuinely unavailable with no allowed fallback
```

When blocked, report:

```text
failed step
exact error
HTTP status if applicable
permission involved
alternatives attempted
why each alternative failed
safe next action
```

---

## 12. Prohibited Dead-End Responses

Do not stop with statements such as:

```text
"gh is not installed, so I cannot continue."

"gh is not authenticated, so validation is impossible."

"The Connector cannot upload the release asset, so the task is blocked."

"The file is not in my workspace, so the task cannot be completed."

"Please install gh on your Mac first."
```

unless all GitHub-native alternatives have actually been exhausted and documented.

---

## 13. Cleanup

Temporary automation infrastructure must be cleaned up after success.

Examples:

```text
remove one-time trigger marker
remove temporary push trigger
remove temporary workflow if no longer needed
retain manual workflow only if it remains useful
avoid repeated paid/expensive runs
```

---

## 14. Final Report for GitHub Tasks

At minimum report:

```text
Repository
Branch
Final SHA

Execution environment used
Connector operations used
GitHub Actions run IDs

Whether local gh was needed: yes/no
If no, what replaced it

GITHUB_TOKEN permissions actually used

Temporary workflows/markers created
Cleanup status

HEAD == origin/<branch> when relevant
Local worktree state when a local checkout was actually used
```

---

## Final Rule

```text
Missing local `gh` is not an architectural blocker.

Local `gh` authentication and GitHub Connector authentication are independent.

As long as repository write and GitHub-native execution paths are available,
do not block a repository task because a local CLI or local credential is missing.
```
