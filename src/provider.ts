import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { config } from "./config.ts";
import type { AgentRunOptions, AgentRunResult, UsageRecord } from "./types.ts";

interface ProcessResult { code: number | null; stdout: string; stderr: string; durationMs: number; }

function runProcess(command: string, args: string[], cwd: string, signal?: AbortSignal, timeoutMs = config.codexTimeoutMs): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdout = ""; let stderr = ""; let settled = false;
    const finish = (result: ProcessResult) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.on("error", error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", code => finish({ code, stdout, stderr, durationMs: Date.now() - started }));
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    if (signal) {
      if (signal.aborted) child.kill("SIGTERM");
      signal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
    }
  });
}

export function buildCodexArgs(options: AgentRunOptions, outputPath: string, schemaPath: string): string[] {
  // Approval and web-search are global Codex flags. They must appear before the
  // `exec` subcommand in current Codex CLI releases (including 0.147.x).
  const args = ["--ask-for-approval", "never"];
  if (options.useWebSearch) args.push("--search");

  args.push(
    "exec",
    "--json",
    "--sandbox", options.sandbox,
    "--output-last-message", outputPath
  );
  if (options.schema) args.push("--output-schema", schemaPath);
  args.push("--skip-git-repo-check", options.prompt);
  return args;
}

export interface CodexHealth {
  available: boolean;
  authenticated: boolean;
  compatible: boolean;
  version: string;
  authStatus: string;
  error: string;
}

export class CodexProvider {
  async health(): Promise<CodexHealth> {
    try {
      const version = await runProcess(config.codexCommand, ["--version"], process.cwd(), undefined, 10_000);
      if (version.code !== 0) return { available: false, authenticated: false, compatible: false, version: "", authStatus: "", error: version.stderr.trim() || "Codex CLI unavailable" };

      const [auth, globalHelp, execHelp] = await Promise.all([
        runProcess(config.codexCommand, ["login", "status"], process.cwd(), undefined, 10_000),
        runProcess(config.codexCommand, ["--help"], process.cwd(), undefined, 10_000),
        runProcess(config.codexCommand, ["exec", "--help"], process.cwd(), undefined, 10_000)
      ]);
      const globalText = `${globalHelp.stdout}\n${globalHelp.stderr}`;
      const execText = `${execHelp.stdout}\n${execHelp.stderr}`;
      const compatible = globalHelp.code === 0 && execHelp.code === 0
        && globalText.includes("--ask-for-approval")
        && execText.includes("--json")
        && execText.includes("--sandbox")
        && execText.includes("--output-last-message")
        && execText.includes("--output-schema");
      const error = !compatible
        ? "Installed Codex CLI is missing required automation flags"
        : auth.code === 0 ? "" : (auth.stderr.trim() || auth.stdout.trim() || "Codex is not logged in");

      return {
        available: true,
        authenticated: auth.code === 0,
        compatible,
        version: version.stdout.trim() || version.stderr.trim(),
        authStatus: auth.stdout.trim() || auth.stderr.trim(),
        error
      };
    } catch (error) {
      return { available: false, authenticated: false, compatible: false, version: "", authStatus: "", error: error instanceof Error ? error.message : String(error) };
    }
  }

  async run<T = unknown>(options: AgentRunOptions): Promise<AgentRunResult<T>> {
    mkdirSync(join(config.dataDir, "tmp"), { recursive: true });
    const id = crypto.randomUUID();
    const outputPath = join(config.dataDir, "tmp", `${id}.out.json`);
    const schemaPath = join(config.dataDir, "tmp", `${id}.schema.json`);
    if (options.schema) writeFileSync(schemaPath, JSON.stringify(options.schema), "utf8");
    const args = buildCodexArgs(options, outputPath, schemaPath);

    try {
      const result = await runProcess(config.codexCommand, args, options.cwd, options.signal);
      const events = result.stdout.split(/\r?\n/).filter(Boolean).flatMap(line => { try { return [JSON.parse(line) as Record<string, unknown>]; } catch { return []; } });
      const thread = events.find(e => e.type === "thread.started");
      const completed = [...events].reverse().find(e => e.type === "turn.completed");
      const rawUsage = (completed?.usage ?? {}) as Record<string, unknown>;
      const usage: UsageRecord = {
        provider: "codex-cli", model: "account-default",
        inputTokens: Number(rawUsage.input_tokens ?? 0), cachedInputTokens: Number(rawUsage.cached_input_tokens ?? 0),
        outputTokens: Number(rawUsage.output_tokens ?? 0), durationMs: result.durationMs
      };
      if (result.code !== 0) throw new Error(`Codex failed (${result.code}): ${result.stderr.trim().slice(-4000)}`);
      const text = readFileSync(outputPath, "utf8").trim();
      let structured: T | null = null;
      if (options.schema) {
        try { structured = JSON.parse(text) as T; } catch { throw new Error(`Codex returned invalid structured output: ${text.slice(0, 1000)}`); }
      }
      return { text, structured, threadId: String(thread?.thread_id ?? ""), usage };
    } finally {
      rmSync(outputPath, { force: true });
      rmSync(schemaPath, { force: true });
    }
  }
}

export const codexProvider = new CodexProvider();
