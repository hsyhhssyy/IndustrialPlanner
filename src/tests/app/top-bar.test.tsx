// @vitest-environment jsdom

import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost } from "@/app/host/app-host";
import { TopBar } from "@/app/shell/layout/top-bar";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { createWorkspaceState } from "@/domain/state/workspace-state";
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

  it("marks dock toggle buttons as active while their panels are open", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    const renderTopBar = () => {
      act(() => {
        root.render(<TopBar appHost={appHost} />);
      });
    };

    renderTopBar();

    const buttons = container.querySelectorAll(
      ".top-bar-layout-controls button",
    );
    const leftButton = buttons[0] as HTMLButtonElement | undefined;
    const rightButton = buttons[1] as HTMLButtonElement | undefined;

    expect(leftButton).toBeDefined();
    expect(rightButton).toBeDefined();

    if (!leftButton || !rightButton) {
      throw new Error("Top bar layout buttons were not rendered.");
    }

    expect(leftButton.classList.contains("is-active")).toBe(true);
    expect(leftButton.getAttribute("aria-pressed")).toBe("true");
    expect(rightButton.classList.contains("is-active")).toBe(true);
    expect(rightButton.getAttribute("aria-pressed")).toBe("true");

    act(() => {
      appHost.internalActions.toggleLeftDock();
      appHost.internalActions.toggleRightDock();
    });
    renderTopBar();

    expect(leftButton.classList.contains("is-active")).toBe(false);
    expect(leftButton.getAttribute("aria-pressed")).toBe("false");
    expect(rightButton.classList.contains("is-active")).toBe(false);
    expect(rightButton.getAttribute("aria-pressed")).toBe("false");
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
    const start = vi.fn(async () => ({
      status: "started" as const,
      topologyId: null,
      diagnostics: [],
    }));
    const pause = vi.fn();
    const resume = vi.fn();
    const workspace = createWorkspace();
    workspace.simulation = {
      state: "stop",
      simulationSpeed: 1,
      topology: createSnapshotStore(null),
      queries: {
        getStatus: () => ({
          mode: "idle",
          topologyId: null,
          documentHash: null,
          retainedFromTick: null,
          latestTickNumber: null,
          bufferSize: 0,
          maxBufferSize: 180,
          error: null,
        }),
        getCurrentTickSnapshot: () => null,
        getDeviceRuntimeStatus: () => null,
      },
      actions: {
        start,
        pause,
        resume,
        stop: vi.fn(),
        getTickSnapshot: vi.fn(async () => ({
          status: "not-ready" as const,
          requestedTickNumber: 0,
          retainedFromTick: null,
          latestTickNumber: null,
          bufferSize: 0,
        })),
        advancePlaybackByDeltaMs: vi.fn(async () => null),
      },
    } as NonNullable<WorkspaceContract["simulation"]>;
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<TopBar appHost={appHost} />);
    });

    const simulationButton = container.querySelector(
      '[data-ui-button-id="top-bar-simulation-control"]',
    ) as HTMLButtonElement | null;

    expect(simulationButton).not.toBeNull();

    await act(async () => {
      simulationButton?.click();
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it("pauses the simulation through the simulation contract when the control button is running", async () => {
    const start = vi.fn(async () => ({
      status: "started" as const,
      topologyId: null,
      diagnostics: [],
    }));
    const pause = vi.fn();
    const resume = vi.fn();
    const workspace = createWorkspace();
    workspace.simulation = {
      state: "start",
      simulationSpeed: 1,
      topology: createSnapshotStore(null),
      queries: {
        getStatus: () => ({
          mode: "running",
          topologyId: null,
          documentHash: null,
          retainedFromTick: null,
          latestTickNumber: 0,
          bufferSize: 1,
          maxBufferSize: 180,
          error: null,
        }),
        getCurrentTickSnapshot: () => null,
        getDeviceRuntimeStatus: () => null,
      },
      actions: {
        start,
        pause,
        resume,
        stop: vi.fn(),
        getTickSnapshot: vi.fn(async () => ({
          status: "not-ready" as const,
          requestedTickNumber: 1,
          retainedFromTick: 0,
          latestTickNumber: 0,
          bufferSize: 1,
        })),
        advancePlaybackByDeltaMs: vi.fn(async () => null),
      },
    } as NonNullable<WorkspaceContract["simulation"]>;
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<TopBar appHost={appHost} />);
    });

    const simulationButton = container.querySelector(
      '[data-ui-button-id="top-bar-simulation-control"]',
    ) as HTMLButtonElement | null;

    expect(simulationButton).not.toBeNull();

    await act(async () => {
      simulationButton?.click();
    });

    expect(pause).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it("resumes the simulation through the simulation contract when the control button is paused", async () => {
    const start = vi.fn(async () => ({
      status: "started" as const,
      topologyId: null,
      diagnostics: [],
    }));
    const pause = vi.fn();
    const resume = vi.fn();
    const workspace = createWorkspace();
    workspace.simulation = {
      state: "pause",
      simulationSpeed: 1,
      topology: createSnapshotStore(null),
      queries: {
        getStatus: () => ({
          mode: "stopped",
          topologyId: null,
          documentHash: null,
          retainedFromTick: 0,
          latestTickNumber: 2,
          bufferSize: 1,
          maxBufferSize: 180,
          error: null,
        }),
        getCurrentTickSnapshot: () => null,
        getDeviceRuntimeStatus: () => null,
      },
      actions: {
        start,
        pause,
        resume,
        stop: vi.fn(),
        getTickSnapshot: vi.fn(async () => ({
          status: "not-ready" as const,
          requestedTickNumber: 2,
          retainedFromTick: 1,
          latestTickNumber: 2,
          bufferSize: 1,
        })),
        advancePlaybackByDeltaMs: vi.fn(async () => null),
      },
    } as NonNullable<WorkspaceContract["simulation"]>;
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<TopBar appHost={appHost} />);
    });

    const simulationButton = container.querySelector(
      '[data-ui-button-id="top-bar-simulation-control"]',
    ) as HTMLButtonElement | null;

    expect(simulationButton).not.toBeNull();
    expect(simulationButton?.title).toBe("继续");

    await act(async () => {
      simulationButton?.click();
    });

    expect(resume).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
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
    expect(
      Array.from(container.querySelectorAll(".top-bar-controls button")),
    ).toEqual([
      simulationButton,
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
    const collapseButton = container.querySelector(
      ".top-bar-collapse-button",
    ) as HTMLButtonElement | null;

    expect(simulationButton).not.toBeNull();
    expect(fullscreenButton).not.toBeNull();
    expect(collapseButton).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll(".top-bar-controls button")),
    ).toEqual([
      simulationButton,
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
