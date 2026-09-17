// AI-REMOVED 2026-09-17:
// Reason: 离线常驻训练和测试共用执行器，运行脚本不得反向引用测试实现。
// Trigger: 用户确认 CPU 多核训练及 20% 资源余量。
// Evidence: 原训练逐候选启动 Vitest，复用入口位于 tests。
// Replacement: src/scripts/eda/node-planner-client.ts
// Risk: 导入入口迁移，须回归真实 Worker 与 Dense。
// Human Review: Required
//
// Original code:
// import { Worker } from "node:worker_threads";
// import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import type { PlannerSearchOptions } from "@/blueprint-planner/search-types";
// import type { PlannerCandidate } from "@/blueprint-planner/candidate";
// import { PlannerCandidateError, PlanningBudgetExhausted } from "@/blueprint-planner/model";
// import type { PlannerWorkerResponse } from "@/blueprint-planner/worker-protocol";
// 
// /** 真实 Node Worker 适配器；执行生产 Worker 消息处理器，不 mock 浏览器或仿真。 */
// export class NodePlannerClient {
//   private worker: Worker | null = null;
//   private sequence = 0;
//   threadId: number | null = null;
// 
//   build(request: BlueprintPlannerRequest, variant: number, budgetMs: number, search?: PlannerSearchOptions): Promise<PlannerCandidate> {
//     const worker = this.worker ??= new Worker(new URL("./node-worker.mjs", import.meta.url), {
//       resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
//     });
//     const id = ++this.sequence;
//     return new Promise((resolve, reject) => {
//       const finish = () => { clearTimeout(timer); worker.off("message", message); worker.off("error", fault); worker.off("exit", exit); };
//       const fault = (error: Error) => { finish(); reject(error); };
//       const exit = (code: number) => fault(new Error(`规划 Worker 提前退出：${code}`));
//       const message = (response: PlannerWorkerResponse & { threadId: number }) => {
//         if (response.id !== id || response.type === "progress") return;
//         this.threadId = response.threadId;
//         finish();
//         if (response.type === "completed") resolve(response.candidate);
//         else reject(response.kind === "timeout" ? new PlanningBudgetExhausted(response.message)
//           : response.kind === "candidate" ? new PlannerCandidateError(response.message, response.search) : new Error(response.message));
//       };
//       const timer = setTimeout(() => { finish(); void worker.terminate(); this.worker = null; reject(new PlanningBudgetExhausted()); }, budgetMs + 1500);
//       worker.on("message", message); worker.on("error", fault); worker.on("exit", exit);
//       worker.postMessage({ id, request, variant, budgetMs, search });
//     });
//   }
// 
//   async dispose(): Promise<void> { await this.worker?.terminate(); this.worker = null; }
// }
