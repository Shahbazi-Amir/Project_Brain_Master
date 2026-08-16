import test from "node:test";
import assert from "node:assert/strict";
import { discoverySchema, maturationSchema, reviewerSchema, supervisorSchema } from "../src/schemas.ts";

test("structured schemas forbid undeclared top-level properties", () => {
  assert.equal(discoverySchema.additionalProperties, false);
  assert.equal(maturationSchema.additionalProperties, false);
  assert.equal(supervisorSchema.additionalProperties, false);
  assert.equal(reviewerSchema.additionalProperties, false);
});

test("discovery carries editable facts and option based questions", () => {
  assert.ok("facts" in discoverySchema.properties);
  assert.ok("questions" in discoverySchema.properties);
  const question = discoverySchema.properties.questions.items;
  assert.ok("options" in question.properties);
  assert.ok("selectedOptionIds" in question.properties);
  assert.ok("selectionMode" in question.properties);
});

test("maturation carries bounded execution contract", () => {
  assert.ok("executionContract" in maturationSchema.properties);
  const contract = maturationSchema.properties.executionContract;
  assert.equal(contract.properties.estimatedIterations.maximum, 13);
  assert.ok("risksAndFallbacks" in contract.properties);
  assert.ok("rightsAndPermissionChecks" in contract.properties);
});
