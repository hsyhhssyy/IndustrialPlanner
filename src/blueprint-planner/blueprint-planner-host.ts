import { observable, runInAction } from "mobx";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type {
  BlueprintPlannerContract, BlueprintPlannerProgress, BlueprintPlannerRequest, BlueprintPlannerResult,
} from "@/domain/blueprint-planner";
import { createUuid } from "@/domain/shared/uuid";
import type { SimulationBlueprintRunReport } from "@/domain/simulation";
import { createBlueprintFolder, listBlueprintDirectory, saveBlueprintDocument } from "@/shared/storage/blueprint-storage";
import type { PlannerCandidate } from "./candidate";
import { PlannerWorkerClient } from "./worker-client";
import { PlannerCandidateError, PlanningBudgetExhausted } from "./model";
import { meetsOperatingLimits, meetsProductionTargets } from "./verification";
import { validatePlannerRequest } from "./production-network";

interface PlannerTask {
  readonly id: string;
  readonly request: BlueprintPlannerRequest;
  readonly abort: AbortController;
  readonly startedAt: number;
  resumedAt: number | null;
  spentMs: number;
  progress: BlueprintPlannerProgress;
  deadline: number;
  budgetMs: number;
  attempt: number;
  best: { candidate: PlannerCandidate; report: SimulationBlueprintRunReport } | null;
  result: BlueprintPlannerResult | null;
  saving: Promise<void> | null;
  pendingCandidate: PlannerCandidate | null;
}

// AI-REMOVED 2026-09-16:
// Reason: 超时类型由 Worker 客户端与 Host 共用。
// Trigger: 用户要求规划在 Worker 执行，并提供可重复的 Vitest 规划入口。
// Evidence: 原 Host 直接调用 createPlannerCandidate；验证判定需要由生产与批量入口共用。
// Replacement: ./model.ts
// Risk: Low
// Human Review: Required
// Original code:
// class PlanningBudgetExhausted extends Error {}

export interface BlueprintPlannerHost extends BlueprintPlannerContract { dispose(): void; }

