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
      getDeviceRuntimeStatus: () => null,
    },
    actions: {
      start,
      pause,
      resume,
      stop,
      setSimulationSpeed,
      advancePlaybackByDeltaMs: vi.fn(async () => {}),
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
    expect(container.querySelector(".top-bar-title")?.textContent).toBe(appHost.actions.translate("app.title"));
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

  it("shows a local speed cycle button beside the pause button while running", async () => {
    const workspace = createWorkspace();
    const { setSimulationSpeed } = attachSimulationStub(workspace, { state: "start" });
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<TopBar appHost={appHost} />);
    });

    const speedButton = container.querySelector(
      '[data-ui-button-id="top-bar-simulation-secondary-control"]',
    ) as HTMLButtonElement | null;

    expect(speedButton).not.toBeNull();
    expect(speedButton?.textContent).toBe("x1");
    expect(speedButton?.title).toBe("速率 x1");

    for (const [expectedCall, expectedLabel] of [
      [2, "x2"],
      [4, "x4"],
      [8, "x8"],
      [16, "x16"],
      [0.25, "x0.25"],
      [1, "x1"],
    ] as const) {
      await act(async () => {
        speedButton?.click();
      });

      expect(setSimulationSpeed).toHaveBeenLastCalledWith(expectedCall);
      expect(speedButton?.textContent).toBe(expectedLabel);
    }
  });

  it("shows a stop button beside the play button while the simulation is not running", async () => {
    const workspace = createWorkspace();
    const { stop } = attachSimulationStub(workspace, { state: "pause" });
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<TopBar appHost={appHost} />);
    });

    const secondaryButton = container.querySelector(
      '[data-ui-button-id="top-bar-simulation-secondary-control"]',
    ) as HTMLButtonElement | null;

    expect(secondaryButton).not.toBeNull();
    expect(secondaryButton?.title).toBe("停止仿真");
    expect(
      secondaryButton?.querySelector("svg")?.getAttribute("data-workbench-icon"),
    ).toBe("stop");

    await act(async () => {
      secondaryButton?.click();
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
    const secondaryButton = container.querySelector(
      '[data-ui-button-id="top-bar-simulation-secondary-control"]',
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
    expect(secondaryButton).not.toBeNull();
    expect(fullscreenButton).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll(".top-bar-controls button")),
    ).toEqual([
      simulationButton,
      secondaryButton,
      fullscreenButton,
    ]);
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
    const secondaryButton = container.querySelector(
      '[data-ui-button-id="top-bar-simulation-secondary-control"]',
    ) as HTMLButtonElement | null;
    const collapseButton = container.querySelector(
      ".top-bar-collapse-button",
    ) as HTMLButtonElement | null;

    expect(simulationButton).not.toBeNull();
    expect(secondaryButton).not.toBeNull();
    expect(fullscreenButton).not.toBeNull();
    expect(collapseButton).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll(".top-bar-controls button")),
    ).toEqual([
      simulationButton,
      secondaryButton,
      fullscreenButton,
      collapseButton,
    ]);
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
