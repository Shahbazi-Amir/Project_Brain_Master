import test from "node:test";
import assert from "node:assert/strict";
import { executorPrompt, supervisorPrompt } from "../src/prompts.ts";
import type { ProjectRecord, SupervisorDecision } from "../src/types.ts";

const project = { profile: "coding", workspacePath: "/tmp/example", definition: { name: "Demo", primaryGoal: "Fix bugs", constraints: [], successCriteria: [] } } as unknown as ProjectRecord;

test("supervisor prompt includes active human directive", () => {
  const text = supervisorPrompt(project, [{ id:"1", projectId:"p", text:"Do not change API", active:true, createdAt:"now" }], []);
  assert.match(text, /Do not change API/);
  assert.match(text, /Never lower the acceptance bar/);
});

test("executor prompt carries anti-shortcut constraints", () => {
  const decision = { taskTitle:"Fix", objective:"Fix it", relevantContext:[], constraints:[], mustPreserve:["API"], acceptanceCriteria:["tests pass"], verificationSteps:["run tests"], forbiddenActions:["disable tests"], expectedOutput:"patch" } as SupervisorDecision;
  const text = executorPrompt(project, decision);
  assert.match(text, /disable tests/);
  assert.match(text, /tests pass/);
  assert.match(text, /may not redefine/);
});
