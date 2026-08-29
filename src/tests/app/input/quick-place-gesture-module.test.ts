import { describe, expect, it, vi } from "vitest";

import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import type { GestureEvent, KeyboardSnapshot } from "@/app/input/gesture/adapter";
import {
  createQuickPlaceGestureModule,
  type GestureActionContext,
} from "@/app/input/gesture/actions";
import type { WorldEntity } from "@/domain/document/world-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";

describe("createQuickPlaceGestureModule", () => {
  it("opens quick place at the last mouse canvas position from the shortcut", () => {
    const { context } = createContext();
    const module = createQuickPlaceGestureModule();

    expect(module.handle(mouseMoveEvent(320, 180), context)).toEqual({ status: "ignored" });

    const result = module.handle(keyDownEvent({ code: "KeyZ", key: "z" }), context);

    expect(result).toEqual({ status: "handled", consume: true });
    expect(context.appHost.internalState.runtime.quickPlace).toEqual({
      visible: true,
      anchor: { x: 320, y: 180 },
      searchQuery: "",
      openSource: "keyboard-shortcut",
    });
  });

  it("opens quick place at blank canvas double tap position", () => {
    const mouseContext = createContext();
    const touchContext = createContext();
    const mouseModule = createQuickPlaceGestureModule();
    const touchModule = createQuickPlaceGestureModule();

    expect(mouseModule.handle(mouseDoubleTapEvent(111, 222), mouseContext.context)).toEqual({
      status: "handled",
      consume: true,
    });
    expect(mouseContext.context.appHost.internalState.runtime.quickPlace).toEqual({
      visible: true,
      anchor: { x: 111, y: 222 },
      searchQuery: "",
      openSource: "pointer",
    });

    expect(touchModule.handle(touchDoubleTapEvent(333, 444), touchContext.context)).toEqual({
      status: "handled",
      consume: true,
    });
    expect(touchContext.context.appHost.internalState.runtime.quickPlace).toEqual({
      visible: true,
      anchor: { x: 333, y: 444 },
      searchQuery: "",
      openSource: "pointer",
    });
  });

  it("ignores double tap on entities or with modifiers", () => {
    const onEntity = createContext();
    const withModifier = createContext();
    const module = createQuickPlaceGestureModule();

    expect(module.handle(
      mouseDoubleTapEvent(111, 222, { pointerEntity: entity("entity-1") }),
      onEntity.context,
    )).toEqual({ status: "ignored" });
    expect(onEntity.context.appHost.internalState.runtime.quickPlace.visible).toBe(false);

    expect(module.handle(
      touchDoubleTapEvent(333, 444, { modifiers: { ...emptyModifiers(), shift: true } }),
      withModifier.context,
    )).toEqual({ status: "ignored" });
    expect(withModifier.context.appHost.internalState.runtime.quickPlace.visible).toBe(false);
  });

  it("ignores double tap outside select mode, when disabled, or outside canvas grid", () => {
    const nonSelect = createContext({ activeTool: "move" });
    const disabled = createContext({ quickPlaceEnabled: false });
    const outsideGrid = createContext({ gridCell: null });

    for (const { context } of [nonSelect, disabled, outsideGrid]) {
      const module = createQuickPlaceGestureModule();

      expect(module.handle(mouseDoubleTapEvent(111, 222), context)).toEqual({
        status: "ignored",
      });
      expect(context.appHost.internalState.runtime.quickPlace.visible).toBe(false);
    }
  });

  it("ignores the shortcut outside select mode, when disabled, or outside canvas grid", () => {
    const disabled = createContext({ quickPlaceEnabled: false });
    const nonSelect = createContext({ activeTool: "move" });
    const outsideGrid = createContext({ gridCell: null });

    for (const { context } of [disabled, nonSelect, outsideGrid]) {
      const module = createQuickPlaceGestureModule();

      module.handle(mouseMoveEvent(320, 180), context);
      expect(module.handle(keyDownEvent({ code: "KeyZ", key: "z" }), context)).toEqual({
        status: "ignored",
      });
      expect(context.appHost.internalState.runtime.quickPlace.visible).toBe(false);
    }
  });

  it("closes quick place with Escape and when leaving the active tool", () => {
    const { context } = createContext({
      quickPlace: {
        visible: true,
        anchor: { x: 40, y: 60 },
        searchQuery: "abc",
        openSource: "keyboard-shortcut",
      },
    });
    const module = createQuickPlaceGestureModule();

    expect(module.handle(keyDownEvent({ code: "Escape", key: "Escape" }), context)).toEqual({
      status: "handled",
      consume: true,
    });
    expect(context.appHost.internalState.runtime.quickPlace).toEqual({
      visible: false,
      anchor: null,
      searchQuery: "",
      openSource: null,
    });

    context.appHost.internalState.runtime.quickPlace = {
      visible: true,
      anchor: { x: 80, y: 90 },
      searchQuery: "belt",
      openSource: "pointer",
    };

    expect(module.handle(exitActiveToolEvent(), context)).toEqual({ status: "handled" });
    expect(context.appHost.internalState.runtime.quickPlace).toEqual({
      visible: false,
      anchor: null,
      searchQuery: "",
      openSource: null,
    });
  });
});

