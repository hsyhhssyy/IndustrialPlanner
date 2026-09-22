// AI-REMOVED 2026-09-22:
// Reason: 区域模式不再拥有独立速度子集，保留该公共判定会继续传播已撤销的产品约束。
// Trigger: 用户要求所有模式均可使用 x0.25/x1/x2/x4/x16 完整速度。
// Evidence: 顶栏、Dense Host 与 Legacy 遗留控制器已移除全部活动调用点。
// Replacement: 顶栏 SIMULATION_SPEED_OPTIONS 与各引擎通用 setSimulationSpeed 数值校验。
// Risk: Low
// Human Review: Required
//
// Original code:
// export const REGIONAL_SIMULATION_SPEEDS = [0.25, 1, 2] as const;
//
// const REGIONAL_SIMULATION_SPEED_SET: ReadonlySet<number> = new Set(
//   REGIONAL_SIMULATION_SPEEDS,
// );
//
// export function isRegionalSimulationSpeed(value: number): boolean {
//   return REGIONAL_SIMULATION_SPEED_SET.has(value);
// }
