import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { config } from "./config.ts";
import type { DirectiveRecord, ProjectDefinition, ProjectRecord } from "./types.ts";

export function projectDir(projectId: string): string { return join(config.dataDir, "projects", projectId); }
export function internalWorkspace(projectId: string): string { return projectDir(projectId); }

export function resolveWorkspace(projectId: string, requested?: string): string {
  if (!requested?.trim()) { const path = internalWorkspace(projectId); mkdirSync(path, { recursive: true }); return path; }
  const path = isAbsolute(requested) ? requested : resolve(requested);
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error(`Workspace directory does not exist: ${path}`);
  return path;
}

function writeIfMissing(path: string, content: string): void { if (!existsSync(path)) writeFileSync(path, content, "utf8"); }
function bullets(items: string[]): string { return items.length ? items.map(v => `- ${v}`).join("\n") : "- (none yet)"; }

export function definitionMarkdown(def: ProjectDefinition): string {
  return `# ${def.name}\n\n## Project type\n${def.projectType}\n\n## Vision\n${def.vision}\n\n## Primary goal\n${def.primaryGoal}\n\n## Target outcome\n${def.targetOutcome}\n\n## Audience\n${def.audience}\n\n## Secondary goals\n${bullets(def.secondaryGoals)}\n\n## Deliverables\n${bullets(def.deliverables)}\n\n## Quality bar\n${def.qualityBar}\n\n## Success criteria\n${bullets(def.successCriteria)}\n\n## Constraints\n${bullets(def.constraints)}\n\n## Milestones\n${bullets(def.milestones)}\n`;
}

export function initializeProjectStorage(project: ProjectRecord): void {
  const dir = projectDir(project.id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.md"), definitionMarkdown(project.definition), "utf8");
  writeIfMissing(join(dir, "goals.md"), `# Goals\n\n## Primary\n${project.definition.primaryGoal}\n\n## Secondary\n${bullets(project.definition.secondaryGoals)}\n`);
  writeIfMissing(join(dir, "rules.md"), `# Rules\n\n${bullets(project.definition.constraints)}\n`);
  writeIfMissing(join(dir, "style.md"), `# Style\n\n${bullets(project.definition.style)}\n`);
  writeIfMissing(join(dir, "scope.md"), `# Scope\n\n## In scope\n${bullets(project.definition.scope)}\n\n## Out of scope\n${bullets(project.definition.outOfScope)}\n`);
  writeIfMissing(join(dir, "decisions.md"), "# Decisions\n\n");
  writeIfMissing(join(dir, "research.md"), `# Research\n\nRequirements:\n${bullets(project.definition.researchRequirements)}\n`);
  writeIfMissing(join(dir, "directives.md"), "# Human Directives\n\n");
  writeIfMissing(join(dir, "lessons.md"), "# Lessons\n\n");
  writeState(project, "Project created and ready for execution.");
}

const memoryFiles = ["project.md", "goals.md", "rules.md", "style.md", "scope.md", "decisions.md", "state.md", "research.md", "directives.md", "lessons.md"];
export function loadProjectMemory(projectId: string): string {
  const dir = projectDir(projectId);
  return memoryFiles.flatMap(file => {
    const path = join(dir, file); if (!existsSync(path)) return [];
    const content = readFileSync(path, "utf8").slice(0, 6000);
    return [`--- ${file} ---\n${content}`];
  }).join("\n\n").slice(0, 40_000);
}

export function appendDirectiveToMemory(projectId: string, directive: DirectiveRecord): void { appendFileSync(join(projectDir(projectId), "directives.md"), `- ${directive.createdAt}: ${directive.text}\n`, "utf8"); }
export function writeState(project: ProjectRecord, note: string): void { writeFileSync(join(projectDir(project.id), "state.md"), `# Project State\n\nStatus: ${project.status}\n\nUpdated: ${new Date().toISOString()}\n\nCurrent note:\n${note}\n`, "utf8"); }
