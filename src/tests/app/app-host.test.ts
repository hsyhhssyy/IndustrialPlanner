import { afterEach, describe, expect, it, vi } from "vitest";
import { runInAction } from "mobx";

import { createAppHost } from "@/app/host/app-host";
import {
  APP_SHORTCUTS_LOCAL_STORAGE_KEY,
  SHORTCUT_KEY,
} from "@/app/actions/keyboard-shortcut-manager";
import type {
  GestureEvent,
  GestureKeyboardEventLike,
  GesturePointerEventLike,
  GestureWheelEventLike,
} from "@/app/input/gesture/adapter";
import {
  APP_SETTINGS_LOCAL_STORAGE_KEY,
  WORKBENCH_STATE_LOCAL_STORAGE_KEY,
} from "@/app/state/storage-hook";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import {
  DEFAULT_HELP_DIALOG_TAB_ID,
  DEFAULT_MODULE_BALANCING_CANVAS_ID,
  DEFAULT_MODULE_BALANCING_STAGE_ID,
  DEFAULT_RIGHT_DOCK_TAB_ID,
  DEFAULT_TOOLBOX_BOTTOM_DOCK_HEIGHT,
  DEFAULT_TOOLBOX_DIALOG_TAB_ID,
  MOBILE_LEFT_DOCK_WIDTH,
} from "@/app/state/state-impl";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createDummyWorldDocument } from "@/editor/dummy-document";
import { createEditorHost } from "@/editor/editor-host";
import { createRegistryContract } from "@/registry";

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
  rightDockActiveTab?: "selection";
  toolboxDialog?: ReturnType<typeof createDialogStateSnapshot>;
  helpDialog?: ReturnType<typeof createDialogStateSnapshot>;
  settingsDialog?: ReturnType<typeof createDialogStateSnapshot>;
  inspectorDialog?: ReturnType<typeof createDialogStateSnapshot>;
  saveBlueprintDialog?: ReturnType<typeof createDialogStateSnapshot>;
  baseSelectDialog?: ReturnType<typeof createDialogStateSnapshot>;
  toolboxDockPreference?: "floating" | "bottom";
  toolboxBottomDockCollapsed?: boolean;
  toolboxBottomDockHeight?: number;
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
      inspector: options.inspectorDialog ?? createDialogStateSnapshot(),
      "save-blueprint": options.saveBlueprintDialog ?? createDialogStateSnapshot(),
      "base-select": options.baseSelectDialog ?? createDialogStateSnapshot(),
    },
    toolbox: {
      dockPreference: options.toolboxDockPreference ?? "floating",
      bottomDockCollapsed: options.toolboxBottomDockCollapsed ?? false,
      bottomDockHeight: options.toolboxBottomDockHeight ?? DEFAULT_TOOLBOX_BOTTOM_DOCK_HEIGHT,
      wiki: options.toolboxWiki ?? createToolboxWikiStorageSnapshot(),
      moduleBalancing: options.moduleBalancing ?? createModuleBalancingStorageSnapshot(),
    },
  };
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-app-theme");
  document.documentElement.removeAttribute("style");
  vi.useRealTimers();
});

