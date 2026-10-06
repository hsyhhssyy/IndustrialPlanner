import type { GridPoint } from "@/domain/shared/grid";
import { PlannerRoutingSearch } from "./routing-search";
import { PlannerRoutingGrid, ROUTE_BLOCKED, ROUTE_OPEN } from "./routing-grid";
import type { PlannerRoutingProblem } from "./routing-backend";
import { PlannerGpuRouting } from "./gpu-routing";

/**
 * 合成布线探针。
 *
 * 2026-10-06：GPU 准入规模原先只能由运行期对照结果增长，而对照只在 GPU 已经跑过（即包围盒已超过
 * 当前阈值）时才累积，因此 `maxBoundsCells` 只会变大、永远不会从保守缺省下降——真实布局（单条线路
 * 包围盒通常只有数百格）永远进不了 GPU 通道，实测表现为 GPU 占用不足 5%。
 * 这里改为在标定阶段用同一张合成栅格同时测 GPU 与 CPU，直接量出"GPU 从这里开始不再更快"的规模。
 */

/**
 * 方向编码：与 geometry.ts 的 EDGES（NORTH, EAST, SOUTH, WEST）以及 WGSL 的
 * switch(direction) 分支（0=上 1=右 2=下 3=左）完全一致。
 * 栅格字的位含义（见 routing-grid.ts 的 updateRoute）：
 * 出口掩码位 = incoming * 4 + outgoing；入口许可位 = 16 + 进入方向。
 */
const EAST = 1, WEST = 3;

export interface PlannerGpuCrossoverPoint {
  /** 合成栅格的格数（宽 × 高）。 */
  readonly cells: number;
  readonly width: number;
  readonly height: number;
  /** 路径格数，供确认两边确实解出了同一条线路。 */
  readonly pathCells: number;
  readonly gpuMs: number;
  readonly cpuMs: number;
  /** GPU 相对 CPU 的耗时倍数；小于 1 表示 GPU 更快。 */
  readonly ratio: number;
}

export interface PlannerGpuCrossoverReport {
  readonly measuredAt: number;
  readonly points: readonly PlannerGpuCrossoverPoint[];
  /** GPU 仍快于 CPU 的最大格数；未测到任何优势时为 undefined。 */
  readonly maxProfitableCells?: number;
  readonly adapter?: { readonly vendor?: string; readonly architecture?: string; readonly fallback?: boolean };
  readonly notes: readonly string[];
}

/**
 * 生成一张带障碍的合成栅格：随机封锁一部分格子，起终点放在两侧中间行。
 *
 * 2026-10-06 设计过程（记下来避免重犯）：
 * 1) 只写出口掩码、不写入口许可位（16+方向）时，着色器 neighbor 检查直接失败，一步都走不出去；
 * 2) 把通道外的格子留成 0（而非 ROUTE_OPEN）会表示"存在但完全不可进入"，把 GPU 松弛搜索困死；
 * 3) 纯直线走廊让 CPU 的 A* 只要 1~4ms，测出来的只是"GPU 固定开销更大"，不代表真实绕障场景。
 * 现在：真实 ROUTE_OPEN 铺满 + 确定性伪随机封锁（同一格数每次得到同一张图，测量可复现）。
 */
export function buildSyntheticProblem(width: number, height: number, kind = 0): PlannerRoutingProblem {
  const grid = new PlannerRoutingGrid();
  const row = Math.floor(height / 2);
  // 确定性伪随机：用格坐标做散列，避免每次测量得到不同的图。
  const blocked = (x: number, y: number): boolean => {
    const hash = (Math.imul(x * 73856093 ^ y * 19349663, 2654435761) >>> 0) % 100;
    return hash < 22;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 起终点所在的中间行与两端两列保持畅通，保证线路一定存在。
      const keepOpen = y === row || x <= 1 || x >= width - 2;
      grid.restoreValue(grid.cell(x, y), kind, keepOpen || !blocked(x, y) ? ROUTE_OPEN : ROUTE_BLOCKED);
    }
  }
  const start: GridPoint = { x: 0, y: row };
  const goal: GridPoint = { x: width - 1, y: row };
  // 起点以 EAST 作为初始"进入状态"，终点到达时的 incoming 是 EAST、要求末方向 WEST。
  for (const [point, bit] of [[start, 1 << (EAST * 4 + EAST)], [goal, 1 << (EAST * 4 + WEST)]] as const) {
    const cell = grid.cell(point.x, point.y);
    grid.restoreValue(cell, kind, grid.read(cell, kind) | bit);
  }
  return { grid, bounds: { x: 0, y: 0, width, height }, start, goal,
    startDirection: EAST, finalDirection: WEST, kind,
    span: Math.abs(goal.x - start.x) + Math.abs(goal.y - start.y) };
}

