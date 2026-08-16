export type ProjectProfile = "coding" | "writing" | "research" | "planning" | "general";
export type ProjectStatus = "DRAFT" | "READY" | "RUNNING" | "PAUSED" | "NEEDS_HUMAN" | "COMPLETED" | "BLOCKED" | "STOPPED" | "ERROR";
export type ExecutorMode = "codex" | "manual";
export type IterationStatus = "RUNNING" | "AWAITING_MANUAL_RESULT" | "PASSED" | "FAILED" | "NEEDS_HUMAN" | "INTERRUPTED";
export type ReviewStatus = "PASS" | "FAIL" | "PARTIAL";
export type FactSource = "user_explicit" | "architect_inference";
export type SelectionMode = "single" | "multiple";

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
  coreIdea?: string;
  problemOrOpportunity?: string;
  valueProposition?: string;
  desiredImpact?: string;
  deliveryFormats?: string[];
  executionStrategy?: string;
  executionContract?: ExecutionContract;
}

export interface ChoiceOption { id: string; label: string; note: string; }
export interface IdeaFact {
  id: string;
  label: string;
  source: FactSource;
  whyItMatters: string;
  selectionMode: SelectionMode;
  options: ChoiceOption[];
  selectedOptionIds: string[];
  allowDetails: boolean;
}
export interface DiscoveryQuestion {
  id: string;
  question: string;
  why: string;
  selectionMode: SelectionMode;
  options: ChoiceOption[];
  selectedOptionIds: string[];
  required: boolean;
  allowDetails: boolean;
  detailsPrompt: string;
}
export interface DiscoveryApproach { name: string; description: string; tradeoffs: string; }
export interface DiscoveryResult {
  understanding: string;
  ideaEssence: string;
  problemOrOpportunity: string;
  intendedProduct: string;
  valueProposition: string;
  desiredImpact: string;
  suggestedProjectType: string;
  suggestedProfile: ProjectProfile;
  suggestedGoals: string[];
  possibleApproaches: DiscoveryApproach[];
  facts: IdeaFact[];
  keyAssumptions: string[];
  estimatedComplexity: "low" | "medium" | "high" | "very_high";
  estimatedWorkload: string;
  researchNeeded: boolean;
  researchTopics: string[];
  missingInformation: string[];
  questions: DiscoveryQuestion[];
  draftDefinition: ProjectDefinition;
}

export interface ExecutionStage {
  title: string;
  purpose: string;
  outputs: string[];
  doneWhen: string;
}
export interface RiskFallback { risk: string; impact: string; fallback: string; }
export interface ExecutionContract {
  feasibility: "ready" | "conditional" | "blocked";
  feasibilitySummary: string;
  estimatedIterations: number;
  estimatedTime: string;
  timeAssumptions: string[];
  requiredInputs: string[];
  externalCosts: string[];
  rightsAndPermissionChecks: string[];
  systemCommitments: string[];
  userCommitments: string[];
  reviewCheckpoints: string[];
  stopConditions: string[];
  risksAndFallbacks: RiskFallback[];
}
export interface MaturationResult {
  finalProfile: ProjectProfile;
  clarifiedIdea: string;
  productDefinition: string;
  valueProposition: string;
  desiredImpact: string;
  whatChanged: string[];
  resolvedDecisions: string[];
  remainingAssumptions: string[];
  recommendedApproach: { name: string; why: string };
  executionStages: ExecutionStage[];
  recommendedDeliveryFormats: string[];
  executionRisks: string[];
  executionContract: ExecutionContract;
  finalDefinition: ProjectDefinition;
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
