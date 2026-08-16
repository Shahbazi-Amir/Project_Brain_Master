import test from "node:test";
import assert from "node:assert/strict";
import { architectPrompt, executorPrompt, maturationPrompt, supervisorPrompt } from "../src/prompts.ts";
import type { DiscoveryResult, ProjectRecord, SupervisorDecision } from "../src/types.ts";

const project = { profile: "coding", workspacePath: "/tmp/example", definition: { name: "Demo", primaryGoal: "Fix bugs", constraints: [], successCriteria: [] } } as unknown as ProjectRecord;

test("architect framing is adaptive and separates user facts from inference", () => {
  const text = architectPrompt("I want a Persian text that may later become audio", "");
  assert.match(text, /facts\[\]/);
  assert.match(text, /user_explicit/);
  assert.match(text, /Questions must be adaptive/);
  assert.match(text, /voice, likeness, copyrighted material/);
});

test("maturation prompt creates a bounded grounded execution contract", () => {
  const discovery = { suggestedProfile: "general" } as unknown as DiscoveryResult;
  const text = maturationPrompt("demo", discovery, { answer: "x" }, "");
  assert.match(text, /executionContract/);
  assert.match(text, /from 1 to 13/);
  assert.match(text, /Never invent prices/);
  assert.match(text, /risksAndFallbacks/);
});

test("supervisor prompt includes active human directive", () => {
  const text = supervisorPrompt(project, [{ id:"1", projectId:"p", text:"Do not change API", active:true, createdAt:"now" }], []);
  assert.match(text, /Do not change API/);
  assert.match(text, /Never lower the acceptance bar/);
});

test("executor prompt carries anti-shortcut constraints", () => {
  const decision: SupervisorDecision = {
    taskTitle: "Fix",
    objective: "Fix it",
    reasoningSummary: "The failing behavior should be repaired without changing the API.",
    relevantContext: [],
    constraints: [],
    mustPreserve: ["API"],
    acceptanceCriteria: ["tests pass"],
    verificationSteps: ["run tests"],
    forbiddenActions: ["disable tests"],
    expectedOutput: "patch",
    recommendedAction: "EXECUTE",
    userQuestion: ""
  };
  const text = executorPrompt(project, decision);
  assert.match(text, /disable tests/);
  assert.match(text, /tests pass/);
  assert.match(text, /may not redefine/);
});
