import type { BlueprintPlannerFlow, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { SlotLinkDefinition, WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import type { SimulationRuntimeSlotPatch } from "@/domain/simulation/types/simulation-types";
import type { PlannerPort } from "./geometry";
import type { PlannerSearchStatistics } from "./search-types";

export interface MaterialDemand extends BlueprintPlannerFlow {
  readonly storageGroupIds?: readonly string[];
}

export interface PlannerNode {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly recipe: RecipeDefinition | null;
  readonly purpose: "production" | "environment" | "auxiliary" | "supply" | "product" | "byproduct" | "startup" | "logistics" | "power" | "bus";
  readonly inputs: MaterialDemand[];
  readonly outputs: MaterialDemand[];
  readonly external?: boolean;
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
