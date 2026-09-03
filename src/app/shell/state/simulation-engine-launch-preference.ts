import { readFromLocalStorage } from "@/shared/storage";

import { USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY } from "./settings-dialog-state";

export const DENSE_SIMULATION_ENGINE_SETTING_ID = "experimental-dense-simulation-engine";
export const EXPERIMENTAL_FEATURES_SETTING_ID = "other-experimental-features";

export interface SimulationEngineLaunchPreference {
  readonly activeDenseEnabled: boolean;
  readonly desiredDenseEnabled: boolean;
  readonly needsRestart: boolean;
}

export function captureSimulationEngineLaunchPreference(): SimulationEngineLaunchPreference {
  const activeDenseEnabled = readDesiredDenseSimulationEngineSetting();
  return {
    activeDenseEnabled,
    get desiredDenseEnabled() {
      return readDesiredDenseSimulationEngineSetting();
    },
    get needsRestart() {
      return readDesiredDenseSimulationEngineSetting() !== activeDenseEnabled;
    },
  };
}

export function readDesiredDenseSimulationEngineSetting(): boolean {
  return resolveDesiredDenseSimulationEngineSetting(
    readFromLocalStorage<unknown>(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY),
  );
}

export function resolveDesiredDenseSimulationEngineSetting(persistedState: unknown): boolean {
  if (!isRecord(persistedState) || !isRecord(persistedState.values)) {
    return false;
  }

  return persistedState.values[EXPERIMENTAL_FEATURES_SETTING_ID] === true
    && persistedState.values[DENSE_SIMULATION_ENGINE_SETTING_ID] === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
