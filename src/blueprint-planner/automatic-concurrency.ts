export interface PlannerResourceHints {
  readonly hardwareConcurrency?: number;
  readonly deviceMemory?: number;
}

export interface PlannerConcurrencySample {
  readonly at: number;
  readonly evaluations: number;
  readonly activeWorkers: number;
  readonly pendingVerifications: number;
  readonly lagMs: number;
  /** 当前阶段累计占用的 Worker 毫秒，包含在途任务；避免短批次交接被误认为空闲。 */
  readonly busyMs?: number;
  readonly pressure?: "nominal" | "fair" | "serious" | "critical";
}

/** 容量提示只给保守上限，不能解释为整机空闲 CPU 或可用内存。 */
// 订正 2026-10-06：这是搜索与验证共用的资源安全阀；实际并发由在线吞吐决定。
// 按每通道 256 MiB、半数粗略内存留给本任务预算，取代每 GiB 只允许一个 Worker。
// 该预留是保护性估计，浏览器不能据此保证整机剩余内存；仍需响应延迟与压力退让。
// AI-CORRECTION 2026-10-13：CPU 搜索与验收通道共用最多 512MiB 的预算；
// 硬件内存再大也不扩张网页预算，其余内存留给主线程、GPU 与浏览器基础开销。
// 每通道仍按 256MiB 保护性估计；Windows 故障任务以两通道验证内存及吞吐。
export function plannerConcurrencyLimit(hints: PlannerResourceHints): number {
  const cores = Number.isSafeInteger(hints.hardwareConcurrency) && hints.hardwareConcurrency! > 0 ? hints.hardwareConcurrency! : 2;
  const memory = Number.isFinite(hints.deviceMemory) && hints.deviceMemory! > 0 ? hints.deviceMemory! : 4;
  return Math.max(1, Math.min(32, Math.floor(cores * 0.8) - 1, Math.floor(Math.min(512, memory * 1024 * 0.5) / 256)));
}

// AI-REMOVED 2026-10-06:
// Reason: 单步爬升过慢，快批次交接会被采样成空闲，且缺少缓存起点的重新测量。
// Trigger: 用户要求吸收 PR 的 CPU 实测并发思路。
// Evidence: 32 线程实测仅用到 8 路；PR 的多步爬升只退一步会在无收益时继续加容。
// Replacement: 下方 PlannerAutomaticConcurrency，保留原资源压力保护并完整回退探测。
// Risk: 调度次序变化，必须验证预算与产物质量。
// Human Review: Required
// Original code:
// /** 小步试探，以完整窗口吞吐决定保留；响应变差时快速收缩，冷却后允许重新探测。 */
// export class PlannerAutomaticConcurrency {
//   target = 1;
//   private startedAt: number;
//   private startedEvaluations: number;
//   private busySamples = 0;
//   private samples = 0;
//   private baselineRate: number | null = null;
//   private probing = false;
//   private nextProbeAt = 0;
//   private slowSamples = 0;
//
//   constructor(readonly maximum: number, at: number, evaluations: number) {
//     this.startedAt = at; this.startedEvaluations = evaluations;
//   }
//
//   private reset(sample: PlannerConcurrencySample): void {
//     this.startedAt = sample.at; this.startedEvaluations = sample.evaluations;
//     this.busySamples = 0; this.samples = 0;
//   }
//
//   observe(sample: PlannerConcurrencySample): number {
//     const duration = sample.at - this.startedAt;
//     // 验证积压由 Host 暂停领批；一次卡顿和验证队列均不代表 CPU 容量耗尽。
//     this.slowSamples = sample.lagMs >= 100 ? this.slowSamples + 1 : 0;
//     // AI-REMOVED 2026-10-03:
//     // Reason: 瞬时卡顿与串行验证会反复刷新冷却，空闲机器被长期锁在单 Worker。
//     // Trigger: Windows 真机并发在 0/1 间切换。Evidence: before-desktop-02 决策采样。
//     // Replacement: 连续三次响应延迟或 CPU 压力收缩；验证限流位于 Host.claim。
//     // Risk: 最多三个采样周期后响应持续卡顿。Human Review: Required
//     // Original code:
//     // if (sample.lagMs >= 100 || sample.pressure === "serious" || sample.pressure === "critical" || sample.pendingVerifications >= 2) {
//     if (this.slowSamples >= 3 || sample.pressure === "serious" || sample.pressure === "critical") {
//       this.target = Math.max(1, this.target - Math.max(1, Math.floor(this.target / 4)));
//       this.probing = false; this.baselineRate = null; this.nextProbeAt = sample.at + 4_000; this.reset(sample);
//       return this.target;
//     }
//     this.samples++;
//     if (sample.activeWorkers >= this.target) this.busySamples++;
//     if (duration < 4_000) return this.target;
//     const rate = Math.max(0, sample.evaluations - this.startedEvaluations) / duration;
//     const busy = this.busySamples >= this.samples * 0.75;
//     if (this.probing && this.baselineRate !== null && rate < this.baselineRate * 1.05) {
//       this.target = Math.max(1, this.target - 1);
//       this.nextProbeAt = sample.at + 8_000;
//     } else if (busy && rate > 0 && sample.lagMs < 100
//       && sample.at >= this.nextProbeAt && this.target < this.maximum) {
//       this.baselineRate = rate;
//       this.target++;
//       this.probing = true;
//       this.reset(sample);
//       return this.target;
//     }
//     this.probing = false; this.baselineRate = rate; this.reset(sample);
//     return this.target;
//   }
// }

