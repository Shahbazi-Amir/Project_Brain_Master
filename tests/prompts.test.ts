import test from "node:test";
import assert from "node:assert/strict";
import { architectPrompt, executorPrompt, maturationPrompt, supervisorPrompt } from "../src/prompts.ts";
import type { DiscoveryResult, ProjectRecord, SupervisorDecision } from "../src/types.ts";

const project = {
  profile: "coding",
  workspacePath: "/tmp/example",
  definition: {
    name: "Demo",
    primaryGoal: "Fix bugs",
    constraints: [],
    successCriteria: [],
    resourceReferences: ["/tmp/input.txt"]
  }
} as unknown as ProjectRecord;

test("architect framing is adaptive, multi-select friendly and non-legal by default", () => {
  const text = architectPrompt("I want a Persian text that may later become audio", "");
  assert.match(text, /facts\[\]/);
  assert.match(text, /user_explicit/);
  assert.match(text, /Questions must be adaptive/);
  assert.match(text, /Prefer selectionMode=multiple/);
  assert.match(text, /Keep default discovery strictly operational/);
});

test("maturation prompt creates engineering execution metadata without stale decisions", () => {
  const discovery = { suggestedProfile: "general" } as unknown as DiscoveryResult;
  const text = maturationPrompt("demo", discovery, { answer: "x" }, "");
  assert.match(text, /estimatedIterations/);
  assert.match(text, /workspacePlan/);
  assert.match(text, /monitoringPlan/);
  assert.match(text, /executionBrief/);
  assert.match(text, /never invent a price/);
  assert.match(text, /Do not resurrect a decision/);
});

test("supervisor prompt includes active human directive and supplied resources", () => {
  const text = supervisorPrompt(project, [{ id:"1", projectId:"p", text:"Do not change API", active:true, createdAt:"now" }], []);
  assert.match(text, /Do not change API/);
  assert.match(text, /\/tmp\/input\.txt/);
  assert.match(text, /Never lower the acceptance bar/);
});

test("executor prompt carries anti-shortcut constraints and resources", () => {
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
  assert.match(text, /\/tmp\/input\.txt/);
  assert.match(text, /may not redefine/);
});
