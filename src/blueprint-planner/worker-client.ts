import type { BlueprintPlannerPhase, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { PlannerCandidate } from "./candidate";
import { PlannerCandidateError, PlanningBudgetExhausted } from "./model";
import type { PlannerWorkerRequest, PlannerWorkerResponse } from "./worker-protocol";
import type { PlannerSearchSeed } from "./search-seed";
import type { PlannerGpuLayoutMetrics } from "./layout-backend";
import type { PlannerGpuLayoutPool } from "./gpu-layout-pool";
import type { PlannerAttemptStrategy } from "./strategy-schedule";

/** 一个 Host 复用一个布局 Worker；取消和超时直接终止计算，不回退主线程。 */
// 订正 2026-09-30：暂停发送协作取消消息并结算计数；dispose 或异常才直接终止。
export class PlannerWorkerClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending: ((error: Error) => void) | null = null;
  private disposed = false;
  gpuAvailable = true;
  gpuMetrics?: PlannerGpuLayoutMetrics;

  private connectedPool: PlannerGpuLayoutPool | null = null;
  private releaseLayoutPort: (() => void) | null = null;

  constructor(private readonly allowGpu = false, private readonly layoutPool?: () => PlannerGpuLayoutPool | null) {}

  build(request: BlueprintPlannerRequest, variant: number, budgetMs: number | null, evaluationsPerRound: number, signal: AbortSignal,
    update: (phase: BlueprintPlannerPhase, message: string, evaluations: number) => void, seed?: PlannerSearchSeed, continuationStep?: number,
    maximumArea?: number, targetOutline?: { readonly width: number; readonly height: number; readonly warehouseSide?: number; readonly storageCount?: number }, originSeed?: PlannerSearchSeed, sessionKey?: string,
    attemptStrategy?: PlannerAttemptStrategy): Promise<PlannerCandidate> {
    if (this.disposed) return Promise.reject(new Error("规划器已关闭。"));
    if (signal.aborted) return Promise.reject(new DOMException("规划已取消", "AbortError"));
    if (this.pending !== null) return Promise.reject(new Error("布局 Worker 已有任务。"));
    if (typeof Worker === "undefined") return Promise.reject(new Error("当前环境不支持 Worker，无法自动规划产线。"));
    const freshWorker = this.worker === null;
    const worker = this.worker ??= new Worker(new URL("../blueprint-planner-worker.ts", import.meta.url), { type: "module" });
    const pool = this.layoutPool?.() ?? null;
    let layoutPort: MessagePort | undefined;
    if (pool !== this.connectedPool || freshWorker) {
      this.releaseLayoutPort?.(); this.releaseLayoutPort = null; this.connectedPool = pool;
      const connection = pool?.connect();
      layoutPort = connection?.port; this.releaseLayoutPort = connection?.release ?? null;
    }
    const gpu = pool ? this.releaseLayoutPort !== null : this.allowGpu;
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
          if (gpu && response.type !== "progress") {
            this.gpuMetrics = response.layout;
            // 2026-10-14：未触发数值批次不等于硬件失败；只有明确回退原因才停止专用通道。
            this.gpuAvailable = !response.layout?.fallbackReason;
          }
          if (response.type === "progress") update(response.phase, response.message, response.evaluations);
          else if (response.type === "completed") { cleanup(); resolve(response.candidate); }
          else { update("optimization", response.message, response.evaluations); fail(response.kind === "timeout" ? new PlanningBudgetExhausted(response.message)
            : response.kind === "candidate" ? new PlannerCandidateError(response.message, response.search, response.partialSeed) : new Error(response.message)); }
        } catch (error) { fail(error instanceof Error ? error : new Error(String(error)), true); }
      };
      this.pending = (error) => fail(error, true);
      worker.addEventListener("message", message);
      worker.addEventListener("error", fault);
      worker.addEventListener("messageerror", messageFault);
      signal.addEventListener("abort", abort, { once: true });
      const timer = budgetMs === null ? undefined : setTimeout(() => fail(new PlanningBudgetExhausted("布局达到时间预算"), true), Math.max(1, budgetMs) + 1000);
      // GPU 能力由 Host 为本轮创建的专用通道决定；种子池中的 request 可能保留旧的执行选项。
      // AI-CORRECTION 2026-10-14：Host 的共享 GPU 池也向普通通道提供能力，仍不读取种子中的执行开关。
      try { worker.postMessage({ id, request, variant, budgetMs, gpu, layoutPort,
        search: { maxEvaluations: evaluationsPerRound, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy } } satisfies PlannerWorkerRequest, layoutPort ? [layoutPort] : []); }
      catch (error) { fail(error instanceof Error ? error : new Error(String(error)), true); }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.pending?.(new DOMException("规划器已关闭", "AbortError"));
    this.releaseLayoutPort?.(); this.releaseLayoutPort = null; this.connectedPool = null;
    this.worker?.terminate();
    this.worker = null;
  }
}

