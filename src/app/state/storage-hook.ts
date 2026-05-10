import { reaction } from "mobx";

import { readFromLocalStorage, saveToLocalStorage } from "@/shared/storage";

import type { AppHost } from "../host/app-host";
import type {
  AppSettingsReadWrite,
  DialogStateMapReadWrite,
  DialogStateReadWrite,
  ModuleBalancingCanvasReadWrite,
  ModuleBalancingCustomModuleReadWrite,
  ModuleBalancingIOPortReadWrite,
  ModuleBalancingStageModuleEntryReadWrite,
  ModuleBalancingStageReadWrite,
  ModuleBalancingStateReadWrite,
  ToolboxStateReadWrite,
  ToolboxWikiStateReadWrite,
  WorkbenchStateReadWrite,
} from "./state-impl";
import {
  clampLeftDockWidth,
  createDefaultDialogStateForKey,
  createDefaultModuleBalancingState,
  createDefaultToolboxWikiOpenedPage,
  DIALOG_KEYS,
  isRightDockTabId,
  isToolboxWikiDesktopCategory,
  isToolboxWikiMobileFilterOption,
  TOOLBOX_WIKI_MOBILE_FILTER_OPTION_IDS,
} from "./state-impl";

export const APP_SETTINGS_LOCAL_STORAGE_KEY = "v3-app-settings";
export const WORKBENCH_STATE_LOCAL_STORAGE_KEY = "v4-workbench-state";

export function hookLocalstorage(appHost: AppHost): () => void {
  const persistedAppSettings = readFromLocalStorage<AppSettingsReadWrite>(
    APP_SETTINGS_LOCAL_STORAGE_KEY,
  );
  const persistedWorkbenchState = readFromLocalStorage<unknown>(
    WORKBENCH_STATE_LOCAL_STORAGE_KEY,
  );

  if (persistedAppSettings !== null) {
    Object.assign(
      appHost.internalState.settings,
      normalizePersistedAppSettings(persistedAppSettings, appHost.internalState.settings),
    );
  }

  if (persistedWorkbenchState !== null) {
    Object.assign(
      appHost.internalState.workbench,
      normalizePersistedWorkbenchState(
        persistedWorkbenchState,
        appHost.internalState.workbench,
      ),
    );
  }

  const disposeWorkbenchReaction = reaction(
    () => JSON.stringify(appHost.internalState.workbench),
    () => {
      saveToLocalStorage<WorkbenchStateReadWrite>(
        WORKBENCH_STATE_LOCAL_STORAGE_KEY,
        appHost.internalState.workbench,
      );
    },
  );
  const disposeAppSettingsReaction = reaction(
    () => JSON.stringify(appHost.internalState.settings),
    () => {
      saveToLocalStorage<AppSettingsReadWrite>(
        APP_SETTINGS_LOCAL_STORAGE_KEY,
        appHost.internalState.settings,
      );
    },
  );

  return () => {
    disposeWorkbenchReaction();
    disposeAppSettingsReaction();
  };
}