/**
 * CPU 侧对照：直接复用生产 A* 工作区（PlannerRoutingSearch），不走 Router 的实体提交路径。
 * 返回 null 表示未在步数上限内解出。
 */
export function searchCpu(problem: PlannerRoutingProblem, maximumSteps = 400_000): { cells: number; milliseconds: number } | null {
  const { grid, start, goal, kind, bounds } = problem;
  const queue = new PlannerRoutingSearch();
  const startKey = grid.cell(start.x, start.y), goalKey = grid.cell(goal.x, goal.y);
  if (grid.read(startKey, kind) & ROUTE_BLOCKED || grid.read(goalKey, kind) & ROUTE_BLOCKED) return null;
  const started = performance.now();
  // margin 护栏与生产一致：允许在包围盒外扩一圈内绕行，避免探针条件比生产更宽松。
  const margin = 8;
  queue.reset(0);
  queue.push(startKey, problem.startDirection, 1, 0,
    Math.abs(start.x - goal.x) + Math.abs(start.y - goal.y), -1);
  let expanded = 0;
  const deltas = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
  while (queue.size > 0) {
    const current = queue.pop();
    if (queue.stale(current)) continue;
    const key = queue.cells[current]!, incoming = queue.directions[current]!, steps = queue.steps[current]!;
    const x = grid.x[key]!, y = grid.y[key]!, state = grid.read(key, kind);
    if (key === goalKey && (state & (1 << (incoming * 4 + problem.finalDirection)))) {
      return { cells: steps, milliseconds: performance.now() - started };
    }
    if (++expanded > maximumSteps) return null;
    for (let nextDirection = 0; nextDirection < 4; nextDirection++) {
      if (!(state & (1 << (incoming * 4 + nextDirection)))) continue;
      const delta = deltas[nextDirection]!, nextX = x + delta.x, nextY = y + delta.y;
      if (nextX < bounds.x - margin || nextX > bounds.x + bounds.width + margin) continue;
      if (nextY < bounds.y - margin || nextY > bounds.y + bounds.height + margin) continue;
      const nextKey = grid.cell(nextX, nextY);
      if (grid.read(nextKey, kind) & ROUTE_BLOCKED) continue;
      const turn = incoming === nextDirection ? 0 : 10;
      const cost = queue.costs[current]! + 10 + turn;
      queue.push(nextKey, nextDirection, steps + 1, cost, cost + Math.abs(nextX - goal.x) + Math.abs(nextY - goal.y), current);
    }
  }
  return null;
}

export interface PlannerGpuCrossoverOptions {
  /** 逐个规模测量的格数列表。 */
  readonly scales: readonly number[];
  /** 跳过的格数上限；超过即停止上探。 */
  readonly maximumCells?: number;
  /** 单次 GPU 布线的测量超时。产品内的保守超时（缺省 120ms）会让大栅格测量直接判超时。 */
  readonly deadlineMs?: number;
  /**
   * 标定期允许的路径登记上限。产品内保守缺省是 384 步，大栅格上真实路径会更长，
   * 用产品值会把大栅格的测量全部判成"被截断"。
   */
  readonly maxPathSteps?: number;
  readonly onProgress?: (message: string) => void;
  readonly signal?: AbortSignal;
}

