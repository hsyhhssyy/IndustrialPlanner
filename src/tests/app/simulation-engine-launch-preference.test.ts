import { describe, expect, it } from "vitest";

import {
  captureSimulationEngineLaunchPreference,
  resolveDesiredDenseSimulationEngineSetting,
} from "@/app/shell/state/simulation-engine-launch-preference";
import { USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY } from "@/app/shell/state/settings-dialog-state";

describe("ST2-RQ-023 simulation engine launch preference", () => {
  it("requires both experimental switches to be explicitly enabled", () => {
    expect(resolveDesiredDenseSimulationEngineSetting({
      values: {
        "other-experimental-features": true,
        "experimental-dense-simulation-engine": true,
      },
    })).toBe(true);
    expect(resolveDesiredDenseSimulationEngineSetting({
      values: {
        "other-experimental-features": false,
        "experimental-dense-simulation-engine": true,
      },
    })).toBe(false);
    expect(resolveDesiredDenseSimulationEngineSetting({
      values: {
        "other-experimental-features": true,
        "experimental-dense-simulation-engine": false,
      },
    })).toBe(false);
  });

  it("fails safe to legacy for missing, malformed, or non-boolean values", () => {
    expect(resolveDesiredDenseSimulationEngineSetting(null)).toBe(false);
    expect(resolveDesiredDenseSimulationEngineSetting({ values: [] })).toBe(false);
    expect(resolveDesiredDenseSimulationEngineSetting({
      values: {
        "other-experimental-features": "true",
        "experimental-dense-simulation-engine": 1,
      },
    })).toBe(false);
  });

  it("freezes the active engine while tracking the current desired setting", () => {
    localStorage.setItem(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY, JSON.stringify({
      selectedGroupId: "experimental",
      values: {
        "other-experimental-features": false,
        "experimental-dense-simulation-engine": false,
      },
    }));
    const preference = captureSimulationEngineLaunchPreference();

    localStorage.setItem(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY, JSON.stringify({
      selectedGroupId: "experimental",
      values: {
        "other-experimental-features": true,
        "experimental-dense-simulation-engine": true,
      },
    }));

    expect(preference.activeDenseEnabled).toBe(false);
    expect(preference.desiredDenseEnabled).toBe(true);
    expect(preference.needsRestart).toBe(true);
  });
});
