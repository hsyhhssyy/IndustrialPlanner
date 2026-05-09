import { describe, expect, it, vi } from "vitest";

import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";
import {
  createHypergryphDeleteSelectionGestureModule,
  type GestureActionContext,
} from "@/app/input/gesture/actions";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { ActiveTool } from "@/domain/app/types/app-types";
import type { EntityCollection } from "@/domain/editor/types/editor-types";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

describe("createHypergryphDeleteSelectionGestureModule", () => {
  it("deletes the current selection from the delete-device shortcut and hides selection toolbars", () => {
    const {
      context,
      deleteCollection,
      hideCanvasFloatingToolbar,
      hideCanvasRightDockToolbar,
      isShortcutFor,
    } = createContext();
    const module = createHypergryphDeleteSelectionGestureModule();

    const result = module.handle(
      keyDownEvent({ code: "KeyF", key: "f" }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(isShortcutFor).toHaveBeenCalledWith(SHORTCUT_KEY.DELETE_DEVICE, "KeyF", "f", { alt: false, ctrl: false, meta: false, shift: false });
    expect(deleteCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
    expect(hideCanvasRightDockToolbar).toHaveBeenCalledTimes(1);
  });

  it("deletes the current selection from the floating delete button", () => {
    const {
      context,
      deleteCollection,
    } = createContext();
    const module = createHypergryphDeleteSelectionGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("canvas-floating-toolbar-button-delete"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(deleteCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
  });

  it("deletes the current selection from the right dock delete button", () => {
    const {
      context,
      deleteCollection,
    } = createContext();
    const module = createHypergryphDeleteSelectionGestureModule();

    const result = module.handle(
      uiButtonMouseTapEvent("canvas-right-dock-toolbar-button-delete"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(deleteCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
  });

  it("deletes the current selection from the marquee right dock delete button without hiding marquee controls", () => {
    const {
      context,
      deleteCollection,
      hideCanvasFloatingToolbar,
      hideCanvasRightDockToolbar,
    } = createContext({ activeTool: "marquee" });
    const module = createHypergryphDeleteSelectionGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("canvas-right-dock-toolbar-button-delete"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(deleteCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(hideCanvasFloatingToolbar).not.toHaveBeenCalled();
    expect(hideCanvasRightDockToolbar).not.toHaveBeenCalled();
  });

  it("does not wire batch delete from the floating toolbar", () => {
    const {
      context,
      deleteCollection,
    } = createContext();
    const module = createHypergryphDeleteSelectionGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("canvas-floating-toolbar-button-delete-many"),
      context,
    );

    expect(result).toEqual({ status: "ignored" });
    expect(deleteCollection).not.toHaveBeenCalled();
  });

  it("only responds while select or marquee mode, selection exists, and hypergryph mode is active", () => {
    const module = createHypergryphDeleteSelectionGestureModule();
    const disabledContext = createContext({ hypergryphOperationMode: false }).context;
    const moveContext = createContext({ activeTool: "move" }).context;
    const emptySelectionContext = createContext({ selectedEntityIds: [] }).context;

    expect(module.when?.(disabledContext)).toBe(false);
    expect(module.handle(keyDownEvent({ code: "KeyF", key: "f" }), moveContext)).toEqual({
      status: "ignored",
    });
    expect(
      module.handle(keyDownEvent({ code: "KeyF", key: "f" }), emptySelectionContext),
    ).toEqual({ status: "ignored" });
  });
});

function createContext(options: {
  activeTool?: ActiveTool;
  hypergryphOperationMode?: boolean;
  selectedEntityIds?: readonly string[];
} = {}): {
  context: GestureActionContext<AppHost>;
  deleteCollection: ReturnType<typeof vi.fn>;
  hideCanvasFloatingToolbar: ReturnType<typeof vi.fn>;
  hideCanvasRightDockToolbar: ReturnType<typeof vi.fn>;
  isShortcutFor: ReturnType<typeof vi.fn>;
} {
  const deleteCollection = vi.fn();
  const hideCanvasFloatingToolbar = vi.fn();
  const hideCanvasRightDockToolbar = vi.fn();
  const isShortcutFor = vi.fn((shortcutKeyId: string, code: string | null, key: string | null) => (
    shortcutKeyId === SHORTCUT_KEY.DELETE_DEVICE
    && code === "KeyF"
    && key === "f"
  ));
  const selection = createSelectionCollection(options.selectedEntityIds ?? ["entity-1"]);

  return {
    context: {
      workspace: {
        editor: {
          state: {
            collections: {
              selection,
            },
          },
          actions: {
            deleteCollection,
          },
        },
      } as unknown as WorkspaceContract,
      appHost: {
        state: {
          settings: {
            hypergryphOperationMode: options.hypergryphOperationMode ?? true,
          },
        },
        internalState: {
          activeTool: options.activeTool ?? "select",
        },
        internalActions: {
          isShortcutFor,
          hideCanvasFloatingToolbar,
          hideCanvasRightDockToolbar,
        },
      } as unknown as AppHost,
      keyboard: emptyKeyboardSnapshot(),
    },
    deleteCollection,
    hideCanvasFloatingToolbar,
    hideCanvasRightDockToolbar,
    isShortcutFor,
  };
}

function createSelectionCollection(entityIds: readonly string[]): EntityCollection {
  const selection = [...entityIds] as string[] & EntityCollection;

  selection.contains = (entityId: string) => selection.includes(entityId);

  return selection;
}

function keyDownEvent(options: {
  code: string;
  key: string;
}) {
  return {
    type: "key down" as const,
    gestureId: "key-delete-selection-1",
    code: options.code,
    key: options.key,
    keyCode: 0,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonTouchTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-touch-tap" as const,
    gestureId: `ui-button-touch-${uiButtonId}`,
    uiButtonId,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonMouseTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-mouse-tap" as const,
    gestureId: `ui-button-mouse-${uiButtonId}`,
    uiButtonId,
    button: 0,
    modifiers: emptyModifiers(),
    sourceEvent: null,
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

function emptyModifiers() {
  return {
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
  };
}