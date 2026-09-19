import type { PlannerSearchProfile } from "./search-profile";
import type { WorldEntity } from "@/domain/document/world-document";
import type { PlannerWire } from "./model";

/** M1 消融实验只控制搜索策略，不参与参数训练或改变验收。 */
export type PlannerSearchExperiment = "constraint-repair" | "power-dedup" | "constrained-routing";

/** 搜索控制属于规划器内部；生产界面仍使用 Domain 的时间预算。 */
export interface PlannerSearchOptions {
  readonly maxEvaluations?: number;
  readonly outline?: { readonly width: number; readonly height: number };
  readonly profile?: Partial<PlannerSearchProfile>;
  /** 离线诊断按布局检查点采样，不改变提案、随机数或验收规则。 */
  readonly diagnostics?: boolean;
  /** 省略时只启用已验证的 power-dedup；显式数组替换默认集合，[] 用于旧算法对照。 */
  readonly experiments?: readonly PlannerSearchExperiment[];
}

export interface PlannerLayoutIssue {
  readonly kind: "minimum-coordinate" | "body-overlap" | "body-boundary" | "same-device-distance"
    | "environment-coverage" | "fixture-blocked" | "port-minimum-coordinate" | "port-blocked"
    | "port-competition" | "port-boundary" | "disconnected";
  readonly amount: number;
  readonly entityIds: readonly string[];
  readonly position?: { readonly x: number; readonly y: number };
}

export type PlannerDiagnosticPhase = "setup" | "layout" | "routing" | "power" | "supply" | "finalization";

export interface PlannerSearchDiagnostics {
  readonly timingsMs: Record<PlannerDiagnosticPhase, number>;
  layoutChecks: number;
  feasibleLayouts: number;
  fullyRoutedAttempts: number;
  readonly rejectionCounts: Record<"routing" | "power" | "supply" | "circulation", number>;
  readonly rejections: Array<{ phase: "routing" | "power" | "supply" | "circulation"; reason: string;
    count: number; firstEvaluation: number; lastEvaluation: number }>;
  omittedRejectionDetails: number;
  lastLayout?: { evaluation: number; feasible: boolean; cost: number; issues: PlannerLayoutIssue[];
    conflicts: NonNullable<PlannerSearchStatistics["remainingConflicts"]> };
}

export interface PlannerSearchStatistics {
  readonly experiments?: readonly PlannerSearchExperiment[];
  readonly seed: number;
  readonly evaluationLimit: number;
  readonly outline: { readonly width: number; readonly height: number };
  evaluations: number;
  acceptedMoves: number;
  routingAttempts: number;
  wireCount?: number;
  bestRoutedWireCount?: number;
  initialWireLength: number;
  finalWireLength: number;
  readonly profile?: PlannerSearchProfile;
  layoutSnapshot?: readonly WorldEntity[];
  routeSnapshot?: readonly WorldEntity[];
  blockedWire?: PlannerWire;
  quality?: { readonly secondary: number; readonly occupiedCells: number; readonly utilization: number;
    readonly excessFluidSources: number; readonly lengthPenalty: number; readonly turnPenalty: number; readonly adjacencyPairs: number };
  remainingConflicts?: { readonly geometry: number; readonly power: number; readonly boundary: number; readonly connections: number };
  diagnostics?: PlannerSearchDiagnostics;
}
