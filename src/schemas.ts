const stringArray = { type: "array", items: { type: "string" } } as const;
const profileEnum = ["coding", "writing", "research", "planning", "general"] as const;

const definitionProperties = {
  name: { type: "string" }, projectType: { type: "string" }, vision: { type: "string" }, primaryGoal: { type: "string" },
  secondaryGoals: stringArray, targetOutcome: { type: "string" }, audience: { type: "string" }, scope: stringArray,
  outOfScope: stringArray, deliverables: stringArray, qualityBar: { type: "string" }, constraints: stringArray,
  style: stringArray, researchRequirements: stringArray, successCriteria: stringArray, risks: stringArray, milestones: stringArray,
  estimatedComplexity: { type: "string", enum: ["low", "medium", "high", "very_high"] }, estimatedWorkload: { type: "string" },
  humanDecisionsRequired: stringArray,
  coreIdea: { type: "string" }, problemOrOpportunity: { type: "string" }, valueProposition: { type: "string" }, desiredImpact: { type: "string" },
  deliveryFormats: stringArray, executionStrategy: { type: "string" }
} as const;

const definitionSchema = {
  type: "object",
  properties: definitionProperties,
  required: Object.keys(definitionProperties),
  additionalProperties: false
} as const;

const optionSchema = {
  type: "object",
  properties: { id: { type: "string" }, label: { type: "string" }, note: { type: "string" } },
  required: ["id", "label", "note"],
  additionalProperties: false
} as const;

const factSchema = {
  type: "object",
  properties: {
    id: { type: "string" }, label: { type: "string" }, source: { type: "string", enum: ["user_explicit", "architect_inference"] },
    whyItMatters: { type: "string" }, selectionMode: { type: "string", enum: ["single", "multiple"] },
    options: { type: "array", minItems: 1, maxItems: 6, items: optionSchema }, selectedOptionIds: stringArray, allowDetails: { type: "boolean" }
  },
  required: ["id", "label", "source", "whyItMatters", "selectionMode", "options", "selectedOptionIds", "allowDetails"],
  additionalProperties: false
} as const;

const questionSchema = {
  type: "object",
  properties: {
    id: { type: "string" }, question: { type: "string" }, why: { type: "string" }, selectionMode: { type: "string", enum: ["single", "multiple"] },
    options: { type: "array", minItems: 2, maxItems: 6, items: optionSchema }, selectedOptionIds: stringArray, required: { type: "boolean" },
    allowDetails: { type: "boolean" }, detailsPrompt: { type: "string" }
  },
  required: ["id", "question", "why", "selectionMode", "options", "selectedOptionIds", "required", "allowDetails", "detailsPrompt"],
  additionalProperties: false
} as const;

export const discoverySchema = {
  type: "object",
  properties: {
    understanding: { type: "string" }, ideaEssence: { type: "string" }, problemOrOpportunity: { type: "string" }, intendedProduct: { type: "string" },
    valueProposition: { type: "string" }, desiredImpact: { type: "string" }, suggestedProjectType: { type: "string" },
    suggestedProfile: { type: "string", enum: profileEnum }, suggestedGoals: stringArray,
    possibleApproaches: { type: "array", items: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, tradeoffs: { type: "string" } }, required: ["name", "description", "tradeoffs"], additionalProperties: false } },
    facts: { type: "array", minItems: 1, maxItems: 10, items: factSchema }, keyAssumptions: stringArray,
    estimatedComplexity: { type: "string", enum: ["low", "medium", "high", "very_high"] }, estimatedWorkload: { type: "string" },
    researchNeeded: { type: "boolean" }, researchTopics: stringArray, missingInformation: stringArray,
    questions: { type: "array", maxItems: 12, items: questionSchema }, draftDefinition: definitionSchema
  },
  required: ["understanding", "ideaEssence", "problemOrOpportunity", "intendedProduct", "valueProposition", "desiredImpact", "suggestedProjectType", "suggestedProfile", "suggestedGoals", "possibleApproaches", "facts", "keyAssumptions", "estimatedComplexity", "estimatedWorkload", "researchNeeded", "researchTopics", "missingInformation", "questions", "draftDefinition"],
  additionalProperties: false
} as const;

