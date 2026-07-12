// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  APP_SHORTCUTS_LOCAL_STORAGE_KEY,
  KeyboardShortcutManager,
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
});

function createManager(): KeyboardShortcutManager {
  return new KeyboardShortcutManager({} as AppHost);
}
