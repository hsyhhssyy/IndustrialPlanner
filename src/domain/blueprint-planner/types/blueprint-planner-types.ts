import type { BlueprintDocument } from "../../document/blueprint-document";
import type { GridPoint, GridEdge } from "../../shared/grid";

export interface BlueprintPlannerFlow {
  readonly itemId: string;
  readonly perMinute: number;
}

export interface BlueprintPlannerRecipePlan {
  readonly recipeId: string;
  readonly cyclesPerMinute: number;
  readonly deviceCount: number;
  readonly inputs: readonly BlueprintPlannerFlow[];
  readonly outputs: readonly BlueprintPlannerFlow[];
  readonly runningInputs: readonly BlueprintPlannerFlow[];
}

/** 按需供料规则；数量由环境布局和实际设备消耗共同确定。 */
export type BlueprintPlannerSupplyPolicy = { readonly itemId: string } & (
  | { readonly source: "external" }
  | { readonly source: "production"; readonly recipeId: string }
);

export interface BlueprintPlannerProductionPlan {
  readonly name: string;
  readonly sourceBaseId: string;
  readonly targets: readonly BlueprintPlannerFlow[];
  readonly recipes: readonly BlueprintPlannerRecipePlan[];
  readonly externalSupplies: readonly BlueprintPlannerFlow[];
  readonly infiniteItemIds: readonly string[];
  readonly byproductItemIds: readonly string[];
  readonly containsModules: boolean;
  readonly unresolvedPerMinute: number;
  readonly activeActivityIds: readonly string[];
  readonly supplyPolicies?: readonly BlueprintPlannerSupplyPolicy[];
}

/** 逐物品的物流接入和剩余处理；不改变生产方案中的物料来源。 */
export interface BlueprintPlannerItemPolicy {
  readonly itemId: string;
  readonly supply?: "external" | "warehouse" | "conduit";
  readonly output?: "auto" | "warehouse" | "stash";
  readonly byproducts?: "destroy" | "output";
}

/** 原图优化的额外授权；主体设备、配方和产率基线始终保留。 */
export interface BlueprintPlannerBlueprintOptimizations {
  readonly reassignPorts: boolean;
  readonly reassignConnections: boolean;
  readonly rebuildLogistics: boolean;
  readonly mergeBoundaryFacilities: boolean;
}

export interface BlueprintPlannerOptions {
  readonly blueprintOptimizations?: BlueprintPlannerBlueprintOptimizations;
  readonly itemPolicies?: readonly BlueprintPlannerItemPolicy[];
  readonly solidSupply: "external" | "warehouse";
  readonly fluidSupply: "external" | "conduit";
  readonly warehousePortPlacement: "any" | "continuous" | "full-side";
  readonly warehouseBus: "straight" | "corner" | "u-shaped";
  readonly solidOutput: "warehouse" | "stash" | "auto";
  readonly byproducts: "destroy" | "output";
  readonly plantStartup: "preload" | "warehouse";
  /** 转化设备耗材自循环的启动方式；旧任务缺省为拒绝启动。 */
  readonly converterStartup?: "manual" | "tank" | "reject";
  // AI-REMOVED 2026-09-30:
  // Reason: 改为提案预算与真实累计计数，预览保留任务窗口。
  // Trigger: 用户批准本轮接口与交互调整。
  // Evidence: 原实现使用时间截止或关闭任务面板。
  // Replacement: src/domain/blueprint-planner/types/blueprint-planner-types.ts
  // Risk: Low。Human Review: Required
  // Original code:
  //   readonly budgetMs: number;

  readonly evaluationsPerRound: number;
  readonly concurrency?: number | "auto";
  /** 独立启用 GPU 辅助；旧任务缺省时沿用原 concurrency 是否为 auto 的设置。 */
  readonly gpu?: boolean;
  /** 冷启动随机种子；省略时为新任务生成独立种子。 */
  readonly randomSeed?: number;
  /** 显式首解搜索面积，优先于算法的默认起点策略；不固定尺寸调度结果。 */
  readonly initialArea?: number;
  /** 首个通过正式验收的解出现后停止派发，结算本轮在途工作。 */
  readonly stopAfterFirstSolution?: boolean;
  /** 固定并发批次和结果采纳顺序；需要明确的并发数，不使用自动并发。 */
  readonly deterministicSearch?: boolean;
}

