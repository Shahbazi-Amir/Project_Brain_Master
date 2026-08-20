import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync("src/server.ts", "utf8");
const loop = readFileSync("src/loop.ts", "utf8");
const runtime = readFileSync("public/runtime-inspector.js", "utf8");
const html = readFileSync("public/index.html", "utf8");

test("project payload exposes execution target problems resources tasks and events", () => {
  assert.match(server, /executionTarget/);
  assert.match(server, /resourceRepositories/);
  assert.match(server, /requiredInputs/);
  assert.match(server, /issues/);
  assert.match(server, /listTasks/);
  assert.match(server, /listEvents/);
});

test("loop emits auditable agent lifecycle events", () => {
  assert.match(loop, /supervisor\.started/);
  assert.match(loop, /supervisor\.decided/);
  assert.match(loop, /executor\.started/);
  assert.match(loop, /executor\.completed/);
  assert.match(loop, /reviewer\.started/);
  assert.match(loop, /reviewer\.completed/);
  assert.match(loop, /run\.error/);
});

test("runtime inspector shows preflight and live log instead of empty execution screen", () => {
  assert.match(runtime, /محل اجرای واقعی/);
  assert.match(runtime, /مشکل \/ توقف فعلی/);
  assert.match(runtime, /مخزن‌های منابع/);
  assert.match(runtime, /لاگ زنده اجرا/);
  assert.match(runtime, /شروع اجرای واقعی/);
  assert.match(html, /runtime-inspector\.js\?v=0\.8\.1/);
  assert.match(html, /runtime-inspector\.css\?v=0\.8\.1/);
});