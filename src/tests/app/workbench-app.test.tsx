// @vitest-environment jsdom

import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost } from "@/app/host/app-host";
import type { GestureEvent } from "@/app/input/gesture/adapter";
import {
  APP_SHORTCUTS_LOCAL_STORAGE_KEY,
  SHORTCUT_KEY,
} from "@/app/actions/keyboard-shortcut-manager";
import { USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY } from "@/app/shell/state/settings-dialog-state";
import {
  APP_SETTINGS_LOCAL_STORAGE_KEY,
  WORKBENCH_STATE_LOCAL_STORAGE_KEY,
} from "@/app/state/storage-hook";
import { WorkbenchApp } from "@/app/shell/workbench-app";
import {
  DEFAULT_HELP_DIALOG_TAB_ID,
  DEFAULT_MODULE_BALANCING_CANVAS_ID,
  DEFAULT_MODULE_BALANCING_STAGE_ID,
  DEFAULT_RIGHT_DOCK_TAB_ID,
  DEFAULT_RIGHT_DOCK_WIDTH,
  DEFAULT_TOOLBOX_DIALOG_TAB_ID,
  MOBILE_LEFT_DOCK_WIDTH,
} from "@/app/state/state-impl";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { createWorkspaceState } from "@/domain/state/workspace-state";
import { createRegistryContract } from "@/registry";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import { createDummyWorldDocument } from "@/editor/dummy-document";
import { createEditorHost } from "@/editor/editor-host";

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

const DEFAULT_APP_SETTINGS_STORAGE = {
  locale: "zh-CN",
  themeId: "ayu-light",
  hypergryphOperationMode: true,
  hypergryphImmediateMove: true,
  hypergryphImmediateMarquee: false,
  gameShowHotkeys: false,
  gameAlwaysShowGridLines: true,
  showGrassBackground: false,
  debugShowFps: false,
  debugShowGestureDiagnosticsWindow: false,
  debugMode: false,
} as const;

const DEFAULT_APP_SHORTCUTS_STORAGE = {
  [SHORTCUT_KEY.PLACE_CONVEYOR]: "E",
  [SHORTCUT_KEY.PLACE_PIPE]: "Q",
  [SHORTCUT_KEY.RESOURCES_POWER]: "G",
  [SHORTCUT_KEY.WAREHOUSE]: "C",
  [SHORTCUT_KEY.BASIC_PRODUCTION]: "V",
  [SHORTCUT_KEY.SYNTHESIS]: "B",
  [SHORTCUT_KEY.RETURN_SELECT]: "Esc",
  [SHORTCUT_KEY.ROTATE]: "R",
  [SHORTCUT_KEY.DELETE_DEVICE]: "F",
} as const;

function createDialogStateSnapshot(options: {
  visible?: boolean;
  maximized?: boolean;
  offsetX?: number;
  offsetY?: number;
  width?: number | null;
  height?: number | null;
  activeTab?: string | null;
} = {}) {
  return {
    visible: options.visible ?? false,
    maximized: options.maximized ?? false,
    offsetX: options.offsetX ?? 0,
    offsetY: options.offsetY ?? 0,
    width: options.width ?? null,
    height: options.height ?? null,
    activeTab: options.activeTab ?? null,
  };
}

function createToolboxWikiStorageSnapshot(options: {
  searchQuery?: string;
  desktopCategory?: "all" | "item" | "entity" | "basicProduction" | "advancedManufacturing" | "beltLogistics" | "pipeLogistics" | "resourcePower" | "warehouse";
  mobileSelectedCategories?: Array<"excludeBottledLiquid" | "item" | "entity" | "basicProduction" | "advancedManufacturing" | "beltLogistics" | "pipeLogistics" | "resourcePower" | "warehouse">;
  navigationStack?: Array<{ type: "item" | "entity"; id: string }>;
  openedPage?: { kind: "browser" } | { kind: "item" | "entity"; id: string };
} = {}) {
  return {
    searchQuery: options.searchQuery ?? "",
    desktopCategory: options.desktopCategory ?? "all",
    mobileSelectedCategories: options.mobileSelectedCategories ?? ["excludeBottledLiquid"],
    navigationStack: options.navigationStack ?? [],
    openedPage: options.openedPage ?? { kind: "browser" },
  };
}

function createModuleBalancingStorageSnapshot(options: {
  canvases?: Array<{
    id: string;
    name: string;
    globalInputs: Array<{ itemId: string; perMinute: number }>;
    stages: Array<{
      id: string;
      name: string;
      entries: Array<{ moduleId: string; quantity: number }>;
    }>;
    warehouseCapacity: number | null;
  }>;
  customModules?: Array<{
    id: string;
    name: string;
    color: string;
    iconId: string;
    sourceType: "custom";
    inputs: Array<{ itemId: string; perMinute: number }>;
    outputs: Array<{ itemId: string; perMinute: number }>;
  }>;
  activeCanvasId?: string | null;
} = {}) {
  return {
    canvases: options.canvases ?? [
      {
        id: DEFAULT_MODULE_BALANCING_CANVAS_ID,
        name: "主基地配平",
        globalInputs: [],
        stages: [
          {
            id: DEFAULT_MODULE_BALANCING_STAGE_ID,
            name: "Stage 1",
            entries: [],
          },
        ],
        warehouseCapacity: null,
      },
    ],
    customModules: options.customModules ?? [],
    activeCanvasId: options.activeCanvasId ?? DEFAULT_MODULE_BALANCING_CANVAS_ID,
  };
}

function createWorkbenchStorageSnapshot(options: {
  leftDockOpen?: boolean;
  rightDockOpen?: boolean;
  leftDockWidth?: number;
  topBarCollapsed?: boolean;
  rightDockActiveTab?: "base" | "power" | "selection" | "simulation";
  toolboxDialog?: ReturnType<typeof createDialogStateSnapshot>;
  helpDialog?: ReturnType<typeof createDialogStateSnapshot>;
  settingsDialog?: ReturnType<typeof createDialogStateSnapshot>;
  toolboxWiki?: ReturnType<typeof createToolboxWikiStorageSnapshot>;
  moduleBalancing?: ReturnType<typeof createModuleBalancingStorageSnapshot>;
} = {}) {
  return {
    leftDockOpen: options.leftDockOpen ?? true,
    rightDockOpen: options.rightDockOpen ?? true,
    leftDockWidth: options.leftDockWidth ?? 375,
    topBarCollapsed: options.topBarCollapsed ?? false,
    rightDockActiveTab: options.rightDockActiveTab ?? DEFAULT_RIGHT_DOCK_TAB_ID,
    dialogState: {
      toolbox: options.toolboxDialog ?? createDialogStateSnapshot({ activeTab: DEFAULT_TOOLBOX_DIALOG_TAB_ID }),
      help: options.helpDialog ?? createDialogStateSnapshot({ activeTab: DEFAULT_HELP_DIALOG_TAB_ID }),
      settings: options.settingsDialog ?? createDialogStateSnapshot(),
    },
    toolbox: {
      wiki: options.toolboxWiki ?? createToolboxWikiStorageSnapshot(),
      moduleBalancing: options.moduleBalancing ?? createModuleBalancingStorageSnapshot(),
    },
  };
}

function dispatchPointerEvent(
  target: Element,
  type: string,
  init: {
    pointerId: number;
    pointerType: string;
    clientX: number;
    clientY: number;
    button?: number;
    buttons?: number;
  },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    pointerType: { value: init.pointerType },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
    button: { value: init.button ?? 0 },
    buttons: { value: init.buttons ?? 0 },
    altKey: { value: false },
    ctrlKey: { value: false },
    metaKey: { value: false },
    shiftKey: { value: false },
  });
  target.dispatchEvent(event);
  return event;
}

