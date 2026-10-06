import type { BlueprintPlannerPhase, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { PlannerCandidate } from "./candidate";
import type { PlannerSearchOptions, PlannerSearchStatistics } from "./search-types";
import type { PlannerRoutingMetrics } from "./routing-backend";

export interface PlannerWorkerRequest {
  readonly id: number;
  readonly request: BlueprintPlannerRequest;
  readonly variant: number;
  readonly budgetMs: number | null;
  readonly search?: PlannerSearchOptions;
  readonly gpu?: boolean;
  /**
   * 2026-10-06：主机标定出的 GPU 布线交叉规模（格数）。Worker 自己拿不到标定结果，
   * 不传时 GPU 通道只能沿用保守缺省，而保守缺省高于真实线路规模，GPU 等于不会被选中。
   */
  readonly gpuCrossoverCells?: number;
}

export type PlannerWorkerResponse =
  | { readonly id: number; readonly type: "progress"; readonly phase: BlueprintPlannerPhase; readonly message: string; readonly evaluations: number }
  | { readonly id: number; readonly type: "completed"; readonly candidate: PlannerCandidate; readonly routing?: PlannerRoutingMetrics }
  | { readonly id: number; readonly type: "failed"; readonly kind: "candidate" | "timeout" | "fatal"; readonly message: string; readonly search?: PlannerSearchStatistics; readonly evaluations: number; readonly routing?: PlannerRoutingMetrics };