export interface BlueprintPlannerRequest {
  /** 原图快照与已声明边界；plan 是识别得到的产率基线，不用于重建原图设备。 */
  readonly blueprintSource?: BlueprintPlannerBlueprintInput;
  readonly plan: BlueprintPlannerProductionPlan;
  readonly options: BlueprintPlannerOptions;
}

export interface BlueprintPlannerBlueprintBoundary {
  readonly entityId: string;
  readonly portGroupId: string;
  readonly portId: string;
  readonly direction: "input" | "output";
  readonly kind: "port" | "facility";
  readonly itemId: string | null;
}

export interface BlueprintPlannerBlueprintInput {
  readonly blueprint: BlueprintDocument;
  readonly boundaries: readonly BlueprintPlannerBlueprintBoundary[];
  readonly activeActivityIds: readonly string[];
}

/** 识别期间只保存原图和边界，不用尚不存在的生产计划替代识别状态。 */
export interface BlueprintPlannerBlueprintRecognitionRequest {
  readonly kind: "blueprint-recognition";
  readonly input: BlueprintPlannerBlueprintInput;
  readonly options: BlueprintPlannerOptions;
  readonly detectedBoundaries: readonly BlueprintPlannerBlueprintBoundary[] | null;
}

export type BlueprintPlannerTaskRequest = BlueprintPlannerRequest | BlueprintPlannerBlueprintRecognitionRequest;

export type BlueprintPlannerTaskStatus =
  | "running"
  | "waiting"
  | "saving"
  | "completed"
  | "cancelled"
  | "failed"
  | "save-failed";

export type BlueprintPlannerPhase =
  | "identification"
  | "preparing"
  | "layout"
  | "routing"
  | "verification"
  | "optimization"
  | "saving";

export interface BlueprintPlannerAreaPoint {
  readonly evaluatedProposals: number;
  readonly bestArea: number;
}

export interface BlueprintPlannerProgress {
  /** 首次接受规划执行时锁定；识别和保存原图不计入规划启动。 */
  readonly planningStarted?: boolean;
  readonly activeWorkerCount?: number;
  readonly taskId: string;
  readonly status: BlueprintPlannerTaskStatus;
  readonly phase: BlueprintPlannerPhase;
  readonly startedAt: number;
  readonly elapsedMs: number;
  readonly estimatedProgress: number | null;
  readonly evaluatedProposals: number;
  readonly roundEvaluatedProposals: number;
  readonly candidateCount: number;
  readonly validatedCandidateCount: number;
  /** 首次搜索的面积基准；独立于验收结果，缺省表示历史任务未记录。 */
  readonly initialArea?: number;
  readonly bestArea: number | null;
  readonly areaHistory?: readonly BlueprintPlannerAreaPoint[];
  readonly message: string | null;
}

export interface BlueprintPlannerMetrics {
  readonly width: number;
  readonly height: number;
  readonly area: number;
  readonly entityCount: number;
  readonly productionDeviceCount: number;
  readonly gasDiffuserCount: number;
  readonly additionalGasDiffuserCount: number;
  readonly score: number;
}

export interface BlueprintPlannerConnection {
  readonly itemId: string;
  readonly kind: "belt" | "pipe";
  readonly direction: "input" | "output";
  readonly position: GridPoint;
  readonly edge: GridEdge;
  readonly perMinute: number;
}

export interface BlueprintPlannerResult {
  readonly taskId: string;
  readonly blueprint: BlueprintDocument;
  readonly folderId: string | null;
  readonly metrics: BlueprintPlannerMetrics;
  readonly connections: readonly BlueprintPlannerConnection[];
  readonly measuredOutputs: readonly BlueprintPlannerFlow[];
  readonly warmupSeconds: number;
  readonly observationSeconds: number;
  readonly elapsedMs: number;
}

/** 可移植任务；checkpoint 仅由规划器解析，界面和同步模块不解释搜索内部状态。 */
export interface BlueprintPlannerTaskFile {
  readonly formatVersion: 1;
  readonly algorithmVersion: string;
  readonly taskId: string;
  readonly request: BlueprintPlannerTaskRequest;
  readonly progress: BlueprintPlannerProgress;
  readonly checkpoint: unknown;
}
