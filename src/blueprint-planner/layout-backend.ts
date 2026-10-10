import type { GridRotation } from "@/domain/shared/grid";

/** 数值快照只供批量搜索使用；候选必须回到 CompactLayoutSearch 完整校验。 */
export interface PlannerLayoutBatch {
  readonly chains: number;
  /** 节点数、边数、宽、高、每链步数、随机种子、温度、直线存取线、连通评分。 */
  /** 订正 2026-10-10：第八项为连续存取面上限，末项为已恢复链数，共十项。 */
  readonly parameters: Int32Array;
  /** 每节点四个朝向，每朝向 40 个整数；边同样使用 40 个整数。 */
  /** 订正 2026-10-10：每朝向 80 个整数，边仍为 40 个整数。 */
  readonly geometry: Int32Array;
  readonly edges: Int32Array;
  readonly overlaps: Int32Array;
  readonly poses: Int32Array;
  /** 每链的随机状态、年龄和当前姿态；跨调度切片保留已接受的上坡移动。 */
  readonly states?: Int32Array;
}

export interface PlannerLayoutBatchResult {
  readonly evaluations: number;
  readonly kernelMs: number;
  readonly poses: readonly (readonly { x: number; y: number; rotation: GridRotation }[])[];
  readonly states?: Int32Array;
  readonly scores?: readonly number[];
}

export interface PlannerLayoutBackend {
  search(input: PlannerLayoutBatch): Promise<PlannerLayoutBatchResult | null>;
}

export interface PlannerGpuLayoutMetrics {
  batches: number;
  evaluations: number;
  kernelMs: number;
  wallMs: number;
  uploadedBytes: number;
  fallbackReason?: string;
}

/** 32 条独立链保留搜索深度；限制单次内核工作量，避免长命令拖住桌面和取消。 */
export function plannerLayoutBatchSize(nodes: number, cells: number, budget: number, cpu = false): { chains: number; steps: number } | null {
  if (!Number.isSafeInteger(nodes) || nodes < 1 || (!cpu && nodes > 64) || !Number.isSafeInteger(cells) || cells < 1 || (!cpu && cells > 1024)
    || !Number.isSafeInteger(budget) || budget < (cpu ? 1 : 32)) return null;
  const chains = Math.max(1, Math.min(32, Math.floor(budget / 16)));
  const steps = Math.min(625, Math.floor(budget / chains), Math.max(16, Math.floor(8_000_000 / (nodes * cells))));
  return { chains, steps };
}

/** CPU 与 WGSL 的数值契约；40～55 为覆盖／固定约束，56～71 为夹具逐格阻挡掩码。 */
export const PLANNER_LAYOUT_GEOMETRY_STRIDE = 80;
export const PLANNER_LAYOUT_COOLING_STEPS = 4096;

/** 连续存取面的共同枚举；冲突按需要换面的入口数量计分，保留中间修复方向。 */
export const PLANNER_BUS_MASKS = [0, 1, 2, 4, 8, 3, 6, 12, 9, 7, 14, 13, 11] as const;
export function plannerBusConflictCount(maximumSides: number, warehouse: readonly number[], belts: readonly number[]): number {
  let best = Infinity;
  for (const mask of PLANNER_BUS_MASKS.slice(0, maximumSides === 1 ? 5 : maximumSides === 2 ? 9 : 13)) {
    let conflicts = 0;
    for (let side = 0; side < 4; side++) conflicts += (mask & (1 << side)) ? belts[side]! : warehouse[side]!;
    best = Math.min(best, conflicts);
  }
  return best;
}
