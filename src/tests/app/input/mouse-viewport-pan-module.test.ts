import { describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/app-host";
import type { KeyboardSnapshot } from "@/app/input/gesture-adapter";
import {
  createHypergryphMouseViewportPanModule,
  type GestureActionContext,
} from "@/app/input/gesture-actions";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";

describe("createHypergryphMouseViewportPanModule", () => {
  it("accepts left mouse drag in select mode", () => {
    const {
      context,
      alignCanvasToolbar,
      moveViewportByClientPixelVector,
    } = createContext(true, "select");
    const module = createHypergryphMouseViewportPanModule();

    const startResult = module.handle(
      {
        type: "mouse dragstart",
        gestureId: "mouse-pan-1",
        originButton: 0,
        button: 0,
        buttons: 1,
        position: { x: 130, y: 70 },
        startPosition: { x: 120, y: 80 },
        longPress: false,
        pointerEntity: null,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(startResult).toEqual({ status: "handled" });
    expect(moveViewportByClientPixelVector).toHaveBeenCalledWith({
      startClientPixel: { x: 120, y: 80 },
      endClientPixel: { x: 130, y: 70 },
    });
    expect(alignCanvasToolbar).toHaveBeenCalledTimes(1);
  });

  it("ignores left mouse drag in marquee mode", () => {
    const {
      context,
      alignCanvasToolbar,
      moveViewportByClientPixelVector,
    } = createContext(true, "marquee");
    const module = createHypergryphMouseViewportPanModule();

    const startResult = module.handle(
      {
        type: "mouse dragstart",
        gestureId: "mouse-pan-2",
        originButton: 0,
        button: 0,
        buttons: 1,
        position: { x: 130, y: 70 },
        startPosition: { x: 120, y: 80 },
        longPress: false,
        pointerEntity: null,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(startResult).toEqual({ status: "ignored" });
    expect(moveViewportByClientPixelVector).not.toHaveBeenCalled();
    expect(alignCanvasToolbar).not.toHaveBeenCalled();
  });

  it("pans the viewport for non-long-press touch drag gestures", () => {
    const {
      context,
      alignCanvasToolbar,
      moveViewportByClientPixelVector,
    } = createContext();
    const module = createHypergryphMouseViewportPanModule();

    const startResult = module.handle(
      {
        type: "touch dragstart",
        gestureId: "touch-pan-1",
        primaryId: 1,
        position: { x: 136, y: 64 },
        startPosition: { x: 120, y: 80 },
        activeTouchCount: 1,
        longPress: false,
        pointerEntity: null,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );
    const moveResult = module.handle(
      {
        type: "touch dragmove",
        gestureId: "touch-pan-1",
        primaryId: 1,
        position: { x: 140, y: 72 },
        delta: { x: 4, y: 8 },
        activeTouchCount: 1,
        longPress: false,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );
    const endResult = module.handle(
      {
        type: "touch dragend",
        gestureId: "touch-pan-1",
        primaryId: 1,
        position: { x: 140, y: 72 },
        reason: "release",
        longPress: false,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(startResult).toEqual({ status: "handled" });
    expect(moveResult).toEqual({ status: "handled" });
    expect(endResult).toEqual({ status: "handled" });
    expect(moveViewportByClientPixelVector).toHaveBeenNthCalledWith(1, {
      startClientPixel: { x: 120, y: 80 },
      endClientPixel: { x: 136, y: 64 },
    });
    expect(moveViewportByClientPixelVector).toHaveBeenNthCalledWith(2, {
      startClientPixel: { x: 136, y: 64 },
      endClientPixel: { x: 140, y: 72 },
    });
    expect(alignCanvasToolbar).toHaveBeenCalledTimes(2);
  });

  it("ignores long-press touch drag gestures", () => {
    const {
      context,
      alignCanvasToolbar,
      moveViewportByClientPixelVector,
    } = createContext();
    const module = createHypergryphMouseViewportPanModule();

    const startResult = module.handle(
      {
        type: "touch dragstart",
        gestureId: "touch-pan-2",
        primaryId: 1,
        position: { x: 136, y: 64 },
        startPosition: { x: 120, y: 80 },
        activeTouchCount: 1,
        longPress: true,
        pointerEntity: null,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );
    const moveResult = module.handle(
      {
        type: "touch dragmove",
        gestureId: "touch-pan-2",
        primaryId: 1,
        position: { x: 140, y: 72 },
        delta: { x: 4, y: 8 },
        activeTouchCount: 1,
        longPress: true,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );
    const endResult = module.handle(
      {
        type: "touch dragend",
        gestureId: "touch-pan-2",
        primaryId: 1,
        position: { x: 140, y: 72 },
        reason: "release",
        longPress: true,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(startResult).toEqual({ status: "ignored" });
    expect(moveResult).toEqual({ status: "ignored" });
    expect(endResult).toEqual({ status: "ignored" });
    expect(moveViewportByClientPixelVector).not.toHaveBeenCalled();
    expect(alignCanvasToolbar).not.toHaveBeenCalled();
  });

  it("only enables the module while hypergryph operation mode is on", () => {
    const module = createHypergryphMouseViewportPanModule();

    expect(module.when?.(createContext(true).context)).toBe(true);
    expect(module.when?.(createContext(false).context)).toBe(false);
  });
});

function createContext(hypergryphOperationMode = true, activeTool: "select" | "marquee" | "placement" = "select"): {
  context: GestureActionContext<AppHost>;
  alignCanvasToolbar: ReturnType<typeof vi.fn>;
  moveViewportByClientPixelVector: ReturnType<typeof vi.fn>;
} {
  const alignCanvasToolbar = vi.fn(() => true);
  const moveViewportByClientPixelVector = vi.fn();
  const workspace = {
    editor: {
      state: {
        viewport: {
          clientRect: {
            left: 100,
            top: 50,
          },
        },
      },
      actions: {
        moveViewportByClientPixelVector,
      },
    },
  } as unknown as WorkspaceContract;

  return {
    context: {
      workspace,
      appHost: {
        state: {
          settings: {
            hypergryphOperationMode,
          },
        },
        internalState: {
          runtime: {
            activeTool,
          },
        },
        internalActions: {
          alignCanvasToolbar,
        },
      } as unknown as AppHost,
      keyboard: emptyKeyboardSnapshot(),
    },
    alignCanvasToolbar,
    moveViewportByClientPixelVector,
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
