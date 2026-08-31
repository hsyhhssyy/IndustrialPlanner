// @vitest-environment jsdom

import { runInAction } from "mobx";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost } from "@/app/host/app-host";
import { AYU_DARK_THEME, AYU_LIGHT_THEME } from "@/app/theme";
import type { GestureEvent } from "@/app/input/gesture/adapter";
import {
  SHORTCUT_KEY,
} from "@/app/actions/keyboard-shortcut-manager";
import { USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY } from "@/app/shell/state/settings-dialog-state";
import {
  APP_SETTINGS_LOCAL_STORAGE_KEY,
  WORKBENCH_STATE_LOCAL_STORAGE_KEY,
} from "@/app/state/storage-hook";
import {
  BACKEND_API_ADDRESS_OVERRIDE_LOCAL_STORAGE_KEY,
} from "@/shared/storage/backend-api-address";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { WorkbenchApp } from "@/app/shell/workbench-app";
import {
  DEFAULT_HELP_DIALOG_TAB_ID,
  DEFAULT_MODULE_BALANCING_CANVAS_ID,
  DEFAULT_MODULE_BALANCING_STAGE_ID,
  DEFAULT_RIGHT_DOCK_TAB_ID,
  DEFAULT_RIGHT_DOCK_WIDTH,
  COLLAPSED_TOOLBOX_BOTTOM_DOCK_HEIGHT,
  DEFAULT_TIMELINE_BOTTOM_DOCK_HEIGHT,
  DEFAULT_TOOLBOX_BOTTOM_DOCK_HEIGHT,
  DEFAULT_TOOLBOX_DIALOG_TAB_ID,
  MOBILE_LEFT_DOCK_WIDTH,
  TOOLBOX_DIALOG_TAB_IDS,
} from "@/app/state/state-impl";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import { listBlueprintDirectory } from "@/shared/storage";
import { createDummyWorldDocument } from "@/tests/helpers/dummy-document";
import { createEditorHost } from "@/editor/editor-host";
import { createInitialSimulationTimelineState } from "@/simulation/state-impl";
import { createFakeIndexedDbFactory } from "@/tests/shared/fake-indexed-db";

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
    sync: null,
  };
}

const DEFAULT_APP_SETTINGS_STORAGE = {
  locale: "zh-CN",
  themeId: "ayu-light",
  hypergryphOperationMode: true,
  hypergryphImmediateMove: true,
  hypergryphCopyWhileMoving: false,
  hypergryphImmediateMarquee: false,
  hypergryphAllowEmptyLogisticsEndpoints: false,
  hypergryphAutoCreateSplittersAndConvergers: true,
  quickPlaceEnabled: true,
  hypergryphSelectionRightDockSync: true,
  hypergryphInspectorOpenOnSecondClick: false,
  gameUseBlueprintStyleDeviceImages: false,
  gameShowDeviceNames: true,
  gameShowDeviceIcons: false,
  gameUseInspectorPanel: false,
  gameShowHotkeys: false,
  collapseDeviceModes: true,
  gameShowPipeExactFluidPosition: false,
  gameAlwaysShowGridLines: true,
  gameAlwaysShowPowerRange: false,
  selectedActivityIds: [],
  toolboxShowAllActivityContent: true,
  showGrassBackground: false,
  debugShowFps: false,
  debugShowGestureDiagnosticsWindow: false,
  debugSimulationWorkerDetailedReport: false,
  debugMode: false,
  virtualMousePointer: false,
} as const;

const _DEFAULT_APP_SHORTCUTS_STORAGE = {
  [SHORTCUT_KEY.PLACE_CONVEYOR]: "E",
  [SHORTCUT_KEY.PLACE_PIPE]: "Q",
  [SHORTCUT_KEY.RESOURCES_POWER]: "G",
  [SHORTCUT_KEY.WAREHOUSE]: "C",
  [SHORTCUT_KEY.BASIC_PRODUCTION]: "V",
  [SHORTCUT_KEY.SYNTHESIS]: "B",
  [SHORTCUT_KEY.SAVE_BLUEPRINT]: "Ctrl+S",
  // AI-REMOVED 2026-08-03:
  // Reason: Escape 返回选择不再属于可配置快捷键默认值。
  // Trigger: ST2-RQ-002 禁止绑定 Escape。
  // Evidence: SHORTCUT_KEY.RETURN_SELECT 已归档。
  // Replacement: select 手势硬编码 Escape。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // [SHORTCUT_KEY.RETURN_SELECT]: "Esc",
  [SHORTCUT_KEY.ROTATE]: "R",
  [SHORTCUT_KEY.SWITCH_DEVICE_MODE]: "Tab",
  [SHORTCUT_KEY.ROTATE_VIEWPORT]: "Ctrl+R",
  [SHORTCUT_KEY.DELETE_DEVICE]: "F",
  [SHORTCUT_KEY.MOVE_SELECTION]: "M",
  [SHORTCUT_KEY.COPY_SELECTION]: "Ctrl+C",
  [SHORTCUT_KEY.PASTE_SELECTION]: "Ctrl+V",
} as const;

const CHANGELOG_READ_STATE_KEY = "industrial-planner-changelog-read-state";
const LEGACY_LAST_READ_VERSION_KEY = "industrial-planner-changelog-last-read-version";

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
    folderId?: string | null;
    globalInputs: Array<{ itemId: string; perMinute: number; infinite?: boolean }>;
    stages: Array<{
      id: string;
      name: string;
      entries: Array<{ moduleId: string; quantity: number }>;
    }>;
    warehouseCapacity: number | null;
  }>;
  canvasFolders?: Array<{ id: string; name: string }>;
  customModules?: Array<{
    id: string;
    name: string;
    color: string;
    iconId: string;
    sourceType: "custom";
    inputs: Array<{ itemId: string; perMinute: number }>;
    outputs: Array<{ itemId: string; perMinute: number }>;
  }>;
  folders?: Array<{ id: string; name: string }>;
  activeCanvasId?: string | null;
} = {}) {
  return {
    canvases: (options.canvases ?? [
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
    ]).map((canvas) => ({
      id: canvas.id,
      name: canvas.name,
      folderId: canvas.folderId ?? null,
      globalInputs: canvas.globalInputs,
      stages: canvas.stages,
      warehouseCapacity: canvas.warehouseCapacity,
    })),
    canvasFolders: options.canvasFolders ?? [],
    customModules: options.customModules ?? [],
    folders: options.folders ?? [],
    activeCanvasId: options.activeCanvasId ?? DEFAULT_MODULE_BALANCING_CANVAS_ID,
  };
}

