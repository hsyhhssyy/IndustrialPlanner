import type { BlueprintPlannerFlow, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { SlotLinkDefinition, WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import type { SimulationRuntimeSlotPatch } from "@/domain/simulation/types/simulation-types";
import type { PlannerPort } from "./geometry";
import type { PlannerSearchStatistics } from "./search-types";

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
  constructor(message: string, readonly search?: PlannerSearchStatistics) { super(message); }
}
export class PlanningBudgetExhausted extends Error {}

export function sumMaterial(flows: readonly BlueprintPlannerFlow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const flow of flows) totals.set(flow.itemId, (totals.get(flow.itemId) ?? 0) + flow.perMinute);
  return totals;
}
