import type { BlueprintPlannerOptions, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { PlannerSupplyRules } from "./planner-supply";
import { collectPlannerItemBoundaries, PlannerItemRules } from "./planner-item-policy";

export interface PlannerDimensionConstraint {
  readonly mode: "shortest" | "straight" | "u-shaped";
  readonly edge?: number;
  readonly side?: number;
}

/** 界面与求解使用相同的逐物品最终来源，不以全局默认值或出货口推断取货。 */
export function resolvePlannerDimensionConstraint(registry: RegistryContract, request: BlueprintPlannerRequest): PlannerDimensionConstraint | undefined {
  const limits = request.options.dimensionLimits;
  if (!limits) return undefined;
  const rules = new PlannerItemRules(registry, request.options);
  const supply = request.blueprintSource ? request.blueprintSource.boundaries.some(boundary => boundary.direction === "input"
    && boundary.kind === "facility" && boundary.itemId !== null && rules.isSolid(boundary.itemId))
    : collectPlannerItemBoundaries(registry, request.plan,
      new PlannerSupplyRules(registry, request.plan, request.options.converterStartup).view(
        request.manualLayout?.enabled ? request.manualLayout.facilities.flatMap(facility => facility.recipeId ? [facility.recipeId] : []) : []))
      .some(row => row.supply && rules.supply(row.itemId) === "warehouse");
  if (!supply || request.options.warehouseBus === "corner") {
    return limits.shortest === undefined ? undefined : { mode: "shortest", edge: limits.shortest };
  }
  const pair = request.options.warehouseBus === "straight" ? limits.straight : limits.uShaped;
  return pair?.edge === undefined && pair?.side === undefined ? undefined : { mode: request.options.warehouseBus, ...pair };
}

/** baseSide 为北／东／南／西；未指定时保留两种整体方向的并集。 */
export function matchesPlannerDimensionConstraint(limits: PlannerDimensionConstraint | undefined,
  width: number, height: number, baseSide?: number): boolean {
  if (!limits) return true;
  if (limits.mode === "shortest") return Math.min(width, height) <= (limits.edge ?? Infinity);
  const matches = (side: number) => (side % 2 === 0 ? width : height) <= (limits.edge ?? Infinity)
    && (side % 2 === 0 ? height : width) <= (limits.side ?? Infinity);
  return baseSide === undefined ? matches(0) || matches(1) : matches(baseSide);
}

export function validatePlannerDimensionOptions(options: BlueprintPlannerOptions): void {
  const positive = (value: unknown) => value === undefined || Number.isSafeInteger(value) && (value as number) > 0;
  if (!positive(options.stopAreaBelow)) throw new Error("面积停止阈值必须是正整数。");
  const limits = options.dimensionLimits;
  if (limits === undefined) return;
  if (!limits || typeof limits !== "object" || Array.isArray(limits)
    || Object.keys(limits).some(key => !["straight", "uShaped", "shortest"].includes(key)) || !positive(limits.shortest)) {
    throw new Error("尺寸限制无效。");
  }
  for (const pair of [limits.straight, limits.uShaped]) if (pair !== undefined && (!pair || typeof pair !== "object"
    || Array.isArray(pair) || Object.keys(pair).some(key => !["edge", "side"].includes(key)) || !positive(pair.edge) || !positive(pair.side))) {
    throw new Error("边长上限必须是正整数。");
  }
}
