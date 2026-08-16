export type ProjectProfile = "coding" | "writing" | "research" | "planning" | "general";
export type ProjectStatus = "DRAFT" | "READY" | "RUNNING" | "PAUSED" | "NEEDS_HUMAN" | "COMPLETED" | "BLOCKED" | "STOPPED" | "ERROR";
export type ExecutorMode = "codex" | "manual";
export type IterationStatus = "RUNNING" | "AWAITING_MANUAL_RESULT" | "PASSED" | "FAILED" | "NEEDS_HUMAN" | "INTERRUPTED";
export type ReviewStatus = "PASS" | "FAIL" | "PARTIAL";

export interface ProjectDefinition {
  name: string;
  projectType: string;
  vision: string;
  primaryGoal: string;
  secondaryGoals: string[];
  targetOutcome: string;
  audience: string;
  scope: string[];
  outOfScope: string[];
  deliverables: string[];
  qualityBar: string;
  constraints: string[];
  style: string[];
  researchRequirements: string[];
  successCriteria: string[];
  risks: string[];
  milestones: string[];
  estimatedComplexity: "low" | "medium" | "high" | "very_high";
  estimatedWorkload: string;
  humanDecisionsRequired: string[];
}

export interface DiscoveryQuestion { id: string; question: string; why: string; }
export interface DiscoveryApproach { name: string; description: string; tradeoffs: string; }
export interface DiscoveryResult {
  understanding: string;
  suggestedProjectType: string;
  suggestedProfile: ProjectProfile;
  suggestedGoals: string[];
  possibleApproaches: DiscoveryApproach[];
  estimatedComplexity: "low" | "medium" | "high" | "very_high";
  estimatedWorkload: string;
  researchNeeded: boolean;
  researchTopics: string[];
  missingInformation: string[];
  questions: DiscoveryQuestion[];
  draftDefinition: ProjectDefinition;
}

export interface SupervisorDecision {
  taskTitle: string;
  objective: string;
  reasoningSummary: string;
  relevantContext: string[];
  constraints: string[];
  mustPreserve: string[];
  acceptanceCriteria: string[];
  verificationSteps: string[];
  forbiddenActions: string[];
  expectedOutput: string;
  recommendedAction: "EXECUTE" | "ASK_USER" | "COMPLETE";
  userQuestion: string;
}

export interface ReviewResult {
  score: number;
  status: ReviewStatus;
  reasoningSummary: string;
  whatImproved: string[];
  remainingProblems: string[];
  requirementsViolated: string[];
  potentialRegressions: string[];
  recommendedNextAction: string;
  nextExecutionPrompt: string;
  projectComplete: boolean;
  requiresHumanDecision: boolean;
  humanDecisionQuestion: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  profile: ProjectProfile;
  description: string;
  status: ProjectStatus;
  definition: ProjectDefinition;
  workspacePath: string;
  executorMode: ExecutorMode;
  minQualityScore: number;
  maxIterations: number;
  maxStagnantIterations: number;
  createdAt: string;
  updatedAt: string;
}

export interface DirectiveRecord { id: string; projectId: string; text: string; active: boolean; createdAt: string; }
export interface IterationRecord {
  id: string;
  projectId: string;
  number: number;
  status: IterationStatus;
  supervisor: SupervisorDecision | null;
  executionPrompt: string;
  executorResult: string;
  reviewer: ReviewResult | null;
  decision: string;
  threadId: string;
  startedAt: string;
  completedAt: string;
}
export interface UsageRecord { provider: string; model: string; inputTokens: number; cachedInputTokens: number; outputTokens: number; durationMs: number; }
export interface AgentRunOptions {
  role: "architect" | "supervisor" | "executor" | "reviewer";
  prompt: string;
  cwd: string;
  sandbox: "read-only" | "workspace-write";
  schema?: Record<string, unknown>;
  useWebSearch?: boolean;
  signal?: AbortSignal;
}
export interface AgentRunResult<T = unknown> { text: string; structured: T | null; threadId: string; usage: UsageRecord; }
