import type { BlueprintPlannerPhase, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { PlannerCandidate } from "./candidate";
import { PlannerCandidateError, PlanningBudgetExhausted } from "./model";
import type { PlannerWorkerRequest, PlannerWorkerResponse } from "./worker-protocol";

/** 一个 Host 复用一个布局 Worker；取消和超时直接终止计算，不回退主线程。 */
export class PlannerWorkerClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending: ((error: Error) => void) | null = null;
  private disposed = false;

  build(request: BlueprintPlannerRequest, variant: number, budgetMs: number, signal: AbortSignal,
    update: (phase: BlueprintPlannerPhase, message: string) => void): Promise<PlannerCandidate> {
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
      const abort = () => fail(new DOMException("规划已取消", "AbortError"), true);
      const fault = (event: ErrorEvent) => fail(new Error(`布局 Worker 执行失败：${event.message}`), true);
      const messageFault = () => fail(new Error("布局 Worker 返回了无法读取的消息。"), true);
      const message = (event: MessageEvent<PlannerWorkerResponse>) => {
        const response = event.data;
        if (response.id !== id) return;
        if (response.type === "progress") update(response.phase, response.message);
        else if (response.type === "completed") { cleanup(); resolve(response.candidate); }
        else fail(response.kind === "timeout" ? new PlanningBudgetExhausted(response.message)
          : response.kind === "candidate" ? new PlannerCandidateError(response.message) : new Error(response.message));
      };
      this.pending = (error) => fail(error, true);
      worker.addEventListener("message", message);
      worker.addEventListener("error", fault);
      worker.addEventListener("messageerror", messageFault);
      signal.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => fail(new PlanningBudgetExhausted("布局达到时间预算"), true), Math.max(1, budgetMs) + 1000);
      try { worker.postMessage({ id, request, variant, budgetMs } satisfies PlannerWorkerRequest); }
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