const riskFallbackSchema = {
  type: "object",
  properties: { risk: { type: "string" }, impact: { type: "string" }, fallback: { type: "string" } },
  required: ["risk", "impact", "fallback"],
  additionalProperties: false
} as const;

const executionContractSchema = {
  type: "object",
  properties: {
    feasibility: { type: "string", enum: ["ready", "conditional", "blocked"] }, feasibilitySummary: { type: "string" },
    estimatedIterations: { type: "integer", minimum: 1, maximum: 13 }, estimatedTime: { type: "string" }, timeAssumptions: stringArray,
    requiredInputs: stringArray, externalCosts: stringArray, rightsAndPermissionChecks: stringArray,
    systemCommitments: stringArray, userCommitments: stringArray, reviewCheckpoints: stringArray, stopConditions: stringArray,
    risksAndFallbacks: { type: "array", items: riskFallbackSchema }
  },
  required: ["feasibility", "feasibilitySummary", "estimatedIterations", "estimatedTime", "timeAssumptions", "requiredInputs", "externalCosts", "rightsAndPermissionChecks", "systemCommitments", "userCommitments", "reviewCheckpoints", "stopConditions", "risksAndFallbacks"],
  additionalProperties: false
} as const;

export const maturationSchema = {
  type: "object",
  properties: {
    finalProfile: { type: "string", enum: profileEnum },
    clarifiedIdea: { type: "string" }, productDefinition: { type: "string" }, valueProposition: { type: "string" }, desiredImpact: { type: "string" },
    whatChanged: stringArray, resolvedDecisions: stringArray, remainingAssumptions: stringArray,
    recommendedApproach: { type: "object", properties: { name: { type: "string" }, why: { type: "string" } }, required: ["name", "why"], additionalProperties: false },
    executionStages: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", properties: { title: { type: "string" }, purpose: { type: "string" }, outputs: stringArray, doneWhen: { type: "string" } }, required: ["title", "purpose", "outputs", "doneWhen"], additionalProperties: false } },
    recommendedDeliveryFormats: stringArray, executionRisks: stringArray, executionContract: executionContractSchema, finalDefinition: definitionSchema
  },
  required: ["finalProfile", "clarifiedIdea", "productDefinition", "valueProposition", "desiredImpact", "whatChanged", "resolvedDecisions", "remainingAssumptions", "recommendedApproach", "executionStages", "recommendedDeliveryFormats", "executionRisks", "executionContract", "finalDefinition"],
  additionalProperties: false
} as const;

export const supervisorSchema = {
  type: "object",
  properties: {
    taskTitle: { type: "string" }, objective: { type: "string" }, reasoningSummary: { type: "string" }, relevantContext: stringArray,
    constraints: stringArray, mustPreserve: stringArray, acceptanceCriteria: stringArray, verificationSteps: stringArray,
    forbiddenActions: stringArray, expectedOutput: { type: "string" }, recommendedAction: { type: "string", enum: ["EXECUTE", "ASK_USER", "COMPLETE"] }, userQuestion: { type: "string" }
  },
  required: ["taskTitle", "objective", "reasoningSummary", "relevantContext", "constraints", "mustPreserve", "acceptanceCriteria", "verificationSteps", "forbiddenActions", "expectedOutput", "recommendedAction", "userQuestion"],
  additionalProperties: false
} as const;

export const reviewerSchema = {
  type: "object",
  properties: {
    score: { type: "number", minimum: 0, maximum: 100 }, status: { type: "string", enum: ["PASS", "FAIL", "PARTIAL"] },
    reasoningSummary: { type: "string" }, whatImproved: stringArray, remainingProblems: stringArray, requirementsViolated: stringArray,
    potentialRegressions: stringArray, recommendedNextAction: { type: "string" }, nextExecutionPrompt: { type: "string" },
    projectComplete: { type: "boolean" }, requiresHumanDecision: { type: "boolean" }, humanDecisionQuestion: { type: "string" }
  },
  required: ["score", "status", "reasoningSummary", "whatImproved", "remainingProblems", "requirementsViolated", "potentialRegressions", "recommendedNextAction", "nextExecutionPrompt", "projectComplete", "requiresHumanDecision", "humanDecisionQuestion"],
  additionalProperties: false
} as const;
