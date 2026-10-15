/** 搜索状态只在相同算法版本内续用；变更调度、提案或评分时必须更新版本。 */
export const PLANNER_ALGORITHM_VERSION = "linear-search-7";

/** 首解面积随设备规模增长；70×70 是交付硬上限，不能用倍率突破。 */
// AI-CORRECTION 2026-10-16：用户改为线性三倍面积；仓库口长度只约束可行长宽，不再平方放大面积。
export function initialPlannerArea(deviceArea: number): number {
  if (!Number.isSafeInteger(deviceArea) || deviceArea <= 0) throw new Error("设备总占地无效。");
  // AI-REMOVED 2026-10-16:
  // Reason: 移除非线性初始面积和边界长度平方下限，统一使用设备面积的三倍。
  // Trigger: 用户要求灼铜块起点约 750～800，并恢复线性关系。
  // Evidence: 设备面积 265 的任务在 530 上限耗尽 20M；旧版有效成果 608 不在此范围内。
  // Replacement: 本函数下方线性公式；dimension-schedule.ts 保留边长可行性过滤。
  // Risk: 三倍面积仍是启发式估计，不保证首解存在。Human Review: Required
  // Original code:
  // if (!Number.isSafeInteger(boundarySpan) || boundarySpan < 0) throw new Error("边界入口长度无效。");
  // // 入口总长度决定可搜索长宽比；首轮至少提供能容纳整排入口及两端物流余量的近方形选择。
  // return Math.min(4900, Math.max(Math.ceil(deviceArea * Math.max(2, 1 + deviceArea / 300)),
  //   boundarySpan === 0 ? 0 : (boundarySpan + 2) ** 2));
  return Math.min(4900, deviceArea * 3);
}

/** 单尺寸预算只依赖设备规模；压缩包围盒不会减少困难布局的搜索深度。 */
export function plannerAttemptBudget(deviceArea: number): number {
  if (!Number.isSafeInteger(deviceArea) || deviceArea <= 0) throw new Error("设备总占地无效。");
  return Math.min(100_000, Math.ceil(5000 * Math.max(1, deviceArea / 150) ** 2 / 1000) * 1000);
}
