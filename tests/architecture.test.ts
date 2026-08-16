import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.ts";
import { architectPrompt, maturationPrompt } from "../src/prompts.ts";
import { discoverySchema, maturationSchema } from "../src/schemas.ts";
import type { DiscoveryResult } from "../src/types.ts";

test("default automatic loop budget is capped at thirteen", () => {
  assert.equal(config.defaultMaxIterations, 13);
});

test("architect frames an idea before execution with adaptive editable choices", () => {
  const prompt = architectPrompt("یک کتاب کاربردی درباره مدیریت تیم می‌خواهم", "writing");
  assert.match(prompt, /IDEA FRAMING/);
  assert.match(prompt, /must not start doing the project/);
  assert.match(prompt, /Questions must be adaptive/);
  assert.match(prompt, /editable as choices/);
  assert.match(prompt, /Give 2-6 useful options/);
  assert.match(prompt, /do not force software questions/);
});

test("maturation creates project phases plus a bounded execution contract", () => {
  const discovery = {
    understanding: "برداشت اولیه",
    suggestedProfile: "writing",
    facts: [],
    questions: [],
    draftDefinition: {}
  } as unknown as DiscoveryResult;
  const prompt = maturationPrompt("ایده", discovery, { audience: "مدیران" }, "writing");
  assert.match(prompt, /IDEA MATURATION/);
  assert.match(prompt, /project phases, not loop iterations/);
  assert.match(prompt, /executionContract/);
  assert.match(prompt, /from 1 to 13/);
  assert.match(prompt, /Do not force code artifacts/);
});

test("discovery and maturation schemas expose staged project fields", () => {
  assert.ok("ideaEssence" in discoverySchema.properties);
  assert.ok("facts" in discoverySchema.properties);
  assert.ok("questions" in discoverySchema.properties);
  assert.ok("executionStages" in maturationSchema.properties);
  assert.ok("recommendedDeliveryFormats" in maturationSchema.properties);
  assert.ok("executionContract" in maturationSchema.properties);
  assert.equal(maturationSchema.additionalProperties, false);
});
