const stringArray = { type: "array", items: { type: "string" } } as const;

const definitionProperties = {
  name: { type: "string" }, projectType: { type: "string" }, vision: { type: "string" }, primaryGoal: { type: "string" },
  secondaryGoals: stringArray, targetOutcome: { type: "string" }, audience: { type: "string" }, scope: stringArray,
  outOfScope: stringArray, deliverables: stringArray, qualityBar: { type: "string" }, constraints: stringArray,
  style: stringArray, researchRequirements: stringArray, successCriteria: stringArray, risks: stringArray, milestones: stringArray,
  estimatedComplexity: { type: "string", enum: ["low", "medium", "high", "very_high"] }, estimatedWorkload: { type: "string" },
  humanDecisionsRequired: stringArray
} as const;

export const discoverySchema = {
  type: "object",
  properties: {
    understanding: { type: "string" }, suggestedProjectType: { type: "string" },
    suggestedProfile: { type: "string", enum: ["coding", "writing", "research", "planning", "general"] },
    suggestedGoals: stringArray,
    possibleApproaches: { type: "array", items: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, tradeoffs: { type: "string" } }, required: ["name", "description", "tradeoffs"], additionalProperties: false } },
    estimatedComplexity: { type: "string", enum: ["low", "medium", "high", "very_high"] }, estimatedWorkload: { type: "string" },
    researchNeeded: { type: "boolean" }, researchTopics: stringArray, missingInformation: stringArray,
    questions: { type: "array", items: { type: "object", properties: { id: { type: "string" }, question: { type: "string" }, why: { type: "string" } }, required: ["id", "question", "why"], additionalProperties: false } },
    draftDefinition: { type: "object", properties: definitionProperties, required: Object.keys(definitionProperties), additionalProperties: false }
  },
  required: ["understanding", "suggestedProjectType", "suggestedProfile", "suggestedGoals", "possibleApproaches", "estimatedComplexity", "estimatedWorkload", "researchNeeded", "researchTopics", "missingInformation", "questions", "draftDefinition"],
  additionalProperties: false
} as const;

export const supervisorSchema = {
  type: "object",
  properties: {
    taskTitle: { type: "string" }, objective: { type: "string" }, reasoningSummary: { type: "string" }, relevantContext: stringArray,
    constraints: stringArray, mustPreserve: stringArray, acceptanceCriteria: stringArray, verificationSteps: stringArray,
    forbiddenActions: stringArray, expectedOutput: { type: "string" }, recommendedAction: { type: "string", enum: ["EXECUTE", "ASK_USER", "COMPLETE"] },
    userQuestion: { type: "string" }
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
