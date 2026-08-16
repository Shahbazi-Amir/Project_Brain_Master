import test from "node:test";
import assert from "node:assert/strict";
import { buildCodexArgs } from "../src/provider.ts";
import type { AgentRunOptions } from "../src/types.ts";

function options(overrides: Partial<AgentRunOptions> = {}): AgentRunOptions {
  return {
    role: "executor",
    prompt: "Do the task",
    cwd: "/tmp/project",
    sandbox: "workspace-write",
    ...overrides
  };
}

test("Codex global approval flag appears before exec", () => {
  const args = buildCodexArgs(options(), "/tmp/out.json", "/tmp/schema.json");
  assert.ok(args.indexOf("--ask-for-approval") >= 0);
  assert.ok(args.indexOf("--ask-for-approval") < args.indexOf("exec"));
  assert.equal(args[args.indexOf("--ask-for-approval") + 1], "never");
  assert.ok(args.indexOf("--sandbox") > args.indexOf("exec"));
  assert.ok(!args.includes("--yolo"));
});

test("Codex live search is passed as a global flag", () => {
  const args = buildCodexArgs(options({ useWebSearch: true }), "/tmp/out.json", "/tmp/schema.json");
  assert.ok(args.indexOf("--search") < args.indexOf("exec"));
});

test("structured runs keep required exec automation flags", () => {
  const args = buildCodexArgs(options({ schema: { type: "object" } }), "/tmp/out.json", "/tmp/schema.json");
  assert.ok(args.includes("--json"));
  assert.deepEqual(args.slice(args.indexOf("--output-last-message"), args.indexOf("--output-last-message") + 2), ["--output-last-message", "/tmp/out.json"]);
  assert.deepEqual(args.slice(args.indexOf("--output-schema"), args.indexOf("--output-schema") + 2), ["--output-schema", "/tmp/schema.json"]);
  assert.ok(args.includes("--skip-git-repo-check"));
});
