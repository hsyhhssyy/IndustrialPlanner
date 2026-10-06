export interface PlannerResourceHints {
  readonly hardwareConcurrency?: number;
  readonly deviceMemory?: number;
  /**
   * 用户可覆盖的安全阀，只用于防止无界试探；它不是容量结论，也不代表机器实际能力。
   * 2026-10-06：此前这里用「核数×0.8-1」「核数-1」「内存/2GB」这类公式直接当上限，
   * 等价于写死常量，不同配置的机器会被误伤或浪费；现在容量一律由标定测量得出。
   */
  readonly safetyCeiling?: number;
}

export interface PlannerConcurrencySample {
  readonly at: number;
  readonly evaluations: number;
  readonly activeWorkers: number;
  readonly pendingVerifications: number;
  readonly lagMs: number;
  readonly pressure?: "nominal" | "fair" | "serious" | "critical";
}

/** 安全阀缺省值；只在没有标定结果、且用户没有指定上限时使用。 */
export const PLANNER_SAFETY_CEILING = 32;

/** 保守起点：未标定时从这里开始上探，由控制律逐窗加容直到收益不足或遇到压力。 */
export const PLANNER_CONSERVATIVE_START = 1;

/**
 * 2026-10-06：机器容量结论只来自基准测试（capacity-calibration / capacity-growth）。
 * 这个函数只回答「在拿到标定结果之前，允许试探到多高」，不再假装知道机器能力。
 */
export function plannerProbeCeiling(hints: PlannerResourceHints): number {
  const ceiling = hints.safetyCeiling;
  return Math.max(1, Math.min(PLANNER_SAFETY_CEILING, Number.isSafeInteger(ceiling) && ceiling! > 0 ? ceiling! : PLANNER_SAFETY_CEILING));
}

/** 并发控制参数；默认值即生产策略，测试与离线客户端可覆盖。 */
export interface PlannerConcurrencyPolicy {
  /** 目标并发：显式数值由用户指定，auto 时取容量上限。 */
  readonly target?: number | "auto";
  /**
   * 2026-10-06：经基准测试标定出的并发上限。
   * 浏览器不暴露 CPU/GPU 占用百分比，无法直接闭环控制占用率，
   * 因此先用基准测试量出「并发数 → 吞吐」曲线的膝盖点，再让本策略在该上限内自适应。
   * 已标定时它是上限，容量提示只作为缺失时的兜底。
   */
  readonly calibratedWorkers?: number;
  /** 爬升时把剩余空间按此比例一次性分配。 */
  readonly rampFraction: number;
  /** 退让时的相对降幅，例如 0.2 表示当前占用降低 20%。 */
  readonly shedFraction: number;
  /** 连续满窗仍卡顿的窗口数，达到后触发退让。 */
  readonly shedWindows: number;
  /** 观测窗口时长；窗口必须跑满才允许调整容量。 */
  readonly windowMs: number;
  /** 增容后吞吐未达到此倍数即视为没有收益。 */
  readonly gainThreshold: number;
  /** 收缩后的冷却时长，避免连续抖动。 */
  readonly cooldownMs: number;
  /** 压力观察的采样间隔。 */
  readonly pressureSampleIntervalMs: number;
}

export const DEFAULT_PLANNER_CONCURRENCY_POLICY: PlannerConcurrencyPolicy = Object.freeze({
  target: "auto",
  rampFraction: 0.25,
  shedFraction: 0.2,
  shedWindows: 2,
  windowMs: 4_000,
  gainThreshold: 1.05,
  cooldownMs: 4_000,
  pressureSampleIntervalMs: 1_000,
});

/**
 * 2026-10-06 并发策略重写：旧策略每次最多 +1，且要求 75% 窗口忙、延迟 <100ms 才敢加，
 * 无头客户端实测长期停在 1~2 个 Worker（CPU 占用约 20%）。
 * 现策略按用户确认的算力规则执行：窗口跑满后把「剩余空间 × rampFraction」一次分下去，
 * 压力信号持续时把当前占用相对降低 shedFraction；显式指定并发数时该数值就是目标。
 */
export class PlannerAutomaticConcurrency {
  target = 1;
  private windowStartedAt: number;
  private windowStartedEvaluations: number;
  private slowWindows = 0;
  private probing = false;
  private probeBaselineRate: number | null = null;
  private nextChangeAt = 0;
  /** 容量上限：target 显式指定时为该数值，否则为容量提示。 */
  readonly maximum: number;
  readonly policy: PlannerConcurrencyPolicy;
  private readonly requestedTarget: number | null;

