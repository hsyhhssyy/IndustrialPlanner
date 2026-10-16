import { Worker } from "node:worker_threads";
import { URL as NodeURL } from "node:url";
import type { BlueprintPlannerPhase, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { PlannerSearchOptions } from "@/blueprint-planner/search-types";
import type { PlannerCandidate } from "@/blueprint-planner/candidate";
import { PlannerCandidateError, PlanningBudgetExhausted } from "@/blueprint-planner/model";
import type { PlannerWorkerResponse } from "@/blueprint-planner/worker-protocol";

/** 真实 Node Worker 适配器；执行生产 Worker 消息处理器，不 mock 浏览器或仿真。 */
export class NodePlannerClient {
  private worker: Worker | null = null;
  private sequence = 0;
  threadId: number | null = null;

  build(request: BlueprintPlannerRequest, variant: number, budgetMs: number | null, search?: PlannerSearchOptions,
    update?: (phase: BlueprintPlannerPhase, message: string, evaluations: number) => void, signal?: AbortSignal): Promise<PlannerCandidate> {
    if (signal?.aborted) return Promise.reject(new DOMException("计算已暂停", "AbortError"));
    // Node 执行器显式使用文件 URL，避免 jsdom 的浏览器构建转换将入口改成 HTTP URL。
    const worker = this.worker ??= new Worker(new NodeURL("./node-worker.mjs", import.meta.url), {
      resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
    });
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const abort = () => worker.postMessage({ id, cancel: true });
      const finish = () => { signal?.removeEventListener("abort", abort); clearTimeout(timer); worker.off("message", message); worker.off("error", fault); worker.off("exit", exit); };
      const fault = (error: Error) => {
        finish();
        if (this.worker === worker) this.worker = null;
        void worker.terminate();
        reject(error);
      };
      const exit = (code: number) => fault(new Error(`规划 Worker 提前退出：${code}`));
      const message = (response: PlannerWorkerResponse & { threadId: number }) => {
        if (response.id !== id) return;
        try {
          if (response.type === "progress") { update?.(response.phase, response.message, response.evaluations); return; }
          this.threadId = response.threadId;
          finish();
          if (response.type === "completed") resolve(response.candidate);
          else { update?.("optimization", response.message, response.evaluations); reject(response.kind === "timeout" ? new PlanningBudgetExhausted(response.message)
            : response.kind === "candidate" ? new PlannerCandidateError(response.message, response.search) : new Error(response.message)); }
        } catch (error) { fault(error instanceof Error ? error : new Error(String(error))); }
      };
      const timer = budgetMs === null ? undefined : setTimeout(() => { finish(); void worker.terminate(); this.worker = null; reject(new PlanningBudgetExhausted()); }, budgetMs + 1500);
      signal?.addEventListener("abort", abort, { once: true });
      worker.on("message", message); worker.on("error", fault); worker.on("exit", exit);
      try { worker.postMessage({ id, request, variant, budgetMs,
        search: { maxEvaluations: request.options.evaluationsPerRound, ...search } }); }
      catch (error) { fault(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  async dispose(): Promise<void> { await this.worker?.terminate(); this.worker = null; }
}
