import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { SimulationEngineKind } from "@/domain/simulation";
import { plannerProbeCeiling, PLANNER_SAFETY_CEILING, type PlannerResourceHints } from "@/blueprint-planner/automatic-concurrency";
import { pickPlateau, stepUpThroughput } from "./capacity-growth";

/** 单个并发档位的实测吞吐；lagMs 是主线程事件循环延迟，用于识别"已到算力天花板"。 */
export interface PlannerCapacityPoint {
  readonly workers: number;
  readonly evaluations: number;
  readonly windowMs: number;
  readonly evaluationsPerSecond: number;
  /** 相对上一档的吞吐倍数；首档为 1。 */
  readonly gain: number;
  readonly lagMs: number;
}

/** 一个请求在某个并发档位下的测量结果，由调用方注入具体执行方式（浏览器 Worker 或 Node Worker）。 */
export interface PlannerCapacityProbe {
  readonly workers: number;
  readonly windowMs: number;
  readonly evaluations: number;
  readonly lagMs: number;
}

export interface PlannerCapacityProbeOptions {
  readonly request: BlueprintPlannerRequest;
  readonly engineKind: SimulationEngineKind;
  readonly workers: number;
  readonly windowMs: number;
  readonly evaluationsPerWindow: number;
  readonly signal?: AbortSignal;
}

export interface PlannerCapacityReport {
  readonly measuredAt: number;
  readonly hardware: PlannerResourceHints;
  /** 保守容量提示，作为标定结果的下界参照。 */
  readonly conservativeLimit: number;
  readonly points: readonly PlannerCapacityPoint[];
  /** 标定得到的并发上限：吞吐膝盖点。 */
  readonly concurrentWorkers: number;
  /** 标定得到的 GPU 布线交叉点（路由边界格数）；未测得时为 undefined。 */
  readonly gpuCrossoverCells?: number;
  readonly notes: readonly string[];
}

export interface PlannerCapacityCalibrationOptions {
  readonly request: BlueprintPlannerRequest;
  readonly engineKind: SimulationEngineKind;
  readonly confirm: (message: string) => Promise<boolean>;
  readonly onProgress?: (message: string) => void;
  readonly resourceHints?: PlannerResourceHints;
  /** 逐档窗口时长；默认 4 秒，与调度策略的观测窗口一致。 */
  readonly windowMs?: number;
  /** 每档派发的提案数；过小会让吞吐测量被调度开销淹没。 */
  readonly evaluationsPerWindow?: number;
  /** 最大探测档位数，防止在超大核心数机器上跑太久。 */
  readonly maxLevels?: number;
  readonly signal?: AbortSignal;
}

const DEFAULT_WINDOW_MS = 4_000;
const DEFAULT_EVALUATIONS_PER_WINDOW = 20_000;
const DEFAULT_MAX_LEVELS = 6;
/** 吞吐增益低于该值即认为已到膝盖点，再增加并发不划算。 */
const KNEE_GAIN = 1.1;

/**
 * 2026-10-06：浏览器不暴露 CPU/GPU 占用百分比，无法直接闭环控制占用率。
 * 因此先做一次基准测试量出「并发数 → 实测吞吐」曲线，取膝盖点作为并发上限，
 * 之后仍由既有调度策略在该上限内自适应（爬升按剩余空间分配、压力时相对退让）。
 */
export async function calibratePlannerCapacity(probe: (options: PlannerCapacityProbeOptions) => Promise<PlannerCapacityProbe>,
  options: PlannerCapacityCalibrationOptions): Promise<PlannerCapacityReport> {
  const hints = options.resourceHints ?? {};
  const conservativeLimit = plannerProbeCeiling(hints);
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const evaluationsPerWindow = options.evaluationsPerWindow ?? DEFAULT_EVALUATIONS_PER_WINDOW;
  const notes: string[] = [];
  const estimatedMinutes = Math.max(1, Math.ceil((options.maxLevels ?? DEFAULT_MAX_LEVELS) * windowMs / 60_000));
  const agreed = await options.confirm(`基准测试将从保守并发开始逐档上探，约需 ${estimatedMinutes} 分钟，`
    + `期间本机 CPU 会被占满。测试只读取算力，不修改生产方案与蓝图。是否继续？`);
  if (!agreed) throw new Error("用户取消算力基准测试。");

  const points: PlannerCapacityPoint[] = [];
  // 2026-10-06：改为"从保守起点按档上探、增益不足即停"，上限由机器实测给出，
  // 不再用「核数×系数」这类公式预设档位数量或容量结论。
  const growth = await stepUpThroughput(async workers => {
    const sample = await probe({ request: options.request, engineKind: options.engineKind, workers,
      windowMs, evaluationsPerWindow, signal: options.signal });
    const evaluationsPerSecond = sample.windowMs > 0 ? sample.evaluations / (sample.windowMs / 1000) : 0;
    points.push({ workers, evaluations: sample.evaluations, windowMs: sample.windowMs, evaluationsPerSecond,
      gain: 1, lagMs: sample.lagMs });
    return { throughput: evaluationsPerSecond };
  }, { start: 1, ceiling: Math.max(1, conservativeLimit > 1 ? conservativeLimit : PLANNER_SAFETY_CEILING),
    minGain: KNEE_GAIN, signal: options.signal, onProgress: options.onProgress });
  // 增益按最终序列回填，保持报告自洽。
  for (let index = 0; index < points.length; index++) {
    const previous = points[index - 1];
    (points[index] as { gain: number }).gain = previous && previous.evaluationsPerSecond > 0
      ? points[index]!.evaluationsPerSecond / previous.evaluationsPerSecond : 1;
  }
  notes.push(growth.reason);
  const over = points.find(point => point.lagMs >= 100);
  if (over) notes.push(`${over.workers} 通道时主线程延迟 ${Math.round(over.lagMs)}ms，需关注交互流畅度。`);
  return { measuredAt: Date.now(), hardware: hints, conservativeLimit, points, concurrentWorkers: growth.best, notes };
}

/** 由吞吐曲线取膝盖点；导出供离线报告与测试复用。 */
export function capacityKnee(points: readonly PlannerCapacityPoint[], fallback: number): number {
  return pickPlateau(points.map(point => ({ value: point.workers, throughput: point.evaluationsPerSecond, gain: point.gain })),
    fallback, KNEE_GAIN).best;
}
