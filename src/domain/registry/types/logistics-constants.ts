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
export const PIPE_TRANSPORT_DURATION_SECONDS = 0.5;
