import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.ts";
import { architectPrompt, maturationPrompt } from "../src/prompts.ts";
import { discoverySchema, maturationSchema } from "../src/schemas.ts";
import type { DiscoveryResult } from "../src/types.ts";

test("default automatic loop budget is capped at thirteen", () => {
  assert.equal(config.defaultMaxIterations, 13);
});

test("architect frames an idea before execution and requires meaningful clarification", () => {
  const prompt = architectPrompt("یک کتاب کاربردی درباره مدیریت تیم می‌خواهم", "writing");
  assert.match(prompt, /IDEA FRAMING/);
  assert.match(prompt, /must not start doing the project/);
  assert.match(prompt, /2-6 concise questions/);
  assert.match(prompt, /intended artifact or behavior is ambiguous/);
  assert.match(prompt, /deliveryFormats/);
});

test("maturation creates non-coding execution stages and delivery formats", () => {
  const discovery = {
    understanding: "برداشت اولیه",
    suggestedProfile: "writing",
    questions: [],
    draftDefinition: {}
  } as unknown as DiscoveryResult;
  const prompt = maturationPrompt("ایده", discovery, { audience: "مدیران" }, "writing");
  assert.match(prompt, /IDEA MATURATION/);
  assert.match(prompt, /Stages are not Codex iterations/);
  assert.match(prompt, /Writing may use Markdown\/DOCX\/PDF/);
  assert.match(prompt, /Do not force every project into a code repository mindset/);
});

test("discovery and maturation schemas expose staged project fields", () => {
  assert.ok("ideaEssence" in discoverySchema.properties);
  assert.ok("questions" in discoverySchema.properties);
  assert.ok("executionStages" in maturationSchema.properties);
  assert.ok("recommendedDeliveryFormats" in maturationSchema.properties);
  assert.equal(maturationSchema.additionalProperties, false);
});
