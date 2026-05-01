// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY,
  WorkbenchSettingsDialogController,
} from "@/app/shell/settings-dialog-state";

describe("WorkbenchSettingsDialogController", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("persists schema-driven values and hydrates them on the next controller", () => {
    const controller = new WorkbenchSettingsDialogController();

    controller.selectGroup("shortcuts");
    controller.updateSelectValue("system-language", "en-US");
    controller.updateSelectValue("system-theme", "ayu-dark");
    controller.updateSelectValue("display-frame-rate-limit", "30");
    controller.updateSwitchValue("game-use-simplified-device-icons", true);
    controller.updateSwitchValue("other-debug-mode", true);
    controller.updateSwitchValue("debug-show-fps", true);
    controller.updateSwitchValue("debug-show-gesture-diagnostics-window", true);

    expect(JSON.parse(localStorage.getItem(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY) ?? "null")).toEqual({
      selectedGroupId: "shortcuts",
      values: {
        "system-language": "en-US",
        "system-theme": "ayu-dark",
        "display-frame-rate-limit": "30",
        "game-arknights-operation-mode": true,
        "game-arknights-immediate-move": true,
        "game-arknights-immediate-marquee": false,
        "shortcut-place-conveyor": "E",
        "shortcut-place-pipe": "Q",
        "shortcut-resources-power": "G",
        "shortcut-warehouse": "C",
        "shortcut-basic-production": "V",
        "shortcut-synthesis": "B",
        "game-show-hotkeys": true,
        "game-always-show-grid-lines": true,
        "game-show-grass-background": false,
        "game-use-simplified-device-icons": true,
        "other-debug-mode": true,
        "debug-show-fps": true,
        "debug-show-gesture-diagnostics-window": true,
      },
    });

    const hydratedController = new WorkbenchSettingsDialogController();

  expect(hydratedController.selectedGroupId).toBe("shortcuts");
    expect(hydratedController.values["system-language"]).toBe("en-US");
    expect(hydratedController.values["system-theme"]).toBe("ayu-dark");
    expect(hydratedController.values["display-frame-rate-limit"]).toBe("30");
    expect(hydratedController.values["game-arknights-operation-mode"]).toBe(true);
    expect(hydratedController.values["game-arknights-immediate-move"]).toBe(true);
    expect(hydratedController.values["game-arknights-immediate-marquee"]).toBe(false);
    expect(hydratedController.values["shortcut-place-conveyor"]).toBe("E");
    expect(hydratedController.values["shortcut-place-pipe"]).toBe("Q");
    expect(hydratedController.values["shortcut-resources-power"]).toBe("G");
    expect(hydratedController.values["shortcut-warehouse"]).toBe("C");
    expect(hydratedController.values["shortcut-basic-production"]).toBe("V");
    expect(hydratedController.values["shortcut-synthesis"]).toBe("B");
    expect(hydratedController.values["game-always-show-grid-lines"]).toBe(true);
    expect(hydratedController.values["game-show-grass-background"]).toBe(false);
    expect(hydratedController.values["game-use-simplified-device-icons"]).toBe(true);
    expect(hydratedController.values["other-debug-mode"]).toBe(true);
    expect(hydratedController.values["debug-show-fps"]).toBe(true);
    expect(hydratedController.values["debug-show-gesture-diagnostics-window"]).toBe(true);
  });

  it("only updates conditional keybinding settings while their prerequisite matches", () => {
    let hypergryphOperationMode = false;
    const controller = new WorkbenchSettingsDialogController({
      externalBindings: {
        "game-arknights-operation-mode": {
          readValue: () => hypergryphOperationMode,
          writeValue: (value) => {
            if (typeof value === "boolean") {
              hypergryphOperationMode = value;
            }
          },
        },
      },
    });

    expect(controller.isSettingEditable("shortcut-place-conveyor")).toBe(true);

    controller.updateKeybindingValue("shortcut-place-conveyor", "P");

    expect(controller.values["shortcut-place-conveyor"]).toBe("P");

    hypergryphOperationMode = true;

    expect(controller.isSettingEditable("shortcut-place-conveyor")).toBe(false);

    controller.updateKeybindingValue("shortcut-place-conveyor", "Z");

    expect(controller.values["shortcut-place-conveyor"]).toBe("P");
  });

  it("treats permanently disabled settings as read-only", () => {
    const controller = new WorkbenchSettingsDialogController();

    expect(controller.isSettingEditable("game-arknights-operation-mode")).toBe(false);
    expect(controller.getValue("game-arknights-operation-mode")).toBe(true);

    controller.updateSwitchValue("game-arknights-operation-mode", false);

    expect(controller.getValue("game-arknights-operation-mode")).toBe(true);
  });

  it("uses external bindings as the source of truth for connected settings", () => {
    let locale = "zh-CN";
    let themeId = "ayu-light";
    let hypergryphOperationMode = false;
    const controller = new WorkbenchSettingsDialogController({
      externalBindings: {
        "system-language": {
          readValue: () => locale,
          writeValue: (value) => {
            if (value === "zh-CN" || value === "en-US") {
              locale = value;
            }
          },
        },
        "system-theme": {
          readValue: () => themeId,
          writeValue: (value) => {
            if (value === "ayu-light" || value === "ayu-dark") {
              themeId = value;
            }
          },
        },
        "game-arknights-operation-mode": {
          readValue: () => hypergryphOperationMode,
          writeValue: (value) => {
            if (typeof value === "boolean") {
              hypergryphOperationMode = value;
            }
          },
        },
      },
    });

    controller.selectGroup("system");
    controller.updateSelectValue("system-language", "en-US");
    controller.updateSelectValue("system-theme", "ayu-dark");
    controller.updateSwitchValue("other-debug-mode", true);

    expect(locale).toBe("en-US");
    expect(themeId).toBe("ayu-dark");
    expect(hypergryphOperationMode).toBe(false);
    expect(controller.getValue("system-language")).toBe("en-US");
    expect(controller.getValue("system-theme")).toBe("ayu-dark");
    expect(controller.getValue("game-arknights-operation-mode")).toBe(false);
    expect(JSON.parse(localStorage.getItem(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY) ?? "null")).toEqual({
      selectedGroupId: "system",
      values: {
        "display-frame-rate-limit": "unlimited",
        "game-arknights-immediate-move": true,
        "game-arknights-immediate-marquee": false,
        "shortcut-place-conveyor": "E",
        "shortcut-place-pipe": "Q",
        "shortcut-resources-power": "G",
        "shortcut-warehouse": "C",
        "shortcut-basic-production": "V",
        "shortcut-synthesis": "B",
        "game-show-hotkeys": true,
        "game-always-show-grid-lines": true,
        "game-show-grass-background": false,
        "game-use-simplified-device-icons": false,
        "other-debug-mode": true,
        "debug-show-fps": false,
        "debug-show-gesture-diagnostics-window": false,
      },
    });
  });
});
