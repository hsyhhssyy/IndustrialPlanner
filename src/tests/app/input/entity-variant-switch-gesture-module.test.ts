import { describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";
import {
  createHypergryphEntityVariantSwitchGestureModule,
  type GestureActionContext,
} from "@/app/input/gesture/actions";
import type { EditorContract } from "@/domain/editor/editor-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { WorldEntity } from "@/domain/document/world-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createRegistryContract } from "@/registry";

describe("createHypergryphEntityVariantSwitchGestureModule", () => {
  it("switches a single selected device from the inspector action button", () => {
    const { context, editor } = createContext();
    const module = createHypergryphEntityVariantSwitchGestureModule();

    const result = module.handle(
      uiButtonMouseTapEvent("canvas-floating-toolbar-button-switch-mode"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.replaceEntityDefinition).toHaveBeenCalledWith(
      "selected-entity",
      "liquid_filling_pd_mc_1",
    );
  });

  it("ignores non-switchable or multi-selected devices", () => {
    const nonSwitchable = createContext({
      selectedDefinitionId: "belt_straight_1x1",
    });
    const multi = createContext({
      selectionIds: ["selected-entity", "other-entity"],
    });
    const module = createHypergryphEntityVariantSwitchGestureModule();

    expect(
      module.handle(
        uiButtonTouchTapEvent("canvas-floating-toolbar-button-switch-mode"),
        nonSwitchable.context,
      ),
    ).toEqual({ status: "ignored" });
    expect(nonSwitchable.editor.actions.replaceEntityDefinition).not.toHaveBeenCalled();

    expect(
      module.handle(
        uiButtonTouchTapEvent("canvas-floating-toolbar-button-switch-mode"),
        multi.context,
      ),
    ).toEqual({ status: "ignored" });
    expect(multi.editor.actions.replaceEntityDefinition).not.toHaveBeenCalled();
  });
});

function createContext(options: {
  activeTool?: "select" | "marquee" | "move";
  selectedDefinitionId?: string;
  selectionIds?: readonly string[];
} = {}): {
  context: GestureActionContext<AppHost>;
  editor: MockEditor;
} {
  const selection = createCollection(options.selectionIds ?? ["selected-entity"]);
  const entity: WorldEntity = {
    id: "selected-entity",
    definitionId: options.selectedDefinitionId ?? "filling_pd_mc_1",
    position: { x: 0, y: 0 },
    rotation: 0,
    config: { keep: true },
    tags: [],
  };
  const registry = createRegistryContract();
  const editor: MockEditor = {
    state: {
      collections: {
        [EntityCollectionType.selection]: selection,
        [EntityCollectionType.marquee]: createCollection([]),
        [EntityCollectionType.reverseMarquee]: createCollection([]),
        [EntityCollectionType.preview]: createCollection([]),
        [EntityCollectionType.ghost]: createCollection([]),
        [EntityCollectionType.logisticsHead]: createCollection([]),
        [EntityCollectionType.powered]: createCollection([]),
        [EntityCollectionType.invalidPlacement]: createCollection([]),
      },
    },
    queries: {
      getEntityById: vi.fn((entityId: string) =>
        entityId === entity.id ? entity : null,
      ),
    },
    actions: {
      replaceEntityDefinition: vi.fn((entityId: string, nextDefinitionId: string) => {
        if (entityId !== entity.id) {
          return false;
        }

        entity.definitionId = nextDefinitionId;
        entity.config = {};
        return true;
      }),
    },
  };
  const appHost = {
    state: {
      settings: {
        hypergryphOperationMode: true,
      },
    },
    internalState: {
      activeTool: options.activeTool ?? "select",
    },
    workspace: {
      editor,
      registry,
    },
  } as unknown as AppHost;

  return {
    context: {
      workspace: {
        editor,
        registry,
      } as unknown as WorkspaceContract,
      appHost,
      keyboard: emptyKeyboardSnapshot(),
    },
    editor,
  };
}

type MockCollection = string[] & {
  contains(entityId: string): boolean;
  replace(entityIds: readonly string[]): void;
};

type MockEditor = {
  state: Pick<EditorContract["state"], "collections">;
  actions: Pick<EditorContract["actions"], "replaceEntityDefinition">;
  queries: Pick<EditorContract["queries"], "getEntityById">;
};

function createCollection(entityIds: readonly string[]): MockCollection {
  const collection = [...entityIds] as MockCollection;
  collection.contains = (entityId: string) => collection.includes(entityId);
  collection.replace = (nextEntityIds: readonly string[]) => {
    collection.splice(0, collection.length, ...nextEntityIds);
  };
  return collection;
}

function uiButtonTouchTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-touch-tap" as const,
    gestureId: "ui-touch-tap-1",
    uiButtonId,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonMouseTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-mouse-tap" as const,
    gestureId: "ui-mouse-tap-1",
    uiButtonId,
    button: 0,
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

function emptyKeyboardSnapshot(): KeyboardSnapshot {
  return {
    pressedKeys: new Set(),
    lastCode: null,
    lastKey: null,
    lastKeyCode: null,
    modifiers: emptyModifiers(),
  };
}
