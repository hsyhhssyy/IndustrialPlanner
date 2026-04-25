import { describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/app-host";
import type { KeyboardSnapshot } from "@/app/input/gesture-adapter";
import {
  createHypergryphSelectGestureModule,
  type GestureActionContext,
} from "@/app/input/gesture-actions";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import type { WorldEntity } from "@/domain/entity/world-document";
import { EntityCollectionType } from "@/domain/state/types";

describe("createHypergryphSelectGestureModule", () => {
  it("adds a clicked entity to the selection collection in select mode", () => {
    const { context, addToCollection, clearCollection } = createContext();
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
    expect(addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "entity-1",
    });
    expect(clearCollection).not.toHaveBeenCalled();
  });

  it("adds a tapped entity to the selection collection in select mode", () => {
    const { context, addToCollection } = createContext();
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
    expect(addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "entity-2",
    });
  });

  it("clears the selection collection on right click in select mode", () => {
    const { context, addToCollection, clearCollection } = createContext();
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
  });

  it("ignores select taps when no entity is under the pointer", () => {
    const { context, addToCollection, clearCollection } = createContext();
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
});

function createContext(
  activeTool: "select" | "move" | "marquee" = "select",
  hypergryphOperationMode = true,
): {
  context: GestureActionContext<AppHost>;
  addToCollection: ReturnType<typeof vi.fn>;
  clearCollection: ReturnType<typeof vi.fn>;
} {
  const addToCollection = vi.fn();
  const clearCollection = vi.fn();

  return {
    context: {
      workspace: {
        editor: {
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
          runtime: {
            activeTool,
          },
        },
      } as AppHost,
      keyboard: emptyKeyboardSnapshot(),
    },
    addToCollection,
    clearCollection,
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