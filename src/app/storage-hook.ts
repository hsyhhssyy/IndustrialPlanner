import { reaction } from "mobx";

import type { WorkbenchState } from "@/domain/state/types";
import { readFromLocalStorage, saveToLocalStorage } from "@/shared/storage";

import type { AppHost } from "./app-host";
import { clampLeftDockWidth } from "./state-impl";

export const WORKBENCH_STATE_LOCAL_STORAGE_KEY = "v3-workbench-state";

export function hookLocalstorage(appHost: AppHost): () => void {
  hydrateWorkbenchState(
    appHost,
    readFromLocalStorage<unknown>(WORKBENCH_STATE_LOCAL_STORAGE_KEY),
  );

  return reaction(
    () => getWorkbenchStateSnapshot(appHost),
    (workbenchState) => {
      saveToLocalStorage(WORKBENCH_STATE_LOCAL_STORAGE_KEY, workbenchState);
    },
  );
}

function hydrateWorkbenchState(appHost: AppHost, persistedState: unknown): void {
  if (!isRecord(persistedState)) {
    return;
  }

  if (typeof persistedState.leftDockOpen === "boolean") {
    appHost.internalState.workbench.leftDockOpen = persistedState.leftDockOpen;
  }

  if (typeof persistedState.rightDockOpen === "boolean") {
    appHost.internalState.workbench.rightDockOpen = persistedState.rightDockOpen;
  }

  if (typeof persistedState.leftDockWidth === "number" && Number.isFinite(persistedState.leftDockWidth)) {
    appHost.internalState.workbench.leftDockWidth = clampLeftDockWidth(persistedState.leftDockWidth);
  }

  if (typeof persistedState.topBarCollapsed === "boolean") {
    appHost.internalState.workbench.topBarCollapsed = persistedState.topBarCollapsed;
  }
}

function getWorkbenchStateSnapshot(appHost: AppHost): WorkbenchState {
  return {
    leftDockOpen: appHost.internalState.workbench.leftDockOpen,
    rightDockOpen: appHost.internalState.workbench.rightDockOpen,
    leftDockWidth: appHost.internalState.workbench.leftDockWidth,
    topBarCollapsed: appHost.internalState.workbench.topBarCollapsed,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}