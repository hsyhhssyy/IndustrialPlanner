/** 性能工具统一数据模型；sim 与 eda 共用，不再各自维护一套结果格式。 */

export type PerfSuite = "sim" | "eda-core" | "eda-browser";

export type PerfAccounting = "exact" | "upper-bound" | "mixed";

export interface PerfPhaseTimings {
  readonly searchMs: number | null;
  readonly verificationMs: number | null;
  /** 墙钟中未被算法搜索或仿真验收覆盖的部分，包含 Worker 调度与页面轮询。 */
  readonly schedulerMs: number | null;
}

export interface PerfGpuInfo {
  readonly requested: boolean;
  readonly hardware: boolean | null;
  readonly fallback: boolean | null;
  readonly adapter: string | null;
}

export interface PerfSample {
  readonly index: number;
  readonly wallMs: number;
  /** 有效计算时长；EDA 取 generationMs + verificationMs，sim 等于 wallMs。 */
  readonly activeMs: number | null;
  readonly evaluations: number | null;
  readonly attempts: number | null;
  /** 总吞吐，分母包含搜索与仿真验收。 */
  readonly evaluationsPerSecond: number | null;
  /** 纯算法搜索吞吐；与总吞吐分开，避免验证阶段变化污染算法速度判断。 */
  readonly searchEvaluationsPerSecond: number | null;
  readonly accounting: PerfAccounting | null;
  readonly phases: PerfPhaseTimings | null;
  readonly outcome: string | null;
  readonly error: string | null;
  readonly details: Record<string, unknown>;
}

export interface PerfEnvironment {
  readonly cpu: string;
  readonly logicalCpus: number;
  readonly availableParallelism: number;
  readonly node: string;
  readonly platform: string;
  readonly arch: string;
  readonly totalMemoryMb: number;
  readonly affinity: number | null;
  readonly gpu: PerfGpuInfo | null;
}

export interface PerfRunSummary {
  readonly wallMsMedian: number | null;
  readonly activeMsMedian: number | null;
  readonly evaluationsMedian: number | null;
  readonly evaluationsPerSecondMedian: number | null;
  readonly searchEvaluationsPerSecondMedian: number | null;
  readonly searchMsMedian: number | null;
  readonly verificationMsMedian: number | null;
  readonly schedulerMsMedian: number | null;
  readonly wallMsCv: number | null;
}

export interface PerfRun {
  readonly formatVersion: 1;
  readonly runId: string;
  readonly suite: PerfSuite;
  readonly scenario: string;
  readonly commit: string;
  readonly dirty: boolean;
  readonly options: Record<string, unknown>;
  readonly environment: PerfEnvironment;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly samples: readonly PerfSample[];
  readonly summary: PerfRunSummary;
}

/** perf 场景只声明负载，不声明质量门槛；面积与首解验收仍由 EDA 回归负责。 */
export interface EdaPerfScenario {
  readonly id: string;
  readonly caseId: string;
  /** 总提案预算，按 planner-runner 的每轮上限切分。 */
  readonly localEvaluations: number;
  readonly attempts: number;
  readonly candidateSeconds: number;
  readonly verificationSeconds: number;
  readonly startVariant: number;
  readonly gpu: boolean;
  /** 仅浏览器模式使用；auto 依赖机器，报告中必须记录实际活动 Worker 数。 */
  readonly concurrency: "auto" | number;
}
