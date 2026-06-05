// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY,
  WorkbenchSettingsDialogController,
} from "@/app/shell/state/settings-dialog-state";

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
        "game-arknights-immediate-move": true,
        "game-arknights-immediate-marquee": false,
        "game-arknights-allow-empty-logistics-endpoints": true,
        "game-arknights-auto-create-logistics-devices": true,
        "game-arknights-selection-right-dock-sync": true,
        "game-arknights-inspector-open-on-second-click": false,
        "shortcut-place-conveyor": "E",
        "shortcut-place-pipe": "Q",
        "shortcut-resources-power": "G",
        "shortcut-warehouse": "C",
        "shortcut-basic-production": "V",
        "shortcut-synthesis": "B",
        "shortcut-save-blueprint": "Ctrl+S",
        "shortcut-return-select": "Esc",
        "shortcut-rotate": "R",
        "shortcut-switch-device-mode": "Tab",
        "shortcut-rotate-viewport": "Ctrl+R",
        "shortcut-delete-device": "F",
        "shortcut-move-selection": "M",
        "shortcut-copy-selection": "Ctrl+C",
        "shortcut-paste-selection": "Ctrl+V",
        "shortcut-toggle-base-panel": "K",
        "shortcut-toggle-blueprint-panel": "L",
        "shortcut-toggle-history-panel": "H",
        "shortcut-toggle-placement-panel": "Z",
        "shortcut-undo": "Ctrl+Z",
        "shortcut-redo": "Ctrl+Y",
        "game-show-device-names": true,
        "game-show-device-icons": true,
        "game-show-hotkeys": true,
        "game-always-show-grid-lines": true,
        "game-show-grass-background": false,
        "game-use-inspector-panel": false,
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
    expect(hydratedController.values["game-arknights-immediate-move"]).toBe(true);
    expect(hydratedController.values["game-arknights-immediate-marquee"]).toBe(false);
    expect(hydratedController.values["game-arknights-allow-empty-logistics-endpoints"]).toBe(true);
    expect(hydratedController.values["game-arknights-auto-create-logistics-devices"]).toBe(true);
    expect(hydratedController.values["game-arknights-selection-right-dock-sync"]).toBe(true);
    expect(hydratedController.values["game-arknights-inspector-open-on-second-click"]).toBe(false);
    expect(hydratedController.values["shortcut-place-conveyor"]).toBe("E");
    expect(hydratedController.values["shortcut-place-pipe"]).toBe("Q");
    expect(hydratedController.values["shortcut-resources-power"]).toBe("G");
    expect(hydratedController.values["shortcut-warehouse"]).toBe("C");
    expect(hydratedController.values["shortcut-basic-production"]).toBe("V");
    expect(hydratedController.values["shortcut-synthesis"]).toBe("B");
    expect(hydratedController.values["shortcut-save-blueprint"]).toBe("Ctrl+S");
    expect(hydratedController.values["shortcut-return-select"]).toBe("Esc");
    expect(hydratedController.values["shortcut-rotate"]).toBe("R");
    expect(hydratedController.values["shortcut-switch-device-mode"]).toBe("Tab");
    expect(hydratedController.values["shortcut-rotate-viewport"]).toBe("Ctrl+R");
    expect(hydratedController.values["shortcut-delete-device"]).toBe("F");
    expect(hydratedController.values["game-show-device-names"]).toBe(true);
    expect(hydratedController.values["game-show-device-icons"]).toBe(true);
    expect(hydratedController.values["game-always-show-grid-lines"]).toBe(true);
    expect(hydratedController.values["game-show-grass-background"]).toBe(false);
    expect(hydratedController.values["game-use-simplified-device-icons"]).toBe(true);
    expect(hydratedController.values["other-debug-mode"]).toBe(true);
    expect(hydratedController.values["debug-show-fps"]).toBe(true);
    expect(hydratedController.values["debug-show-gesture-diagnostics-window"]).toBe(true);
  });

  // AI-REMOVED 2026-05-26:
  // Reason: game-arknights-operation-mode 开关已从设置面板移除，
  //         所有快捷建设置的 editableWhen 均已解耦，此测试不再适用。
  // Trigger: 用户需求 — 取消该设置的图像化入口，解耦关联。
  // Evidence: settings-dialog-state.ts 中所有引用 game-arknights-operation-mode 的 editableWhen 已移除。
  // Replacement: None（editableWhen 机制仍存在，但不再与此设置关联；其他 editableWhen 测试仍覆盖该机制）。
  // Risk: Low
  // Human Review: Not Required
  //
  // Original code:
  // it("only updates conditional keybinding settings while their prerequisite matches", () => {
  //   let hypergryphOperationMode = false;
  //   const controller = new WorkbenchSettingsDialogController({
  //     externalBindings: {
  //       "game-arknights-operation-mode": {
  //         readValue: () => hypergryphOperationMode,
  //         writeValue: (value) => {
  //           if (typeof value === "boolean") {
  //             hypergryphOperationMode = value;
  //           }
  //         },
  //       },
  //     },
  //   });
  //   expect(controller.isSettingEditable("shortcut-place-conveyor")).toBe(true);
  //   controller.updateKeybindingValue("shortcut-place-conveyor", "P");
  //   expect(controller.values["shortcut-place-conveyor"]).toBe("P");
  //   hypergryphOperationMode = true;
  //   expect(controller.isSettingEditable("shortcut-place-conveyor")).toBe(false);
  //   controller.updateKeybindingValue("shortcut-place-conveyor", "Z");
  //   expect(controller.values["shortcut-place-conveyor"]).toBe("P");
  // });

  // AI-REMOVED 2026-05-26:
  // Reason: game-arknights-operation-mode 设置项已从设置面板移除，此测试不再适用。
  // Trigger: 用户需求 — 取消该设置的图像化入口。
  // Evidence: settings-dialog-state.ts 中 game-arknights-operation-mode 项已删除。
  // Replacement: None（disabled 设置项机制仍可通过其他测试覆盖）。
  // Risk: Low
  // Human Review: Not Required
  //
  // Original code:
  // it("treats permanently disabled settings as read-only", () => {
  //   const controller = new WorkbenchSettingsDialogController();
  //   expect(controller.isSettingEditable("game-arknights-operation-mode")).toBe(false);
  //   expect(controller.getValue("game-arknights-operation-mode")).toBe(true);
  //   controller.updateSwitchValue("game-arknights-operation-mode", false);
  //   expect(controller.getValue("game-arknights-operation-mode")).toBe(true);
  // });

  it("disables grass and grid toggles when simplified device icons are enabled", () => {
    const controller = new WorkbenchSettingsDialogController();

    expect(controller.isSettingEditable("game-always-show-grid-lines")).toBe(true);
    expect(controller.isSettingEditable("game-show-grass-background")).toBe(true);

    controller.updateSwitchValue("game-use-simplified-device-icons", true);

    expect(controller.isSettingEditable("game-always-show-grid-lines")).toBe(false);
    expect(controller.isSettingEditable("game-show-grass-background")).toBe(false);

    controller.updateSwitchValue("game-always-show-grid-lines", false);
    controller.updateSwitchValue("game-show-grass-background", true);

    expect(controller.values["game-always-show-grid-lines"]).toBe(true);
    expect(controller.values["game-show-grass-background"]).toBe(false);
  });

  it("locks device icons on when simplified device icons are enabled", () => {
    const controller = new WorkbenchSettingsDialogController();

    expect(controller.getValue("game-show-device-names")).toBe(true);
    expect(controller.getValue("game-show-device-icons")).toBe(false);
    expect(controller.isSettingEditable("game-show-device-icons")).toBe(true);

    controller.updateSwitchValue("game-use-simplified-device-icons", true);

    expect(controller.getValue("game-show-device-icons")).toBe(true);
    expect(controller.isSettingEditable("game-show-device-icons")).toBe(false);

    controller.updateSwitchValue("game-show-device-icons", false);

    expect(controller.getValue("game-show-device-icons")).toBe(true);
  });

  it("uses external bindings as the source of truth for connected settings", () => {
    let locale = "zh-CN";
    let themeId = "ayu-light";
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
      },
    });

    controller.selectGroup("system");
    controller.updateSelectValue("system-language", "en-US");
    controller.updateSelectValue("system-theme", "ayu-dark");
    controller.updateSwitchValue("other-debug-mode", true);

    expect(locale).toBe("en-US");
    expect(themeId).toBe("ayu-dark");
    expect(controller.getValue("system-language")).toBe("en-US");
    expect(controller.getValue("system-theme")).toBe("ayu-dark");
    expect(JSON.parse(localStorage.getItem(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY) ?? "null")).toEqual({
      selectedGroupId: "system",
      values: {
        "display-frame-rate-limit": "unlimited",
        "game-arknights-immediate-move": true,
        "game-arknights-immediate-marquee": false,
        "game-arknights-allow-empty-logistics-endpoints": true,
        "game-arknights-auto-create-logistics-devices": true,
        "game-arknights-selection-right-dock-sync": true,
        "game-arknights-inspector-open-on-second-click": false,
        "shortcut-place-conveyor": "E",
        "shortcut-place-pipe": "Q",
        "shortcut-resources-power": "G",
        "shortcut-warehouse": "C",
        "shortcut-basic-production": "V",
        "shortcut-synthesis": "B",
        "shortcut-save-blueprint": "Ctrl+S",
        "shortcut-return-select": "Esc",
        "shortcut-rotate": "R",
        "shortcut-switch-device-mode": "Tab",
        "shortcut-rotate-viewport": "Ctrl+R",
        "shortcut-delete-device": "F",
        "shortcut-move-selection": "M",
        "shortcut-copy-selection": "Ctrl+C",
        "shortcut-paste-selection": "Ctrl+V",
        "shortcut-toggle-base-panel": "K",
        "shortcut-toggle-blueprint-panel": "L",
        "shortcut-toggle-history-panel": "H",
        "shortcut-toggle-placement-panel": "Z",
        "shortcut-undo": "Ctrl+Z",
        "shortcut-redo": "Ctrl+Y",
        "game-show-device-names": true,
        "game-show-device-icons": false,
        "game-show-hotkeys": true,
        "game-always-show-grid-lines": true,
        "game-show-grass-background": false,
        "game-use-inspector-panel": false,
        "game-use-simplified-device-icons": false,
        "other-debug-mode": true,
        "debug-show-fps": false,
        "debug-show-gesture-diagnostics-window": false,
      },
    });
  });
});
