import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { architectPrompt, maturationPrompt, reviewerPrompt, supervisorPrompt } from "./prompts.ts";
import { codexProvider } from "./provider.ts";
import { discoverySchema, maturationSchema, reviewerSchema, supervisorSchema } from "./schemas.ts";
import { loadProjectMemory } from "./storage.ts";
import type { DirectiveRecord, DiscoveryResult, IterationRecord, MaturationResult, ProjectRecord, ReviewResult, SupervisorDecision } from "./types.ts";

export async function runArchitect(description: string, profileHint: string, useWebSearch: boolean, signal?: AbortSignal) {
  const cwd = join(config.dataDir, "discovery");
  mkdirSync(cwd, { recursive: true });
  return codexProvider.run<DiscoveryResult>({ role: "architect", prompt: architectPrompt(description, profileHint), cwd, sandbox: "read-only", schema: discoverySchema as unknown as Record<string, unknown>, useWebSearch, signal });
}

export async function runMaturation(description: string, discovery: DiscoveryResult, answers: Record<string, string>, profileHint: string, useWebSearch: boolean, signal?: AbortSignal) {
  const cwd = join(config.dataDir, "discovery");
  mkdirSync(cwd, { recursive: true });
  return codexProvider.run<MaturationResult>({ role: "architect", prompt: maturationPrompt(description, discovery, answers, profileHint), cwd, sandbox: "read-only", schema: maturationSchema as unknown as Record<string, unknown>, useWebSearch, signal });
}

export async function runSupervisor(project: ProjectRecord, directives: DirectiveRecord[], iterations: IterationRecord[], signal?: AbortSignal) {
  const memory = loadProjectMemory(project.id);
  return codexProvider.run<SupervisorDecision>({ role: "supervisor", prompt: supervisorPrompt(project, directives, iterations, memory), cwd: project.workspacePath, sandbox: "read-only", schema: supervisorSchema as unknown as Record<string, unknown>, signal });
}

export async function runReviewer(project: ProjectRecord, decision: SupervisorDecision, executorResult: string, directives: DirectiveRecord[], iterations: IterationRecord[], signal?: AbortSignal) {
  const memory = loadProjectMemory(project.id);
  return codexProvider.run<ReviewResult>({ role: "reviewer", prompt: reviewerPrompt(project, decision, executorResult, directives, iterations, memory), cwd: project.workspacePath, sandbox: "read-only", schema: reviewerSchema as unknown as Record<string, unknown>, signal });
}
