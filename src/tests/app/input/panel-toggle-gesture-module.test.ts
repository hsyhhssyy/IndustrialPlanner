import { describe, expect, it, vi } from "vitest";

import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";
import {
  createPanelToggleGestureModule,
  type GestureActionContext,
} from "@/app/input/gesture/actions";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";

const SHORTCUT_DEFAULTS: Record<string, string> = {
  [SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL]: "P",
  [SHORTCUT_KEY.TOGGLE_BLUEPRINT_PANEL]: "L",
  [SHORTCUT_KEY.TOGGLE_HISTORY_PANEL]: "H",
  [SHORTCUT_KEY.TOGGLE_BASE_PANEL]: "K",
};

describe("createPanelToggleGestureModule", () => {
  it("opens and switches to the target panel when left dock is closed", () => {
    const { context, internalActions } = createContext({
      leftDockOpen: false,
      activePanel: "history",
    });
    const module = createPanelToggleGestureModule();

    const result = module.handle(keyDownEvent({ code: "KeyL", key: "l" }), context);

    expect(result).toEqual({ status: "handled", consume: true });
    expect(internalActions.setActivePanel).toHaveBeenCalledWith("blueprint");
    expect(internalActions.toggleLeftDock).not.toHaveBeenCalled();
  });

  it("switches panel without collapsing when left dock is open and target differs", () => {
    const { context, internalActions } = createContext({
      leftDockOpen: true,
      activePanel: "history",
    });
    const module = createPanelToggleGestureModule();

    const result = module.handle(keyDownEvent({ code: "KeyK", key: "k" }), context);

    expect(result).toEqual({ status: "handled", consume: true });
    expect(internalActions.setActivePanel).toHaveBeenCalledWith("base");
    expect(internalActions.toggleLeftDock).not.toHaveBeenCalled();
  });

  it("collapses left dock when target panel is already active", () => {
    const { context, internalActions } = createContext({
      leftDockOpen: true,
      activePanel: "base",
    });
    const module = createPanelToggleGestureModule();

    const result = module.handle(keyDownEvent({ code: "KeyK", key: "k" }), context);

    expect(result).toEqual({ status: "handled", consume: true });
    expect(internalActions.toggleLeftDock).toHaveBeenCalledTimes(1);
    expect(internalActions.setActivePanel).not.toHaveBeenCalled();
  });

  it("treats null activePanel as placement to match toolbar behavior", () => {
    const { context, internalActions } = createContext({
      leftDockOpen: true,
      activePanel: null,
    });
    const module = createPanelToggleGestureModule();

    const result = module.handle(keyDownEvent({ code: "KeyP", key: "p" }), context);

    expect(result).toEqual({ status: "handled", consume: true });
    expect(internalActions.toggleLeftDock).toHaveBeenCalledTimes(1);
    expect(internalActions.setActivePanel).not.toHaveBeenCalled();
  });

  it("supports key fallback when code is unavailable", () => {
    const { context, internalActions } = createContext({
      leftDockOpen: false,
      activePanel: "placement",
    });
    const module = createPanelToggleGestureModule();

    const result = module.handle(keyDownEvent({ code: null, key: "H" }), context);

    expect(result).toEqual({ status: "handled", consume: true });
    expect(internalActions.setActivePanel).toHaveBeenCalledWith("history");
  });

  it("ignores non-target keys, modifier keys, and non-keydown events", () => {
    const { context, internalActions } = createContext({
      leftDockOpen: true,
      activePanel: "placement",
    });
    const module = createPanelToggleGestureModule();

    expect(module.handle(keyDownEvent({ code: "KeyM", key: "m" }), context)).toEqual({
      status: "ignored",
    });
    expect(
      module.handle(
        keyDownEvent({
          code: "KeyP",
          key: "p",
          modifiers: { alt: false, ctrl: true, meta: false, shift: false },
        }),
        context,
      ),
    ).toEqual({ status: "ignored" });
    expect(module.handle(keyUpEvent({ code: "KeyP", key: "p" }), context)).toEqual({
      status: "ignored",
    });

    expect(internalActions.setActivePanel).not.toHaveBeenCalled();
    expect(internalActions.toggleLeftDock).not.toHaveBeenCalled();
  });
});

function createContext(options: {
  leftDockOpen: boolean;
  activePanel: "placement" | "blueprint" | "history" | "base" | "simulation" | null;
}): {
  context: GestureActionContext<AppHost>;
  internalActions: {
    setActivePanel: ReturnType<typeof vi.fn>;
    toggleLeftDock: ReturnType<typeof vi.fn>;
    isShortcutFor: ReturnType<typeof vi.fn>;
  };
} {
  const internalActions = {
    setActivePanel: vi.fn(),
    toggleLeftDock: vi.fn(),
    isShortcutFor: vi.fn(
      (
        key: string,
        code: string | null,
        eventKey?: string | null,
        modifiers?: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean },
      ) => {
        // 有修饰键则不匹配纯字母快捷键
        if (modifiers?.alt || modifiers?.ctrl || modifiers?.meta || modifiers?.shift) {
          return false;
        }

        const shortcut = (SHORTCUT_DEFAULTS[key] ?? "").trim().toLowerCase();
        if (shortcut === "") return false;

        const normalizedKey = (eventKey ?? "").trim().toLowerCase();
        if (normalizedKey !== "" && normalizedKey === shortcut) return true;

        if (shortcut.length === 1 && shortcut >= "a" && shortcut <= "z") {
          return code === `Key${shortcut.toUpperCase()}`;
        }

        return (code ?? "").trim().toLowerCase() === shortcut;
      },
    ),
  };

  const appHost = {
    state: {
      workbench: {
        leftDockOpen: options.leftDockOpen,
      },
    },
    internalState: {
      runtime: {
        activePanel: options.activePanel,
      },
    },
    internalActions,
  } as unknown as AppHost;

  return {
    context: {
      workspace: {} as WorkspaceContract,
      appHost,
      keyboard: emptyKeyboardSnapshot(),
    },
    internalActions,
  };
}

function keyDownEvent(options: {
  code: string | null;
  key: string | null;
  modifiers?: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };
}) {
  return {
    type: "key down" as const,
    gestureId: "key-down-1",
    code: options.code,
    key: options.key,
    keyCode: null,
    modifiers: options.modifiers ?? emptyModifiers(),
    sourceEvent: null,
  };
}

function keyUpEvent(options: { code: string | null; key: string | null }) {
  return {
    type: "key up" as const,
    gestureId: "key-up-1",
    code: options.code,
    key: options.key,
    keyCode: null,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function emptyModifiers() {
  return {
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
  };
}

function emptyKeyboardSnapshot(): KeyboardSnapshot {
  return {
    pressedKeys: new Set(),
    lastCode: null,
    lastKey: null,
    lastKeyCode: null,
    modifiers: emptyModifiers(),
  };
}