function normalizePersistedAppSettings(
  persistedAppSettings: AppSettingsReadWrite,
  fallback: AppSettingsReadWrite,
): AppSettingsReadWrite {
  const gameUseSimplifiedDeviceIcons =
    typeof persistedAppSettings.gameUseSimplifiedDeviceIcons === "boolean"
      ? persistedAppSettings.gameUseSimplifiedDeviceIcons
      : fallback.gameUseSimplifiedDeviceIcons;
  const gameShowDeviceNames = typeof persistedAppSettings.gameShowDeviceNames === "boolean"
    ? persistedAppSettings.gameShowDeviceNames
    : fallback.gameShowDeviceNames;
  const gameShowDeviceIcons = gameUseSimplifiedDeviceIcons
    ? true
    : typeof persistedAppSettings.gameShowDeviceIcons === "boolean"
      ? persistedAppSettings.gameShowDeviceIcons
      : fallback.gameShowDeviceIcons;

  return {
    locale: persistedAppSettings.locale === "zh-CN" || persistedAppSettings.locale === "en-US"
      ? persistedAppSettings.locale
      : fallback.locale,
    themeId: persistedAppSettings.themeId === "ayu-light" || persistedAppSettings.themeId === "ayu-dark"
      ? persistedAppSettings.themeId
      : fallback.themeId,
    hypergryphOperationMode: typeof persistedAppSettings.hypergryphOperationMode === "boolean"
      ? persistedAppSettings.hypergryphOperationMode
      : fallback.hypergryphOperationMode,
    hypergryphImmediateMove: typeof persistedAppSettings.hypergryphImmediateMove === "boolean"
      ? persistedAppSettings.hypergryphImmediateMove
      : fallback.hypergryphImmediateMove,
    hypergryphImmediateMarquee: typeof persistedAppSettings.hypergryphImmediateMarquee === "boolean"
      ? persistedAppSettings.hypergryphImmediateMarquee
      : fallback.hypergryphImmediateMarquee,
    hypergryphSelectionRightDockSync:
      typeof persistedAppSettings.hypergryphSelectionRightDockSync === "boolean"
        ? persistedAppSettings.hypergryphSelectionRightDockSync
        : fallback.hypergryphSelectionRightDockSync,
    hypergryphInspectorOpenOnSecondClick:
      typeof persistedAppSettings.hypergryphInspectorOpenOnSecondClick === "boolean"
        ? persistedAppSettings.hypergryphInspectorOpenOnSecondClick
        : fallback.hypergryphInspectorOpenOnSecondClick,
    gameUseSimplifiedDeviceIcons,
    gameShowDeviceNames,
    gameShowDeviceIcons,
    gameUseInspectorPanel: typeof persistedAppSettings.gameUseInspectorPanel === "boolean"
      ? persistedAppSettings.gameUseInspectorPanel
      : fallback.gameUseInspectorPanel,
    gameShowHotkeys: typeof persistedAppSettings.gameShowHotkeys === "boolean"
      ? persistedAppSettings.gameShowHotkeys
      : fallback.gameShowHotkeys,
    gameAlwaysShowGridLines: gameUseSimplifiedDeviceIcons
      ? true
      : typeof persistedAppSettings.gameAlwaysShowGridLines === "boolean"
        ? persistedAppSettings.gameAlwaysShowGridLines
        : fallback.gameAlwaysShowGridLines,
    showGrassBackground: gameUseSimplifiedDeviceIcons
      ? false
      : typeof persistedAppSettings.showGrassBackground === "boolean"
        ? persistedAppSettings.showGrassBackground
        : fallback.showGrassBackground,
    debugShowFps: typeof persistedAppSettings.debugShowFps === "boolean"
      ? persistedAppSettings.debugShowFps
      : fallback.debugShowFps,
    debugShowGestureDiagnosticsWindow:
      typeof persistedAppSettings.debugShowGestureDiagnosticsWindow === "boolean"
        ? persistedAppSettings.debugShowGestureDiagnosticsWindow
        : fallback.debugShowGestureDiagnosticsWindow,
    debugMode: typeof persistedAppSettings.debugMode === "boolean"
      ? persistedAppSettings.debugMode
      : fallback.debugMode,
  };
}

function normalizePersistedWorkbenchState(
  persistedWorkbenchState: unknown,
  fallback: WorkbenchStateReadWrite,
): WorkbenchStateReadWrite {
  if (!isRecord(persistedWorkbenchState)) {
    return fallback;
  }

  return {
    leftDockOpen: typeof persistedWorkbenchState.leftDockOpen === "boolean"
      ? persistedWorkbenchState.leftDockOpen
      : fallback.leftDockOpen,
    rightDockOpen: typeof persistedWorkbenchState.rightDockOpen === "boolean"
      ? persistedWorkbenchState.rightDockOpen
      : fallback.rightDockOpen,
    leftDockWidth:
      typeof persistedWorkbenchState.leftDockWidth === "number"
      && Number.isFinite(persistedWorkbenchState.leftDockWidth)
        ? clampLeftDockWidth(persistedWorkbenchState.leftDockWidth)
        : fallback.leftDockWidth,
    topBarCollapsed: typeof persistedWorkbenchState.topBarCollapsed === "boolean"
      ? persistedWorkbenchState.topBarCollapsed
      : fallback.topBarCollapsed,
    rightDockActiveTab: normalizePersistedRightDockActiveTab(
      persistedWorkbenchState,
      fallback.rightDockActiveTab,
    ),
    dialogState: normalizePersistedDialogStateMap(persistedWorkbenchState, fallback.dialogState),
    toolbox: normalizePersistedToolboxState(persistedWorkbenchState, fallback.toolbox),
  };
}

