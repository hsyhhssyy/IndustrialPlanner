import { describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/app-host";
import type { KeyboardSnapshot } from "@/app/input/gesture-adapter";
import {
  createHypergryphMoveGestureModule,
  type GestureActionContext,
} from "@/app/input/gesture-actions";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import type { EditorContract } from "@/domain/contract/editor-contract";
import type { WorldEntity } from "@/domain/entity/world-document";
import {
  EntityCollectionType,
  type EntityCollectionType as EntityCollectionTypeValue,
} from "@/domain/state/types";
import type { GridPoint, GridRect } from "@/domain/types/grid";

describe("createHypergryphMoveGestureModule", () => {
  it("enters move from mouse long press only when the pointer entity is selected", () => {
    const { context, editor, appHost } = createContext();
    const module = createHypergryphMoveGestureModule();

    const missedResult = module.handle(
      mouseLongPressReadyEvent({
        pointerEntity: entity("unselected-entity", { x: 4, y: 4 }),
      }),
      context,
    );

    expect(missedResult).toEqual({ status: "ignored" });
    expect(editor.actions.createMoveOperationDraft).not.toHaveBeenCalled();
    expect(appHost.internalState.runtime.activeTool).toBe("select");

    const result = module.handle(
      mouseLongPressReadyEvent({
        pointerEntity: entity("selected-entity", { x: 2, y: 2 }),
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(appHost.internalState.runtime.activeTool).toBe("move");
    expect(appHost.internalState.runtime.moveAnchor).toEqual({ x: 2, y: 2 });
    expect(appHost.internalActions.hideCanvasToolbar).toHaveBeenCalled();
  });

  it("rolls back draft state and restores selection when entering move cannot create a preview", () => {
    const { context, editor, appHost, selection, preview } = createContext();
    const module = createHypergryphMoveGestureModule();

    vi.mocked(editor.actions.createMoveOperationDraft).mockImplementation(() => {
      selection.replace([]);
      preview.replace([]);
    });

    const result = module.handle(
      mouseLongPressReadyEvent({
        pointerEntity: entity("selected-entity", { x: 2, y: 2 }),
      }),
      context,
    );

    expect(result).toEqual({ status: "ignored" });
    expect(editor.actions.cancelMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect([...selection]).toEqual(["selected-entity"]);
    expect(appHost.internalState.runtime.activeTool).toBe("select");
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();
  });

  it("uses preview entity hit testing for touch drag start while already moving", () => {
    const { context, appHost } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
    });
    const module = createHypergryphMoveGestureModule();

    const originalEntityResult = module.handle(
      touchDragStartEvent({
        position: { x: 2, y: 2 },
        pointerEntity: entity("selected-entity", { x: 2, y: 2 }),
      }),
      context,
    );

    expect(originalEntityResult).toEqual({ status: "ignored" });
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();

    const previewResult = module.handle(
      touchDragStartEvent({
        position: { x: 5, y: 5 },
        pointerEntity: null,
      }),
      context,
    );

    expect(previewResult).toEqual({ status: "handled" });
    expect(appHost.internalState.runtime.moveAnchor).toEqual({ x: 5, y: 5 });
  });

  it("moves the preview by incremental grid vectors and follows it with the toolbar", () => {
    const { context, editor, appHost, previewRectRef } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();

    vi.mocked(editor.actions.moveCollectionTo).mockImplementation(({
      startGridPoint,
      endGridPoint,
    }) => {
      previewRectRef.current = {
        ...previewRectRef.current,
        x: previewRectRef.current.x + endGridPoint.x - startGridPoint.x,
        y: previewRectRef.current.y + endGridPoint.y - startGridPoint.y,
      };
    });

    const result = module.handle(
      touchDragMoveEvent({
        position: { x: 6, y: 4 },
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.moveCollectionTo).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 5, y: 5 },
      endGridPoint: { x: 6, y: 4 },
    });
    expect(appHost.internalState.runtime.moveAnchor).toEqual({ x: 6, y: 4 });
    expect(appHost.internalActions.moveCanvasToolbar).toHaveBeenCalledWith({
      x: 104,
      y: 56,
    });
  });

  it("applies with a non-long-press left mouse tap and cancels with a right mouse tap", () => {
    const applyContext = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
    });
    const cancelContext = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(mouseTapEvent({ button: 0, longPress: false }), applyContext.context),
    ).toEqual({ status: "handled" });
    expect(applyContext.editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(applyContext.appHost.internalState.runtime.activeTool).toBe("select");
    expect(applyContext.appHost.internalState.runtime.moveAnchor).toBeNull();

    expect(
      module.handle(mouseTapEvent({ button: 2, longPress: false }), cancelContext.context),
    ).toEqual({ status: "handled" });
    expect(cancelContext.editor.actions.cancelMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(cancelContext.appHost.internalState.runtime.activeTool).toBe("select");
    expect(cancelContext.appHost.internalState.runtime.moveAnchor).toBeNull();
  });
});

function createContext(options: {
  activeTool?: "select" | "move" | "marquee" | "placement";
  moveAnchor?: GridPoint | null;
  toolbarVisible?: boolean;
} = {}): {
  context: GestureActionContext<AppHost>;
  editor: MockEditor;
  appHost: AppHost;
  selection: MockCollection;
  preview: MockCollection;
  previewRectRef: { current: GridRect };
} {
  const selection = createCollection(["selected-entity"]);
  const preview = createCollection(["preview-entity"]);
  const ghost = createCollection([]);
  const previewRectRef = {
    current: {
      x: 5,
      y: 5,
      width: 1,
      height: 1,
    },
  };
  const previewEntity = entity("preview-entity", { x: 5, y: 5 });
  const selectedEntity = entity("selected-entity", { x: 2, y: 2 });
  const editor: MockEditor = {
    state: {
      collections: {
        [EntityCollectionType.selection]: selection,
        [EntityCollectionType.preview]: preview,
        [EntityCollectionType.ghost]: ghost,
      },
    },
    queries: {
      getEntityById: vi.fn((entityId: string) => {
        if (entityId === "preview-entity") {
          return previewEntity;
        }

        if (entityId === "selected-entity") {
          return selectedEntity;
        }

        return null;
      }),
      findEntityCollectionGridRect: vi.fn((collectionType) =>
        collectionType === EntityCollectionType.preview && preview.length > 0
          ? previewRectRef.current
          : null,
      ),
      findGridCellForClientPixlePoint: vi.fn((point) => ({
        x: Math.floor(point.x),
        y: Math.floor(point.y),
      })),
      findClientRectForGridCell: vi.fn((cell) => ({
        left: cell.x * 16,
        top: cell.y * 16,
        width: 16,
        height: 16,
      })),
    },
    actions: {
      createMoveOperationDraft: vi.fn(() => {
        selection.replace([]);
        preview.replace(["preview-entity"]);
        ghost.replace(["selected-entity"]);
      }),
      cancelMoveOperationDraft: vi.fn(() => {
        preview.replace([]);
        ghost.replace([]);
      }),
      applyMoveOerationDraft: vi.fn(() => true),
      moveCollectionTo: vi.fn(),
      clearCollection: vi.fn((collectionType: EntityCollectionTypeValue) => {
        (editor.state.collections[collectionType] as MockCollection).replace([]);
      }),
      addToCollection: vi.fn(({
        collectionType,
        entityId,
      }: {
        collectionType: EntityCollectionTypeValue;
        entityId: string;
      }) => {
        const collection = editor.state.collections[collectionType] as MockCollection;
        if (!collection.contains(entityId)) {
          collection.push(entityId);
        }
      }),
    },
  };
  const appHost = {
    state: {
      settings: {
        hypergryphOperationMode: true,
        hypergryphImmediateMove: true,
      },
    },
    internalState: {
      runtime: {
        activeTool: options.activeTool ?? "select",
        moveAnchor: options.moveAnchor ?? null,
        canvasToolbar: {
          visible: options.toolbarVisible ?? false,
          buttonIds: [],
          anchor: null,
        },
      },
    },
    internalActions: {
      setActiveTool: vi.fn((activeTool) => {
        appHost.internalState.runtime.activeTool = activeTool;
      }),
      showCanvasToolbar: vi.fn((_, anchor) => {
        appHost.internalState.runtime.canvasToolbar.visible = true;
        appHost.internalState.runtime.canvasToolbar.anchor = anchor;
      }),
      moveCanvasToolbar: vi.fn(),
      hideCanvasToolbar: vi.fn(() => {
        appHost.internalState.runtime.canvasToolbar.visible = false;
      }),
    },
    workspace: {
      registry: {
        entityDefinitions: [
          {
            id: "belt_straight_1x1",
            name: "Belt",
            spriteId: "belt_straight_1x1",
            footprint: {
              width: 1,
              height: 1,
            },
          },
        ],
      },
    },
  } as unknown as AppHost;

  return {
    context: {
      workspace: {
        registry: appHost.workspace.registry,
        editor,
      } as unknown as WorkspaceContract,
      appHost,
      keyboard: emptyKeyboardSnapshot(),
    },
    editor,
    appHost,
    selection,
    preview,
    previewRectRef,
  };
}

type MockCollection = string[] & {
  contains(entityId: string): boolean;
  replace(entityIds: readonly string[]): void;
};

type MockEditor = {
  state: Pick<EditorContract["state"], "collections">;
  actions: Pick<
    EditorContract["actions"],
    | "addToCollection"
    | "applyMoveOerationDraft"
    | "cancelMoveOperationDraft"
    | "clearCollection"
    | "createMoveOperationDraft"
    | "moveCollectionTo"
  >;
  queries: Pick<
    EditorContract["queries"],
    | "findClientRectForGridCell"
    | "findEntityCollectionGridRect"
    | "findGridCellForClientPixlePoint"
    | "getEntityById"
  >;
};

function createCollection(entityIds: readonly string[]): MockCollection {
  const collection = [...entityIds] as MockCollection;
  collection.contains = (entityId: string) => collection.includes(entityId);
  collection.replace = (nextEntityIds: readonly string[]) => {
    collection.splice(0, collection.length, ...nextEntityIds);
  };
  return collection;
}

function entity(id: string, position: GridPoint): WorldEntity {
  return {
    id,
    definitionId: "belt_straight_1x1",
    position,
    rotation: 0,
    config: {},
    tags: [],
  };
}

function mouseLongPressReadyEvent(options: {
  pointerEntity: WorldEntity | null;
}) {
  return {
    type: "mouse-long-press-ready" as const,
    gestureId: "mouse-ready-1",
    button: 0,
    buttons: 1,
    position: { x: 2, y: 2 },
    pointerEntity: options.pointerEntity,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function touchDragStartEvent(options: {
  position: GridPoint;
  pointerEntity: WorldEntity | null;
}) {
  return {
    type: "touch dragstart" as const,
    gestureId: "touch-drag-1",
    primaryId: 1,
    position: options.position,
    startPosition: options.position,
    activeTouchCount: 1,
    longPress: true,
    pointerEntity: options.pointerEntity,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function touchDragMoveEvent(options: {
  position: GridPoint;
}) {
  return {
    type: "touch dragmove" as const,
    gestureId: "touch-drag-1",
    primaryId: 1,
    position: options.position,
    delta: { x: 1, y: -1 },
    activeTouchCount: 1,
    longPress: true,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseTapEvent(options: {
  button: number;
  longPress: boolean;
}) {
  return {
    type: "mouse tap" as const,
    gestureId: "mouse-tap-1",
    button: options.button,
    buttons: 0,
    position: { x: 6, y: 4 },
    longPress: options.longPress,
    pointerEntity: null,
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
