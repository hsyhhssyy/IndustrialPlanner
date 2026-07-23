/**
 * 物流运输时间常量 — 传送带与管道的每格运输时间（秒）。
 *
 * 这些值是设备类型的固有属性，所有依赖运输时间的上层逻辑均由此导出：
 * - 仿真 phase-gating 计算相位间隔
 * - 渲染器箭头/波纹装饰的视觉速度
 * - 产线规划的物流吞吐量
 */

/** 传送带每格运输时间（秒） */
export const BELT_TRANSPORT_DURATION_SECONDS = 2;

/** 管道每格运输时间（秒） */
/** AI-CORRECTION 2026-07-23: 管道改为每整数秒结算一次，由 2 件与 1 件配方实现最高 2/s、单件可送。 */
export const PIPE_TRANSPORT_DURATION_SECONDS = 1;

// AI-REMOVED 2026-07-23:
// Reason: 0.5 秒单件配方无法表达“只在整数秒运输、单次最多 2 件”的离散门禁模型。
// Trigger: 用户确认管道采用每秒 2 件优先、1 件兜底的双配方。
// Evidence: .docs/common/模拟器/仿真运行原理.md v5 §6.2。
// Replacement: PIPE_TRANSPORT_DURATION_SECONDS = 1，单次数量由运行时管道配方决定。
// Risk: Medium - 依赖该常量的动画与规划吞吐展示会同步改为 1 秒周期。
// Human Review: Required
//
// Original code:
// export const PIPE_TRANSPORT_DURATION_SECONDS = 0.5;