function normalizePersistedToolboxState(
  persistedWorkbenchState: Record<string, unknown>,
  fallback: ToolboxStateReadWrite,
): ToolboxStateReadWrite {
  const persistedToolboxState = isRecord(persistedWorkbenchState.toolbox)
    ? persistedWorkbenchState.toolbox
    : {};

  return {
    wiki: normalizePersistedToolboxWikiState(persistedToolboxState.wiki, fallback.wiki),
    moduleBalancing: normalizePersistedModuleBalancingState(
      persistedToolboxState.moduleBalancing,
      fallback.moduleBalancing,
    ),
  };
}

function normalizePersistedModuleBalancingState(
  persistedModuleBalancingState: unknown,
  fallback: ModuleBalancingStateReadWrite,
): ModuleBalancingStateReadWrite {
  const fallbackClone = cloneModuleBalancingState(fallback);

  if (!isRecord(persistedModuleBalancingState)) {
    return fallbackClone;
  }

  const customModules = normalizePersistedCustomModules(
    persistedModuleBalancingState.customModules,
  );
  const canvases = normalizePersistedModuleBalancingCanvases(
    persistedModuleBalancingState.canvases,
  );
  const safeCanvases = canvases.length > 0 ? canvases : fallbackClone.canvases;
  const activeCanvasId = typeof persistedModuleBalancingState.activeCanvasId === "string"
    && safeCanvases.some((canvas) => canvas.id === persistedModuleBalancingState.activeCanvasId)
    ? persistedModuleBalancingState.activeCanvasId
    : safeCanvases[0]?.id ?? null;

  return {
    canvases: safeCanvases,
    customModules,
    activeCanvasId,
  };
}

function cloneModuleBalancingState(
  fallback: ModuleBalancingStateReadWrite,
): ModuleBalancingStateReadWrite {
  const defaultState = createDefaultModuleBalancingState();
  const canvases = fallback.canvases.length > 0
    ? fallback.canvases.map(cloneModuleBalancingCanvas)
    : defaultState.canvases.map(cloneModuleBalancingCanvas);
  const activeCanvasId = fallback.activeCanvasId !== null
    && canvases.some((canvas) => canvas.id === fallback.activeCanvasId)
    ? fallback.activeCanvasId
    : canvases[0]?.id ?? null;

  return {
    canvases,
    customModules: fallback.customModules.map(cloneCustomModule),
    activeCanvasId,
  };
}

function cloneModuleBalancingCanvas(
  canvas: ModuleBalancingCanvasReadWrite,
): ModuleBalancingCanvasReadWrite {
  return {
    id: canvas.id,
    name: canvas.name,
    globalInputs: canvas.globalInputs.map(cloneIOPort),
    stages: canvas.stages.map(cloneStage),
    warehouseCapacity: canvas.warehouseCapacity,
  };
}

function cloneStage(stage: ModuleBalancingStageReadWrite): ModuleBalancingStageReadWrite {
  return {
    id: stage.id,
    name: stage.name,
    entries: stage.entries.map((entry) => ({ ...entry })),
  };
}

function cloneCustomModule(
  customModule: ModuleBalancingCustomModuleReadWrite,
): ModuleBalancingCustomModuleReadWrite {
  return {
    id: customModule.id,
    name: customModule.name,
    color: customModule.color,
    iconId: customModule.iconId,
    inputs: customModule.inputs.map(cloneIOPort),
    outputs: customModule.outputs.map(cloneIOPort),
    sourceType: "custom",
  };
}

function cloneIOPort(port: ModuleBalancingIOPortReadWrite): ModuleBalancingIOPortReadWrite {
  return {
    itemId: port.itemId,
    perMinute: port.perMinute,
  };
}

