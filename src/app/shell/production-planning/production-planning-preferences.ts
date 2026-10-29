import {
  computeProductionPlan,
  type ProductionPlanningIndex,
  type ProductionPlanningPort,
  type ProductionPlanningRequest,
} from "./production-planning-model";

/** 目标物品集合改变时，仅保留剩余产线仍涉及的物品偏好；行号与数量不改变归属。 */
export function reconcileProductionPlanningRecipeChoices(
  previousTargets: readonly ProductionPlanningPort[],
  request: ProductionPlanningRequest,
  index: ProductionPlanningIndex,
): ReadonlyMap<string, string> {
  const previous = new Set(previousTargets.map(target => target.itemId));
  const current = new Set(request.targets.map(target => target.itemId));
  if (previous.size === current.size && [...previous].every(item => current.has(item))) return request.recipeChoices;
  if (!current.size || !request.recipeChoices.size) return new Map();

  // 外供可能暂时隐藏上游，不能因此误删共同目标的偏好；运行耗材也属于配方依赖。
  // 复用正式求解器的选型、模块、联产与循环处理，避免另建整库配方的可达图。
  const plan = computeProductionPlan({ ...request,
    targets: request.targets.map(target => ({ ...target, perMinute: target.perMinute > 0 ? target.perMinute : 1 })),
    supplies: [], infiniteItemIds: new Set(),
    sourceConfig: { ...request.sourceConfig, includeDeviceMinimumConsumption: "fractional" },
  }, index);
  const involved = new Set([
    ...plan.itemTotals.map(item => item.itemId),
    ...plan.recipeTotals.flatMap(recipe => [...recipe.inputs, ...recipe.outputs, ...recipe.deviceMinimumConsumptionInputs]
      .map(port => port.itemId)),
  ]);
  return new Map([...request.recipeChoices].filter(([item]) => involved.has(item)));
}
