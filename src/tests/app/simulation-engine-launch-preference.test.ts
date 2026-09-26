import { describe, expect, it } from "vitest";

import {
  captureSimulationEngineLaunchPreference,
  resolveDesiredDenseSimulationEngineSetting,
} from "@/app/shell/state/simulation-engine-launch-preference";
import { APP_SETTINGS_LOCAL_STORAGE_KEY } from "@/app/state";
import { USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY } from "@/app/shell/state/settings-dialog-state";

describe("ST2-RQ-023 simulation engine launch preference", () => {
  it("uses legacy only when debug mode and the legacy switch are both enabled", () => {
    expect(resolveDesiredDenseSimulationEngineSetting({
      values: {
        "debug-legacy-simulation-engine": true,
      },
    }, { debugMode: true })).toBe(false);
    expect(resolveDesiredDenseSimulationEngineSetting({
      values: {
        "debug-legacy-simulation-engine": true,
      },
    }, { debugMode: false })).toBe(true);
    expect(resolveDesiredDenseSimulationEngineSetting({
      values: {
        "debug-legacy-simulation-engine": false,
      },
    }, { debugMode: true })).toBe(true);
  });

  it("defaults to dense for missing, malformed, old-key, or non-boolean values", () => {
    expect(resolveDesiredDenseSimulationEngineSetting(null, { debugMode: true })).toBe(true);
    expect(resolveDesiredDenseSimulationEngineSetting({ values: [] }, { debugMode: true })).toBe(true);
    expect(resolveDesiredDenseSimulationEngineSetting({
      values: {
        "debug-legacy-simulation-engine": 1,
      },
    }, { debugMode: true })).toBe(true);
    expect(resolveDesiredDenseSimulationEngineSetting({
      values: { "debug-legacy-simulation-engine": true },
    }, null)).toBe(true);
    expect(resolveDesiredDenseSimulationEngineSetting({
      values: {
        "other-experimental-features": true,
        "experimental-dense-simulation-engine": true,
      },
    }, { debugMode: true })).toBe(true);
  });

  it("freezes the active engine while tracking the current desired setting", () => {
    localStorage.setItem(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY, JSON.stringify({
      selectedGroupId: "debug",
      values: {
        "debug-legacy-simulation-engine": false,
      },
    }));
    localStorage.setItem(APP_SETTINGS_LOCAL_STORAGE_KEY, JSON.stringify({ debugMode: false }));
    const preference = captureSimulationEngineLaunchPreference();

    localStorage.setItem(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY, JSON.stringify({
      selectedGroupId: "debug",
      values: {
        "debug-legacy-simulation-engine": true,
      },
    }));
    localStorage.setItem(APP_SETTINGS_LOCAL_STORAGE_KEY, JSON.stringify({ debugMode: true }));

    expect(preference.activeDenseEnabled).toBe(true);
    expect(preference.desiredDenseEnabled).toBe(false);
    expect(preference.needsRestart).toBe(true);
  });

  it("returns to dense after debug mode is disabled without clearing the legacy switch", () => {
    localStorage.setItem(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY, JSON.stringify({
      values: {
        "debug-legacy-simulation-engine": true,
      },
    }));
    localStorage.setItem(APP_SETTINGS_LOCAL_STORAGE_KEY, JSON.stringify({ debugMode: true }));
    const preference = captureSimulationEngineLaunchPreference();

    localStorage.setItem(APP_SETTINGS_LOCAL_STORAGE_KEY, JSON.stringify({ debugMode: false }));

    expect(preference.activeDenseEnabled).toBe(false);
    expect(preference.desiredDenseEnabled).toBe(true);
    expect(preference.needsRestart).toBe(true);
  });
});