function normalizePersistedModuleBalancingCanvases(
  persistedCanvases: unknown,
): ModuleBalancingCanvasReadWrite[] {
  if (!Array.isArray(persistedCanvases)) {
    return [];
  }

  const seenCanvasIds = new Set<string>();
  return persistedCanvases.flatMap((canvas) => {
    if (!isRecord(canvas)) {
      return [];
    }

    const id = normalizeNonEmptyString(canvas.id);
    if (id === null || seenCanvasIds.has(id)) {
      return [];
    }
    seenCanvasIds.add(id);

    return [{
      id,
      name: normalizeNonEmptyString(canvas.name) ?? "未命名画布",
      globalInputs: normalizePersistedIOPorts(canvas.globalInputs),
      stages: normalizePersistedStages(canvas.stages),
      warehouseCapacity: normalizePositiveNumberOrNull(canvas.warehouseCapacity, null),
    }];
  });
}

function normalizePersistedStages(persistedStages: unknown): ModuleBalancingStageReadWrite[] {
  if (!Array.isArray(persistedStages)) {
    return [];
  }

  const seenStageIds = new Set<string>();
  return persistedStages.flatMap((stage) => {
    if (!isRecord(stage)) {
      return [];
    }

    const id = normalizeNonEmptyString(stage.id);
    if (id === null || seenStageIds.has(id)) {
      return [];
    }
    seenStageIds.add(id);

    return [{
      id,
      name: normalizeNonEmptyString(stage.name) ?? "Stage",
      entries: normalizePersistedStageEntries(stage.entries),
    }];
  });
}

function normalizePersistedStageEntries(
  persistedEntries: unknown,
): ModuleBalancingStageModuleEntryReadWrite[] {
  if (!Array.isArray(persistedEntries)) {
    return [];
  }

  return persistedEntries.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const moduleId = normalizeNonEmptyString(entry.moduleId);
    const quantity = normalizePositiveNumber(entry.quantity);
    if (moduleId === null || quantity === null) {
      return [];
    }

    return [{
      moduleId,
      quantity: roundToTwoDecimals(quantity),
    }];
  });
}

function normalizePersistedCustomModules(
  persistedCustomModules: unknown,
): ModuleBalancingCustomModuleReadWrite[] {
  if (!Array.isArray(persistedCustomModules)) {
    return [];
  }

  const seenModuleIds = new Set<string>();
  return persistedCustomModules.flatMap((customModule) => {
    if (!isRecord(customModule) || customModule.sourceType !== "custom") {
      return [];
    }

    const id = normalizeNonEmptyString(customModule.id);
    const name = normalizeNonEmptyString(customModule.name);
    const iconId = normalizeNonEmptyString(customModule.iconId);
    if (id === null || name === null || iconId === null || seenModuleIds.has(id)) {
      return [];
    }
    seenModuleIds.add(id);

    const outputs = normalizePersistedIOPorts(customModule.outputs);
    if (outputs.length === 0) {
      return [];
    }

    return [{
      id,
      name,
      color: normalizeCssColor(customModule.color),
      iconId,
      inputs: normalizePersistedIOPorts(customModule.inputs),
      outputs,
      sourceType: "custom",
    }];
  });
}