// AI-REMOVED 2026-10-26:
// Reason: 用户要求恢复 beta1/2 搜索内核，撤回其后搜索实现；保留业务正确性修复与公开任务接口。
// Trigger: 多版本对照后用户明确要求回退算法并使用 2S 渐增至 3S 初始面积。
// Evidence: .temp/eda/all-items/comparisons/default-area-20261026T015057315Z.json；回退前 SHA256 4c8153ca92ec7c38eba64ec4980b2d2dd4de31757c811f03639437775a50af2b。
// Replacement: src/blueprint-planner/worker-client.ts 上方 beta1/2 活动实现
// Risk: 搜索策略、检查点及后续局部修复能力变化；原始未提交内容完整保留。
// Human Review: Required
// Original code (src/blueprint-planner/worker-client.ts):
// import type { BlueprintPlannerPhase, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import type { PlannerCandidate } from "./candidate";
// import { PlannerCandidateError, PlanningBudgetExhausted } from "./model";
// import type { PlannerWorkerRequest, PlannerWorkerResponse } from "./worker-protocol";
// import type { PlannerSearchSeed } from "./search-seed";
// import type { PlannerGpuLayoutMetrics } from "./layout-backend";
// import type { PlannerGpuLayoutPool } from "./gpu-layout-pool";
// import type { PlannerAttemptStrategy } from "./strategy-schedule";
//
// /** 一个 Host 复用一个布局 Worker；取消和超时直接终止计算，不回退主线程。 */
// // 订正 2026-09-30：暂停发送协作取消消息并结算计数；dispose 或异常才直接终止。
// export class PlannerWorkerClient {
//   private worker: Worker | null = null;
//   private sequence = 0;
//   private pending: ((error: Error) => void) | null = null;
//   private disposed = false;
//   gpuAvailable = true;
//   gpuMetrics?: PlannerGpuLayoutMetrics;
//
//   private connectedPool: PlannerGpuLayoutPool | null = null;
//   private releaseLayoutPort: (() => void) | null = null;
//
//   constructor(private readonly allowGpu = false, private readonly layoutPool?: () => PlannerGpuLayoutPool | null) {}
//
//   build(request: BlueprintPlannerRequest, variant: number, budgetMs: number | null, evaluationsPerRound: number, signal: AbortSignal,
//     update: (phase: BlueprintPlannerPhase, message: string, evaluations: number) => void, seed?: PlannerSearchSeed, continuationStep?: number,
//     maximumArea?: number, targetOutline?: { readonly width: number; readonly height: number; readonly warehouseSide?: number; readonly storageCount?: number }, originSeed?: PlannerSearchSeed, sessionKey?: string,
//     attemptStrategy?: PlannerAttemptStrategy, firstSolution = false, repeatedSeed?: PlannerSearchSeed, repeatedContinuation = false): Promise<PlannerCandidate> {
//     if (this.disposed) return Promise.reject(new Error("规划器已关闭。"));
//     if (signal.aborted) return Promise.reject(new DOMException("规划已取消", "AbortError"));
//     if (this.pending !== null) return Promise.reject(new Error("布局 Worker 已有任务。"));
//     if (typeof Worker === "undefined") return Promise.reject(new Error("当前环境不支持 Worker，无法自动规划产线。"));
//     const freshWorker = this.worker === null;
//     const worker = this.worker ??= new Worker(new URL("../blueprint-planner-worker.ts", import.meta.url), { type: "module" });
//     const pool = this.layoutPool?.() ?? null;
//     let layoutPort: MessagePort | undefined;
//     if (pool !== this.connectedPool || freshWorker) {
//       this.releaseLayoutPort?.(); this.releaseLayoutPort = null; this.connectedPool = pool;
//       const connection = pool?.connect();
//       layoutPort = connection?.port; this.releaseLayoutPort = connection?.release ?? null;
//     }
//     const gpu = pool ? this.releaseLayoutPort !== null : this.allowGpu;
//     const id = ++this.sequence;
//     return new Promise((resolve, reject) => {
//       const cleanup = () => {
//         clearTimeout(timer);
//         signal.removeEventListener("abort", abort);
//         worker.removeEventListener("message", message);
//         worker.removeEventListener("error", fault);
//         worker.removeEventListener("messageerror", messageFault);
//         this.pending = null;
//       };
//       const fail = (error: Error, terminate = false) => {
//         cleanup();
//         if (terminate) { worker.terminate(); if (this.worker === worker) this.worker = null; }
//         reject(error);
//       };
//       const abort = () => worker.postMessage({ id, cancel: true });
//       const fault = (event: ErrorEvent) => fail(new Error(`布局 Worker 执行失败：${event.message}`), true);
//       const messageFault = () => fail(new Error("布局 Worker 返回了无法读取的消息。"), true);
//       const message = (event: MessageEvent<PlannerWorkerResponse>) => {
//         const response = event.data;
//         if (response.id !== id) return;
//         try {
//           if (gpu && response.type !== "progress") {
//             this.gpuMetrics = response.layout;
//             // 2026-10-14：未触发数值批次不等于硬件失败；只有明确回退原因才停止专用通道。
//             this.gpuAvailable = !response.layout?.fallbackReason;
//           }
//           if (response.type === "progress") update(response.phase, response.message, response.evaluations);
//           else if (response.type === "completed") { cleanup(); resolve(response.candidate); }
//           else { update("optimization", response.message, response.evaluations); fail(response.kind === "timeout" ? new PlanningBudgetExhausted(response.message)
//             : response.kind === "candidate" ? new PlannerCandidateError(response.message, response.search, response.partialSeed) : new Error(response.message)); }
//         } catch (error) { fail(error instanceof Error ? error : new Error(String(error)), true); }
//       };
//       this.pending = (error) => fail(error, true);
//       worker.addEventListener("message", message);
//       worker.addEventListener("error", fault);
//       worker.addEventListener("messageerror", messageFault);
//       signal.addEventListener("abort", abort, { once: true });
//       const timer = budgetMs === null ? undefined : setTimeout(() => fail(new PlanningBudgetExhausted("布局达到时间预算"), true), Math.max(1, budgetMs) + 1000);
//       // GPU 能力由 Host 为本轮创建的专用通道决定；种子池中的 request 可能保留旧的执行选项。
//       // AI-CORRECTION 2026-10-14：Host 的共享 GPU 池也向普通通道提供能力，仍不读取种子中的执行开关。
//       try { worker.postMessage({ id, request, variant, budgetMs, gpu, layoutPort,
//         search: { maxEvaluations: evaluationsPerRound, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy, firstSolution, repeatedSeed, repeatedContinuation } } satisfies PlannerWorkerRequest, layoutPort ? [layoutPort] : []); }
//       catch (error) { fail(error instanceof Error ? error : new Error(String(error)), true); }
//     });
//   }
//
//   dispose(): void {
//     this.disposed = true;
//     this.pending?.(new DOMException("规划器已关闭", "AbortError"));
//     this.releaseLayoutPort?.(); this.releaseLayoutPort = null; this.connectedPool = null;
//     this.worker?.terminate();
//     this.worker = null;
//   }
// }
//
