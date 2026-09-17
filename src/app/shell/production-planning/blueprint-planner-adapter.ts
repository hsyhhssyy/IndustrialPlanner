import type { BlueprintPlannerProductionPlan } from "@/domain/blueprint-planner";
import type { ProductionPlanningPort, ProductionPlanningResult } from "./production-planning-model";

export function createBlueprintPlannerPlan(input: {
  readonly result: ProductionPlanningResult;
  readonly targets: readonly ProductionPlanningPort[];
  readonly supplies: readonly ProductionPlanningPort[];
  readonly infiniteItemIds: ReadonlySet<string>;
  readonly activeActivityIds: readonly string[];
  readonly sourceBaseId: string;
  readonly name: string;
}): BlueprintPlannerProductionPlan {
  const flow = (port: ProductionPlanningPort) => ({ itemId: port.itemId, perMinute: port.perMinute });
  return {
    name: input.name, sourceBaseId: input.sourceBaseId,
    targets: input.targets.map(flow), externalSupplies: input.supplies.map(flow),
    infiniteItemIds: [...new Set([...input.infiniteItemIds, ...input.supplies.filter((entry) => entry.isInfinite).map((entry) => entry.itemId)])],
    byproductItemIds: [...input.result.byproductItemIds],
    containsModules: input.result.recipeTotals.some((entry) => entry.module !== null),
    unresolvedPerMinute: input.result.unresolvedPerMinute,
    activeActivityIds: [...input.activeActivityIds],
    recipes: input.result.recipeTotals.flatMap((entry) => entry.recipeId === null ? [] : [{
      recipeId: entry.recipeId, cyclesPerMinute: entry.cyclesPerMinute, deviceCount: entry.deviceCount,
      inputs: entry.inputs.map(flow), outputs: entry.outputs.map(flow), runningInputs: entry.deviceMinimumConsumptionInputs.map(flow),
    }]),
  };
}