describe("createAppHost", () => {
  it("defaults encyclopedia mobile filters to excluding bottled liquids", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.internalState.workbench.toolbox.wiki.mobileSelectedCategories).toEqual([
      "excludeBottledLiquid",
    ]);
  });

  it("shares persisted encyclopedia filters between wiki and the global picker", async () => {
    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify(createWorkbenchStorageSnapshot({
        toolboxWiki: createToolboxWikiStorageSnapshot({
          desktopCategory: "resourcePower",
          mobileSelectedCategories: ["excludeBottledLiquid", "item"],
        }),
      })),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.encyclopediaPicker.desktopCategory).toBe("resourcePower");
    expect(appHost.encyclopediaPicker.mobileSelectedCategories).toEqual([
      "excludeBottledLiquid",
      "item",
    ]);

    const pendingSelection = appHost.encyclopediaPicker.pickItem();

    expect(appHost.encyclopediaPicker.desktopCategory).toBe("resourcePower");
    expect(appHost.encyclopediaPicker.mobileSelectedCategories).toEqual([
      "excludeBottledLiquid",
      "item",
    ]);

    appHost.encyclopediaPicker.setDesktopCategory("all");
    appHost.encyclopediaPicker.setMobileSelectedCategories(["excludeBottledLiquid"]);

    expect(appHost.internalState.workbench.toolbox.wiki.desktopCategory).toBe("all");
    expect(appHost.internalState.workbench.toolbox.wiki.mobileSelectedCategories).toEqual([
      "excludeBottledLiquid",
    ]);
    expect(localStorage.getItem(WORKBENCH_STATE_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify(createWorkbenchStorageSnapshot({
        toolboxWiki: createToolboxWikiStorageSnapshot({
          desktopCategory: "all",
          mobileSelectedCategories: ["excludeBottledLiquid"],
        }),
      })),
    );

    appHost.encyclopediaPicker.cancel();
    await expect(pendingSelection).resolves.toBeNull();
  });

  it("initializes gesture adapter and gesture action router as app runtime services", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.gestureAdapter.getKeyboardSnapshot().pressedKeys.size).toBe(0);
    expect(appHost.gestureActionRouter.getRegisteredModuleIds()).toEqual(
      expect.arrayContaining([
        "gesture-diagnostics",
        "hypergryph-blueprint-placement-gesture",
        "hypergryph-logistics-placement-gesture",
        "hypergryph-single-placement-gesture",
        "hypergryph-move-gesture",
        "hypergryph-marquee-gesture",
        "hypergryph-select-gesture",
        "hypergryph-save-blueprint-gesture",
        "hypergryph-mouse-viewport-pan",
        "hypergryph-viewport-zoom",
        "simulation-control-button",
      ]),
    );
    expect(appHost.gestureDiagnostics.getSnapshot().latestEvent).toBeNull();

    appHost.dispose();

    expect(() =>
      appHost.gestureActionRouter.registerModule({
        id: "late-module",
        handle: () => ({ status: "ignored" }),
      }),
    ).toThrow("GestureActionRouter has been disposed.");
  });

  it("initializes app settings and workbench state and keeps readonly views in sync", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.state.settings.locale).toBe("zh-CN");
    expect(appHost.state.settings.themeId).toBe("ayu-light");
    expect(appHost.state.settings.hypergryphOperationMode).toBe(true);
    expect(appHost.state.settings.hypergryphImmediateMove).toBe(true);
    expect(appHost.state.settings.hypergryphImmediateMarquee).toBe(false);
    expect(appHost.state.settings.hypergryphSelectionRightDockSync).toBe(true);
    expect(appHost.state.settings.hypergryphInspectorOpenOnSecondClick).toBe(false);
    expect(appHost.state.settings.debugShowFps).toBe(false);
    expect(appHost.state.settings.debugShowGestureDiagnosticsWindow).toBe(false);
    expect(appHost.state.theme.name).toBe("Ayu Light");
    expect(appHost.state.workbench.rightDockActiveTab).toBe(DEFAULT_RIGHT_DOCK_TAB_ID);
    expect(appHost.internalState.settings.locale).toBe("zh-CN");
    expect(appHost.internalState.settings.themeId).toBe("ayu-light");
    expect(appHost.internalState.settings.hypergryphOperationMode).toBe(true);
    expect(appHost.internalState.settings.hypergryphImmediateMove).toBe(true);
    expect(appHost.internalState.settings.hypergryphImmediateMarquee).toBe(false);
    expect(appHost.internalState.settings.hypergryphSelectionRightDockSync).toBe(true);
    expect(appHost.internalState.settings.hypergryphInspectorOpenOnSecondClick).toBe(false);
    expect(appHost.internalState.settings.debugShowFps).toBe(false);
    expect(appHost.internalState.settings.debugShowGestureDiagnosticsWindow).toBe(false);
    expect(workspace.app?.state.settings.locale).toBe("zh-CN");
    expect(workspace.app?.state.settings.hypergryphOperationMode).toBe(true);
    expect(workspace.app?.state.settings.hypergryphImmediateMove).toBe(true);
    expect(workspace.app?.state.settings.hypergryphImmediateMarquee).toBe(false);
    expect(workspace.app?.state.settings.hypergryphSelectionRightDockSync).toBe(true);
    expect(workspace.app?.state.settings.hypergryphInspectorOpenOnSecondClick).toBe(false);
    expect(workspace.app?.state.settings.debugShowFps).toBe(false);
    expect(workspace.app?.state.settings.debugShowGestureDiagnosticsWindow).toBe(false);
    expect(workspace.app?.state.theme.id).toBe("ayu-light");
    expect(appHost.state.screenProfile.deviceClass).toBe("desktop");
    expect(workspace.app?.state.screenProfile.deviceClass).toBe("desktop");
    expect(appHost.state.workbench.leftDockOpen).toBe(true);
    expect(appHost.state.workbench.rightDockOpen).toBe(true);
    expect(appHost.state.workbench.leftDockWidth).toBe(375);
    expect(appHost.internalState.workbench.dialogState.toolbox.visible).toBe(false);
    expect(appHost.internalState.workbench.dialogState.toolbox.maximized).toBe(false);
    expect(appHost.internalState.workbench.dialogState.toolbox.activeTab).toBe(DEFAULT_TOOLBOX_DIALOG_TAB_ID);
    expect(appHost.internalState.workbench.toolbox.wiki.searchQuery).toBe("");
    expect(appHost.internalState.workbench.toolbox.wiki.navigationStack).toEqual([]);
    expect(appHost.internalState.workbench.toolbox.wiki.openedPage).toEqual({ kind: "browser" });
    expect(appHost.internalState.workbench.dialogState.help.visible).toBe(false);
    expect(appHost.internalState.workbench.dialogState.help.maximized).toBe(false);
    expect(appHost.internalState.workbench.dialogState.help.activeTab).toBe(DEFAULT_HELP_DIALOG_TAB_ID);
    expect(appHost.internalState.workbench.dialogState.settings.visible).toBe(false);
    expect(appHost.internalState.activeTool).toBe("select");
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();

    runInAction(() => {
      appHost.internalState.settings.locale = "en-US";
      appHost.internalState.settings.themeId = "ayu-light";
      appHost.internalState.workbench.leftDockOpen = false;
      appHost.internalState.workbench.rightDockOpen = false;
      appHost.internalState.workbench.leftDockWidth = 480;
    });
    appHost.internalActions.setScreenProfile({
      viewportWidth: 390,
      viewportHeight: 844,
      devicePixelRatio: 3,
      deviceClass: "mobile",
      screenShape: "portrait",
      aspectRatio: 844 / 390,
      hasTouch: true,
    });

    expect(appHost.state.settings.locale).toBe("en-US");
    expect(appHost.state.settings.themeId).toBe("ayu-light");
    expect(appHost.state.settings.hypergryphOperationMode).toBe(true);
    expect(appHost.state.settings.hypergryphImmediateMove).toBe(true);
    expect(appHost.state.settings.hypergryphImmediateMarquee).toBe(false);
    expect(appHost.state.settings.hypergryphSelectionRightDockSync).toBe(true);
    expect(appHost.state.settings.hypergryphInspectorOpenOnSecondClick).toBe(false);
    expect(appHost.state.settings.debugShowFps).toBe(false);
    expect(appHost.state.settings.debugShowGestureDiagnosticsWindow).toBe(false);
    expect(appHost.state.theme.name).toBe("Ayu Light");
    expect(appHost.internalState.settings.locale).toBe("en-US");
    expect(appHost.internalState.settings.themeId).toBe("ayu-light");
    expect(appHost.internalState.settings.hypergryphOperationMode).toBe(true);
    expect(appHost.internalState.settings.hypergryphImmediateMove).toBe(true);
    expect(appHost.internalState.settings.hypergryphImmediateMarquee).toBe(false);
    expect(appHost.internalState.settings.hypergryphSelectionRightDockSync).toBe(true);
    expect(appHost.internalState.settings.hypergryphInspectorOpenOnSecondClick).toBe(false);
    expect(appHost.internalState.settings.debugShowFps).toBe(false);
    expect(appHost.internalState.settings.debugShowGestureDiagnosticsWindow).toBe(false);
    expect(workspace.app?.state.settings.locale).toBe("en-US");
    expect(workspace.app?.state.settings.hypergryphOperationMode).toBe(true);
    expect(workspace.app?.state.settings.hypergryphImmediateMove).toBe(true);
    expect(workspace.app?.state.settings.hypergryphImmediateMarquee).toBe(false);
    expect(workspace.app?.state.settings.hypergryphSelectionRightDockSync).toBe(true);
    expect(workspace.app?.state.settings.hypergryphInspectorOpenOnSecondClick).toBe(false);
    expect(workspace.app?.state.settings.debugShowFps).toBe(false);
    expect(workspace.app?.state.settings.debugShowGestureDiagnosticsWindow).toBe(false);
    expect(workspace.app?.state.theme.id).toBe("ayu-light");
    expect(appHost.state.workbench.leftDockOpen).toBe(false);
    expect(appHost.internalState.workbench.rightDockOpen).toBe(false);
    expect(workspace.app?.state.workbench.leftDockOpen).toBe(false);
    expect(workspace.app?.state.workbench.leftDockWidth).toBe(480);
    expect(appHost.state.screenProfile.deviceClass).toBe("mobile");
    expect(workspace.app?.state.screenProfile.screenShape).toBe("portrait");
    expect(appHost.internalState.activeTool).toBe("select");
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();
  });

  it("translates arbitrary i18n keys through the current locale", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.actions.translate("app.title")).toBe("集成工业仿真器");
    expect(appHost.actions.translate("workbench.leftRail.placement")).toBe("放置模式");
    expect(appHost.actions.translate("workbench.leftRail.base")).toBe("基地");
    expect(appHost.actions.translate("unknown.key")).toBe("unknown.key");

    appHost.internalActions.setLocale("en-US");

    expect(appHost.actions.translate("app.title")).toBe("Industrial Planner Stage1");
    expect(appHost.actions.translate("workbench.leftRail.placement")).toBe("Placement");
    expect(appHost.actions.translate("workbench.leftRail.base")).toBe("Base");
    expect(appHost.actions.translate("workbench.base.wuling")).toBe("Wuling");
  });

  it("opens dialogs and persists dialog state through generic internal actions", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.internalState.workbench.dialogState.toolbox.visible).toBe(false);
    expect(appHost.internalState.workbench.dialogState.toolbox.activeTab).toBe(DEFAULT_TOOLBOX_DIALOG_TAB_ID);
    expect(appHost.internalState.workbench.dialogState.help.visible).toBe(false);
    expect(appHost.internalState.workbench.dialogState.help.maximized).toBe(false);
    expect(appHost.internalState.workbench.dialogState.help.activeTab).toBe(DEFAULT_HELP_DIALOG_TAB_ID);

    appHost.internalActions.openDialog("toolbox:production-planning");

    expect(appHost.internalState.workbench.dialogState.toolbox.visible).toBe(true);
    expect(appHost.internalState.workbench.dialogState.toolbox.activeTab).toBe("production-planning");

    appHost.internalActions.closeDialog("toolbox");

    appHost.internalActions.openDialog("help:faq");

    expect(appHost.internalState.workbench.dialogState.help.visible).toBe(true);
    expect(appHost.internalState.workbench.dialogState.help.activeTab).toBe("faq");

    appHost.internalActions.toggleDialogMaximized("help");
    appHost.internalActions.setDialogOffset("help", 18.4, -7.6);
    appHost.internalActions.setDialogSize("help", 768.2, 512.4);

    expect(appHost.internalState.workbench.dialogState.help.maximized).toBe(true);
    expect(appHost.internalState.workbench.dialogState.help.offsetX).toBe(18);
    expect(appHost.internalState.workbench.dialogState.help.offsetY).toBe(-8);
    expect(appHost.internalState.workbench.dialogState.help.width).toBe(768);
    expect(appHost.internalState.workbench.dialogState.help.height).toBe(512);
    expect(localStorage.getItem(WORKBENCH_STATE_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify(createWorkbenchStorageSnapshot({
        toolboxDialog: createDialogStateSnapshot({
          activeTab: "production-planning",
        }),
        helpDialog: createDialogStateSnapshot({
          visible: true,
          maximized: true,
          offsetX: 18,
          offsetY: -8,
          width: 768,
          height: 512,
          activeTab: "faq",
        }),
      })),
    );

    appHost.internalActions.openDialog("settings");

    expect(appHost.internalState.workbench.dialogState.settings.visible).toBe(true);

    appHost.internalActions.closeDialog("help");

    expect(appHost.internalState.workbench.dialogState.help.visible).toBe(false);
    expect(appHost.internalState.workbench.dialogState.help.maximized).toBe(true);
    expect(appHost.internalState.workbench.dialogState.help.activeTab).toBe("faq");
  });

  it.each([
    [
      "too wide",
      createDialogStateSnapshot({
        maximized: true,
        offsetX: 48,
        offsetY: 32,
        width: 1600,
        height: 520,
      }),
    ],
    [
      "too tall",
      createDialogStateSnapshot({
        maximized: true,
        offsetX: 48,
        offsetY: 32,
        width: 720,
        height: 1200,
      }),
    ],
    [
      "off-screen top-left",
      createDialogStateSnapshot({
        maximized: true,
        offsetX: -48,
        offsetY: -32,
        width: 720,
        height: 520,
      }),
    ],
  ])("resets invalid settings dialog shell state to defaults when reopening (%s)", (_, settingsDialog) => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1280,
    });

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 800,
    });

    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify(
        createWorkbenchStorageSnapshot({
          settingsDialog,
        }),
      ),
    );

    const appHost = createAppHost(createWorkspace());

    appHost.internalActions.openDialog("settings");

    expect(appHost.internalState.workbench.dialogState.settings).toEqual(
      createDialogStateSnapshot({
        visible: true,
      }),
    );
    expect(localStorage.getItem(WORKBENCH_STATE_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify(
        createWorkbenchStorageSnapshot({
          settingsDialog: createDialogStateSnapshot({
            visible: true,
          }),
        }),
      ),
    );
  });

  it("hydrates and persists the current split localStorage keys", () => {
    localStorage.setItem(
      APP_SETTINGS_LOCAL_STORAGE_KEY,
      JSON.stringify({
        locale: "en-US",
        themeId: "ayu-light",
      }),
    );
    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify(
        createWorkbenchStorageSnapshot({
          leftDockOpen: false,
          rightDockOpen: false,
          leftDockWidth: 512,
          toolboxWiki: createToolboxWikiStorageSnapshot({
            searchQuery: "铜",
            desktopCategory: "basicProduction",
            mobileSelectedCategories: ["item", "basicProduction"],
            navigationStack: [{ type: "item", id: "item_copper_ore" }],
            openedPage: { kind: "item", id: "item_copper_ore" },
          }),
          helpDialog: createDialogStateSnapshot({
            maximized: true,
            activeTab: DEFAULT_HELP_DIALOG_TAB_ID,
          }),
        }),
      ),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.state.workbench.leftDockOpen).toBe(false);
    expect(appHost.state.workbench.rightDockOpen).toBe(false);
    expect(appHost.state.workbench.leftDockWidth).toBe(512);
    expect(appHost.internalState.workbench.toolbox.wiki.searchQuery).toBe("铜");
    expect(appHost.internalState.workbench.toolbox.wiki.desktopCategory).toBe("basicProduction");
    expect(appHost.internalState.workbench.toolbox.wiki.mobileSelectedCategories).toEqual(["item", "basicProduction"]);
    expect(appHost.internalState.workbench.toolbox.wiki.navigationStack).toEqual([{ type: "item", id: "item_copper_ore" }]);
    expect(appHost.internalState.workbench.toolbox.wiki.openedPage).toEqual({ kind: "item", id: "item_copper_ore" });
    expect(appHost.internalState.workbench.dialogState.help.maximized).toBe(true);
    expect(appHost.state.settings.locale).toBe("en-US");
    expect(appHost.state.settings.themeId).toBe("ayu-light");
    expect(appHost.state.settings.hypergryphOperationMode).toBe(true);
    expect(appHost.state.settings.hypergryphImmediateMove).toBe(true);
    expect(appHost.state.settings.hypergryphImmediateMarquee).toBe(false);
    expect(appHost.state.settings.debugShowFps).toBe(false);
    expect(appHost.state.settings.debugShowGestureDiagnosticsWindow).toBe(false);
    expect(appHost.state.theme.name).toBe("Ayu Light");
    expect(document.documentElement.dataset.appTheme).toBe("ayu-light");
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        locale: "en-US",
        themeId: "ayu-light",
      }),
    );

    runInAction(() => {
      appHost.internalState.workbench.rightDockOpen = true;
      appHost.internalState.workbench.leftDockWidth = 420;
      appHost.internalState.workbench.toolbox.wiki.searchQuery = "铜锭";
      appHost.internalState.workbench.toolbox.wiki.navigationStack = [{ type: "entity", id: "item_port_grinder_1" }];
      appHost.internalState.workbench.toolbox.wiki.openedPage = { kind: "entity", id: "item_port_grinder_1" };
    });

    expect(localStorage.getItem(WORKBENCH_STATE_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify(createWorkbenchStorageSnapshot({
        leftDockOpen: false,
        rightDockOpen: true,
        leftDockWidth: 420,
        toolboxWiki: createToolboxWikiStorageSnapshot({
          searchQuery: "铜锭",
          desktopCategory: "basicProduction",
          mobileSelectedCategories: ["item", "basicProduction"],
          navigationStack: [{ type: "entity", id: "item_port_grinder_1" }],
          openedPage: { kind: "entity", id: "item_port_grinder_1" },
        }),
        helpDialog: createDialogStateSnapshot({
          maximized: true,
          activeTab: DEFAULT_HELP_DIALOG_TAB_ID,
        }),
      })),
    );
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        locale: "en-US",
        themeId: "ayu-light",
      }),
    );
    appHost.dispose();
    runInAction(() => {
      appHost.internalState.workbench.leftDockOpen = true;
    });

    expect(localStorage.getItem(WORKBENCH_STATE_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify(createWorkbenchStorageSnapshot({
        leftDockOpen: false,
        rightDockOpen: true,
        leftDockWidth: 420,
        toolboxWiki: createToolboxWikiStorageSnapshot({
          searchQuery: "铜锭",
          desktopCategory: "basicProduction",
          mobileSelectedCategories: ["item", "basicProduction"],
          navigationStack: [{ type: "entity", id: "item_port_grinder_1" }],
          openedPage: { kind: "entity", id: "item_port_grinder_1" },
        }),
        helpDialog: createDialogStateSnapshot({
          maximized: true,
          activeTab: DEFAULT_HELP_DIALOG_TAB_ID,
        }),
      })),
    );
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        locale: "en-US",
        themeId: "ayu-light",
      }),
    );
  });

  it("preserves an explicitly cleared encyclopedia mobile filter selection from storage", () => {
    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify(
        createWorkbenchStorageSnapshot({
          toolboxWiki: createToolboxWikiStorageSnapshot({
            mobileSelectedCategories: [],
          }),
        }),
      ),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.internalState.workbench.toolbox.wiki.mobileSelectedCategories).toEqual([]);
  });

  it("ignores legacy workbench storage snapshots from the previous schema key", () => {
    localStorage.setItem(
      "v3-workbench-state",
      JSON.stringify({
        leftDockOpen: true,
        rightDockOpen: true,
        leftDockWidth: 375,
        topBarCollapsed: false,
        rightDockBaseExpanded: false,
        rightDockPowerExpanded: true,
        rightDockSelectionExpanded: true,
        dialogState: {
          toolbox: createDialogStateSnapshot({ activeTab: DEFAULT_TOOLBOX_DIALOG_TAB_ID }),
          help: createDialogStateSnapshot({ activeTab: DEFAULT_HELP_DIALOG_TAB_ID }),
          settings: createDialogStateSnapshot(),
        },
      }),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.state.workbench.rightDockActiveTab).toBe("selection");
    expect(localStorage.getItem(WORKBENCH_STATE_LOCAL_STORAGE_KEY)).toBeNull();
  });

  it("reacts to theme state changes and exposes the theme on app state", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.state.settings.themeId).toBe("ayu-light");
    expect(appHost.state.theme.id).toBe("ayu-light");
    expect(document.documentElement.dataset.appTheme).toBe("ayu-light");
    expect(document.documentElement.style.getPropertyValue("--shell-bg")).toBe("#f5f7fa");

    runInAction(() => {
      appHost.internalState.settings.themeId = "ayu-dark";
    });

    expect(appHost.state.settings.themeId).toBe("ayu-dark");
    expect(appHost.state.theme.id).toBe("ayu-dark");
    expect(workspace.app?.state.theme.id).toBe("ayu-dark");
    expect(document.documentElement.dataset.appTheme).toBe("ayu-dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--shell-bg")).toBe("#0f1419");

    runInAction(() => {
      appHost.internalState.settings.themeId = "ayu-light";
    });

    expect(appHost.state.settings.themeId).toBe("ayu-light");
    expect(appHost.state.theme.id).toBe("ayu-light");
    expect(document.documentElement.dataset.appTheme).toBe("ayu-light");
  });

  it("keeps activePanel in runtime state only without persisting it", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.internalState.runtime.activePanel).toBeNull();

    appHost.internalActions.setActivePanel("history");
    appHost.internalActions.setScreenProfile({
      viewportWidth: 820,
      viewportHeight: 1180,
      devicePixelRatio: 2,
      deviceClass: "tablet",
      screenShape: "portrait",
      aspectRatio: 1180 / 820,
      hasTouch: true,
    });

    expect(appHost.internalState.runtime.activePanel).toBe("history");
    expect(localStorage.getItem(WORKBENCH_STATE_LOCAL_STORAGE_KEY)).toBeNull();

    const nextWorkspace = createWorkspace();
    const nextAppHost = createAppHost(nextWorkspace);

    expect(nextAppHost.internalState.runtime.activePanel).toBeNull();
  });

  it("predicts viewport rect immediately when dock toggles run", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const appHost = createAppHost(workspace);

    editorHost.actions.setViewportClientRect({
      left: 460,
      top: 64,
      width: 960,
      height: 720,
    });

    appHost.internalActions.toggleLeftDock();

    expect(appHost.state.workbench.leftDockOpen).toBe(false);
    expect(editorHost.state.viewport.clientRect.left).toBe(85);
    expect(editorHost.state.viewport.clientRect.top).toBe(64);
    expect(editorHost.state.viewport.clientRect.width).toBe(1335);
    expect(editorHost.state.viewport.clientRect.height).toBe(720);

    appHost.internalActions.toggleRightDock();

    expect(appHost.state.workbench.rightDockOpen).toBe(false);
    expect(editorHost.state.viewport.clientRect.left).toBe(85);
    expect(editorHost.state.viewport.clientRect.top).toBe(64);
    expect(editorHost.state.viewport.clientRect.width).toBe(1675);
    expect(editorHost.state.viewport.clientRect.height).toBe(720);
  });

  it("clears a single selection when closing the right dock in select mode", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const appHost = createAppHost(workspace);

    editorHost.internalState.collections.selection.replace(["dummy-entity-1"]);

    appHost.internalActions.toggleRightDock();

    expect(appHost.state.workbench.rightDockOpen).toBe(false);
    expect(editorHost.state.collections.selection).toEqual([]);
  });

  it("still clears a single selection when closing the right dock with selection sync disabled", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.settings.hypergryphSelectionRightDockSync = false;
    });
    editorHost.internalState.collections.selection.replace(["dummy-entity-1"]);

    appHost.internalActions.toggleRightDock();

    expect(appHost.state.workbench.rightDockOpen).toBe(false);
    expect(editorHost.state.collections.selection).toEqual([]);
  });

  it("reopens the left dock and predicts viewport rect when activating a panel while dock is closed", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const appHost = createAppHost(workspace);

    editorHost.actions.setViewportClientRect({
      left: 85,
      top: 64,
      width: 1335,
      height: 720,
    });

    appHost.internalActions.toggleLeftDock();

    expect(appHost.state.workbench.leftDockOpen).toBe(false);
    expect(editorHost.state.viewport.clientRect.left).toBe(-290);
    expect(editorHost.state.viewport.clientRect.width).toBe(1710);

    appHost.internalActions.setActivePanel("history");

    expect(appHost.internalState.runtime.activePanel).toBe("history");
    expect(appHost.state.workbench.leftDockOpen).toBe(true);
    expect(editorHost.state.viewport.clientRect.left).toBe(85);
    expect(editorHost.state.viewport.clientRect.top).toBe(64);
    expect(editorHost.state.viewport.clientRect.width).toBe(1335);
    expect(editorHost.state.viewport.clientRect.height).toBe(720);
  });

  it("uses the fixed mobile left dock width when predicting viewport rect", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 844,
    });
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      writable: true,
      value: 1,
    });
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: 5,
    });
    Object.defineProperty(window.navigator, "userAgentData", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === "(pointer: coarse)" || query === "(hover: none)",
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });

    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const appHost = createAppHost(workspace);

    editorHost.actions.setViewportClientRect({
      left: 320,
      top: 64,
      width: 900,
      height: 720,
    });

    runInAction(() => {
      appHost.internalState.workbench.leftDockWidth = 512;
    });

    appHost.internalActions.toggleLeftDock();

    expect(appHost.state.workbench.leftDockOpen).toBe(false);
    expect(editorHost.state.viewport.clientRect.left).toBe(320 - MOBILE_LEFT_DOCK_WIDTH);
    expect(editorHost.state.viewport.clientRect.width).toBe(900 + MOBILE_LEFT_DOCK_WIDTH);

    appHost.internalActions.setActivePanel("history");

    expect(appHost.state.workbench.leftDockOpen).toBe(true);
    expect(editorHost.state.viewport.clientRect.left).toBe(320);
    expect(editorHost.state.viewport.clientRect.width).toBe(900);
  });

  it("zooms the editor viewport on wheel up and wheel down gestures", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const appHost = createAppHost(workspace);
    const zoomSpy = vi.spyOn(editorHost.actions, "zoom");

    appHost.gestureAdapter.handleWheel(wheelEvent({ deltaY: -1.1 }));

    expect(zoomSpy).toHaveBeenCalledTimes(1);
    expect(zoomSpy.mock.calls[0]?.[0]).toBeGreaterThan(0);
    expect(editorHost.state.viewport.gridSize).toBeGreaterThan(1);

    const zoomedInGridSize = editorHost.state.viewport.gridSize;

    appHost.gestureAdapter.handleWheel(wheelEvent({ deltaY: 1.4 }));

    expect(zoomSpy).toHaveBeenCalledTimes(2);
    expect(zoomSpy.mock.calls[1]?.[0]).toBeLessThan(0);
    expect(editorHost.state.viewport.gridSize).toBeLessThan(zoomedInGridSize);
  });

  it("disables hypergryph gesture handlers when hypergryph operation mode is off", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const appHost = createAppHost(workspace);
    const zoomSpy = vi.spyOn(editorHost.actions, "zoom");
    const initialGridSize = editorHost.state.viewport.gridSize;

    runInAction(() => {
      appHost.internalState.settings.hypergryphOperationMode = false;
    });

    appHost.gestureAdapter.handleWheel(wheelEvent({ deltaY: -1.1 }));

    expect(zoomSpy).not.toHaveBeenCalled();
    expect(editorHost.state.viewport.gridSize).toBe(initialGridSize);
    expect(appHost.gestureDiagnostics.getSnapshot().latestEvent).toMatchObject({
      type: "wheel up",
      gestureId: "wheel-1",
    });
  });

  it("switches the private active tool from hypergryph gesture modules", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.internalState.activeTool).toBe("select");

    appHost.gestureAdapter.handleKeyDown({
      code: "KeyX",
      key: "x",
      keyCode: 88,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("marquee");

    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: "placement-tool-marquee",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("marquee");

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "placement-tool-marquee",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("marquee");

    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 7,
      button: 2,
      buttons: 2,
      clientX: 14,
      clientY: 18,
    }));
    appHost.gestureAdapter.handlePointerUp(pointerEvent({
      pointerId: 7,
      button: 2,
      buttons: 0,
      clientX: 14,
      clientY: 18,
    }));

    expect(appHost.internalState.activeTool).toBe("select");

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "placement-tool-select",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("select");

    runInAction(() => {
      appHost.internalState.settings.hypergryphOperationMode = false;
    });

    appHost.gestureAdapter.handleKeyDown({
      code: "KeyX",
      key: "x",
      keyCode: 88,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("select");

    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: "placement-tool-marquee",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("select");
  });

  it("attaches pointerEntity from editor queries to pointer tap and dragstart events", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    const appHost = createAppHost(workspace);
    const gestures: GestureEvent[] = [];
    appHost.gestureAdapter.subscribe((event) => gestures.push(event));

    const entityPoint = resolveClientPixelPointForGridCell(editorHost, { x: 4, y: 4 });

    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 21,
      clientX: entityPoint.x,
      clientY: entityPoint.y,
      buttons: 1,
    }));
    appHost.gestureAdapter.handlePointerUp(pointerEvent({
      pointerId: 21,
      clientX: entityPoint.x,
      clientY: entityPoint.y,
      buttons: 0,
    }));

    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 22,
      clientX: entityPoint.x,
      clientY: entityPoint.y,
      buttons: 1,
    }));
    appHost.gestureAdapter.handlePointerMove(pointerEvent({
      pointerId: 22,
      clientX: entityPoint.x + 8,
      clientY: entityPoint.y,
      buttons: 1,
    }));

    expect(
      gestures.filter((event) => event.type === "mouse tap" || event.type === "mouse dragstart"),
    ).toMatchObject([
      {
        type: "mouse tap",
        pointerEntity: {
          id: "dummy-entity-2",
        },
      },
      {
        type: "mouse dragstart",
        pointerEntity: {
          id: "dummy-entity-2",
        },
      },
    ]);
  });

  it("creates a move draft from mouse entity hit or touch selected entity", () => {
    vi.useFakeTimers();

    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    const appHost = createAppHost(workspace);
    const entityPoint = resolveClientPixelPointForGridCell(editorHost, { x: 4, y: 4 });
    const emptyPoint = resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 0 });

    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 31,
      clientX: emptyPoint.x,
      clientY: emptyPoint.y,
      buttons: 1,
    }));
    vi.advanceTimersByTime(500);
    appHost.gestureAdapter.handlePointerUp(pointerEvent({
      pointerId: 31,
      clientX: emptyPoint.x,
      clientY: emptyPoint.y,
      buttons: 0,
    }));

    expect(appHost.internalState.activeTool).toBe("select");

    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 32,
      clientX: entityPoint.x,
      clientY: entityPoint.y,
      buttons: 1,
    }));
    vi.advanceTimersByTime(500);
    appHost.gestureAdapter.handlePointerUp(pointerEvent({
      pointerId: 32,
      clientX: entityPoint.x,
      clientY: entityPoint.y,
      buttons: 0,
    }));

    expect(appHost.internalState.activeTool).toBe("move");
    expect(appHost.internalState.runtime.moveAnchor).toEqual({ x: 4, y: 4 });
    expect(editorHost.state.collections.selection).toEqual(["dummy-entity-2"]);
    expect(editorHost.state.collections.ghost).toEqual(["dummy-entity-2"]);
    expect(editorHost.state.collections.preview).toHaveLength(1);

    appHost.internalActions.setActiveTool("select");
    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);

    appHost.gestureAdapter.handlePointerDown(touchEvent(34, entityPoint.x, entityPoint.y));
    vi.advanceTimersByTime(500);
    appHost.gestureAdapter.handlePointerUp(touchEvent(34, entityPoint.x, entityPoint.y));

    expect(appHost.internalState.activeTool).toBe("move");
    expect(appHost.internalState.runtime.canvasFloatingToolbar.visible).toBe(true);
    expect(appHost.internalState.runtime.canvasFloatingToolbar.attachedCollection).toBe(
      EntityCollectionType.preview,
    );
    expect(appHost.internalState.runtime.canvasFloatingToolbar.buttonIds).toEqual([
      "canvas-floating-toolbar-button-cancel",
      "canvas-floating-toolbar-button-switch-mode",
      "canvas-floating-toolbar-button-rotate",
      "canvas-floating-toolbar-button-ok",
    ]);
  });

  it("aligns an attached canvas floating toolbar to the adjacent row on desktop", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    const appHost = createAppHost(workspace);

    appHost.internalActions.setScreenProfile({
      viewportWidth: 1440,
      viewportHeight: 900,
      devicePixelRatio: 1,
      deviceClass: "desktop",
      screenShape: "landscape",
      aspectRatio: 1440 / 900,
      hasTouch: false,
    });

    editorHost.internalState.collections.preview.replace(["dummy-entity-1"]);

    expect(appHost.internalActions.showCanvasFloatingToolbarForCollection(
      ["canvas-floating-toolbar-button-ok"],
      EntityCollectionType.preview,
    )).toBe(true);
    expect(appHost.internalState.runtime.canvasFloatingToolbar.attachedCollection).toBe(
      EntityCollectionType.preview,
    );
    expect(appHost.internalState.runtime.canvasFloatingToolbar.anchor).toEqual({
      x: 520,
      y: 386,
    });

    appHost.internalActions.setCanvasFloatingToolbarSize({
      width: 44,
      height: 16,
    });

    expect(appHost.internalState.runtime.canvasFloatingToolbar.anchor).toEqual({
      x: 498,
      y: 400,
    });
  });

  it("keeps the larger floating toolbar gap on mobile", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    const appHost = createAppHost(workspace);

    appHost.internalActions.setScreenProfile({
      viewportWidth: 390,
      viewportHeight: 844,
      devicePixelRatio: 3,
      deviceClass: "mobile",
      screenShape: "portrait",
      aspectRatio: 844 / 390,
      hasTouch: true,
    });

    editorHost.internalState.collections.preview.replace(["dummy-entity-1"]);

    expect(appHost.internalActions.showCanvasFloatingToolbarForCollection(
      ["canvas-floating-toolbar-button-ok"],
      EntityCollectionType.preview,
    )).toBe(true);
    expect(appHost.internalState.runtime.canvasFloatingToolbar.anchor).toEqual({
      x: 520,
      y: 370,
    });

    appHost.internalActions.setCanvasFloatingToolbarSize({
      width: 44,
      height: 16,
    });

    expect(appHost.internalState.runtime.canvasFloatingToolbar.anchor).toEqual({
      x: 498,
      y: 384,
    });
  });

  it("moves the preview draft and applies or cancels the move gesture", () => {
    vi.useFakeTimers();

    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    const appHost = createAppHost(workspace);
    const entityPoint = resolveClientPixelPointForGridCell(editorHost, { x: 4, y: 4 });
    const emptyPoint = resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 0 });

    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 34,
      clientX: emptyPoint.x,
      clientY: emptyPoint.y,
      buttons: 1,
    }));
    vi.advanceTimersByTime(500);
    appHost.gestureAdapter.handlePointerMove(pointerEvent({
      pointerId: 34,
      clientX: emptyPoint.x + 8,
      clientY: emptyPoint.y,
      buttons: 1,
    }));

    expect(appHost.internalState.activeTool).toBe("select");

    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);

    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 35,
      clientX: entityPoint.x,
      clientY: entityPoint.y,
      buttons: 1,
    }));
    vi.advanceTimersByTime(500);
    appHost.gestureAdapter.handlePointerMove(pointerEvent({
      pointerId: 35,
      clientX: entityPoint.x + 8,
      clientY: entityPoint.y,
      buttons: 1,
    }));

    expect(appHost.internalState.activeTool).toBe("move");
    expect(appHost.internalState.runtime.moveAnchor).toEqual({ x: 4, y: 4 });

    const previewDraftId = editorHost.state.collections.preview[0];
    expect(previewDraftId).toBeDefined();

    appHost.gestureAdapter.handlePointerMove(pointerEvent({
      pointerId: 35,
      clientX: entityPoint.x + 20,
      clientY: entityPoint.y,
      buttons: 1,
    }));
    // 触发 pending mouse dragmove flush
    appHost.gestureAdapter.handleKeyDown(keyEvent({ code: "F13", key: "F13", keyCode: 124 }));

    expect(appHost.internalState.runtime.moveAnchor).toEqual({ x: 5, y: 4 });
    expect(
      editorHost.internalState.drafts.find((entity) => entity.id === previewDraftId)?.position,
    ).toEqual({ x: 5, y: 4 });

    appHost.gestureAdapter.handlePointerUp(pointerEvent({
      pointerId: 35,
      clientX: entityPoint.x + 20,
      clientY: entityPoint.y,
      buttons: 0,
    }));

    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 36,
      button: 2,
      buttons: 2,
      clientX: entityPoint.x,
      clientY: entityPoint.y,
    }));
    appHost.gestureAdapter.handlePointerUp(pointerEvent({
      pointerId: 36,
      button: 2,
      buttons: 0,
      clientX: entityPoint.x,
      clientY: entityPoint.y,
    }));

    expect(appHost.internalState.activeTool).toBe("select");
    expect(editorHost.state.collections.preview).toEqual([]);
    expect(editorHost.document.getSnapshot().entities["dummy-entity-2"]?.position).toEqual({
      x: 4,
      y: 4,
    });

    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);

    appHost.gestureAdapter.handlePointerDown(touchEvent(37, entityPoint.x, entityPoint.y));
    vi.advanceTimersByTime(500);
    appHost.gestureAdapter.handlePointerMove(touchEvent(37, entityPoint.x + 4, entityPoint.y));

    expect(appHost.internalState.activeTool).toBe("move");

    appHost.gestureAdapter.handlePointerMove(touchEvent(37, entityPoint.x + 20, entityPoint.y));
    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "canvas-floating-toolbar-button-ok",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("select");
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();
    expect(appHost.internalState.runtime.canvasFloatingToolbar.visible).toBe(false);
    expect(editorHost.state.collections.selection).toEqual([]);
    expect(editorHost.document.getSnapshot().entities["dummy-entity-2"]?.position).toEqual({
      x: 5,
      y: 4,
    });
  });

  it("cancels move drafts when activeTool leaves move by another path", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);

    editorHost.internalState.collections.selection.replace(["dummy-entity-1"]);
    editorHost.actions.createMoveOperationDraft();
    appHost.internalState.runtime.moveAnchor = { x: 12, y: 8 };
    appHost.internalState.runtime.movePointerMode = "touch";
    appHost.internalActions.showCanvasFloatingToolbarForCollection(
      ["canvas-floating-toolbar-button-ok", "canvas-floating-toolbar-button-cancel"],
      "preview",
    );
    appHost.internalActions.setActiveTool("move");

    expect(editorHost.state.collections.preview).toHaveLength(1);
    expect(appHost.internalState.runtime.canvasFloatingToolbar.visible).toBe(true);

    appHost.internalActions.setActiveTool("single-placement");

    expect(appHost.internalState.activeTool).toBe("single-placement");
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();
    expect(appHost.internalState.runtime.canvasFloatingToolbar.visible).toBe(false);
    expect(editorHost.state.collections.preview).toEqual([]);
    expect(editorHost.state.collections.ghost).toEqual([]);
  });

  it("keeps mouse move active and does not commit outside the base outer ring", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();
    editorHost.internalDocument.setSnapshot(document);
    const appHost = createAppHost(workspace);

    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);
    editorHost.actions.createMoveOperationDraft();
    appHost.internalState.runtime.moveAnchor = { x: 4, y: 4 };
    appHost.internalState.runtime.movePointerMode = "mouse";
    appHost.internalActions.setActiveTool("move");

    const previewDraftId = editorHost.state.collections.preview[0];
    expect(previewDraftId).toBeDefined();
    editorHost.actions.moveCollectionTo({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 0, y: 0 },
      endGridPoint: { x: -100, y: 0 },
    });

    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: "canvas-floating-toolbar-button-ok",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(editorHost.document.getSnapshot().entities["dummy-entity-2"]).toEqual(
      document.entities["dummy-entity-2"],
    );
    expect(appHost.internalState.activeTool).toBe("move");
    expect(appHost.internalState.runtime.moveAnchor).toEqual({ x: 4, y: 4 });
    expect(editorHost.state.collections.preview).toEqual([previewDraftId]);
    expect(
      editorHost.state.collections[EntityCollectionType.invalidPlacement].contains(
        previewDraftId ?? "",
      ),
    ).toBe(true);
  });

  it("keeps touch move active and does not commit outside the base outer ring", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();
    editorHost.internalDocument.setSnapshot(document);
    const appHost = createAppHost(workspace);

    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);
    editorHost.actions.createMoveOperationDraft();
    appHost.internalState.runtime.moveAnchor = { x: 4, y: 4 };
    appHost.internalState.runtime.movePointerMode = "touch";
    appHost.internalActions.setActiveTool("move");

    const previewDraftId = editorHost.state.collections.preview[0];
    expect(previewDraftId).toBeDefined();
    editorHost.actions.moveCollectionTo({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 0, y: 0 },
      endGridPoint: { x: -100, y: 0 },
    });

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "canvas-floating-toolbar-button-ok",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(editorHost.document.getSnapshot().entities["dummy-entity-2"]).toEqual(
      document.entities["dummy-entity-2"],
    );
    expect(appHost.internalState.activeTool).toBe("move");
    expect(appHost.internalState.runtime.moveAnchor).toEqual({ x: 4, y: 4 });
    expect(editorHost.state.collections.preview).toEqual([previewDraftId]);
    expect(
      editorHost.state.collections[EntityCollectionType.invalidPlacement].contains(
        previewDraftId ?? "",
      ),
    ).toBe(true);
  });

  it("creates and applies single-placement drafts from placement device buttons", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);
    const initialEntityOrderLength = editorHost.document.getSnapshot().entityOrder.length;

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "ui-left-dock-placement-mode-item_port_storager_1-touch-tap",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("single-placement");
    expect(appHost.internalState.runtime.placementAnchor).toEqual({ x: 0, y: 0 });
    expect(appHost.internalState.runtime.singlePlacementDeviceId).toBe("item_port_storager_1");
    expect(appHost.internalState.runtime.canvasFloatingToolbar.visible).toBe(true);
    expect(editorHost.state.collections.preview).toHaveLength(1);

    const draftId = editorHost.state.collections.preview[0];
    expect(draftId).toBeDefined();
    expect(editorHost.queries.getEntityById(draftId ?? "")).toMatchObject({
      definitionId: "item_port_storager_1",
      position: { x: -1, y: -1 },
    });

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "canvas-floating-toolbar-button-ok",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("select");
    expect(appHost.internalState.runtime.placementAnchor).toBeNull();
    expect(appHost.internalState.runtime.singlePlacementDeviceId).toBeNull();
    expect(appHost.internalState.runtime.canvasFloatingToolbar.visible).toBe(false);
    expect(editorHost.state.collections.preview).toEqual([]);
    expect(editorHost.document.getSnapshot().entityOrder).toHaveLength(
      initialEntityOrderLength + 1,
    );
    const finalId = draftId?.startsWith("placement-draft:")
      ? draftId.slice("placement-draft:".length)
      : draftId;
    expect(editorHost.document.getSnapshot().entities[finalId ?? ""]).toMatchObject({
      definitionId: "item_port_storager_1",
      position: { x: -1, y: -1 },
    });
  });

  it("keeps mobile single-placement active when confirming a draft outside the base outer ring", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);
    const initialEntityOrder = [...editorHost.document.getSnapshot().entityOrder];

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "ui-left-dock-placement-mode-item_port_storager_1-touch-tap",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    editorHost.actions.createSinglePlacementDraft("item_port_storager_1", { x: -10, y: 5 });
    appHost.internalState.runtime.placementAnchor = { x: -10, y: 5 };

    const draftId = editorHost.state.collections.preview[0];
    expect(draftId).toBeDefined();
    expect(
      editorHost.queries.getEntityPlacementValidation(draftId ?? "").reasons.map((reason) =>
        reason.code,
      ),
    ).toContain("outside-base");

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "canvas-floating-toolbar-button-ok",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("single-placement");
    expect(appHost.internalState.runtime.placementAnchor).toEqual({ x: -10, y: 5 });
    expect(appHost.internalState.runtime.singlePlacementDeviceId).toBe("item_port_storager_1");
    expect(appHost.internalState.runtime.canvasFloatingToolbar.visible).toBe(true);
    expect(editorHost.state.collections.preview).toEqual([draftId]);
    expect(editorHost.document.getSnapshot().entityOrder).toEqual(initialEntityOrder);
  });

  it("cancels single-placement drafts when activeTool leaves by another path", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);

    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: "ui-left-dock-placement-mode-item_port_storager_1-mouse-tap",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("single-placement");
    expect(editorHost.state.collections.preview).toHaveLength(1);

    appHost.internalActions.setActiveTool("select");

    expect(appHost.internalState.activeTool).toBe("select");
    expect(appHost.internalState.runtime.placementAnchor).toBeNull();
    expect(appHost.internalState.runtime.singlePlacementDeviceId).toBeNull();
    expect(editorHost.state.collections.preview).toEqual([]);
  });

  it("enters blueprint-placement from the preview place button without changing the active panel", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);
    const blueprintRecord = createTestBlueprintRecord();

    runInAction(() => {
      appHost.internalState.runtime.activePanel = "blueprint";
    });
    appHost.blueprintPreview.open(blueprintRecord);

    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: "blueprint-preview-place-button",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("blueprint-placement");
    expect(appHost.internalState.runtime.activePanel).toBe("blueprint");
    expect(appHost.blueprintPreview.dialogState.visible).toBe(false);
    expect(appHost.internalState.runtime.blueprintPlacementRecord?.blueprintId).toBe(
      blueprintRecord.blueprintId,
    );
    expect(editorHost.state.collections.preview).toHaveLength(2);
    expect(editorHost.internalState.internalTransientState.placementDraftSlotLinks).toHaveLength(1);
  });

  it("copies the current selection as a temporary blueprint from Ctrl+C", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);

    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "dummy-entity-2",
    });

    const consumed = appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyC",
      key: "c",
      keyCode: 67,
      ctrlKey: true,
    }));

    expect(consumed).toBe(true);
    expect(appHost.internalState.activeTool).toBe("blueprint-placement");
    expect(appHost.internalState.runtime.blueprintPlacementRecord).toMatchObject({
      parentFolderId: null,
      entityOrder: ["dummy-entity-2"],
    });
    expect(appHost.blueprintPreview.record).toBeNull();
    expect(editorHost.state.collections.preview).toHaveLength(1);

    const previewEntity = editorHost.queries.getEntityById(
      editorHost.state.collections.preview[0] ?? "",
    );
    expect(previewEntity?.definitionId).toBe("item_port_storager_1");
  });

  it("pastes the last temporary blueprint from Ctrl+V without persistent storage", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);

    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "dummy-entity-2",
    });
    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyC",
      key: "c",
      keyCode: 67,
      ctrlKey: true,
    }));

    const copiedBlueprintId =
      appHost.internalState.runtime.blueprintPlacementRecord?.blueprintId;

    appHost.internalActions.setActiveTool("select");
    editorHost.actions.clearCollection(EntityCollectionType.selection);

    const consumed = appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyV",
      key: "v",
      keyCode: 86,
      ctrlKey: true,
    }));

    expect(consumed).toBe(true);
    expect(appHost.internalState.activeTool).toBe("blueprint-placement");
    expect(appHost.internalState.runtime.blueprintPlacementRecord?.blueprintId).toBe(
      copiedBlueprintId,
    );
    expect(appHost.internalState.runtime.blueprintPlacementRecord?.entityOrder).toEqual([
      "dummy-entity-2",
    ]);
    expect(editorHost.state.collections.preview).toHaveLength(1);
  });

  it("ignores temporary blueprint shortcuts when there is no source data", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);

    const copyConsumed = appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyC",
      key: "c",
      keyCode: 67,
      ctrlKey: true,
    }));
    const pasteConsumed = appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyV",
      key: "v",
      keyCode: 86,
      ctrlKey: true,
    }));

    expect(copyConsumed).toBe(false);
    expect(pasteConsumed).toBe(false);
    expect(appHost.internalState.activeTool).toBe("select");
    expect(editorHost.state.collections.preview).toEqual([]);
  });

  it("does not intercept browser copy or paste inside editable targets", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);
    const input = document.createElement("input");

    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "dummy-entity-2",
    });

    const consumed = appHost.gestureAdapter.handleKeyDown({
      ...keyEvent({
        code: "KeyC",
        key: "c",
        keyCode: 67,
        ctrlKey: true,
      }),
      target: input,
    } as GestureKeyboardEventLike);

    expect(consumed).toBe(false);
    expect(appHost.internalState.activeTool).toBe("select");
    expect(editorHost.state.collections.preview).toEqual([]);
  });

  it("keeps temporary blueprint shortcuts disabled outside Hypergryph mode", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.settings.hypergryphOperationMode = false;
    });
    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "dummy-entity-2",
    });

    const consumed = appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyC",
      key: "c",
      keyCode: 67,
      ctrlKey: true,
    }));

    expect(consumed).toBe(false);
    expect(appHost.internalState.activeTool).toBe("select");
    expect(editorHost.state.collections.preview).toEqual([]);
  });

  it("re-arms blueprint-placement with a new temporary blueprint while already placing", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);

    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "dummy-entity-2",
    });
    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyC",
      key: "c",
      keyCode: 67,
      ctrlKey: true,
    }));

    editorHost.actions.clearCollection(EntityCollectionType.selection);
    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "dummy-entity-3",
    });

    const consumed = appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyC",
      key: "c",
      keyCode: 67,
      ctrlKey: true,
    }));

    expect(consumed).toBe(true);
    expect(appHost.internalState.activeTool).toBe("blueprint-placement");
    expect(appHost.internalState.runtime.blueprintPlacementRecord?.entityOrder).toEqual([
      "dummy-entity-3",
    ]);
    expect(editorHost.state.collections.preview).toHaveLength(1);
    expect(editorHost.queries.getEntityById(
      editorHost.state.collections.preview[0] ?? "",
    )?.definitionId).toBe("item_port_grinder_1");
  });

  it("re-arms blueprint-placement after apply and exits cleanly on cancel", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);
    const blueprintRecord = createTestBlueprintRecord();
    const initialEntityOrderLength = editorHost.document.getSnapshot().entityOrder.length;

    appHost.blueprintPreview.open(blueprintRecord);
    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "blueprint-preview-place-button",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    const previewBeforeApply = editorHost.state.collections.preview.map((entityId) => {
      const entity = editorHost.queries.getEntityById(entityId);

      return entity === null
        ? null
        : {
          definitionId: entity.definitionId,
          position: { ...entity.position },
          rotation: entity.rotation,
        };
    });

    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyR",
      key: "r",
      keyCode: 82,
    }));

    const rotatedPreview = editorHost.state.collections.preview.map((entityId) => {
      const entity = editorHost.queries.getEntityById(entityId);

      return entity === null
        ? null
        : {
          definitionId: entity.definitionId,
          position: { ...entity.position },
          rotation: entity.rotation,
        };
    });

    expect(rotatedPreview).not.toEqual(previewBeforeApply);
    expect(appHost.internalState.runtime.blueprintPlacementRotationSteps).toBe(1);
    expect(appHost.internalState.runtime.canvasFloatingToolbar.visible).toBe(true);

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "canvas-floating-toolbar-button-ok",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("blueprint-placement");
    expect(appHost.internalState.runtime.blueprintPlacementRecord?.blueprintId).toBe(
      blueprintRecord.blueprintId,
    );
    expect(appHost.internalState.runtime.blueprintPlacementRotationSteps).toBe(1);
    expect(editorHost.document.getSnapshot().entityOrder).toHaveLength(initialEntityOrderLength + 2);
    expect(editorHost.document.getSnapshot().slotLinks).toHaveLength(1);
    expect(editorHost.state.collections.preview).toHaveLength(2);

    const rearmedPreview = editorHost.state.collections.preview.map((entityId) => {
      const entity = editorHost.queries.getEntityById(entityId);

      return entity === null
        ? null
        : {
          definitionId: entity.definitionId,
          position: { ...entity.position },
          rotation: entity.rotation,
        };
    });

    expect(rearmedPreview).toEqual(rotatedPreview);

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "canvas-floating-toolbar-button-cancel",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("select");
    expect(appHost.internalState.runtime.blueprintPlacementRecord).toBeNull();
    expect(appHost.internalState.runtime.blueprintPlacementPointerMode).toBeNull();
    expect(editorHost.state.collections.preview).toEqual([]);
  });

  it("keeps blueprint-placement active and does not commit outside the base outer ring", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);
    const blueprintRecord = createTestBlueprintRecord();
    const initialEntityOrder = [...editorHost.document.getSnapshot().entityOrder];

    appHost.blueprintPreview.open(blueprintRecord);
    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "blueprint-preview-place-button",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    const previewIds = [...editorHost.state.collections.preview];
    editorHost.actions.moveCollectionTo({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 0, y: 0 },
      endGridPoint: { x: -100, y: 0 },
    });

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "canvas-floating-toolbar-button-ok",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(editorHost.document.getSnapshot().entityOrder).toEqual(initialEntityOrder);
    expect(appHost.internalState.activeTool).toBe("blueprint-placement");
    expect(editorHost.state.collections.preview).toEqual(previewIds);
    expect(previewIds.every((entityId) =>
      editorHost.state.collections[EntityCollectionType.invalidPlacement].contains(entityId),
    )).toBe(true);
  });

  it("keeps temporary pasted blueprint placement active and does not commit outside the base outer ring", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);
    const initialEntityOrder = [...editorHost.document.getSnapshot().entityOrder];

    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "dummy-entity-2",
    });
    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyC",
      key: "c",
      keyCode: 67,
      ctrlKey: true,
    }));
    appHost.internalActions.setActiveTool("select");
    editorHost.actions.clearCollection(EntityCollectionType.selection);

    const consumed = appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyV",
      key: "v",
      keyCode: 86,
      ctrlKey: true,
    }));

    expect(consumed).toBe(true);
    const previewIds = [...editorHost.state.collections.preview];
    editorHost.actions.moveCollectionTo({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 0, y: 0 },
      endGridPoint: { x: -100, y: 0 },
    });

    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: "canvas-floating-toolbar-button-ok",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(editorHost.document.getSnapshot().entityOrder).toEqual(initialEntityOrder);
    expect(appHost.internalState.activeTool).toBe("blueprint-placement");
    expect(editorHost.state.collections.preview).toEqual(previewIds);
    expect(previewIds.every((entityId) =>
      editorHost.state.collections[EntityCollectionType.invalidPlacement].contains(entityId),
    )).toBe(true);
  });

  it("enters logistics-placement from E/Q and arms logistics device shortcuts", () => {
    const workspace = createWorkspace();
    createEditorHost(workspace);
    const appHost = createAppHost(workspace);

    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyE",
      key: "e",
      keyCode: 69,
    }));

    expect(appHost.internalState.activeTool).toBe("logistics-placement");
    expect(appHost.internalState.runtime.logisticsPlacement.kind).toBe("belt");
    expect(appHost.internalState.runtime.logisticsPlacement.shortcutPlacementGroup).toBe(
      "beltLogistics",
    );

    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyQ",
      key: "q",
      keyCode: 81,
    }));

    expect(appHost.internalState.activeTool).toBe("logistics-placement");
    expect(appHost.internalState.runtime.logisticsPlacement.kind).toBe("pipe");
    expect(appHost.internalState.runtime.logisticsPlacement.shortcutPlacementGroup).toBe(
      "pipeLogistics",
    );
  });

  it("deletes the current selection from the delete-device shortcut", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);

    editorHost.internalState.collections.selection.replace(["dummy-entity-1"]);

    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyF",
      key: "f",
      keyCode: 70,
    }));

    expect(editorHost.document.getSnapshot().entities["dummy-entity-1"]).toBeUndefined();
    expect(editorHost.state.collections.selection).toEqual([]);
  });

  it("deletes the current selection from the delete-device shortcut while marquee stays active", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);

    editorHost.internalState.collections.selection.replace(["dummy-entity-1"]);
    appHost.internalActions.showCanvasRightDockToolbar([
      "canvas-right-dock-toolbar-button-exit",
      "canvas-right-dock-toolbar-button-move",
      "canvas-right-dock-toolbar-button-delete",
    ]);
    appHost.internalActions.setActiveTool("marquee");

    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyF",
      key: "f",
      keyCode: 70,
    }));

    expect(editorHost.document.getSnapshot().entities["dummy-entity-1"]).toBeUndefined();
    expect(editorHost.state.collections.selection).toEqual([]);
    expect(appHost.internalState.activeTool).toBe("marquee");
    expect(appHost.internalState.runtime.canvasRightDockToolbar.visible).toBe(true);
    expect(appHost.internalState.runtime.canvasRightDockToolbar.buttonIds).toEqual([
      "canvas-right-dock-toolbar-button-exit",
      "canvas-right-dock-toolbar-button-move",
      "canvas-right-dock-toolbar-button-delete",
    ]);
  });

  it("opens the save blueprint dialog from the save shortcut and selection action button only for multi-selection", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);
    const appHost = createAppHost(workspace);

    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyS",
      key: "s",
      keyCode: 83,
      ctrlKey: true,
    }));

    expect(appHost.internalState.workbench.dialogState["save-blueprint"].visible).toBe(false);

    editorHost.internalState.collections.selection.replace(["dummy-entity-2", "dummy-entity-3"]);

    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyS",
      key: "s",
      keyCode: 83,
      ctrlKey: true,
    }));

    expect(appHost.internalState.workbench.dialogState["save-blueprint"].visible).toBe(true);

    appHost.internalActions.closeDialog("save-blueprint");
    expect(appHost.internalState.workbench.dialogState["save-blueprint"].visible).toBe(false);

    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: "canvas-floating-toolbar-button-save-blueprint",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.workbench.dialogState["save-blueprint"].visible).toBe(true);
  });

  it("migrates the legacy save blueprint shortcut to Ctrl+S", () => {
    localStorage.setItem(APP_SHORTCUTS_LOCAL_STORAGE_KEY, JSON.stringify({
      [SHORTCUT_KEY.SAVE_BLUEPRINT]: "N",
    }));

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.internalActions.getKeyboardShortcutFor(SHORTCUT_KEY.SAVE_BLUEPRINT)).toBe("Ctrl+S");
  });

  it("returns to select mode from any active tool using the return-select shortcut", () => {
    const workspace = createWorkspace();
    createEditorHost(workspace);
    const appHost = createAppHost(workspace);

    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyE",
      key: "e",
      keyCode: 69,
    }));
    expect(appHost.internalState.activeTool).toBe("logistics-placement");

    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "Escape",
      key: "Escape",
      keyCode: 27,
    }));

    expect(appHost.internalState.activeTool).toBe("select");
  });

  it("previews mouse logistics start on hovered output device and confirms it on click", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 1000,
      height: 800,
    });
    const appHost = createAppHost(workspace);
    const devicePoint = resolveClientPixelPointForGridCell(editorHost, { x: 14, y: 10 });
    const emptyPoint = resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 0 });

    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyE",
      key: "e",
      keyCode: 69,
    }));
    expect(appHost.internalState.activeTool).toBe("logistics-placement");

    appHost.gestureAdapter.handlePointerMove(pointerEvent({
      pointerId: 41,
      clientX: devicePoint.x,
      clientY: devicePoint.y,
      buttons: 0,
    }));
    appHost.gestureAdapter.handleKeyDown(keyEvent({ code: "F13", key: "F13", keyCode: 124 }));

    let logisticsDraft = editorHost.queries.resolveLogisticsDraftState();
    expect(logisticsDraft?.source).toMatchObject({
      type: "device-port",
      portDirection: "output",
    });
    expect(logisticsDraft?.cells).toEqual([]);
    expect(editorHost.state.collections.preview).toEqual([]);
    expect(editorHost.state.collections[EntityCollectionType.logisticsHead]).toEqual([]);
    expect(appHost.internalState.runtime.logisticsPlacement.phase).toBe("idle");
    expect(appHost.internalState.runtime.logisticsPlacement.isHoverPreview).toBe(true);

    appHost.gestureAdapter.handlePointerMove(pointerEvent({
      pointerId: 42,
      clientX: emptyPoint.x,
      clientY: emptyPoint.y,
      buttons: 0,
    }));
    appHost.gestureAdapter.handleKeyDown(keyEvent({ code: "F13", key: "F13", keyCode: 124 }));

    expect(editorHost.queries.resolveLogisticsDraftState()).toBeNull();
    expect(editorHost.state.collections.preview).toEqual([]);
    expect(editorHost.state.collections[EntityCollectionType.logisticsHead]).toEqual([]);
    expect(appHost.internalState.runtime.logisticsPlacement.isHoverPreview).toBe(false);

    appHost.gestureAdapter.handlePointerMove(pointerEvent({
      pointerId: 43,
      clientX: devicePoint.x,
      clientY: devicePoint.y,
      buttons: 0,
    }));
    appHost.gestureAdapter.handleKeyDown(keyEvent({ code: "F13", key: "F13", keyCode: 124 }));
    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 44,
      clientX: devicePoint.x,
      clientY: devicePoint.y,
      buttons: 1,
    }));
    appHost.gestureAdapter.handlePointerUp(pointerEvent({
      pointerId: 44,
      clientX: devicePoint.x,
      clientY: devicePoint.y,
      buttons: 0,
    }));

    logisticsDraft = editorHost.queries.resolveLogisticsDraftState();
    expect(logisticsDraft?.source).toMatchObject({
      type: "device-port",
      portDirection: "output",
    });
    expect(logisticsDraft?.cells).toEqual([]);
    expect(appHost.internalState.runtime.logisticsPlacement.phase).toBe("drawing");
    expect(appHost.internalState.runtime.logisticsPlacement.isHoverPreview).toBe(false);
  });

  it("draws, applies, and continues mouse logistics placement from the previous head", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    const appHost = createAppHost(workspace);
    const initialEntityOrderLength = editorHost.document.getSnapshot().entityOrder.length;
    const startPoint = resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 0 });
    const endPoint = resolveClientPixelPointForGridCell(editorHost, { x: 2, y: 0 });

    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyE",
      key: "e",
      keyCode: 69,
    }));
    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 41,
      clientX: startPoint.x,
      clientY: startPoint.y,
      buttons: 1,
    }));
    appHost.gestureAdapter.handlePointerUp(pointerEvent({
      pointerId: 41,
      clientX: startPoint.x,
      clientY: startPoint.y,
      buttons: 0,
    }));
    appHost.gestureAdapter.handlePointerMove(pointerEvent({
      pointerId: 42,
      clientX: endPoint.x,
      clientY: endPoint.y,
      buttons: 0,
    }));
    // 触发 pending mouse move flush
    appHost.gestureAdapter.handleKeyDown(keyEvent({ code: "F13", key: "F13", keyCode: 124 }));

    let logisticsDraft = editorHost.queries.resolveLogisticsDraftState();
    expect(logisticsDraft).toMatchObject({
      canApply: true,
    });
    expect(logisticsDraft?.cells.at(-1)?.gridPoint).toEqual({ x: 2, y: 0 });
    expect(editorHost.state.collections[EntityCollectionType.logisticsHead]).toEqual([
      editorHost.state.collections.preview.at(-1),
    ]);

    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 43,
      clientX: endPoint.x,
      clientY: endPoint.y,
      buttons: 1,
    }));
    appHost.gestureAdapter.handlePointerUp(pointerEvent({
      pointerId: 43,
      clientX: endPoint.x,
      clientY: endPoint.y,
      buttons: 0,
    }));

    const snapshot = editorHost.document.getSnapshot();
    const headEntity = Object.values(snapshot.entities).find((entity) =>
      entity.definitionId.startsWith("belt_")
      && entity.position.x === 2
      && entity.position.y === 0,
    );

    expect(headEntity).toBeDefined();
    expect(snapshot.entityOrder).toHaveLength(initialEntityOrderLength + 3);
    expect(appHost.internalState.activeTool).toBe("logistics-placement");
    logisticsDraft = editorHost.queries.resolveLogisticsDraftState();
    expect(logisticsDraft).toMatchObject({
      canApply: true,
      source: {
        type: "logistics-entity",
        entityId: headEntity?.id,
      },
    });
    expect(logisticsDraft?.cells.at(-1)?.gridPoint).toEqual({ x: 2, y: 0 });
    expect(editorHost.state.collections.ghost).toEqual([headEntity?.id]);
  });

  it("keeps mouse logistics preview stable while the pointer stays in the same grid cell", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    const appHost = createAppHost(workspace);
    const startPoint = resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 0 });
    const endPoint = resolveClientPixelPointForGridCell(editorHost, { x: 2, y: 0 });
    const sameCellPoint = {
      x: endPoint.x + editorHost.state.viewport.gridCellPixelSize / 4,
      y: endPoint.y - editorHost.state.viewport.gridCellPixelSize / 4,
    };

    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyE",
      key: "e",
      keyCode: 69,
    }));
    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 41,
      clientX: startPoint.x,
      clientY: startPoint.y,
      buttons: 1,
    }));
    appHost.gestureAdapter.handlePointerUp(pointerEvent({
      pointerId: 41,
      clientX: startPoint.x,
      clientY: startPoint.y,
      buttons: 0,
    }));
    appHost.gestureAdapter.handlePointerMove(pointerEvent({
      pointerId: 42,
      clientX: endPoint.x,
      clientY: endPoint.y,
      buttons: 0,
    }));

    const previewBefore = [...editorHost.state.collections.preview];
    const draftBefore = editorHost.queries.resolveLogisticsDraftState();

    appHost.gestureAdapter.handlePointerMove(pointerEvent({
      pointerId: 42,
      clientX: sameCellPoint.x,
      clientY: sameCellPoint.y,
      buttons: 0,
    }));

    const draftAfter = editorHost.queries.resolveLogisticsDraftState();
    expect(editorHost.state.collections.preview).toEqual(previewBefore);
    expect(draftAfter?.headDraftEntityId).toBe(draftBefore?.headDraftEntityId);
    expect(draftAfter?.cells).toEqual(draftBefore?.cells);
  });

  it("returns to idle after applying a mouse logistics draft that snapped to a device input port", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    const appHost = createAppHost(workspace);
    const initialEntityOrderLength = editorHost.document.getSnapshot().entityOrder.length;

    // Place a device with input ports (3x3 footprint, input ports on south edge)
    editorHost.actions.createSinglePlacementDraft("item_port_storager_1", { x: 6, y: 6 });
    editorHost.actions.applyPlacementDraft();

    // Enter belt logistics placement mode
    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyE",
      key: "e",
      keyCode: 69,
    }));
    expect(appHost.internalState.activeTool).toBe("logistics-placement");

    // Start drawing from an empty cell south of the device
    const startPoint = resolveClientPixelPointForGridCell(editorHost, { x: 5, y: 11 });
    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 41,
      clientX: startPoint.x,
      clientY: startPoint.y,
      buttons: 1,
    }));
    appHost.gestureAdapter.handlePointerUp(pointerEvent({
      pointerId: 41,
      clientX: startPoint.x,
      clientY: startPoint.y,
      buttons: 0,
    }));

    // Move mouse to a cell inside the device to snap to its input port
    const insideDevicePoint = resolveClientPixelPointForGridCell(editorHost, { x: 5, y: 7 });
    appHost.gestureAdapter.handlePointerMove(pointerEvent({
      pointerId: 42,
      clientX: insideDevicePoint.x,
      clientY: insideDevicePoint.y,
      buttons: 0,
    }));
    // 触发 pending mouse move flush
    appHost.gestureAdapter.handleKeyDown(keyEvent({ code: "F13", key: "F13", keyCode: 124 }));

    // The draft should be snapped to a device input port
    const draft = editorHost.queries.resolveLogisticsDraftState();
    expect(draft?.target?.type).toBe("device-port");
    expect(draft?.canApply).toBe(true);
    expect(appHost.internalState.runtime.logisticsPlacement.targetEntityId).not.toBeNull();

    // Apply the draft with left click
    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 43,
      clientX: insideDevicePoint.x,
      clientY: insideDevicePoint.y,
      buttons: 1,
    }));
    appHost.gestureAdapter.handlePointerUp(pointerEvent({
      pointerId: 43,
      clientX: insideDevicePoint.x,
      clientY: insideDevicePoint.y,
      buttons: 0,
    }));

    // Should be back to idle, NOT continuing from the head cell
    expect(appHost.internalState.runtime.logisticsPlacement.phase).toBe("idle");
    expect(appHost.internalState.runtime.logisticsPlacement.headGridPoint).toBeNull();
    expect(editorHost.queries.resolveLogisticsDraftState()).toBeNull();

    // The belt tiles should be committed to the document
    const snapshot = editorHost.document.getSnapshot();
    expect(snapshot.entityOrder).toHaveLength(initialEntityOrderLength + 1 + 4);
    // 1 device + 4 belt tiles (from y=11 to y=8)
  });

  it("creates touch logistics drafts from the press cell and anchors the toolbar to logistics head", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    const appHost = createAppHost(workspace);
    const startPoint = resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 0 });
    const endPoint = resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 2 });

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "placement-action-belt-draw",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    appHost.gestureAdapter.handlePointerDown(touchEvent(51, startPoint.x, startPoint.y));
    appHost.gestureAdapter.handlePointerMove(touchEvent(51, endPoint.x, endPoint.y));

    expect(appHost.internalState.activeTool).toBe("logistics-placement");
    expect(appHost.internalState.runtime.logisticsPlacement.pointerMode).toBe("touch");
    expect(appHost.internalState.runtime.canvasFloatingToolbar.visible).toBe(true);
    expect(appHost.internalState.runtime.canvasFloatingToolbar.attachedCollection).toBe(
      EntityCollectionType.logisticsHead,
    );
    expect(appHost.internalState.runtime.canvasFloatingToolbar.buttonIds).toEqual([
      "canvas-floating-toolbar-button-cancel",
      "canvas-floating-toolbar-button-ok",
    ]);
    const logisticsDraft = editorHost.queries.resolveLogisticsDraftState();
    expect(logisticsDraft).toMatchObject({
      canApply: true,
      source: {
        type: "empty-cell",
        gridPoint: { x: 0, y: 0 },
      },
    });
    expect(logisticsDraft?.cells.at(-1)?.gridPoint).toEqual({ x: 0, y: 2 });
  });

  it("lets touch drags away from an unfinished logistics head fall through to viewport pan", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    const appHost = createAppHost(workspace);
    const panSpy = vi.spyOn(editorHost.actions, "moveViewportByClientPixelVector");
    const startPoint = resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 0 });
    const headPoint = resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 2 });
    const otherStartPoint = resolveClientPixelPointForGridCell(editorHost, { x: 4, y: 4 });
    const otherEndPoint = resolveClientPixelPointForGridCell(editorHost, { x: 5, y: 4 });
    const otherContinuePoint = {
      x: otherEndPoint.x + editorHost.state.viewport.gridCellPixelSize,
      y: otherEndPoint.y,
    };

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "placement-action-belt-draw",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    appHost.gestureAdapter.handlePointerDown(touchEvent(71, startPoint.x, startPoint.y));
    appHost.gestureAdapter.handlePointerMove(touchEvent(71, headPoint.x, headPoint.y));
    appHost.gestureAdapter.handlePointerUp(touchEvent(71, headPoint.x, headPoint.y));

    const beforeDraft = editorHost.queries.resolveLogisticsDraftState();
    const beforeCells = beforeDraft?.cells.map((cell) => ({
      gridPoint: cell.gridPoint,
      shape: cell.shape,
      rotation: cell.rotation,
    }));
    const beforePreview = [...editorHost.state.collections.preview];

    appHost.gestureAdapter.handlePointerDown(touchEvent(72, otherStartPoint.x, otherStartPoint.y));
    appHost.gestureAdapter.handlePointerMove(touchEvent(72, otherEndPoint.x, otherEndPoint.y));
    appHost.gestureAdapter.handlePointerMove(touchEvent(
      72,
      otherContinuePoint.x,
      otherContinuePoint.y,
    ));
    // 插入 mouse move 触发 pending touch dragmove flush（mouse move 与 touch dragmove merge key 不同）
    appHost.gestureAdapter.handlePointerMove(pointerEvent({ clientX: 0, clientY: 0 }));

    const afterDraft = editorHost.queries.resolveLogisticsDraftState();
    expect(panSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(editorHost.state.collections.preview).toEqual(beforePreview);
    expect(afterDraft?.source).toEqual(beforeDraft?.source);
    expect(afterDraft?.cells.map((cell) => ({
      gridPoint: cell.gridPoint,
      shape: cell.shape,
      rotation: cell.rotation,
    }))).toEqual(beforeCells);
  });

  it("continues touch logistics drafts only when dragging from the logistics head", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    const appHost = createAppHost(workspace);
    const panSpy = vi.spyOn(editorHost.actions, "moveViewportByClientPixelVector");
    const startPoint = resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 0 });
    const headPoint = resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 2 });
    const nextHeadPoint = resolveClientPixelPointForGridCell(editorHost, { x: 1, y: 2 });
    const secondNextHeadPoint = resolveClientPixelPointForGridCell(editorHost, { x: 2, y: 2 });

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "placement-action-belt-draw",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    appHost.gestureAdapter.handlePointerDown(touchEvent(81, startPoint.x, startPoint.y));
    appHost.gestureAdapter.handlePointerMove(touchEvent(81, headPoint.x, headPoint.y));
    appHost.gestureAdapter.handlePointerUp(touchEvent(81, headPoint.x, headPoint.y));
    panSpy.mockClear();

    appHost.gestureAdapter.handlePointerDown(touchEvent(82, headPoint.x, headPoint.y));
    appHost.gestureAdapter.handlePointerMove(touchEvent(82, nextHeadPoint.x, nextHeadPoint.y));
    appHost.gestureAdapter.handlePointerMove(touchEvent(
      82,
      secondNextHeadPoint.x,
      secondNextHeadPoint.y,
    ));
    // 插入 mouse move 触发 pending touch dragmove flush
    appHost.gestureAdapter.handlePointerMove(pointerEvent({ clientX: 0, clientY: 0 }));

    const logisticsDraft = editorHost.queries.resolveLogisticsDraftState();
    expect(panSpy).not.toHaveBeenCalled();
    expect(logisticsDraft).toMatchObject({
      source: {
        type: "empty-cell",
        gridPoint: { x: 0, y: 0 },
      },
    });
    expect(logisticsDraft?.cells.at(-1)?.gridPoint).toEqual({ x: 2, y: 2 });
    expect(editorHost.state.collections[EntityCollectionType.logisticsHead]).toEqual([
      editorHost.state.collections.preview.at(-1),
    ]);
  });

  it("switches from logistics-placement to current logistics device placement on number shortcuts", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    const appHost = createAppHost(workspace);
    const expectedDeviceId = workspace.registry.entityDefinitions
      .filter((definition) => definition.uiGroup === "beltLogistics")
      .sort((left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id))[0]?.id;
    const anchorPoint = resolveClientPixelPointForGridCell(editorHost, { x: 3, y: 2 });

    appHost.gestureAdapter.handlePointerMove(pointerEvent({
      pointerId: 61,
      clientX: anchorPoint.x,
      clientY: anchorPoint.y,
      buttons: 0,
    }));
    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyE",
      key: "e",
      keyCode: 69,
    }));
    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "Digit1",
      key: "1",
      keyCode: 49,
    }));

    expect(expectedDeviceId).toBeDefined();
    expect(appHost.internalState.activeTool).toBe("single-placement");
    expect(appHost.internalState.runtime.logisticsPlacement.kind).toBeNull();
    expect(appHost.internalState.runtime.singlePlacementDeviceId).toBe(expectedDeviceId);
    expect(appHost.internalState.runtime.placementAnchor).toEqual({ x: 3, y: 2 });
    expect(editorHost.state.collections.preview).toHaveLength(1);
  });

  it("clears selected placement groups on active tool changes except select to placement", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    appHost.internalState.runtime.selectingPlacementGroup = "warehouse";
    appHost.internalActions.setActiveTool("single-placement");

    expect(appHost.internalState.runtime.selectingPlacementGroup).toBe("warehouse");

    appHost.internalActions.setActiveTool("select");

    expect(appHost.internalState.runtime.selectingPlacementGroup).toBeNull();

    appHost.internalState.runtime.selectingPlacementGroup = "warehouse";
    appHost.internalActions.setActiveTool("move");

    expect(appHost.internalState.runtime.selectingPlacementGroup).toBeNull();
  });

  it("zooms the editor viewport on pinch out and pinch in gestures", () => {
    vi.useFakeTimers();

    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const appHost = createAppHost(workspace);
    const zoomSpy = vi.spyOn(editorHost.actions, "zoom");

    appHost.gestureAdapter.handlePointerDown(touchEvent(1, 0, 0));
    vi.advanceTimersByTime(1000);
    appHost.gestureAdapter.handlePointerMove(touchEvent(1, 1, 0));
    appHost.gestureAdapter.handlePointerDown(touchEvent(2, 0, 10));
    appHost.gestureAdapter.handlePointerMove(touchEvent(2, 4, 16));

    expect(zoomSpy).toHaveBeenCalledTimes(1);
    expect(zoomSpy.mock.calls[0]?.[0]).toBeGreaterThan(0);
    expect(editorHost.state.viewport.gridSize).toBeGreaterThan(1);

    const zoomedOutGridSize = editorHost.state.viewport.gridSize;

    appHost.gestureAdapter.handlePointerMove(touchEvent(2, 0, 4));

    expect(zoomSpy).toHaveBeenCalledTimes(2);
    expect(zoomSpy.mock.calls[1]?.[0]).toBeLessThan(0);
    expect(editorHost.state.viewport.gridSize).toBeLessThan(zoomedOutGridSize);
  });

  it("requests viewport rotation from Ctrl+R, touch rotation and the rotate view button", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const appHost = createAppHost(workspace);
    const setViewportDisplayRotationSpy = vi.spyOn(editorHost.actions, "setViewportDisplayRotation");

    const keyboardConsumed = appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyR",
      key: "r",
      ctrlKey: true,
    }));

    expect(keyboardConsumed).toBe(true);
    expect(setViewportDisplayRotationSpy).toHaveBeenCalledWith(90);
    expect(editorHost.state.viewport.displayRotation).toBe(90);
    setViewportDisplayRotationSpy.mockClear();

    appHost.gestureAdapter.handlePointerDown(touchEvent(1, 0, 0));
    appHost.gestureAdapter.handlePointerDown(touchEvent(2, 10, 0));
    appHost.gestureAdapter.handlePointerMove(touchEvent(2, 0, 10));
    appHost.gestureAdapter.handlePointerUp(touchEvent(2, 0, 10));
    appHost.gestureAdapter.handlePointerUp(touchEvent(1, 0, 0));

    expect(setViewportDisplayRotationSpy).toHaveBeenCalledTimes(1);
    expect(setViewportDisplayRotationSpy).toHaveBeenLastCalledWith(180);
    expect(editorHost.state.viewport.displayRotation).toBe(180);
    setViewportDisplayRotationSpy.mockClear();

    appHost.gestureAdapter.handlePointerDown(touchEvent(1, 0, 0));
    appHost.gestureAdapter.handlePointerDown(touchEvent(2, 10, 0));
    appHost.gestureAdapter.handlePointerMove(touchEvent(2, 0, -10));
    appHost.gestureAdapter.handlePointerUp(touchEvent(2, 0, -10));
    appHost.gestureAdapter.handlePointerUp(touchEvent(1, 0, 0));

    expect(setViewportDisplayRotationSpy).toHaveBeenCalledTimes(1);
    expect(setViewportDisplayRotationSpy).toHaveBeenLastCalledWith(90);
    expect(editorHost.state.viewport.displayRotation).toBe(90);
    setViewportDisplayRotationSpy.mockClear();

    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: "canvas-bottom-left-secondary-toolbar-button-rotate-view",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(setViewportDisplayRotationSpy).toHaveBeenCalledTimes(1);
    expect(setViewportDisplayRotationSpy).toHaveBeenLastCalledWith(180);
    expect(editorHost.state.viewport.displayRotation).toBe(180);
  });

  it("does not pan the editor viewport when a pinch ends with one touch still down", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const appHost = createAppHost(workspace);
    const initialCenter = {
      ...editorHost.state.viewport.center,
    };

    appHost.gestureAdapter.handlePointerDown(touchEvent(1, 0, 0));
    appHost.gestureAdapter.handlePointerDown(touchEvent(2, 0, 10));
    appHost.gestureAdapter.handlePointerMove(touchEvent(2, 4, 16));

    expect(editorHost.state.viewport.center).toEqual(initialCenter);

    appHost.gestureAdapter.handlePointerUp(touchEvent(1, 0, 0));
    appHost.gestureAdapter.handlePointerMove(touchEvent(2, 7, 20));
    appHost.gestureAdapter.handlePointerUp(touchEvent(2, 7, 20));

    expect(editorHost.state.viewport.center).toEqual(initialCenter);
  });
});

