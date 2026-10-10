import type { PlannerSearchProfile } from "./search-profile";
import type { WorldEntity } from "@/domain/document/world-document";
import type { PlannerWire } from "./model";
import type { PlannerSearchSeed } from "./search-seed";

/** M1 消融实验只控制搜索策略，不参与参数训练或改变验收。 */
/** 订正 2026-09-30：同时承载 M2 局部重建消融；未证明面积收益前不默认启用。 */
/** 订正 2026-09-30：同约束消融为重建 391 格、关闭 416 格；有面积上限的 compact 默认启用，未超过历史旧版。 */
export type PlannerSearchExperiment = "constraint-repair" | "power-dedup" | "constrained-routing" | "partial-rebuild";

/** 搜索控制属于规划器内部；生产界面仍使用 Domain 的时间预算。 */
/** 订正 2026-09-22：生产界面现在同时配置每个独立搜索的局部评估次数，并由 Host 映射到 maxEvaluations。 */
/** 订正 2026-09-30：任务化界面改为整轮提案总预算；Host 将剩余额度映射到每次搜索的 maxEvaluations，无头客户端共用此计数。 */
export interface PlannerSearchOptions {
  /** baseline 保留旧搜索组织用于同预算对照；规则修复和最终验收始终共用。 */
  /** Host 分配的当前 Worker 续搜身份；只在运行期生效。 */
  readonly sessionKey?: string;
  readonly strategy?: "baseline" | "compact";
  readonly seed?: PlannerSearchSeed;
  /** 导入蓝图的不可变基线；独立重启及减量组合始终从原图出发。 */
  readonly originSeed?: PlannerSearchSeed;
  /** 当前有效种子的续搜次数；前两次快速缩边，随后轮换长宽比。 */
  readonly continuationStep?: number;
  /** 同物品输出箱数量的有限轮换；0 优先按端口总容量合箱。 */
  readonly stashPackingVariant?: number;
  /** 暗管按局部需求直连、容量共享分流或主管逐点分流；只影响新构网，续搜保留种子结构。 */
  readonly conduitTopology?: "local" | "shared" | "trunk";
  /** 已验证全局最优面积减一；所有输出拓扑、续搜与独立重启共用。 */
  /** 订正 2026-09-30：可能减少输出箱数时允许相同面积；面积仍是首要目标。 */
  readonly maximumArea?: number;
  readonly maxEvaluations?: number;
  /** 有界重排保持退火日程独立于剩余提案配额；不增加实际评估上限。 */
  readonly coolingEvaluations?: number;
  readonly outline?: { readonly width: number; readonly height: number };
  /** 调度器指定的单批搜索盒子；与 outline 的显式上限语义分开。 */
  readonly targetOutline?: { readonly width: number; readonly height: number };
  readonly profile?: Partial<PlannerSearchProfile>;
  /** 离线诊断按布局检查点采样，不改变提案、随机数或验收规则。 */
  readonly diagnostics?: boolean;
  /** 省略时只启用已验证的 power-dedup；显式数组替换默认集合，[] 用于旧算法对照。 */
  /** 订正 2026-09-30：有 maximumArea 的 compact 同时启用 partial-rebuild；显式数组仍完整替换默认集合。 */
  readonly experiments?: readonly PlannerSearchExperiment[];
}

export interface PlannerLayoutIssue {
  readonly kind: "minimum-coordinate" | "body-overlap" | "body-boundary" | "same-device-distance"
    | "environment-coverage" | "power-coverage" | "fixture-blocked" | "port-minimum-coordinate" | "port-blocked"
    | "port-competition" | "port-boundary" | "disconnected" | "boundary-access";
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
  readonly strategy?: "baseline" | "compact";
  readonly resumedFromArea?: number;
  searchResumed?: boolean;
  layoutInitialCost?: number;
  layoutBestCost?: number;
  preparationRejected?: boolean;
  constructiveEvaluations?: number;
  constructivePlaced?: boolean;
  restartEvaluations?: number;
  rebuildAttempts?: number;
  rebuildEvaluations?: number;
  rebuildCompleted?: number;
  rebuildImprovements?: number;
  readonly maximumArea?: number;
  reusedRoutes?: number;
  readonly experiments?: readonly PlannerSearchExperiment[];
  readonly seed: number;
  readonly evaluationLimit: number;
  readonly coolingEvaluations?: number;
  readonly outline: { readonly width: number; readonly height: number };
  evaluations: number;
  /** GPU 代理搜索次数属于 evaluations 的子集，不能与完整 CPU 评分作等价性能比较。 */
  gpuEvaluations?: number;
  gpuBatches?: number;
  gpuKernelMs?: number;
  gpuCheckedLayouts?: number;
  gpuFeasibleLayouts?: number;
  acceptedMoves: number;
  routingAttempts: number;
  /** 在固定主体摆位下重建并尝试的供料关系数量，已计入 evaluations。 */
  supplyTopologyAttempts?: number;
  lastSupplyTopologyFailure?: string;
  wireCount?: number;
  bestRoutedWireCount?: number;
  initialWireLength: number;
  finalWireLength: number;
  readonly profile?: PlannerSearchProfile;
  layoutSnapshot?: readonly WorldEntity[];
  routeSnapshot?: readonly WorldEntity[];
  blockedWire?: PlannerWire;
  quality?: { readonly secondary: number; readonly occupiedCells: number; readonly utilization: number; readonly outputStashCount?: number;
    readonly excessFluidSources: number; readonly lengthPenalty: number; readonly turnPenalty: number; readonly adjacencyPairs: number };
  remainingConflicts?: { readonly geometry: number; readonly power: number; readonly boundary: number; readonly connections: number };
  diagnostics?: PlannerSearchDiagnostics;
}