  constructor(maximum: number, at: number, evaluations: number, policy: PlannerConcurrencyPolicy = DEFAULT_PLANNER_CONCURRENCY_POLICY) {
    this.policy = policy;
    const calibrated = Number.isSafeInteger(policy.calibratedWorkers) && policy.calibratedWorkers! >= 1
      ? policy.calibratedWorkers! : null;
    // AI-CORRECTION 2026-10-06：原先这里对 target 与 maximum 都取 Math.min(..., 32)。
    // 32 是与机型无关的写死常量：64 核机器标定出 64 通道也会被削到 32，标定结果形同作废。
    // 现在的边界只来自两处 —— 显式并发数（用户目标）与标定测量值（机器实测），
    // 无标定时的上界由 plannerProbeCeiling 的安全阀负责，不在控制律里再设常量。
    this.requestedTarget = typeof policy.target === "number" && Number.isSafeInteger(policy.target) && policy.target >= 1
      ? policy.target : null;
    this.maximum = Math.max(1, this.requestedTarget ?? calibrated ?? maximum);
    // 订正 2026-10-06：显式并发数必须**立即**生效，不能从 1 开始逐窗爬升。
    // 原实现让 target 恒从 1 起，而爬升要等观测窗口（缺省 4 秒）跑满；
    // 于是"用户指定 2 个通道"会退化成"先只用 1 个、4 秒后才到 2"，
    // 短任务里等于完全没按用户要求并发（task-sharding 的显式并发用例由此失败）。
    // 用户的显式要求不是需要试探的容量结论，因此直接作为起点；
    // 标定值不同：它是实测上限，起点仍保持保守，由控制律在窗口内爬升。
    this.target = this.requestedTarget ?? 1;
    this.windowStartedAt = at;
    this.windowStartedEvaluations = evaluations;
  }

  private resetWindow(sample: PlannerConcurrencySample): void {
    this.windowStartedAt = sample.at;
    this.windowStartedEvaluations = sample.evaluations;
  }

  /** 相对退让：当前占用降低 shedFraction，至少 1 个通道，并对齐到向上取整。 */
  private shed(): void {
    const next = Math.max(1, Math.floor(this.target * (1 - this.policy.shedFraction)));
    this.target = next >= this.target ? this.target - 1 : next;
  }

  /** 爬升：把剩余空间按 rampFraction 分配，至少 +1。 */
  private ramp(): void {
    const headroom = this.maximum - this.target;
    if (headroom <= 0) return;
    this.target += Math.max(1, Math.floor(headroom * this.policy.rampFraction));
  }

  observe(sample: PlannerConcurrencySample): number {
    const pressured = sample.lagMs >= 100 || sample.pressure === "serious" || sample.pressure === "critical";
    const elapsed = sample.at - this.windowStartedAt;
    if (elapsed < this.policy.windowMs) {
      // 窗口内只累计卡顿信号；容量调整必须等窗口跑满，避免用瞬时抖动改容量。
      if (pressured) this.slowWindows++;
      return this.target;
    }
    const rate = Math.max(0, sample.evaluations - this.windowStartedEvaluations) / elapsed;
    // 冷却期内既不爬升也不再退让，只累计卡顿信号并换窗；否则退回后下一窗立刻又爬升，形成 1↔2 抖动。
    // 冷却边界取闭区间：窗口起点正好等于 nextChangeAt 时仍算冷却内，否则探针会在同一时刻反复进退。
    if (sample.at <= this.nextChangeAt) {
      if (pressured) this.slowWindows++;
      this.resetWindow(sample);
      return this.target;
    }
    const gain = this.probeBaselineRate === null || this.probeBaselineRate <= 0 ? null : rate / this.probeBaselineRate;
    if (pressured) this.slowWindows++;
    else this.slowWindows = 0;
    // 持续卡顿才退让；偶发一次延迟不收缩，否则验证排队会把并发永久压在 1。
    if (this.slowWindows >= this.policy.shedWindows) {
      this.shed();
      this.slowWindows = 0;
      this.probing = false;
      this.probeBaselineRate = null;
      this.nextChangeAt = sample.at + this.policy.cooldownMs;
      this.resetWindow(sample);
      return this.target;
    }
    // 探测未兑现吞吐收益则退回一格并冷却，避免在无收益的容量上长期停留。
    if (this.probing && gain !== null && gain < this.policy.gainThreshold) {
      this.target = Math.max(1, this.target - 1);
      this.probing = false;
      this.nextChangeAt = sample.at + this.policy.cooldownMs;
      this.resetWindow(sample);
      return this.target;
    }
    if (sample.at >= this.nextChangeAt && this.target < this.maximum && rate > 0) {
      // 基线必须固定在「加容前的实测速率」：若先 ramp 再写基线，下一窗增益恒为 1.0，会在同一档反复进退。
      this.probeBaselineRate = rate;
      this.ramp();
      this.probing = true;
      this.slowWindows = 0;
      this.resetWindow(sample);
      return this.target;
    }
    this.probing = false;
    this.resetWindow(sample);
    return this.target;
  }
}

/** 浏览器侧容量提示；无法采到核心数时交给上限函数回退。 */
export function browserPlannerResources(): PlannerResourceHints {
  return typeof navigator === "undefined" ? {} : {
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  };
}

/** 压力观察是可选信号；权限或平台不支持时继续用吞吐和事件循环延迟。 */
export function observePlannerPressure(update: (value: PlannerConcurrencySample["pressure"]) => void,
  sampleIntervalMs = DEFAULT_PLANNER_CONCURRENCY_POLICY.pressureSampleIntervalMs): () => void {
  type Observer = { observe(source: "cpu", options: { sampleInterval: number }): Promise<void>; disconnect(): void };
  const Constructor = (globalThis as unknown as { PressureObserver?: new (callback: (records: Array<{ state: PlannerConcurrencySample["pressure"] }>) => void) => Observer }).PressureObserver;
  if (!Constructor) return () => undefined;
  let stopped = false;
  let observer: Observer | undefined;
  try {
    observer = new Constructor(records => { if (!stopped) update(records.at(-1)?.state); });
    void observer.observe("cpu", { sampleInterval: sampleIntervalMs }).catch(() => { observer?.disconnect(); });
  } catch { observer?.disconnect(); }
  return () => { stopped = true; observer?.disconnect(); };
}
