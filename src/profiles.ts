import type { ProjectProfile } from "./types.ts";

const guidance: Record<ProjectProfile, string> = {
  coding: `Focus on repository architecture, reproducible bugs, tests, CI, API contracts, regression risk, security boundaries, and minimal verified diffs. Never make tests pass by disabling them or weakening validation.`,
  writing: `Focus on author voice, audience, structure, cross-section consistency, factual integrity, source policy, terminology, repetition, narrative flow, and preserving approved material. Do not fabricate sources.`,
  research: `Separate sourced facts from inference, track source freshness, identify evidence gaps, compare competing explanations, and avoid overstating confidence.`,
  planning: `Turn goals into measurable outcomes, constraints, milestones, dependencies, review cadence, risks, and concrete next actions. Avoid plans that are impossible to maintain.`,
  general: `Preserve the approved project definition, make the next step concrete, verify outputs against explicit acceptance criteria, and escalate decisions that materially change scope.`
};

export function profileGuidance(profile: ProjectProfile): string { return guidance[profile]; }
