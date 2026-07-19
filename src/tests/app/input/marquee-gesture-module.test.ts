import { describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";
import { WorkbenchOverlapEntityMenuController } from "@/app/shell/state/overlap-entity-menu-state";
import {
  createHypergryphMarqueeGestureModule,
  type GestureActionContext,
} from "@/app/input/gesture/actions";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { EditorContract, EditorSnapshotStore } from "@/domain/editor/editor-contract";
import {
  createWorldDocument,
  type WorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import {
  EntityCollectionType,
  type EntityCollection,
} from "@/domain/editor/types/editor-types";
import type { GridPoint } from "@/domain/shared/grid";
import { createRegistryContract } from "@/registry";

describe("createHypergryphMarqueeGestureModule", () => {
  it("enters and exits marquee from the X key", () => {
    const { context, appHost, editor } = createContext({
      selectedEntityIds: ["entity-1"],
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(module.handle(keyDownEvent("KeyX"), context)).toEqual({ status: "handled" });
    expect(appHost.internalState.activeTool).toBe("marquee");
    expect(appHost.internalActions.showCanvasRightDockToolbar).toHaveBeenCalledWith(
      [
        "canvas-right-dock-toolbar-button-exit",
        "canvas-right-dock-toolbar-button-move",
        "canvas-right-dock-toolbar-button-copy",
        "canvas-right-dock-toolbar-button-save-blueprint",
        "canvas-right-dock-toolbar-button-delete",
      ],
      "shortcut",
    );
    expect(appHost.internalState.runtime.canvasRightDockToolbar.mode).toBe("shortcut");

    expect(module.handle(keyDownEvent("KeyX"), context)).toEqual({ status: "handled" });
    expect(editor.actions.cancelMarquee).toHaveBeenCalledTimes(1);
    expect(editor.actions.clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(appHost.internalState.activeTool).toBe("select");
    expect(appHost.internalState.runtime.marqueeAnchor).toBeNull();
    expect(appHost.state.toolInfo.marqueeType).toBe(EntityCollectionType.marquee);
  });

  it("enters touch marquee from the placement button and collapses the right dock", () => {
    const { context, appHost } = createContext({
      selectedEntityIds: ["entity-1"],
    });
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
      "canvas-right-dock-toolbar-button-copy",
      "canvas-right-dock-toolbar-button-save-blueprint",
      "canvas-right-dock-toolbar-button-delete",
    ], "icon");
    expect(appHost.internalState.runtime.canvasRightDockToolbar.mode).toBe("icon");
    expect(appHost.internalActions.showCanvasTopLeftCornerToolbar).toHaveBeenCalledWith([
      "canvas-top-left-corner-toolbar-button-toggle-pipe",
      "canvas-top-left-corner-toolbar-button-toggle-belt",
      "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee",
    ]);
    expect(appHost.internalState.workbench.rightDockOpen).toBe(false);
  });

  it("enters mouse marquee with shortcut mode toolbar from the placement button", () => {
    const { context, appHost } = createContext({
      selectedEntityIds: ["entity-1"],
    });
    const module = createHypergryphMarqueeGestureModule();

    const result = module.handle(
      uiButtonMouseTapEvent("placement-tool-marquee"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(appHost.internalState.activeTool).toBe("marquee");
    expect(appHost.internalActions.showCanvasRightDockToolbar).toHaveBeenCalledWith(
      [
        "canvas-right-dock-toolbar-button-exit",
        "canvas-right-dock-toolbar-button-move",
        "canvas-right-dock-toolbar-button-copy",
        "canvas-right-dock-toolbar-button-save-blueprint",
        "canvas-right-dock-toolbar-button-delete",
      ],
      "shortcut",
    );
    expect(appHost.internalState.runtime.canvasRightDockToolbar.mode).toBe("shortcut");
  });

  it("shows selection action buttons only while the marquee selection is non-empty", () => {
    const { context, appHost } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMarqueeGestureModule();
    const entity = { id: "entity-1" } as WorldEntity;

    expect(module.handle(mouseTapEvent(entity), context)).toEqual({ status: "handled" });
    expect(appHost.internalState.runtime.canvasRightDockToolbar.buttonIds).toEqual([
      "canvas-right-dock-toolbar-button-exit",
      "canvas-right-dock-toolbar-button-move",
      "canvas-right-dock-toolbar-button-copy",
      "canvas-right-dock-toolbar-button-save-blueprint",
      "canvas-right-dock-toolbar-button-delete",
    ]);

    expect(module.handle(mouseTapEvent(entity), context)).toEqual({ status: "handled" });
    expect(appHost.internalState.runtime.canvasRightDockToolbar.buttonIds).toEqual([
      "canvas-right-dock-toolbar-button-exit",
    ]);
  });

  it("toggles the whole strict logistics segment when tapping a belt in marquee mode", () => {
    const beltA = entity("belt-a", "belt_straight_1x1", { x: 0, y: 0 });
    const beltB = entity("belt-b", "belt_straight_1x1", { x: 1, y: 0 });
    const beltC = entity("belt-c", "belt_straight_1x1", { x: 2, y: 0 });
    const pipe = entity("pipe-a", "pipe_straight_1x1", { x: 0, y: 1 });
    const { context, editor } = createContext({
      activeTool: "marquee",
      document: createDocumentWithEntities([beltA, beltB, beltC, pipe]),
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(module.handle(mouseTapEvent(beltB), context)).toEqual({ status: "handled" });
    expect([...editor.state.collections.selection].sort()).toEqual([
      "belt-a",
      "belt-b",
      "belt-c",
    ]);
    expect(editor.state.collections.selection.contains("pipe-a")).toBe(false);

    expect(module.handle(mouseTapEvent(beltB), context)).toEqual({ status: "handled" });
    expect([...editor.state.collections.selection]).toEqual([]);
  });

  it("toggles the whole strict logistics segment when tapping a pipe in marquee mode", () => {
    const pipeA = entity("pipe-a", "pipe_straight_1x1", { x: 0, y: 0 });
    const pipeB = entity("pipe-b", "pipe_straight_1x1", { x: 1, y: 0 });
    const pipeC = entity("pipe-c", "pipe_straight_1x1", { x: 2, y: 0 });
    const belt = entity("belt-a", "belt_straight_1x1", { x: 0, y: 1 });
    const { context, editor } = createContext({
      activeTool: "marquee",
      document: createDocumentWithEntities([pipeA, pipeB, pipeC, belt]),
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(module.handle(mouseTapEvent(pipeB), context)).toEqual({ status: "handled" });
    expect([...editor.state.collections.selection].sort()).toEqual([
      "pipe-a",
      "pipe-b",
      "pipe-c",
    ]);
    expect(editor.state.collections.selection.contains("belt-a")).toBe(false);
  });

  it("toggles the whole strict logistics segment from the overlap entity menu in marquee mode", () => {
    const beltA = entity("belt-a", "belt_straight_1x1", { x: 0, y: 0 });
    const beltB = entity("belt-b", "belt_straight_1x1", { x: 1, y: 0 });
    const beltC = entity("belt-c", "belt_straight_1x1", { x: 2, y: 0 });
    const pipe = entity("pipe-a", "pipe_straight_1x1", { x: 1, y: 0 });
    const { context, appHost, editor } = createContext({
      activeTool: "marquee",
      document: createDocumentWithEntities([beltA, beltB, beltC, pipe]),
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(module.handle(mouseTapEvent(pipe, { x: 1, y: 0 }), context)).toEqual({ status: "handled" });
    expect(appHost.overlapEntityMenu.visible).toBe(true);
    expect(appHost.overlapEntityMenu.candidates.map((candidate) => candidate.entityId)).toEqual([
      "pipe-a",
      "belt-b",
    ]);
    expect(editor.actions.addToCollection).not.toHaveBeenCalled();

    appHost.overlapEntityMenu.select("belt-b");

    expect([...editor.state.collections.selection].sort()).toEqual([
      "belt-a",
      "belt-b",
      "belt-c",
    ]);
    expect(editor.state.collections.selection.contains("pipe-a")).toBe(false);
  });

  it("keeps marquee drag selection delegated to applyMarquee without expanding strict logistics segments", () => {
    const beltA = entity("belt-a", "belt_straight_1x1", { x: 0, y: 0 });
    const beltB = entity("belt-b", "belt_straight_1x1", { x: 1, y: 0 });
    const { context, editor } = createContext({
      activeTool: "marquee",
      document: createDocumentWithEntities([beltA, beltB]),
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(
      module.handle(
        mouseDragStartEvent({
          originButton: 0,
          pointerEntity: null,
          position: { x: 0, y: 0 },
        }),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(module.handle(mouseDragEndEvent(), context).status).toBe("handled");

    expect(editor.actions.applyMarquee).toHaveBeenCalledTimes(1);
    expect(editor.actions.addToCollection).not.toHaveBeenCalled();
    expect(editor.actions.removeFromCollection).not.toHaveBeenCalled();
  });

  it("closes the left dock on marquee enter for mobile and tablet", () => {
    for (const deviceClass of ["mobile", "tablet"] as const) {
      const { context, appHost } = createContext({
        deviceClass,
        leftDockOpen: true,
      });
      const module = createHypergryphMarqueeGestureModule();

      expect(module.handle(keyDownEvent("KeyX"), context)).toEqual({ status: "handled" });
      expect(appHost.internalActions.setLeftDockSuppressed).not.toHaveBeenCalled();

      expect(
        module.handle(onEnterActiveToolEvent("select", "marquee"), context),
      ).toEqual({ status: "handled" });
      expect(appHost.internalActions.setLeftDockSuppressed).toHaveBeenCalledTimes(1);
      expect(appHost.internalActions.setLeftDockSuppressed).toHaveBeenCalledWith(true);
      expect(appHost.state.workbench.leftDockOpen).toBe(true);
      expect(appHost.internalState.workbench.leftDockSuppressed).toBe(true);
    }
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
    ], "icon");
    expect(appHost.internalActions.showCanvasTopLeftCornerToolbar).toHaveBeenCalledWith([
      "canvas-top-left-corner-toolbar-button-toggle-pipe",
      "canvas-top-left-corner-toolbar-button-toggle-belt",
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

  it("resets logistics suppression when exiting marquee", () => {
    const { context, editor } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMarqueeGestureModule();
    const setLogisticsSuppression = vi.mocked(editor.actions.setLogisticsSuppression);

    expect(
      module.handle(
        uiButtonTouchTapEvent("canvas-top-left-corner-toolbar-button-toggle-belt-on"),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(setLogisticsSuppression).toHaveBeenLastCalledWith("belt", true);

    expect(
      module.handle(
        uiButtonTouchTapEvent("canvas-right-dock-toolbar-button-exit"),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(setLogisticsSuppression.mock.calls.slice(-2)).toEqual([
      ["belt", false],
      ["pipe", false],
    ]);
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
  leftDockOpen?: boolean;
  deviceClass?: "desktop" | "tablet" | "mobile";
  selectedEntityIds?: readonly string[];
  document?: WorldDocument;
  registry?: RegistryContract;
} = {}): {
  context: GestureActionContext<AppHost>;
  editor: MockEditor;
  appHost: AppHost;
} {
  const selection = createSelectionCollection(options.selectedEntityIds ?? []);
  const mutableSelection = selection as unknown as string[];
  const documentSnapshot = options.document ?? createDocumentWithEntities([]);
  const editor: MockEditor = {
    document: {
      getSnapshot: vi.fn(() => documentSnapshot),
    } as unknown as EditorSnapshotStore<WorldDocument>,
    state: {
      collections: {
        selection,
      },
    } as EditorContract["state"],
    actions: {
      setMarqueeRange: vi.fn(),
      applyMarquee: vi.fn(),
      cancelMarquee: vi.fn(),
      clearCollection: vi.fn((collectionType) => {
        if (collectionType === EntityCollectionType.selection) {
          mutableSelection.splice(0, mutableSelection.length);
        }
      }),
      addToCollection: vi.fn(({ collectionType, entityId }) => {
        if (
          collectionType === EntityCollectionType.selection
          && !selection.includes(entityId)
        ) {
          mutableSelection.push(entityId);
        }
      }),
      removeFromCollection: vi.fn(({ collectionType, entityId }) => {
        if (collectionType !== EntityCollectionType.selection) {
          return;
        }

        const index = selection.indexOf(entityId);
        if (index >= 0) {
          mutableSelection.splice(index, 1);
        }
      }),
      setLogisticsSuppression: vi.fn(),
      setHoverPoint: vi.fn(),
      clearHoverPoint: vi.fn(),
    },
    queries: {
      getEntityById: vi.fn((entityId) => documentSnapshot.entities[entityId] ?? null),
      listEntities: vi.fn(() => documentSnapshot.entityOrder.flatMap((entityId) => {
        const currentEntity = documentSnapshot.entities[entityId];
        return currentEntity === undefined ? [] : [currentEntity];
      })),
      findGridCellForClientPixelPoint: vi.fn((point) => ({
        x: Math.floor(point.x),
        y: Math.floor(point.y),
      })),
    },
  };
  const toolInfo = {
    marqueeType: EntityCollectionType.marquee,
  };
  const workbenchState = {
    leftDockOpen: options.leftDockOpen ?? true,
    leftDockSuppressed: false,
    rightDockOpen: options.rightDockOpen ?? true,
  };
  const workspace = {
    editor,
    registry: options.registry ?? createRegistryContract(),
  } as unknown as WorkspaceContract;
  const appHost = {
    workspace,
    state: {
      settings: {
        hypergryphOperationMode: true,
        hypergryphImmediateMarquee: options.hypergryphImmediateMarquee ?? false,
      },
      toolInfo,
      screenProfile: {
        deviceClass: options.deviceClass ?? "desktop",
      },
      workbench: workbenchState,
    },
    internalState: {
      activeTool: options.activeTool ?? "select",
      toolInfo,
      workbench: workbenchState,
      runtime: {
        moveAnchor: null,
        marqueeAnchor: options.marqueeAnchor ?? null,
        canvasRightDockToolbar: {
          visible: false,
          buttonIds: [] as string[],
          mode: "icon" as "icon" | "shortcut",
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
      setLeftDockSuppressed: vi.fn((suppressed) => {
        appHost.internalState.workbench.leftDockSuppressed = suppressed;
      }),
      toggleRightDock: vi.fn(() => {
        appHost.internalState.workbench.rightDockOpen =
          !appHost.internalState.workbench.rightDockOpen;
      }),
      showCanvasRightDockToolbar: vi.fn((buttonIds, mode: "icon" | "shortcut" = "icon") => {
        appHost.internalState.runtime.canvasRightDockToolbar.visible = true;
        appHost.internalState.runtime.canvasRightDockToolbar.buttonIds = [...buttonIds];
        appHost.internalState.runtime.canvasRightDockToolbar.mode = mode;
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
    overlapEntityMenu: new WorkbenchOverlapEntityMenuController(),
  } as unknown as AppHost;

  return {
    context: {
      workspace,
      appHost,
      keyboard: emptyKeyboardSnapshot(),
    },
    editor,
    appHost,
  };
}

type MockEditor = {
  document: Pick<EditorContract["document"], "getSnapshot">;
  state: Pick<EditorContract["state"], "collections">;
  actions: Pick<
    EditorContract["actions"],
    | "applyMarquee"
    | "cancelMarquee"
    | "clearCollection"
    | "addToCollection"
    | "removeFromCollection"
    | "setMarqueeRange"
    | "setLogisticsSuppression"
    | "setHoverPoint"
    | "clearHoverPoint"
  >;
  queries: Pick<
    EditorContract["queries"],
    | "findGridCellForClientPixelPoint"
    | "getEntityById"
    | "listEntities"
  >;
};

function createSelectionCollection(entityIds: readonly string[]): EntityCollection {
  const selection = [...entityIds] as string[] & EntityCollection;
  selection.contains = (entityId: string) => selection.includes(entityId);
  return selection;
}

function createDocumentWithEntities(entities: readonly WorldEntity[]): WorldDocument {
  const document = createWorldDocument();
  return {
    ...document,
    entities: Object.fromEntries(entities.map((currentEntity) => [
      currentEntity.id,
      currentEntity,
    ])),
    entityOrder: entities.map((currentEntity) => currentEntity.id),
  };
}

function entity(
  id: string,
  definitionId = "grinder_1",
  position: GridPoint = { x: 0, y: 0 },
): WorldEntity {
  return {
    id,
    definitionId,
    position,
    rotation: 0,
    config: {},
    tags: [],
  };
}

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

function mouseTapEvent(pointerEntity: WorldEntity, position: GridPoint = { x: 2, y: 2 }) {
  return {
    type: "mouse tap" as const,
    gestureId: `mouse-tap-${pointerEntity.id}`,
    button: 0,
    buttons: 0,
    position,
    longPress: false,
    pointerEntity,
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

function onEnterActiveToolEvent(
  from: "select" | "move" | "marquee" | "single-placement" | "logistics-placement",
  to: "select" | "move" | "marquee" | "single-placement" | "logistics-placement",
) {
  return {
    type: "on-enter-active-tool" as const,
    gestureId: "enter-active-tool-1",
    from,
    to,
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
