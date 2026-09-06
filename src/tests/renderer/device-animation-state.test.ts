import { describe, expect, it } from "vitest";

import type { DeviceSpriteAnimationDefinition } from "@/domain/registry";
import { DeviceAnimationState } from "@/renderer/sprites/device-animation-state";

function createDefinition(
  closeIdleMode: DeviceSpriteAnimationDefinition["closeIdleMode"] = "loop",
): DeviceSpriteAnimationDefinition {
  return {
    clips: {
      open: { rows: 1, columns: 2 },
      open_idle: { rows: 1, columns: 3 },
      close: { rows: 1, columns: 2 },
      close_idle: { rows: 1, columns: 3 },
    },
    closeIdleMode,
  };
}

function expectFrame(
  state: DeviceAnimationState,
  stage: DeviceAnimationState["stage"],
  frameIndex: number,
): void {
  expect({ stage: state.stage, frameIndex: state.frameIndex }).toEqual({ stage, frameIndex });
}

describe("DeviceAnimationState", () => {
  it("按初始工作目标从开启或关闭待机的第零帧开始", () => {
    expectFrame(new DeviceAnimationState(createDefinition(), true), "open", 0);
    expectFrame(new DeviceAnimationState(createDefinition(), false), "close_idle", 0);
  });

  it("每帧默认持续 100ms，并完整展示过渡末帧", () => {
    const state = new DeviceAnimationState(createDefinition(), true);
    state.advance(99);
    expectFrame(state, "open", 0);
    state.advance(1);
    expectFrame(state, "open", 1);
    state.advance(99);
    expectFrame(state, "open", 1);
    state.advance(1);
    expectFrame(state, "open_idle", 0);
    state.advance(299);
    expectFrame(state, "open_idle", 2);
    state.advance(1);
    expectFrame(state, "open_idle", 0);
  });

  it("开启过渡中停止时仍完整播放开启和至少一轮工作待机", () => {
    const state = new DeviceAnimationState(createDefinition(), true);
    state.advance(25);
    state.setDesiredWorking(false);
    state.advance(174);
    expectFrame(state, "open", 1);
    state.advance(1);
    expectFrame(state, "open_idle", 0);
    state.advance(299);
    expectFrame(state, "open_idle", 2);
    state.advance(1);
    expectFrame(state, "close", 0);
  });

  it.each([0, 1, 2])("工作待机第 %i 帧停止只在当前轮次末切换", (frame) => {
    const state = new DeviceAnimationState(createDefinition(), true);
    state.advance(200 + frame * 100 + 25);
    state.setDesiredWorking(false);
    state.advance(274 - frame * 100);
    expectFrame(state, "open_idle", 2);
    state.advance(1);
    expectFrame(state, "close", 0);
  });

  it.each(["loop", "hold-last"] as const)(
    "关闭过渡中重启时仍完整播放关闭和一轮关闭待机（%s）",
    (mode) => {
      const state = new DeviceAnimationState(createDefinition(mode), true);
      state.advance(200);
      state.setDesiredWorking(false);
      state.advance(425);
      expectFrame(state, "close", 1);
      state.setDesiredWorking(true);
      state.advance(74);
      expectFrame(state, "close", 1);
      state.advance(1);
      expectFrame(state, "close_idle", 0);
      state.advance(299);
      expectFrame(state, "close_idle", 2);
      state.advance(1);
      expectFrame(state, "open", 0);
    },
  );

  it.each([
    { mode: "loop" as const, frame: 0 },
    { mode: "loop" as const, frame: 1 },
    { mode: "loop" as const, frame: 2 },
    { mode: "hold-last" as const, frame: 0 },
    { mode: "hold-last" as const, frame: 1 },
    { mode: "hold-last" as const, frame: 2 },
  ])("关闭待机第 $frame 帧重启须等当前轮次末（$mode）", ({ mode, frame }) => {
    const state = new DeviceAnimationState(createDefinition(mode), false);
    state.advance(frame * 100 + 25);
    state.setDesiredWorking(true);
    state.advance(274 - frame * 100);
    expectFrame(state, "close_idle", 2);
    state.advance(1);
    expectFrame(state, "open", 0);
  });

  it("关闭待机循环持续播放，并保留跨多轮后的帧内余量", () => {
    const state = new DeviceAnimationState(createDefinition(), false);
    state.advance(3_125);
    expectFrame(state, "close_idle", 1);
    state.advance(74);
    expectFrame(state, "close_idle", 1);
    state.advance(1);
    expectFrame(state, "close_idle", 2);
    state.advance(100);
    expectFrame(state, "close_idle", 0);
  });

  it("关闭待机保持末帧后重启立即进入开启，不重播关闭序列", () => {
    const state = new DeviceAnimationState(createDefinition("hold-last"), false);
    state.advance(300);
    expectFrame(state, "close_idle", 2);
    state.advance(1_000_000_000_000);
    expectFrame(state, "close_idle", 2);
    state.setDesiredWorking(true);
    expectFrame(state, "open", 0);
    state.setDesiredWorking(false);
    state.advance(499);
    expectFrame(state, "open_idle", 2);
    state.advance(1);
    expectFrame(state, "close", 0);
  });

  it("在开启提交边界只读取最新工作目标，不回放过期停止事件", () => {
    const state = new DeviceAnimationState(createDefinition(), true);
    state.advance(50);
    state.setDesiredWorking(false);
    state.advance(200);
    state.setDesiredWorking(true);
    state.setDesiredWorking(false);
    state.setDesiredWorking(true);
    state.advance(250);
    expectFrame(state, "open_idle", 0);
    state.advance(900);
    expectFrame(state, "open_idle", 0);
  });

  it.each(["loop", "hold-last"] as const)(
    "在关闭提交边界只读取最新停止目标，不回放过期重启事件（%s）",
    (mode) => {
      const state = new DeviceAnimationState(createDefinition(mode), true);
      state.setDesiredWorking(false);
      state.advance(600);
      expectFrame(state, "close", 1);
      state.setDesiredWorking(true);
      state.advance(200);
      state.setDesiredWorking(false);
      state.setDesiredWorking(true);
      state.setDesiredWorking(false);
      state.advance(200);
      expectFrame(state, "close_idle", mode === "loop" ? 0 : 2);
      state.advance(900);
      expectFrame(state, "close_idle", mode === "loop" ? 0 : 2);
    },
  );

  it("边界同帧先收到停止目标时不额外多播一轮工作待机", () => {
    const state = new DeviceAnimationState(createDefinition(), true);
    state.advance(499);
    state.setDesiredWorking(false);
    state.advance(1);
    expectFrame(state, "close", 0);
  });

  it("支持多行网格及每个阶段独立的有限小数帧时长", () => {
    const definition: DeviceSpriteAnimationDefinition = {
      clips: {
        open: { rows: 2, columns: 3, frameDurationMs: 12.5 },
        open_idle: { rows: 1, columns: 2, frameDurationMs: 25 },
        close: { rows: 1, columns: 2, frameDurationMs: 50 },
        close_idle: { rows: 2, columns: 2, frameDurationMs: 6.25 },
      },
      closeIdleMode: "hold-last",
    };
    const state = new DeviceAnimationState(definition, true);
    state.setDesiredWorking(false);
    state.advance(62.5);
    expectFrame(state, "open", 5);
    state.advance(12.5);
    expectFrame(state, "open_idle", 0);
    state.advance(50);
    expectFrame(state, "close", 0);
    state.advance(100);
    expectFrame(state, "close_idle", 0);
    state.advance(25);
    expectFrame(state, "close_idle", 3);
    state.setDesiredWorking(true);
    expectFrame(state, "open", 0);
  });

  it("单帧片段仍各自保留完整一帧时长", () => {
    const clip = { rows: 1, columns: 1, frameDurationMs: 10 };
    const state = new DeviceAnimationState({
      clips: { open: clip, open_idle: clip, close: clip, close_idle: clip },
      closeIdleMode: "hold-last",
    }, true);
    state.setDesiredWorking(false);
    state.advance(10);
    expectFrame(state, "open_idle", 0);
    state.advance(9);
    expectFrame(state, "open_idle", 0);
    state.advance(1);
    expectFrame(state, "close", 0);
    state.advance(10);
    expectFrame(state, "close_idle", 0);
    state.setDesiredWorking(true);
    expectFrame(state, "close_idle", 0);
    state.advance(10);
    expectFrame(state, "open", 0);
  });

  it("巨大的时间步长跨越过渡后直接计算工作待机余量", () => {
    const state = new DeviceAnimationState(createDefinition(), false);
    state.setDesiredWorking(true);
    state.advance(1_000_000_000_000_000);
    expectFrame(state, "open_idle", 2);
    state.advance(100);
    expectFrame(state, "open_idle", 0);
  });

  it.each(["loop", "hold-last"] as const)(
    "巨大的时间步长完成整套关闭序列并停在正确待机状态（%s）",
    (mode) => {
      const state = new DeviceAnimationState(createDefinition(mode), true);
      state.setDesiredWorking(false);
      state.advance(1_000_000_000_000_000);
      expectFrame(state, "close_idle", mode === "loop" ? 0 : 2);
    },
  );

  it("有限最大时间步长不会导致累计时间溢出或无界补帧", () => {
    const state = new DeviceAnimationState(createDefinition(), true);
    state.advance(50);
    state.advance(Number.MAX_VALUE);
    expect(state.stage).toBe("open_idle");
    expect(Number.isInteger(state.frameIndex)).toBe(true);
    expect(state.frameIndex).toBeGreaterThanOrEqual(0);
    expect(state.frameIndex).toBeLessThan(3);
    state.advance(Number.MAX_VALUE);
    expect(Number.isInteger(state.frameIndex)).toBe(true);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "忽略无效或非正时间增量 %s，保留阶段与帧内余量",
    (deltaMs) => {
      const state = new DeviceAnimationState(createDefinition(), true);
      state.advance(25);
      state.advance(deltaMs);
      expectFrame(state, "open", 0);
      state.advance(75);
      expectFrame(state, "open", 1);
    },
  );

  it("普通重置丢弃旧阶段、最新目标和帧内余量", () => {
    const state = new DeviceAnimationState(createDefinition(), true);
    state.advance(375);
    state.setDesiredWorking(false);
    state.reset(true);
    expectFrame(state, "open", 0);
    state.advance(500);
    expectFrame(state, "open_idle", 0);
    state.reset(false);
    expectFrame(state, "close_idle", 0);
    state.advance(99);
    expectFrame(state, "close_idle", 0);
  });

  it("稳定重置让工作设备直接处于工作待机，之后仍遵守完整轮次", () => {
    const state = new DeviceAnimationState(createDefinition(), false);
    state.advance(125);
    state.reset(true, true);
    expectFrame(state, "open_idle", 0);
    state.setDesiredWorking(false);
    state.advance(299);
    expectFrame(state, "open_idle", 2);
    state.advance(1);
    expectFrame(state, "close", 0);
  });

  it.each(["loop", "hold-last"] as const)(
    "稳定重置根据关闭待机模式进入第零帧或已保持的末帧（%s）",
    (mode) => {
      const state = new DeviceAnimationState(createDefinition(mode), true);
      state.advance(125);
      state.reset(false, true);
      expectFrame(state, "close_idle", mode === "loop" ? 0 : 2);
      state.setDesiredWorking(true);
      expectFrame(state, mode === "loop" ? "close_idle" : "open", 0);
      if (mode === "loop") {
        state.advance(300);
        expectFrame(state, "open", 0);
      }
    },
  );

  it("构造时可直接恢复稳定工作与关闭保持状态", () => {
    expectFrame(new DeviceAnimationState(createDefinition(), true, true), "open_idle", 0);
    const closed = new DeviceAnimationState(createDefinition("hold-last"), false, true);
    expectFrame(closed, "close_idle", 2);
    closed.setDesiredWorking(true);
    expectFrame(closed, "open", 0);
  });

  it("共享同一声明的多个实例保持独立阶段和工作目标", () => {
    const definition = createDefinition();
    const first = new DeviceAnimationState(definition, true);
    const second = new DeviceAnimationState(definition, true);
    first.setDesiredWorking(false);
    first.advance(550);
    second.advance(325);
    expectFrame(first, "close", 0);
    expectFrame(second, "open_idle", 1);
    first.reset(false);
    expectFrame(second, "open_idle", 1);
  });

  it.each(["open", "open_idle", "close", "close_idle"] as const)(
    "拒绝 %s 阶段的非法网格声明",
    (stage) => {
      const definition = createDefinition();
      expect(() => new DeviceAnimationState({
        ...definition,
        clips: { ...definition.clips, [stage]: { rows: 0, columns: 1 } },
      }, true)).toThrow();
    },
  );

  it.each([
    { rows: -1, columns: 1 },
    { rows: 1.5, columns: 1 },
    { rows: 1, columns: 0 },
    { rows: 1, columns: 1.5 },
    { rows: Number.NaN, columns: 1 },
    { rows: 1, columns: Number.POSITIVE_INFINITY },
    { rows: Number.MAX_SAFE_INTEGER + 1, columns: 1 },
    { rows: Number.MAX_SAFE_INTEGER, columns: 2 },
    { rows: 1, columns: 1, frameDurationMs: 0 },
    { rows: 1, columns: 1, frameDurationMs: -1 },
    { rows: 1, columns: 1, frameDurationMs: Number.NaN },
    { rows: 1, columns: 1, frameDurationMs: Number.POSITIVE_INFINITY },
    { rows: 1, columns: 2, frameDurationMs: Number.MAX_VALUE },
  ])("拒绝不可计算的网格或帧时长 $rows × $columns / $frameDurationMs", (clip) => {
    const definition = createDefinition();
    expect(() => new DeviceAnimationState({
      ...definition,
      clips: { ...definition.clips, open: clip },
    }, true)).toThrow();
  });

  it("拒绝缺失阶段和未知关闭待机策略", () => {
    const definition = createDefinition();
    expect(() => new DeviceAnimationState({
      ...definition,
      clips: { ...definition.clips, close: undefined },
    } as unknown as DeviceSpriteAnimationDefinition, true)).toThrow();
    expect(() => new DeviceAnimationState({
      ...definition,
      closeIdleMode: "ping-pong",
    } as unknown as DeviceSpriteAnimationDefinition, true)).toThrow();
  });
});
