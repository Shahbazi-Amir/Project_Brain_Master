import type { ProjectProfile } from "./types.ts";

const guidance: Record<ProjectProfile, string> = {
  coding: `Treat the repository or software workspace as the primary artifact. Focus on architecture, reproducible behavior, tests, CI, API contracts, regression risk, security boundaries, and minimal verified diffs. Never make tests pass by disabling them or weakening validation. Deliver working code plus evidence appropriate to the task.`,
  writing: `Treat the manuscript or document set as the primary artifact, not code. Focus on author voice, audience, structure, cross-section consistency, factual integrity, terminology, repetition, narrative flow, and preserving approved material. Revise the actual document source. When DOCX/PDF is requested, produce it with available tooling or keep a high-quality editable source and report the exact packaging limitation. Do not fabricate sources.`,
  research: `Treat evidence, source notes, and the final synthesis/report as the primary artifacts. Separate sourced facts from inference, track source freshness and provenance, identify evidence gaps, compare competing explanations, and avoid overstating confidence. Never invent citations.`,
  planning: `Treat the plan/roadmap and its decision structure as the primary artifacts. Turn goals into measurable outcomes, constraints, milestones, dependencies, review cadence, risks, ownership assumptions, and concrete next actions. Avoid plans that are impossible to maintain or that hide unresolved decisions.`,
  general: `Choose durable artifacts that match the approved deliverables. Preserve the approved project definition, make the next step concrete, verify outputs against explicit acceptance criteria, and escalate decisions that materially change scope, format, audience, or quality.`
};

export function profileGuidance(profile: ProjectProfile): string { return guidance[profile]; }
