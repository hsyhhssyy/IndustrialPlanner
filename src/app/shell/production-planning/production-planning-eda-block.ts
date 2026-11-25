import type { ProductionPlanningIndex, ProductionPlanningResult } from "./production-planning-model";

/**
 * 2026-11-25：EDA 入口的全部“不支持”判定集中在此，只返回给日志的诊断原因。
 * 面向用户的提示统一为“该产线不支持自动规划”，不再展示具体技术细节。
 */
export function resolveProductionPlanningEdaBlockReason(input: {
  readonly plan: ProductionPlanningResult;
  readonly index: ProductionPlanningIndex;
  readonly translate: (key: string) => string;
}): string | null {
  const { plan, index, translate } = input;
  const environmentDeviceIds = [...new Set(plan.recipeTotals.flatMap((entry) =>
    entry.environmentRange === null ? [] : [entry.environmentRange.deviceId]))];
  if (environmentDeviceIds.length > 0) {
    const names = environmentDeviceIds.map((deviceId) => {
      const device = index.entityById.get(deviceId);
      return device === undefined ? deviceId : translate(device.nameKey);
    });
    return `区域环境转化（${names.join("、")}）`;
  }
  if (plan.recipeTotals.some((entry) => entry.probabilityGroup !== null)) {
    return "概率配方";
  }
  return null;
}
