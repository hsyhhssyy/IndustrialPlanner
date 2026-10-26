import type { BlueprintPlannerPhase, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { PlannerCandidate } from "./candidate";
import type { PlannerSearchOptions, PlannerSearchStatistics } from "./search-types";
import type { PlannerRoutingMetrics } from "./routing-backend";
import type { PlannerGpuLayoutMetrics } from "./layout-backend";
import type { PlannerSearchSeed } from "./search-seed";

export interface PlannerWorkerRequest {
  readonly id: number;
  readonly request: BlueprintPlannerRequest;
  readonly variant: number;
  readonly budgetMs: number | null;
  readonly search?: PlannerSearchOptions;
  readonly gpu?: boolean;
  /** 每轮连接首次传入；数值 GPU 批次走独立端口，搜索协议和计数保持原样。 */
  readonly layoutPort?: MessagePort;
}

export type PlannerWorkerResponse =
  | { readonly id: number; readonly type: "progress"; readonly phase: BlueprintPlannerPhase; readonly message: string; readonly evaluations: number }
  | { readonly id: number; readonly type: "completed"; readonly candidate: PlannerCandidate; readonly routing?: PlannerRoutingMetrics; readonly layout?: PlannerGpuLayoutMetrics }
  // AI-CORRECTION 2026-10-26：保留现有客户端可读取的可选错误载荷，不恢复已撤下的搜索分支。
  | { readonly id: number; readonly type: "failed"; readonly kind: "candidate" | "timeout" | "fatal"; readonly message: string; readonly search?: PlannerSearchStatistics; readonly partialSeed?: PlannerSearchSeed; readonly evaluations: number; readonly routing?: PlannerRoutingMetrics; readonly layout?: PlannerGpuLayoutMetrics };

// AI-REMOVED 2026-10-26:
// Reason: 用户要求恢复 beta1/2 搜索内核，撤回其后搜索实现；保留业务正确性修复与公开任务接口。
// Trigger: 多版本对照后用户明确要求回退算法并使用 2S 渐增至 3S 初始面积。
// Evidence: .temp/eda/all-items/comparisons/default-area-20261026T015057315Z.json；回退前 SHA256 c45aa05e62efe17fb15496c22bf90530e0c5a2feeba59cd53aea6ff96a42f3a6。
// Replacement: src/blueprint-planner/worker-protocol.ts 上方 beta1/2 活动实现
// Risk: 搜索策略、检查点及后续局部修复能力变化；原始未提交内容完整保留。
// Human Review: Required
// Original code (src/blueprint-planner/worker-protocol.ts):
// import type { BlueprintPlannerPhase, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import type { PlannerCandidate } from "./candidate";
// import type { PlannerSearchOptions, PlannerSearchStatistics } from "./search-types";
// import type { PlannerRoutingMetrics } from "./routing-backend";
// import type { PlannerGpuLayoutMetrics } from "./layout-backend";
// import type { PlannerSearchSeed } from "./search-seed";
//
// export interface PlannerWorkerRequest {
//   readonly id: number;
//   readonly request: BlueprintPlannerRequest;
//   readonly variant: number;
//   readonly budgetMs: number | null;
//   readonly search?: PlannerSearchOptions;
//   readonly gpu?: boolean;
//   /** 每轮连接首次传入；数值 GPU 批次走独立端口，搜索协议和计数保持原样。 */
//   readonly layoutPort?: MessagePort;
// }
//
// export type PlannerWorkerResponse =
//   | { readonly id: number; readonly type: "progress"; readonly phase: BlueprintPlannerPhase; readonly message: string; readonly evaluations: number }
//   | { readonly id: number; readonly type: "completed"; readonly candidate: PlannerCandidate; readonly routing?: PlannerRoutingMetrics; readonly layout?: PlannerGpuLayoutMetrics }
//   | { readonly id: number; readonly type: "failed"; readonly kind: "candidate" | "timeout" | "fatal"; readonly message: string; readonly search?: PlannerSearchStatistics; readonly partialSeed?: PlannerSearchSeed; readonly evaluations: number; readonly routing?: PlannerRoutingMetrics; readonly layout?: PlannerGpuLayoutMetrics };
//
