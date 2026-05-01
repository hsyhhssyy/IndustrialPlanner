import { describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";
import {
  createHypergryphMarqueeGestureModule,
  type GestureActionContext,
} from "@/app/input/gesture/actions";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import type { EditorContract } from "@/domain/contract/editor-contract";
import type { WorldEntity } from "@/domain/entity/world-document";
import { EntityCollectionType } from "@/domain/state/types";
import type { GridPoint } from "@/domain/types/grid";

describe("createHypergryphMarqueeGestureModule", () => {
  it("enters and exits marquee from the X key", () => {
    const { context, appHost, editor } = createContext();
    const module = createHypergryphMarqueeGestureModule();

    expect(module.handle(keyDownEvent("KeyX"), context)).toEqual({ status: "handled" });
    expect(appHost.internalState.activeTool).toBe("marquee");
    expect(appHost.internalActions.showCanvasRightDockToolbar).not.toHaveBeenCalled();

    expect(module.handle(keyDownEvent("KeyX"), context)).toEqual({ status: "handled" });
    expect(editor.actions.cancelMarquee).toHaveBeenCalledTimes(1);
    expect(editor.actions.clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(appHost.internalState.activeTool).toBe("select");
    expect(appHost.internalState.runtime.marqueeAnchor).toBeNull();
    expect(appHost.state.toolInfo.marqueeType).toBe(EntityCollectionType.marquee);
  });

  it("enters touch marquee from the placement button and collapses the right dock", () => {
    const { context, appHost } = createContext();
    const module = createHypergryphMarqueeGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("placement-tool-marquee"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(appHost.internalState.activeTool).toBe("marquee");
    expect(appHost.internalActions.showCanvasRightDockToolbar).toHaveBeenCalledWith([
      "canvas-right-dock-toolbar-button-exit",
      "canvas-right-dock-toolbar-button-move",
    ]);
    expect(appHost.internalActions.showCanvasTopLeftCornerToolbar).toHaveBeenCalledWith([
      "canvas-top-left-corner-toolbar-button-toggle-pipe",
      "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee",
    ]);
    expect(appHost.internalState.workbench.rightDockOpen).toBe(false);
  });

  it("starts immediate mouse marquee from empty select drag start", () => {
    const { context, appHost, editor } = createContext({
      hypergryphImmediateMarquee: true,
    });
    const module = createHypergryphMarqueeGestureModule();

    const result = module.handle(
      mouseDragStartEvent({
        originButton: 0,
        pointerEntity: null,
        position: { x: 3.2, y: 4.8 },
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(appHost.internalState.activeTool).toBe("marquee");
    expect(appHost.internalState.runtime.marqueeAnchor).toEqual({ x: 3, y: 4 });
    expect(appHost.state.toolInfo.marqueeType).toBe(EntityCollectionType.marquee);
    expect(editor.actions.setMarqueeRange).toHaveBeenCalledWith(
      EntityCollectionType.marquee,
      { x: 3, y: 4, width: 1, height: 1 },
    );
  });

  it("starts immediate touch marquee from empty select long-press drag start", () => {
    const { context, appHost, editor } = createContext({
      hypergryphImmediateMarquee: true,
    });
    const module = createHypergryphMarqueeGestureModule();

    const result = module.handle(
      touchDragStartEvent({
        longPress: true,
        pointerEntity: null,
        position: { x: 6.4, y: 7.9 },
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(appHost.internalState.activeTool).toBe("marquee");
    expect(appHost.internalActions.showCanvasRightDockToolbar).toHaveBeenCalledWith([
      "canvas-right-dock-toolbar-button-exit",
      "canvas-right-dock-toolbar-button-move",
    ]);
    expect(appHost.internalActions.showCanvasTopLeftCornerToolbar).toHaveBeenCalledWith([
      "canvas-top-left-corner-toolbar-button-toggle-pipe",
      "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee",
    ]);
    expect(appHost.internalState.workbench.rightDockOpen).toBe(false);
    expect(appHost.internalState.runtime.marqueeAnchor).toEqual({ x: 6, y: 7 });
    expect(appHost.state.toolInfo.marqueeType).toBe(EntityCollectionType.marquee);
    expect(editor.actions.setMarqueeRange).toHaveBeenCalledWith(
      EntityCollectionType.marquee,
      { x: 6, y: 7, width: 1, height: 1 },
    );
  });

  it("does not claim touch long-press drag from an entity when immediate marquee is enabled", () => {
    const { context, appHost, editor } = createContext({
      hypergryphImmediateMarquee: true,
    });
    const module = createHypergryphMarqueeGestureModule();

    const result = module.handle(
      touchDragStartEvent({
        longPress: true,
        pointerEntity: { id: "entity-1" } as WorldEntity,
      }),
      context,
    );

    expect(result).toEqual({ status: "ignored" });
    expect(appHost.internalState.activeTool).toBe("select");
    expect(appHost.internalState.runtime.marqueeAnchor).toBeNull();
    expect(editor.actions.setMarqueeRange).not.toHaveBeenCalled();
  });

  it("uses right mouse drag for reverse marquee and applies on drag end", () => {
    const { context, appHost, editor } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(
      module.handle(
        mouseDragStartEvent({
          originButton: 2,
          pointerEntity: null,
          position: { x: 5.1, y: 5.1 },
        }),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(appHost.state.toolInfo.marqueeType).toBe(EntityCollectionType.reverseMarquee);

    expect(
      module.handle(
        mouseDragMoveEvent({
          position: { x: 2.9, y: 3.2 },
        }),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(editor.actions.setMarqueeRange).toHaveBeenLastCalledWith(
      EntityCollectionType.reverseMarquee,
      { x: 2, y: 3, width: 4, height: 3 },
    );

    expect(module.handle(mouseDragEndEvent(), context)).toEqual({ status: "handled" });
    expect(editor.actions.applyMarquee).toHaveBeenCalledTimes(1);
    expect(appHost.internalState.runtime.marqueeAnchor).toBeNull();
  });

  it("ignores middle mouse drag and non-long-press touch drag", () => {
    const { context, appHost, editor } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMarqueeGestureModule();

    const middleMouseResult = module.handle(
      mouseDragStartEvent({
        originButton: 1,
        pointerEntity: null,
      }),
      context,
    );
    const touchResult = module.handle(
      touchDragStartEvent({
        longPress: false,
      }),
      context,
    );

    expect(middleMouseResult).toEqual({ status: "ignored" });
    expect(touchResult).toEqual({ status: "ignored" });
    expect(editor.actions.setMarqueeRange).not.toHaveBeenCalled();
    expect(appHost.internalState.runtime.marqueeAnchor).toBeNull();
  });

  it("does not enter marquee on middle mouse drag even when immediate marquee is enabled", () => {
    const { context, appHost, editor } = createContext({
      activeTool: "select",
      hypergryphImmediateMarquee: true,
    });
    const module = createHypergryphMarqueeGestureModule();

    const result = module.handle(
      mouseDragStartEvent({
        originButton: 1,
        pointerEntity: null,
        position: { x: 5, y: 5 },
      }),
      context,
    );

    expect(result).toEqual({ status: "ignored" });
    expect(appHost.internalState.activeTool).toBe("select");
    expect(appHost.internalState.runtime.marqueeAnchor).toBeNull();
    expect(editor.actions.setMarqueeRange).not.toHaveBeenCalled();
  });

  it("uses the top-left toggle state for touch reverse marquee", () => {
    const { context, editor } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(
      module.handle(
        uiButtonTouchTapEvent("canvas-top-left-corner-toolbar-button-toggle-reverse-marquee-on"),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(
      module.handle(
        touchDragStartEvent({
          longPress: true,
          position: { x: 8.4, y: 9.7 },
        }),
        context,
      ),
    ).toEqual({ status: "handled" });

    expect(editor.actions.setMarqueeRange).toHaveBeenCalledWith(
      EntityCollectionType.reverseMarquee,
      { x: 8, y: 9, width: 1, height: 1 },
    );

    expect(
      module.handle(
        uiButtonMouseTapEvent("canvas-top-left-corner-toolbar-button-toggle-reverse-marquee-off"),
        context,
      ),
    ).toEqual({ status: "handled" });
  });

  it("handles the exit right dock button without restoring the right dock", () => {
    const exitContext = createContext({
      activeTool: "marquee",
      marqueeAnchor: { x: 1, y: 1 },
      rightDockOpen: false,
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(
      module.handle(
        uiButtonTouchTapEvent("canvas-right-dock-toolbar-button-exit"),
        exitContext.context,
      ),
    ).toEqual({ status: "handled" });
    expect(exitContext.editor.actions.cancelMarquee).toHaveBeenCalledTimes(1);
    expect(exitContext.editor.actions.clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(exitContext.appHost.internalState.activeTool).toBe("select");
    expect(exitContext.appHost.internalState.workbench.rightDockOpen).toBe(false);
  });
});

function createContext(options: {
  activeTool?: "select" | "move" | "marquee" | "single-placement";
  hypergryphImmediateMarquee?: boolean;
  marqueeAnchor?: GridPoint | null;
  rightDockOpen?: boolean;
} = {}): {
  context: GestureActionContext<AppHost>;
  editor: MockEditor;
  appHost: AppHost;
} {
  const editor: MockEditor = {
    state: {
      collections: {},
    } as EditorContract["state"],
    actions: {
      setMarqueeRange: vi.fn(),
      applyMarquee: vi.fn(),
      cancelMarquee: vi.fn(),
      clearCollection: vi.fn(),
    },
    queries: {
      findGridCellForClientPixlePoint: vi.fn((point) => ({
        x: Math.floor(point.x),
        y: Math.floor(point.y),
      })),
    },
  };
  const toolInfo = {
    marqueeType: EntityCollectionType.marquee,
  };
  const appHost = {
    state: {
      settings: {
        hypergryphOperationMode: true,
        hypergryphImmediateMarquee: options.hypergryphImmediateMarquee ?? false,
      },
      toolInfo,
    },
    internalState: {
      activeTool: options.activeTool ?? "select",
      toolInfo,
      workbench: {
        rightDockOpen: options.rightDockOpen ?? true,
      },
      runtime: {
        moveAnchor: null,
        marqueeAnchor: options.marqueeAnchor ?? null,
        canvasRightDockToolbar: {
          visible: false,
          buttonIds: [],
        },
        canvasTopLeftCornerToolbar: {
          visible: false,
          buttonIds: [],
        },
      },
    },
    internalActions: {
      setActiveTool: vi.fn((activeTool) => {
        appHost.internalState.activeTool = activeTool;
      }),
      toggleRightDock: vi.fn(() => {
        appHost.internalState.workbench.rightDockOpen =
          !appHost.internalState.workbench.rightDockOpen;
      }),
      showCanvasRightDockToolbar: vi.fn((buttonIds) => {
        appHost.internalState.runtime.canvasRightDockToolbar.visible = true;
        appHost.internalState.runtime.canvasRightDockToolbar.buttonIds = [...buttonIds];
      }),
      hideCanvasRightDockToolbar: vi.fn(() => {
        appHost.internalState.runtime.canvasRightDockToolbar.visible = false;
        appHost.internalState.runtime.canvasRightDockToolbar.buttonIds = [];
      }),
      showCanvasTopLeftCornerToolbar: vi.fn((buttonIds) => {
        appHost.internalState.runtime.canvasTopLeftCornerToolbar.visible = true;
        appHost.internalState.runtime.canvasTopLeftCornerToolbar.buttonIds = [...buttonIds];
      }),
      hideCanvasTopLeftCornerToolbar: vi.fn(() => {
        appHost.internalState.runtime.canvasTopLeftCornerToolbar.visible = false;
        appHost.internalState.runtime.canvasTopLeftCornerToolbar.buttonIds = [];
      }),
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
    editor,
    appHost,
  };
}

type MockEditor = {
  state: Pick<EditorContract["state"], "collections">;
  actions: Pick<
    EditorContract["actions"],
    | "applyMarquee"
    | "cancelMarquee"
    | "clearCollection"
    | "setMarqueeRange"
  >;
  queries: Pick<
    EditorContract["queries"],
    "findGridCellForClientPixlePoint"
  >;
};

function keyDownEvent(code: string) {
  return {
    type: "key down" as const,
    gestureId: "key-down-1",
    code,
    key: code === "Escape" ? "Escape" : code.replace("Key", "").toLowerCase(),
    keyCode: code === "Escape" ? 27 : code.replace("Key", "").charCodeAt(0),
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonTouchTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-touch-tap" as const,
    gestureId: `ui-touch-${uiButtonId}`,
    uiButtonId,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonMouseTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-mouse-tap" as const,
    gestureId: `ui-mouse-${uiButtonId}`,
    uiButtonId,
    button: 0,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseDragStartEvent(options: {
  originButton: number;
  pointerEntity: WorldEntity | null;
  position?: GridPoint;
}) {
  return {
    type: "mouse dragstart" as const,
    gestureId: "mouse-drag-1",
    originButton: options.originButton,
    button: options.originButton,
    buttons: 1,
    position: options.position ?? { x: 2, y: 2 },
    startPosition: options.position ?? { x: 2, y: 2 },
    longPress: false,
    pointerEntity: options.pointerEntity,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseDragMoveEvent(options: {
  position: GridPoint;
}) {
  return {
    type: "mouse dragmove" as const,
    gestureId: "mouse-drag-1",
    originButton: 2,
    buttons: 2,
    position: options.position,
    delta: { x: 1, y: 1 },
    longPress: false,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseDragEndEvent() {
  return {
    type: "mouse dragend" as const,
    gestureId: "mouse-drag-1",
    originButton: 2,
    releaseButton: 2,
    button: 2,
    buttons: 0,
    position: { x: 2, y: 3 },
    reason: "release" as const,
    longPress: false,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function touchDragStartEvent(options: {
  longPress: boolean;
  position?: GridPoint;
  pointerEntity?: WorldEntity | null;
}) {
  return {
    type: "touch dragstart" as const,
    gestureId: "touch-drag-1",
    primaryId: 1,
    position: options.position ?? { x: 2, y: 2 },
    startPosition: options.position ?? { x: 2, y: 2 },
    activeTouchCount: 1,
    longPress: options.longPress,
    pointerEntity: options.pointerEntity ?? null,
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
