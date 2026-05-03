import { describe, expect, it, vi } from "vitest";
import { makeAutoObservable, runInAction } from "mobx";

import type { AppHost } from "@/app/host/app-host";
import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";
import {
  createHypergryphSelectGestureModule,
  hookSelectToolToolbarFallback,
  type GestureActionContext,
} from "@/app/input/gesture/actions";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import type { WorldEntity } from "@/domain/entity/world-document";
import type { ActiveTool, EntityCollection } from "@/domain/state/types";
import { EntityCollectionType } from "@/domain/state/types";

describe("createHypergryphSelectGestureModule", () => {
  it("clears the selection collection before selecting a different clicked entity and shows move/delete actions", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      isDedicatedLogisticsDevice,
      showCanvasFloatingToolbarForCollection,
    } = createContext();
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-1",
        button: 0,
        buttons: 0,
        position: { x: 48, y: 32 },
        longPress: false,
        pointerEntity: entity("entity-1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "entity-1",
    });
    expect(showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      [
        "canvas-floating-toolbar-button-move",
        "canvas-floating-toolbar-button-delete",
      ],
      EntityCollectionType.selection,
    );
    expect(isDedicatedLogisticsDevice).toHaveBeenCalledWith("not-strict-device");
  });

  it("keeps the current selection when the clicked entity is already selected", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      showCanvasFloatingToolbarForCollection,
    } = createContext("select", true, ["entity-1"]);
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-keep-1",
        button: 0,
        buttons: 0,
        position: { x: 48, y: 32 },
        longPress: false,
        pointerEntity: entity("entity-1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(clearCollection).not.toHaveBeenCalled();
    expect(addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "entity-1",
    });
    expect(showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      [
        "canvas-floating-toolbar-button-move",
        "canvas-floating-toolbar-button-delete",
      ],
      EntityCollectionType.selection,
    );
  });

  it("clears the selection collection before selecting a different tapped entity", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      showCanvasFloatingToolbarForCollection,
    } = createContext();
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "touch tap",
        gestureId: "touch-select-1",
        primaryId: 3,
        position: { x: 72, y: 40 },
        longPress: false,
        pointerEntity: entity("entity-2"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "entity-2",
    });
    expect(showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      [
        "canvas-floating-toolbar-button-move",
        "canvas-floating-toolbar-button-delete",
      ],
      EntityCollectionType.selection,
    );
  });

  it.each([
    "belt_straight_1x1",
    "pipe_turn_cw_1x1",
  ])("adds batch delete for strict logistics selections (%s)", (definitionId) => {
    const {
      context,
      isDedicatedLogisticsDevice,
      showCanvasFloatingToolbarForCollection,
    } = createContext();
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: `mouse-select-strict-${definitionId}`,
        button: 0,
        buttons: 0,
        position: { x: 48, y: 32 },
        longPress: false,
        pointerEntity: entity("entity-strict", definitionId),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      [
        "canvas-floating-toolbar-button-move",
        "canvas-floating-toolbar-button-delete",
        "canvas-floating-toolbar-button-delete-many",
      ],
      EntityCollectionType.selection,
    );
    expect(isDedicatedLogisticsDevice).toHaveBeenCalledWith(definitionId);
  });

  it("clears the selection collection on right click in select mode", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      hideCanvasFloatingToolbar,
    } = createContext();
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-clear-1",
        button: 2,
        buttons: 0,
        position: { x: 24, y: 16 },
        longPress: false,
        pointerEntity: entity("entity-3"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(addToCollection).not.toHaveBeenCalled();
    expect(hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("ignores select taps when no entity is under the pointer", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      showCanvasFloatingToolbarForCollection,
      hideCanvasFloatingToolbar,
    } = createContext();
    const module = createHypergryphSelectGestureModule();

    const mouseResult = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-ignored-1",
        button: 0,
        buttons: 0,
        position: { x: 12, y: 8 },
        longPress: false,
        pointerEntity: null,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );
    const touchResult = module.handle(
      {
        type: "touch tap",
        gestureId: "touch-select-ignored-1",
        primaryId: 4,
        position: { x: 12, y: 8 },
        longPress: false,
        pointerEntity: null,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(mouseResult).toEqual({ status: "ignored" });
    expect(touchResult).toEqual({ status: "ignored" });
    expect(addToCollection).not.toHaveBeenCalled();
    expect(clearCollection).not.toHaveBeenCalled();
    expect(showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();
    expect(hideCanvasFloatingToolbar).not.toHaveBeenCalled();
  });

  it("only responds while select mode and hypergryph mode are active", () => {
    const module = createHypergryphSelectGestureModule();
    const disabledContext = createContext("select", false).context;
    const moveContext = createContext("move").context;

    expect(module.when?.(disabledContext)).toBe(false);
    expect(
      module.handle(
        {
          type: "mouse tap",
          gestureId: "mouse-select-ignored-2",
          button: 0,
          buttons: 0,
          position: { x: 12, y: 8 },
          longPress: false,
          pointerEntity: entity("entity-4"),
          modifiers: emptyModifiers(),
          sourceEvent: null,
        },
        moveContext,
      ),
    ).toEqual({ status: "ignored" });
  });

  it("shows the select toolbar again when another tool returns to select with a preserved selection", () => {
    const {
      appHost,
      showCanvasFloatingToolbarForCollection,
    } = createToolbarFallbackContext({
      activeTool: "move",
      selectedEntities: [entity("entity-1")],
    });
    const dispose = hookSelectToolToolbarFallback(appHost);

    runInAction(() => {
      appHost.internalState.activeTool = "select";
    });

    expect(showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      [
        "canvas-floating-toolbar-button-move",
        "canvas-floating-toolbar-button-delete",
      ],
      EntityCollectionType.selection,
    );

    dispose();
  });

  it("does not show the select toolbar on return when the selection is empty", () => {
    const {
      appHost,
      showCanvasFloatingToolbarForCollection,
    } = createToolbarFallbackContext({
      activeTool: "move",
      selectedEntities: [],
    });
    const dispose = hookSelectToolToolbarFallback(appHost);

    runInAction(() => {
      appHost.internalState.activeTool = "select";
    });

    expect(showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();

    dispose();
  });
});

function createContext(
  activeTool: "select" | "move" | "marquee" = "select",
  hypergryphOperationMode = true,
  selectedEntityIds: readonly string[] = [],
): {
  context: GestureActionContext<AppHost>;
  addToCollection: ReturnType<typeof vi.fn>;
  clearCollection: ReturnType<typeof vi.fn>;
  showCanvasFloatingToolbarForCollection: ReturnType<typeof vi.fn>;
  hideCanvasFloatingToolbar: ReturnType<typeof vi.fn>;
  isDedicatedLogisticsDevice: ReturnType<typeof vi.fn>;
} {
  const addToCollection = vi.fn();
  const clearCollection = vi.fn();
  const showCanvasFloatingToolbarForCollection = vi.fn(() => true);
  const hideCanvasFloatingToolbar = vi.fn();
  const isDedicatedLogisticsDevice = vi.fn((definitionId: string) => [
    "belt_straight_1x1",
    "belt_turn_cw_1x1",
    "belt_turn_ccw_1x1",
    "pipe_straight_1x1",
    "pipe_turn_cw_1x1",
    "pipe_turn_ccw_1x1",
  ].includes(definitionId));

  return {
    context: {
      workspace: {
        registry: {
          queries: {
            isDedicatedLogisticsDevice,
            isGeneralLogisticsDevice: vi.fn(() => false),
          },
        },
        editor: {
          state: {
            collections: {
              selection: {
                contains: (entityId: string) => selectedEntityIds.includes(entityId),
              },
            },
          },
          actions: {
            addToCollection,
            clearCollection,
          },
        },
      } as unknown as WorkspaceContract,
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
          showCanvasFloatingToolbarForCollection,
          hideCanvasFloatingToolbar,
        },
      } as unknown as AppHost,
      keyboard: emptyKeyboardSnapshot(),
    },
    addToCollection,
    clearCollection,
    showCanvasFloatingToolbarForCollection,
    hideCanvasFloatingToolbar,
    isDedicatedLogisticsDevice,
  };
}

