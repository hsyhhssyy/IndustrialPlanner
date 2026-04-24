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

    controller.selectGroup("game");
    controller.updateSelectValue("system-language", "en-US");
    controller.updateSelectValue("system-theme", "follow-system");
    controller.updateSelectValue("display-frame-rate-limit", "30");
    controller.updateSwitchValue("game-arknights-operation-mode", true);
    controller.updateSwitchValue("game-use-simplified-device-icons", true);
    controller.updateSwitchValue("other-debug-mode", true);

    expect(JSON.parse(localStorage.getItem(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY) ?? "null")).toEqual({
      selectedGroupId: "game",
      values: {
        "system-language": "en-US",
        "system-theme": "follow-system",
        "display-frame-rate-limit": "30",
        "game-arknights-operation-mode": true,
        "game-use-simplified-device-icons": true,
        "other-debug-mode": true,
      },
    });

    const hydratedController = new WorkbenchSettingsDialogController();

    expect(hydratedController.selectedGroupId).toBe("game");
    expect(hydratedController.values["system-language"]).toBe("en-US");
    expect(hydratedController.values["system-theme"]).toBe("follow-system");
    expect(hydratedController.values["display-frame-rate-limit"]).toBe("30");
    expect(hydratedController.values["game-arknights-operation-mode"]).toBe(true);
    expect(hydratedController.values["game-use-simplified-device-icons"]).toBe(true);
    expect(hydratedController.values["other-debug-mode"]).toBe(true);
  });

  it("uses external bindings as the source of truth for connected settings", () => {
    let locale = "zh-CN";
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
      },
    });

    controller.selectGroup("system");
    controller.updateSelectValue("system-language", "en-US");
    controller.updateSwitchValue("other-debug-mode", true);

    expect(locale).toBe("en-US");
    expect(controller.getValue("system-language")).toBe("en-US");
    expect(JSON.parse(localStorage.getItem(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY) ?? "null")).toEqual({
      selectedGroupId: "system",
      values: {
        "system-theme": "follow-system",
        "display-frame-rate-limit": "unlimited",
        "game-arknights-operation-mode": false,
        "game-use-simplified-device-icons": false,
        "other-debug-mode": true,
      },
    });
  });
});