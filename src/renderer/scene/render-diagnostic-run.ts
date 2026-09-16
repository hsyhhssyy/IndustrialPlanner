import type {
  RenderDiagnosticCondition, RenderDiagnosticFrame, RenderDiagnosticMetric, RenderDiagnosticMode,
  RenderDiagnosticPhase, RenderDiagnosticPhaseResult, RenderDiagnosticProgress,
} from "@/shared/render-diagnostics";

const PHASES = ["warmup", "stationary-before", "pan", "stationary-after"] as const;
const RECOVERY_PHASES = [...PHASES, "stopped-recovery"] as const;
const DURATION: Record<RenderDiagnosticPhase, number> = {
  warmup: 2_000, "stationary-before": 5_000, pan: 5_000, "stationary-after": 5_000, "stopped-recovery": 5_000,
};
const PAN_CYCLE_MS = 20_000 / 3;
const TAIL_WINDOW_MS = 2_000;
// AI-REMOVED 2026-09-16:
// Reason: 自动流程移除建筑端口特效对照，缩短 Performance 录制。
// Trigger: 用户要求总时长少于 100 秒，去掉端口 on/off 特效测试。
// Evidence: 原自动序列包含 without-building-effects 独立组。
// Replacement: 下方四组 CONDITIONS；手动条件仍可单独采集。
// Risk: 自动报告不再比较建筑端口特效绘制成本。
// Human Review: Required
// Original code:
// const CONDITIONS: readonly RenderDiagnosticCondition[] = [
//   "full", "without-belt-cargo", "without-pipe-fluid", "without-building-effects", "full",
// ];
const CONDITIONS: readonly RenderDiagnosticCondition[] = [
  "full", "without-belt-cargo", "without-pipe-fluid", "full",
];

interface Aggregate { total: number; maximum: number }

