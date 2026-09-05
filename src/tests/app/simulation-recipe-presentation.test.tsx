import { describe, expect, it } from "vitest";

import {
  advanceSimulationRecipePresentationClock,
  resetSimulationRecipePresentationClock,
  type SimulationRecipePresentationClockState,
} from "@/app/shell/inspector/use-simulation-recipe-presentation";

describe("配方单帧展示时钟", () => {
  it("暂停期间不计入恢复后的 elapsed", () => {
    const initial: SimulationRecipePresentationClockState = {
      presentationKey: "5:2:2",
      active: true,
      nowMs: 100,
      observedAtMs: 0,
    };
    const paused = resetSimulationRecipePresentationClock(initial, {
      presentationKey: "5:2:2",
      active: false,
    });
    const resumed = resetSimulationRecipePresentationClock(paused, {
      presentationKey: "5:2:2",
      active: true,
    });
    const resumedFirstFrame = advanceSimulationRecipePresentationClock(resumed, {
      presentationKey: "5:2:2",
      active: true,
      nowMs: 780,
    });
    const nextFrame = advanceSimulationRecipePresentationClock(resumedFirstFrame, {
      presentationKey: "5:2:2",
      active: true,
      nowMs: 860,
    });

    expect(paused.observedAtMs).toBeNull();
    expect(resumed.observedAtMs).toBeNull();
    expect(resumedFirstFrame.observedAtMs).toBe(780);
    expect(
      (nextFrame.nowMs - (nextFrame.observedAtMs ?? Number.NaN)) / 1000,
    ).toBeCloseTo(0.08, 5);
  });
});

// AI-REMOVED 2026-09-04:
// Reason: 基于 jsdom 和 fake AppHost 的 Hook 测试违反项目 App / Editor 必须使用真实浏览器的测试架构。
// Trigger: ST2-RQ-024 暂停 / 恢复展示时钟回归用例的测试架构复核。
// Evidence: .docs/common/测试/测试架构设计通则.md 第 3 节与第 7 节禁止 UI 测试构造 fake AppHost。
// Replacement: 本文件上方对纯状态转换函数 advanceSimulationRecipePresentationClock 的无 DOM 单元测试；真实 UI 链路由浏览器验收覆盖。
// Risk: Low
// Human Review: Required
//
// Original code:
/*
// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import { useSimulationRecipePresentation } from "@/app/shell/inspector/use-simulation-recipe-presentation";
import type {
  SimulationDocumentRuntimeReadModel,
  SimulationState,
} from "@/domain/simulation/types/simulation-types";

describe("配方单帧展示时钟", () => {
  let container: HTMLDivElement;
  let root: Root;
  let nowMs: number;
  let nextFrameId: number;
  let frameCallbacks: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    nowMs = 0;
    nextFrameId = 0;
    frameCallbacks = new Map();
    vi.spyOn(performance, "now").mockImplementation(() => nowMs);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const frameId = ++nextFrameId;
      frameCallbacks.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (frameId: number) => {
      frameCallbacks.delete(frameId);
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("暂停期间不计入恢复后的 elapsed", () => {
    const documentStatus: SimulationDocumentRuntimeReadModel = {
      tickNumber: 5,
      standardTickRate: 2,
      tickRate: 2,
      totalPowerDemand: 0,
      currentPowerGeneration: 0,
      isPowerOutage: false,
    };
    let runningState: SimulationState["runningState"] = "start";
    const simulationState = {
      get runningState(): SimulationState["runningState"] {
        return runningState;
      },
      simulationSpeed: 1,
      timeline: { isSeeking: false },
    };
    const appHost = {
      workspace: {
        simulation: {
          state: simulationState,
          queries: {
            getDocumentRuntimeStatus: () => documentStatus,
          },
        },
      },
    } as unknown as AppHost;

    const renderProbe = () => {
      act(() => {
        root.render(<PresentationProbe appHost={appHost} />);
      });
    };
    renderProbe();

    advanceFrame(100);
    expect(readElapsedSeconds()).toBeCloseTo(0.1, 5);

    nowMs = 120;
    runningState = "pause";
    renderProbe();
    expect(readElapsedSeconds()).toBe(0);

    nowMs = 620;
    renderProbe();
    expect(readElapsedSeconds()).toBe(0);

    nowMs = 700;
    runningState = "start";
    renderProbe();
    advanceFrame(780);
    expect(readElapsedSeconds()).toBeCloseTo(0.08, 5);
  });

  function advanceFrame(frameNowMs: number) {
    nowMs = frameNowMs;
    const callbacks = [...frameCallbacks.values()];
    frameCallbacks.clear();
    act(() => {
      for (const callback of callbacks) {
        callback(frameNowMs);
      }
    });
  }

  function readElapsedSeconds() {
    return Number(container.firstElementChild?.getAttribute("data-elapsed"));
  }
});

function PresentationProbe({ appHost }: { readonly appHost: AppHost }) {
  const presentation = useSimulationRecipePresentation(appHost, true);
  return <div data-elapsed={presentation.elapsedWallSeconds} />;
}
*/
