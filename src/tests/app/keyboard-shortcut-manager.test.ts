// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  APP_SHORTCUTS_LOCAL_STORAGE_KEY,
  CONFIGURABLE_SHORTCUT_ACTION_SPECS,
  FIXED_SHORTCUT_ACTION_SPECS,
  KeyboardShortcutManager,
  SHORTCUT_ACTION_SPECS,
  SHORTCUT_KEY,
} from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";

describe("KeyboardShortcutManager", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("defaults quick place to Z and placement panel to P", () => {
    const manager = createManager();

    expect(manager.getKeyboardShortcutFor(SHORTCUT_KEY.QUICK_PLACE)).toBe("Z");
    expect(manager.getKeyboardShortcutFor(SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL)).toBe("P");
    expect(manager.getKeyboardShortcutFor(SHORTCUT_KEY.CHEAT)).toBe("U");
  });

  it("defaults viewport pan to WASD and the equivalent arrow-key slot", () => {
    const manager = createManager();

    expect(manager.getKeyboardShortcutFor(SHORTCUT_KEY.PAN_VIEWPORT_UP)).toBe("W;ArrowUp");
    expect(manager.getKeyboardShortcutFor(SHORTCUT_KEY.PAN_VIEWPORT_DOWN)).toBe("S;ArrowDown");
    expect(manager.getKeyboardShortcutFor(SHORTCUT_KEY.PAN_VIEWPORT_LEFT)).toBe("A;ArrowLeft");
    expect(manager.getKeyboardShortcutFor(SHORTCUT_KEY.PAN_VIEWPORT_RIGHT)).toBe("D;ArrowRight");
  });

  it("matches either shortcut slot without changing callers", () => {
    const manager = createManager();

    expect(manager.isShortcutFor(
      SHORTCUT_KEY.PAN_VIEWPORT_UP,
      "KeyW",
      "w",
      { alt: false, ctrl: false, meta: false, shift: false },
    )).toBe(true);
    expect(manager.isShortcutFor(
      SHORTCUT_KEY.PAN_VIEWPORT_UP,
      "ArrowUp",
      "ArrowUp",
      { alt: false, ctrl: false, meta: false, shift: false },
    )).toBe(true);
  });

  it("keeps modifiers independent for each shortcut slot", () => {
    const manager = createManager();
    manager.setShortcutFor(SHORTCUT_KEY.COPY_SELECTION, "Ctrl+C;Meta+C");

    expect(manager.isShortcutFor(
      SHORTCUT_KEY.COPY_SELECTION,
      "KeyC",
      "c",
      { ctrl: true },
    )).toBe(true);
    expect(manager.isShortcutFor(
      SHORTCUT_KEY.COPY_SELECTION,
      "KeyC",
      "c",
      { meta: true },
    )).toBe(true);
    expect(manager.isShortcutFor(
      SHORTCUT_KEY.COPY_SELECTION,
      "KeyC",
      "c",
      {},
    )).toBe(false);
  });

  it("keeps legacy single-slot persisted values compatible", () => {
    localStorage.setItem(APP_SHORTCUTS_LOCAL_STORAGE_KEY, JSON.stringify({
      _v: 1,
      data: {
        [SHORTCUT_KEY.PAN_VIEWPORT_UP]: "I",
      },
    }));

    const manager = createManager();

    expect(manager.getKeyboardShortcutFor(SHORTCUT_KEY.PAN_VIEWPORT_UP)).toBe("I");
    expect(manager.isShortcutFor(SHORTCUT_KEY.PAN_VIEWPORT_UP, "KeyI", "i")).toBe(true);
  });

  it("defaults marquee to X without exposing Escape as a configurable shortcut", () => {
    const manager = createManager();

    expect(manager.getKeyboardShortcutFor(SHORTCUT_KEY.MARQUEE)).toBe("X");
    expect(Object.values(SHORTCUT_KEY)).not.toContain("shortcut-return-select");
  });

  it("rejects Escape bindings from both shortcut slots", () => {
    const manager = createManager();

    manager.setShortcutFor(SHORTCUT_KEY.ROTATE, "Escape;Ctrl+J");

    expect(manager.getKeyboardShortcutFor(SHORTCUT_KEY.ROTATE)).toBe(";Ctrl+J");
    expect(manager.isShortcutFor(SHORTCUT_KEY.ROTATE, "Escape", "Escape")).toBe(false);
    expect(manager.isShortcutFor(
      SHORTCUT_KEY.ROTATE,
      "KeyJ",
      "j",
      { ctrl: true },
    )).toBe(true);
  });

  it("migrates legacy unversioned Z placement panel shortcut to quick place", () => {
    localStorage.setItem(APP_SHORTCUTS_LOCAL_STORAGE_KEY, JSON.stringify({
      [SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL]: "Z",
    }));

    const manager = createManager();

    expect(manager.getKeyboardShortcutFor(SHORTCUT_KEY.QUICK_PLACE)).toBe("Z");
    expect(manager.getKeyboardShortcutFor(SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL)).toBe("P");
  });

  it("clears placement panel during legacy migration when P is occupied", () => {
    localStorage.setItem(APP_SHORTCUTS_LOCAL_STORAGE_KEY, JSON.stringify({
      [SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL]: "Z",
      [SHORTCUT_KEY.WAREHOUSE]: "P",
    }));

    const manager = createManager();

    expect(manager.getKeyboardShortcutFor(SHORTCUT_KEY.QUICK_PLACE)).toBe("Z");
    expect(manager.getKeyboardShortcutFor(SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL)).toBe("");
    expect(manager.getKeyboardShortcutFor(SHORTCUT_KEY.WAREHOUSE)).toBe("P");
  });

  it("removes legacy bare Z from non-quick-place shortcuts", () => {
    localStorage.setItem(APP_SHORTCUTS_LOCAL_STORAGE_KEY, JSON.stringify({
      [SHORTCUT_KEY.ROTATE]: "Z",
      [SHORTCUT_KEY.UNDO]: "Ctrl+Z",
    }));

    const manager = createManager();

    expect(manager.getKeyboardShortcutFor(SHORTCUT_KEY.QUICK_PLACE)).toBe("Z");
    expect(manager.getKeyboardShortcutFor(SHORTCUT_KEY.ROTATE)).toBe("");
    expect(manager.getKeyboardShortcutFor(SHORTCUT_KEY.UNDO)).toBe("Ctrl+Z");
  });

  it("preserves an explicitly cleared shortcut after reading versioned storage", () => {
    localStorage.setItem(APP_SHORTCUTS_LOCAL_STORAGE_KEY, JSON.stringify({
      _v: 1,
      data: {
        [SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL]: "",
      },
    }));

    const manager = createManager();

    expect(manager.getKeyboardShortcutFor(SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL)).toBe("");
  });

  it("preserves every current action and both slots from version 1 storage", () => {
    const persistedShortcuts = {
      [SHORTCUT_KEY.PLACE_CONVEYOR]: "Ctrl+E;Alt+E",
      [SHORTCUT_KEY.PLACE_PIPE]: "Ctrl+Q;Meta+Q",
      [SHORTCUT_KEY.RESOURCES_POWER]: "Shift+G;Ctrl+G",
      [SHORTCUT_KEY.WAREHOUSE]: "C;Ctrl+C",
      [SHORTCUT_KEY.BASIC_PRODUCTION]: "V;Ctrl+V",
      [SHORTCUT_KEY.SYNTHESIS]: "B;Shift+B",
      [SHORTCUT_KEY.CHEAT]: "U;Alt+U",
      [SHORTCUT_KEY.SAVE_BLUEPRINT]: "Ctrl+S;Meta+S",
      [SHORTCUT_KEY.ROTATE]: "Ctrl+R;Alt+R",
      [SHORTCUT_KEY.SWITCH_DEVICE_MODE]: "Ctrl+Tab;Shift+Tab",
      [SHORTCUT_KEY.ROTATE_VIEWPORT]: "R;Meta+R",
      [SHORTCUT_KEY.DELETE_DEVICE]: "F;Ctrl+F",
      [SHORTCUT_KEY.MOVE_SELECTION]: "M;Alt+M",
      [SHORTCUT_KEY.COPY_SELECTION]: "Ctrl+C;Meta+C",
      [SHORTCUT_KEY.PASTE_SELECTION]: "Ctrl+V;Meta+V",
      [SHORTCUT_KEY.UNDO]: "Ctrl+Z;Meta+Z",
      [SHORTCUT_KEY.REDO]: "Ctrl+Y;Meta+Y",
      [SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL]: "P;Ctrl+P",
      [SHORTCUT_KEY.TOGGLE_BLUEPRINT_PANEL]: "L;Ctrl+L",
      [SHORTCUT_KEY.TOGGLE_HISTORY_PANEL]: "H;Ctrl+H",
      [SHORTCUT_KEY.TOGGLE_BASE_PANEL]: "K;Ctrl+K",
      [SHORTCUT_KEY.QUICK_PLACE]: "Z;Shift+Z",
      [SHORTCUT_KEY.OPEN_TOOLBOX]: "T;Ctrl+T",
      [SHORTCUT_KEY.PAN_VIEWPORT_UP]: "W;ArrowUp",
      [SHORTCUT_KEY.PAN_VIEWPORT_DOWN]: "S;ArrowDown",
      [SHORTCUT_KEY.PAN_VIEWPORT_LEFT]: "A;ArrowLeft",
      [SHORTCUT_KEY.PAN_VIEWPORT_RIGHT]: "D;ArrowRight",
      [SHORTCUT_KEY.MARQUEE]: ";X",
    } as const;
    localStorage.setItem(APP_SHORTCUTS_LOCAL_STORAGE_KEY, JSON.stringify({
      _v: 1,
      data: persistedShortcuts,
    }));

    const manager = createManager();

    expect(Object.values(SHORTCUT_KEY)).toHaveLength(28);
    for (const shortcutId of Object.values(SHORTCUT_KEY)) {
      expect(manager.getKeyboardShortcutFor(shortcutId)).toBe(persistedShortcuts[shortcutId]);
    }
  });

  it("resets all 28 actions from the unified action specs", () => {
    const manager = createManager();
    for (const shortcutId of Object.values(SHORTCUT_KEY)) {
      manager.setShortcutFor(shortcutId, `Ctrl+Alt+${shortcutId.at(-1) ?? "A"}`);
    }

    manager.resetAllShortcutsToDefaults();

    expect(CONFIGURABLE_SHORTCUT_ACTION_SPECS).toHaveLength(28);
    for (const spec of CONFIGURABLE_SHORTCUT_ACTION_SPECS) {
      expect(manager.getKeyboardShortcutFor(spec.id)).toBe(spec.defaultBindings.join(";"));
    }
  });

  it("persists reset defaults and reloads every configurable action unchanged", () => {
    const manager = createManager();
    const disposePersistence = manager.hookPersistence();
    manager.setShortcutFor(SHORTCUT_KEY.ROTATE, "G");
    manager.setShortcutFor(SHORTCUT_KEY.PAN_VIEWPORT_UP, "I;ArrowUp");

    manager.resetAllShortcutsToDefaults();
    disposePersistence();

    const reloadedManager = createManager();
    for (const spec of CONFIGURABLE_SHORTCUT_ACTION_SPECS) {
      expect(reloadedManager.getKeyboardShortcutFor(spec.id)).toBe(
        spec.defaultBindings.join(";"),
      );
    }
  });

  it("registers fixed actions separately without exposing them as configurable shortcuts", () => {
    expect(SHORTCUT_ACTION_SPECS).toHaveLength(
      CONFIGURABLE_SHORTCUT_ACTION_SPECS.length + FIXED_SHORTCUT_ACTION_SPECS.length,
    );
    expect(FIXED_SHORTCUT_ACTION_SPECS.length).toBeGreaterThan(0);
    expect(FIXED_SHORTCUT_ACTION_SPECS.every((spec) => !spec.configurable)).toBe(true);
  });

  it("matches modifier-only bindings from either physical side", () => {
    const manager = createManager();
    manager.setShortcutFor(SHORTCUT_KEY.ROTATE, "Ctrl");

    expect(manager.isShortcutFor(
      SHORTCUT_KEY.ROTATE,
      "ControlLeft",
      "Control",
      { ctrl: true },
    )).toBe(true);
    expect(manager.isShortcutFor(
      SHORTCUT_KEY.ROTATE,
      "ControlRight",
      "Control",
      { ctrl: true },
    )).toBe(true);
    expect(manager.isShortcutFor(
      SHORTCUT_KEY.ROTATE,
      "KeyR",
      "r",
      { ctrl: true },
    )).toBe(false);
  });

  it.each([
    ["Ctrl", "ControlLeft", "ControlRight", "Control", { ctrl: true }],
    ["Shift", "ShiftLeft", "ShiftRight", "Shift", { shift: true }],
    ["Alt", "AltLeft", "AltRight", "Alt", { alt: true }],
    ["Meta", "MetaLeft", "MetaRight", "Meta", { meta: true }],
  ] as const)(
    "matches modifier-only %s from either physical side",
    (binding, leftCode, rightCode, key, modifiers) => {
      const manager = createManager();
      manager.setShortcutFor(SHORTCUT_KEY.ROTATE, binding);

      expect(manager.isShortcutFor(SHORTCUT_KEY.ROTATE, leftCode, key, modifiers)).toBe(true);
      expect(manager.isShortcutFor(SHORTCUT_KEY.ROTATE, rightCode, key, modifiers)).toBe(true);
    },
  );
});

function createManager(): KeyboardShortcutManager {
  return new KeyboardShortcutManager({
    gestureActionRouter: {
      assertShortcutRouteIntegrity() {},
    },
  } as AppHost);
}
