import { describe, expect, it } from "vitest";
import { createRenderDiagnosticRun, resolveRenderDiagnosticBaselineChange } from "@/renderer/scene/render-diagnostic-run";
import type { RenderDiagnosticFrame } from "@/shared/render-diagnostics";

function frame(startedAtMs: number): RenderDiagnosticFrame {
  return { startedAtMs, finishedAtMs: startedAtMs + 5, sceneSyncMs: 3, pixiRenderMs: 2,
    stages: { cargo: 1 }, counts: { drawCalls: 12, maskBuilds: 0 } };
}

describe("渲染对照阶段采集", () => {
  it("排除预热和跨阶段间隔，按真实帧间隔计算 FPS、P95 与长帧", () => {
    const run = createRenderDiagnosticRun("manual", "full", 0);
    run.record(frame(900), false);
    run.advance(2_000);
    for (const time of [2000, 2010, 2030, 2110]) run.record(frame(time), time === 2030);
    run.advance(7_000);
    run.record(frame(7_000), false);
    run.record(frame(7_020), true);
    run.advance(12_000);
    run.record(frame(12_000), false);
    run.record(frame(12_010), false);
    run.advance(17_000);
    expect(run.finished).toBe(true);
    expect(run.results).toHaveLength(3);
    expect(run.results[0]).toMatchObject({ frames: 4, p95FrameMs: 80, maximumFrameMs: 80, longFrames: 1,
      viewportChangedFrames: 1, sceneSync: { average: 3 }, pixiRender: { average: 2 },
      counts: { drawCalls: { average: 12, total: 48 } } });
    expect(run.results[0]!.fps).toBeCloseTo(3000 / 110);
    expect(run.results[1]!.fps).toBe(50);
    expect(run.results[2]!.fps).toBe(100);
  });

  it("短流程计划 73 秒，低帧率下仍保留四组完整时长和停止后 5 秒", () => {
    const run = createRenderDiagnosticRun("automatic", "full", 0);
    const groups: string[] = [];
    let now = 0;
    expect(run.protocol.phaseDurationsMs).toEqual({ warmup: 2000, "stationary-before": 5000,
      pan: 5000, "stationary-after": 5000, "stopped-recovery": 5000 });
    expect(run.protocol.tailWindowMs).toBe(2000);
    expect(run.progress(0).groups).toBe(4);
    expect(run.advance(1999)).toBe(false);
    for (let group = 0; group < 4; group += 1) {
      groups.push(run.condition);
      now += 2_300; run.advance(now);
      run.record(frame(now), false);
      run.record(frame(now + (group === 3 ? 40 : 20)), false);
      now += 5_200; run.advance(now);
      now += 5_300; run.advance(now);
      now += 5_100; run.advance(now);
    }
    expect(groups).toEqual(["full", "without-belt-cargo", "without-pipe-fluid", "full"]);
    const durations = run.protocol.phaseDurationsMs;
    expect(groups.length * (durations.warmup + durations["stationary-before"] + durations.pan + durations["stationary-after"])
      + durations["stopped-recovery"]).toBe(73_000);
    expect(run.results).toHaveLength(12);
    expect(run.results[9]!.repeatBaseline).toBe(true);
    expect(resolveRenderDiagnosticBaselineChange(run.results)).toBe(100);
    expect(run.finished).toBe(false);
    expect(run.phase).toBe("stopped-recovery");
    run.record(frame(now), false); run.record(frame(now + 20), false);
    expect(run.advance(now + 4_999)).toBe(false);
    run.advance(now + 5_000);
    expect(run.results).toHaveLength(13);
    expect(run.results[12]).toMatchObject({ phase: "stopped-recovery", completed: true, durationMs: 5000, fps: 50 });
    expect(run.finished).toBe(true);
  });

  it("自动平移按时间匀速往返，手动模式不移动相机", () => {
    const run = createRenderDiagnosticRun("automatic", "full", 0);
    run.advance(2000); run.advance(7000);
    expect(run.panOffset(7000, 400)).toBe(0);
    expect(run.panOffset(7000 + 5000 / 3, 400)).toBeCloseTo(400);
    expect(run.panOffset(7000 + 10000 / 3, 400)).toBeCloseTo(0);
    expect(run.panOffset(12000, 400)).toBeCloseTo(-400);
    expect(run.panOffset(13000, 400)).toBeCloseTo(-400);
    // 原来 100 px 幅度 / 10 秒周期的速度为 40 px/s；幅度翻倍后应为 80 px/s。
    // AI-CORRECTION 2026-09-16：本次幅度从 200 再翻倍至 400 px，速度从 80 提高至 240 px/s。
    expect(run.panOffset(8000, 400) - run.panOffset(7000, 400)).toBeCloseTo(240);
    run.advance(12000);
    expect(run.panOffset(12000, 400)).toBe(0);
    const manual = createRenderDiagnosticRun("manual", "without-pipe-fluid", 0);
    manual.advance(2000); manual.advance(7000);
    expect(manual.panOffset(8000, 400)).toBe(0);
  });

  it("取消保留部分阶段并明确标记未完成，不伪造空样本 FPS", () => {
    const run = createRenderDiagnosticRun("manual", "full", 0);
    run.advance(2000); run.record(frame(2000), false); run.cancel(); run.cancel();
    expect(run.results).toHaveLength(1);
    expect(run.results[0]).toMatchObject({ completed: false, frames: 1, fps: null, p95FrameMs: null });
    expect(resolveRenderDiagnosticBaselineChange(run.results)).toBeNull();
    expect(run.advance(90000)).toBe(false);
  });

  it("静止阶段残留惯性移动会标记无效，跨阶段恢复相机的首帧不计入移动", () => {
    const run = createRenderDiagnosticRun("manual", "full", 0);
    run.advance(2000);
    run.record(frame(2000), true);
    run.record(frame(2020), false);
    run.advance(7000);
    run.record(frame(7000), false);
    run.record(frame(7020), false);
    run.advance(12000);
    run.record(frame(12000), false);
    run.record(frame(12020), true);
    run.advance(17000);
    expect(run.results.map((phase) => phase.motionMatchesPhase)).toEqual([true, false, false]);
    expect(run.results.map((phase) => phase.viewportChangedFrames)).toEqual([0, 0, 1]);
  });

  it("短阶段逐秒保留空白窗口，末 2 秒不混入前期低帧率", () => {
    const run = createRenderDiagnosticRun("manual", "full", 0);
    run.advance(2000);
    for (let time = 2000; time < 3000; time += 100) run.record(frame(time), false);
    for (let time = 5000; time < 7000; time += 20) run.record(frame(time), false);
    run.advance(7000);
    const phase = run.results[0]!;
    expect(phase.durationMs).toBe(5000);
    expect(phase.windows).toHaveLength(5);
    expect(phase.windows[0]).toMatchObject({ offsetMs: 0, frames: 10, fps: 10, sceneSyncMs: 3, pixiRenderMs: 2 });
    expect(phase.windows[2]).toMatchObject({ offsetMs: 2000, frames: 0, fps: 0, sceneSyncMs: null });
    expect(phase.windows[4]).toMatchObject({ offsetMs: 4000, frames: 50, fps: 50 });
    expect(phase.tailFps).toBe(50);
    expect(phase.fps).toBeLessThan(25);
  });

  it("最终恢复阶段可以取消，保留部分时长和趋势，不伪装为已完成", () => {
    const run = createRenderDiagnosticRun("automatic", "full", 0);
    let now = 0;
    for (let group = 0; group < 4; group += 1) {
      for (const duration of [2000, 5000, 5000, 5000]) {
        now += duration; run.advance(now);
      }
    }
    expect(run.phase).toBe("stopped-recovery");
    run.record(frame(now), false); run.record(frame(now + 20), false);
    run.cancel(now + 1500);
    expect(run.finished).toBe(true);
    expect(run.results.at(-1)).toMatchObject({ phase: "stopped-recovery", completed: false, durationMs: 1500, tailFps: null });
    expect(run.results.at(-1)!.windows.at(-1)).toMatchObject({ durationMs: 500, frames: 0, fps: 0 });
  });
});