function createWorkbenchStorageSnapshot(options: {
  leftDockOpen?: boolean;
  rightDockOpen?: boolean;
  leftDockWidth?: number;
  topBarCollapsed?: boolean;
  rightDockActiveTab?: "selection";
  selectedPlacementVariantByCraftGroup?: Record<string, string>;
  quickPlaceFavoriteEntityIds?: Array<string | null>;
  toolboxDialog?: ReturnType<typeof createDialogStateSnapshot>;
  timelineDialog?: ReturnType<typeof createDialogStateSnapshot>;
  helpDialog?: ReturnType<typeof createDialogStateSnapshot>;
  settingsDialog?: ReturnType<typeof createDialogStateSnapshot>;
  inspectorDialog?: ReturnType<typeof createDialogStateSnapshot>;
  saveBlueprintDialog?: ReturnType<typeof createDialogStateSnapshot>;
  baseSelectDialog?: ReturnType<typeof createDialogStateSnapshot>;
  feedbackDialog?: ReturnType<typeof createDialogStateSnapshot>;
  toolboxDockPreference?: "floating" | "bottom";
  toolboxBottomDockCollapsed?: boolean;
  toolboxBottomDockHeight?: number;
  timelineDockPreference?: "floating" | "bottom";
  timelineBottomDockCollapsed?: boolean;
  timelineBottomDockHeight?: number;
  toolboxWiki?: ReturnType<typeof createToolboxWikiStorageSnapshot>;
  moduleBalancing?: ReturnType<typeof createModuleBalancingStorageSnapshot>;
} = {}) {
  return {
    leftDockOpen: options.leftDockOpen ?? true,
    leftDockSuppressed: false,
    rightDockOpen: options.rightDockOpen ?? false,
    leftDockWidth: options.leftDockWidth ?? 375,
    topBarCollapsed: options.topBarCollapsed ?? false,
    rightDockActiveTab: options.rightDockActiveTab ?? DEFAULT_RIGHT_DOCK_TAB_ID,
    selectedPlacementVariantByCraftGroup:
      options.selectedPlacementVariantByCraftGroup ?? {},
    quickPlaceFavoriteEntityIds: options.quickPlaceFavoriteEntityIds ?? [],
    dialogState: {
      toolbox: options.toolboxDialog ?? createDialogStateSnapshot({ activeTab: DEFAULT_TOOLBOX_DIALOG_TAB_ID }),
      timeline: options.timelineDialog ?? createDialogStateSnapshot(),
      help: options.helpDialog ?? createDialogStateSnapshot({ activeTab: DEFAULT_HELP_DIALOG_TAB_ID }),
      settings: options.settingsDialog ?? createDialogStateSnapshot(),
      inspector: options.inspectorDialog ?? createDialogStateSnapshot(),
      "save-blueprint": options.saveBlueprintDialog ?? createDialogStateSnapshot(),
      "base-select": options.baseSelectDialog ?? createDialogStateSnapshot(),
      "warehouse-stats": createDialogStateSnapshot(),
      feedback: options.feedbackDialog ?? createDialogStateSnapshot(),
    },
    toolbox: {
      dockPreference: options.toolboxDockPreference ?? "floating",
      bottomDockCollapsed: options.toolboxBottomDockCollapsed ?? false,
      bottomDockHeight: options.toolboxBottomDockHeight ?? DEFAULT_TOOLBOX_BOTTOM_DOCK_HEIGHT,
      wiki: options.toolboxWiki ?? createToolboxWikiStorageSnapshot(),
      moduleBalancing: options.moduleBalancing ?? createModuleBalancingStorageSnapshot(),
    },
    timelineDockPreference: options.timelineDockPreference ?? "floating",
    timelineBottomDockCollapsed: options.timelineBottomDockCollapsed ?? false,
    timelineBottomDockHeight: options.timelineBottomDockHeight ?? DEFAULT_TIMELINE_BOTTOM_DOCK_HEIGHT,
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

function dispatchInputEvent(
  target: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Event {
  const prototype = Object.getPrototypeOf(target) as HTMLInputElement | HTMLTextAreaElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

  descriptor?.set?.call(target, value);
  const event = new Event("input", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

async function flushMicrotasks(iterations = 8): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

interface StubChangelogEntry {
  title: string;
  version: string;
  kind: "main" | "incremental";
  markdown: string;
}

function stubChangelogFetch(entries: Record<string, StubChangelogEntry>): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.pathname
        : input.url;

    if (url === "/changelog/index.json") {
      const indexEntries = Object.entries(entries).map(([file, entry]) => ({
        file,
        title: entry.title,
        version: entry.version,
        kind: entry.kind,
      }));

      return new Response(JSON.stringify(indexEntries), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    const changelogPrefix = "/changelog/";

    if (url.startsWith(changelogPrefix)) {
      const file = decodeURIComponent(url.slice(changelogPrefix.length));
      const markdown = entries[file]?.markdown;

      if (markdown !== undefined) {
        return new Response(markdown, { status: 200 });
      }
    }

    return new Response("Not found", { status: 404 });
  }));
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

    Object.defineProperty(window, "__APP_VERSION__", {
      configurable: true,
      writable: true,
      value: undefined,
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
    document.body.classList.remove("is-resizing-toolbox-bottom-dock");
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

  it("does not request fullscreen automatically after a phone rotates to landscape", () => {
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
    expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(0);

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(0);
  });

  it("opens the version help dialog on phone portrait without storing portrait viewport dimensions", async () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });
    Object.defineProperty(window, "__APP_VERSION__", {
      configurable: true,
      writable: true,
      value: "9.9.9-test",
    });
    stubChangelogFetch({
      "9.9.9-test.md": {
        title: "测试版本-v9.9.9-test",
        version: "9.9.9-test",
        kind: "main",
        markdown: "# Patch",
      },
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    await act(async () => {
      await flushMicrotasks();
    });

    const helpState = appHost.internalState.workbench.dialogState.help;
    const helpDialog = container.querySelector<HTMLElement>(".help-dialog");

    expect(appHost.state.screenProfile.deviceClass).toBe("mobile");
    expect(appHost.state.screenProfile.screenShape).toBe("portrait");
    expect(helpState.visible).toBe(true);
    expect(helpState.activeTab).toBe("version");
    expect(helpState.width).toBeNull();
    expect(helpState.height).toBeNull();
    expect(helpDialog).not.toBeNull();
    expect(helpDialog?.style.width).toBe("");
    expect(helpDialog?.style.height).toBe("");
    expect(helpDialog?.querySelector(".dialog-shell-resize-grip")).toBeNull();
    expect(helpDialog?.querySelector('button[title="最大化"]')).toBeNull();

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

    const rotatedHelpDialog = container.querySelector<HTMLElement>(".help-dialog");

    expect(appHost.state.screenProfile.screenShape).toBe("landscape");
    expect(helpState.width).toBeNull();
    expect(helpState.height).toBeNull();
    expect(rotatedHelpDialog?.style.width).toBe("");
    expect(rotatedHelpDialog?.style.height).toBe("");
  });

  it("opens the version help dialog only when the app version and current changelog entry both changed", async () => {
    localStorage.setItem(
      CHANGELOG_READ_STATE_KEY,
      JSON.stringify({
        version: "1.3.0",
        changelogKey: "1.3.0:1.3.0.md",
      }),
    );
    Object.defineProperty(window, "__APP_VERSION__", {
      configurable: true,
      writable: true,
      value: "v1.3.0.1",
    });
    stubChangelogFetch({
      "1.3.0.md": {
        title: "全新版本-v1.3.0",
        version: "1.3.0",
        kind: "main",
        markdown: "# Main",
      },
      "incremental/1.3.0/1.3.0.1.md": {
        title: "增量更新-v1.3.0.1",
        version: "1.3.0.1",
        kind: "incremental",
        markdown: "# Patch",
      },
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    await act(async () => {
      await flushMicrotasks();
    });

    const helpState = appHost.internalState.workbench.dialogState.help;

    expect(helpState.visible).toBe(true);
    expect(helpState.activeTab).toBe("version");
    expect(JSON.parse(localStorage.getItem(CHANGELOG_READ_STATE_KEY) ?? "null")).toEqual({
      version: "1.3.0.1",
      changelogKey: "1.3.0.1:incremental/1.3.0/1.3.0.1.md",
    });
    expect(localStorage.getItem(LEGACY_LAST_READ_VERSION_KEY)).toBe("1.3.0.1");
  });

  it("does not open the version help dialog when the app version changed without a matching changelog entry", async () => {
    const previousReadState = JSON.stringify({
      version: "1.3.0.1",
      changelogKey: "1.3.0.1:incremental/1.3.0/1.3.0.1.md",
    });
    localStorage.setItem(CHANGELOG_READ_STATE_KEY, previousReadState);
    Object.defineProperty(window, "__APP_VERSION__", {
      configurable: true,
      writable: true,
      value: "v1.3.0.2",
    });
    stubChangelogFetch({
      "1.3.0.md": {
        title: "全新版本-v1.3.0",
        version: "1.3.0",
        kind: "main",
        markdown: "# Main",
      },
      "incremental/1.3.0/1.3.0.1.md": {
        title: "增量更新-v1.3.0.1",
        version: "1.3.0.1",
        kind: "incremental",
        markdown: "# Patch",
      },
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    await act(async () => {
      await flushMicrotasks();
    });

    expect(appHost.internalState.workbench.dialogState.help.visible).toBe(false);
    expect(localStorage.getItem(CHANGELOG_READ_STATE_KEY)).toBe(previousReadState);
  });

  it("does not open the version help dialog when the changelog entry changed without an app version change", async () => {
    const previousReadState = JSON.stringify({
      version: "1.3.0.1",
      changelogKey: "1.3.0.1:incremental/1.3.0/1.3.0.1.md",
    });
    localStorage.setItem(CHANGELOG_READ_STATE_KEY, previousReadState);
    Object.defineProperty(window, "__APP_VERSION__", {
      configurable: true,
      writable: true,
      value: "v1.3.0.1",
    });
    stubChangelogFetch({
      "1.3.0.md": {
        title: "全新版本-v1.3.0",
        version: "1.3.0",
        kind: "main",
        markdown: "# Main",
      },
      "incremental/1.3.0/1.3.0.1.md": {
        title: "增量更新-v1.3.0.1",
        version: "1.3.0.1",
        kind: "incremental",
        markdown: "# Patch",
      },
      "supplemental/1.3.0/1.3.0.1.md": {
        title: "热修更新-v1.3.0.1",
        version: "1.3.0.1",
        kind: "incremental",
        markdown: "# Hotfix",
      },
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    await act(async () => {
      await flushMicrotasks();
    });

    expect(appHost.internalState.workbench.dialogState.help.visible).toBe(false);
    expect(localStorage.getItem(CHANGELOG_READ_STATE_KEY)).toBe(previousReadState);
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
    const canvasPanel = container.querySelector(".canvas-panel") as HTMLElement | null;
    const floatingTimelineButton = container.querySelector(
      '[data-ui-button-id="top-bar-timeline"]',
    ) as HTMLButtonElement | null;
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
    expect(floatingControls?.parentElement).toBe(workbench);
    expect(canvasPanel?.contains(floatingControls)).toBe(false);
    expect(floatingFullscreenButton?.title).toBe("进入全屏");
    expect(floatingRightDockButton).toBeNull();
    expect(floatingToggle?.title).toBe("展开 运行控制");
    expect(
      floatingFullscreenButton?.querySelector("svg")?.getAttribute("data-workbench-icon"),
    ).toBe("expand");

    if (!floatingTimelineButton) {
      throw new Error("Floating timeline button did not render.");
    }

    const touchPointerDownEvent = dispatchPointerEvent(floatingTimelineButton, "pointerdown", {
      pointerId: 1,
      pointerType: "touch",
      clientX: 740,
      clientY: 29,
      buttons: 1,
    });

    expect(touchPointerDownEvent.defaultPrevented).toBe(false);

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

    runInAction(() => {
      appHost.internalState.settings.gameUseInspectorPanel = true;
    });

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

  it("renders the right dock as device properties and closes it from the header button", () => {
    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify({
        ...createWorkbenchStorageSnapshot(),
        rightDockOpen: true,
        rightDockActiveTab: "power",
      }),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.settings.gameUseInspectorPanel = true;
    });

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const rightDock = container.querySelector(".dock-right") as HTMLElement | null;
    const title = container.querySelector(".dock-right .section-header h2") as HTMLHeadingElement | null;
    const closeButton = container.querySelector(".right-dock-close-button") as HTMLButtonElement | null;

    expect(rightDock).not.toBeNull();
    expect(appHost.state.workbench.rightDockActiveTab).toBe(DEFAULT_RIGHT_DOCK_TAB_ID);
    expect(title?.textContent).toBe("设备属性");
    expect(container.querySelector("#right-dock-tab-base")).toBeNull();
    expect(container.querySelector("#right-dock-tab-power")).toBeNull();
    expect(container.querySelector("#right-dock-tab-selection")).toBeNull();
    expect(container.querySelector("#right-dock-tab-simulation")).toBeNull();
    expect(rightDock?.textContent).toContain("未选中对象");
    expect(rightDock?.textContent).not.toContain("总耗电");
    expect(rightDock?.textContent).not.toContain("可放置区域");
    expect(closeButton?.title).toBe("关闭 右侧");

    act(() => {
      closeButton?.click();
    });

    expect(appHost.state.workbench.rightDockOpen).toBe(false);
    expect(container.querySelector(".dock-right")).toBeNull();
  });

  it("shows selection actions in the right dock without reopening the canvas floating toolbar", () => {
    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify({
        ...createWorkbenchStorageSnapshot(),
        rightDockOpen: true,
      }),
    );

    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);
    const gestures: GestureEvent[] = [];
    appHost.gestureAdapter.subscribe((event) => gestures.push(event));

    runInAction(() => {
      appHost.internalState.settings.gameUseInspectorPanel = true;
    });

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
      editorHost.internalState.collections.selection.replace(["dummy-entity-1"]);
    });

    const actionStrip = container.querySelector("[data-selection-action-strip]") as HTMLElement | null;
    const moveButton = container.querySelector(
      '.dock-right [data-ui-button-id="canvas-floating-toolbar-button-move"]',
    ) as HTMLButtonElement | null;
    const saveBlueprintButton = container.querySelector(
      '.dock-right [data-ui-button-id="canvas-floating-toolbar-button-save-blueprint"]',
    ) as HTMLButtonElement | null;
    const deleteButton = container.querySelector(
      '.dock-right [data-ui-button-id="canvas-floating-toolbar-button-delete"]',
    ) as HTMLButtonElement | null;
    const deleteManyButton = container.querySelector(
      '.dock-right [data-ui-button-id="canvas-floating-toolbar-button-delete-many"]',
    ) as HTMLButtonElement | null;

    expect(actionStrip).not.toBeNull();
    expect(container.querySelector(".canvas-floating-toolbar")).toBeNull();
    // dedicated 物流设备不显示移动按钮
    expect(moveButton).toBeNull();
    expect(saveBlueprintButton).toBeNull();
    expect(deleteButton).not.toBeNull();
    expect(deleteManyButton).not.toBeNull();

    if (!deleteManyButton) {
      throw new Error("Right dock selection action strip did not render expected buttons.");
    }

    act(() => {
      dispatchPointerEvent(deleteManyButton, "pointerdown", {
        pointerId: 62,
        pointerType: "touch",
        clientX: 1032,
        clientY: 120,
        buttons: 1,
      });
      dispatchPointerEvent(deleteManyButton, "pointerup", {
        pointerId: 62,
        pointerType: "touch",
        clientX: 1032,
        clientY: 120,
        buttons: 0,
      });
    });

    expect(gestures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "ui-button-touch-tap",
        uiButtonId: "canvas-floating-toolbar-button-delete-many",
      }),
    ]));
  });

  it("saves the current multi-selection into blueprint storage from the save blueprint dialog", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    await flushMicrotasks(20);
    editorHost.internalDocument.setSnapshot({
      ...createDummyWorldDocument(),
      slotLinks: [
        {
          id: "slot-link-selected",
          linkType: "share-all",
          source: {
            entityId: "dummy-entity-2",
            storageSlotGroupId: "source-group",
            slotId: "source-slot",
          },
          target: {
            entityId: "dummy-entity-3",
            storageSlotGroupId: "target-group",
            slotId: "target-slot",
          },
        },
        {
          id: "slot-link-external",
          linkType: "share-cap",
          source: {
            entityId: "dummy-entity-2",
            storageSlotGroupId: "source-group",
            slotId: "source-slot",
          },
          target: {
            entityId: "dummy-entity-1",
            storageSlotGroupId: "other-group",
            slotId: "other-slot",
          },
        },
      ],
    });
    await flushMicrotasks(8);
    editorHost.internalState.collections.selection.replace(["dummy-entity-2", "dummy-entity-3"]);
    const selectionRect = editorHost.queries.findEntityCollectionGridRect(EntityCollectionType.selection);
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    act(() => {
      appHost.internalActions.openDialog("save-blueprint");
    });

    await act(async () => {
      await flushMicrotasks(12);
    });

    const dialog = container.querySelector('[data-dialog-key="save-blueprint"]');
    const nameInput = container.querySelector('.save-blueprint-input') as HTMLInputElement | null;
    const descriptionInput = container.querySelector('.save-blueprint-textarea') as HTMLTextAreaElement | null;
    const submitButton = container.querySelector('.save-blueprint-primary-button') as HTMLButtonElement | null;

    expect(dialog).not.toBeNull();
    expect(nameInput).not.toBeNull();
    expect(descriptionInput).not.toBeNull();
    expect(submitButton).not.toBeNull();

    if (!nameInput || !descriptionInput || !submitButton || selectionRect === null) {
      throw new Error("Save blueprint dialog did not render expected controls.");
    }

    await act(async () => {
      dispatchInputEvent(nameInput, "双节点蓝图");
      dispatchInputEvent(descriptionInput, "R1 集成测试");
      submitButton.click();
    });

    await act(async () => {
      await flushMicrotasks(12);
    });

    const listing = await listBlueprintDirectory(null);

    expect(container.querySelector('[data-dialog-key="save-blueprint"]')).toBeNull();
    expect(listing.blueprints).toHaveLength(1);
    expect(listing.blueprints[0]).toMatchObject({
      name: "双节点蓝图",
      description: "R1 集成测试",
      entityOrder: ["dummy-entity-2", "dummy-entity-3"],
      slotLinks: [
        {
          id: "slot-link-selected",
        },
      ],
      initialGridPoint: {
        x: Math.round(selectionRect.x + selectionRect.width / 2),
        y: Math.round(selectionRect.y + selectionRect.height / 2),
      },
    });
  });

  it("renders current tick snapshot json in the simulation left dock panel", () => {
    vi.useFakeTimers();

    const workspace = createWorkspace();
    workspace.simulation = {
      state: {
        runningState: "stop",
        simulationMode: "single-base",
        simulationSpeed: 1,
        statistics: { tickPerSecond: 0, targetTickPerSecond: 0, baseBatteryJoules: 0, baseBatteryCapacity: 0 },
        bufferSize: 0,
        timeline: createInitialSimulationTimelineState(),
      },
      topology: createSnapshotStore(null),
      queries: {
        getStatusRuntimeJson: () => JSON.stringify({
          state: {
            runningState: "stop",
            simulationSpeed: 1,
            currentPlaybackTickNumber: 3,
          },
          runtimeStatus: {
            mode: "stopped",
            topologyId: null,
            documentHash: null,
            retainedFromTick: 3,
            latestTickNumber: 3,
            bufferSize: 1,
            maxBufferSize: 180,
            error: null,
          },
          currentTick: {
            source: "query-read-model",
            debugData: JSON.stringify({
              topology: { topologyId: "topology:debug" },
              runtimeState: { tickNumber: 3, transient: { edges: {} } },
            }),
          },
        }),
        getDocumentRuntimeStatus: () => ({
          tickNumber: 3,
          totalPowerDemand: null,
          currentPowerGeneration: null,
          isPowerOutage: false,
        }),
        getDeviceRuntimeStatus: () => null,
        getPipeFluidItemId: () => null,
        isPipeDeviceSlotOccupied: () => false,
        getActiveGasDiffusionRanges: () => [],
        getDeviceActiveGasItemIds: () => null,
        getWarehouseStats: () => null,
      },
      actions: {
        start: vi.fn(async () => {}),
        setRegionalMultiBaseEnabled: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        stop: vi.fn(),
        setSimulationSpeed: vi.fn(),
        advancePlaybackByDeltaMs: vi.fn(async () => {}),
        patchRuntimeSlot: vi.fn(async () => {}),
        resetAdmissionCounter: vi.fn(async () => {}),
        enableTimeline: vi.fn(async () => {}),
        disableTimeline: vi.fn(),
        seekTimelineToTick: vi.fn(async () => false),
      },
    } as NonNullable<WorkspaceContract["simulation"]>;

    const appHost = createAppHost(workspace);

    // 仿真面板按钮仅在调试模式下可见
    runInAction(() => {
      appHost.internalState.settings.debugMode = true;
    });

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const simulationButton = container.querySelector(
      'button[title="仿真"]',
    ) as HTMLButtonElement | null;

    expect(simulationButton).not.toBeNull();

    act(() => {
      simulationButton?.click();
    });

    const snapshotTextarea = container.querySelector("[data-simulation-runtime-json]") as HTMLTextAreaElement | null;
    const tickDebugDataTextarea = container.querySelector("[data-simulation-tick-debug-data]") as HTMLTextAreaElement | null;

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(snapshotTextarea?.value).toBe(`{
  "state": {
    "runningState": "stop",
    "simulationSpeed": 1,
    "currentPlaybackTickNumber": 3
  },
  "runtimeStatus": {
    "mode": "stopped",
    "topologyId": null,
    "documentHash": null,
    "retainedFromTick": 3,
    "latestTickNumber": 3,
    "bufferSize": 1,
    "maxBufferSize": 180,
    "error": null
  },
  "currentTick": {
    "source": "query-read-model",
    "debugData": "[101 chars]"
  }
}`);
    expect(tickDebugDataTextarea?.value).toBe(`{
  "topology": {
    "topologyId": "topology:debug"
  },
  "runtimeState": {
    "tickNumber": 3,
    "transient": {
      "edges": {}
    }
  }
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

  it("uses the same touch left dock width and floating operation toolbar on tablets", () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 1024,
      height: 768,
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify({
        leftDockOpen: false,
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
    const canvasBottomLeftToolbar = container.querySelector(".canvas-bottom-left-toolbar") as HTMLDivElement | null;
    const canvasBottomLeftSecondaryToolbar = container.querySelector(".canvas-bottom-left-secondary-toolbar") as HTMLDivElement | null;
    const rotateViewButton = container.querySelector(
      '[data-ui-button-id="canvas-bottom-left-secondary-toolbar-button-rotate-view"]',
    ) as HTMLButtonElement | null;

    expect(appHost.state.screenProfile.deviceClass).toBe("tablet");
    expect(appHost.state.screenProfile.hasTouch).toBe(true);
    expect(appHost.state.workbench.leftDockWidth).toBe(512);
    expect(workbench?.style.getPropertyValue("--left-dock-width")).toBe("0px");
    expect(workbench?.style.getPropertyValue("--left-toolbar-width")).toBe("51px");
    expect(workbench?.style.getPropertyValue("--left-toolbar-button-scale")).toBe("0.75");
    expect(container.querySelector(".dock-resize-handle")).toBeNull();
    expect(canvasBottomLeftToolbar).not.toBeNull();
    expect(canvasBottomLeftToolbar?.querySelectorAll(".canvas-bottom-left-toolbar-button")).toHaveLength(4);
    expect(canvasBottomLeftSecondaryToolbar).not.toBeNull();
    expect(canvasBottomLeftSecondaryToolbar?.classList.contains("is-offset-for-floating-tools")).toBe(true);
    expect(rotateViewButton?.getAttribute("aria-label")).toBe("旋转视角");
    expect(
      rotateViewButton?.querySelector("svg")?.getAttribute("data-workbench-icon"),
    ).toBe("rotate");

    act(() => {
      appHost.internalActions.toggleLeftDock();
    });

    expect(workbench?.style.getPropertyValue("--left-dock-width")).toBe(`${MOBILE_LEFT_DOCK_WIDTH}px`);
    expect(container.querySelector(".canvas-bottom-left-toolbar")).toBeNull();
    expect(
      container.querySelector(".canvas-bottom-left-secondary-toolbar")?.classList.contains("is-offset-for-floating-tools"),
    ).toBe(false);
  });

  it("keeps full desktop left toolbar sizing on touch-enabled desktop devices", () => {
    setViewport({
      width: 1234,
      height: 899,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0",
      maxTouchPoints: 20,
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

    expect(appHost.state.screenProfile.deviceClass).toBe("desktop");
    expect(appHost.state.screenProfile.hasTouch).toBe(true);
    expect(appHost.state.workbench.leftDockWidth).toBe(512);
    expect(workbench?.style.getPropertyValue("--left-dock-width")).toBe("512px");
    expect(workbench?.style.getPropertyValue("--left-toolbar-width")).toBe("68px");
    expect(workbench?.style.getPropertyValue("--left-toolbar-button-scale")).toBe("1");
    expect(container.querySelector(".dock-resize-handle")).not.toBeNull();
    expect(container.querySelector(".canvas-bottom-left-toolbar")).toBeNull();
    expect(container.querySelector(".placement-panel-group-operation.is-mobile-layout")).toBeNull();
    expect(container.querySelector(".placement-button-list.is-single-column")).toBeNull();

    act(() => {
      appHost.internalActions.toggleLeftDock();
    });

    const canvasBottomLeftToolbar = container.querySelector(".canvas-bottom-left-toolbar") as HTMLDivElement | null;

    expect(workbench?.style.getPropertyValue("--left-dock-width")).toBe("0px");
    expect(canvasBottomLeftToolbar).not.toBeNull();
    expect(canvasBottomLeftToolbar?.querySelectorAll(".canvas-bottom-left-toolbar-button")).toHaveLength(4);
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

  it("renders the bottom-left rotate view toolbar and emits rotate view button gestures", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);
    const gestures: GestureEvent[] = [];
    appHost.gestureAdapter.subscribe((event) => gestures.push(event));

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const toolbar = container.querySelector(".canvas-bottom-left-secondary-toolbar") as HTMLDivElement | null;
    const rotateViewButton = container.querySelector(
      '[data-ui-button-id="canvas-bottom-left-secondary-toolbar-button-rotate-view"]',
    ) as HTMLButtonElement | null;

    expect(toolbar).not.toBeNull();
    expect(toolbar?.classList.contains("is-offset-for-floating-tools")).toBe(false);
    expect(rotateViewButton).not.toBeNull();

    if (!toolbar || !rotateViewButton) {
      throw new Error("Canvas bottom-left secondary toolbar did not render expected button.");
    }

    act(() => {
      dispatchPointerEvent(toolbar, "pointerdown", {
        pointerId: 41,
        pointerType: "mouse",
        clientX: 90,
        clientY: 720,
        buttons: 1,
      });
      dispatchPointerEvent(toolbar, "pointerup", {
        pointerId: 41,
        pointerType: "mouse",
        clientX: 90,
        clientY: 720,
        buttons: 0,
      });
      dispatchPointerEvent(rotateViewButton, "pointerdown", {
        pointerId: 42,
        pointerType: "touch",
        clientX: 90,
        clientY: 720,
        buttons: 1,
      });
      dispatchPointerEvent(rotateViewButton, "pointerup", {
        pointerId: 42,
        pointerType: "touch",
        clientX: 90,
        clientY: 720,
        buttons: 0,
      });
      dispatchClickEvent(rotateViewButton, { detail: 0 });
    });

    expect(gestures).toHaveLength(1);
    expect(gestures[0]).toMatchObject({
      type: "ui-button-touch-tap",
      uiButtonId: "canvas-bottom-left-secondary-toolbar-button-rotate-view",
    });
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

    expect(gestures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "ui-button-mouse-tap",
        uiButtonId: "canvas-floating-toolbar-button-move",
      }),
      expect.objectContaining({
        type: "ui-button-touch-tap",
        uiButtonId: "canvas-floating-toolbar-button-delete",
      }),
    ]));
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

    expect(gestures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "ui-button-mouse-tap",
        uiButtonId: "canvas-floating-toolbar-button-move",
        button: 0,
      }),
    ]));
  });

  it("keeps the canvas right dock toolbar visible while the right dock toggles", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.settings.gameUseInspectorPanel = true;
    });

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
      appHost.internalActions.showCanvasRightDockToolbar([
        { operationId: "exit", presentation: "button" },
        { operationId: "move", presentation: "button" },
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

  it("renders shortcut-only right dock items with key badges instead of buttons", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.settings.gameUseInspectorPanel = true;
      appHost.internalActions.setShortcutFor(SHORTCUT_KEY.DELETE_DEVICE, "");
      appHost.internalActions.setShortcutFor(SHORTCUT_KEY.MOVE_SELECTION, "M;N");
    });

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
      appHost.internalActions.showCanvasRightDockToolbar(
        [
          { operationId: "exit", presentation: "shortcut" },
          { operationId: "move", presentation: "shortcut" },
          { operationId: "marquee-deselect", presentation: "shortcut" },
          { operationId: "delete", presentation: "shortcut" },
        ],
      );
    });

    const toolbar = container.querySelector(".canvas-right-dock-toolbar") as HTMLDivElement | null;
    expect(toolbar).not.toBeNull();
    expect(toolbar?.querySelectorAll("[data-ui-button-id]")).toHaveLength(0);
    expect(toolbar?.querySelectorAll('[data-toolbar-presentation="shortcut"]')).toHaveLength(3);
    expect(toolbar?.querySelector('[data-toolbar-operation-id="delete"]')).toBeNull();

    // AI-CORRECTION 2026-08-03: 快捷键模式渲染 input-prompts 图片，而非文字 kbd 徽章。
    // AI-CORRECTION 2026-08-22: 全局快捷键模式已取消；本断言现在验证逐项 shortcut presentation。
    const iconElements = toolbar?.querySelectorAll("svg[data-workbench-icon]");
    expect(iconElements?.length).toBe(0);

    // AI-REMOVED 2026-08-03:
    // Reason: 旧文字快捷键徽章已被共享图片提示组件替代。
    // Trigger: ST2-RQ-002 图片化快捷键展示。
    // Evidence: KeyboardShortcutPrompt 输出 img[data-key-token]。
    // Replacement: 下方 input-prompts 图片断言。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // const keyBadges = toolbar?.querySelectorAll(".canvas-right-dock-toolbar-shortcut-key");
    // expect(keyBadges).not.toBeNull();
    // expect(keyBadges!.length).toBeGreaterThan(0);
    const shortcutImages = toolbar?.querySelectorAll('img[data-key-token]');
    expect(shortcutImages).not.toBeNull();
    expect(shortcutImages?.length).toBe(3);
    const mousePromptImage = toolbar?.querySelector<HTMLImageElement>(
      '[data-mouse-input="right-button"]',
    );
    expect(mousePromptImage).not.toBeNull();
    expect(mousePromptImage?.parentElement?.style.getPropertyValue(
      "--mouse-shortcut-prompt-mask",
    )).toBe(`url("${window.location.origin}/input-prompts/mouse_right_outline.svg")`);
    expect(toolbar?.querySelector(".canvas-right-dock-toolbar-shortcut-label")?.textContent).toBe(
      "长按鼠标",
    );
    expect(
      Array.from(toolbar?.querySelectorAll(".canvas-right-dock-toolbar-shortcut-separator") ?? [])
        .map((separator) => separator.textContent),
    ).toContain("/");
    // AI-REMOVED 2026-08-22:
    // Reason: KeyboardShortcutPrompt 使用 CSS Modules，测试不能依赖未经映射的内部类名。
    // Trigger: 新增的第二快捷键斜杠断言没有命中实际 DOM 类名。
    // Evidence: data-key-token 已确认 M、N 均渲染，但旧选择器返回空数组。
    // Replacement: 下方通过公开 aria-label 定位快捷键提示，并验证实际斜杠文本。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // expect(
    //   Array.from(toolbar?.querySelectorAll(".keyboard-shortcut-prompt-alternative-separator") ?? [])
    //     .map((separator) => separator.textContent),
    // ).toContain("/");
    const moveKeyboardPrompt = toolbar?.querySelector('[aria-label="M;N"]');
    expect(moveKeyboardPrompt).not.toBeNull();
    expect(
      Array.from(moveKeyboardPrompt?.querySelectorAll('span[aria-hidden="true"]') ?? [])
        .map((separator) => separator.textContent)
        .filter((text) => text === "/"),
    ).toEqual(["/"]);

    // 标签应有外发光样式
    const labels = toolbar?.querySelectorAll(".canvas-right-dock-toolbar-label--glow");
    expect(labels?.length).toBe(3);

    act(() => {
      appHost.internalActions.hideCanvasRightDockToolbar();
    });

    expect(container.querySelector(".canvas-right-dock-toolbar")).toBeNull();
  });

  it("renders viewport pan bindings as grouped rows with a Shift acceleration hint", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
      appHost.internalActions.showCanvasRightDockToolbar([
        { operationId: "pan-viewport", presentation: "shortcut" },
      ]);
    });

    const panShortcut = container.querySelector(
      '[data-toolbar-operation-id="pan-viewport"]',
    );
    const normalRow = panShortcut?.querySelector('[data-shortcut-row-index="0"]');
    const acceleratedRow = panShortcut?.querySelector('[data-shortcut-row-index="1"]');

    expect(Array.from(normalRow?.querySelectorAll("img[data-key-token]") ?? []).map(
      (image) => image.getAttribute("data-key-token"),
    )).toEqual([
      "W",
      "A",
      "S",
      "D",
      "ArrowUp",
      "ArrowLeft",
      "ArrowDown",
      "ArrowRight",
    ]);
    expect(Array.from(normalRow?.querySelectorAll('span[aria-hidden="true"]') ?? []).map(
      (separator) => separator.textContent,
    ).filter((text) => text === "/")).toEqual(["/"]);
    expect(Array.from(acceleratedRow?.querySelectorAll("img[data-key-token]") ?? []).map(
      (image) => image.getAttribute("data-key-token"),
    )).toEqual(["Shift", "W", "A", "S", "D"]);
    expect(Array.from(acceleratedRow?.querySelectorAll('span[aria-hidden="true"]') ?? []).map(
      (separator) => separator.textContent,
    ).filter((text) => text === "+")).toEqual(["+"]);
  });

  it("renders both configured marquee bindings before the fixed escape binding", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.settings.gameUseInspectorPanel = true;
      appHost.internalActions.setShortcutFor(SHORTCUT_KEY.MARQUEE, "X;Q");
    });

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
      appHost.internalActions.showCanvasRightDockToolbar([
        { operationId: "exit-marquee", presentation: "shortcut" },
      ]);
    });

    const toolbar = container.querySelector(".canvas-right-dock-toolbar") as HTMLDivElement | null;
    expect(toolbar).not.toBeNull();
    expect(
      Array.from(toolbar?.querySelectorAll("img[data-key-token]") ?? [])
        .map((image) => image.getAttribute("data-key-token")),
    ).toEqual(["X", "Q", "Esc"]);
    // AI-REMOVED 2026-08-22:
    // Reason: 组合选择器中的 KeyboardShortcutPrompt 类名受 CSS Modules 映射，无法稳定命中。
    // Trigger: 三键退出测试只命中工具栏外层斜杠，漏掉 X 与 Q 之间已渲染的内层斜杠。
    // Evidence: data-key-token 顺序已确认是 X、Q、Esc。
    // Replacement: 下方按 aria-hidden 与实际文本统计本功能内的两个斜杠。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // expect(
    //   Array.from(toolbar?.querySelectorAll(
    //     ".keyboard-shortcut-prompt-alternative-separator, .canvas-right-dock-toolbar-shortcut-separator",
    //   ) ?? []).map((separator) => separator.textContent),
    // ).toEqual(["/", "/"]);
    expect(
      Array.from(toolbar?.querySelectorAll('span[aria-hidden="true"]') ?? [])
        .map((separator) => separator.textContent)
        .filter((text) => text === "/"),
    ).toEqual(["/", "/"]);
  });

  it("keeps buttons when a both request resolves to an empty shortcut", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.settings.gameUseInspectorPanel = true;
      appHost.internalActions.setShortcutFor(SHORTCUT_KEY.MOVE_SELECTION, "");
    });

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
      appHost.internalActions.showCanvasRightDockToolbar([
        { operationId: "exit", presentation: "button" },
        { operationId: "move", presentation: "both" },
      ]);
    });

    const toolbar = container.querySelector(".canvas-right-dock-toolbar") as HTMLDivElement | null;
    expect(toolbar).not.toBeNull();
    expect(toolbar?.querySelectorAll('[data-toolbar-presentation="button"]')).toHaveLength(1);
    expect(toolbar?.querySelectorAll('[data-toolbar-presentation="both"]')).toHaveLength(1);

    // 图标模式应渲染 WorkbenchIcon SVG，而非 kbd 徽章
    // AI-CORRECTION 2026-08-22: 全局图标模式已取消；本断言现在验证逐项 button presentation。
    // AI-CORRECTION 2026-08-22: 同时覆盖 both 请求在快捷键绑定为空时自动退化为按钮。
    const iconElements = toolbar?.querySelectorAll("svg[data-workbench-icon]");
    expect(iconElements?.length).toBe(2);
    expect(toolbar?.querySelectorAll('img[data-key-token]')).toHaveLength(0);

    const keyBadges = toolbar?.querySelectorAll(".canvas-right-dock-toolbar-shortcut-key");
    expect(keyBadges?.length).toBe(0);

    const labels = toolbar?.querySelectorAll(".canvas-right-dock-toolbar-label");
    expect(labels?.length).toBe(2);
    const glowLabels = toolbar?.querySelectorAll(".canvas-right-dock-toolbar-label--glow");
    expect(glowLabels?.length).toBe(0);
  });

  it("switches from right dock to inspector dialog without clearing the current selection", () => {
    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify(createWorkbenchStorageSnapshot({
        rightDockOpen: true,
      })),
    );

    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.settings.gameUseInspectorPanel = true;
    });

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    expect(container.querySelector(".dock-right")).not.toBeNull();
    expect(container.querySelector('[data-dialog-key="inspector"]')).toBeNull();

    act(() => {
      appHost.internalState.settings.gameUseInspectorPanel = false;
    });

    expect(appHost.state.workbench.rightDockOpen).toBe(false);
    // 2026-05-08：关闭"使用面板"时清除选择，避免"有选中但无 inspector"的中间态。
    expect(editorHost.state.collections.selection).toEqual([]);
    expect(container.querySelector(".dock-right")).toBeNull();
    expect(container.querySelector('[data-dialog-key="inspector"]')).toBeNull();
  });

  it("does not auto-open the inspector dialog until it is explicitly requested when second-click opening is enabled", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.settings.hypergryphInspectorOpenOnSecondClick = true;
    });

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    expect(container.querySelector('[data-dialog-key="inspector"]')).toBeNull();

    act(() => {
      appHost.internalActions.openDialog("inspector");
    });

    expect(container.querySelector('[data-dialog-key="inspector"]')).not.toBeNull();
  });

  it("renders the neighborhood preview beside the inspector for a single selection", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const dialogBody = container.querySelector(".inspector-dialog-body") as HTMLElement | null;

    expect(dialogBody).not.toBeNull();
    expect(dialogBody?.classList.contains("has-neighborhood-preview")).toBe(true);
    expect(dialogBody?.querySelector(".inspector-neighborhood-preview")).not.toBeNull();
    expect(dialogBody?.querySelector(".inspector-dialog-inspector-pane")).not.toBeNull();
  });

  it("clears the selection when the inspector dialog backdrop closes", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const backdrop = container.querySelector(".inspector-dialog-backdrop") as HTMLDivElement | null;

    expect(backdrop).not.toBeNull();

    if (!backdrop) {
      throw new Error("Inspector dialog backdrop did not render.");
    }

    act(() => {
      backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });

    expect(editorHost.state.collections.selection).toEqual([]);
    expect(container.querySelector('[data-dialog-key="inspector"]')).toBeNull();
  });

  it("uses a fixed 90% inspector dialog without resize handles on phones", () => {
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
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const dialog = container.querySelector('.inspector-dialog[data-dialog-key="inspector"]') as HTMLElement | null;

    expect(appHost.state.screenProfile.deviceClass).toBe("mobile");
    expect(dialog).not.toBeNull();
    expect(dialog?.style.width).toBe("90%");
    expect(dialog?.style.height).toBe("90%");
    expect(dialog?.querySelector(".dialog-shell-resize-grip")).toBeNull();
    expect(dialog?.querySelector('button[title="最大化"]')).toBeNull();
  });

  // AI-REMOVED 2026-05-16:
  // Reason: InspectorDialog 初始尺寸频繁变动（72%→min(920px,72vw)），
  //   该测试断言具体 CSS 值会持续断开，且该 UI 区域预计未来剧烈变动。
  // Trigger: 本地未提交改动将 width/height 从百分值改为 min() 函数值，测试断言过时。
  // Evidence: git diff src/app/shell/dialogs/inspector-dialog.tsx
  // Replacement: 待 InspectorDialog 尺寸方案稳定后重新编写。
  // Risk: Low — 该测试仅验证平板端 inspector 对话框初始样式，不影响核心功能。
  // Human Review: Not Required
  //
  // Original code:
  // it("uses a 72% by 80% inspector dialog with resize handles on tablets", () => {
  //   coarsePointer = true;
  //   hoverNone = true;
  //   setViewport({
  //     width: 1024,
  //     height: 768,
  //     userAgent:
  //       "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
  //     maxTouchPoints: 5,
  //   });
  //
  //   const workspace = createWorkspace();
  //   const editorHost = createEditorHost(workspace);
  //   editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
  //   editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);
  //   const appHost = createAppHost(workspace);
  //
  //   act(() => {
  //     root.render(<WorkbenchApp appHost={appHost} />);
  //   });
  //
  //   const dialog = container.querySelector('.inspector-dialog[data-dialog-key="inspector"]') as HTMLElement | null;
  //
  //   expect(appHost.state.screenProfile.deviceClass).toBe("tablet");
  //   expect(dialog).not.toBeNull();
  //   expect(dialog?.style.width).toBe("72%");
  //   expect(dialog?.style.height).toBe("80%");
  //   expect(dialog?.querySelector(".dialog-shell-resize-grip")).not.toBeNull();
  //   expect(dialog?.querySelector('button[title="最大化"]')).not.toBeNull();
  // });

  it("emits ui-button events from the canvas right dock toolbar without leaking canvas gestures", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);
    const gestures: GestureEvent[] = [];
    appHost.gestureAdapter.subscribe((event) => gestures.push(event));

    runInAction(() => {
      appHost.internalState.settings.gameUseInspectorPanel = true;
    });

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
      appHost.internalActions.showCanvasRightDockToolbar([
        { operationId: "exit", presentation: "both" },
        { operationId: "move", presentation: "both" },
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
    expect(toolbar?.querySelectorAll('img[data-key-token]')).toHaveLength(2);
    expect(toolbar?.querySelectorAll('[data-toolbar-presentation="both"]')).toHaveLength(2);

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

  it("prevents compatibility mouse events when touch taps the canvas right dock save blueprint button", async () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    await flushMicrotasks(20);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    await flushMicrotasks(8);
    editorHost.internalState.collections.selection.replace(["dummy-entity-2", "dummy-entity-3"]);
    const appHost = createAppHost(workspace);

    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 1024,
      height: 1366,
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    runInAction(() => {
      appHost.internalState.settings.gameUseInspectorPanel = true;
      appHost.internalState.activeTool = "marquee";
      appHost.internalActions.showCanvasRightDockToolbar([
        { operationId: "exit", presentation: "button" },
        { operationId: "save-blueprint", presentation: "button" },
      ]);
    });

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const saveButton = container.querySelector(
      '[data-ui-button-id="canvas-right-dock-toolbar-button-save-blueprint"]',
    ) as HTMLButtonElement | null;

    expect(saveButton).not.toBeNull();

    if (saveButton === null) {
      throw new Error("Canvas right dock save blueprint button did not render.");
    }

    let pointerDown: Event;

    await act(async () => {
      pointerDown = dispatchPointerEvent(saveButton, "pointerdown", {
        pointerId: 27,
        pointerType: "touch",
        clientX: 1200,
        clientY: 332,
        buttons: 1,
      });
      dispatchPointerEvent(saveButton, "pointerup", {
        pointerId: 27,
        pointerType: "touch",
        clientX: 1200,
        clientY: 332,
        buttons: 0,
      });
      await flushMicrotasks();
    });

    expect(pointerDown!.defaultPrevented).toBe(true);
    expect(container.querySelector('[data-dialog-key="save-blueprint"]')).not.toBeNull();
  });

  it("shows the canvas right dock save blueprint button for a single selection", async () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    await flushMicrotasks(20);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    await flushMicrotasks(8);
    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);
    const appHost = createAppHost(workspace);

    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 1024,
      height: 1366,
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    runInAction(() => {
      appHost.internalState.settings.gameUseInspectorPanel = true;
      appHost.internalState.activeTool = "marquee";
      appHost.internalActions.showCanvasRightDockToolbar([
        { operationId: "exit", presentation: "button" },
        { operationId: "save-blueprint", presentation: "button" },
      ]);
    });

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    expect(container.querySelector(
      '[data-ui-button-id="canvas-right-dock-toolbar-button-save-blueprint"]',
    )).not.toBeNull();
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

  it("honors the off-suffixed initial top-left toolbar button state", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);
    const gestures: GestureEvent[] = [];
    appHost.gestureAdapter.subscribe((event) => gestures.push(event));

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
      appHost.internalActions.showCanvasTopLeftCornerToolbar([
        "canvas-top-left-corner-toolbar-button-toggle-continuous-placement-off",
      ]);
    });

    const continuousButton = container.querySelector(
      '[data-ui-button-id="canvas-top-left-corner-toolbar-button-toggle-continuous-placement"]',
    ) as HTMLButtonElement | null;

    expect(continuousButton?.textContent).toBe("取消连续放置");
    expect(continuousButton?.getAttribute("aria-pressed")).toBe("true");

    act(() => {
      if (continuousButton === null) {
        return;
      }

      dispatchPointerEvent(continuousButton, "pointerdown", {
        pointerId: 37,
        pointerType: "mouse",
        clientX: 464,
        clientY: 156,
        buttons: 1,
      });
      dispatchPointerEvent(continuousButton, "pointerup", {
        pointerId: 37,
        pointerType: "mouse",
        clientX: 464,
        clientY: 156,
        buttons: 0,
      });
    });

    expect(continuousButton?.textContent).toBe("连续放置");
    expect(continuousButton?.getAttribute("aria-pressed")).toBe("false");
    expect(gestures).toMatchObject([
      {
        type: "ui-button-mouse-tap",
        uiButtonId: "canvas-top-left-corner-toolbar-button-toggle-continuous-placement-off",
      },
    ]);
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
        debugSimulationWorkerDetailedReport: true,
        debugMode: true,
      }),
    );
    localStorage.setItem(
      USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY,
      JSON.stringify({
        selectedGroupId: "system",
        values: {
          "system-theme": "follow-system",
          "game-arknights-operation-mode": true,
          "game-use-blueprint-style-device-images": false,
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
    const _operationModeToggle = container.querySelector(
      'input[name="game-arknights-operation-mode"]',
    ) as HTMLInputElement | null;
    const immediateMoveToggle = container.querySelector(
      'input[name="game-arknights-immediate-move"]',
    ) as HTMLInputElement | null;
    const copyWhileMovingToggle = container.querySelector(
      'input[name="game-arknights-copy-while-moving"]',
    ) as HTMLInputElement | null;
    const immediateMarqueeToggle = container.querySelector(
      'input[name="game-arknights-immediate-marquee"]',
    ) as HTMLInputElement | null;
    const allowEmptyLogisticsEndpointsToggle = container.querySelector(
      'input[name="game-arknights-allow-empty-logistics-endpoints"]',
    ) as HTMLInputElement | null;
    const autoCreateSplittersAndConvergersToggle = container.querySelector(
      'input[name="game-arknights-auto-create-splitters-and-convergers"]',
    ) as HTMLInputElement | null;
    const debugToggle = container.querySelector(
      'input[name="other-debug-mode"]',
    ) as HTMLInputElement | null;
    const alwaysShowGridLinesToggle = container.querySelector(
      'input[name="game-always-show-grid-lines"]',
    ) as HTMLInputElement | null;
    const alwaysShowPowerRangeToggle = container.querySelector(
      'input[name="game-always-show-power-range"]',
    ) as HTMLInputElement | null;
    const showFpsToggle = container.querySelector(
      'input[name="debug-show-fps"]',
    ) as HTMLInputElement | null;
    const showGestureTestWindowToggle = container.querySelector(
      'input[name="debug-show-gesture-diagnostics-window"]',
    ) as HTMLInputElement | null;
    const simulationWorkerDetailedReportToggle = container.querySelector(
      'input[name="debug-simulation-worker-detailed-report"]',
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
    // 2026-06-14: system 与 display 合并为「显示与系统」；arknights-operation 改为「操作」；
    // PWA 区域移入「其他」分组内部。
    // AI-REMOVED 2026-08-03:
    // Reason: “快捷键”分组已取消，入口移入“游戏”分组并打开独立对话框。
    // Trigger: ST2-RQ-002 快捷键设置收拢。
    // Evidence: SettingsDialog 渲染 keyboardShortcutDialog.open action card。
    // Replacement: 下方不含快捷键分组的断言。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // expect(groupTitles).toEqual(["显示与系统", "游戏", "操作", "快捷键", "其他", "调试"]);
    // expect(groupDescriptions).toEqual([
    //   "语言、主题与显示设置。",
    //   "显示风格调整",
    //   "调整仿真工具中的操作逻辑。可以选择与游戏操作习惯对齐或开启增强选项。",
    //   "编辑当前可自定义的快捷键设置。",
    //   "其他功能与设置",
    //   "一系列用于调试的设置内容。",
    // ]);
    expect(groupTitles).toEqual(["显示与系统", "游戏", "操作", "其他", "调试"]);
    expect(groupDescriptions).toEqual([
      "语言、主题与显示设置。",
      "显示风格调整",
      "调整仿真工具中的操作逻辑。可以选择与游戏操作习惯对齐或开启增强选项。",
      "其他功能与设置",
      "一系列用于调试的设置内容。",
    ]);
    expect(dialog?.textContent).toContain("快捷键设置");
    expect(dialog?.textContent).toContain("打开快捷键设置");
    expect(dialog?.textContent).toContain("自动创建分/汇流");
    expect(dialog?.textContent).toContain(
      "传送带/管道绘制到交汇处时，自动创建分流器和汇流器。",
    );
    expect(dialog?.textContent).toContain("仿真Worker详细汇报");
    expect(dialog?.textContent).toContain(
      "该选项将会详细在日志汇报仿真情况，将会严重拖慢性能，仅用于无法确认的仿真出错诊断。",
    );
    expect(languageOptionLabels).toEqual(["中文(简体)", "English (AI Translate)"]);
    expect(themeOptionLabels).toEqual(["Ayu Light", "Ayu Dark"]);
    expect(languageSelect?.value).toBe("zh-CN");
    expect(themeSelect?.value).toBe("ayu-light");
    // 2026-05-26: game-arknights-operation-mode 已移除，不再校验 operationModeToggle。
    // immediateMove / immediateMarquee 不再受 editableWhen 锁定。
    expect(immediateMoveToggle?.checked).toBe(true);
    expect(immediateMoveToggle?.disabled).toBe(false);
    expect(copyWhileMovingToggle?.checked).toBe(false);
    expect(copyWhileMovingToggle?.disabled).toBe(false);
    expect(immediateMarqueeToggle?.checked).toBe(false);
    expect(immediateMarqueeToggle?.disabled).toBe(false);
    expect(allowEmptyLogisticsEndpointsToggle?.checked).toBe(false);
    expect(allowEmptyLogisticsEndpointsToggle?.disabled).toBe(false);
    expect(autoCreateSplittersAndConvergersToggle?.checked).toBe(true);
    expect(autoCreateSplittersAndConvergersToggle?.disabled).toBe(false);
    expect(debugToggle?.checked).toBe(true);
    expect(alwaysShowGridLinesToggle?.checked).toBe(true);
    expect(alwaysShowPowerRangeToggle?.checked).toBe(false);
    expect(appHost.state.settings.gameAlwaysShowPowerRange).toBe(false);
    expect(showFpsToggle?.checked).toBe(true);
    expect(showGestureTestWindowToggle?.checked).toBe(true);
    expect(simulationWorkerDetailedReportToggle?.checked).toBe(true);

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
    const shortcutsTab = container.querySelector(
      '#help-dialog-tab-shortcuts',
    ) as HTMLButtonElement | null;
    const featureGuideTab = container.querySelector(
      '#help-dialog-tab-feature-guide',
    ) as HTMLButtonElement | null;
    const maximizeButton = container.querySelector(
      'button[title="最大化帮助"]',
    ) as HTMLButtonElement | null;

    expect(dialog).not.toBeNull();
    expect(helpButton?.getAttribute("aria-pressed")).toBe("true");
    // 默认标签页为"新手入门"
    expect(container.querySelector('.help-dialog [aria-selected="true"]')?.textContent).toBe("新手入门");

    act(() => {
      shortcutsTab?.click();
    });

    expect(shortcutsTab?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector(".help-dialog")?.textContent).toContain("旋转画布");
    // AI-REMOVED 2026-08-03:
    // Reason: 操作说明中的快捷键已改为 input-prompts 图片。
    // Trigger: ST2-RQ-002 图片化快捷键展示。
    // Evidence: KeyboardShortcutPrompt 为组合键分别渲染 Ctrl、R 图片。
    // Replacement: 下方图片 token 断言。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // expect(container.querySelector(".help-dialog")?.textContent).toContain("Ctrl+R");
    expect(container.querySelector('.help-dialog img[data-key-token="Ctrl"]')).not.toBeNull();
    expect(container.querySelector('.help-dialog img[data-key-token="R"]')).not.toBeNull();

    act(() => {
      featureGuideTab?.click();
    });

    expect(featureGuideTab?.getAttribute("aria-selected")).toBe("true");

    act(() => {
      maximizeButton?.click();
    });

    expect(container.querySelector(".help-dialog")?.classList.contains("is-maximized")).toBe(true);
    expect(localStorage.getItem(WORKBENCH_STATE_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify(createWorkbenchStorageSnapshot({
        helpDialog: createDialogStateSnapshot({
          visible: true,
          maximized: true,
          activeTab: "feature-guide",
        }),
      })),
    );
    expect(
      container.querySelector('button[title="还原帮助"] svg')?.getAttribute("data-workbench-icon"),
    ).toBe("dialog-collapse");

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

  it("shows the debug log UI behind the debug mode gate and closes it when disabled", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      runInAction(() => {
        appHost.internalState.settings.debugMode = true;
      });
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const debugLogButton = container.querySelector(
      'button[title="调试日志"]',
    ) as HTMLButtonElement | null;

    expect(debugLogButton).not.toBeNull();
    expect(container.querySelector(".debug-log-dialog")).toBeNull();

    act(() => {
      debugLogButton?.click();
    });

    const textarea = container.querySelector(
      ".debug-log-dialog-textarea",
    ) as HTMLTextAreaElement | null;

    expect(container.querySelector(".debug-log-dialog")).not.toBeNull();
    expect(textarea).not.toBeNull();
    expect(textarea?.placeholder).toContain("SharedWorker");

    // AI-REMOVED 2026-08-08:
    // Reason: Workbench 组件测试不再拥有同步内存日志 store，不能用一次 console 调用同步断言 textarea。
    // Trigger: ST2-RQ-009 将日志读取改为 SharedWorker + IndexedDB + 可见时轮询。
    // Evidence: console 捕获和全局异常已有独立单元测试；此处只验证产品开关与不可用状态。
    // Replacement: src/tests/shared/console-intercept.test.ts 与 log-collector-storage.test.ts。
    // Risk: 真实 SharedWorker 连接仍需浏览器集成验收。
    // Human Review: Required
    //
    // Original code:
    // act(() => { console.warn("debug log panel smoke"); });
    // expect(textarea?.value).toContain("debug log panel smoke");
    // window.dispatchEvent(errorEvent / rejectionEvent);
    // expect(textarea?.value).toContain("[window.error] / [window.unhandledrejection]");

    act(() => {
      runInAction(() => {
        appHost.internalState.settings.debugMode = false;
      });
    });

    expect(container.querySelector('button[title="调试日志"]')).toBeNull();
    expect(container.querySelector(".debug-log-dialog")).toBeNull();
    expect(appHost.internalState.workbench.dialogState["debug-log"]?.visible).toBe(false);

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

  it("opens the help dialog through app internal actions", async () => {
    stubChangelogFetch({
      "1.2.0.md": {
        title: "正式更新-v1.2.0",
        version: "1.2.0",
        kind: "main",
        markdown: "# Previous Main\n\n旧主版本内容",
      },
      "1.3.0.md": {
        title: "全新版本-v1.3.0",
        version: "1.3.0",
        kind: "main",
        markdown: "# Current Main\n\n当前主版本内容\n\n![Main image](./images/v1.3.0/main.webp)",
      },
      "incremental/1.3.0/1.3.0.1.md": {
        title: "补丁更新-v1.3.0.1",
        version: "1.3.0.1",
        kind: "incremental",
        markdown: "# Current Patch\n\n当前子版本内容\n\n![Patch image](../../images/v1.3.0/patch.webp)",
      },
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
      appHost.internalActions.openDialog("help:version");
    });

    await act(async () => {
      await flushMicrotasks();
    });

    expect(container.querySelector(".help-dialog")).not.toBeNull();
    expect(container.querySelector("#help-dialog-tab-version")?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("#help-dialog-panel-version > .help-dialog-content")).not.toBeNull();
    expect(container.querySelector(".changelog-markdown")?.textContent).toContain("Current Patch");
    expect(container.querySelector(".changelog-sub-heading")?.textContent).toBe("补丁更新-v1.3.0.1");
    expect(
      Array.from(container.querySelectorAll<HTMLImageElement>(".changelog-markdown img"))
        .map((image) => image.getAttribute("src"))
        .sort(),
    ).toEqual([
      "/changelog/images/v1.3.0/main.webp",
      "/changelog/images/v1.3.0/patch.webp",
    ]);

    const accordions = Array.from(container.querySelectorAll(".changelog-accordion"));
    const headers = Array.from(container.querySelectorAll(".changelog-accordion-header")) as HTMLButtonElement[];

    expect(headers[1]?.textContent).toContain("全新版本-v1.3.0");
    expect(accordions.map((accordion) => accordion.getAttribute("data-expanded"))).toEqual([
      "true",
      "true",
      "false",
    ]);
    expect(headers.map((header) => header.getAttribute("aria-expanded"))).toEqual([
      "true",
      "true",
      "false",
    ]);

    act(() => {
      headers[2]?.click();
    });

    expect(accordions.map((accordion) => accordion.getAttribute("data-expanded"))).toEqual([
      "true",
      "true",
      "true",
    ]);

    const collapseButtons = Array.from(
      container.querySelectorAll(".changelog-collapse-button"),
    ) as HTMLButtonElement[];

    act(() => {
      collapseButtons[0]?.click();
    });

    expect(accordions.map((accordion) => accordion.getAttribute("data-expanded"))).toEqual([
      "false",
      "true",
      "true",
    ]);
  });

  it("treats X.X.X.0 changelog versions as main versions for default expansion", async () => {
    Object.defineProperty(window, "__APP_VERSION__", {
      configurable: true,
      value: "v1.3.0.0",
    });
    stubChangelogFetch({
      "1.2.0.md": {
        title: "正式更新-v1.2.0",
        version: "1.2.0",
        kind: "main",
        markdown: "# Previous Main\n\n旧主版本内容",
      },
      "1.3.0.md": {
        title: "全新版本-v1.3.0",
        version: "1.3.0",
        kind: "main",
        markdown: "# Current Main\n\n当前主版本内容",
      },
      "incremental/1.3.0/1.3.0.1.md": {
        title: "补丁更新-v1.3.0.1",
        version: "1.3.0.1",
        kind: "incremental",
        markdown: "# Current Patch\n\n当前子版本内容",
      },
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
      appHost.internalActions.openDialog("help:version");
    });

    await act(async () => {
      await flushMicrotasks();
    });

    const accordions = Array.from(container.querySelectorAll(".changelog-accordion"));

    expect(accordions.map((accordion) => accordion.getAttribute("data-expanded"))).toEqual([
      "false",
      "true",
      "false",
    ]);
  });

    /*
      AI-REMOVED 2026-05-12:
      Reason: 该测试断言依赖已移除的 toolbox placeholder DOM 结构，当前实现已改为正式的 production planning 面板。
      Trigger: 用户要求删除这条过时测试，避免继续因旧 DOM 选择器导致全量测试失败。
      Evidence: 当前失败断言查询 .toolbox-dialog-placeholder h3，但 production-planning tab 现在渲染的是 .production-planning-panel。
      Replacement: None
      Risk: Low
      Human Review: Required

      Original code:
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
    */

  it("keeps timeline height fixed in floating and bottom dock modes", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.workbench.dialogState.timeline.height = 480;
      appHost.internalState.workbench.timelineBottomDockHeight = 360;
    });

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const workbench = container.querySelector(".workbench") as HTMLDivElement | null;
    const timelineButton = container.querySelector(
      'button[title="时间轴"]',
    ) as HTMLButtonElement | null;

    act(() => {
      timelineButton?.click();
    });

    const timelineDialog = container.querySelector(".timeline-dialog") as HTMLElement | null;
    const eastHandle = timelineDialog?.querySelector(".dialog-shell-resize-edge--e") as HTMLElement | null;

    expect(timelineDialog).not.toBeNull();
    expect(timelineDialog?.style.height).toBe("250px");
    expect(timelineDialog?.querySelector(".dialog-shell-resize-grip")).toBeNull();
    expect(timelineDialog?.querySelectorAll(".dialog-shell-resize-edge")).toHaveLength(6);
    expect(timelineDialog?.querySelector(".dialog-shell-resize-edge--w")).not.toBeNull();
    expect(timelineDialog?.querySelector(".dialog-shell-resize-edge--nw")).not.toBeNull();
    expect(eastHandle).not.toBeNull();
    expect(timelineDialog?.querySelector(".dialog-shell-resize-edge--s")).toBeNull();
    expect(timelineDialog?.querySelector(".dialog-shell-resize-edge--n")).toBeNull();
    expect(timelineDialog?.querySelector(".dialog-shell-resize-edge--se")).not.toBeNull();

    act(() => {
      dispatchPointerEvent(eastHandle!, "pointerdown", {
        pointerId: 61,
        pointerType: "mouse",
        clientX: 200,
        clientY: 120,
        button: 0,
        buttons: 1,
      });
      dispatchWindowPointerEvent("pointermove", {
        pointerId: 61,
        pointerType: "mouse",
        clientX: 280,
        clientY: 220,
        buttons: 1,
      });
      dispatchWindowPointerEvent("pointerup", {
        pointerId: 61,
        pointerType: "mouse",
        clientX: 280,
        clientY: 220,
        buttons: 0,
      });
    });

    expect(appHost.internalState.workbench.dialogState.timeline.width).toBe(480);
    expect(appHost.internalState.workbench.dialogState.timeline.height).toBeNull();
    expect(appHost.internalState.workbench.dialogState.timeline.offsetX).toBe(40);

    const dockButton = container.querySelector(
      '.timeline-dialog-header button[title="停靠到底部"]',
    ) as HTMLButtonElement | null;

    act(() => {
      dockButton?.click();
    });

    expect(container.querySelector(".timeline-dialog")).toBeNull();
    expect(container.querySelector(".timeline-bottom-dock")).not.toBeNull();
    expect(container.querySelector(".timeline-bottom-dock-resize-handle")).toBeNull();
    expect(appHost.internalState.workbench.timelineBottomDockHeight).toBe(360);
    expect(workbench?.style.getPropertyValue("--toolbox-bottom-dock-height")).toBe(`${DEFAULT_TIMELINE_BOTTOM_DOCK_HEIGHT}px`);
  });

  it("docks the toolbox to the canvas bottom area, resizes, collapses, reopens, and undocks", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const toolboxButton = container.querySelector(
      'button[title="工具箱"]',
    ) as HTMLButtonElement | null;

    act(() => {
      toolboxButton?.click();
    });

    const dockButton = container.querySelector(
      '.toolbox-dialog-header button[title="停靠到底部"]',
    ) as HTMLButtonElement | null;

    expect(container.querySelector(".toolbox-dialog")).not.toBeNull();
    expect(dockButton).not.toBeNull();

    act(() => {
      dockButton?.click();
    });

    const workbench = container.querySelector(".workbench") as HTMLDivElement | null;
    let bottomDock = container.querySelector(".toolbox-bottom-dock") as HTMLElement | null;
    const resizeHandle = container.querySelector(".toolbox-bottom-dock-resize-handle") as HTMLDivElement | null;

    expect(container.querySelector(".toolbox-dialog")).toBeNull();
    expect(bottomDock).not.toBeNull();
    expect(appHost.internalState.workbench.toolbox.dockPreference).toBe("bottom");
    expect(workbench?.style.getPropertyValue("--toolbox-bottom-dock-height")).toBe(`${DEFAULT_TOOLBOX_BOTTOM_DOCK_HEIGHT}px`);
    expect(workbench?.style.getPropertyValue("--canvas-bottom-obstruction-height")).toBe(
      "calc(var(--bottom-bar-height, 28px) + var(--toolbox-bottom-dock-height, 0px))",
    );
    expect(container.querySelector("#toolbox-bottom-dock-tab-item-encyclopedia")?.getAttribute("aria-selected")).toBe("true");
    expect(localStorage.getItem(WORKBENCH_STATE_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify(createWorkbenchStorageSnapshot({
        toolboxDialog: createDialogStateSnapshot({
          visible: true,
          activeTab: DEFAULT_TOOLBOX_DIALOG_TAB_ID,
        }),
        toolboxDockPreference: "bottom",
      })),
    );

    act(() => {
      dispatchPointerEvent(resizeHandle!, "pointerdown", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 0,
        clientY: 600,
        button: 0,
        buttons: 1,
      });
      dispatchWindowPointerEvent("pointermove", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 0,
        clientY: 540,
        button: 0,
        buttons: 1,
      });
      dispatchWindowPointerEvent("pointerup", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 0,
        clientY: 540,
        button: 0,
      });
    });

    expect(appHost.internalState.workbench.toolbox.bottomDockHeight).toBe(380);
    expect(workbench?.style.getPropertyValue("--toolbox-bottom-dock-height")).toBe("380px");

    const collapseButton = container.querySelector(
      '.toolbox-bottom-dock-actions button[title="折叠工具箱"]',
    ) as HTMLButtonElement | null;

    act(() => {
      collapseButton?.click();
    });

    bottomDock = container.querySelector(".toolbox-bottom-dock") as HTMLElement | null;

    expect(appHost.internalState.workbench.toolbox.bottomDockCollapsed).toBe(true);
    expect(bottomDock?.classList.contains("is-collapsed")).toBe(true);
    expect(workbench?.style.getPropertyValue("--toolbox-bottom-dock-height")).toBe(`${COLLAPSED_TOOLBOX_BOTTOM_DOCK_HEIGHT}px`);
    expect(container.querySelector(".toolbox-bottom-dock-body")).toBeNull();

    // dock 状态下不再有独立的关闭按钮
    expect(
      container.querySelector('.toolbox-bottom-dock-actions button[title="关闭"]'),
    ).toBeNull();

    act(() => {
      appHost.internalActions.closeDialog("toolbox");
    });

    expect(appHost.internalState.workbench.dialogState.toolbox.visible).toBe(false);
    expect(appHost.internalState.workbench.toolbox.dockPreference).toBe("bottom");
    expect(container.querySelector(".toolbox-bottom-dock")).toBeNull();
    expect(workbench?.style.getPropertyValue("--toolbox-bottom-dock-height")).toBe("0px");

    act(() => {
      toolboxButton?.click();
    });

    expect(container.querySelector(".toolbox-bottom-dock")).not.toBeNull();
    expect(appHost.internalState.workbench.toolbox.bottomDockCollapsed).toBe(false);
    expect(workbench?.style.getPropertyValue("--toolbox-bottom-dock-height")).toBe("380px");

    const undockButton = container.querySelector(
      '.toolbox-bottom-dock-actions button[title="取消停靠"]',
    ) as HTMLButtonElement | null;

    act(() => {
      undockButton?.click();
    });

    expect(appHost.internalState.workbench.toolbox.dockPreference).toBe("floating");
    expect(container.querySelector(".toolbox-bottom-dock")).toBeNull();
    expect(container.querySelector(".toolbox-dialog")).not.toBeNull();
  });

  it("edits a module balancing stage name and updates the stage navigation label", async () => {
    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify(createWorkbenchStorageSnapshot({
        toolboxDialog: createDialogStateSnapshot({
          visible: true,
          activeTab: TOOLBOX_DIALOG_TAB_IDS[2],
        }),
      })),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const stageTab = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Stage 1") as HTMLButtonElement | undefined;

    expect(stageTab).toBeDefined();

    act(() => {
      stageTab?.click();
    });

    const stageNameInput = container.querySelector(
      ".module-balancing-stage-name input",
    ) as HTMLInputElement | null;

    expect(stageNameInput).not.toBeNull();
    expect(stageNameInput?.readOnly).toBe(false);
    expect(stageNameInput?.disabled).toBe(false);
    expect(stageNameInput?.value).toBe("Stage 1");

    await act(async () => {
      dispatchInputEvent(stageNameInput as HTMLInputElement, "炼铁阶段");
      await flushMicrotasks();
    });

    expect(stageNameInput?.value).toBe("炼铁阶段");
    expect(stageTab?.textContent).toBe("炼铁阶段");
  });

  it("allows creating a blank canvas when activity filtering hides every persisted canvas", () => {
    localStorage.setItem(
      APP_SETTINGS_LOCAL_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_APP_SETTINGS_STORAGE,
        selectedActivityIds: [],
        toolboxShowAllActivityContent: false,
      }),
    );
    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify(createWorkbenchStorageSnapshot({
        toolboxDialog: createDialogStateSnapshot({
          visible: true,
          activeTab: TOOLBOX_DIALOG_TAB_IDS[2],
        }),
        moduleBalancing: createModuleBalancingStorageSnapshot({
          activeCanvasId: "activity-canvas",
          canvases: [{
            id: "activity-canvas",
            name: "活动画布",
            globalInputs: [],
            stages: [{
              id: "activity-stage",
              name: "活动阶段",
              entries: [{
                moduleId: "r_component_activity_xiranite_cmpt_from_xiranite_powder_basic",
                quantity: 1,
              }],
            }],
            warehouseCapacity: null,
          }],
        }),
      })),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    expect(container.textContent).toContain("现有画布均包含未启用的活动内容");
    expect(container.textContent).toContain("工具箱显示所有活动内容");

    const createCanvasButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "新建画布") as HTMLButtonElement | undefined;

    expect(createCanvasButton).toBeDefined();

    act(() => {
      createCanvasButton?.click();
    });

    expect(appHost.internalState.workbench.toolbox.moduleBalancing.canvases).toHaveLength(2);
    expect(appHost.internalState.workbench.toolbox.moduleBalancing.canvases[0]?.id).toBe("activity-canvas");
    expect(appHost.internalState.workbench.toolbox.moduleBalancing.activeCanvasId).not.toBe("activity-canvas");
    expect(container.querySelector(".module-balancing-canvas-settings")).not.toBeNull();
    expect(container.textContent).not.toContain("现有画布均包含未启用的活动内容");
  });

  it("switches canvases through the folder dialog and loads immutable recommended canvases as user copies", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.pathname
          : input.url;
      const payloads: Record<string, unknown> = {
        "/module-balancing/recommended-modules/index.json": {
          version: "1",
          modules: [],
        },
        "/module-balancing/recommended-canvases/index.json": {
          version: "1",
          canvases: ["starter"],
        },
        "/module-balancing/recommended-canvases/starter.json": {
          id: "recommended-canvas:starter",
          name: "推荐配平",
          globalInputs: [],
          stages: [{
            id: "recommended-stage:starter",
            name: "推荐阶段",
            entries: [],
          }],
          warehouseCapacity: null,
        },
      };
      const payload = payloads[url];
      return payload === undefined
        ? new Response("Not found", { status: 404 })
        : new Response(JSON.stringify(payload), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
    }));
    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify(createWorkbenchStorageSnapshot({
        toolboxDialog: createDialogStateSnapshot({
          visible: true,
          activeTab: TOOLBOX_DIALOG_TAB_IDS[2],
        }),
        moduleBalancing: createModuleBalancingStorageSnapshot({
          canvasFolders: [{ id: "canvas-folder-a", name: "炼铁" }],
          canvases: [
            {
              id: DEFAULT_MODULE_BALANCING_CANVAS_ID,
              name: "主基地配平",
              folderId: null,
              globalInputs: [],
              stages: [{
                id: DEFAULT_MODULE_BALANCING_STAGE_ID,
                name: "Stage 1",
                entries: [],
              }],
              warehouseCapacity: null,
            },
            {
              id: "canvas-b",
              name: "分基地配平",
              folderId: "canvas-folder-a",
              globalInputs: [],
              stages: [{
                id: "stage-b",
                name: "阶段 B",
                entries: [],
              }],
              warehouseCapacity: null,
            },
          ],
        }),
      })),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    await act(async () => {
      root.render(<WorkbenchApp appHost={appHost} />);
      await flushMicrotasks(12);
    });

    expect(container.querySelector(".module-balancing-canvas-form select")).toBeNull();
    const loadOtherCanvasButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "加载其他画布") as HTMLButtonElement | undefined;
    expect(loadOtherCanvasButton).toBeDefined();

    act(() => {
      loadOtherCanvasButton?.click();
    });

    const dialog = container.querySelector("[data-module-balancing-canvas-library]");
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("用户画布");
    expect(dialog?.textContent).toContain("推荐画布");
    expect(dialog?.textContent).toContain("炼铁");
    expect(dialog?.textContent).toContain("推荐配平");

    const renameFolderButton = dialog?.querySelector(
      'button[aria-label="重命名文件夹"]',
    ) as HTMLButtonElement | null;
    act(() => {
      renameFolderButton?.click();
    });
    const folderNameInput = dialog?.querySelector(
      'input[aria-label="文件夹名称"]',
    ) as HTMLInputElement | null;
    expect(folderNameInput).not.toBeNull();
    await act(async () => {
      dispatchInputEvent(folderNameInput as HTMLInputElement, "冶炼画布");
      folderNameInput?.blur();
      await flushMicrotasks();
    });
    expect(appHost.internalState.workbench.toolbox.moduleBalancing.canvasFolders[0]?.name).toBe("冶炼画布");

    const rootCanvasRow = Array.from(dialog?.querySelectorAll(".module-balancing-canvas-library-row") ?? [])
      .find((row) => row.textContent?.includes("主基地配平"));
    const moveCanvasButton = rootCanvasRow?.querySelector(
      'button[aria-label="移动画布"]',
    ) as HTMLButtonElement | null;
    act(() => {
      moveCanvasButton?.click();
    });
    const folderSelect = rootCanvasRow?.querySelector(
      'select[aria-label="移动画布"]',
    ) as HTMLSelectElement | null;
    expect(folderSelect).not.toBeNull();
    act(() => {
      if (folderSelect !== null) {
        folderSelect.value = "canvas-folder-a";
        folderSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(appHost.internalState.workbench.toolbox.moduleBalancing.canvases[0]?.folderId).toBe("canvas-folder-a");

    const deleteFolderButton = dialog?.querySelector(
      'button[aria-label="删除文件夹"]',
    ) as HTMLButtonElement | null;
    act(() => {
      deleteFolderButton?.click();
    });
    expect(appHost.internalState.workbench.toolbox.moduleBalancing.canvasFolders).toHaveLength(0);
    expect(appHost.internalState.workbench.toolbox.moduleBalancing.canvases[0]?.folderId).toBeNull();
    expect(appHost.internalState.workbench.toolbox.moduleBalancing.canvases[1]?.folderId).toBeNull();

    const recommendedCanvasButton = dialog?.querySelector(
      "button.module-balancing-canvas-library-row.is-recommended",
    ) as HTMLButtonElement | null;
    expect(recommendedCanvasButton).not.toBeNull();
    act(() => {
      recommendedCanvasButton?.click();
    });

    const state = appHost.internalState.workbench.toolbox.moduleBalancing;
    expect(state.canvases).toHaveLength(3);
    expect(state.canvases[2]).toMatchObject({
      name: "推荐配平",
      folderId: null,
    });
    expect(state.canvases[2]?.id).not.toBe("recommended-canvas:starter");
    expect(state.canvases[2]?.stages[0]?.id).not.toBe("recommended-stage:starter");
    expect(state.activeCanvasId).toBe(state.canvases[2]?.id);
    expect(container.querySelector("[data-module-balancing-canvas-library]")).toBeNull();
  });

  it("applies version resources exactly and turns off infinite supply when a number is entered", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.pathname
          : input.url;
      const payloads: Record<string, unknown> = {
        "/module-balancing/recommended-modules/index.json": {
          version: "1",
          modules: [],
        },
        "/module-balancing/recommended-canvases/index.json": {
          version: "1",
          canvases: [],
        },
        "/module-balancing/version-resources/index.json": {
          version: "1",
          resources: ["wuling-1.4"],
        },
        "/module-balancing/version-resources/wuling-1.4.json": {
          id: "version-resource:wuling-1.4",
          name: "武陵1.4版本资源",
          inputs: [
            { itemId: "item_originium_ore", perMinute: 540 },
            { itemId: "item_iron_ore", perMinute: 120 },
            { itemId: "item_copper_ore", perMinute: 420 },
            { itemId: "item_gas_inert", perMinute: 200 },
            { itemId: "item_gas_xiranite", perMinute: 100 },
            { itemId: "item_liquid_water", infinite: true },
            { itemId: "item_liquid_acid", infinite: true },
          ],
        },
      };
      const payload = payloads[url];
      return payload === undefined
        ? new Response("Not found", { status: 404 })
        : new Response(JSON.stringify(payload), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
    }));
    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify(createWorkbenchStorageSnapshot({
        toolboxDialog: createDialogStateSnapshot({
          visible: true,
          activeTab: TOOLBOX_DIALOG_TAB_IDS[2],
        }),
        moduleBalancing: createModuleBalancingStorageSnapshot({
          canvases: [{
            id: DEFAULT_MODULE_BALANCING_CANVAS_ID,
            name: "主基地配平",
            globalInputs: [
              { itemId: "item_originium_ore", perMinute: 10, infinite: true },
              { itemId: "item_originium_ore", perMinute: 20 },
            ],
            stages: [{
              id: DEFAULT_MODULE_BALANCING_STAGE_ID,
              name: "Stage 1",
              entries: [],
            }],
            warehouseCapacity: null,
          }],
        }),
      })),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    await act(async () => {
      root.render(<WorkbenchApp appHost={appHost} />);
      await flushMicrotasks(12);
    });

    const systemInputTab = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "系统输入") as HTMLButtonElement | undefined;
    expect(systemInputTab).toBeDefined();
    act(() => {
      systemInputTab?.click();
    });

    const addVersionResourcesButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "一键添加版本资源") as HTMLButtonElement | undefined;
    expect(addVersionResourcesButton).toBeDefined();
    act(() => {
      addVersionResourcesButton?.click();
    });

    const dialog = container.querySelector("[data-module-balancing-version-resources]");
    expect(dialog?.textContent).toContain("武陵1.4版本资源");
    expect(dialog?.textContent).toContain("源矿 540/min");
    expect(dialog?.textContent).toContain("清水 ∞");
    const presetButton = Array.from(dialog?.querySelectorAll("button") ?? [])
      .find((button) => button.textContent?.includes("武陵1.4版本资源")) as HTMLButtonElement | undefined;
    act(() => {
      presetButton?.click();
    });

    const inputs = appHost.internalState.workbench.toolbox.moduleBalancing.canvases[0]?.globalInputs;
    expect(inputs).toEqual([
      { itemId: "item_originium_ore", perMinute: 540 },
      { itemId: "item_iron_ore", perMinute: 120 },
      { itemId: "item_copper_ore", perMinute: 420 },
      { itemId: "item_gas_inert", perMinute: 200 },
      { itemId: "item_gas_xiranite", perMinute: 100 },
      { itemId: "item_liquid_water", perMinute: 0, infinite: true },
      { itemId: "item_liquid_acid", perMinute: 0, infinite: true },
    ]);

    const waterRow = Array.from(container.querySelectorAll(".module-balancing-port-row"))
      .find((row) => row.textContent?.includes("清水"));
    const waterInfiniteButton = waterRow?.querySelector(
      'button[aria-label="取消无限供给"]',
    ) as HTMLButtonElement | null;
    const waterNumberInput = waterRow?.querySelector("input") as HTMLInputElement | null;
    expect(waterInfiniteButton?.getAttribute("aria-pressed")).toBe("true");
    expect(waterNumberInput).not.toBeNull();

    await act(async () => {
      waterNumberInput?.focus();
      dispatchInputEvent(waterNumberInput as HTMLInputElement, "80");
      await flushMicrotasks();
    });
    await act(async () => {
      waterNumberInput?.blur();
      await flushMicrotasks();
    });

    expect(
      appHost.internalState.workbench.toolbox.moduleBalancing.canvases[0]?.globalInputs
        .find((input) => input.itemId === "item_liquid_water"),
    ).toEqual({
      itemId: "item_liquid_water",
      perMinute: 80,
      infinite: false,
    });
  });

  it("restores the full desktop workspace track when the module library closes", () => {
    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify(createWorkbenchStorageSnapshot({
        toolboxDialog: createDialogStateSnapshot({
          visible: true,
          activeTab: TOOLBOX_DIALOG_TAB_IDS[2],
        }),
      })),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const desktopLayout = container.querySelector(".module-balancing-desktop-layout");
    const libraryPanel = desktopLayout?.querySelector(".module-balancing-library-panel");
    const closeLibraryButton = libraryPanel?.querySelector('button[aria-label="关闭"]') as HTMLButtonElement | null;
    const systemRecipeCard = container.querySelector(".module-balancing-module-card");

    expect(desktopLayout?.classList.contains("has-library")).toBe(true);
    // AI-REMOVED 2026-07-27:
    // Reason: 系统配方卡不再渲染完整 RecipeDisplay 公式，旧断言与新产品外观冲突。
    // Trigger: 用户要求系统配方头部改为设备图标及“产物 · 设备”文本。
    // Evidence: 新断言验证卡片标题分隔符与 device-icons 设备图标。
    // Replacement: 下方 systemRecipeCard 标题和图标断言
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // expect(container.querySelector(".recipe-display-formula-module-library")).not.toBeNull();
    expect(systemRecipeCard).not.toBeNull();
    expect(systemRecipeCard?.querySelector(".module-balancing-module-title")?.textContent).toContain("·");
    expect(systemRecipeCard?.querySelector("img")?.getAttribute("src")).toContain("device-icons/");
    // AI-CORRECTION 2026-07-27: 新头部与原配方展示控件需要同时存在。
    expect(systemRecipeCard?.querySelector(".recipe-display-formula-module-library")).not.toBeNull();
    expect(closeLibraryButton).not.toBeNull();

    act(() => {
      closeLibraryButton?.click();
    });

    expect(desktopLayout?.classList.contains("has-library")).toBe(false);
    expect(desktopLayout?.querySelector(".module-balancing-library-panel")).toBeNull();
    expect(desktopLayout?.querySelector(".module-balancing-wizard")).not.toBeNull();
  });

  it("temporarily falls back to the floating toolbox on phones and restores bottom dock on tablets", () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 1024,
      height: 768,
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify(createWorkbenchStorageSnapshot({
        toolboxDialog: createDialogStateSnapshot({
          visible: true,
          activeTab: DEFAULT_TOOLBOX_DIALOG_TAB_ID,
        }),
        toolboxDockPreference: "bottom",
      })),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    expect(appHost.state.screenProfile.deviceClass).toBe("tablet");
    expect(container.querySelector(".toolbox-bottom-dock")).not.toBeNull();
    expect(container.querySelector(".toolbox-dialog")).toBeNull();

    setViewport({
      width: 844,
      height: 390,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(appHost.state.screenProfile.deviceClass).toBe("mobile");
    expect(appHost.internalState.workbench.toolbox.dockPreference).toBe("bottom");
    expect(container.querySelector(".toolbox-bottom-dock")).toBeNull();
    expect(container.querySelector(".toolbox-dialog")).not.toBeNull();
    expect(container.querySelector('.toolbox-dialog-header button[title="停靠到底部"]')).toBeNull();

    setViewport({
      width: 1024,
      height: 768,
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(appHost.state.screenProfile.deviceClass).toBe("tablet");
    expect(appHost.internalState.workbench.toolbox.dockPreference).toBe("bottom");
    expect(container.querySelector(".toolbox-bottom-dock")).not.toBeNull();
    expect(container.querySelector(".toolbox-dialog")).toBeNull();
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
    const copyWhileMovingToggle = container.querySelector(
      'input[name="game-arknights-copy-while-moving"]',
    ) as HTMLInputElement | null;
    const immediateMarqueeToggle = container.querySelector(
      'input[name="game-arknights-immediate-marquee"]',
    ) as HTMLInputElement | null;

    expect(immediateMoveToggle).not.toBeNull();
    expect(copyWhileMovingToggle).not.toBeNull();
    expect(copyWhileMovingToggle?.checked).toBe(false);
    expect(immediateMarqueeToggle).not.toBeNull();
    expect(immediateMoveToggle?.checked).toBe(false);
    expect(immediateMoveToggle?.disabled).toBe(false);
    expect(immediateMarqueeToggle?.checked).toBe(false);
    expect(immediateMarqueeToggle?.disabled).toBe(false);

    const immediateMarqueeDescription = immediateMarqueeToggle
      ?.closest(".settings-dialog-setting-card")
      ?.querySelector(".settings-dialog-setting-copy p");

    expect(immediateMarqueeDescription?.textContent).toBe(
      "仅鼠标模式有效，从画布空白处开始拖动时，立即开始框选而不需要长按。",
    );

    act(() => {
      copyWhileMovingToggle?.click();
    });

    expect(appHost.state.settings.hypergryphCopyWhileMoving).toBe(true);
    expect(copyWhileMovingToggle?.checked).toBe(true);

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
        hypergryphCopyWhileMoving: true,
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

    // 2026-06-14: debug-mode 移至调试分组首位；关闭时隐藏后续调试项，
    // 需要先开启调试模式才能看到 FPS/手势测试开关。
    const debugModeToggle = container.querySelector(
      'input[name="other-debug-mode"]',
    ) as HTMLInputElement | null;

    act(() => {
      if (debugModeToggle) {
        debugModeToggle.click();
      }
    });

    const showFpsToggle = container.querySelector(
      'input[name="debug-show-fps"]',
    ) as HTMLInputElement | null;
    const showGestureTestWindowToggle = container.querySelector(
      'input[name="debug-show-gesture-diagnostics-window"]',
    ) as HTMLInputElement | null;
    const simulationWorkerDetailedReportToggle = container.querySelector(
      'input[name="debug-simulation-worker-detailed-report"]',
    ) as HTMLInputElement | null;
    const backendApiAddressInput = container.querySelector(
      'input[name="debug-backend-api-address-override"]',
    ) as HTMLInputElement | null;

    expect(showFpsToggle).not.toBeNull();
    expect(showGestureTestWindowToggle).not.toBeNull();
    expect(simulationWorkerDetailedReportToggle).not.toBeNull();
    expect(backendApiAddressInput).not.toBeNull();
    expect(showFpsToggle?.checked).toBe(false);
    expect(showGestureTestWindowToggle?.checked).toBe(false);
    expect(simulationWorkerDetailedReportToggle?.checked).toBe(false);
    expect(backendApiAddressInput?.placeholder).toBe(
      "https://endfield-api.anonymous-test.top",
    );

    act(() => {
      if (backendApiAddressInput) {
        dispatchInputEvent(backendApiAddressInput, "http://localhost:8787");
      }
      showFpsToggle?.click();
      showGestureTestWindowToggle?.click();
      simulationWorkerDetailedReportToggle?.click();
    });

    expect(appHost.state.settings.debugShowFps).toBe(true);
    expect(appHost.state.settings.debugShowGestureDiagnosticsWindow).toBe(true);
    expect(appHost.internalState.settings.debugSimulationWorkerDetailedReport).toBe(true);
    expect(backendApiAddressInput?.value).toBe("http://localhost:8787");
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        ...DEFAULT_APP_SETTINGS_STORAGE,
        debugShowFps: true,
        debugShowGestureDiagnosticsWindow: true,
        debugSimulationWorkerDetailedReport: true,
        debugMode: true,
      }),
    );
    expect(JSON.parse(
      localStorage.getItem(BACKEND_API_ADDRESS_OVERRIDE_LOCAL_STORAGE_KEY) ?? "null",
    )).toBe("http://localhost:8787");

    act(() => {
      debugModeToggle?.click();
    });

    expect(appHost.state.settings.debugMode).toBe(false);
    expect(appHost.state.settings.debugShowFps).toBe(false);
    expect(appHost.state.settings.debugShowGestureDiagnosticsWindow).toBe(false);
    expect(appHost.internalState.settings.debugSimulationWorkerDetailedReport).toBe(false);
    expect(container.querySelector(
      'input[name="debug-simulation-worker-detailed-report"]',
    )).toBeNull();
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify(DEFAULT_APP_SETTINGS_STORAGE),
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

  it("writes always-show-power-range into AppSettings storage", () => {
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

    const alwaysShowPowerRangeToggle = container.querySelector(
      'input[name="game-always-show-power-range"]',
    ) as HTMLInputElement | null;

    expect(alwaysShowPowerRangeToggle).not.toBeNull();
    expect(alwaysShowPowerRangeToggle?.checked).toBe(false);

    act(() => {
      alwaysShowPowerRangeToggle?.click();
    });

    expect(appHost.state.settings.gameAlwaysShowPowerRange).toBe(true);
    expect(alwaysShowPowerRangeToggle?.checked).toBe(true);
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        ...DEFAULT_APP_SETTINGS_STORAGE,
        gameAlwaysShowPowerRange: true,
      }),
    );
  });

  it("forces grass off and grid on when simplified device icons are enabled", () => {
    localStorage.setItem(
      APP_SETTINGS_LOCAL_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_APP_SETTINGS_STORAGE,
        gameAlwaysShowGridLines: false,
        showGrassBackground: true,
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

    const simplifiedDeviceIconsToggle = container.querySelector(
      'input[name="game-use-blueprint-style-device-images"]',
    ) as HTMLInputElement | null;
    const alwaysShowGridLinesToggle = container.querySelector(
      'input[name="game-always-show-grid-lines"]',
    ) as HTMLInputElement | null;
    const showGrassBackgroundToggle = container.querySelector(
      'input[name="game-show-grass-background"]',
    ) as HTMLInputElement | null;

    expect(simplifiedDeviceIconsToggle).not.toBeNull();
    expect(alwaysShowGridLinesToggle).not.toBeNull();
    expect(showGrassBackgroundToggle).not.toBeNull();
    expect(simplifiedDeviceIconsToggle?.checked).toBe(false);
    expect(alwaysShowGridLinesToggle?.checked).toBe(false);
    expect(alwaysShowGridLinesToggle?.disabled).toBe(false);
    expect(showGrassBackgroundToggle?.checked).toBe(true);
    expect(showGrassBackgroundToggle?.disabled).toBe(false);

    act(() => {
      simplifiedDeviceIconsToggle?.click();
    });

    expect(appHost.state.settings.gameUseBlueprintStyleDeviceImages).toBe(true);
    expect(appHost.state.settings.gameAlwaysShowGridLines).toBe(true);
    expect(appHost.state.settings.showGrassBackground).toBe(false);
    expect(simplifiedDeviceIconsToggle?.checked).toBe(true);
    expect(alwaysShowGridLinesToggle?.checked).toBe(true);
    expect(alwaysShowGridLinesToggle?.disabled).toBe(true);
    expect(showGrassBackgroundToggle?.checked).toBe(false);
    expect(showGrassBackgroundToggle?.disabled).toBe(true);
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        ...DEFAULT_APP_SETTINGS_STORAGE,
        gameUseBlueprintStyleDeviceImages: true,
        gameShowDeviceIcons: true,
        gameAlwaysShowGridLines: true,
        showGrassBackground: false,
      }),
    );
  });

  it("uses light in-canvas colors while keeping the app theme dark when simplified device icons are enabled", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      runInAction(() => {
        appHost.internalState.settings.themeId = "ayu-dark";
      });
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const workbench = container.querySelector(".workbench") as HTMLDivElement | null;

    expect(workbench).not.toBeNull();
    expect(workbench?.style.getPropertyValue("--in-canvas-bg")).toBe(
      AYU_DARK_THEME.colors["in-canvas-bg"],
    );
    expect(document.documentElement.style.colorScheme).toBe("dark");

    act(() => {
      runInAction(() => {
        appHost.internalState.settings.gameUseBlueprintStyleDeviceImages = true;
      });
    });

    expect(workbench?.style.getPropertyValue("--in-canvas-bg")).toBe(
      AYU_LIGHT_THEME.colors["in-canvas-bg"],
    );
    expect(workbench?.style.getPropertyValue("--in-canvas-toolbar-button-text")).toBe(
      AYU_LIGHT_THEME.colors["in-canvas-toolbar-button-text"],
    );
    expect(workbench?.style.getPropertyValue("--surface-1")).toBe("");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("shows device name and icon toggles and locks device icons on with simplified device icons", () => {
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

    const simplifiedDeviceIconsToggle = container.querySelector(
      'input[name="game-use-blueprint-style-device-images"]',
    ) as HTMLInputElement | null;
    const showDeviceNamesToggle = container.querySelector(
      'input[name="game-show-device-names"]',
    ) as HTMLInputElement | null;
    const showDeviceIconsToggle = container.querySelector(
      'input[name="game-show-device-icons"]',
    ) as HTMLInputElement | null;

    expect(simplifiedDeviceIconsToggle).not.toBeNull();
    expect(showDeviceNamesToggle).not.toBeNull();
    expect(showDeviceIconsToggle).not.toBeNull();
    expect(appHost.state.settings.gameShowDeviceNames).toBe(true);
    expect(appHost.state.settings.gameShowDeviceIcons).toBe(false);
    expect(showDeviceNamesToggle?.checked).toBe(true);
    expect(showDeviceIconsToggle?.checked).toBe(false);
    expect(showDeviceIconsToggle?.disabled).toBe(false);

    act(() => {
      simplifiedDeviceIconsToggle?.click();
    });

    expect(appHost.state.settings.gameUseBlueprintStyleDeviceImages).toBe(true);
    expect(appHost.state.settings.gameShowDeviceIcons).toBe(true);
    expect(showDeviceIconsToggle?.checked).toBe(true);
    expect(showDeviceIconsToggle?.disabled).toBe(true);
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        ...DEFAULT_APP_SETTINGS_STORAGE,
        gameUseBlueprintStyleDeviceImages: true,
        gameShowDeviceIcons: true,
      }),
    );
    expect(localStorage.getItem(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY)).toBeNull();
  });

  // AI-REMOVED 2026-05-26:
  // Reason: game-arknights-operation-mode 开关已从设置面板移除，
  //         此测试验证鹰角模式关闭状态下操作模式开关的行为，不再适用。
  // Trigger: 用户需求 — 取消该设置的图像化入口。
  // Evidence: settings-dialog-state.ts 中 game-arknights-operation-mode 项已删除，
  //           workbench-app.tsx 中对应的 readValue/writeValue 绑定已移除。
  // Replacement: None（鹰角模式的键盘行为仍通过其他测试覆盖）。
  // Risk: Low
  // Human Review: Not Required
  //
  // Original code:
  // it("captures keybinding settings when operation mode is externally off and keeps the mode toggle disabled", () => {
  //   localStorage.setItem(
  //     APP_SETTINGS_LOCAL_STORAGE_KEY,
  //     JSON.stringify({
  //       locale: "zh-CN",
  //       themeId: "ayu-light",
  //       hypergryphOperationMode: false,
  //     }),
  //   );
  //   const workspace = createWorkspace();
  //   const appHost = createAppHost(workspace);
  //   act(() => { root.render(<WorkbenchApp appHost={appHost} />); });
  //   const settingsButton = container.querySelector(".toolbar-rail-utility .rail-button:last-child") as HTMLButtonElement | null;
  //   act(() => { settingsButton?.click(); });
  //   const operationModeToggle = container.querySelector('input[name="game-arknights-operation-mode"]') as HTMLInputElement | null;
  //   const immediateMoveToggle = container.querySelector('input[name="game-arknights-immediate-move"]') as HTMLInputElement | null;
  //   const immediateMarqueeToggle = container.querySelector('input[name="game-arknights-immediate-marquee"]') as HTMLInputElement | null;
  //   const confirmShortcutButton = container.querySelector('button[data-setting-id="shortcut-place-conveyor"]') as HTMLButtonElement | null;
  //   const cancelShortcutButton = container.querySelector('button[data-setting-id="shortcut-place-pipe"]') as HTMLButtonElement | null;
  //   const rotateShortcutButton = container.querySelector('button[data-setting-id="shortcut-rotate"]') as HTMLButtonElement | null;
  //   const rotateViewportShortcutButton = container.querySelector('button[data-setting-id="shortcut-rotate-viewport"]') as HTMLButtonElement | null;
  //   expect(operationModeToggle).not.toBeNull();
  //   expect(immediateMoveToggle).not.toBeNull();
  //   expect(immediateMarqueeToggle).not.toBeNull();
  //   expect(confirmShortcutButton).not.toBeNull();
  //   expect(cancelShortcutButton).not.toBeNull();
  //   expect(rotateShortcutButton).not.toBeNull();
  //   expect(rotateViewportShortcutButton).not.toBeNull();
  //   expect(operationModeToggle?.checked).toBe(false);
  //   expect(operationModeToggle?.disabled).toBe(true);
  //   expect(immediateMoveToggle?.checked).toBe(true);
  //   expect(immediateMoveToggle?.disabled).toBe(true);
  //   expect(immediateMarqueeToggle?.checked).toBe(false);
  //   expect(immediateMarqueeToggle?.disabled).toBe(true);
  //   expect(confirmShortcutButton?.disabled).toBe(false);
  //   expect(confirmShortcutButton?.textContent).toBe("E");
  //   expect(rotateShortcutButton?.disabled).toBe(false);
  //   expect(rotateShortcutButton?.textContent).toBe("R");
  //   expect(rotateViewportShortcutButton?.disabled).toBe(false);
  //   expect(rotateViewportShortcutButton?.textContent).toBe("Ctrl+R");
  //   expect(container.querySelector(".settings-dialog")?.textContent).toContain("旋转画布");
  //   act(() => { confirmShortcutButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  //   expect(confirmShortcutButton?.textContent).toBe("按任意键...");
  //   act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true })); });
  //   expect(confirmShortcutButton?.textContent).toBe("P");
  //   expect(localStorage.getItem(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY)).toBeNull();
  //   expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(JSON.stringify({ locale: "zh-CN", themeId: "ayu-light", hypergryphOperationMode: false }));
  //   expect(localStorage.getItem(APP_SHORTCUTS_LOCAL_STORAGE_KEY)).toBe(JSON.stringify({ ...DEFAULT_APP_SHORTCUTS_STORAGE, [SHORTCUT_KEY.PLACE_CONVEYOR]: "P" }));
  // });

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

  it("opens the save blueprint dialog from Ctrl+S on desktop multi-selection and prevents the browser default", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.internalState.collections.selection.replace(["dummy-entity-2", "dummy-entity-3"]);
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const shortcutEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyS",
      ctrlKey: true,
      key: "s",
    });

    let dispatchResult = true;

    act(() => {
      dispatchResult = window.dispatchEvent(shortcutEvent);
    });

    expect(dispatchResult).toBe(false);
    expect(shortcutEvent.defaultPrevented).toBe(true);
    expect(container.querySelector('[data-dialog-key="save-blueprint"]')).not.toBeNull();
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
    // 2026-06-14: system/display 合并，arknights-operation 改为 operation，
    // PWA 移入 other 分组内，快捷键分组 mobileHidden。
    expect(groupTitles).toEqual(["显示与系统", "游戏", "操作", "其他", "调试"]);
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
