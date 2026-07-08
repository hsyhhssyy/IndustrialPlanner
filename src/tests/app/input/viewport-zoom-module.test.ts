import { describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";
import {
  createHypergryphViewportZoomModule,
  type GestureActionContext,
} from "@/app/input/gesture/actions";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { EditorContract } from "@/domain/editor/editor-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridRect } from "@/domain/shared/grid";

describe("createHypergryphViewportZoomModule", () => {
  it("nudges a mobile placement preview back into the safe viewport after pinch zoom", () => {
    const {
      context,
      moveCollectionTo,
      previewRectRef,
      zoom,
    } = createMobilePlacementContext();
    const module = createHypergryphViewportZoomModule();

    const result = module.handle(
      {
        type: "pinch out",
        gestureId: "pinch-preview-1",
        center: { x: 5, y: 5 },
        scaleDelta: 2,
        distanceDelta: 10,
        activeTouchCount: 2,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(zoom).toHaveBeenCalledWith(4);
    expect(moveCollectionTo).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 20, y: 0 },
      endGridPoint: { x: 3, y: 0 },
    });
    expect(previewRectRef.current).toEqual({ x: 3, y: 0, width: 2, height: 2 });
    expect(context.appHost.internalState.runtime.placementAnchor).toEqual({ x: 3, y: 0 });
  });
});

function createMobilePlacementContext(): {
  context: GestureActionContext<AppHost>;
  moveCollectionTo: ReturnType<typeof vi.fn>;
  previewRectRef: { current: GridRect };
  zoom: ReturnType<typeof vi.fn>;
} {
  const previewRectRef = {
    current: { x: 20, y: 0, width: 2, height: 2 },
  };
  const zoom = vi.fn();
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
      zoom,
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
    zoom,
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
