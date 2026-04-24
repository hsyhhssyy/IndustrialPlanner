import { describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/app-host";
import type { KeyboardSnapshot } from "@/app/input/gesture-adapter";
import {
  createMouseViewportPanModule,
  type GestureActionContext,
} from "@/app/input/gesture-actions";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";

describe("createMouseViewportPanModule", () => {
  it("pans the viewport for non-long-press touch drag gestures", () => {
    const { context, moveViewportByViewportPixelVector } = createContext();
    const module = createMouseViewportPanModule();

    const startResult = module.handle(
      {
        type: "touch dragstart",
        gestureId: "touch-pan-1",
        primaryId: 1,
        position: { x: 136, y: 64 },
        startPosition: { x: 120, y: 80 },
        activeTouchCount: 1,
        longPress: false,
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
    expect(moveViewportByViewportPixelVector).toHaveBeenNthCalledWith(1, {
      startViewportPixel: { x: 20, y: 30 },
      endViewportPixel: { x: 36, y: 14 },
    });
    expect(moveViewportByViewportPixelVector).toHaveBeenNthCalledWith(2, {
      startViewportPixel: { x: 36, y: 14 },
      endViewportPixel: { x: 40, y: 22 },
    });
  });

  it("ignores long-press touch drag gestures", () => {
    const { context, moveViewportByViewportPixelVector } = createContext();
    const module = createMouseViewportPanModule();

    const startResult = module.handle(
      {
        type: "touch dragstart",
        gestureId: "touch-pan-2",
        primaryId: 1,
        position: { x: 136, y: 64 },
        startPosition: { x: 120, y: 80 },
        activeTouchCount: 1,
        longPress: true,
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
    expect(moveViewportByViewportPixelVector).not.toHaveBeenCalled();
  });
});

function createContext(): {
  context: GestureActionContext<AppHost>;
  moveViewportByViewportPixelVector: ReturnType<typeof vi.fn>;
} {
  const moveViewportByViewportPixelVector = vi.fn();
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
        moveViewportByViewportPixelVector,
      },
    },
  } as WorkspaceContract;

  return {
    context: {
      workspace,
      appHost: {} as AppHost,
      keyboard: emptyKeyboardSnapshot(),
    },
    moveViewportByViewportPixelVector,
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