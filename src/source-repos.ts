import { execFile } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { config } from "./config.ts";
import { normalizeGitHubRepository } from "./github-workspace.ts";
import type { ResourceRepository } from "./types.ts";

const execFileAsync = promisify(execFile);

async function run(command: string, args: string[], cwd?: string): Promise<string> {
  try {
    const result = await execFileAsync(command, args, { cwd, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    return String(result.stdout ?? "").trim();
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    throw new Error(String(e.stderr ?? e.stdout ?? e.message ?? error).trim());
  }
}

export function extractGitHubRepositories(values: string[]): string[] {
  const found = new Set<string>();
  for (const raw of values) {
    const value = String(raw || "");
    for (const match of value.matchAll(/https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/gi)) {
      found.add(`${match[1]}/${match[2].replace(/\.git$/i, "")}`);
    }
    const trimmed = value.trim();
    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) found.add(trimmed);
  }
  return [...found];
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) out.push(path);
    }
  }
  return out;
}

function categoriesFor(files: string[]): string[] {
  const categories = new Set<string>();
  const documentExt = new Set([".pdf", ".epub", ".doc", ".docx", ".rtf", ".md", ".txt"]);
  const audioExt = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"]);
  const videoExt = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi"]);
  const dataExt = new Set([".csv", ".json", ".jsonl", ".xlsx", ".xls", ".parquet", ".sqlite", ".db"]);
  const codeExt = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go", ".rs", ".swift", ".kt", ".c", ".cpp", ".h", ".css", ".html"]);
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (documentExt.has(ext)) categories.add("documents");
    else if (audioExt.has(ext)) categories.add("audio");
    else if (videoExt.has(ext)) categories.add("video");
    else if (dataExt.has(ext)) categories.add("data");
    else if (codeExt.has(ext)) categories.add("code");
    else categories.add("other");
  }
  return [...categories];
}

function repoSlug(repository: string): string {
  return repository.replace(/[^A-Za-z0-9_.-]+/g, "--");
}

export async function prepareSourceRepository(projectId: string, input: string): Promise<ResourceRepository> {
  const repository = normalizeGitHubRepository(input);
  await run("gh", ["--version"]);
  await run("gh", ["auth", "status", "--hostname", "github.com"]);
  const infoRaw = await run("gh", ["repo", "view", repository, "--json", "nameWithOwner,defaultBranchRef"]);
  const info = JSON.parse(infoRaw) as { nameWithOwner?: string; defaultBranchRef?: { name?: string } };
  const defaultBranch = info.defaultBranchRef?.name || "main";
  const localPath = join(config.dataDir, "source-repos", projectId, repoSlug(repository));
  if (existsSync(localPath)) rmSync(localPath, { recursive: true, force: true });
  await run("gh", ["repo", "clone", repository, localPath, "--", "--depth", "1"]);
  if (!existsSync(localPath) || !statSync(localPath).isDirectory()) throw new Error(`مخزن منبع Clone نشد: ${repository}`);
  const files = walkFiles(localPath);
  return {
    repository,
    defaultBranch,
    localPath,
    fileCount: files.length,
    categories: categoriesFor(files),
    status: "READY",
    fetchedAt: new Date().toISOString(),
    error: ""
  };
}

export async function prepareSourceRepositories(projectId: string, inputs: string[]): Promise<ResourceRepository[]> {
  const repositories = [...new Set(inputs.map(value => normalizeGitHubRepository(value)))];
  const result: ResourceRepository[] = [];
  for (const repository of repositories) result.push(await prepareSourceRepository(projectId, repository));
  return result;
}

export function sourceRepositoryReference(repo: ResourceRepository): string {
  const categories = repo.categories.length ? repo.categories.join(", ") : "uncategorized";
  return `مخزن منبع ${repo.repository}: ${repo.localPath} | ${repo.fileCount} فایل | دسته‌ها: ${categories}`;
}