/** 挑一个接近目标格数的矩形，长宽比控制在 4:1 以内，避免出现 1×N 这类不真实的极端形状。 */
export function scaleToShape(cells: number): { width: number; height: number } {
  const width = Math.max(2, Math.round(Math.sqrt(cells)));
  const height = Math.max(2, Math.ceil(cells / width));
  return { width, height };
}

export const DEFAULT_GPU_CROSSOVER_SCALES: readonly number[] = [256, 1_024, 4_096, 16_384, 65_536];
/** 标定期的单次布线上限：给大栅格留出可测的余量，而不是沿用产品内的保守超时。 */
export const DEFAULT_CROSSOVER_DEADLINE_MS = 4_000;
/** 标定期允许的路径登记上限；产品缺省 384 会把大栅格的真实路径全部判成截断。 */
export const DEFAULT_CROSSOVER_MAX_PATH_STEPS = 4_096;
/**
 * 每个规模测多少条线。路由选择比较的是**稳态单位成本**，不是单次延迟：
 * 只跑一次会把 GPU 的固定派发/回读开销算成它的全部代价，得出"永远更慢"的假结论。
 */
const CROSSOVER_ROUTES_PER_SCALE = 24;

/**
 * 量出 GPU 与 CPU 的交叉规模。GPU 侧用真实 WebGPU 设备与生产着色器，CPU 侧用生产 A* 工作区，
 * 两边跑同一张合成栅格，各自按"连续多条线的单位耗时"比较。
 */
export async function measureGpuCrossover(options: PlannerGpuCrossoverOptions): Promise<PlannerGpuCrossoverReport> {
  const maximumCells = options.maximumCells ?? 65_536;
  const deadlineMs = options.deadlineMs ?? DEFAULT_CROSSOVER_DEADLINE_MS;
  const maxPathSteps = options.maxPathSteps ?? DEFAULT_CROSSOVER_MAX_PATH_STEPS;
  const points: PlannerGpuCrossoverPoint[] = [];
  const notes: string[] = [];
  const routing = new PlannerGpuRouting();
  let adapter: PlannerGpuCrossoverReport["adapter"];
  try {
    for (const cells of options.scales) {
      if (options.signal?.aborted) throw new DOMException("GPU 交叉点测量已取消", "AbortError");
      if (cells > maximumCells) break;
      const { width, height } = scaleToShape(cells);
      options.onProgress?.(`测量 ${width}×${height} 栅格的 GPU/CPU 交叉点…`);
      const problem = buildSyntheticProblem(width, height);
      const cpu = searchCpu(problem);
      if (cpu === null) { notes.push(`${width}×${height} 的 CPU 对照未能解出线路，跳过该规模`); continue; }
      // 稳态口径：连续测量若干条线，扣除第一条（含一次性初始化与缓冲分配）后取单位成本。
      const measured = await routing.measure(problem, CROSSOVER_ROUTES_PER_SCALE, deadlineMs, maxPathSteps);
      if (measured === null) {
        const reason = routing.measurementFailure ?? "未解出";
        notes.push(`${width}×${height} 的 GPU 未解出线路（${reason}），停止上探`);
        break;
      }
      const cpuMs = cpu.milliseconds;
      const ratio = cpuMs > 0 ? measured.milliseconds / cpuMs : Number.POSITIVE_INFINITY;
      points.push({ cells: width * height, width, height, pathCells: measured.cells, gpuMs: measured.milliseconds,
        cpuMs, ratio });
      adapter ??= routing.adapterInfo;
      notes.push(`${width}×${height}: GPU ${measured.milliseconds.toFixed(2)}ms / CPU ${cpuMs.toFixed(2)}ms（${ratio.toFixed(2)}×）`);
    }
  } finally {
    routing.dispose();
  }
  const profitable = points.filter(point => point.ratio < 1);
  const maxProfitableCells = profitable.length === 0 ? undefined
    : Math.max(...profitable.map(point => point.cells));
  if (maxProfitableCells === undefined) notes.push("未测到 GPU 更快的规模，保持保守缺省");
  return { measuredAt: Date.now(), points, maxProfitableCells,
    ...(adapter ? { adapter } : {}), notes };
}
