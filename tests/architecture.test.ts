import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.ts";
import { architectPrompt, maturationPrompt } from "../src/prompts.ts";
import { discoverySchema, maturationSchema } from "../src/schemas.ts";
import type { DiscoveryResult } from "../src/types.ts";

test("default automatic loop budget is capped at thirteen", () => {
  assert.equal(config.defaultMaxIterations, 13);
});

test("architect keeps first framing neutral, adaptive and editable", () => {
  const prompt = architectPrompt("یک کتاب کاربردی درباره مدیریت تیم می‌خواهم", "writing");
  assert.match(prompt, /IDEA FRAMING/);
  assert.match(prompt, /must not start doing the project/);
  assert.match(prompt, /one short Persian sentence/);
  assert.match(prompt, /Questions must be adaptive/);
  assert.match(prompt, /Prefer selectionMode=multiple/);
  assert.match(prompt, /Do not praise the idea/);
});

test("maturation creates a concise bounded execution contract", () => {
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
  assert.match(prompt, /estimatedIterations/);
  assert.match(prompt, /from 1 to 13/);
  assert.match(prompt, /workspacePlan/);
  assert.match(prompt, /monitoringPlan/);
  assert.match(prompt, /executionBrief/);
  assert.match(prompt, /humanDecisionsRequired should normally be an empty array/);
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
