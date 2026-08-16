import { addEvent, addUsage, getProject, insertIteration, latestAwaitingManual, listDirectives, listIterations, nextIterationNumber, setProjectStatus, updateIteration } from "./db.ts";
import { decideAfterReview, nextStagnantCount } from "./policy.ts";
import { executorPrompt } from "./prompts.ts";
import { codexProvider } from "./provider.ts";
import { runReviewer, runSupervisor } from "./roles.ts";
import { writeState } from "./storage.ts";
import type { IterationRecord, ProjectRecord, ReviewResult } from "./types.ts";

interface ActiveRun { controller: AbortController; mode: "once" | "loop"; }

export class LoopController {
  private active = new Map<string, ActiveRun>();
  isRunning(projectId: string): boolean { return this.active.has(projectId); }

  stop(projectId: string, finalStatus: ProjectRecord["status"] = "STOPPED"): boolean {
    const run = this.active.get(projectId); if (!run) return false;
    run.controller.abort(); setProjectStatus(projectId, finalStatus); addEvent(projectId, "run.stop_requested", { finalStatus }); return true;
  }

  async run(projectId: string, requestedIterations: number): Promise<void> {
    if (this.active.has(projectId)) throw new Error("Project is already running");
    const controller = new AbortController(); this.active.set(projectId, { controller, mode: requestedIterations === 1 ? "once" : "loop" });
    setProjectStatus(projectId, "RUNNING"); addEvent(projectId, "run.started", { requestedIterations });
    let stagnant = 0; let previousScore: number | null = null;
    try {
      for (let n = 0; n < requestedIterations; n += 1) {
        if (controller.signal.aborted) return;
        const project = getProject(projectId); if (!project) throw new Error("Project not found");
        const allIterations = listIterations(projectId, 10); const directives = listDirectives(projectId);
        const supervisorRun = await runSupervisor(project, directives, allIterations, controller.signal); addUsage(projectId, null, "supervisor", supervisorRun.usage);
        const decision = supervisorRun.structured; if (!decision) throw new Error("Supervisor returned no structured decision");
        if (decision.recommendedAction === "ASK_USER") { setProjectStatus(projectId, "NEEDS_HUMAN"); addEvent(projectId, "supervisor.needs_human", { question: decision.userQuestion }); return; }
        if (decision.recommendedAction === "COMPLETE") { setProjectStatus(projectId, "COMPLETED"); addEvent(projectId, "supervisor.completed", { summary: decision.reasoningSummary }); return; }

        const iteration: IterationRecord = {
          id: crypto.randomUUID(), projectId, number: nextIterationNumber(projectId), status: "RUNNING", supervisor: decision,
          executionPrompt: executorPrompt(project, decision), executorResult: "", reviewer: null, decision: "", threadId: "",
          startedAt: new Date().toISOString(), completedAt: ""
        };
        insertIteration(iteration);
        if (project.executorMode === "manual") {
          updateIteration(iteration.id, { status: "AWAITING_MANUAL_RESULT", decision: "WAITING_FOR_MANUAL_EXECUTOR" });
          setProjectStatus(projectId, "NEEDS_HUMAN"); addEvent(projectId, "executor.manual_required", { iterationId: iteration.id }); return;
        }

        const executorRun = await codexProvider.run({ role: "executor", prompt: iteration.executionPrompt, cwd: project.workspacePath, sandbox: "workspace-write", signal: controller.signal });
        addUsage(projectId, iteration.id, "executor", executorRun.usage); updateIteration(iteration.id, { executorResult: executorRun.text, threadId: executorRun.threadId });
        const reviewRun = await runReviewer(project, decision, executorRun.text, directives, [iteration, ...allIterations], controller.signal); addUsage(projectId, iteration.id, "reviewer", reviewRun.usage);
        const review = reviewRun.structured; if (!review) throw new Error("Reviewer returned no structured review");
        stagnant = nextStagnantCount(previousScore, review.score, stagnant); previousScore = review.score;
        const loopDecision = decideAfterReview(project, review, iteration.number, stagnant);
        updateIteration(iteration.id, { status: review.status === "PASS" ? "PASSED" : "FAILED", reviewer: review, decision: loopDecision, completedAt: new Date().toISOString() });
        addEvent(projectId, "iteration.completed", { iteration: iteration.number, score: review.score, decision: loopDecision });
        if (loopDecision === "PROJECT_COMPLETE") { setProjectStatus(projectId, "COMPLETED"); return; }
        if (loopDecision === "NEEDS_HUMAN" || loopDecision === "NO_PROGRESS") { setProjectStatus(projectId, "NEEDS_HUMAN"); return; }
        if (loopDecision === "MAX_ITERATIONS") { setProjectStatus(projectId, "PAUSED"); return; }
      }
      const project = getProject(projectId); if (project?.status === "RUNNING") setProjectStatus(projectId, "PAUSED");
    } catch (error) {
      if (controller.signal.aborted) return;
      setProjectStatus(projectId, "ERROR"); addEvent(projectId, "run.error", { message: error instanceof Error ? error.message : String(error) }); throw error;
    } finally {
      this.active.delete(projectId); const project = getProject(projectId); if (project) writeState(project, `Last run finished with status ${project.status}.`);
    }
  }

  async submitManualResult(projectId: string, result: string): Promise<ReviewResult> {
    const project = getProject(projectId); if (!project) throw new Error("Project not found");
    const iteration = latestAwaitingManual(projectId); if (!iteration?.supervisor) throw new Error("No iteration is waiting for a manual result");
    const directives = listDirectives(projectId); const history = listIterations(projectId, 10); updateIteration(iteration.id, { executorResult: result, status: "RUNNING" });
    const reviewRun = await runReviewer(project, iteration.supervisor, result, directives, history); addUsage(projectId, iteration.id, "reviewer", reviewRun.usage);
    const review = reviewRun.structured; if (!review) throw new Error("Reviewer returned no structured review");
    const decision = decideAfterReview(project, review, iteration.number, 0);
    updateIteration(iteration.id, { status: review.status === "PASS" ? "PASSED" : "FAILED", reviewer: review, decision, completedAt: new Date().toISOString() });
    setProjectStatus(projectId, decision === "PROJECT_COMPLETE" ? "COMPLETED" : decision === "NEEDS_HUMAN" ? "NEEDS_HUMAN" : "PAUSED");
    return review;
  }
}

export const loopController = new LoopController();
