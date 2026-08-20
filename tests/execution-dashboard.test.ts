import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { maturationSchema } from "../src/schemas.ts";

const dashboard = readFileSync("public/execution-dashboard.js", "utf8");
const html = readFileSync("public/index.html", "utf8");
const server = readFileSync("src/server.ts", "utf8");
const db = readFileSync("src/db.ts", "utf8");

test("execution stages carry countable tasks and per-stage time", () => {
  const stage = maturationSchema.properties.executionStages.items;
  assert.ok("tasks" in stage.properties);
  assert.ok("estimatedTime" in stage.properties);
  assert.equal(stage.properties.tasks.minItems, 1);
  assert.ok("executionStages" in maturationSchema.properties.finalDefinition.properties);
  assert.match(server, /finalDefinition\.executionStages = run\.structured\.executionStages/);
});

test("execution dashboard uses persisted task states and compact stage checklist", () => {
  assert.match(dashboard, /payload\.tasks/);
  assert.match(dashboard, /مرحله \$\{stageIndex \+ 1\} از \$\{stages\.length\}/);
  assert.match(dashboard, /کار فعلی/);
  assert.match(dashboard, /پیشرفت واقعی/);
  assert.match(dashboard, /TASK_LABELS/);
  assert.match(dashboard, /جزئیات این مرحله/);
  assert.match(db, /initializeProjectTasks/);
  assert.match(db, /claimNextTask/);
  assert.match(db, /setTaskStatus/);
});

test("execution dashboard assets are loaded by the main UI", () => {
  assert.match(html, /execution-dashboard\.css\?v=0\.8\.1/);
  assert.match(html, /execution-dashboard\.js\?v=0\.8\.1/);
});