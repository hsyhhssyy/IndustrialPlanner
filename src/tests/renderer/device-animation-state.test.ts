import { describe, expect, it } from "vitest";

import { DeviceAnimationState } from "@/renderer/sprites/device-animation-state";
import type {
  DeviceSpriteAnimationPhase,
  NormalizedDeviceSpriteAnimationDefinition,
} from "@/shared/device-sprite-animation";
import { normalizeDeviceSpriteAnimationDefinition } from "@/shared/device-sprite-animation";

function createClip(phase: DeviceSpriteAnimationPhase, frameCount: number, frameDurationMs = 100) {
  return {
    frameCount,
    frameDurationMs,
    frameEndTimesMs: Array.from({ length: frameCount }, (_, index) => (index + 1) * frameDurationMs),
    durationMs: frameCount * frameDurationMs,
    pages: [{
      file: `${phase}-0.webp`,
      rows: 1,
      columns: frameCount,
      frameCount,
      firstFrameIndex: 0,
    }],
    pageIndexByFrame: Array.from({ length: frameCount }, () => 0),
  };
}

function createDefinition(
  closeIdleMode: NormalizedDeviceSpriteAnimationDefinition["closeIdleMode"] = "loop",
): NormalizedDeviceSpriteAnimationDefinition {
  const clips = {
    open: createClip("open", 2),
    open_idle: createClip("open_idle", 3),
    close: createClip("close", 2),
    close_idle: createClip("close_idle", 3),
  };
  return createNormalizedDefinition(clips, closeIdleMode);
}