/** 每个阶段独立计量；切层、预热以及跨阶段帧间隔均不进入样本。 */
export function createRenderDiagnosticRun(mode: RenderDiagnosticMode, condition: RenderDiagnosticCondition, nowMs: number) {
  const conditions = mode === "automatic" ? CONDITIONS : [condition];
  const results: RenderDiagnosticPhaseResult[] = [];
  let group = 0, phaseIndex = 0, phaseStartedAt = nowMs;
  let frames = 0, lastStartedAt: number | null = null, lastFinishedAt = nowMs;
  let intervals: number[] = [], viewportChangedFrames = 0;
  let scene: Aggregate = { total: 0, maximum: 0 }, pixi: Aggregate = { total: 0, maximum: 0 };
  let stages = new Map<string, Aggregate>(), counts = new Map<string, Aggregate>();
  let finished = false;
  let frameStarts: number[] = [];
  let windows = new Map<number, { frames: number; sceneSyncMs: number; pixiRenderMs: number }>();
  const readPhases = () => mode === "automatic" && group === conditions.length - 1 ? RECOVERY_PHASES : PHASES;

  const add = (value: Aggregate, sample: number): void => {
    value.total += sample; value.maximum = Math.max(value.maximum, sample);
  };
  const addMap = (target: Map<string, Aggregate>, samples: Readonly<Record<string, number>>): void => {
    for (const [key, sample] of Object.entries(samples)) {
      let value = target.get(key);
      if (!value) { value = { total: 0, maximum: 0 }; target.set(key, value); }
      add(value, sample);
    }
  };
  const metric = (value: Aggregate): RenderDiagnosticMetric => ({
    average: frames ? value.total / frames : 0, maximum: value.maximum, total: value.total,
  });
  const mapMetrics = (map: Map<string, Aggregate>): Record<string, RenderDiagnosticMetric> =>
    Object.fromEntries([...map].map(([key, value]) => [key, metric(value)]));
  const finishPhase = (completed: boolean, finishedAtMs: number): void => {
    const phase = readPhases()[phaseIndex]!;
    if (phase === "warmup") return;
    const sorted = [...intervals].sort((a, b) => a - b);
    const intervalTotal = intervals.reduce((sum, value) => sum + value, 0);
    const durationMs = Math.max(0, finishedAtMs - phaseStartedAt);
    const tail = frameStarts.filter((time) => time >= finishedAtMs - TAIL_WINDOW_MS);
    results.push({
      condition: conditions[group]!, repeatBaseline: mode === "automatic" && group === conditions.length - 1,
      phase, completed, frames, durationMs,
      fps: intervalTotal > 0 ? intervals.length * 1000 / intervalTotal : null,
      tailFps: durationMs >= TAIL_WINDOW_MS && tail.length > 1 && tail[tail.length - 1]! > tail[0]!
        ? (tail.length - 1) * 1000 / (tail[tail.length - 1]! - tail[0]!) : null,
      // 固定墙钟窗口保留无帧区间，避免长帧或卡住的时间从恢复趋势中消失。
      windows: Array.from({ length: Math.ceil(durationMs / 1_000) }, (_, index) => {
        const sample = windows.get(index);
        const elapsed = Math.min(1_000, durationMs - index * 1_000);
        return { offsetMs: index * 1_000, durationMs: elapsed, frames: sample?.frames ?? 0,
          fps: (sample?.frames ?? 0) * 1000 / elapsed,
          sceneSyncMs: sample?.frames ? sample.sceneSyncMs / sample.frames : null,
          pixiRenderMs: sample?.frames ? sample.pixiRenderMs / sample.frames : null };
      }),
      averageFrameMs: intervals.length ? intervalTotal / intervals.length : null,
      p95FrameMs: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1]! : null,
      maximumFrameMs: sorted.length ? sorted[sorted.length - 1]! : null,
      longFrames: intervals.filter((value) => value >= 50).length, viewportChangedFrames,
      motionMatchesPhase: frames > 1 && (phase === "pan" ? viewportChangedFrames > 0 : viewportChangedFrames === 0),
      sceneSync: metric(scene), pixiRender: metric(pixi), stages: mapMetrics(stages), counts: mapMetrics(counts),
    });
  };
  const resetSamples = (): void => {
    frames = 0; lastStartedAt = null; lastFinishedAt = phaseStartedAt; intervals = []; viewportChangedFrames = 0;
    frameStarts = []; windows = new Map();
    scene = { total: 0, maximum: 0 }; pixi = { total: 0, maximum: 0 }; stages = new Map(); counts = new Map();
  };

  return {
    protocol: { phaseDurationsMs: { ...DURATION }, panCycleMs: PAN_CYCLE_MS, trendWindowMs: 1_000, tailWindowMs: TAIL_WINDOW_MS },
    get finished() { return finished; },
    get condition() { return conditions[group]!; },
    get phase() { return readPhases()[phaseIndex]!; },
    get results(): readonly RenderDiagnosticPhaseResult[] { return results; },
    advance(timeMs: number): boolean {
      if (finished || timeMs - phaseStartedAt < DURATION[readPhases()[phaseIndex]!]) return false;
      finishPhase(true, timeMs);
      phaseIndex += 1;
      if (phaseIndex === readPhases().length) { group += 1; phaseIndex = 0; }
      if (group === conditions.length) { finished = true; return true; }
      phaseStartedAt = timeMs; resetSamples();
      return true;
    },
    record(frame: RenderDiagnosticFrame, viewportChanged: boolean): void {
      if (finished || readPhases()[phaseIndex] === "warmup") return;
      if (lastStartedAt !== null) {
        intervals.push(Math.max(0, frame.startedAtMs - lastStartedAt));
        if (viewportChanged) viewportChangedFrames += 1;
      }
      lastStartedAt = frame.startedAtMs; lastFinishedAt = frame.finishedAtMs; frames += 1;
      frameStarts.push(frame.startedAtMs);
      const index = Math.floor((frame.startedAtMs - phaseStartedAt) / 1_000);
      const window = windows.get(index) ?? { frames: 0, sceneSyncMs: 0, pixiRenderMs: 0 };
      window.frames += 1; window.sceneSyncMs += frame.sceneSyncMs; window.pixiRenderMs += frame.pixiRenderMs;
      windows.set(index, window);
      add(scene, frame.sceneSyncMs); add(pixi, frame.pixiRenderMs);
      addMap(stages, frame.stages); addMap(counts, frame.counts);
    },
    cancel(timeMs = lastFinishedAt): void { if (!finished) { finishPhase(false, timeMs); finished = true; } },
    panOffset(timeMs: number, amplitude: number): number {
      if (finished || readPhases()[phaseIndex] !== "pan" || mode !== "automatic") return 0;
      const elapsed = Math.min(DURATION.pan, Math.max(0, timeMs - phaseStartedAt));
      const progress = (elapsed % PAN_CYCLE_MS) / PAN_CYCLE_MS;
      // 匀速往返两侧，起终点一致；每组路径只由时间决定，不随帧率改变速度。
      // 2026-09-16 补充：20 秒内完成两次 10 秒往返；幅度翻倍后速度同步翻倍，不随采集时长被稀释。
      // AI-CORRECTION 2026-09-16：短流程改为 5 秒移动；幅度再翻倍、周期改为 20/3 秒，速度为上一版 3 倍。
      // 5 秒结束时接近另一侧极值，不再完成整周期；Session 在随后静止阶段恢复初始视口。
      return amplitude * (progress < .25 ? progress * 4 : progress < .75 ? 2 - progress * 4 : progress * 4 - 4);
    },
    progress(timeMs: number): RenderDiagnosticProgress {
      return { mode, condition: conditions[group]!, phase: readPhases()[phaseIndex]!,
        repeatBaseline: mode === "automatic" && group === conditions.length - 1,
        group: group + 1, groups: conditions.length,
        remainingSeconds: Math.max(0, Math.ceil((DURATION[readPhases()[phaseIndex]!] - timeMs + phaseStartedAt) / 1000)) };
    },
  };
}

export function resolveRenderDiagnosticBaselineChange(phases: readonly RenderDiagnosticPhaseResult[]): number | null {
  const first = phases.find((value) => value.condition === "full" && !value.repeatBaseline && value.phase === "stationary-before" && value.completed);
  const last = phases.find((value) => value.repeatBaseline && value.phase === "stationary-before" && value.completed);
  if (!first?.averageFrameMs || last?.averageFrameMs == null) return null;
  return (last.averageFrameMs / first.averageFrameMs - 1) * 100;
}