function entity(id: string, definitionId = "not-strict-device"): WorldEntity {
  return {
    id,
    definitionId,
    position: { x: 0, y: 0 },
    rotation: 0,
    config: {},
    tags: [],
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

function createToolbarFallbackContext(options: {
  activeTool: ActiveTool;
  selectedEntities: readonly WorldEntity[];
  hypergryphOperationMode?: boolean;
}): {
  appHost: AppHost;
  showCanvasFloatingToolbarForCollection: ReturnType<typeof vi.fn>;
} {
  const showCanvasFloatingToolbarForCollection = vi.fn(() => true);
  const selectedEntityMap = new Map(
    options.selectedEntities.map((selectedEntity) => [selectedEntity.id, selectedEntity]),
  );

  const appHost = {
    state: {
      settings: {
        hypergryphOperationMode: options.hypergryphOperationMode ?? true,
      },
    },
    internalState: new TestInternalState(options.activeTool),
    internalActions: {
      showCanvasFloatingToolbarForCollection,
    },
    workspace: {
      editor: {
        state: {
          collections: {
            selection: createSelectionCollection(
              options.selectedEntities.map((selectedEntity) => selectedEntity.id),
            ),
          },
        },
        queries: {
          getEntityById: (entityId: string) => selectedEntityMap.get(entityId) ?? null,
        },
      },
      registry: {
        queries: {
          isDedicatedLogisticsDevice: (definitionId: string) => [
            "belt_straight_1x1",
            "belt_turn_cw_1x1",
            "belt_turn_ccw_1x1",
            "pipe_straight_1x1",
            "pipe_turn_cw_1x1",
            "pipe_turn_ccw_1x1",
          ].includes(definitionId),
        },
      },
    },
  } as unknown as AppHost;

  return {
    appHost,
    showCanvasFloatingToolbarForCollection,
  };
}

function createSelectionCollection(entityIds: readonly string[]): EntityCollection {
  const selection = [...entityIds] as string[] & EntityCollection;

  selection.contains = (entityId: string) => selection.includes(entityId);

  return selection;
}

class TestInternalState {
  public activeTool: ActiveTool;

  public constructor(activeTool: ActiveTool) {
    this.activeTool = activeTool;
    makeAutoObservable(this, {}, { autoBind: true });
  }
}
