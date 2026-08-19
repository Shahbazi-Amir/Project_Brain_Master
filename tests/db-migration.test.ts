import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

test("legacy task table is migrated before stage index is created", () => {
  const dir = mkdtempSync(join(tmpdir(), "project-brain-db-migration-"));
  try {
    const dbPath = join(dir, "project-brain.sqlite");
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    legacy.close();

    const run = spawnSync(process.execPath, [
      "--input-type=module",
      "-e",
      "import('./src/db.ts').then(module => module.closeDatabase())"
    ], {
      cwd: process.cwd(),
      env: { ...process.env, PROJECT_BRAIN_DATA_DIR: dir },
      encoding: "utf8"
    });

    assert.equal(run.status, 0, `db migration failed:\n${run.stdout}\n${run.stderr}`);

    const migrated = new DatabaseSync(dbPath);
    const columns = (migrated.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]).map(row => row.name);
    assert.ok(columns.includes("stage_index"));
    assert.ok(columns.includes("task_index"));
    assert.ok(columns.includes("iteration_id"));
    assert.ok(columns.includes("updated_at"));
    const index = migrated.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tasks_project'").get() as { name?: string } | undefined;
    assert.equal(index?.name, "idx_tasks_project");
    migrated.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
