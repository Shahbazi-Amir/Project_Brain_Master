# Mac / DevFix / Homebrew / CLI Guardrail
## Permanent Agent Constraint — Intel Monterey Package and Developer Tool Operations

Use this guardrail before any local Mac task involving Homebrew, DevFix, curl, Git, GitHub CLI, FFmpeg, FFprobe, Ruby, Python, Node, build tools, package installation, dependency download, or CLI upgrades.

---

## 1. Scope and Target Machine

This project may involve a User Mac with these characteristics:

```text
Intel / x86_64 Mac
macOS Monterey 12
Homebrew under /usr/local
Developer tools may require DevFix/Snowflake for some destinations
```

Treat macOS 12 Homebrew as a compatibility-sensitive environment.

A Homebrew Tier 3 warning is not itself a failure.

Do not automatically:

```text
remove Homebrew
switch to MacPorts
upgrade macOS
reinstall Xcode/CLT
disable security protections
```

because Homebrew reports Monterey/Tier 3.

---

## 2. Separate Local Mac from Other Environments

Never assume the User Mac shares:

```text
credentials
binaries
PATH
files
cache
network route
package state
```

with:

```text
Agent Workspace
GitHub Actions Runner
GitHub Connector/App
```

A local-only problem must be diagnosed on the local Mac.
A repository-only problem should not be pushed onto the local Mac.

---

## 3. Default Homebrew Route

For Homebrew operations on this Mac, prefer:

```bash
devfix brew <command>
```

Examples:

```bash
devfix brew update
devfix brew outdated
devfix brew install <formula>
devfix brew cleanup
devfix brew doctor
```

Use raw `brew` only for a deliberate diagnostic or when explicitly justified.

Do not casually switch between raw Homebrew and DevFix-routed Homebrew without stating why.

---

## 4. Upgrade Policy

Never recommend a blind:

```bash
brew upgrade
```

or:

```bash
devfix brew upgrade
```

before checking:

```bash
devfix brew outdated
```

If no formulae are outdated, there is nothing for a bulk upgrade to do.

Treat:

```text
brew update
```

and:

```text
brew upgrade
```

as different operations.

`update` refreshes Homebrew/tap/API metadata.
`upgrade` upgrades installed Homebrew-managed packages that are outdated.

---

## 5. Diagnose the Failure Domain First

When installation fails, classify it before retrying.

Possible domains:

```text
A. Network / proxy / TLS
B. Snowflake bootstrap
C. Route validation
D. Formula metadata
E. Upstream URL / 404 / 405
F. Source-build requirement
G. macOS/SDK/compiler compatibility
H. Dependency failure
I. Package-manager ownership/link conflict
```

Do not translate every download failure into “the internet is broken.”

Examples:

```text
HTTP 404 from a specific upstream artifact
→ may be a broken/early formula reference

HTTP 405 from a source archive host
→ may be upstream hosting behavior

build failure on Monterey
→ may be Tier 3 source-build incompatibility
```

Retries must test a specific hypothesis.

---

## 6. DevFix / Snowflake Rules

Connect with:

```bash
devfix connect snowflake
```

Treat the connection as successful only after:

```text
Connected with built-in Snowflake.
```

appears and the shell prompt returns.

Do not type another command into the same shell while connection startup is still running.

Disconnect with:

```bash
devfix disconnect
```

Approved routed forms include:

```bash
devfix brew ...
devfix git ...
devfix curl ...
devfix run ...
```

---

## 7. Snowflake Failure Classification

If Snowflake fails below 100%:

```text
bootstrap / transport failure
```

If Tor reaches 100% but developer endpoint validation fails:

```text
route validation failure
```

Do not conflate them.

Snowflake is stochastic. A single bad session is not enough reason to:

```text
reinstall DevFix
create a new DevFix release
change Tor parameters
wipe unrelated system configuration
```

Read the exact stage and logs first.

---

## 8. Tor State / Cache

Persisted Tor state can affect later attempts.

Do not delete it casually.

If fresh-state testing is required:

```text
backup or quarantine existing tor-data
create a fresh state directory
preserve the backup until the new route is verified
```

Only remove backups after successful replacement is confirmed.

---

## 9. Direct vs Homebrew-Managed CLI Tools

Never assume a command in `/usr/local/bin` is Homebrew-managed.

Before installing or upgrading a tool, check:

```bash
which <tool>
<tool> --version
brew list --formula <tool>
brew info <tool>
```

when appropriate.

A tool may have been installed:

```text
by Homebrew
as an official direct binary
from a signed/universal pkg
manually
by another package manager
```

Record ownership.

---

## 10. Known Direct-Install Pattern

Tools such as:

```text
gh
ffmpeg
ffprobe
```

