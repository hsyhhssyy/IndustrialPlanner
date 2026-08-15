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
});

function createManager(): KeyboardShortcutManager {
  return new KeyboardShortcutManager({} as AppHost);
}
