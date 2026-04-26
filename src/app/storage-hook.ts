import { reaction } from "mobx";

import { readFromLocalStorage, saveToLocalStorage } from "@/shared/storage";

import type { AppHost } from "./app-host";
import { DEFAULT_WORKBENCH_KEYBINDINGS } from "./workbench-keybinding-policy";
import type {
  AppSettingsReadWrite,
  WorkbenchStateReadWrite,
} from "./state-impl";

export const APP_SETTINGS_LOCAL_STORAGE_KEY = "v4-app-settings";
export const WORKBENCH_STATE_LOCAL_STORAGE_KEY = "v4-workbench-state";

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
    appHost.internalState.workbench = persistedWorkbenchState;
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
    hypergryphConfirmShortcut: normalizePersistedShortcut(
      persistedAppSettings.hypergryphConfirmShortcut,
      fallback.hypergryphConfirmShortcut,
      DEFAULT_WORKBENCH_KEYBINDINGS.hypergryphConfirmShortcut,
    ),
    hypergryphCancelShortcut: normalizePersistedShortcut(
      persistedAppSettings.hypergryphCancelShortcut,
      fallback.hypergryphCancelShortcut,
      DEFAULT_WORKBENCH_KEYBINDINGS.hypergryphCancelShortcut,
    ),
    hypergryphRotateShortcut: normalizePersistedShortcut(
      persistedAppSettings.hypergryphRotateShortcut,
      fallback.hypergryphRotateShortcut,
      DEFAULT_WORKBENCH_KEYBINDINGS.hypergryphRotateShortcut,
    ),
  };
}

function normalizePersistedShortcut(
  value: unknown,
  fallback: string,
  defaultValue: string,
): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : defaultValue;
}
