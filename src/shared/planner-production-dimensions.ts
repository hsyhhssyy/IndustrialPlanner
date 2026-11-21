import type { BlueprintPlannerOptions } from "@/domain/blueprint-planner";

/** 生产任务只使用独立两轴；原图优化调用方不经过此规范化。 */
export function normalizePlannerProductionDimensionOptions(options: BlueprintPlannerOptions): BlueprintPlannerOptions {
  const limits = options.dimensionLimits;
  if (!limits || typeof limits !== "object" || Array.isArray(limits)
    || !["straight", "uShaped", "shortest"].some(key => Object.prototype.hasOwnProperty.call(limits, key))) return options;
  const dimensionLimits = Object.fromEntries(Object.entries(limits).filter(([key]) => !["straight", "uShaped", "shortest"].includes(key)));
  const normalized = { ...options };
  if (Object.keys(dimensionLimits).length) normalized.dimensionLimits = dimensionLimits;
  else delete normalized.dimensionLimits;
  return normalized;
}
