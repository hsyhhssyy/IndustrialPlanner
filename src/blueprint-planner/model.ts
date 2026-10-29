import type { BlueprintPlannerFlow, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { SlotLinkDefinition, WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import type { SimulationRuntimeSlotPatch } from "@/domain/simulation/types/simulation-types";
import type { PlannerPort } from "./geometry";
import type { PlannerSearchStatistics } from "./search-types";
import type { PlannerSearchSeed } from "./search-seed";

export interface MaterialDemand extends BlueprintPlannerFlow {
  readonly storageGroupIds?: readonly string[];
  /** 本候选已选定的供料设备；缺省由通用物料分配选择，约束仅作用于该输入通道。 */
  readonly sourceEntityIds?: readonly string[];
}

export interface PlannerNode {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly recipe: RecipeDefinition | null;
  readonly purpose: "production" | "environment" | "auxiliary" | "supply" | "product" | "byproduct" | "startup" | "logistics" | "power";
  readonly inputs: MaterialDemand[];
  readonly outputs: MaterialDemand[];
  readonly external?: boolean;
  /** 导入蓝图的断头边界，可为输入或输出；端口身份随设备移动保留。 */
  readonly boundaryPort?: { readonly direction: "input" | "output"; readonly groupIndex: number; readonly portIndex: number };
  readonly supplyTarget?: { readonly entityId: string; readonly storageGroupIds?: readonly string[] };
  readonly supplyTargets?: readonly { readonly entityId: string; readonly storageGroupIds?: readonly string[] }[];
  readonly outputSource?: { readonly entityId: string; readonly storageGroupIds?: readonly string[] };
  readonly outputSources?: readonly { readonly entityId: string; readonly storageGroupIds?: readonly string[] }[];
}

export interface PlannerNetwork {
  /** 仅中间布局可延后补电；完整交付种子清除此标记。 */
  readonly deferPowerPlacement?: boolean;
  readonly request: BlueprintPlannerRequest;
  readonly nodes: PlannerNode[];
  readonly slotLinks: SlotLinkDefinition[];
  readonly initialSlots: SimulationRuntimeSlotPatch[];
  readonly preferredGasCount: number;
}

export interface PlannerWire {
  readonly source: PlannerPort;
  readonly target: PlannerPort;
  readonly itemIds: readonly string[];
  readonly perMinute: number;
  readonly minimumCells?: number;
}

export class PlannerCandidateError extends Error {
  // AI-CORRECTION 2026-10-26：保留现有 Worker/Node 客户端的错误载荷接口；旧内核不启用部分布局搜索池。
  // AI-CORRECTION 2026-10-29：partialSeed 用于未完成单元的具体设备与连接恢复；只作未验收状态保存。
  constructor(message: string, readonly search?: PlannerSearchStatistics, readonly partialSeed?: PlannerSearchSeed) { super(message); }
}
export class PlanningBudgetExhausted extends Error {}

export function sumMaterial(flows: readonly BlueprintPlannerFlow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const flow of flows) totals.set(flow.itemId, (totals.get(flow.itemId) ?? 0) + flow.perMinute);
  return totals;
}

// AI-REMOVED 2026-10-26:
// Reason: 用户要求恢复 beta1/2 搜索内核，撤回其后搜索实现；保留业务正确性修复与公开任务接口。
// Trigger: 多版本对照后用户明确要求回退算法并使用 2S 渐增至 3S 初始面积。
// Evidence: .temp/eda/all-items/comparisons/default-area-20261026T015057315Z.json；回退前 SHA256 2aad76069511361b9adb74fea513499402636dd0be883b8eda68317eae2f469d。
// Replacement: src/blueprint-planner/model.ts 上方 beta1/2 活动实现
// Risk: 搜索策略、检查点及后续局部修复能力变化；原始未提交内容完整保留。
// Human Review: Required
// Original code (src/blueprint-planner/model.ts):
// import type { BlueprintPlannerFlow, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import type { SlotLinkDefinition, WorldEntity } from "@/domain/document/world-document";
// import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
// import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
// import type { SimulationRuntimeSlotPatch } from "@/domain/simulation/types/simulation-types";
// import type { PlannerPort } from "./geometry";
// import type { PlannerSearchStatistics } from "./search-types";
// import type { PlannerSearchSeed } from "./search-seed";
//
// export interface MaterialDemand extends BlueprintPlannerFlow {
//   readonly storageGroupIds?: readonly string[];
//   /** 本候选已选定的供料设备；缺省由通用物料分配选择，约束仅作用于该输入通道。 */
//   readonly sourceEntityIds?: readonly string[];
// }
//
// export interface PlannerNode {
//   readonly entity: WorldEntity;
//   readonly definition: EntityDefinition;
//   readonly recipe: RecipeDefinition | null;
//   readonly purpose: "production" | "environment" | "auxiliary" | "supply" | "product" | "byproduct" | "startup" | "logistics" | "power";
//   readonly inputs: MaterialDemand[];
//   readonly outputs: MaterialDemand[];
//   readonly external?: boolean;
//   /** 导入蓝图的断头边界，可为输入或输出；端口身份随设备移动保留。 */
//   readonly boundaryPort?: { readonly direction: "input" | "output"; readonly groupIndex: number; readonly portIndex: number };
//   readonly supplyTarget?: { readonly entityId: string; readonly storageGroupIds?: readonly string[] };
//   readonly supplyTargets?: readonly { readonly entityId: string; readonly storageGroupIds?: readonly string[] }[];
//   readonly outputSource?: { readonly entityId: string; readonly storageGroupIds?: readonly string[] };
//   readonly outputSources?: readonly { readonly entityId: string; readonly storageGroupIds?: readonly string[] }[];
// }
//
// export interface PlannerNetwork {
//   /** 仅中间布局可延后补电；完整交付种子清除此标记。 */
//   readonly deferPowerPlacement?: boolean;
//   readonly request: BlueprintPlannerRequest;
//   readonly nodes: PlannerNode[];
//   readonly slotLinks: SlotLinkDefinition[];
//   readonly initialSlots: SimulationRuntimeSlotPatch[];
//   readonly preferredGasCount: number;
// }
//
// export interface PlannerWire {
//   readonly source: PlannerPort;
//   readonly target: PlannerPort;
//   readonly itemIds: readonly string[];
//   readonly perMinute: number;
//   readonly minimumCells?: number;
// }
//
// export class PlannerCandidateError extends Error {
//   constructor(message: string, readonly search?: PlannerSearchStatistics, readonly partialSeed?: PlannerSearchSeed) { super(message); }
// }
// export class PlanningBudgetExhausted extends Error {}
//
// export function sumMaterial(flows: readonly BlueprintPlannerFlow[]): Map<string, number> {
//   const totals = new Map<string, number>();
//   for (const flow of flows) totals.set(flow.itemId, (totals.get(flow.itemId) ?? 0) + flow.perMinute);
//   return totals;
// }
//
