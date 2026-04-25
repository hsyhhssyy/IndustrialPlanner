// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY,
  WorkbenchSettingsDialogController,
} from "@/app/app-shell/settings-dialog-state";

describe("WorkbenchSettingsDialogController", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("reuses the same open promise and resolves it on close", async () => {
    const controller = new WorkbenchSettingsDialogController();
    const firstOpen = controller.open();
    const secondOpen = controller.open();

    expect(firstOpen).toBe(secondOpen);
    expect(controller.isOpen).toBe(true);

    controller.close();

    await expect(firstOpen).resolves.toBeUndefined();
    expect(controller.isOpen).toBe(false);
  });

  it("persists schema-driven values and hydrates them on the next controller", () => {
    const controller = new WorkbenchSettingsDialogController();

    controller.selectGroup("shortcuts");
    controller.updateSelectValue("system-language", "en-US");
    controller.updateSelectValue("system-theme", "ayu-dark");
    controller.updateSelectValue("display-frame-rate-limit", "30");
    controller.updateSwitchValue("game-use-simplified-device-icons", true);
    controller.updateSwitchValue("other-debug-mode", true);

    expect(JSON.parse(localStorage.getItem(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY) ?? "null")).toEqual({
      selectedGroupId: "shortcuts",
      values: {
        "system-language": "en-US",
        "system-theme": "ayu-dark",
        "display-frame-rate-limit": "30",
        "game-arknights-operation-mode": true,
        "game-arknights-immediate-move": true,
        "game-arknights-immediate-marquee": false,
        "game-arknights-confirm-shortcut": "F",
        "game-arknights-cancel-shortcut": "G",
        "game-arknights-rotate-shortcut": "R",
        "game-use-simplified-device-icons": true,
        "other-debug-mode": true,
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
    expect(hydratedController.values["game-arknights-confirm-shortcut"]).toBe("F");
    expect(hydratedController.values["game-arknights-cancel-shortcut"]).toBe("G");
    expect(hydratedController.values["game-arknights-rotate-shortcut"]).toBe("R");
    expect(hydratedController.values["game-use-simplified-device-icons"]).toBe(true);
    expect(hydratedController.values["other-debug-mode"]).toBe(true);
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

    expect(controller.isSettingEditable("game-arknights-confirm-shortcut")).toBe(true);

    controller.updateKeybindingValue("game-arknights-confirm-shortcut", "P");

    expect(controller.values["game-arknights-confirm-shortcut"]).toBe("P");

    hypergryphOperationMode = true;

    expect(controller.isSettingEditable("game-arknights-confirm-shortcut")).toBe(false);

    controller.updateKeybindingValue("game-arknights-confirm-shortcut", "Z");

    expect(controller.values["game-arknights-confirm-shortcut"]).toBe("P");
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
        "game-arknights-confirm-shortcut": "F",
        "game-arknights-cancel-shortcut": "G",
        "game-arknights-rotate-shortcut": "R",
        "game-use-simplified-device-icons": false,
        "other-debug-mode": true,
      },
    });
  });
});