function pointerEvent(
  overrides: Partial<GesturePointerEventLike> = {},
): GesturePointerEventLike {
  return {
    pointerId: 1,
    pointerType: "mouse",
    clientX: 0,
    clientY: 0,
    button: 0,
    buttons: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

function touchEvent(
  pointerId: number,
  clientX: number,
  clientY: number,
): GesturePointerEventLike {
  return pointerEvent({
    pointerId,
    pointerType: "touch",
    clientX,
    clientY,
    button: 0,
    buttons: 1,
  });
}

function keyEvent(
  overrides: Partial<GestureKeyboardEventLike>,
): GestureKeyboardEventLike {
  return {
    code: "",
    key: "",
    keyCode: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

function wheelEvent(
  overrides: Partial<GestureWheelEventLike>,
): GestureWheelEventLike {
  return {
    clientX: 20,
    clientY: 40,
    deltaY: 0,
    deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

function resolveClientPixelPointForGridCell(
  editorHost: ReturnType<typeof createEditorHost>,
  cell: {
    x: number;
    y: number;
  },
): {
  x: number;
  y: number;
} {
  const gridCellSize = editorHost.state.viewport.gridCellPixelSize;

  return {
    x:
      editorHost.state.viewport.clientRect.left
      +
      editorHost.state.viewport.clientRect.width / 2
      + (cell.x + 0.5 - editorHost.state.viewport.center.x) * gridCellSize,
    y:
      editorHost.state.viewport.clientRect.top
      +
      editorHost.state.viewport.clientRect.height / 2
      + (cell.y + 0.5 - editorHost.state.viewport.center.y) * gridCellSize,
  };
}

function createTestBlueprintRecord() {
  return {
    ...createBlueprintDocument({
      name: "测试蓝图",
      description: "蓝图放置测试",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 10, y: 10 },
      entities: {
        source: {
          id: "source",
          definitionId: "item_port_storager_1",
          position: { x: 9, y: 9 },
          rotation: 0,
          config: {},
          tags: [],
        },
        target: {
          id: "target",
          definitionId: "item_port_storager_1",
          position: { x: 12, y: 9 },
          rotation: 90,
          config: {},
          tags: [],
        },
      },
      entityOrder: ["source", "target"],
      slotLinks: [{
        id: "source-target-link",
        linkType: "share-all",
        source: {
          entityId: "source",
          storageSlotGroupId: "output",
          slotId: "output-slot",
        },
        target: {
          entityId: "target",
          storageSlotGroupId: "input",
          slotId: "input-slot",
        },
      }],
    }),
    parentFolderId: null,
  };
}
