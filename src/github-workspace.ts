import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { config } from "./config.ts";
import { updateProjectDefinition } from "./db.ts";
import type { GitHubIntegration, IterationRecord, ProjectRecord } from "./types.ts";

const execFileAsync = promisify(execFile);
const protectedBranches = new Set(["main", "master", "trunk", "production", "prod"]);
const disabledPushUrl = "file:///dev/null/project-brain-push-disabled";
const blockedPathPatterns = [
  /(^|\/)\.env($|\.)/i,
  /(^|\/)(credentials?|secrets?)(\.|\/|$)/i,
  /\.(pem|key|p12|pfx)$/i,
  /(^|\/)\.project-brain(\/|$)/i,
  /(^|\/)\.git(\/|$)/i
];
const suspiciousDiffPatterns = [
  /github_pat_[A-Za-z0-9_]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /sk-[A-Za-z0-9_-]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:GITHUB_TOKEN|OPENAI_API_KEY|HF_TOKEN)\s*[=:]\s*[^\s"']+/i
];

interface CommandResult { stdout: string; stderr: string; }

async function run(command: string, args: string[], cwd?: string, allowFailure = false): Promise<CommandResult & { ok: boolean }> {
  try {
    const result = await execFileAsync(command, args, { cwd, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    return { stdout: String(result.stdout ?? "").trim(), stderr: String(result.stderr ?? "").trim(), ok: true };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    const result = { stdout: String(e.stdout ?? "").trim(), stderr: String(e.stderr ?? e.message ?? "").trim(), ok: false };
    if (allowFailure) return result;
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout || "unknown error"}`);
  }
}

export function normalizeGitHubRepository(value: string): string {
  let clean = String(value || "").trim();
  clean = clean.replace(/^https?:\/\/github\.com\//i, "").replace(/^git@github\.com:/i, "").replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(clean)) throw new Error("مخزن GitHub باید به شکل owner/repo یا لینک github.com/owner/repo باشد");
  return clean;
}

function slug(value: string): string {
  return String(value || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "project";
}

export function makeBrainBranch(projectId: string, projectName: string): string {
  return `brain/${projectId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}-${slug(projectName)}`;
}

export function assertSafeBranch(branch: string): void {
  const clean = String(branch || "").trim();
  if (!clean.startsWith("brain/") || protectedBranches.has(clean.toLowerCase())) throw new Error(`شاخه ناامن است: ${clean || "(empty)"}`);
}

export function assertSafeChangedPaths(paths: string[]): void {
  for (const raw of paths) {
    const path = raw.includes(" -> ") ? raw.split(" -> ").pop() || raw : raw;
    if (blockedPathPatterns.some(pattern => pattern.test(path))) throw new Error(`فایل حساس اجازه Commit/Push ندارد: ${path}`);
  }
}

export function assertNoSuspiciousSecrets(diff: string): void {
  if (suspiciousDiffPatterns.some(pattern => pattern.test(diff))) throw new Error("الگوی مشکوک به Secret در تغییرات دیده شد؛ Push متوقف شد");
}

function statusPaths(status: string): string[] {
  return status.split("\n").map(line => line.slice(3).trim()).filter(Boolean);
}

async function assertRuntimeReady(): Promise<void> {
  await run("git", ["--version"]);
  await run("gh", ["--version"]);
  const auth = await run("gh", ["auth", "status", "--hostname", "github.com"], undefined, true);
  if (!auth.ok) throw new Error("GitHub CLI روی مک وارد نشده است؛ یک‌بار gh auth login را روی همان مک انجام بده");
}

function installProtectedPushGuard(workspace: string): void {
  const hookPath = join(workspace, ".git", "hooks", "pre-push");
  const hook = `#!/bin/sh
while read local_ref local_sha remote_ref remote_sha; do
  case "$remote_ref" in
    refs/heads/brain/*) ;;
    *) echo "Project Brain safety: push to $remote_ref is blocked" >&2; exit 1 ;;
  esac
done
exit 0
`;
  writeFileSync(hookPath, hook, "utf8");
  chmodSync(hookPath, 0o700);
}

async function disableExecutorPush(workspace: string): Promise<void> {
  await run("git", ["-C", workspace, "config", "remote.origin.pushurl", disabledPushUrl]);
}

async function assertWorkspaceIdentity(workspace: string, integration: GitHubIntegration): Promise<void> {
  assertSafeBranch(integration.workBranch);
  const currentBranch = await run("git", ["-C", workspace, "branch", "--show-current"]);
  if (currentBranch.stdout !== integration.workBranch) throw new Error(`Brain روی شاخه مورد انتظار نیست: ${currentBranch.stdout}`);
  const origin = await run("git", ["-C", workspace, "remote", "get-url", "origin"]);
  const normalizedOrigin = normalizeGitHubRepository(origin.stdout);
  if (normalizedOrigin.toLowerCase() !== integration.repository.toLowerCase()) throw new Error("origin این Workspace با مخزن تأییدشده یکی نیست");
  const pushUrl = await run("git", ["-C", workspace, "config", "--get", "remote.origin.pushurl"], undefined, true);
  if (!pushUrl.ok || pushUrl.stdout !== disabledPushUrl) throw new Error("محافظ Push Workspace تغییر کرده است؛ تحویل متوقف شد");
}

export async function prepareGitHubWorkspace(projectId: string, projectName: string, repositoryInput: string): Promise<{ workspacePath: string; integration: GitHubIntegration }> {
  await assertRuntimeReady();
  const repository = normalizeGitHubRepository(repositoryInput);
  const repoInfo = await run("gh", ["repo", "view", repository, "--json", "nameWithOwner,defaultBranchRef"]);
  const parsed = JSON.parse(repoInfo.stdout) as { nameWithOwner: string; defaultBranchRef?: { name?: string } };
  const baseBranch = parsed.defaultBranchRef?.name || "main";
  const workBranch = makeBrainBranch(projectId, projectName);
  assertSafeBranch(workBranch);

  const workspacePath = join(config.dataDir, "github-workspaces", projectId);
  mkdirSync(dirname(workspacePath), { recursive: true });
  await run("gh", ["repo", "clone", repository, workspacePath]);
  const clean = await run("git", ["-C", workspacePath, "status", "--porcelain=v1"]);
  if (clean.stdout) throw new Error("Clone اولیه تمیز نیست؛ Brain اجرا را شروع نکرد");
  await run("git", ["-C", workspacePath, "switch", "-c", workBranch, `origin/${baseBranch}`]);

  const user = await run("gh", ["api", "user"]);
  const identity = JSON.parse(user.stdout) as { login?: string; id?: number };
  const login = identity.login || "project-brain";
  const email = identity.id ? `${identity.id}+${login}@users.noreply.github.com` : `${login}@users.noreply.github.com`;
  await run("git", ["-C", workspacePath, "config", "user.name", login]);
  await run("git", ["-C", workspacePath, "config", "user.email", email]);
  installProtectedPushGuard(workspacePath);
  await disableExecutorPush(workspacePath);

  return {
    workspacePath,
    integration: { repository, baseBranch, workBranch, status: "READY", draftPrUrl: "", lastPushedCommit: "", lastPushAt: "" }
  };
}

function persistIntegration(project: ProjectRecord, patch: Partial<GitHubIntegration>): GitHubIntegration {
  const current = project.definition.githubIntegration;
  if (!current) throw new Error("GitHub integration is not configured");
  const next = { ...current, ...patch };
  project.definition.githubIntegration = next;
  updateProjectDefinition(project.id, project.definition);
  return next;
}

export async function checkpointGitHub(project: ProjectRecord, iteration: IterationRecord): Promise<void> {
  const integration = project.definition.githubIntegration;
  if (!integration) return;
  await assertRuntimeReady();
  await assertWorkspaceIdentity(project.workspacePath, integration);
  const status = await run("git", ["-C", project.workspacePath, "status", "--porcelain=v1"]);
  if (!status.stdout) return;
  assertSafeChangedPaths(statusPaths(status.stdout));
  await run("git", ["-C", project.workspacePath, "add", "-A"]);
  const staged = await run("git", ["-C", project.workspacePath, "diff", "--cached", "--no-ext-diff"]);
  assertNoSuspiciousSecrets(staged.stdout);
  const task = iteration.supervisor?.taskTitle?.replace(/[\r\n]+/g, " ").slice(0, 72) || `iteration ${iteration.number}`;
  await run("git", ["-C", project.workspacePath, "commit", "-m", `brain: checkpoint ${iteration.number} - ${task}`]);
  const head = await run("git", ["-C", project.workspacePath, "rev-parse", "HEAD"]);
  const origin = await run("git", ["-C", project.workspacePath, "remote", "get-url", "origin"]);
  await run("git", ["-C", project.workspacePath, "config", "remote.origin.pushurl", origin.stdout]);
  try {
    await run("git", ["-C", project.workspacePath, "push", "--set-upstream", "origin", integration.workBranch]);
  } finally {
    await disableExecutorPush(project.workspacePath);
  }
  persistIntegration(project, { status: "PUSHED", lastPushedCommit: head.stdout, lastPushAt: new Date().toISOString() });
}

export async function ensureDraftPullRequest(project: ProjectRecord): Promise<string> {
  const integration = project.definition.githubIntegration;
  if (!integration) return "";
  await assertRuntimeReady();
  await assertWorkspaceIdentity(project.workspacePath, integration);
  const dirty = await run("git", ["-C", project.workspacePath, "status", "--porcelain=v1"]);
  if (dirty.stdout) throw new Error("تغییر تأییدنشده در Workspace باقی مانده؛ Draft PR ساخته نشد");

  const ahead = await run("git", ["-C", project.workspacePath, "rev-list", "--count", `origin/${integration.baseBranch}..HEAD`]);
  if (Number(ahead.stdout || 0) < 1) return "";
  const existing = await run("gh", ["pr", "view", integration.workBranch, "--repo", integration.repository, "--json", "url,state,isDraft"], undefined, true);
  let url = "";
  if (existing.ok && existing.stdout) {
    url = String((JSON.parse(existing.stdout) as { url?: string }).url || "");
  } else {
    const body = [
      "Created by Project Brain after reviewed execution checkpoints.",
      "",
      `Project: ${project.name}`,
      `Base: ${integration.baseBranch}`,
      `Branch: ${integration.workBranch}`,
      "",
      "Safety: no automatic merge, no force-push, and commits are created only after Reviewer PASS checkpoints."
    ].join("\n");
    const created = await run("gh", ["pr", "create", "--repo", integration.repository, "--base", integration.baseBranch, "--head", integration.workBranch, "--draft", "--title", `Project Brain: ${project.name}`, "--body", body]);
    url = created.stdout.split("\n").find(line => line.includes("github.com") && line.includes("/pull/")) || created.stdout;
  }
  persistIntegration(project, { status: "PR_OPEN", draftPrUrl: url });
  return url;
}
