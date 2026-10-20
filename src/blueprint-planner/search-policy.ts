/** 搜索状态只在相同算法版本内续用；变更调度、提案或评分时必须更新版本。 */
export const PLANNER_ALGORITHM_VERSION = "first-solution-16";

/** 暂定按实际续搜提案分配整数子网份额；0 关闭，1 全部分配给可用子网策略。 */
export const PLANNER_REPEATED_SEARCH_FRACTION = 0.125;

/** 在途额度与已结算额度一起参与派发；剩余额度限制本轮占比，提前完成的配额可再次领取。 */
export function plannerRepeatedQuota(full: number, repeated: number, available: number, fraction = PLANNER_REPEATED_SEARCH_FRACTION): number {
  if (![full, repeated, available].every(value => Number.isSafeInteger(value) && value >= 0)
    || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new Error("子网搜索预算无效。");
  if (fraction === 0 || fraction < 1 && repeated >= (full + repeated) * fraction) return 0;
  return Math.min(available, Math.max(0, Math.floor((full + repeated + available) * fraction) - repeated));
}

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
  // AI-CORRECTION 2026-10-16：用户授权以低于 20M 获得首解为目标调整算法；Windows 实测采用五倍线性起点。
  // 通道偏好仅作用于首解主分支，取得有效解后仍按真实最佳面积压缩。
  // AI-CORRECTION 2026-10-17：用户明确要求默认冷启动恢复两倍设备占地；保留 70×70 上限及显式 initialArea 覆盖。
  return Math.min(4900, deviceArea * 2);
}

/** 单尺寸预算只依赖设备规模；压缩包围盒不会减少困难布局的搜索深度。 */
export function plannerAttemptBudget(deviceArea: number, repeatedUnits = 1): number {
  if (!Number.isSafeInteger(deviceArea) || deviceArea <= 0) throw new Error("设备总占地无效。");
  if (!Number.isSafeInteger(repeatedUnits) || repeatedUnits < 1) throw new Error("生产子网份数无效。");
  // AI-CORRECTION 2026-10-16：整数子网只搜索一个副本，较长的单次预算用于完成局部布线；整网仍保留原有预算。
  return Math.min(100_000, Math.ceil(5000 * Math.max(1, deviceArea / 150) ** 2 / 1000) * 1000) * (repeatedUnits > 1 ? 3 : 1);
}