export function createBlueprintPlannerHost(workspace: WorkspaceContract): BlueprintPlannerHost {
  const state = observable<{ activeTaskId: string | null; revision: number }>({ activeTaskId: null, revision: 0 });
  let task: PlannerTask | null = null;
  let disposed = false;
  const candidateWorker = new PlannerWorkerClient();
  const elapsed = (current: PlannerTask) => current.spentMs + (current.resumedAt === null ? 0 : performance.now() - current.resumedAt);
  const publish = (current: PlannerTask, patch: Partial<BlueprintPlannerProgress>) => {
    if (patch.status !== undefined) {
      const active = patch.status === "running" || patch.status === "saving";
      if (!active && current.resumedAt !== null) { current.spentMs = elapsed(current); current.resumedAt = null; }
      if (active && current.resumedAt === null) current.resumedAt = performance.now();
    }
    current.progress = { ...current.progress, ...patch, elapsedMs: elapsed(current) };
    if (task === current) runInAction(() => { state.revision++; });
  };
  const finishActive = (current: PlannerTask) => {
    if (task === current) runInAction(() => { state.activeTaskId = null; state.revision++; });
  };
  const checkBudget = (current: PlannerTask) => {
    if (current.abort.signal.aborted || disposed) throw new DOMException("规划已取消", "AbortError");
    if (performance.now() >= current.deadline) throw new PlanningBudgetExhausted();
  };

  async function save(current: PlannerTask): Promise<void> {
    if (current.best === null || current.abort.signal.aborted) return;
    publish(current, { status: "saving", phase: "saving", message: "正在保存蓝图", estimatedProgress: 0.99 });
    try {
      const directory = await listBlueprintDirectory();
      const folder = directory.folders.find((entry) => entry.name === "自动规划") ?? await createBlueprintFolder({ name: "自动规划" });
      if (folder === null) throw new Error("无法创建自动规划文件夹。");
      const { candidate, report } = current.best;
      const measuredOutputs = report.probes.filter(probe => current.request.plan.targets.some(target => target.itemId === probe.id))
        .map((probe) => ({ itemId: probe.id, perMinute: probe.perMinute }));
      const saved = await saveBlueprintDocument(candidate.execution.blueprint, { parentFolderId: folder.folderId });
      if (saved === null) throw new Error("蓝图保存失败，请重试保存。");
      current.result = {
        taskId: current.id, blueprint: candidate.execution.blueprint, folderId: folder.folderId,
        metrics: candidate.metrics, connections: candidate.connections, measuredOutputs,
        warmupSeconds: candidate.execution.warmupSeconds, observationSeconds: report.observationSeconds,
        elapsedMs: elapsed(current),
      };
      publish(current, { status: "completed", message: "规划完毕，蓝图已保存到用户蓝图/自动规划", estimatedProgress: 1 });
    } catch (error) {
      publish(current, { status: "save-failed", message: errorMessage(error), estimatedProgress: null });
    } finally {
      finishActive(current);
    }
  }

  async function run(current: PlannerTask): Promise<void> {
    let lastFailure = "尚未找到通过验证的布局";
    try {
      while (!current.abort.signal.aborted && !disposed) {
        checkBudget(current);
        const attempt = current.attempt++;
        publish(current, { candidateCount: current.attempt, message: `正在搜索第 ${current.attempt} 个布局` });
        try {
          const candidate = current.pendingCandidate ?? await candidateWorker.build(current.request, attempt,
            Math.max(1, current.deadline - performance.now()), current.abort.signal, (phase, message) => publish(current, { phase, message, estimatedProgress: Math.min(0.95, 1 - Math.max(0, current.deadline - performance.now()) / current.budgetMs) }));
          checkBudget(current);
          const simulation = workspace.simulation;
          if (simulation === null) throw new Error("仿真服务不可用。");
          publish(current, { phase: "verification", message: "正在验证产量与循环运行" });
          const report = await simulation.actions.runBlueprint({ ...candidate.execution, maxWallTimeMs: Math.max(1, current.deadline - performance.now()) }, current.abort.signal);
          if (current.abort.signal.aborted) break;
          if (!meetsProductionTargets(current.request, report) || !meetsOperatingLimits(candidate.supplyAudit, report)) {
            current.pendingCandidate = report.status === "timeout" ? candidate : null;
            lastFailure = report.diagnostics.find((entry) => entry.severity === "error")?.message
              ?? (report.status === "timeout" ? "本轮验证达到时间预算" : "本轮布局的实际产量未达到目标");
            continue;
          }
          current.pendingCandidate = null;
          publish(current, { validatedCandidateCount: current.progress.validatedCandidateCount + 1, phase: "optimization", message: "已找到可用产线，正在比较更紧凑的布局" });
          if (current.best === null || candidate.metrics.area < current.best.candidate.metrics.area
            || (candidate.metrics.area === current.best.candidate.metrics.area
              && (candidate.search.quality?.secondary ?? candidate.metrics.score)
                < (current.best.candidate.search.quality?.secondary ?? current.best.candidate.metrics.score))) {
            current.best = { candidate, report };
            publish(current, { bestArea: candidate.metrics.area });
          }
        } catch (error) {
          if (!(error instanceof PlannerCandidateError) || current.abort.signal.aborted) throw error;
          lastFailure = errorMessage(error);
          publish(current, { message: lastFailure });
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    } catch (error) {
      if (!(error instanceof PlanningBudgetExhausted) && !current.abort.signal.aborted) {
        publish(current, { status: "failed", message: errorMessage(error), estimatedProgress: null });
        finishActive(current);
        return;
      }
    }
    if (current.abort.signal.aborted || disposed) {
      publish(current, { status: "cancelled", message: "规划已取消", estimatedProgress: null });
      finishActive(current);
    } else if (current.best !== null) {
      current.saving = save(current);
      await current.saving;
      current.saving = null;
    } else {
      publish(current, { status: "waiting", message: `本轮时间已用完；${lastFailure}。可以继续规划。`, estimatedProgress: null });
    }
  }

  const host: BlueprintPlannerHost = {
    state,
    actions: {
      start(request) {
        if (disposed) throw new Error("规划器已关闭。");
        if (state.activeTaskId !== null) throw new Error("已有规划任务，请先取消或等待完成。");
        validatePlannerRequest(workspace.registry, request);
        if (workspace.simulation === null) throw new Error("仿真服务不可用。");
        const snapshot = structuredClone(request);
        workspace.simulation.actions.stop();
        const id = createUuid(), startedAt = Date.now();
        const current: PlannerTask = {
          id, request: snapshot, abort: new AbortController(), startedAt, resumedAt: performance.now(), spentMs: 0,
          deadline: performance.now() + snapshot.options.budgetMs, budgetMs: snapshot.options.budgetMs,
          attempt: 0, best: null, result: null, saving: null, pendingCandidate: null,
          progress: { taskId: id, status: "running", phase: "preparing", startedAt, elapsedMs: 0, estimatedProgress: 0,
            candidateCount: 0, validatedCandidateCount: 0, bestArea: null, message: null },
        };
        task = current;
        runInAction(() => { state.activeTaskId = id; state.revision++; });
        void run(current);
        return id;
      },
      continuePlanning(taskId, additionalBudgetMs) {
        if (task?.id !== taskId || task.progress.status !== "waiting") throw new Error("任务当前不能延长。");
        if (!Number.isFinite(additionalBudgetMs) || additionalBudgetMs <= 0) throw new Error("追加时间必须大于零。");
        task.budgetMs = additionalBudgetMs;
        task.deadline = performance.now() + task.budgetMs;
        publish(task, { status: "running", message: "继续搜索布局", estimatedProgress: 0 });
        void run(task);
      },
      cancel(taskId) {
        if (task?.id !== taskId || !["running", "waiting"].includes(task.progress.status)) return;
        task.abort.abort();
        publish(task, { status: "cancelled", message: "规划已取消", estimatedProgress: null });
        finishActive(task);
      },
      async retrySave(taskId) {
        if (task?.id !== taskId || task.progress.status !== "save-failed") throw new Error("任务当前不能重试保存。");
        const current = task;
        runInAction(() => { state.activeTaskId = current.id; state.revision++; });
        current.saving ??= save(current);
        try { await current.saving; } finally { current.saving = null; }
      },
    },
    queries: {
      getTask: () => task === null ? null : { ...task.progress, elapsedMs: elapsed(task) },
      getLastRequest: () => task === null ? null : structuredClone(task.request),
      getResult: (taskId) => task?.id === taskId && task.result !== null ? structuredClone(task.result) : null,
    },
    dispose() {
      disposed = true;
      candidateWorker.dispose();
      task?.abort.abort();
      if (workspace.blueprintPlanner === host) workspace.blueprintPlanner = null;
    },
  };
  workspace.blueprintPlanner = host;
  return host;
}

// AI-REMOVED 2026-09-16:
// Reason: 生产任务与批量测试必须使用同一可用性门槛。
// Trigger: 用户要求规划在 Worker 执行，并提供可重复的 Vitest 规划入口。
// Evidence: 原 Host 直接调用 createPlannerCandidate；验证判定需要由生产与批量入口共用。
// Replacement: ./verification.ts
// Risk: Low
// Human Review: Required
// Original code:
// function meetsProductionTargets(request: BlueprintPlannerRequest, report: SimulationBlueprintRunReport): boolean {
//   if (report.status !== "completed" || report.observationSeconds <= 0
//     || report.diagnostics.some((entry) => entry.severity === "error")
//     || report.deviceStatuses.some((entry) => entry.status === "not-in-power-net" || entry.status === "no-power")) return false;
//   return request.plan.targets.every((target) => (report.probes.find((probe) => probe.id === target.itemId)?.perMinute ?? 0) + 1e-6 >= target.perMinute * 0.98);
// }

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