function normalizePersistedIOPorts(persistedPorts: unknown): ModuleBalancingIOPortReadWrite[] {
  if (!Array.isArray(persistedPorts)) {
    return [];
  }

  return persistedPorts.flatMap((port) => {
    if (!isRecord(port)) {
      return [];
    }

    const itemId = normalizeNonEmptyString(port.itemId);
    const perMinute = normalizePositiveNumber(port.perMinute);
    if (itemId === null || perMinute === null) {
      return [];
    }

    return [{
      itemId,
      perMinute: roundToTwoDecimals(perMinute),
    }];
  });
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeCssColor(value: unknown): string {
  if (typeof value !== "string") {
    return "#4f8cff";
  }

  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#4f8cff";
}

function normalizePersistedToolboxWikiState(
  persistedWikiState: unknown,
  fallback: ToolboxWikiStateReadWrite,
): ToolboxWikiStateReadWrite {
  const fallbackClone = cloneToolboxWikiState(fallback);

  if (!isRecord(persistedWikiState)) {
    return fallbackClone;
  }

  const rawOpenedPage = normalizePersistedToolboxWikiOpenedPage(
    persistedWikiState.openedPage,
    fallbackClone.openedPage,
  );
  const rawNavigationStack = normalizePersistedToolboxWikiNavigationStack(
    persistedWikiState.navigationStack,
  );
  const navigationStack = rawOpenedPage.kind === "browser"
    ? []
    : rawNavigationStack.length > 0
      ? rawNavigationStack
      : [{ type: rawOpenedPage.kind, id: rawOpenedPage.id }];
  const lastNavigationEntry = navigationStack[navigationStack.length - 1] ?? null;

  return {
    searchQuery: typeof persistedWikiState.searchQuery === "string"
      ? persistedWikiState.searchQuery
      : fallbackClone.searchQuery,
    desktopCategory: isToolboxWikiDesktopCategory(persistedWikiState.desktopCategory)
      ? persistedWikiState.desktopCategory
      : fallbackClone.desktopCategory,
    mobileSelectedCategories: normalizePersistedToolboxWikiMobileSelectedCategories(
      persistedWikiState.mobileSelectedCategories,
      fallbackClone.mobileSelectedCategories,
    ),
    navigationStack,
    openedPage: lastNavigationEntry === null
      ? createDefaultToolboxWikiOpenedPage()
      : { kind: lastNavigationEntry.type, id: lastNavigationEntry.id },
  };
}

function cloneToolboxWikiState(fallback: ToolboxWikiStateReadWrite): ToolboxWikiStateReadWrite {
  return {
    searchQuery: fallback.searchQuery,
    desktopCategory: fallback.desktopCategory,
    mobileSelectedCategories: [...fallback.mobileSelectedCategories],
    navigationStack: fallback.navigationStack.map((entry) => ({ ...entry })),
    openedPage: fallback.openedPage.kind === "browser"
      ? { kind: "browser" }
      : { ...fallback.openedPage },
  };
}

function normalizePersistedToolboxWikiOpenedPage(
  persistedOpenedPage: unknown,
  fallback: ToolboxWikiStateReadWrite["openedPage"],
): ToolboxWikiStateReadWrite["openedPage"] {
  if (!isRecord(persistedOpenedPage)) {
    return fallback.kind === "browser" ? { kind: "browser" } : { ...fallback };
  }

  if (persistedOpenedPage.kind === "browser") {
    return { kind: "browser" };
  }

  if (
    (persistedOpenedPage.kind === "item" || persistedOpenedPage.kind === "entity")
    && typeof persistedOpenedPage.id === "string"
    && persistedOpenedPage.id.length > 0
  ) {
    return { kind: persistedOpenedPage.kind, id: persistedOpenedPage.id };
  }

  return fallback.kind === "browser" ? { kind: "browser" } : { ...fallback };
}

function normalizePersistedToolboxWikiNavigationStack(
  persistedNavigationStack: unknown,
): ToolboxWikiStateReadWrite["navigationStack"] {
  if (!Array.isArray(persistedNavigationStack)) {
    return [];
  }

  return persistedNavigationStack.flatMap((entry) => {
    if (
      isRecord(entry)
      && (entry.type === "item" || entry.type === "entity")
      && typeof entry.id === "string"
      && entry.id.length > 0
    ) {
      return [{ type: entry.type, id: entry.id }];
    }

    return [];
  });
}

function normalizePersistedToolboxWikiMobileSelectedCategories(
  persistedSelectedCategories: unknown,
  fallback: ToolboxWikiStateReadWrite["mobileSelectedCategories"],
): ToolboxWikiStateReadWrite["mobileSelectedCategories"] {
  if (!Array.isArray(persistedSelectedCategories)) {
    return [...fallback];
  }

  const selectedOptions = new Set<ToolboxWikiStateReadWrite["mobileSelectedCategories"][number]>();
  for (const option of persistedSelectedCategories) {
    if (isToolboxWikiMobileFilterOption(option)) {
      selectedOptions.add(option);
    }
  }

  return TOOLBOX_WIKI_MOBILE_FILTER_OPTION_IDS.filter((option) => selectedOptions.has(option));
}

function normalizePersistedRightDockActiveTab(
  persistedWorkbenchState: Record<string, unknown>,
  fallback: WorkbenchStateReadWrite["rightDockActiveTab"],
): WorkbenchStateReadWrite["rightDockActiveTab"] {
  if (isRightDockTabId(persistedWorkbenchState.rightDockActiveTab)) {
    return persistedWorkbenchState.rightDockActiveTab;
  }

  return fallback;
}

function normalizePersistedDialogStateMap(
  persistedWorkbenchState: Record<string, unknown>,
  fallback: DialogStateMapReadWrite,
): DialogStateMapReadWrite {
  const persistedDialogStateMap = isRecord(persistedWorkbenchState.dialogState)
    ? persistedWorkbenchState.dialogState
    : {};
  const nextDialogState: DialogStateMapReadWrite = {
    toolbox: normalizePersistedDialogState(
      "toolbox",
      persistedDialogStateMap.toolbox,
      fallback.toolbox,
    ),
    help: normalizePersistedDialogState(
      "help",
      persistedDialogStateMap.help,
      fallback.help,
    ),
    settings: normalizePersistedDialogState(
      "settings",
      persistedDialogStateMap.settings,
      fallback.settings,
    ),
    "debug-log": persistedDialogStateMap["debug-log"] !== undefined || fallback["debug-log"] !== undefined
      ? normalizePersistedDialogState(
        "debug-log",
        persistedDialogStateMap["debug-log"],
        fallback["debug-log"] ?? createDefaultDialogStateForKey("debug-log"),
      )
      : undefined,
    inspector: normalizePersistedDialogState(
      "inspector",
      persistedDialogStateMap.inspector,
      fallback.inspector,
    ),
    "save-blueprint": normalizePersistedDialogState(
      "save-blueprint",
      persistedDialogStateMap["save-blueprint"],
      fallback["save-blueprint"],
    ),
    "base-select": normalizePersistedDialogState(
      "base-select",
      persistedDialogStateMap["base-select"],
      fallback["base-select"],
    ),
  };

  for (const [dialogKey, persistedDialogState] of Object.entries(persistedDialogStateMap)) {
    if (DIALOG_KEYS.includes(dialogKey as typeof DIALOG_KEYS[number])) {
      continue;
    }

    nextDialogState[dialogKey] = normalizePersistedDialogState(
      dialogKey,
      persistedDialogState,
      fallback[dialogKey] ?? createDefaultDialogStateForKey(dialogKey),
    );
  }

  return nextDialogState;
}

function normalizePersistedDialogState(
  dialogKey: string,
  persistedDialogState: unknown,
  fallback: DialogStateReadWrite,
): DialogStateReadWrite {
  const defaultDialogState = createDefaultDialogStateForKey(dialogKey);
  const baseDialogState = {
    ...defaultDialogState,
    ...fallback,
  };

  if (!isRecord(persistedDialogState)) {
    return baseDialogState;
  }

  return {
    visible: typeof persistedDialogState.visible === "boolean"
      ? persistedDialogState.visible
      : baseDialogState.visible,
    maximized: typeof persistedDialogState.maximized === "boolean"
      ? persistedDialogState.maximized
      : baseDialogState.maximized,
    offsetX: normalizeFiniteNumber(persistedDialogState.offsetX, baseDialogState.offsetX),
    offsetY: normalizeFiniteNumber(persistedDialogState.offsetY, baseDialogState.offsetY),
    width: normalizePositiveNumberOrNull(persistedDialogState.width, baseDialogState.width),
    height: normalizePositiveNumberOrNull(persistedDialogState.height, baseDialogState.height),
    activeTab: typeof persistedDialogState.activeTab === "string"
      ? persistedDialogState.activeTab
      : baseDialogState.activeTab,
  };
}

function normalizeFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : fallback;
}

function normalizePositiveNumberOrNull(value: unknown, fallback: number | null): number | null {
  if (value === null) {
    return null;
  }

  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
