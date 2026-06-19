// @vitest-environment jsdom

import { action, observable } from "mobx";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost } from "@/app/host/app-host";
import { TopBar } from "@/app/shell/layout/top-bar";
import type { SimulationRunState } from "@/domain/simulation/types/simulation-types";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
  };
}

function attachSimulationStub(
  workspace: WorkspaceContract,
  options: {
    state: SimulationRunState;
    start?: ReturnType<typeof vi.fn>;
    pause?: ReturnType<typeof vi.fn>;
    resume?: ReturnType<typeof vi.fn>;
    stop?: ReturnType<typeof vi.fn>;
    setSimulationSpeed?: ReturnType<typeof vi.fn>;
  },
) {
  const state = observable({
    runningState: options.state,
    simulationSpeed: 1,
    statistics: { tickPerSecond: 0, targetTickPerSecond: 0, baseBatteryJoules: 0, baseBatteryCapacity: 0 },
  });
  const start = options.start ?? vi.fn(action(async () => {
    state.runningState = "start";
  }));
  const pause = options.pause ?? vi.fn(action(() => {
    state.runningState = "pause";
  }));
  const resume = options.resume ?? vi.fn(action(() => {
    state.runningState = "start";
  }));
  const stop = options.stop ?? vi.fn(action(() => {
    state.runningState = "stop";
  }));
  const setSimulationSpeed = options.setSimulationSpeed ?? vi.fn(action((value: number) => {
    state.simulationSpeed = value;
  }));

  workspace.simulation = {
    state,
    topology: createSnapshotStore(null),
    queries: {
      getStatusRuntimeJson: () => JSON.stringify({
        state: {
          runningState: state.runningState,
          simulationSpeed: state.simulationSpeed,
          currentPlaybackTickNumber: 0,
        },
        runtimeStatus: {
          mode: state.runningState === "start" ? "running" : state.runningState === "pause" ? "stopped" : "idle",
          topologyId: null,
          documentHash: null,
          retainedFromTick: null,
          latestTickNumber: state.runningState === "stop" ? null : 0,
          bufferSize: state.runningState === "stop" ? 0 : 1,
          maxBufferSize: 180,
          error: null,
        },
        currentTick: null,
      }),
      getDocumentRuntimeStatus: () => ({
        tickNumber: state.runningState === "stop" ? null : 0,
        totalPowerDemand: null,
        currentPowerGeneration: null,
        isPowerOutage: false,
      }),
      getDeviceRuntimeStatus: () => null,
      getPipeFluidItemId: () => null,
      isPipeDeviceSlotOccupied: () => false,
      getWarehouseStats: () => null,
    },
    actions: {
      start,
      pause,
      resume,
      stop,
      setSimulationSpeed,
      advancePlaybackByDeltaMs: vi.fn(async () => {}),
      patchRuntimeSlot: vi.fn(async () => {}),
      resetAdmissionCounter: vi.fn(async () => {}),
    },
  } as NonNullable<WorkspaceContract["simulation"]>;

  return { start, pause, resume, stop, setSimulationSpeed };
}

