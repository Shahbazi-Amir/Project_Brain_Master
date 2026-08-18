import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { maturationSchema } from "../src/schemas.ts";

const dashboard = readFileSync("public/execution-dashboard.js", "utf8");
const html = readFileSync("public/index.html", "utf8");

test("execution stages carry countable tasks and per-stage time", () => {
  const stage = maturationSchema.properties.executionStages.items;
  assert.ok("tasks" in stage.properties);
  assert.ok("estimatedTime" in stage.properties);
  assert.equal(stage.properties.tasks.minItems, 1);
  assert.ok("executionStages" in maturationSchema.properties.finalDefinition.properties);
});

test("execution dashboard shows stages, tasks, goal, time and progress", () => {
  assert.match(dashboard, /تعداد فازها/);
  assert.match(dashboard, /کل کارها/);
  assert.match(dashboard, /هدف دقیق/);
  assert.match(dashboard, /زمان این فاز/);
  assert.match(dashboard, /کار فعلی/);
  assert.match(dashboard, /پیشرفت کل/);
  assert.match(dashboard, /passedCount/);
});

test("execution dashboard assets are loaded by the main UI", () => {
  assert.match(html, /execution-dashboard\.css\?v=0\.7\.0/);
  assert.match(html, /execution-dashboard\.js\?v=0\.7\.0/);
});