function dispatchWindowPointerEvent(
  type: string,
  init: {
    pointerId: number;
    pointerType: string;
    clientX: number;
    clientY: number;
    button?: number;
    buttons?: number;
  },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    pointerType: { value: init.pointerType },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
    button: { value: init.button ?? 0 },
    buttons: { value: init.buttons ?? 0 },
    altKey: { value: false },
    ctrlKey: { value: false },
    metaKey: { value: false },
    shiftKey: { value: false },
  });
  window.dispatchEvent(event);
  return event;
}

function dispatchClickEvent(
  target: Element,
  init: {
    detail?: number;
  } = {},
): MouseEvent {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    detail: init.detail ?? 1,
  });
  target.dispatchEvent(event);
  return event;
}

describe("WorkbenchApp", () => {
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

    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      writable: true,
      value: 1,
    });

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
    document.body.classList.remove("is-resizing-left-dock");
  });

  it("applies persisted left dock width to the shell style", () => {
    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify({
        leftDockOpen: true,
        rightDockOpen: true,
        leftDockWidth: 512,
      }),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const workbench = container.querySelector(".workbench") as HTMLDivElement | null;

    expect(workbench).not.toBeNull();
    expect(workbench?.style.getPropertyValue("--left-dock-width")).toBe("512px");
  });

  it("updates public screen profile from the shell resize hook", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const workbench = container.querySelector(".workbench") as HTMLDivElement | null;

    expect(appHost.state.screenProfile.deviceClass).toBe("desktop");
    expect(appHost.state.screenProfile.screenShape).toBe("landscape");
    expect(workbench?.style.getPropertyValue("--left-toolbar-width")).toBe("68px");
    expect(workbench?.style.getPropertyValue("--left-toolbar-button-scale")).toBe("1");

    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 820,
      height: 1180,
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(appHost.state.screenProfile.deviceClass).toBe("tablet");
    expect(appHost.state.screenProfile.screenShape).toBe("portrait");
    expect(workbench?.style.getPropertyValue("--left-toolbar-width")).toBe("51px");
    expect(workbench?.style.getPropertyValue("--left-toolbar-button-scale")).toBe("0.75");
  });

  it("requests fullscreen after a phone rotates from portrait to landscape", () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    expect(appHost.state.screenProfile.deviceClass).toBe("mobile");
    expect(appHost.state.screenProfile.screenShape).toBe("portrait");
    expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(0);

    setViewport({
      width: 844,
      height: 390,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    act(() => {
      window.dispatchEvent(new Event("orientationchange"));
    });

    expect(appHost.state.screenProfile.deviceClass).toBe("mobile");
    expect(appHost.state.screenProfile.screenShape).toBe("landscape");
    expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("updates left dock width through the edge handle and clamps the value", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const handle = container.querySelector(".dock-resize-handle") as HTMLDivElement | null;
    const workbench = container.querySelector(".workbench") as HTMLDivElement | null;

    expect(handle).not.toBeNull();
    expect(workbench).not.toBeNull();

    act(() => {
      handle?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 375 }));
      window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 470 }));
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 470 }));
    });

    expect(appHost.state.workbench.leftDockWidth).toBe(470);
    expect(workbench?.style.getPropertyValue("--left-dock-width")).toBe("470px");
    expect(localStorage.getItem(WORKBENCH_STATE_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify(createWorkbenchStorageSnapshot({
        leftDockWidth: 470,
      })),
    );
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBeNull();

    act(() => {
      handle?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 470 }));
      window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 900 }));
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 900 }));
    });

    expect(appHost.state.workbench.leftDockWidth).toBe(600);
    expect(workbench?.style.getPropertyValue("--left-dock-width")).toBe("600px");
  });

  it("hides the top and bottom bars and exposes floating fullscreen and expand buttons when a phone landscape top bar is collapsed", async () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 844,
      height: 390,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify({
        leftDockOpen: true,
        rightDockOpen: true,
        leftDockWidth: 375,
        topBarCollapsed: true,
        rightDockActiveTab: DEFAULT_RIGHT_DOCK_TAB_ID,
      }),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const workbench = container.querySelector(".workbench") as HTMLDivElement | null;
    const floatingControls = container.querySelector(
      ".workbench-floating-top-bar-controls",
    ) as HTMLDivElement | null;
    const floatingFullscreenButton = container.querySelector(
      ".workbench-floating-fullscreen-button",
    ) as HTMLButtonElement | null;
    const floatingRightDockButton = container.querySelector(
      ".workbench-floating-right-dock-button",
    ) as HTMLButtonElement | null;
    const floatingToggle = container.querySelector(
      ".workbench-floating-top-bar-toggle",
    ) as HTMLButtonElement | null;

    expect(workbench).not.toBeNull();
    expect(workbench?.style.getPropertyValue("--top-bar-height")).toBe("0px");
    expect(workbench?.style.getPropertyValue("--bottom-bar-height")).toBe("0px");
    expect(container.querySelector(".status-bar")).toBeNull();
    expect(container.querySelector(".top-bar")).toBeNull();
    expect(floatingControls).not.toBeNull();
    expect(floatingFullscreenButton?.title).toBe("进入全屏");
    expect(floatingRightDockButton).toBeNull();
    expect(floatingToggle?.title).toBe("展开 运行控制");
    expect(
      floatingFullscreenButton?.querySelector("svg")?.getAttribute("data-workbench-icon"),
    ).toBe("expand");

    await act(async () => {
      floatingFullscreenButton?.click();
    });

    expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(floatingFullscreenButton?.getAttribute("aria-pressed")).toBe("true");
    expect(
      floatingFullscreenButton?.querySelector("svg")?.getAttribute("data-workbench-icon"),
    ).toBe("shrink");

    act(() => {
      floatingToggle?.click();
    });

    expect(appHost.state.workbench.topBarCollapsed).toBe(false);
    expect(workbench?.style.getPropertyValue("--top-bar-height")).toBe("48px");
    expect(workbench?.style.getPropertyValue("--bottom-bar-height")).toBe("28px");
    expect(container.querySelector(".workbench-floating-top-bar-controls")).toBeNull();
    expect(container.querySelector(".top-bar")).not.toBeNull();
    expect(container.querySelector(".status-bar")).not.toBeNull();
  });

  it("shows a floating open-right-dock button in phone landscape collapsed top bar mode and hides it after reopening the dock", () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 844,
      height: 390,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify({
        leftDockOpen: true,
        rightDockOpen: false,
        leftDockWidth: 375,
        topBarCollapsed: true,
        rightDockActiveTab: DEFAULT_RIGHT_DOCK_TAB_ID,
      }),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const workbench = container.querySelector(".workbench") as HTMLDivElement | null;
    const floatingRightDockButton = container.querySelector(
      ".workbench-floating-right-dock-button",
    ) as HTMLButtonElement | null;

    expect(workbench).not.toBeNull();
    expect(workbench?.style.getPropertyValue("--right-dock-width")).toBe("0px");
    expect(floatingRightDockButton?.title).toBe("打开 右侧");
    expect(
      floatingRightDockButton?.querySelector("svg")?.getAttribute("data-workbench-icon"),
    ).toBe("panel-right-open");

    act(() => {
      floatingRightDockButton?.click();
    });

    expect(appHost.state.workbench.rightDockOpen).toBe(true);
    expect(workbench?.style.getPropertyValue("--right-dock-width")).toBe(
      `${DEFAULT_RIGHT_DOCK_WIDTH}px`,
    );
    expect(container.querySelector(".workbench-floating-right-dock-button")).toBeNull();
    expect(container.querySelector(".dock-right")).not.toBeNull();
  });

  it("renders the right dock as tabs and closes it from the header button", () => {
    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify(createWorkbenchStorageSnapshot({
        rightDockActiveTab: "power",
      })),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const baseTab = container.querySelector("#right-dock-tab-base") as HTMLButtonElement | null;
    const powerTab = container.querySelector("#right-dock-tab-power") as HTMLButtonElement | null;
    const selectionTab = container.querySelector("#right-dock-tab-selection") as HTMLButtonElement | null;
    const simulationTab = container.querySelector("#right-dock-tab-simulation") as HTMLButtonElement | null;
    const closeButton = container.querySelector(".right-dock-close-button") as HTMLButtonElement | null;

    expect(baseTab?.getAttribute("aria-selected")).toBe("false");
    expect(powerTab?.getAttribute("aria-selected")).toBe("true");
    expect(selectionTab?.getAttribute("aria-selected")).toBe("false");
    expect(simulationTab?.getAttribute("aria-selected")).toBe("false");
    expect(container.textContent).toContain("总耗电");
    expect(container.textContent).not.toContain("可放置区域");
    expect(closeButton?.title).toBe("关闭 右侧");

    act(() => {
      selectionTab?.click();
    });

    expect(appHost.state.workbench.rightDockActiveTab).toBe("selection");
    expect(selectionTab?.getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("未选中对象");

    act(() => {
      closeButton?.click();
    });

    expect(appHost.state.workbench.rightDockOpen).toBe(false);
    expect(container.querySelector(".dock-right")).toBeNull();
  });

  it("renders current tick snapshot json in the simulation right dock tab", () => {
    vi.useFakeTimers();

    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify(createWorkbenchStorageSnapshot({
        rightDockActiveTab: "simulation",
      })),
    );

    const workspace = createWorkspace();
    workspace.simulation = {
      state: "stop",
      simulationSpeed: 1,
      topology: createSnapshotStore(null),
      queries: {
        getStatus: () => ({
          mode: "stopped",
          topologyId: null,
          documentHash: null,
          retainedFromTick: 3,
          latestTickNumber: 3,
          bufferSize: 1,
          maxBufferSize: 180,
          error: null,
        }),
        getCurrentTick: () => ({
          source: "query-read-model",
        } as never),
        getBeltCargoEntries: () => [],
        getDeviceRuntimeStatus: () => null,
      },
      actions: {
        start: vi.fn(async () => ({
          status: "started",
          topologyId: null,
          diagnostics: [],
        })),
        pause: vi.fn(),
        resume: vi.fn(),
        stop: vi.fn(),
        advancePlaybackByDeltaMs: vi.fn(async () => {}),
      },
    } as NonNullable<WorkspaceContract["simulation"]>;

    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const simulationTab = container.querySelector("#right-dock-tab-simulation") as HTMLButtonElement | null;
    const snapshotTextarea = container.querySelector("[data-simulation-current-tick-json]") as HTMLTextAreaElement | null;

    expect(simulationTab?.getAttribute("aria-selected")).toBe("true");

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(snapshotTextarea?.value).toBe(`{
  "source": "query-read-model"
}`);
  });

  it("keeps the bottom bar visible in phone landscape until the top bar is collapsed", () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 844,
      height: 390,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify({
        leftDockOpen: true,
        rightDockOpen: true,
        leftDockWidth: 375,
        topBarCollapsed: false,
        rightDockActiveTab: DEFAULT_RIGHT_DOCK_TAB_ID,
      }),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const workbench = container.querySelector(".workbench") as HTMLDivElement | null;

    expect(workbench).not.toBeNull();
    expect(workbench?.style.getPropertyValue("--top-bar-height")).toBe("48px");
    expect(workbench?.style.getPropertyValue("--bottom-bar-height")).toBe("28px");
    expect(container.querySelector(".top-bar")).not.toBeNull();
    expect(container.querySelector(".status-bar")).not.toBeNull();
    expect(container.querySelector(".workbench-floating-top-bar-controls")).toBeNull();
  });

  it("forces the left dock to a fixed mobile width and disables resize handles in phone mode", () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify({
        leftDockOpen: true,
        rightDockOpen: true,
        leftDockWidth: 512,
        topBarCollapsed: false,
        rightDockActiveTab: DEFAULT_RIGHT_DOCK_TAB_ID,
      }),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const workbench = container.querySelector(".workbench") as HTMLDivElement | null;

    expect(appHost.state.workbench.leftDockWidth).toBe(512);
    expect(workbench?.style.getPropertyValue("--left-dock-width")).toBe(`${MOBILE_LEFT_DOCK_WIDTH}px`);
    expect(workbench?.style.getPropertyValue("--left-toolbar-width")).toBe("51px");
    expect(workbench?.style.getPropertyValue("--left-toolbar-button-scale")).toBe("0.75");
    expect(container.querySelector(".dock-resize-handle")).toBeNull();
  });

  it("prevents middle mouse native pointerdown behavior at the outer shell", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const canvasPanel = container.querySelector(".canvas-panel") as HTMLElement | null;

    expect(canvasPanel).not.toBeNull();

    if (!canvasPanel) {
      throw new Error("Canvas panel did not render.");
    }

    const middleMouseEvent = dispatchPointerEvent(canvasPanel, "pointerdown", {
      pointerId: 7,
      pointerType: "mouse",
      clientX: 120,
      clientY: 80,
      button: 1,
      buttons: 4,
    });
    const leftMouseEvent = dispatchPointerEvent(canvasPanel, "pointerdown", {
      pointerId: 8,
      pointerType: "mouse",
      clientX: 120,
      clientY: 80,
      button: 0,
      buttons: 1,
    });

    expect(middleMouseEvent.defaultPrevented).toBe(true);
    expect(leftMouseEvent.defaultPrevented).toBe(false);
  });

  it("keeps pointer activity inside the canvas floating toolbar out of canvas gestures and emits selection action buttons for pointer activation", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);
    const gestures: GestureEvent[] = [];
    appHost.gestureAdapter.subscribe((event) => gestures.push(event));

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
      editorHost.internalState.collections.selection.replace(["dummy-entity-1"]);
      editorHost.actions.createMoveOperationDraft();
      appHost.internalActions.showCanvasFloatingToolbarForCollection(
        [
          "canvas-floating-toolbar-button-move",
          "canvas-floating-toolbar-button-delete",
        ],
        "preview",
      );
    });

    const toolbar = container.querySelector(".canvas-floating-toolbar") as HTMLDivElement | null;
    const moveButton = container.querySelector(
      '[data-ui-button-id="canvas-floating-toolbar-button-move"]',
    ) as HTMLButtonElement | null;
    const deleteButton = container.querySelector(
      '[data-ui-button-id="canvas-floating-toolbar-button-delete"]',
    ) as HTMLButtonElement | null;

    expect(toolbar).not.toBeNull();
    expect(moveButton).not.toBeNull();
    expect(deleteButton).not.toBeNull();
    expect(
      moveButton?.querySelector("svg")?.getAttribute("data-workbench-icon"),
    ).toBe("move");

    if (!toolbar || !moveButton || !deleteButton) {
      throw new Error("Canvas floating toolbar did not render expected buttons.");
    }

    act(() => {
      dispatchPointerEvent(toolbar, "pointerdown", {
        pointerId: 21,
        pointerType: "mouse",
        clientX: 220,
        clientY: 180,
        buttons: 1,
      });
      dispatchPointerEvent(toolbar, "pointermove", {
        pointerId: 21,
        pointerType: "mouse",
        clientX: 228,
        clientY: 186,
        buttons: 1,
      });
      dispatchPointerEvent(toolbar, "pointerup", {
        pointerId: 21,
        pointerType: "mouse",
        clientX: 228,
        clientY: 186,
        buttons: 0,
      });
    });

    expect(gestures).toHaveLength(0);

    act(() => {
      dispatchPointerEvent(moveButton, "pointerdown", {
        pointerId: 22,
        pointerType: "mouse",
        clientX: 220,
        clientY: 180,
        buttons: 1,
      });
      dispatchPointerEvent(moveButton, "pointerup", {
        pointerId: 22,
        pointerType: "mouse",
        clientX: 220,
        clientY: 180,
        buttons: 0,
      });
      dispatchPointerEvent(deleteButton, "pointerdown", {
        pointerId: 23,
        pointerType: "touch",
        clientX: 252,
        clientY: 180,
        buttons: 1,
      });
      dispatchPointerEvent(deleteButton, "pointerup", {
        pointerId: 23,
        pointerType: "touch",
        clientX: 252,
        clientY: 180,
        buttons: 0,
      });
    });

    expect(gestures).toMatchObject([
      {
        type: "ui-button-mouse-tap",
        uiButtonId: "canvas-floating-toolbar-button-move",
      },
      {
        type: "ui-button-touch-tap",
        uiButtonId: "canvas-floating-toolbar-button-delete",
      },
    ]);
  });

  it("emits canvas floating toolbar keyboard activation only from accessibility clicks", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);
    const gestures: GestureEvent[] = [];
    appHost.gestureAdapter.subscribe((event) => gestures.push(event));

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
      editorHost.internalState.collections.selection.replace(["dummy-entity-1"]);
      editorHost.actions.createMoveOperationDraft();
      appHost.internalActions.showCanvasFloatingToolbarForCollection(
        [
          "canvas-floating-toolbar-button-move",
          "canvas-floating-toolbar-button-delete",
        ],
        "preview",
      );
    });

    const moveButton = container.querySelector(
      '[data-ui-button-id="canvas-floating-toolbar-button-move"]',
    ) as HTMLButtonElement | null;

    expect(moveButton).not.toBeNull();

    if (!moveButton) {
      throw new Error("Canvas floating toolbar did not render the move button.");
    }

    act(() => {
      dispatchClickEvent(moveButton, { detail: 1 });
    });

    expect(gestures).toHaveLength(0);

    act(() => {
      dispatchClickEvent(moveButton, { detail: 0 });
    });

    expect(gestures).toMatchObject([
      {
        type: "ui-button-mouse-tap",
        uiButtonId: "canvas-floating-toolbar-button-move",
        button: 0,
      },
    ]);
  });

  it("keeps the canvas right dock toolbar visible while the right dock toggles", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
      appHost.internalActions.showCanvasRightDockToolbar([
        "canvas-right-dock-toolbar-button-exit",
        "canvas-right-dock-toolbar-button-move",
      ]);
    });

    expect(container.querySelector(".canvas-right-dock-toolbar")).not.toBeNull();

    act(() => {
      appHost.internalActions.toggleRightDock();
    });

    const toolbar = container.querySelector(".canvas-right-dock-toolbar") as HTMLDivElement | null;
    const labels = Array.from(
      toolbar?.querySelectorAll(".canvas-right-dock-toolbar-label") ?? [],
    ).map((element) => element.textContent);

    expect(toolbar).not.toBeNull();
    expect(
      Array.from(toolbar?.querySelectorAll("[data-ui-button-id]") ?? []).map((button) =>
        button.getAttribute("data-ui-button-id"),
      ),
    ).toEqual([
      "canvas-right-dock-toolbar-button-exit",
      "canvas-right-dock-toolbar-button-move",
    ]);
    expect(labels).toEqual(["退出", "移动"]);
    expect(
      toolbar?.querySelector('[data-ui-button-id="canvas-right-dock-toolbar-button-move"] svg')?.getAttribute("data-workbench-icon"),
    ).toBe("move");

    act(() => {
      appHost.internalActions.toggleRightDock();
    });

    expect(container.querySelector(".canvas-right-dock-toolbar")).not.toBeNull();

    act(() => {
      appHost.internalActions.toggleRightDock();
    });

    expect(container.querySelector(".canvas-right-dock-toolbar")).not.toBeNull();

    act(() => {
      appHost.internalActions.hideCanvasRightDockToolbar();
    });

    expect(container.querySelector(".canvas-right-dock-toolbar")).toBeNull();
  });

  it("emits ui-button events from the canvas right dock toolbar without leaking canvas gestures", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);
    const gestures: GestureEvent[] = [];
    appHost.gestureAdapter.subscribe((event) => gestures.push(event));

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
      appHost.internalActions.showCanvasRightDockToolbar([
        "canvas-right-dock-toolbar-button-exit",
        "canvas-right-dock-toolbar-button-move",
      ]);
      appHost.internalActions.toggleRightDock();
    });

    const toolbar = container.querySelector(".canvas-right-dock-toolbar") as HTMLDivElement | null;
    const exitButton = container.querySelector(
      '[data-ui-button-id="canvas-right-dock-toolbar-button-exit"]',
    ) as HTMLButtonElement | null;
    const moveButton = container.querySelector(
      '[data-ui-button-id="canvas-right-dock-toolbar-button-move"]',
    ) as HTMLButtonElement | null;

    expect(toolbar).not.toBeNull();
    expect(exitButton).not.toBeNull();
    expect(moveButton).not.toBeNull();

    if (!toolbar || !exitButton || !moveButton) {
      throw new Error("Canvas right dock toolbar did not render expected buttons.");
    }

    act(() => {
      dispatchPointerEvent(toolbar, "pointerdown", {
        pointerId: 24,
        pointerType: "mouse",
        clientX: 1200,
        clientY: 280,
        buttons: 1,
      });
      dispatchPointerEvent(toolbar, "pointerup", {
        pointerId: 24,
        pointerType: "mouse",
        clientX: 1200,
        clientY: 280,
        buttons: 0,
      });
    });

    expect(gestures).toHaveLength(0);

    act(() => {
      dispatchPointerEvent(exitButton, "pointerdown", {
        pointerId: 25,
        pointerType: "mouse",
        clientX: 1200,
        clientY: 280,
        buttons: 1,
      });
      dispatchPointerEvent(exitButton, "pointerup", {
        pointerId: 25,
        pointerType: "mouse",
        clientX: 1200,
        clientY: 280,
        buttons: 0,
      });
      dispatchPointerEvent(moveButton, "pointerdown", {
        pointerId: 26,
        pointerType: "touch",
        clientX: 1200,
        clientY: 332,
        buttons: 1,
      });
      dispatchPointerEvent(moveButton, "pointerup", {
        pointerId: 26,
        pointerType: "touch",
        clientX: 1200,
        clientY: 332,
        buttons: 0,
      });
    });

    expect(gestures).toMatchObject([
      {
        type: "ui-button-mouse-tap",
        uiButtonId: "canvas-right-dock-toolbar-button-exit",
      },
      {
        type: "ui-button-touch-tap",
        uiButtonId: "canvas-right-dock-toolbar-button-move",
      },
    ]);
  });

  it("shows the canvas top left corner toolbar and updates toggle labels locally", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    expect(container.querySelector(".canvas-top-left-corner-toolbar")).toBeNull();

    act(() => {
      appHost.internalActions.showCanvasTopLeftCornerToolbar([
        "canvas-top-left-corner-toolbar-button-toggle-pipe",
        "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee",
      ]);
    });

    const toolbar = container.querySelector(".canvas-top-left-corner-toolbar") as HTMLDivElement | null;
    const pipeButton = container.querySelector(
      '[data-ui-button-id="canvas-top-left-corner-toolbar-button-toggle-pipe"]',
    ) as HTMLButtonElement | null;
    const reverseMarqueeButton = container.querySelector(
      '[data-ui-button-id="canvas-top-left-corner-toolbar-button-toggle-reverse-marquee"]',
    ) as HTMLButtonElement | null;

    expect(toolbar).not.toBeNull();
    expect(pipeButton?.textContent).toBe("弱化管道");
    expect(reverseMarqueeButton?.textContent).toBe("切换到反选");
    expect(pipeButton?.getAttribute("aria-pressed")).toBe("false");
    expect(reverseMarqueeButton?.getAttribute("aria-pressed")).toBe("false");

    act(() => {
      if (pipeButton === null) {
        return;
      }

      dispatchPointerEvent(pipeButton, "pointerdown", {
        pointerId: 31,
        pointerType: "mouse",
        clientX: 464,
        clientY: 92,
        buttons: 1,
      });
      dispatchPointerEvent(pipeButton, "pointerup", {
        pointerId: 31,
        pointerType: "mouse",
        clientX: 464,
        clientY: 92,
        buttons: 0,
      });
    });

    expect(pipeButton?.textContent).toBe("显示管道");
    expect(pipeButton?.getAttribute("aria-pressed")).toBe("true");

    act(() => {
      if (reverseMarqueeButton === null) {
        return;
      }

      dispatchPointerEvent(reverseMarqueeButton, "pointerdown", {
        pointerId: 32,
        pointerType: "touch",
        clientX: 464,
        clientY: 124,
        buttons: 1,
      });
      dispatchPointerEvent(reverseMarqueeButton, "pointerup", {
        pointerId: 32,
        pointerType: "touch",
        clientX: 464,
        clientY: 124,
        buttons: 0,
      });
    });

    expect(reverseMarqueeButton?.textContent).toBe("切换到正选");
    expect(reverseMarqueeButton?.getAttribute("aria-pressed")).toBe("true");

    act(() => {
      appHost.internalActions.hideCanvasTopLeftCornerToolbar();
    });

    expect(container.querySelector(".canvas-top-left-corner-toolbar")).toBeNull();
  });

  it("emits toggle ui-button events from the canvas top left corner toolbar without leaking canvas gestures", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);
    const gestures: GestureEvent[] = [];
    appHost.gestureAdapter.subscribe((event) => gestures.push(event));

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
      appHost.internalActions.showCanvasTopLeftCornerToolbar([
        "canvas-top-left-corner-toolbar-button-toggle-pipe",
        "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee",
      ]);
    });

    const toolbar = container.querySelector(".canvas-top-left-corner-toolbar") as HTMLDivElement | null;
    const pipeButton = container.querySelector(
      '[data-ui-button-id="canvas-top-left-corner-toolbar-button-toggle-pipe"]',
    ) as HTMLButtonElement | null;
    const reverseMarqueeButton = container.querySelector(
      '[data-ui-button-id="canvas-top-left-corner-toolbar-button-toggle-reverse-marquee"]',
    ) as HTMLButtonElement | null;

    expect(toolbar).not.toBeNull();
    expect(pipeButton).not.toBeNull();
    expect(reverseMarqueeButton).not.toBeNull();

    if (!toolbar || !pipeButton || !reverseMarqueeButton) {
      throw new Error("Canvas top left corner toolbar did not render expected buttons.");
    }

    act(() => {
      dispatchPointerEvent(toolbar, "pointerdown", {
        pointerId: 33,
        pointerType: "mouse",
        clientX: 464,
        clientY: 92,
        buttons: 1,
      });
      dispatchPointerEvent(toolbar, "pointerup", {
        pointerId: 33,
        pointerType: "mouse",
        clientX: 464,
        clientY: 92,
        buttons: 0,
      });
    });

    expect(gestures).toHaveLength(0);

    act(() => {
      dispatchPointerEvent(pipeButton, "pointerdown", {
        pointerId: 34,
        pointerType: "mouse",
        clientX: 464,
        clientY: 92,
        buttons: 1,
      });
      dispatchPointerEvent(pipeButton, "pointerup", {
        pointerId: 34,
        pointerType: "mouse",
        clientX: 464,
        clientY: 92,
        buttons: 0,
      });
      dispatchPointerEvent(pipeButton, "pointerdown", {
        pointerId: 35,
        pointerType: "mouse",
        clientX: 464,
        clientY: 92,
        buttons: 1,
      });
      dispatchPointerEvent(pipeButton, "pointerup", {
        pointerId: 35,
        pointerType: "mouse",
        clientX: 464,
        clientY: 92,
        buttons: 0,
      });
      dispatchPointerEvent(reverseMarqueeButton, "pointerdown", {
        pointerId: 36,
        pointerType: "touch",
        clientX: 464,
        clientY: 124,
        buttons: 1,
      });
      dispatchPointerEvent(reverseMarqueeButton, "pointerup", {
        pointerId: 36,
        pointerType: "touch",
        clientX: 464,
        clientY: 124,
        buttons: 0,
      });
    });

    expect(gestures).toMatchObject([
      {
        type: "ui-button-mouse-tap",
        uiButtonId: "canvas-top-left-corner-toolbar-button-toggle-pipe-on",
      },
      {
        type: "ui-button-mouse-tap",
        uiButtonId: "canvas-top-left-corner-toolbar-button-toggle-pipe-off",
      },
      {
        type: "ui-button-touch-tap",
        uiButtonId: "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee-on",
      },
    ]);
  });

  it("opens the settings dialog from the left toolbar and hydrates saved schema values", () => {
    localStorage.setItem(
      APP_SETTINGS_LOCAL_STORAGE_KEY,
      JSON.stringify({
        locale: "zh-CN",
        themeId: "ayu-light",
        hypergryphOperationMode: false,
        gameAlwaysShowGridLines: true,
        debugShowFps: true,
        debugShowGestureDiagnosticsWindow: true,
        debugMode: true,
      }),
    );
    localStorage.setItem(
      USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY,
      JSON.stringify({
        selectedGroupId: "system",
        values: {
          "system-theme": "follow-system",
          "display-frame-rate-limit": "60",
          "game-arknights-operation-mode": true,
          "game-use-simplified-device-icons": false,
          "other-debug-mode": true,
        },
      }),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const settingsButton = container.querySelector(
      ".toolbar-rail-utility .rail-button:last-child",
    ) as HTMLButtonElement | null;

    expect(container.querySelector(".settings-dialog")).toBeNull();
    expect(settingsButton).not.toBeNull();

    act(() => {
      settingsButton?.click();
    });

    const dialog = container.querySelector(".settings-dialog") as HTMLDivElement | null;
    const languageSelect = container.querySelector(
      'select[name="system-language"]',
    ) as HTMLSelectElement | null;
    const themeSelect = container.querySelector(
      'select[name="system-theme"]',
    ) as HTMLSelectElement | null;
    const operationModeToggle = container.querySelector(
      'input[name="game-arknights-operation-mode"]',
    ) as HTMLInputElement | null;
    const immediateMoveToggle = container.querySelector(
      'input[name="game-arknights-immediate-move"]',
    ) as HTMLInputElement | null;
    const immediateMarqueeToggle = container.querySelector(
      'input[name="game-arknights-immediate-marquee"]',
    ) as HTMLInputElement | null;
    const debugToggle = container.querySelector(
      'input[name="other-debug-mode"]',
    ) as HTMLInputElement | null;
    const alwaysShowGridLinesToggle = container.querySelector(
      'input[name="game-always-show-grid-lines"]',
    ) as HTMLInputElement | null;
    const showFpsToggle = container.querySelector(
      'input[name="debug-show-fps"]',
    ) as HTMLInputElement | null;
    const showGestureTestWindowToggle = container.querySelector(
      'input[name="debug-show-gesture-diagnostics-window"]',
    ) as HTMLInputElement | null;
    const groupTitles = Array.from(
      dialog?.querySelectorAll(".settings-dialog-group-header h3") ?? [],
    ).map((element) => element.textContent);
    const groupDescriptions = Array.from(
      dialog?.querySelectorAll(".settings-dialog-group-header p") ?? [],
    ).map((element) => element.textContent);
    const languageOptionLabels = Array.from(languageSelect?.options ?? []).map((option) => option.textContent);
    const themeOptionLabels = Array.from(themeSelect?.options ?? []).map((option) => option.textContent);

    expect(dialog).not.toBeNull();
    expect(groupTitles).toEqual(["系统", "显示", "游戏", "鹰角操作模式", "快捷键", "其他", "调试"]);
    expect(groupDescriptions).toEqual([
      "语言、主题与全局界面偏好。",
      "图像输出与帧率表现相关设置。",
      "与游戏操作习惯和显示风格对齐的选项。",
      "与鹰角操作模式附加行为相关的选项。",
      "编辑当前可自定义的快捷键设置。",
      "调试和附加能力开关。",
      "FPS 与手势测试开关，可用于开发调试。",
    ]);
    expect(languageOptionLabels).toEqual(["中文(简体)", "English"]);
    expect(themeOptionLabels).toEqual(["Ayu Light", "Ayu Dark"]);
    expect(languageSelect?.value).toBe("zh-CN");
    expect(themeSelect?.value).toBe("ayu-light");
    expect(operationModeToggle?.checked).toBe(false);
    expect(operationModeToggle?.disabled).toBe(true);
    expect(immediateMoveToggle?.checked).toBe(true);
    expect(immediateMoveToggle?.disabled).toBe(true);
    expect(immediateMarqueeToggle?.checked).toBe(false);
    expect(immediateMarqueeToggle?.disabled).toBe(true);
    expect(debugToggle?.checked).toBe(true);
    expect(alwaysShowGridLinesToggle?.checked).toBe(true);
    expect(showFpsToggle?.checked).toBe(true);
    expect(showGestureTestWindowToggle?.checked).toBe(true);

    const closeButton = container.querySelector(
      ".settings-dialog-close",
    ) as HTMLButtonElement | null;

    act(() => {
      closeButton?.click();
    });

    expect(container.querySelector(".settings-dialog")).toBeNull();
  });

  it("opens the help dialog from the left toolbar and supports tabs, maximize, and close", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const helpButton = container.querySelector(
      'button[title="帮助"]',
    ) as HTMLButtonElement | null;

    expect(container.querySelector(".help-dialog")).toBeNull();
    expect(helpButton).not.toBeNull();
    expect(helpButton?.getAttribute("aria-pressed")).toBe("false");

    act(() => {
      helpButton?.click();
    });

    const dialog = container.querySelector(".help-dialog") as HTMLDivElement | null;
    const faqTab = container.querySelector(
      '#help-dialog-tab-faq',
    ) as HTMLButtonElement | null;
    const maximizeButton = container.querySelector(
      'button[title="最大化帮助"]',
    ) as HTMLButtonElement | null;

    expect(dialog).not.toBeNull();
    expect(helpButton?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".help-dialog-placeholder h3")?.textContent).toBe("概览");
    expect(container.querySelector(".help-dialog-placeholder p")?.textContent).toBe(
      "当前帮助内容尚未填充，这里先保留为空面板。",
    );

    act(() => {
      faqTab?.click();
    });

    expect(faqTab?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector(".help-dialog-placeholder h3")?.textContent).toBe("常见问题");

    act(() => {
      maximizeButton?.click();
    });

    expect(container.querySelector(".help-dialog")?.classList.contains("is-maximized")).toBe(true);
    expect(localStorage.getItem(WORKBENCH_STATE_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify(createWorkbenchStorageSnapshot({
        helpDialog: createDialogStateSnapshot({
          visible: true,
          maximized: true,
          activeTab: "faq",
        }),
      })),
    );
    expect(
      container.querySelector('button[title="还原帮助"] svg')?.getAttribute("data-workbench-icon"),
    ).toBe("shrink");

    const closeButton = container.querySelector(
      '.help-dialog-header button[title="关闭"]',
    ) as HTMLButtonElement | null;

    act(() => {
      closeButton?.click();
    });

    expect(container.querySelector(".help-dialog")).toBeNull();
    expect(helpButton?.getAttribute("aria-pressed")).toBe("false");

    act(() => {
      helpButton?.click();
    });

    expect(container.querySelector(".help-dialog")?.classList.contains("is-maximized")).toBe(true);
  });

  it("moves the help dialog when dragging the title bar in windowed mode", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const helpButton = container.querySelector(
      'button[title="帮助"]',
    ) as HTMLButtonElement | null;

    act(() => {
      helpButton?.click();
    });

    const dialog = container.querySelector(".help-dialog") as HTMLDivElement | null;
    const header = container.querySelector(".help-dialog-header") as HTMLElement | null;

    expect(dialog).not.toBeNull();
    expect(header).not.toBeNull();
    expect(dialog?.style.transform).toBe("translate(0px, 0px)");

    act(() => {
      if (header === null) {
        return;
      }

      dispatchPointerEvent(header, "pointerdown", {
        pointerId: 41,
        pointerType: "mouse",
        clientX: 240,
        clientY: 140,
        button: 0,
        buttons: 1,
      });
      dispatchWindowPointerEvent("pointermove", {
        pointerId: 41,
        pointerType: "mouse",
        clientX: 320,
        clientY: 196,
        buttons: 1,
      });
    });

    expect(document.body.classList.contains("is-dragging-dialog-shell")).toBe(true);
    expect(dialog?.style.transform).toBe("translate(80px, 56px)");

    act(() => {
      dispatchWindowPointerEvent("pointerup", {
        pointerId: 41,
        pointerType: "mouse",
        clientX: 320,
        clientY: 196,
        buttons: 0,
      });
    });

    expect(document.body.classList.contains("is-dragging-dialog-shell")).toBe(false);
    expect(dialog?.style.transform).toBe("translate(80px, 56px)");
  });

  it("uses immersive fullscreen help dialog maximization on tablet screens and remembers it", () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 820,
      height: 1180,
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const helpButton = container.querySelector(
      'button[title="帮助"]',
    ) as HTMLButtonElement | null;

    act(() => {
      helpButton?.click();
    });

    const maximizeButton = container.querySelector(
      'button[title="最大化帮助"]',
    ) as HTMLButtonElement | null;

    act(() => {
      maximizeButton?.click();
    });

    expect(container.querySelector(".help-dialog-backdrop")?.classList.contains("is-immersive-maximized")).toBe(true);
    expect(container.querySelector(".help-dialog")?.classList.contains("is-maximized")).toBe(true);

    act(() => {
      root.unmount();
    });

    root = createRoot(container);

    const nextWorkspace = createWorkspace();
    const nextAppHost = createAppHost(nextWorkspace);

    act(() => {
      root.render(<WorkbenchApp appHost={nextAppHost} />);
      nextAppHost.internalActions.openDialog("help");
    });

    expect(nextAppHost.internalState.workbench.dialogState.help.maximized).toBe(true);
    expect(container.querySelector(".help-dialog-backdrop")?.classList.contains("is-immersive-maximized")).toBe(true);
  });

  it("opens the help dialog through app internal actions", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
      appHost.internalActions.openDialog("help:version");
    });

    expect(container.querySelector(".help-dialog")).not.toBeNull();
    expect(container.querySelector("#help-dialog-tab-version")?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector(".help-dialog-placeholder h3")?.textContent).toBe("版本更新");
  });

  it("opens the toolbox dialog through toolbar interaction", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const toolboxButton = container.querySelector(
      'button[title="工具箱"]',
    ) as HTMLButtonElement | null;

    expect(toolboxButton).not.toBeNull();

    act(() => {
      toolboxButton?.click();
    });

    expect(container.querySelector(".toolbox-dialog")).not.toBeNull();
    expect(container.querySelector("#toolbox-dialog-tab-item-encyclopedia")?.getAttribute("aria-selected")).toBe("true");

    const productionPlanningTab = container.querySelector(
      "#toolbox-dialog-tab-production-planning",
    ) as HTMLButtonElement | null;

    act(() => {
      productionPlanningTab?.click();
    });

    expect(appHost.internalState.workbench.dialogState.toolbox.activeTab).toBe("production-planning");
    expect(container.querySelector(".toolbox-dialog-placeholder h3")?.textContent).toBe("产线规划");
  });

  it("opens the global encyclopedia picker and resolves the selected item", async () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);
    const copperOreName = appHost.actions.translate("registry.item.item_copper_ore.name");
    let selectionPromise!: Promise<string | null>;

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    act(() => {
      selectionPromise = appHost.encyclopediaPicker.pickItem({
        filterItem: (item) => item.id === "item_copper_ore",
      });
    });

    const pickerDialog = container.querySelector(
      ".encyclopedia-picker-dialog",
    ) as HTMLElement | null;

    expect(pickerDialog).not.toBeNull();
    expect(container.querySelector("#encyclopedia-picker-dialog-title")?.textContent).toBe("选择物品");
    expect(container.querySelector(".encyclopedia-category-button")?.textContent).toBe("全部");
    expect(Array.from(container.querySelectorAll(".encyclopedia-card-label"))).toHaveLength(1);
    expect(container.querySelector(".encyclopedia-card-label")?.textContent).toBe(copperOreName);
    expect(Array.from(container.querySelectorAll(".encyclopedia-category-button"))).not.toContainEqual(
      expect.objectContaining({ textContent: "设备" }),
    );
    expect(pickerDialog?.querySelector(".dialog-shell-resize-grip")).toBeNull();
    expect(
      container.querySelector(".encyclopedia-picker-dialog-header")?.classList.contains("is-draggable"),
    ).toBe(false);

    const maximizeButton = container.querySelector(
      '.encyclopedia-picker-dialog button[title="最大化"]',
    ) as HTMLButtonElement | null;

    expect(maximizeButton).not.toBeNull();

    act(() => {
      maximizeButton?.click();
    });

    expect(container.querySelector(".encyclopedia-picker-dialog")?.classList.contains("is-maximized")).toBe(true);

    const copperButton = Array.from(container.querySelectorAll(".encyclopedia-card")).find(
      (element) => element.textContent?.includes(copperOreName),
    ) as HTMLButtonElement | undefined;

    expect(copperButton).toBeDefined();

    await act(async () => {
      copperButton?.click();
      await selectionPromise;
    });

    await expect(selectionPromise).resolves.toBe("item_copper_ore");
    expect(container.querySelector(".encyclopedia-picker-dialog")).toBeNull();
  });

  it("writes language changes into AppSettings and re-renders through mobx", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const settingsButton = container.querySelector(
      ".toolbar-rail-utility .rail-button:last-child",
    ) as HTMLButtonElement | null;

    expect(settingsButton).not.toBeNull();
    expect(settingsButton?.title).toBe("设置");

    act(() => {
      settingsButton?.click();
    });

    const languageSelect = container.querySelector(
      'select[name="system-language"]',
    ) as HTMLSelectElement | null;

    expect(languageSelect).not.toBeNull();
    expect(languageSelect?.value).toBe("zh-CN");
    expect(container.querySelector(".settings-dialog-header h2")?.textContent).toBe("设置");

    act(() => {
      if (languageSelect === null) {
        return;
      }

      languageSelect.value = "en-US";
      languageSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(appHost.state.settings.locale).toBe("en-US");
    expect(languageSelect?.value).toBe("en-US");
    expect(settingsButton?.title).toBe("Settings");
    expect(container.querySelector(".settings-dialog-header h2")?.textContent).toBe("Settings");
    expect(localStorage.getItem(WORKBENCH_STATE_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify(createWorkbenchStorageSnapshot({
        settingsDialog: createDialogStateSnapshot({ visible: true }),
      })),
    );
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        ...DEFAULT_APP_SETTINGS_STORAGE,
        locale: "en-US",
      }),
    );
  });

  it("writes theme changes into AppSettings and reapplies the document theme through mobx", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const settingsButton = container.querySelector(
      ".toolbar-rail-utility .rail-button:last-child",
    ) as HTMLButtonElement | null;

    act(() => {
      settingsButton?.click();
    });

    const themeSelect = container.querySelector(
      'select[name="system-theme"]',
    ) as HTMLSelectElement | null;

    expect(themeSelect).not.toBeNull();
    expect(themeSelect?.value).toBe("ayu-light");
    expect(document.documentElement.dataset.appTheme).toBe("ayu-light");

    act(() => {
      if (themeSelect === null) {
        return;
      }

      themeSelect.value = "ayu-dark";
      themeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(appHost.state.settings.themeId).toBe("ayu-dark");
    expect(themeSelect?.value).toBe("ayu-dark");
    expect(document.documentElement.dataset.appTheme).toBe("ayu-dark");
    expect(localStorage.getItem(WORKBENCH_STATE_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify(createWorkbenchStorageSnapshot({
        settingsDialog: createDialogStateSnapshot({ visible: true }),
      })),
    );
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        ...DEFAULT_APP_SETTINGS_STORAGE,
        themeId: "ayu-dark",
      }),
    );
  });

  it("writes immediate marquee changes into AppSettings and forces immediate move on", () => {
    localStorage.setItem(
      APP_SETTINGS_LOCAL_STORAGE_KEY,
      JSON.stringify({
        locale: "zh-CN",
        themeId: "ayu-light",
        hypergryphOperationMode: true,
        hypergryphImmediateMove: false,
        hypergryphImmediateMarquee: false,
      }),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const settingsButton = container.querySelector(
      ".toolbar-rail-utility .rail-button:last-child",
    ) as HTMLButtonElement | null;

    act(() => {
      settingsButton?.click();
    });

    const immediateMoveToggle = container.querySelector(
      'input[name="game-arknights-immediate-move"]',
    ) as HTMLInputElement | null;
    const immediateMarqueeToggle = container.querySelector(
      'input[name="game-arknights-immediate-marquee"]',
    ) as HTMLInputElement | null;

    expect(immediateMoveToggle).not.toBeNull();
    expect(immediateMarqueeToggle).not.toBeNull();
    expect(immediateMoveToggle?.checked).toBe(false);
    expect(immediateMoveToggle?.disabled).toBe(false);
    expect(immediateMarqueeToggle?.checked).toBe(false);
    expect(immediateMarqueeToggle?.disabled).toBe(false);

    const immediateMarqueeDescription = immediateMarqueeToggle
      ?.closest(".settings-dialog-setting-card")
      ?.querySelector(".settings-dialog-setting-copy p");

    expect(immediateMarqueeDescription?.textContent).toBe(
      "鼠标模式：从画布空白处开始拖动时，立即开始框选。\n触控模式：从画布空白处长按并拖动时，立即开始框选。\n开启该选项会强制打开立即移动。",
    );

    act(() => {
      if (immediateMarqueeToggle === null) {
        return;
      }

      immediateMarqueeToggle.click();
    });

    expect(appHost.state.settings.hypergryphImmediateMarquee).toBe(true);
    expect(immediateMarqueeToggle?.checked).toBe(true);
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        ...DEFAULT_APP_SETTINGS_STORAGE,
        hypergryphImmediateMove: false,
        hypergryphImmediateMarquee: true,
      }),
    );
  });

  it("writes debug settings into AppSettings storage without applying them to the UI", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const settingsButton = container.querySelector(
      ".toolbar-rail-utility .rail-button:last-child",
    ) as HTMLButtonElement | null;

    act(() => {
      settingsButton?.click();
    });

    const showFpsToggle = container.querySelector(
      'input[name="debug-show-fps"]',
    ) as HTMLInputElement | null;
    const showGestureTestWindowToggle = container.querySelector(
      'input[name="debug-show-gesture-diagnostics-window"]',
    ) as HTMLInputElement | null;

    expect(showFpsToggle).not.toBeNull();
    expect(showGestureTestWindowToggle).not.toBeNull();
    expect(showFpsToggle?.checked).toBe(false);
    expect(showGestureTestWindowToggle?.checked).toBe(false);

    act(() => {
      showFpsToggle?.click();
      showGestureTestWindowToggle?.click();
    });

    expect(appHost.state.settings.debugShowFps).toBe(true);
    expect(appHost.state.settings.debugShowGestureDiagnosticsWindow).toBe(true);
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        ...DEFAULT_APP_SETTINGS_STORAGE,
        debugShowFps: true,
        debugShowGestureDiagnosticsWindow: true,
      }),
    );
  });

  it("writes always-show-grid-lines into AppSettings storage without applying grid behavior yet", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const settingsButton = container.querySelector(
      ".toolbar-rail-utility .rail-button:last-child",
    ) as HTMLButtonElement | null;

    act(() => {
      settingsButton?.click();
    });

    const alwaysShowGridLinesToggle = container.querySelector(
      'input[name="game-always-show-grid-lines"]',
    ) as HTMLInputElement | null;

    expect(alwaysShowGridLinesToggle).not.toBeNull();
    expect(alwaysShowGridLinesToggle?.checked).toBe(true);

    act(() => {
      alwaysShowGridLinesToggle?.click();
    });

    expect(appHost.state.settings.gameAlwaysShowGridLines).toBe(false);
    expect(alwaysShowGridLinesToggle?.checked).toBe(false);
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        ...DEFAULT_APP_SETTINGS_STORAGE,
        gameAlwaysShowGridLines: false,
      }),
    );
  });

  it("captures keybinding settings when operation mode is externally off and keeps the mode toggle disabled", () => {
    localStorage.setItem(
      APP_SETTINGS_LOCAL_STORAGE_KEY,
      JSON.stringify({
        locale: "zh-CN",
        themeId: "ayu-light",
        hypergryphOperationMode: false,
      }),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const settingsButton = container.querySelector(
      ".toolbar-rail-utility .rail-button:last-child",
    ) as HTMLButtonElement | null;

    act(() => {
      settingsButton?.click();
    });

    const operationModeToggle = container.querySelector(
      'input[name="game-arknights-operation-mode"]',
    ) as HTMLInputElement | null;
    const immediateMoveToggle = container.querySelector(
      'input[name="game-arknights-immediate-move"]',
    ) as HTMLInputElement | null;
    const immediateMarqueeToggle = container.querySelector(
      'input[name="game-arknights-immediate-marquee"]',
    ) as HTMLInputElement | null;
    const confirmShortcutButton = container.querySelector(
      'button[data-setting-id="shortcut-place-conveyor"]',
    ) as HTMLButtonElement | null;
    const cancelShortcutButton = container.querySelector(
      'button[data-setting-id="shortcut-place-pipe"]',
    ) as HTMLButtonElement | null;
    const rotateShortcutButton = container.querySelector(
      'button[data-setting-id="shortcut-rotate"]',
    ) as HTMLButtonElement | null;

    expect(operationModeToggle).not.toBeNull();
    expect(immediateMoveToggle).not.toBeNull();
    expect(immediateMarqueeToggle).not.toBeNull();
    expect(confirmShortcutButton).not.toBeNull();
    expect(cancelShortcutButton).not.toBeNull();
    expect(rotateShortcutButton).not.toBeNull();
    expect(operationModeToggle?.checked).toBe(false);
    expect(operationModeToggle?.disabled).toBe(true);
    expect(immediateMoveToggle?.checked).toBe(true);
    expect(immediateMoveToggle?.disabled).toBe(true);
    expect(immediateMarqueeToggle?.checked).toBe(false);
    expect(immediateMarqueeToggle?.disabled).toBe(true);
    expect(confirmShortcutButton?.disabled).toBe(false);
    expect(confirmShortcutButton?.textContent).toBe("E");
    expect(rotateShortcutButton?.disabled).toBe(false);
    expect(rotateShortcutButton?.textContent).toBe("R");

    act(() => {
      confirmShortcutButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(confirmShortcutButton?.textContent).toBe("按任意键...");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));
    });

    expect(confirmShortcutButton?.textContent).toBe("P");
    expect(localStorage.getItem(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        locale: "zh-CN",
        themeId: "ayu-light",
        hypergryphOperationMode: false,
      }),
    );
    expect(localStorage.getItem(APP_SHORTCUTS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        ...DEFAULT_APP_SHORTCUTS_STORAGE,
        [SHORTCUT_KEY.PLACE_CONVEYOR]: "P",
      }),
    );
  });

  it("routes global keyboard events only while no dialog shell is visible", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);
    const gestures: GestureEvent[] = [];
    appHost.gestureAdapter.subscribe((event) => gestures.push(event));

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        code: "KeyR",
        key: "r",
      }));
      window.dispatchEvent(new KeyboardEvent("keyup", {
        bubbles: true,
        code: "KeyR",
        key: "r",
      }));
    });

    expect(gestures).toMatchObject([
      {
        type: "key down",
        key: "r",
      },
      {
        type: "key up",
        key: "r",
      },
    ]);

    act(() => {
      appHost.internalActions.openDialog("help");
    });

    expect(container.querySelector(".dialog-shell")).not.toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        code: "KeyR",
        key: "r",
      }));
      window.dispatchEvent(new KeyboardEvent("keyup", {
        bubbles: true,
        code: "KeyR",
        key: "r",
      }));
    });

    expect(gestures).toHaveLength(2);
  });

  it("hides the settings group sidebar on phones while keeping the full settings list scrollable", () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const settingsButton = container.querySelector(
      'button[title="设置"]',
    ) as HTMLButtonElement | null;

    expect(appHost.state.screenProfile.deviceClass).toBe("mobile");
    expect(appHost.state.screenProfile.screenShape).toBe("portrait");

    act(() => {
      settingsButton?.click();
    });

    const dialog = container.querySelector(".settings-dialog") as HTMLDivElement | null;
    const groupTitles = Array.from(
      dialog?.querySelectorAll(".settings-dialog-group-header h3") ?? [],
    ).map((element) => element.textContent);

    expect(dialog).not.toBeNull();
    expect(container.querySelector(".settings-dialog-sidebar")).toBeNull();
    expect(groupTitles).toEqual(["系统", "显示", "游戏", "鹰角操作模式", "快捷键", "其他", "调试"]);
  });

  it("marks help and toolbox dialogs as compact shells on phones", () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const helpButton = container.querySelector(
      'button[title="帮助"]',
    ) as HTMLButtonElement | null;
    const toolboxButton = container.querySelector(
      'button[title="工具箱"]',
    ) as HTMLButtonElement | null;

    expect(appHost.state.screenProfile.deviceClass).toBe("mobile");

    act(() => {
      helpButton?.click();
    });

    expect(container.querySelector(".help-dialog")?.classList.contains("is-mobile-compact")).toBe(true);

    const helpCloseButton = container.querySelector(
      '.help-dialog-header button[title="关闭"]',
    ) as HTMLButtonElement | null;

    act(() => {
      helpCloseButton?.click();
      toolboxButton?.click();
    });

    expect(container.querySelector(".toolbox-dialog")?.classList.contains("is-mobile-compact")).toBe(true);
  });

  it("hides the settings group sidebar on tablets", () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 1024,
      height: 768,
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const settingsButton = container.querySelector(
      'button[title="设置"]',
    ) as HTMLButtonElement | null;

    expect(appHost.state.screenProfile.deviceClass).toBe("tablet");

    act(() => {
      settingsButton?.click();
    });

    expect(container.querySelector(".settings-dialog-sidebar")).toBeNull();
  });

  it("keeps the settings group sidebar visible on desktop-sized devices", () => {
    setViewport({
      width: 820,
      height: 700,
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      maxTouchPoints: 0,
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const settingsButton = container.querySelector(
      'button[title="设置"]',
    ) as HTMLButtonElement | null;

    expect(appHost.state.screenProfile.deviceClass).toBe("desktop");

    act(() => {
      settingsButton?.click();
    });

    expect(container.querySelector(".settings-dialog-sidebar")).not.toBeNull();
  });
});
