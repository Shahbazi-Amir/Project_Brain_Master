import { resolve } from "node:path";

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  host: process.env.PROJECT_BRAIN_HOST ?? "127.0.0.1",
  port: intEnv("PROJECT_BRAIN_PORT", 3000),
  dataDir: resolve(process.env.PROJECT_BRAIN_DATA_DIR ?? ".project-brain"),
  codexCommand: process.env.PROJECT_BRAIN_CODEX_COMMAND ?? "codex",
  defaultMaxIterations: intEnv("PROJECT_BRAIN_DEFAULT_MAX_ITERATIONS", 8),
  defaultMinQuality: intEnv("PROJECT_BRAIN_DEFAULT_MIN_QUALITY", 90),
  codexTimeoutMs: intEnv("PROJECT_BRAIN_CODEX_TIMEOUT_MS", 30 * 60 * 1000)
};