may be intentionally installed directly when current Homebrew formulas require fragile source builds on Intel Monterey.

Do not overwrite a working direct install merely to make package ownership “uniform.”

A direct binary is acceptable when:

```text
source is trusted
architecture is correct
minimum macOS is compatible
checksum/signature is verified when available
runtime functionality is verified
```

---

## 11. Updating Direct-Installed Tools

`brew upgrade` does not update tools Homebrew does not own.

For a direct-installed CLI:

1. Check current path.
2. Check current version.
3. Verify the latest stable release from the authoritative source.
4. Confirm macOS Intel / x86_64 / amd64 compatibility.
5. Verify checksum/signature when available.
6. Download to a temporary location.
7. Validate the download.
8. Replace the binary only after validation.
9. Verify the new version and functionality.
10. Remove temporary files.

Never assume an old download URL or version is still current.

---

## 12. GitHub CLI on the Mac

For repository automation, local `gh` is optional; follow the separate GitHub/CI guardrail.

For genuinely local `gh` usage:

```bash
which gh
gh --version
gh auth status
```

If authentication is missing, authenticate locally through GitHub OAuth/device flow.

Do not ask the user to paste a PAT into Chat.

Do not reinstall `gh` through Homebrew if a valid direct installation already exists.

---

## 13. FFmpeg / FFprobe Validation

A version string alone is useful but not a complete functional test.

After installation or replacement, when relevant perform a real validation:

```text
encode a short test media file
inspect it with ffprobe
confirm expected duration/stream metadata
```

If real encoding and probing pass, treat FFmpeg/FFprobe as functional.

---

## 14. Homebrew Portable Ruby

Do not confuse:

```text
Homebrew Portable Ruby
```

with system Ruby.

If:

```bash
devfix brew config
```

reports a valid Homebrew Ruby and Homebrew commands run successfully, do not reinstall Ruby merely because an unrelated formula fails.

Formula-specific failures must not automatically be blamed on Portable Ruby.

---

## 15. Download Policy

For long or unstable downloads:

```text
use finite retries
record exact HTTP/curl errors
avoid waiting hours for a small file at unusable speed
use HTTP/1.1 when HTTP/2 is demonstrably unstable
compare Direct and DevFix routes when useful
resume/retry only when the mechanism safely supports it
```

Not every destination must go through Snowflake.

If Direct access works reliably for a destination, it may be preferable.

Use Snowflake for destinations that actually need it.

---

## 16. Network Changes

Do not change Wi-Fi, hotspot, ISP, VPN/proxy state, or network route during:

```text
Tor bootstrap
Snowflake connection
large download
package installation
source build fetching dependencies
```

If the network changes and the process fails, treat that run as contaminated by the network transition.

Start a clean attempt before drawing architectural conclusions.

---

## 17. Security Policy

Do not solve package/network issues by weakening system security.

Avoid recommending:

```text
disable SIP
disable Gatekeeper
disable TLS verification
permanent curl -k
chmod 777
hard-coded credentials
unknown scripts piped directly into sudo shell
```

Verify checksums/signatures when available.

Use the least-privilege approach.

---

## 18. Before Installing a New Tool

Before saying:

```bash
brew install X
```

check:

```text
1. Is X already installed?
2. What does `which X` return?
3. What version is installed?
4. Who manages it?
5. Does Homebrew have a compatible bottle for Intel Monterey?
6. Will Homebrew build it from source?
7. Which build dependencies will that introduce?
8. Is an official direct Intel macOS binary available?
9. Which path is lower risk on this machine?
```

Then choose the installation method.

---

## 19. Avoid Retry Loops

Prohibited pattern:

```text
install
→ fail
→ repeat same install
→ fail
→ reinstall package manager
→ fail
→ change random settings
```

Every retry must correspond to a new, explicit hypothesis.

Preserve useful evidence from previous runs.

---

## 20. Cleanup

Homebrew cleanup is allowed when appropriate.

Do not delete direct-installed binaries simply because Homebrew does not own them.

Remove temporary downloads after successful installation.

Keep backups until replacements are verified.

---

## 21. Final Report for Local Tool Work

Report:

```text
Tool
Version
Architecture
Executable path

Installation method:
Homebrew / Direct binary / pkg / other

Package manager ownership
Verification performed

Network route used:
Direct / DevFix Snowflake

How this tool should be updated in the future
```

For failures report:

```text
failed step
exact error
URL/resource
HTTP status when known
failure-domain classification
safe next action
```

---

## Final Rule

```text
“Homebrew is installed”
does not mean
“every tool must be installed by Homebrew.”

“A Homebrew install failed”
does not mean
“DevFix or the internet is broken.”

Identify the failure domain first,
then choose the lowest-risk method compatible with Intel Monterey.
```
