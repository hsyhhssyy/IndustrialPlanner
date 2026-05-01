import { reaction } from "mobx";

import { readFromLocalStorage, saveToLocalStorage } from "@/shared/storage";

import type { AppHost } from "../host/app-host";
import type {
  AppSettingsReadWrite,
  DialogStateMapReadWrite,
  DialogStateReadWrite,
  WorkbenchStateReadWrite,
} from "./state-impl";
import {
  clampLeftDockWidth,
  createDefaultDialogStateForKey,
  DIALOG_KEYS,
  isRightDockTabId,
} from "./state-impl";

export const APP_SETTINGS_LOCAL_STORAGE_KEY = "v3-app-settings";
export const WORKBENCH_STATE_LOCAL_STORAGE_KEY = "v3-workbench-state";

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
    gameShowHotkeys: typeof persistedAppSettings.gameShowHotkeys === "boolean"
      ? persistedAppSettings.gameShowHotkeys
      : fallback.gameShowHotkeys,
    gameAlwaysShowGridLines: typeof persistedAppSettings.gameAlwaysShowGridLines === "boolean"
      ? persistedAppSettings.gameAlwaysShowGridLines
      : fallback.gameAlwaysShowGridLines,
    showGrassBackground: typeof persistedAppSettings.showGrassBackground === "boolean"
      ? persistedAppSettings.showGrassBackground
      : fallback.showGrassBackground,
    debugShowFps: typeof persistedAppSettings.debugShowFps === "boolean"
      ? persistedAppSettings.debugShowFps
      : fallback.debugShowFps,
    debugShowGestureDiagnosticsWindow:
      typeof persistedAppSettings.debugShowGestureDiagnosticsWindow === "boolean"
        ? persistedAppSettings.debugShowGestureDiagnosticsWindow
        : fallback.debugShowGestureDiagnosticsWindow,
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
  };
}

function normalizePersistedRightDockActiveTab(
  persistedWorkbenchState: Record<string, unknown>,
  fallback: WorkbenchStateReadWrite["rightDockActiveTab"],
): WorkbenchStateReadWrite["rightDockActiveTab"] {
  if (isRightDockTabId(persistedWorkbenchState.rightDockActiveTab)) {
    return persistedWorkbenchState.rightDockActiveTab;
  }

  if (persistedWorkbenchState.rightDockBaseExpanded === true) {
    return "base";
  }

  if (persistedWorkbenchState.rightDockPowerExpanded === true) {
    return "power";
  }

  if (persistedWorkbenchState.rightDockSelectionExpanded === true) {
    return "selection";
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