function createContext(options: {
  activeTool?: "select" | "move";
  quickPlaceEnabled?: boolean;
  gridCell?: { x: number; y: number } | null;
  quickPlace?: {
    visible: boolean;
    anchor: { x: number; y: number } | null;
    searchQuery: string;
    openSource: "keyboard-shortcut" | "pointer" | null;
  };
} = {}): { context: GestureActionContext<AppHost> } {
  const editor = {
    queries: {
      findGridCellForClientPixelPoint: vi.fn(() =>
        Object.prototype.hasOwnProperty.call(options, "gridCell")
          ? options.gridCell
          : { x: 4, y: 5 }
      ),
    },
  };
  const appHost = {
    internalState: {
      activeTool: options.activeTool ?? "select",
      settings: {
        quickPlaceEnabled: options.quickPlaceEnabled ?? true,
      },
      runtime: {
        quickPlace: options.quickPlace ?? {
          visible: false,
          anchor: null,
          searchQuery: "",
          openSource: null,
        },
      },
    },
    internalActions: {
      isShortcutFor: vi.fn((
        key: string,
        code: string | null,
        eventKey: string | null,
      ) => key === SHORTCUT_KEY.QUICK_PLACE && (code === "KeyZ" || eventKey === "z")),
    },
  } as unknown as AppHost;

  return {
    context: {
      workspace: {
        editor,
      } as unknown as WorkspaceContract,
      appHost,
      keyboard: emptyKeyboardSnapshot(),
    },
  };
}

function mouseMoveEvent(x: number, y: number): GestureEvent {
  return {
    type: "mouse move",
    gestureId: "mouse-move-1",
    buttons: 0,
    position: { x, y },
    delta: { x: 0, y: 0 },
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseDoubleTapEvent(
  x: number,
  y: number,
  options: {
    readonly pointerEntity?: WorldEntity | null;
    readonly modifiers?: ReturnType<typeof emptyModifiers>;
    readonly button?: number;
    readonly longPress?: boolean;
  } = {},
): GestureEvent {
  return {
    type: "mouse double tap",
    gestureId: "mouse-double-tap-1",
    button: options.button ?? 0,
    buttons: 0,
    position: { x, y },
    longPress: options.longPress ?? false,
    pointerEntity: options.pointerEntity ?? null,
    modifiers: options.modifiers ?? emptyModifiers(),
    sourceEvent: null,
  };
}

function touchDoubleTapEvent(
  x: number,
  y: number,
  options: {
    readonly pointerEntity?: WorldEntity | null;
    readonly modifiers?: ReturnType<typeof emptyModifiers>;
    readonly longPress?: boolean;
  } = {},
): GestureEvent {
  return {
    type: "touch double tap",
    gestureId: "touch-double-tap-1",
    primaryId: 1,
    position: { x, y },
    longPress: options.longPress ?? false,
    pointerEntity: options.pointerEntity ?? null,
    modifiers: options.modifiers ?? emptyModifiers(),
    sourceEvent: null,
  };
}

function entity(id: string): WorldEntity {
  return {
    id,
    definitionId: "belt_straight_1x1",
    position: { x: 0, y: 0 },
    rotation: 0,
    config: {},
    tags: [],
  };
}

function keyDownEvent(options: { code: string; key: string }): GestureEvent {
  return {
    type: "key down",
    gestureId: "key-down-1",
    code: options.code,
    key: options.key,
    keyCode: null,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function exitActiveToolEvent(): GestureEvent {
  return {
    type: "on-exit-active-tool",
    gestureId: "exit-active-tool-1",
    from: "select",
    to: "move",
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
