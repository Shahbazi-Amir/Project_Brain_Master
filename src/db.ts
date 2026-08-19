import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";
import type { DirectiveRecord, ExecutionStage, IterationRecord, ProjectDefinition, ProjectEvent, ProjectRecord, ReviewResult, SupervisorDecision, TaskRecord, TaskStatus, UsageRecord } from "./types.ts";

mkdirSync(config.dataDir, { recursive: true });
const db = new DatabaseSync(join(config.dataDir, "project-brain.sqlite"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, profile TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL,
  definition_json TEXT NOT NULL, workspace_path TEXT NOT NULL, executor_mode TEXT NOT NULL,
  min_quality_score INTEGER NOT NULL, max_iterations INTEGER NOT NULL, max_stagnant_iterations INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
  stage_index INTEGER NOT NULL DEFAULT 0, task_index INTEGER NOT NULL DEFAULT 0, iteration_id TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS iterations (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, number INTEGER NOT NULL, status TEXT NOT NULL, supervisor_json TEXT,
  execution_prompt TEXT NOT NULL DEFAULT '', executor_result TEXT NOT NULL DEFAULT '', reviewer_json TEXT,
  decision TEXT NOT NULL DEFAULT '', thread_id TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, completed_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, iteration_id TEXT, role TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS prompts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, iteration_id TEXT, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS results (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, iteration_id TEXT, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, iteration_id TEXT NOT NULL, score INTEGER NOT NULL, content_json TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS directives (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, text TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, event_type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS usage (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, iteration_id TEXT, role TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL, cached_input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, duration_ms INTEGER NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_iterations_project ON iterations(project_id, number);
CREATE INDEX IF NOT EXISTS idx_directives_project ON directives(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, stage_index, task_index);
`);

const taskColumns = new Set((db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]).map(row => row.name));
if (!taskColumns.has("stage_index")) db.exec("ALTER TABLE tasks ADD COLUMN stage_index INTEGER NOT NULL DEFAULT 0;");
if (!taskColumns.has("task_index")) db.exec("ALTER TABLE tasks ADD COLUMN task_index INTEGER NOT NULL DEFAULT 0;");
if (!taskColumns.has("iteration_id")) db.exec("ALTER TABLE tasks ADD COLUMN iteration_id TEXT NOT NULL DEFAULT '';");
if (!taskColumns.has("updated_at")) db.exec("ALTER TABLE tasks ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';");

db.exec("UPDATE projects SET max_iterations = 13 WHERE max_iterations <> 13;");

function parseProject(row: Record<string, unknown>): ProjectRecord {
  return {
    id: String(row.id), name: String(row.name), profile: row.profile as ProjectRecord["profile"], description: String(row.description), status: row.status as ProjectRecord["status"],
    definition: JSON.parse(String(row.definition_json)) as ProjectRecord["definition"], workspacePath: String(row.workspace_path), executorMode: row.executor_mode as ProjectRecord["executorMode"],
    minQualityScore: Number(row.min_quality_score), maxIterations: Number(row.max_iterations), maxStagnantIterations: Number(row.max_stagnant_iterations),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}
function parseIteration(row: Record<string, unknown>): IterationRecord {
  return {
    id: String(row.id), projectId: String(row.project_id), number: Number(row.number), status: row.status as IterationRecord["status"],
    supervisor: row.supervisor_json ? JSON.parse(String(row.supervisor_json)) as SupervisorDecision : null,
    executionPrompt: String(row.execution_prompt ?? ""), executorResult: String(row.executor_result ?? ""),
    reviewer: row.reviewer_json ? JSON.parse(String(row.reviewer_json)) as ReviewResult : null,
    decision: String(row.decision ?? ""), threadId: String(row.thread_id ?? ""), startedAt: String(row.started_at), completedAt: String(row.completed_at ?? "")
  };
}
function parseTask(row: Record<string, unknown>): TaskRecord {
  return {
    id: String(row.id), projectId: String(row.project_id), stageIndex: Number(row.stage_index ?? 0), taskIndex: Number(row.task_index ?? 0),
    title: String(row.title), status: row.status as TaskStatus, iterationId: String(row.iteration_id ?? ""),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at || row.created_at)
  };
}
function parseEvent(row: Record<string, unknown>): ProjectEvent {
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(String(row.payload_json || "{}")) as Record<string, unknown>; } catch {}
  return { id: String(row.id), projectId: String(row.project_id), eventType: String(row.event_type), payload, createdAt: String(row.created_at) };
}

export function insertProject(project: ProjectRecord): void {
  db.prepare(`INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(project.id, project.name, project.profile, project.description, project.status, JSON.stringify(project.definition), project.workspacePath,
      project.executorMode, project.minQualityScore, project.maxIterations, project.maxStagnantIterations, project.createdAt, project.updatedAt);
}
export function listProjects(): ProjectRecord[] { return (db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as Record<string, unknown>[]).map(parseProject); }
export function getProject(id: string): ProjectRecord | null { const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, unknown> | undefined; return row ? parseProject(row) : null; }
export function setProjectStatus(id: string, status: ProjectRecord["status"]): void { db.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?").run(status, new Date().toISOString(), id); }
export function updateProjectDefinition(id: string, definition: ProjectDefinition): void { db.prepare("UPDATE projects SET definition_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(definition), new Date().toISOString(), id); }
export function updateProjectWorkspace(id: string, workspacePath: string): void { db.prepare("UPDATE projects SET workspace_path = ?, updated_at = ? WHERE id = ?").run(workspacePath, new Date().toISOString(), id); }
export function addDirective(record: DirectiveRecord): void { db.prepare("INSERT INTO directives (id, project_id, text, active, created_at) VALUES (?, ?, ?, ?, ?)").run(record.id, record.projectId, record.text, record.active ? 1 : 0, record.createdAt); }
export function listDirectives(projectId: string): DirectiveRecord[] {
  return (db.prepare("SELECT * FROM directives WHERE project_id = ? AND active = 1 ORDER BY created_at ASC").all(projectId) as Record<string, unknown>[])
    .map(row => ({ id: String(row.id), projectId: String(row.project_id), text: String(row.text), active: Boolean(row.active), createdAt: String(row.created_at) }));
}

export function initializeProjectTasks(projectId: string, stages: ExecutionStage[]): void {
  const now = new Date().toISOString();
  db.prepare("DELETE FROM tasks WHERE project_id = ?").run(projectId);
  const insert = db.prepare("INSERT INTO tasks (id, project_id, title, status, created_at, stage_index, task_index, iteration_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  stages.forEach((stage, stageIndex) => (stage.tasks || []).forEach((title, taskIndex) => insert.run(crypto.randomUUID(), projectId, title, "PENDING", now, stageIndex, taskIndex, "", now)));
}
export function listTasks(projectId: string): TaskRecord[] {
  return (db.prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY stage_index ASC, task_index ASC").all(projectId) as Record<string, unknown>[]).map(parseTask);
}
export function claimNextTask(projectId: string, iterationId: string): TaskRecord | null {
  const row = db.prepare("SELECT * FROM tasks WHERE project_id = ? AND status IN ('RUNNING','ATTENTION','WAITING','PAUSED','PENDING') ORDER BY CASE status WHEN 'RUNNING' THEN 0 WHEN 'ATTENTION' THEN 1 WHEN 'WAITING' THEN 2 WHEN 'PAUSED' THEN 3 ELSE 4 END, stage_index ASC, task_index ASC LIMIT 1").get(projectId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const task = parseTask(row);
  const now = new Date().toISOString();
  db.prepare("UPDATE tasks SET status='RUNNING', iteration_id=?, updated_at=? WHERE id=?").run(iterationId, now, task.id);
  return { ...task, status: "RUNNING", iterationId, updatedAt: now };
}
export function setTaskStatus(id: string, status: TaskStatus): void { db.prepare("UPDATE tasks SET status=?, updated_at=? WHERE id=?").run(status, new Date().toISOString(), id); }
export function markNextTaskWaiting(projectId: string): TaskRecord | null {
  const row = db.prepare("SELECT * FROM tasks WHERE project_id = ? AND status IN ('PENDING','ATTENTION','PAUSED') ORDER BY stage_index ASC, task_index ASC LIMIT 1").get(projectId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const task = parseTask(row); setTaskStatus(task.id, "WAITING"); return { ...task, status: "WAITING" };
}
export function markRunningTasks(projectId: string, status: Extract<TaskStatus, "PAUSED" | "WAITING" | "ATTENTION">): void {
  db.prepare("UPDATE tasks SET status=?, updated_at=? WHERE project_id=? AND status='RUNNING'").run(status, new Date().toISOString(), projectId);
}

export function nextIterationNumber(projectId: string): number { const row = db.prepare("SELECT COALESCE(MAX(number), 0) AS n FROM iterations WHERE project_id = ?").get(projectId) as { n: number }; return Number(row.n) + 1; }
export function insertIteration(iteration: IterationRecord): void {
  db.prepare(`INSERT INTO iterations (id, project_id, number, status, supervisor_json, execution_prompt, executor_result, reviewer_json, decision, thread_id, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(iteration.id, iteration.projectId, iteration.number, iteration.status, iteration.supervisor ? JSON.stringify(iteration.supervisor) : null, iteration.executionPrompt,
      iteration.executorResult, iteration.reviewer ? JSON.stringify(iteration.reviewer) : null, iteration.decision, iteration.threadId, iteration.startedAt, iteration.completedAt);
}
export function updateIteration(id: string, patch: Partial<IterationRecord>): void {
  const currentRow = db.prepare("SELECT * FROM iterations WHERE id = ?").get(id) as Record<string, unknown> | undefined; if (!currentRow) throw new Error(`Iteration not found: ${id}`);
  const next = { ...parseIteration(currentRow), ...patch };
  db.prepare(`UPDATE iterations SET status=?, supervisor_json=?, execution_prompt=?, executor_result=?, reviewer_json=?, decision=?, thread_id=?, completed_at=? WHERE id=?`)
    .run(next.status, next.supervisor ? JSON.stringify(next.supervisor) : null, next.executionPrompt, next.executorResult, next.reviewer ? JSON.stringify(next.reviewer) : null, next.decision, next.threadId, next.completedAt, id);
}
export function listIterations(projectId: string, limit = 50): IterationRecord[] { return (db.prepare("SELECT * FROM iterations WHERE project_id = ? ORDER BY number DESC LIMIT ?").all(projectId, limit) as Record<string, unknown>[]).map(parseIteration); }
export function latestAwaitingManual(projectId: string): IterationRecord | null { const row = db.prepare("SELECT * FROM iterations WHERE project_id=? AND status='AWAITING_MANUAL_RESULT' ORDER BY number DESC LIMIT 1").get(projectId) as Record<string, unknown> | undefined; return row ? parseIteration(row) : null; }

export function addEvent(projectId: string, eventType: string, payload: unknown): void { db.prepare("INSERT INTO events VALUES (?, ?, ?, ?, ?)").run(crypto.randomUUID(), projectId, eventType, JSON.stringify(payload ?? {}), new Date().toISOString()); }
export function listEvents(projectId: string, limit = 80): ProjectEvent[] { return (db.prepare("SELECT * FROM events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?").all(projectId, limit) as Record<string, unknown>[]).map(parseEvent); }
export function addUsage(projectId: string, iterationId: string | null, role: string, usage: UsageRecord): void {
  db.prepare("INSERT INTO usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(crypto.randomUUID(), projectId, iterationId, role, usage.provider, usage.model, usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, usage.durationMs, new Date().toISOString());
}
export function closeDatabase(): void { db.close(); }