describe("TopBar", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fullscreenElement: Element | null;
  let coarsePointer: boolean;
  let hoverNone: boolean;

  const setViewport = (options: {
    width: number;
    height: number;
    userAgent: string;
    maxTouchPoints: number;
  }) => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: options.width,
    });

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: options.height,
    });

    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: options.userAgent,
    });

    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: options.maxTouchPoints,
    });
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    fullscreenElement = null;
    coarsePointer = false;
    hoverNone = false;

    setViewport({
      width: 1280,
      height: 800,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      maxTouchPoints: 0,
    });

    Object.defineProperty(window.navigator, "userAgentData", {
      configurable: true,
      value: undefined,
    });

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches:
          (query === "(pointer: coarse)" && coarsePointer) ||
          (query === "(hover: none)" && hoverNone),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });

    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: vi.fn(() => {
        fullscreenElement = null;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      }),
    });

    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: vi.fn(() => {
        fullscreenElement = document.documentElement;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      }),
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });

    container.remove();
    localStorage.clear();
    document.documentElement.removeAttribute("data-app-theme");
    document.documentElement.removeAttribute("style");
    vi.unstubAllGlobals();
  });

  it("renders the title and action controls without layout toggle buttons", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);
    act(() => {
      root.render(<TopBar appHost={appHost} />);
    });

    expect(container.querySelector(".top-bar-layout-controls")).toBeNull();
    // AI-CORRECTION 2026-05-20: title 现在紧随版本标签 "(Dev)"，textContent 包含完整内容。
    expect(container.querySelector(".top-bar-title")?.textContent).toBe(appHost.actions.translate("app.title") + "(Dev)");
    expect(container.querySelectorAll(".top-bar-controls .top-bar-icon-button")).toHaveLength(3);
  });

  it("toggles fullscreen state through the top bar button", async () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<TopBar appHost={appHost} />);
    });

    const fullscreenButton = container.querySelector(
      ".top-bar-fullscreen-button",
    ) as HTMLButtonElement | null;

    expect(fullscreenButton).not.toBeNull();

    if (!fullscreenButton) {
      throw new Error("Top bar fullscreen button was not rendered.");
    }

    expect(fullscreenButton.getAttribute("aria-pressed")).toBe("false");
    expect(fullscreenButton.title).toBe("进入全屏");
    expect(
      fullscreenButton.querySelector("svg")?.getAttribute("data-workbench-icon"),
    ).toBe("expand");

    await act(async () => {
      fullscreenButton.click();
    });

    expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(fullscreenButton.getAttribute("aria-pressed")).toBe("true");
    expect(fullscreenButton.classList.contains("is-active")).toBe(true);
    expect(fullscreenButton.title).toBe("退出全屏");
    expect(
      fullscreenButton.querySelector("svg")?.getAttribute("data-workbench-icon"),
    ).toBe("shrink");

    await act(async () => {
      fullscreenButton.click();
    });

    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(fullscreenButton.getAttribute("aria-pressed")).toBe("false");
    expect(fullscreenButton.classList.contains("is-active")).toBe(false);
    expect(fullscreenButton.title).toBe("进入全屏");
    expect(
      fullscreenButton.querySelector("svg")?.getAttribute("data-workbench-icon"),
    ).toBe("expand");
  });

  it("starts the simulation through the simulation contract when the control button is idle", async () => {
    const workspace = createWorkspace();
    const { start, pause, resume } = attachSimulationStub(workspace, { state: "stop" });
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<TopBar appHost={appHost} />);
    });

    const simulationButton = container.querySelector(
      '[data-ui-button-id="top-bar-simulation-control"]',
    ) as HTMLButtonElement | null;

    expect(simulationButton).not.toBeNull();
    expect(
      simulationButton?.querySelector("svg")?.getAttribute("data-workbench-icon"),
    ).toBe("play");

    await act(async () => {
      simulationButton?.click();
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it("pauses the simulation through the simulation contract when the control button is running", async () => {
    const workspace = createWorkspace();
    const { start, pause, resume } = attachSimulationStub(workspace, { state: "start" });
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<TopBar appHost={appHost} />);
    });

    const simulationButton = container.querySelector(
      '[data-ui-button-id="top-bar-simulation-control"]',
    ) as HTMLButtonElement | null;

    expect(simulationButton).not.toBeNull();
    expect(
      simulationButton?.querySelector("svg")?.getAttribute("data-workbench-icon"),
    ).toBe("pause");

    await act(async () => {
      simulationButton?.click();
    });

    expect(pause).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it("resumes the simulation through the simulation contract when the control button is paused", async () => {
    const workspace = createWorkspace();
    const { start, pause, resume } = attachSimulationStub(workspace, { state: "pause" });
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<TopBar appHost={appHost} />);
    });

    const simulationButton = container.querySelector(
      '[data-ui-button-id="top-bar-simulation-control"]',
    ) as HTMLButtonElement | null;

    expect(simulationButton).not.toBeNull();
    expect(simulationButton?.title).toBe("继续");
    expect(
      simulationButton?.querySelector("svg")?.getAttribute("data-workbench-icon"),
    ).toBe("resume");

    await act(async () => {
      simulationButton?.click();
    });

    expect(resume).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });

  it("shows flat speed buttons beside the pause button while running", async () => {
    const workspace = createWorkspace();
    const { setSimulationSpeed } = attachSimulationStub(workspace, { state: "start" });
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<TopBar appHost={appHost} />);
    });

    // 验证5个速度按钮全部渲染
    for (const speed of [0.25, 1, 2, 4, 16]) {
      const speedButton = container.querySelector(
        `[data-ui-button-id="top-bar-speed-${speed}"]`,
      ) as HTMLButtonElement | null;
      expect(speedButton).not.toBeNull();
      expect(speedButton?.textContent).toBe(`x${speed}`);
    }

    // 验证当前速度高亮
    const activeButton = container.querySelector(
      '[data-ui-button-id="top-bar-speed-1"]',
    ) as HTMLButtonElement | null;
    expect(activeButton?.getAttribute("aria-pressed")).toBe("true");

    // 点击 x4 直接设置速度
    const x4Button = container.querySelector(
      '[data-ui-button-id="top-bar-speed-4"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      x4Button?.click();
    });
    expect(setSimulationSpeed).toHaveBeenLastCalledWith(4);
  });

  it("shows a stop button in the speed button group", async () => {
    const workspace = createWorkspace();
    const { stop } = attachSimulationStub(workspace, { state: "pause" });
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<TopBar appHost={appHost} />);
    });

    const stopButton = container.querySelector(
      '[data-ui-button-id="top-bar-simulation-stop"]',
    ) as HTMLButtonElement | null;

    expect(stopButton).not.toBeNull();
    expect(stopButton?.title).toBe("停止仿真");
    expect(
      stopButton?.querySelector("svg")?.getAttribute("data-workbench-icon"),
    ).toBe("stop");

    await act(async () => {
      stopButton?.click();
    });

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("removes all top-right status text and keeps only control buttons", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<TopBar appHost={appHost} />);
    });

    const simulationButton = container.querySelector(
      '[data-ui-button-id="top-bar-simulation-control"]',
    ) as HTMLButtonElement | null;
    const fullscreenButton = container.querySelector(
      ".top-bar-fullscreen-button",
    ) as HTMLButtonElement | null;

    expect(container.querySelectorAll(".top-bar-metric")).toHaveLength(0);
    expect(container.textContent).not.toContain("语言:");
    expect(container.textContent).not.toContain("主题:");
    expect(container.textContent).not.toContain("设备:");
    expect(container.textContent).not.toContain("屏幕:");
    expect(simulationButton).not.toBeNull();
    expect(fullscreenButton).not.toBeNull();
    // 速度按钮组：5个速度 + 1个停止 + 主控 + 全屏 = 8
    expect(container.querySelectorAll(".top-bar-controls button")).toHaveLength(8);
    expect(container.querySelector(".top-bar-theme-button")).toBeNull();
  });

  it("shows a collapse button in phone landscape and toggles the collapsed header state", () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 844,
      height: 390,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<TopBar appHost={appHost} />);
    });

    const fullscreenButton = container.querySelector(
      ".top-bar-fullscreen-button",
    ) as HTMLButtonElement | null;
    const simulationButton = container.querySelector(
      '[data-ui-button-id="top-bar-simulation-control"]',
    ) as HTMLButtonElement | null;
    const collapseButton = container.querySelector(
      ".top-bar-collapse-button",
    ) as HTMLButtonElement | null;

    expect(simulationButton).not.toBeNull();
    expect(fullscreenButton).not.toBeNull();
    expect(collapseButton).not.toBeNull();
    // 速度按钮组：5个速度 + 1个停止 + 主控 + 全屏 + 折叠 = 9
    expect(container.querySelectorAll(".top-bar-controls button")).toHaveLength(9);
    expect(container.querySelector(".top-bar-theme-button")).toBeNull();
    expect(collapseButton?.title).toBe("折叠 运行控制");
    expect(appHost.state.workbench.topBarCollapsed).toBe(false);

    act(() => {
      collapseButton?.click();
    });

    expect(appHost.state.workbench.topBarCollapsed).toBe(true);
    expect(container.querySelector(".top-bar")).toBeNull();
    expect(container.textContent).toBe("");
  });
});
