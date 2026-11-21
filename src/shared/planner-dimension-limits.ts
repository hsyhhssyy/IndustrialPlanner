import { normalizePlannerProductionDimensionOptions } from "./planner-production-dimensions";
import type { BlueprintPlannerOptions, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { PlannerSupplyRules } from "./planner-supply";
import { collectPlannerItemBoundaries, PlannerItemRules } from "./planner-item-policy";

export interface PlannerDimensionConstraint {
  readonly mode: "axes" | "shortest" | "straight" | "u-shaped";
  readonly exactBaseLength?: number;
  readonly maxBaseLength?: number;
  readonly maxSideLength?: number;
  readonly exactSideLength?: number;
  readonly baseSide?: number;
  readonly edge?: number;
  readonly side?: number;
}

/** 界面与求解使用相同的逐物品最终来源，不以全局默认值或出货口推断取货。 */
export function resolvePlannerDimensionConstraint(registry: RegistryContract, request: BlueprintPlannerRequest): PlannerDimensionConstraint | undefined {
  const limits = (request.blueprintSource ? request.options : normalizePlannerProductionDimensionOptions(request.options)).dimensionLimits;
  if (!request.blueprintSource) return { mode: "axes", baseSide: 2,
    ...(limits?.exactBaseLength === undefined ? {} : { exactBaseLength: limits.exactBaseLength }),
    ...(limits?.exactSideLength === undefined ? {} : { exactSideLength: limits.exactSideLength }),
    ...(limits?.maxBaseLength === undefined ? {} : { maxBaseLength: limits.maxBaseLength }),
    ...(limits?.maxSideLength === undefined ? {} : { maxSideLength: limits.maxSideLength }) };
  if (!limits) return undefined;
  // AI-REMOVED 2026-11-21:
  // Reason: 独立两轴要求所有新尺寸共享底边方向。Trigger: 用户批准maxBase/maxSide/exactSide。
  // Evidence: 原方向只绑定exactBase。Replacement: 下方axes。Risk: Low。Human Review: Required。
  // Original code:
  //   const exact = limits.exactBaseLength === undefined ? {} : { exactBaseLength: limits.exactBaseLength,
  //     ...(request.manualLayout?.enabled && request.manualLayout.orientation === "fixed" && request.manualLayout.boundary.rotation !== null
  //       ? { baseSide: (2 + request.manualLayout.boundary.rotation / 90) % 4 } : {}) };
  const hasAxes = limits.exactBaseLength !== undefined || limits.exactSideLength !== undefined
    || limits.maxBaseLength !== undefined || limits.maxSideLength !== undefined;
  // 既有exactBase-only检查点保留其旧normalized mode，避免仅格式变化使合法缓存失效。
  const originalExactOnly = limits.exactBaseLength !== undefined && limits.maxBaseLength === undefined
    && limits.maxSideLength === undefined && limits.exactSideLength === undefined;
  const axes = {
    ...(limits.exactBaseLength === undefined ? {} : { exactBaseLength: limits.exactBaseLength }),
    ...(limits.exactSideLength === undefined ? {} : { exactSideLength: limits.exactSideLength }),
    ...(limits.maxBaseLength === undefined ? {} : { maxBaseLength: limits.maxBaseLength }),
    ...(limits.maxSideLength === undefined ? {} : { maxSideLength: limits.maxSideLength }),
    ...(hasAxes && request.manualLayout?.enabled && request.manualLayout.orientation === "fixed" && request.manualLayout.boundary.rotation !== null
      ? { baseSide: (2 + request.manualLayout.boundary.rotation / 90) % 4 } : {}),
  };
  const rules = new PlannerItemRules(registry, request.options);
  const supply = request.blueprintSource ? request.blueprintSource.boundaries.some(boundary => boundary.direction === "input"
    && boundary.kind === "facility" && boundary.itemId !== null && rules.isSolid(boundary.itemId))
    : collectPlannerItemBoundaries(registry, request.plan,
      new PlannerSupplyRules(registry, request.plan, request.options.converterStartup).view(
        request.manualLayout?.enabled ? request.manualLayout.facilities.flatMap(facility => facility.recipeId ? [facility.recipeId] : []) : []))
      .some(row => row.supply && rules.supply(row.itemId) === "warehouse");
  if (!supply || request.options.warehouseBus === "corner") {
    return limits.shortest === undefined ? hasAxes ? { mode: originalExactOnly ? "shortest" : "axes", ...axes } : undefined
      : { mode: "shortest", edge: limits.shortest, ...axes };
  }
  const pair = request.options.warehouseBus === "straight" ? limits.straight : limits.uShaped;
  return pair?.edge === undefined && pair?.side === undefined ? hasAxes ? { mode: originalExactOnly ? request.options.warehouseBus : "axes", ...axes } : undefined
    : { mode: request.options.warehouseBus, ...pair, ...axes };
}

/** baseSide 为北／东／南／西；未指定时保留两种整体方向的并集。 */
export function matchesPlannerDimensionConstraint(limits: PlannerDimensionConstraint | undefined,
  width: number, height: number, baseSide = limits?.baseSide): boolean {
  if (!limits) return true;
  if (limits.exactBaseLength !== undefined && limits.maxBaseLength !== undefined
    || limits.exactSideLength !== undefined && limits.maxSideLength !== undefined
    || limits.exactBaseLength !== undefined && limits.exactSideLength !== undefined) return false;
  if (limits.baseSide !== undefined && baseSide !== undefined && baseSide !== limits.baseSide) return false;
  // AI-REMOVED 2026-11-21:
  // Reason: 最短边上限不能绕过独立精确底边。Trigger: 全局exactBaseLength。
  // Evidence: 原shortest早退忽略底边方向。Replacement: 下方统一matches。Risk: Low。Human Review: Required。
  // Original code:
  // if (limits.mode === "shortest") return Math.min(width, height) <= (limits.edge ?? Infinity);
  // const matches = (side: number) => (side % 2 === 0 ? width : height) <= (limits.edge ?? Infinity)
  //   && (side % 2 === 0 ? height : width) <= (limits.side ?? Infinity);
  // AI-CORRECTION 2026-11-21：精确底边独立于原上限形态，并按实际底边方向判定。
  // AI-CORRECTION 2026-11-21：新两轴规则独立于形态，仍叠加所有原来有效的旧上限。
  const matches = (side: number) => {
    const base = side % 2 === 0 ? width : height, depth = side % 2 === 0 ? height : width;
    return (limits.exactBaseLength === undefined || base === limits.exactBaseLength)
      && (limits.exactSideLength === undefined || depth === limits.exactSideLength)
      && base <= (limits.maxBaseLength ?? Infinity) && depth <= (limits.maxSideLength ?? Infinity)
      && (limits.mode === "axes" || (limits.mode === "shortest" ? Math.min(width, height) <= (limits.edge ?? Infinity)
        : base <= (limits.edge ?? Infinity) && depth <= (limits.side ?? Infinity)));
  };
  return baseSide === undefined ? matches(0) || matches(1) : matches(baseSide);
}

export function validatePlannerDimensionOptions(options: BlueprintPlannerOptions, preserveLegacy = false): void {
  if (!preserveLegacy) options = normalizePlannerProductionDimensionOptions(options);
  const positive = (value: unknown) => value === undefined || Number.isSafeInteger(value) && (value as number) > 0;
  if (!positive(options.stopAreaBelow)) throw new Error("面积停止阈值必须是正整数。");
  const limits = options.dimensionLimits;
  if (limits === undefined) return;
  if (!limits || typeof limits !== "object" || Array.isArray(limits)
    || Object.keys(limits).some(key => !["straight", "uShaped", "shortest", "exactBaseLength", "exactSideLength", "maxBaseLength", "maxSideLength"].includes(key)) || !positive(limits.shortest) || !positive(limits.exactBaseLength)
    || !positive(limits.maxBaseLength) || !positive(limits.maxSideLength) || !positive(limits.exactSideLength)
    || limits.exactBaseLength !== undefined && limits.exactBaseLength > 70
    || limits.exactSideLength !== undefined && limits.exactSideLength > 70) {
    throw new Error("尺寸限制无效。");
  }
  if (limits.exactBaseLength !== undefined && limits.maxBaseLength !== undefined
    || limits.exactSideLength !== undefined && limits.maxSideLength !== undefined) throw new Error("同一维度的最大值和精确值不能同时设置。");
  if (limits.exactBaseLength !== undefined && limits.exactSideLength !== undefined) throw new Error("底边和侧边不能同时设置精确值。");
  for (const pair of [limits.straight, limits.uShaped]) if (pair !== undefined && (!pair || typeof pair !== "object"
    || Array.isArray(pair) || Object.keys(pair).some(key => !["edge", "side"].includes(key)) || !positive(pair.edge) || !positive(pair.side))) {
    throw new Error("边长上限必须是正整数。");
  }
}

/** 双侧定位只有一份宽度真相；复用原有限制语义，不将最短边错误当作底边宽度。 */
export function isPlannerManualBoundaryWidthFeasible(registry: RegistryContract, request: BlueprintPlannerRequest): boolean {
  try {
    validatePlannerDimensionOptions(request.options);
    assertPlannerManualDimensionCompatibility(request);
  } catch { return false; }
  const manual = request.manualLayout;
  const position = manual?.boundary.position;
  if (!manual?.enabled || manual.orientation !== "fixed" || manual.boundary.rotation === null || !position
    || position.left === null || position.right === null) return true;
  const width = position.right - position.left;
  if (!Number.isSafeInteger(width) || width <= 0 || width > 70) return false;
  const limits = resolvePlannerDimensionConstraint(registry, request);
  const side = request.blueprintSource ? (2 + manual.boundary.rotation / 90) % 4 : 2;
  return Array.from({ length: 70 }, (_, index) => index + 1).some(depth => matchesPlannerDimensionConstraint(limits,
    side % 2 === 0 ? width : depth, side % 2 === 0 ? depth : width, side));
}

/** 自动布局无明确方向时，优先南侧；旋转尺寸使用东侧，所选方向随候选持久化。 */
// AI-CORRECTION 2026-11-21：此既有入口现为所有独立两轴约束选择底边方向，不仅是底边精确。
export function resolvePlannerExactBaseSide(limits: PlannerDimensionConstraint | undefined, width: number, height: number,
  preferred?: number): number | undefined {
  if (!hasPlannerAxisConstraints(limits)) return preferred;
  preferred ??= limits?.baseSide;
  if (preferred !== undefined) return matchesPlannerDimensionConstraint(limits, width, height, preferred) ? preferred : undefined;
  return [2, 1, 0, 3].find(side => matchesPlannerDimensionConstraint(limits, width, height, side));
}

export function isPlannerExactBaseLengthFeasible(registry: RegistryContract, request: BlueprintPlannerRequest): boolean {
  const limits = resolvePlannerDimensionConstraint(registry, request);
  if (!hasPlannerAxisConstraints(limits)) return true;
  try {
    validatePlannerDimensionOptions(request.options);
    assertPlannerManualDimensionCompatibility(request);
  } catch { return false; }
  return isPlannerManualBoundaryWidthFeasible(registry, request) && canContainPlannerSpan(limits, 1, 1);
}

/** 设备跨度是外框下界；精确长度约束外框，不能要求设备包围盒铺满底边。 */
export function canContainPlannerSpan(limits: PlannerDimensionConstraint | undefined, minimumWidth: number, minimumHeight: number,
  baseSide?: number): boolean {
  for (let width = Math.max(1, minimumWidth); width <= 70; width++) {
    for (let height = Math.max(1, minimumHeight); height <= 70; height++) {
      if (matchesPlannerDimensionConstraint(limits, width, height, baseSide)) return true;
    }
  }
  return false;
}

/** 精确底边本期属于生产规划入口，原图参考基线不承诺该新增约束。 */
export function validateBlueprintPlannerDimensionOptions(options: BlueprintPlannerOptions): void {
  validatePlannerDimensionOptions(options, true);
  if (options.dimensionLimits?.exactBaseLength !== undefined) throw new Error("原图优化暂不支持精确底边长度，请使用生产规划入口。");
  if (hasPlannerAxisConstraints(options.dimensionLimits)) throw new Error("原图优化暂不支持独立两轴尺寸，请使用生产规划入口。");
}

/** 无新字段的旧任务保持原形态/最短边语义，不据旧数值推断两轴。 */
// AI-CORRECTION 2026-11-21：生产任务的旧三项一律未填；上述旧语义仅保留给原图优化。
export function hasPlannerAxisConstraints(limits: Pick<BlueprintPlannerOptions, "dimensionLimits">["dimensionLimits"] | PlannerDimensionConstraint): boolean {
  return !!limits && (limits.exactBaseLength !== undefined || limits.exactSideLength !== undefined
    || limits.maxBaseLength !== undefined || limits.maxSideLength !== undefined);
}

export function assertPlannerManualDimensionCompatibility(request: BlueprintPlannerRequest): void {
  const manual = request.manualLayout, position = manual?.boundary?.position;
  if (manual?.enabled && manual.orientation === "fixed" && manual.boundary.rotation !== null && position
    && position.left !== null && position.right !== null && request.options.dimensionLimits?.exactSideLength !== undefined) {
    throw new Error("固定双侧已确定精确底边，不能同时设置侧边精确长度。");
  }
}