function createNormalizedDefinition(
  clips: NormalizedDeviceSpriteAnimationDefinition["clips"],
  closeIdleMode: NormalizedDeviceSpriteAnimationDefinition["closeIdleMode"],
): NormalizedDeviceSpriteAnimationDefinition {
  const clipIds = Object.keys(clips);
  return {
    clips,
    clipIds,
    playback: {
      fallbackClip: "close_idle",
      staticClip: "open",
      statusClips: { normal: "open_idle" },
      openTransitionClip: "open",
      closeTransitionClip: "close",
      clipOptions: Object.fromEntries(clipIds.map((clipId) => [clipId, {
        playing: true,
        restart: true,
        loop: clipId === "open_idle" || (clipId === "close_idle" && closeIdleMode === "loop"),
      }])),
      sourceStatuses: {},
    },
    closeIdleMode,
    frameWidth: 1,
    frameHeight: 1,
    resolution: 1,
    maskFile: "mask.webp",
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
  it("按逐帧时长定位，跨页边界与末帧停留保持准确", () => {
    const clips = Object.fromEntries(["open", "open_idle", "close", "close_idle"].map((phase) => [phase, {
      frameCount: 3,
      frameDurationsMs: [30, 1340, 40],
      pages: [
        { file: `${phase}-0.webp`, rows: 1, columns: 2, frameCount: 2 },
        { file: `${phase}-1.webp`, rows: 1, columns: 1, frameCount: 1 },
      ],
    }]));
    const definition = normalizeDeviceSpriteAnimationDefinition({ closeIdleMode: "hold-last" }, {
      schemaVersion: 2, frameWidth: 1, frameHeight: 1, maskFile: "mask.webp", clips,
      playback: {
        fallbackClip: "close_idle", staticClip: "open", statusClips: { normal: "open_idle" },
        openTransitionClip: "open", closeTransitionClip: "close",
      },
    });
    const state = new DeviceAnimationState(definition, "normal");
    state.advance(29);
    expectFrame(state, "open", 0);
    state.advance(1);
    expectFrame(state, "open", 1);
    state.advance(1339);
    expectFrame(state, "open", 1);
    state.advance(1);
    expectFrame(state, "open", 2);
    state.advance(39);
    expectFrame(state, "open", 2);
    state.advance(1);
    expectFrame(state, "open_idle", 0);
    state.advance(1410 * 1000 + 30);
    expectFrame(state, "open_idle", 1);
    state.reset("idle", true);
    expectFrame(state, "close_idle", 2);
  });

  it("按初始工作目标从开启或关闭待机的第零帧开始", () => {
    expectFrame(new DeviceAnimationState(createDefinition(), "normal"), "open", 0);
    expectFrame(new DeviceAnimationState(createDefinition(), "idle"), "close_idle", 0);
  });

  it("每帧默认持续 100ms，并完整展示过渡末帧", () => {
    const state = new DeviceAnimationState(createDefinition(), "normal");
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
    const state = new DeviceAnimationState(createDefinition(), "normal");
    state.advance(25);
    state.setStatus("idle");
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
    const state = new DeviceAnimationState(createDefinition(), "normal");
    state.advance(200 + frame * 100 + 25);
    state.setStatus("idle");
    state.advance(274 - frame * 100);
    expectFrame(state, "open_idle", 2);
    state.advance(1);
    expectFrame(state, "close", 0);
  });

  it.each(["loop", "hold-last"] as const)(
    "关闭过渡中重启时仍完整播放关闭和一轮关闭待机（%s）",
    (mode) => {
      const state = new DeviceAnimationState(createDefinition(mode), "normal");
      state.advance(200);
      state.setStatus("idle");
      state.advance(425);
      expectFrame(state, "close", 1);
      state.setStatus("normal");
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
    const state = new DeviceAnimationState(createDefinition(mode), "idle");
    state.advance(frame * 100 + 25);
    state.setStatus("normal");
    state.advance(274 - frame * 100);
    expectFrame(state, "close_idle", 2);
    state.advance(1);
    expectFrame(state, "open", 0);
  });

  it("关闭待机循环持续播放，并保留跨多轮后的帧内余量", () => {
    const state = new DeviceAnimationState(createDefinition(), "idle");
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
    const state = new DeviceAnimationState(createDefinition("hold-last"), "idle");
    state.advance(300);
    expectFrame(state, "close_idle", 2);
    state.advance(1_000_000_000_000);
    expectFrame(state, "close_idle", 2);
    state.setStatus("normal");
    expectFrame(state, "open", 0);
    state.setStatus("idle");
    state.advance(499);
    expectFrame(state, "open_idle", 2);
    state.advance(1);
    expectFrame(state, "close", 0);
  });

  it("在开启提交边界只读取最新工作目标，不回放过期停止事件", () => {
    const state = new DeviceAnimationState(createDefinition(), "normal");
    state.advance(50);
    state.setStatus("idle");
    state.advance(200);
    state.setStatus("normal");
    state.setStatus("idle");
    state.setStatus("normal");
    state.advance(250);
    expectFrame(state, "open_idle", 0);
    state.advance(900);
    expectFrame(state, "open_idle", 0);
  });

  it.each(["loop", "hold-last"] as const)(
    "在关闭提交边界只读取最新停止目标，不回放过期重启事件（%s）",
    (mode) => {
      const state = new DeviceAnimationState(createDefinition(mode), "normal");
      state.setStatus("idle");
      state.advance(600);
      expectFrame(state, "close", 1);
      state.setStatus("normal");
      state.advance(200);
      state.setStatus("idle");
      state.setStatus("normal");
      state.setStatus("idle");
      state.advance(200);
      expectFrame(state, "close_idle", mode === "loop" ? 0 : 2);
      state.advance(900);
      expectFrame(state, "close_idle", mode === "loop" ? 0 : 2);
    },
  );

  it("边界同帧先收到停止目标时不额外多播一轮工作待机", () => {
    const state = new DeviceAnimationState(createDefinition(), "normal");
    state.advance(499);
    state.setStatus("idle");
    state.advance(1);
    expectFrame(state, "close", 0);
  });

  it("支持每个阶段独立的帧数及有限小数帧时长", () => {
    const definition = createNormalizedDefinition({
        open: createClip("open", 6, 12.5),
        open_idle: createClip("open_idle", 2, 25),
        close: createClip("close", 2, 50),
        close_idle: createClip("close_idle", 4, 6.25),
      }, "hold-last");
    const state = new DeviceAnimationState(definition, "normal");
    state.setStatus("idle");
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
    state.setStatus("normal");
    expectFrame(state, "open", 0);
  });

  it("单帧片段仍各自保留完整一帧时长", () => {
    const clips = {
      open: createClip("open", 1, 10),
      open_idle: createClip("open_idle", 1, 10),
      close: createClip("close", 1, 10),
      close_idle: createClip("close_idle", 1, 10),
    };
    const state = new DeviceAnimationState(createNormalizedDefinition(clips, "hold-last"), "normal");
    state.setStatus("idle");
    state.advance(10);
    expectFrame(state, "open_idle", 0);
    state.advance(9);
    expectFrame(state, "open_idle", 0);
    state.advance(1);
    expectFrame(state, "close", 0);
    state.advance(10);
    expectFrame(state, "close_idle", 0);
    state.setStatus("normal");
    expectFrame(state, "close_idle", 0);
    state.advance(10);
    expectFrame(state, "open", 0);
  });

  it("巨大的时间步长跨越过渡后直接计算工作待机余量", () => {
    const state = new DeviceAnimationState(createDefinition(), "idle");
    state.setStatus("normal");
    state.advance(1_000_000_000_000_000);
    expectFrame(state, "open_idle", 2);
    state.advance(100);
    expectFrame(state, "open_idle", 0);
  });

  it.each(["loop", "hold-last"] as const)(
    "巨大的时间步长完成整套关闭序列并停在正确待机状态（%s）",
    (mode) => {
      const state = new DeviceAnimationState(createDefinition(mode), "normal");
      state.setStatus("idle");
      state.advance(1_000_000_000_000_000);
      expectFrame(state, "close_idle", mode === "loop" ? 0 : 2);
    },
  );

  it("有限最大时间步长不会导致累计时间溢出或无界补帧", () => {
    const state = new DeviceAnimationState(createDefinition(), "normal");
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
      const state = new DeviceAnimationState(createDefinition(), "normal");
      state.advance(25);
      state.advance(deltaMs);
      expectFrame(state, "open", 0);
      state.advance(75);
      expectFrame(state, "open", 1);
    },
  );

  it("普通重置丢弃旧阶段、最新目标和帧内余量", () => {
    const state = new DeviceAnimationState(createDefinition(), "normal");
    state.advance(375);
    state.setStatus("idle");
    state.reset("normal");
    expectFrame(state, "open", 0);
    state.advance(500);
    expectFrame(state, "open_idle", 0);
    state.reset("idle");
    expectFrame(state, "close_idle", 0);
    state.advance(99);
    expectFrame(state, "close_idle", 0);
  });

  it("稳定重置让工作设备直接处于工作待机，之后仍遵守完整轮次", () => {
    const state = new DeviceAnimationState(createDefinition(), "idle");
    state.advance(125);
    state.reset("normal", true);
    expectFrame(state, "open_idle", 0);
    state.setStatus("idle");
    state.advance(299);
    expectFrame(state, "open_idle", 2);
    state.advance(1);
    expectFrame(state, "close", 0);
  });

  it.each(["loop", "hold-last"] as const)(
    "稳定重置根据关闭待机模式进入第零帧或已保持的末帧（%s）",
    (mode) => {
      const state = new DeviceAnimationState(createDefinition(mode), "normal");
      state.advance(125);
      state.reset("idle", true);
      expectFrame(state, "close_idle", mode === "loop" ? 0 : 2);
      state.setStatus("normal");
      expectFrame(state, mode === "loop" ? "close_idle" : "open", 0);
      if (mode === "loop") {
        state.advance(300);
        expectFrame(state, "open", 0);
      }
    },
  );

  it("构造时可直接恢复稳定工作与关闭保持状态", () => {
    expectFrame(new DeviceAnimationState(createDefinition(), "normal", true), "open_idle", 0);
    const closed = new DeviceAnimationState(createDefinition("hold-last"), "idle", true);
    expectFrame(closed, "close_idle", 2);
    closed.setStatus("normal");
    expectFrame(closed, "open", 0);
  });

  it("共享同一声明的多个实例保持独立阶段和工作目标", () => {
    const definition = createDefinition();
    const first = new DeviceAnimationState(definition, "normal");
    const second = new DeviceAnimationState(definition, "normal");
    first.setStatus("idle");
    first.advance(550);
    second.advance(325);
    expectFrame(first, "close", 0);
    expectFrame(second, "open_idle", 1);
    first.reset("idle");
    expectFrame(second, "open_idle", 1);
  });

  it("目标分页尚未就绪时冻结进度，加载完成后继续", () => {
    const state = new DeviceAnimationState(createDefinition(), "normal");
    state.advance(100, () => false);
    expectFrame(state, "open", 0);
    state.advance(100, () => true);
    expectFrame(state, "open", 1);
  });

  it("显式 status 片段按映射切换，未映射 status 使用 CLOSED 兜底", () => {
    const clips = {
      RUNNING: createClip("RUNNING", 2),
      CLOSED: createClip("CLOSED", 2),
      PORT_DISCONNECT: createClip("PORT_DISCONNECT", 1),
    };
    const definition: NormalizedDeviceSpriteAnimationDefinition = {
      clips,
      clipIds: Object.keys(clips),
      playback: {
        fallbackClip: "CLOSED",
        staticClip: "RUNNING",
        statusClips: { normal: "RUNNING", "no-power": "PORT_DISCONNECT" },
        openTransitionClip: null,
        closeTransitionClip: null,
        clipOptions: {
          RUNNING: { playing: true, restart: true, loop: true },
          CLOSED: { playing: true, restart: true, loop: true },
          PORT_DISCONNECT: { playing: false, restart: true, loop: false },
        },
        sourceStatuses: {
          CLOSED: { statusKey: 3, clip: "CLOSED", playing: true, restart: true },
          RUNNING: { statusKey: 4, clip: "RUNNING", playing: true, restart: true },
          PORT_DISCONNECT: { statusKey: 5, clip: "PORT_DISCONNECT", playing: false, restart: true },
        },
      },
      closeIdleMode: "loop",
      frameWidth: 1,
      frameHeight: 1,
      resolution: 1,
      maskFile: "mask.webp",
    };
    const state = new DeviceAnimationState(definition, "idle", true);
    expectFrame(state, "CLOSED", 0);
    state.setStatus("blocked");
    expectFrame(state, "CLOSED", 0);
    state.setStatus("no-power");
    state.advance(200);
    expectFrame(state, "PORT_DISCONNECT", 0);
    state.advance(10_000);
    expectFrame(state, "PORT_DISCONNECT", 0);
    state.setStatus("normal");
    expectFrame(state, "RUNNING", 0);
  });
});
