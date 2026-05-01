import { reaction } from "mobx";

import { readFromLocalStorage, saveToLocalStorage } from "@/shared/storage";

import type { AppHost } from "../host/app-host";
import type {
  AppSettingsReadWrite,
  WorkbenchStateReadWrite,
} from "./state-impl";
import { clampLeftDockWidth } from "./state-impl";

export const APP_SETTINGS_LOCAL_STORAGE_KEY = "v3-app-settings";
export const WORKBENCH_STATE_LOCAL_STORAGE_KEY = "v3-workbench-state";

export function hookLocalstorage(appHost: AppHost): () => void {
  const persistedAppSettings = readFromLocalStorage<AppSettingsReadWrite>(
    APP_SETTINGS_LOCAL_STORAGE_KEY,
  );
  const persistedWorkbenchState = readFromLocalStorage<WorkbenchStateReadWrite>(
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
  persistedWorkbenchState: WorkbenchStateReadWrite,
  fallback: WorkbenchStateReadWrite,
): WorkbenchStateReadWrite {
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
    rightDockBaseExpanded: typeof persistedWorkbenchState.rightDockBaseExpanded === "boolean"
      ? persistedWorkbenchState.rightDockBaseExpanded
      : fallback.rightDockBaseExpanded,
    rightDockPowerExpanded: typeof persistedWorkbenchState.rightDockPowerExpanded === "boolean"
      ? persistedWorkbenchState.rightDockPowerExpanded
      : fallback.rightDockPowerExpanded,
    rightDockSelectionExpanded:
      typeof persistedWorkbenchState.rightDockSelectionExpanded === "boolean"
        ? persistedWorkbenchState.rightDockSelectionExpanded
        : fallback.rightDockSelectionExpanded,
    helpDialogMaximized: typeof persistedWorkbenchState.helpDialogMaximized === "boolean"
      ? persistedWorkbenchState.helpDialogMaximized
      : fallback.helpDialogMaximized,
  };
}