// AI-REMOVED 2026-10-07:
// Reason: 频繁加压和连续退让没有稳定观测阶段，主线程延迟反复覆盖吞吐判断。
// Trigger: 用户要求以长时间平均尝试数选择并发，授权修改并实测。
// Evidence: Windows 13 次缩容有 11 次由延迟触发，约三秒内 20→15→12→9。
// Replacement: 下方 PlannerAutomaticConcurrency 的加压、邻档复测与稳定保持。
// Risk: 选档窗口改变；需验证长时吞吐、压力退让和预算守恒。
// Human Review: Required
// Original code:
// /** 在线测量单个阶段的吞吐；搜索与验证各自测量，由 Host 共用一个资源上限。 */
// export class PlannerAutomaticConcurrency {
//   target: number;
//   /** 只记录已观测的档位，不缓存尚未验证的增容。 */
//   confirmedTarget = 1;
//   private startedAt: number;
//   private startedEvaluations: number;
//   private startedBusyMs = 0;
//   private busySamples = 0;
//   private samples = 0;
//   private slowSamples = 0;
//   private nextProbeAt = 0;
//   private step: number | null = null;
//   private revalidate: boolean;
//   private probe: { target: number; rate: number; direction: "up" | "down" } | null = null;
//
//   constructor(readonly maximum: number, at: number, evaluations: number, initialTarget = 1) {
//     this.target = Math.max(1, Math.min(maximum, Number.isSafeInteger(initialTarget) ? initialTarget : 1));
//     this.revalidate = this.target > 1;
//     this.startedAt = at; this.startedEvaluations = evaluations;
//   }
//
//   private reset(sample: PlannerConcurrencySample): void {
//     this.startedAt = sample.at; this.startedEvaluations = sample.evaluations;
//     this.startedBusyMs = sample.busyMs ?? 0;
//     this.busySamples = 0; this.samples = 0;
//   }
//
//   observe(sample: PlannerConcurrencySample): number {
//     this.slowSamples = sample.lagMs >= 100 ? this.slowSamples + 1 : 0;
//     if (this.slowSamples >= 3 || sample.pressure === "serious" || sample.pressure === "critical") {
//       this.target = Math.max(1, this.target - Math.max(1, Math.floor(this.target / 4)));
//       this.confirmedTarget = Math.min(this.confirmedTarget, this.target);
//       this.probe = null; this.revalidate = false; this.nextProbeAt = sample.at + 4_000;
//       this.reset(sample);
//       return this.target;
//     }
//     this.samples++;
//     if (sample.activeWorkers >= this.target) this.busySamples++;
//     const duration = sample.at - this.startedAt;
//     if (duration < 4_000) return this.target;
//     const rate = Math.max(0, sample.evaluations - this.startedEvaluations) / duration;
//     const busy = sample.busyMs === undefined ? this.busySamples >= this.samples * 0.75
//       : sample.busyMs - this.startedBusyMs >= duration * this.target * 0.75;
//     this.reset(sample);
//     // 队列缺工作、被另一阶段占用或尚无完成计数时，不把低吞吐解释为容量结论。
//     if (!busy || rate <= 0 || sample.lagMs >= 100) return this.target;
//     if (this.probe) {
//       const previous = this.probe;
//       this.probe = null;
//       if (previous.direction === "down") {
//         // 缓存只给起点：减半仍保留 95% 吞吐时采用较少通道，否则恢复原档。
//         if (rate < previous.rate * 0.95) this.target = previous.target;
//         this.confirmedTarget = this.target;
//         this.nextProbeAt = sample.at + 8_000;
//         return this.target;
//       }
//       if (rate < previous.rate * 1.05) {
//         this.step = Math.max(1, Math.floor((this.target - previous.target) / 2));
//         this.target = previous.target;
//         this.confirmedTarget = this.target;
//         this.nextProbeAt = sample.at + 8_000;
//         return this.target;
//       }
//     }
//     this.confirmedTarget = this.target;
//     if (sample.at < this.nextProbeAt) return this.target;
//     if (this.revalidate) {
//       this.revalidate = false;
//       this.probe = { target: this.target, rate, direction: "down" };
//       this.target = Math.max(1, Math.floor(this.target / 2));
//     } else if (this.target < this.maximum) {
//       this.probe = { target: this.target, rate, direction: "up" };
//       this.target = Math.min(this.maximum, this.target + (this.step ?? Math.max(1, Math.ceil(this.target / 2))));
//     }
//     return this.target;
//   }
// }
//

