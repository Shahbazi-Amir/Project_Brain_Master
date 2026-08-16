import type { ProjectRecord, ReviewResult } from "./types.ts";

export type LoopDecision = "PROJECT_COMPLETE" | "NEEDS_HUMAN" | "CONTINUE" | "NO_PROGRESS" | "MAX_ITERATIONS";

export function decideAfterReview(project: ProjectRecord, review: ReviewResult, iterationNumber: number, stagnantIterations: number): LoopDecision {
  if (review.requiresHumanDecision) return "NEEDS_HUMAN";
  if (review.projectComplete && review.status === "PASS" && review.score >= project.minQualityScore) return "PROJECT_COMPLETE";
  if (stagnantIterations >= project.maxStagnantIterations) return "NO_PROGRESS";
  if (iterationNumber >= project.maxIterations) return "MAX_ITERATIONS";
  return "CONTINUE";
}

export function nextStagnantCount(previousScore: number | null, currentScore: number, currentCount: number): number {
  if (previousScore === null) return 0;
  return currentScore - previousScore < 5 ? currentCount + 1 : 0;
}
