import { describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";
import {
  createHypergryphMouseViewportPanModule,
  type GestureActionContext,
} from "@/app/input/gesture/actions";
import type { EditorContract } from "@/domain/editor/editor-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { GridRect } from "@/domain/shared/grid";

describe("createHypergryphMouseViewportPanModule", () => {
  it("accepts left mouse drag in select mode", () => {
    const {
      context,
      alignCanvasFloatingToolbar,
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
    expect(alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("ignores left mouse drag in marquee mode", () => {
    const {
      context,
      alignCanvasFloatingToolbar,
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
    expect(alignCanvasFloatingToolbar).not.toHaveBeenCalled();
  });

  it("pans the viewport for non-long-press touch drag gestures", () => {
    const {
      context,
      alignCanvasFloatingToolbar,
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
    expect(alignCanvasFloatingToolbar).toHaveBeenCalledTimes(2);
  });

  it("ignores long-press touch drag gestures", () => {
    const {
      context,
      alignCanvasFloatingToolbar,
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
    expect(alignCanvasFloatingToolbar).not.toHaveBeenCalled();
  });

  it("pans long-press touch drags while placing", () => {
    const {
      context,
      moveViewportByClientPixelVector,
    } = createContext(true, "single-placement");
    const module = createHypergryphMouseViewportPanModule();

    const result = module.handle(
      {
        type: "touch dragstart",
        gestureId: "touch-placement-pan-1",
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

    expect(result).toEqual({ status: "handled" });
    expect(moveViewportByClientPixelVector).toHaveBeenCalledWith({
      startClientPixel: { x: 120, y: 80 },
      endClientPixel: { x: 136, y: 64 },
    });
  });

  it("nudges a mobile placement preview back into the safe viewport after touch pan", () => {
    const {
      context,
      moveCollectionTo,
      previewRectRef,
    } = createMobilePlacementContext();
    const module = createHypergryphMouseViewportPanModule();

    const result = module.handle(
      {
        type: "touch dragstart",
        gestureId: "touch-pan-preview-1",
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

    expect(result).toEqual({ status: "handled" });
    expect(moveCollectionTo).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 20, y: 0 },
      endGridPoint: { x: 3, y: 0 },
    });
    expect(previewRectRef.current).toEqual({ x: 3, y: 0, width: 2, height: 2 });
    expect(context.appHost.internalState.runtime.placementAnchor).toEqual({ x: 3, y: 0 });
  });

  it("only enables the module while hypergryph operation mode is on", () => {
    const module = createHypergryphMouseViewportPanModule();

    expect(module.when?.(createContext(true).context)).toBe(true);
    expect(module.when?.(createContext(false).context)).toBe(false);
  });
});

function createContext(hypergryphOperationMode = true, activeTool: "select" | "marquee" | "single-placement" = "select"): {
  context: GestureActionContext<AppHost>;
  alignCanvasFloatingToolbar: ReturnType<typeof vi.fn>;
  moveViewportByClientPixelVector: ReturnType<typeof vi.fn>;
} {
  const alignCanvasFloatingToolbar = vi.fn(() => true);
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
          activeTool,
        },
        internalActions: {
          alignCanvasFloatingToolbar,
        },
      } as unknown as AppHost,
      keyboard: emptyKeyboardSnapshot(),
    },
    alignCanvasFloatingToolbar,
    moveViewportByClientPixelVector,
  };
}

function createMobilePlacementContext(): {
  context: GestureActionContext<AppHost>;
  moveCollectionTo: ReturnType<typeof vi.fn>;
  previewRectRef: { current: GridRect };
} {
  const previewRectRef = {
    current: { x: 20, y: 0, width: 2, height: 2 },
  };
  const moveViewportByClientPixelVector = vi.fn();
  const moveCollectionTo = vi.fn(({ startGridPoint, endGridPoint }) => {
    previewRectRef.current = {
      ...previewRectRef.current,
      x: previewRectRef.current.x + endGridPoint.x - startGridPoint.x,
      y: previewRectRef.current.y + endGridPoint.y - startGridPoint.y,
    };
  });
  const editor = {
    state: {
      viewport: {
        center: { x: 0, y: 0 },
        clientRect: { left: 0, top: 0, width: 10, height: 10 },
        gridSize: 1,
        gridCellPixelSize: 1,
        displayRotation: 0,
      },
      collections: {
        [EntityCollectionType.selection]: createCollection([]),
        [EntityCollectionType.marquee]: createCollection([]),
        [EntityCollectionType.reverseMarquee]: createCollection([]),
        [EntityCollectionType.preview]: createCollection(["preview-entity"]),
        [EntityCollectionType.ghost]: createCollection([]),
        [EntityCollectionType.logisticsHead]: createCollection([]),
        [EntityCollectionType.powered]: createCollection([]),
        [EntityCollectionType.invalidPlacement]: createCollection([]),
      },
    },
    queries: {
      findEntityCollectionGridRect: vi.fn((collectionType) =>
        collectionType === EntityCollectionType.preview
          ? previewRectRef.current
          : null,
      ),
    },
    actions: {
      moveViewportByClientPixelVector,
      moveCollectionTo,
    },
  } as unknown as EditorContract;

  return {
    context: {
      workspace: {
        editor,
      } as unknown as WorkspaceContract,
      appHost: {
        state: {
          settings: {
            hypergryphOperationMode: true,
          },
          screenProfile: {
            deviceClass: "mobile",
          },
        },
        internalState: {
          activeTool: "single-placement",
          runtime: {
            placementAnchor: { x: 20, y: 0 },
          },
        },
        internalActions: {
          alignCanvasFloatingToolbar: vi.fn(() => true),
        },
      } as unknown as AppHost,
      keyboard: emptyKeyboardSnapshot(),
    },
    moveCollectionTo,
    previewRectRef,
  };
}

type MockCollection = string[] & {
  contains(entityId: string): boolean;
  replace(entityIds: readonly string[]): void;
};

function createCollection(entityIds: readonly string[]): MockCollection {
  const collection = [...entityIds] as MockCollection;
  collection.contains = (entityId: string) => collection.includes(entityId);
  collection.replace = (nextEntityIds: readonly string[]) => {
    collection.splice(0, collection.length, ...nextEntityIds);
  };
  return collection;
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