/** 在线测量单个阶段的吞吐；搜索与验证各自测量，由 Host 共用一个资源上限。 */
// 订正 2026-10-07：冷启动加压、平台附近减容复测、稳定保持；不再周期性重复上探。
export class PlannerAutomaticConcurrency {
  target: number;
  /** 只记录已观测的档位，不缓存尚未验证的增容。 */
  confirmedTarget = 1;
  private startedAt: number;
  private startedEvaluations: number;
  private startedBusyMs = 0;
  private busySamples = 0;
  private samples = 0;
  private slowSamples = 0;
  private settleUntil: number;
  private settling = true;
  private retreatAfter = 0;
  private holdUntil = 0;
  private lowWindows = 0;
  private windows: Array<{ evaluations: number; duration: number }> = [];
  private mode: "ramp" | "trim" | "hold";
  private best: { target: number; rate: number } | null = null;

  constructor(readonly maximum: number, at: number, evaluations: number, initialTarget = 1) {
    this.target = Math.max(1, Math.min(maximum, Number.isSafeInteger(initialTarget) ? initialTarget : 1));
    this.mode = this.target > 1 ? "trim" : "ramp";
    this.startedAt = at; this.startedEvaluations = evaluations;
    this.settleUntil = at + 1000;
  }

  private reset(sample: PlannerConcurrencySample): void {
    this.startedAt = sample.at; this.startedEvaluations = sample.evaluations;
    this.startedBusyMs = sample.busyMs ?? 0;
    this.busySamples = 0; this.samples = 0;
  }

  private change(target: number, sample: PlannerConcurrencySample): number {
    this.target = Math.max(1, Math.min(this.maximum, target));
    this.settling = true; this.settleUntil = sample.at + 1000;
    this.windows = []; this.slowSamples = 0; this.lowWindows = 0;
    this.reset(sample);
    return this.target;
  }

  private hold(sample: PlannerConcurrencySample): number {
    this.mode = "hold"; this.holdUntil = sample.at + 30_000;
    this.lowWindows = 0;
    return this.target;
  }

  private trim(sample: PlannerConcurrencySample): number {
    const best = this.best!;
    this.mode = "trim";
    if (best.target === 1) { this.change(1, sample); return this.hold(sample); }
    return this.change(best.target - (best.target > 8 ? 2 : 1), sample);
  }

