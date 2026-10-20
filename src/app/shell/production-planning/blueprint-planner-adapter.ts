import type { BlueprintPlannerProductionPlan } from "@/domain/blueprint-planner";
import { computeProductionPlan, type ProductionPlanningIndex, type ProductionPlanningPort, type ProductionPlanningRequest } from "./production-planning-model";

export function createBlueprintPlannerPlan(input: {
  readonly request: ProductionPlanningRequest;
  readonly index: ProductionPlanningIndex;
  readonly activeActivityIds: readonly string[];
  readonly sourceBaseId: string;
  readonly name: string;
}): BlueprintPlannerProductionPlan {
  const { request } = input;
  // EDA 放置整台设备；必须沿原目标、来源与配方重新配平其全部上游耗材。
  const result = computeProductionPlan({ ...request,
    sourceConfig: { ...request.sourceConfig, includeDeviceMinimumConsumption: "ceil" },
  }, input.index);
  const flow = (port: ProductionPlanningPort) => ({ itemId: port.itemId, perMinute: port.perMinute });
  return {
    name: input.name, sourceBaseId: input.sourceBaseId,
    targets: request.targets.map(flow), externalSupplies: request.supplies.map(flow),
    infiniteItemIds: [...new Set([...request.infiniteItemIds, ...request.supplies.filter((entry) => entry.isInfinite).map((entry) => entry.itemId)])],
    byproductItemIds: [...result.byproductItemIds],
    containsModules: result.recipeTotals.some((entry) => entry.module !== null),
    unresolvedPerMinute: result.unresolvedPerMinute,
    activeActivityIds: [...input.activeActivityIds],
    recipes: result.recipeTotals.flatMap((entry) => entry.recipeId === null ? [] : [{
      recipeId: entry.recipeId, cyclesPerMinute: entry.cyclesPerMinute, deviceCount: entry.deviceCount,
      inputs: entry.inputs.map(flow), outputs: entry.outputs.map(flow), runningInputs: entry.deviceMinimumConsumptionInputs.map(flow),
    }]),
  };
}

// AI-REMOVED 2026-10-20:
// Reason: EDA 导出必须按整台耗材重新求解，不能直接复用小数台数结果。
// Trigger: 瓶装液体请求在实际放置后出现上游运行耗材缺口。
// Evidence: 0.5 台耗材 3/min，实际一台需要 6/min。
// Replacement: 上方 createBlueprintPlannerPlan 的 request/index 输入与重新求解。
// Risk: EDA 设备数量可能增加；Human Review: Required。
// Original code:
// import type { BlueprintPlannerProductionPlan } from "@/domain/blueprint-planner";
// import type { ProductionPlanningPort, ProductionPlanningResult } from "./production-planning-model";
//
// export function createBlueprintPlannerPlan(input: {
//   readonly result: ProductionPlanningResult;
//   readonly targets: readonly ProductionPlanningPort[];
//   readonly supplies: readonly ProductionPlanningPort[];
//   readonly infiniteItemIds: ReadonlySet<string>;
//   readonly activeActivityIds: readonly string[];
//   readonly sourceBaseId: string;
//   readonly name: string;
// }): BlueprintPlannerProductionPlan {
//   const flow = (port: ProductionPlanningPort) => ({ itemId: port.itemId, perMinute: port.perMinute });
//   return {
//     name: input.name, sourceBaseId: input.sourceBaseId,
//     targets: input.targets.map(flow), externalSupplies: input.supplies.map(flow),
//     infiniteItemIds: [...new Set([...input.infiniteItemIds, ...input.supplies.filter((entry) => entry.isInfinite).map((entry) => entry.itemId)])],
//     byproductItemIds: [...input.result.byproductItemIds],
//     containsModules: input.result.recipeTotals.some((entry) => entry.module !== null),
//     unresolvedPerMinute: input.result.unresolvedPerMinute,
//     activeActivityIds: [...input.activeActivityIds],
//     recipes: input.result.recipeTotals.flatMap((entry) => entry.recipeId === null ? [] : [{
//       recipeId: entry.recipeId, cyclesPerMinute: entry.cyclesPerMinute, deviceCount: entry.deviceCount,
//       inputs: entry.inputs.map(flow), outputs: entry.outputs.map(flow), runningInputs: entry.deviceMinimumConsumptionInputs.map(flow),
//     }]),
//   };
// }
