import { describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import {
  MOBILE_PREVIEW_SAFE_INSET_CELLS,
  nudgeMobilePreviewIntoSafeViewport,
} from "@/app/input/gesture/actions/hypergryph/mobile-preview-bounds";
import type { EditorContract } from "@/domain/editor/editor-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRect } from "@/domain/shared/grid";

describe("mobile preview bounds", () => {
  it("keeps the preview inside the mobile safe area with at least one visible grid cell", () => {
    expect(MOBILE_PREVIEW_SAFE_INSET_CELLS).toEqual({ x: 1, y: 1 });

    const { appHost, editor, previewRectRef } = createContext({
      previewRect: { x: 20, y: 0, width: 2, height: 2 },
      placementAnchor: { x: 20, y: 0 },
    });

    expect(nudgeMobilePreviewIntoSafeViewport({ appHost, editor })).toBe(true);

    expect(editor.actions.moveCollectionTo).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 20, y: 0 },
      endGridPoint: { x: 3, y: 0 },
    });
    expect(previewRectRef.current).toEqual({ x: 3, y: 0, width: 2, height: 2 });
    expect(appHost.internalState.runtime.placementAnchor).toEqual({ x: 3, y: 0 });
  });

  it("does not move when one grid cell is already visible inside the safe area", () => {
    const { appHost, editor, previewRectRef } = createContext({
      previewRect: { x: 3, y: 0, width: 2, height: 2 },
      placementAnchor: { x: 3, y: 0 },
    });

    expect(nudgeMobilePreviewIntoSafeViewport({ appHost, editor })).toBe(false);

    expect(editor.actions.moveCollectionTo).not.toHaveBeenCalled();
    expect(previewRectRef.current).toEqual({ x: 3, y: 0, width: 2, height: 2 });
    expect(appHost.internalState.runtime.placementAnchor).toEqual({ x: 3, y: 0 });
  });

  it("keeps move anchors in sync when nudging a move preview", () => {
    const { appHost, editor } = createContext({
      activeTool: "move",
      moveAnchor: { x: -20, y: 0 },
      previewRect: { x: -20, y: 0, width: 2, height: 2 },
    });

    expect(nudgeMobilePreviewIntoSafeViewport({ appHost, editor })).toBe(true);

    expect(editor.actions.moveCollectionTo).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: -20, y: 0 },
      endGridPoint: { x: -5, y: 0 },
    });
    expect(appHost.internalState.runtime.moveAnchor).toEqual({ x: -5, y: 0 });
  });
});

function createContext(options: {
  activeTool?: "single-placement" | "blueprint-placement" | "move";
  placementAnchor?: GridPoint | null;
  moveAnchor?: GridPoint | null;
  previewRect: GridRect;
}): {
  appHost: AppHost;
  editor: EditorContract;
  previewRectRef: { current: GridRect };
} {
  const previewRectRef = {
    current: options.previewRect,
  };
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
      moveCollectionTo: vi.fn(({ startGridPoint, endGridPoint }) => {
        previewRectRef.current = {
          ...previewRectRef.current,
          x: previewRectRef.current.x + endGridPoint.x - startGridPoint.x,
          y: previewRectRef.current.y + endGridPoint.y - startGridPoint.y,
        };
      }),
    },
  } as unknown as EditorContract;

  const appHost = {
    state: {
      screenProfile: {
        deviceClass: "mobile",
      },
    },
    internalState: {
      activeTool: options.activeTool ?? "single-placement",
      runtime: {
        placementAnchor: options.placementAnchor ?? null,
        moveAnchor: options.moveAnchor ?? null,
      },
    },
  } as unknown as AppHost;

  return {
    appHost,
    editor,
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
