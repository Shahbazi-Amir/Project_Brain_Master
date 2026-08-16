import test from "node:test";
import assert from "node:assert/strict";
import { discoverySchema, reviewerSchema, supervisorSchema } from "../src/schemas.ts";

test("structured schemas forbid undeclared top-level properties", () => {
  assert.equal(discoverySchema.additionalProperties, false);
  assert.equal(supervisorSchema.additionalProperties, false);
  assert.equal(reviewerSchema.additionalProperties, false);
});
