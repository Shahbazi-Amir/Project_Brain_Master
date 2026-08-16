import test from "node:test";
import assert from "node:assert/strict";
import { decideAfterReview, nextStagnantCount } from "../src/policy.ts";
import type { ProjectRecord, ReviewResult } from "../src/types.ts";

const project = { minQualityScore: 90, maxIterations: 8, maxStagnantIterations: 3 } as ProjectRecord;
const review = { score: 92, status: "PASS", projectComplete: false, requiresHumanDecision: false } as ReviewResult;

test("complete requires whole-project completion and quality", () => {
  assert.equal(decideAfterReview(project, { ...review, projectComplete: true }, 2, 0), "PROJECT_COMPLETE");
  assert.equal(decideAfterReview(project, review, 2, 0), "CONTINUE");
});

test("human decisions stop the loop", () => {
  assert.equal(decideAfterReview(project, { ...review, requiresHumanDecision: true }, 2, 0), "NEEDS_HUMAN");
});

test("stagnation and max iteration stop conditions", () => {
  assert.equal(decideAfterReview(project, review, 3, 3), "NO_PROGRESS");
  assert.equal(decideAfterReview(project, review, 8, 0), "MAX_ITERATIONS");
});

test("stagnation counter resets on meaningful improvement", () => {
  assert.equal(nextStagnantCount(80, 82, 1), 2);
  assert.equal(nextStagnantCount(80, 86, 2), 0);
});