  observe(sample: PlannerConcurrencySample): number {
    // 普通界面延迟不否决吞吐窗口；持续明显卡顿和系统压力仍是独立保护信号。
    this.slowSamples = sample.lagMs >= 500 ? this.slowSamples + 1 : 0;
    const pressure = sample.pressure === "serious" || sample.pressure === "critical";
    if ((this.slowSamples >= 3 || pressure) && sample.at >= this.retreatAfter) {
      this.retreatAfter = sample.at + 10_000;
      this.best = null;
      this.change(this.target - Math.max(1, Math.floor(this.target / 4)), sample);
      this.confirmedTarget = Math.min(this.confirmedTarget, this.target);
      return this.hold(sample);
    }
    if (this.settling) {
      // 等上档冷启动或下档在途批次结束；过渡计数不参与新档位比较。
      if (sample.at >= this.settleUntil && sample.activeWorkers <= this.target) this.settling = false;
      this.reset(sample);
      return this.target;
    }
    this.samples++;
    if (sample.activeWorkers >= this.target) this.busySamples++;
    const duration = sample.at - this.startedAt;
    if (duration < 3000) return this.target;
    const evaluations = Math.max(0, sample.evaluations - this.startedEvaluations);
    const busy = sample.busyMs === undefined ? this.busySamples >= this.samples * 0.75
      : sample.busyMs - this.startedBusyMs >= duration * this.target * 0.75;
    this.reset(sample);
    // 验证占用、队列缺工作时不能归因于并发；只比较连续有效窗口。
    if (!busy || evaluations <= 0) { this.windows = []; return this.target; }
    this.windows.push({ evaluations, duration });
    if (this.windows.length < 2) return this.target;
    const rate = this.windows.reduce((sum, value) => sum + value.evaluations, 0)
      / this.windows.reduce((sum, value) => sum + value.duration, 0);
    this.windows = [];
    if (this.mode === "hold") {
      if (this.best === null) {
        this.best = { target: this.target, rate }; this.confirmedTarget = this.target;
        return this.target;
      }
      this.lowWindows = rate < this.best.rate * 0.8 ? this.lowWindows + 1 : 0;
      if (sample.at < this.holdUntil || this.lowWindows < 2) return this.target;
      // 持续退化后只在邻档有限复测；不会把偶发消息峰谷当作重新启动的理由。
      this.best = { target: this.target, rate }; this.mode = "ramp";
      if (this.target === this.maximum) return this.trim(sample);
      return this.change(this.target + (this.target > 8 ? 2 : 1), sample);
    }
    if (this.mode === "trim") {
      // 会话缓存仍需测量：先获得当前基线，再试少一至两个通道。
      if (this.best === null) { this.best = { target: this.target, rate }; this.confirmedTarget = this.target; return this.trim(sample); }
      if (rate >= this.best.rate * 0.97) {
        this.best = { target: this.target, rate }; this.confirmedTarget = this.target;
      } else {
        this.change(this.best.target, sample); this.confirmedTarget = this.best.target;
      }
      return this.hold(sample);
    }
    if (this.best !== null && rate < this.best.rate * 1.05) return this.trim(sample);
    this.best = { target: this.target, rate }; this.confirmedTarget = this.target;
    if (this.target === this.maximum) return this.trim(sample);
    return this.change(this.target < 8 ? this.target * 2 : this.target + Math.ceil(this.target / 2), sample);
  }
}

/** 仅在本 Host 会话复用相同请求的观测；不写任务文件，不跨机器或版本持久化。 */
export class PlannerConcurrencyMemory {
  private readonly entries = new Map<string, { target: number; at: number }>();

  read(key: string, at: number): number {
    const entry = this.entries.get(key);
    if (!entry || at - entry.at > 10 * 60_000) { this.entries.delete(key); return 1; }
    return entry.target;
  }

  remember(key: string, target: number, at: number): void {
    this.entries.delete(key);
    this.entries.set(key, { target, at });
    if (this.entries.size > 32) this.entries.delete(this.entries.keys().next().value!);
  }
}

export function browserPlannerResources(): PlannerResourceHints {
  return typeof navigator === "undefined" ? {} : {
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  };
}

/** 压力观察是可选信号；权限或平台不支持时继续用吞吐和事件循环延迟。 */
export function observePlannerPressure(update: (value: PlannerConcurrencySample["pressure"]) => void): () => void {
  type Observer = { observe(source: "cpu", options: { sampleInterval: number }): Promise<void>; disconnect(): void };
  const Constructor = (globalThis as unknown as { PressureObserver?: new (callback: (records: Array<{ state: PlannerConcurrencySample["pressure"] }>) => void) => Observer }).PressureObserver;
  if (!Constructor) return () => undefined;
  let stopped = false;
  let observer: Observer | undefined;
  try {
    observer = new Constructor(records => { if (!stopped) update(records.at(-1)?.state); });
    void observer.observe("cpu", { sampleInterval: 1000 }).catch(() => { observer?.disconnect(); });
  } catch { observer?.disconnect(); }
  return () => { stopped = true; observer?.disconnect(); };
}
