import type { BlueprintPlannerPhase, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { PlannerCandidate } from "./candidate";
import { PlannerCandidateError, PlanningBudgetExhausted } from "./model";
import type { PlannerWorkerRequest, PlannerWorkerResponse } from "./worker-protocol";
import type { PlannerSearchSeed } from "./search-seed";
import type { PlannerGpuLayoutMetrics } from "./layout-backend";

/** 一个 Host 复用一个布局 Worker；取消和超时直接终止计算，不回退主线程。 */
// 订正 2026-09-30：暂停发送协作取消消息并结算计数；dispose 或异常才直接终止。
export class PlannerWorkerClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending: ((error: Error) => void) | null = null;
  private disposed = false;
  gpuAvailable = true;
  gpuMetrics?: PlannerGpuLayoutMetrics;

  constructor(private readonly allowGpu = false) {}

  build(request: BlueprintPlannerRequest, variant: number, budgetMs: number | null, evaluationsPerRound: number, signal: AbortSignal,
    update: (phase: BlueprintPlannerPhase, message: string, evaluations: number) => void, seed?: PlannerSearchSeed, continuationStep?: number,
    maximumArea?: number, targetOutline?: { readonly width: number; readonly height: number }, originSeed?: PlannerSearchSeed, sessionKey?: string): Promise<PlannerCandidate> {
    if (this.disposed) return Promise.reject(new Error("规划器已关闭。"));
    if (signal.aborted) return Promise.reject(new DOMException("规划已取消", "AbortError"));
    if (this.pending !== null) return Promise.reject(new Error("布局 Worker 已有任务。"));
    if (typeof Worker === "undefined") return Promise.reject(new Error("当前环境不支持 Worker，无法自动规划产线。"));
    const worker = this.worker ??= new Worker(new URL("../blueprint-planner-worker.ts", import.meta.url), { type: "module" });
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        worker.removeEventListener("message", message);
        worker.removeEventListener("error", fault);
        worker.removeEventListener("messageerror", messageFault);
        this.pending = null;
      };
      const fail = (error: Error, terminate = false) => {
        cleanup();
        if (terminate) { worker.terminate(); if (this.worker === worker) this.worker = null; }
        reject(error);
      };
      const abort = () => worker.postMessage({ id, cancel: true });
      const fault = (event: ErrorEvent) => fail(new Error(`布局 Worker 执行失败：${event.message}`), true);
      const messageFault = () => fail(new Error("布局 Worker 返回了无法读取的消息。"), true);
      const message = (event: MessageEvent<PlannerWorkerResponse>) => {
        const response = event.data;
        if (response.id !== id) return;
        try {
          if (this.allowGpu && response.type !== "progress") {
            this.gpuMetrics = response.layout;
            this.gpuAvailable = !response.layout?.fallbackReason && ((response.layout?.batches ?? 0) > 0
              || (response.type === "completed" ? response.candidate.search.evaluations : response.evaluations) === 0);
          }
          if (response.type === "progress") update(response.phase, response.message, response.evaluations);
          else if (response.type === "completed") { cleanup(); resolve(response.candidate); }
          else { update("optimization", response.message, response.evaluations); fail(response.kind === "timeout" ? new PlanningBudgetExhausted(response.message)
            : response.kind === "candidate" ? new PlannerCandidateError(response.message, response.search) : new Error(response.message)); }
        } catch (error) { fail(error instanceof Error ? error : new Error(String(error)), true); }
      };
      this.pending = (error) => fail(error, true);
      worker.addEventListener("message", message);
      worker.addEventListener("error", fault);
      worker.addEventListener("messageerror", messageFault);
      signal.addEventListener("abort", abort, { once: true });
      const timer = budgetMs === null ? undefined : setTimeout(() => fail(new PlanningBudgetExhausted("布局达到时间预算"), true), Math.max(1, budgetMs) + 1000);
      // GPU 能力由 Host 为本轮创建的专用通道决定；种子池中的 request 可能保留旧的执行选项。
      try { worker.postMessage({ id, request, variant, budgetMs, gpu: this.allowGpu,
        search: { maxEvaluations: evaluationsPerRound, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey } } satisfies PlannerWorkerRequest); }
      catch (error) { fail(error instanceof Error ? error : new Error(String(error)), true); }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.pending?.(new DOMException("规划器已关闭", "AbortError"));
    this.worker?.terminate();
    this.worker = null;
  }
}
