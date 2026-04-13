import { describe, expect, it, vi } from "vitest";
import { getStage1BaseDefinition } from "@/domain/base/stage1-bases";
import { compileStage1World } from "@/domain/compiler/stage1-compiler";
import { createStage1SeedWorldDocument } from "@/domain/document/stage1-seed-world-document";
import {
  createStage1Registry,
  getStage1EntityDefinition,
} from "@/domain/registry/stage1-registry";
import { buildRenderScene } from "@/renderer/scene/build-render-scene";
import {
  getGridBoundingBox,
  getRotatedGridFootprint,
} from "@/shared/geometry/grid";
import { createSnapshotStore } from "@/shared/snapshot-store/snapshot-store";
import { createEmptySimulationPatchSet } from "@/simulation/protocol/simulation-patch";
import { createInitialEditorSession } from "@/editor/core/editor-session";
import {
  createMoveInteractionMode,
  createPlacementInteractionMode,
  getPendingLinkSourceEntityId,
} from "@/editor/contracts/interaction-mode";
import {
  createMoveDraftId,
  getManagedMoveDraft,
  getManagedPlacementPreview,
  getSelectedEntityIds,
} from "@/editor/contracts/editor-session-helpers";
import { createWorkspaceDerivedStore } from "@/workbench/workspace-derived-store";
import { deriveRenderDerivedState } from "@/workbench/workspace-derived-state";
import { createInitialCanvasViewState } from "@/workbench/workspace-state";
import { createInitialWorkbenchUiState } from "@/workbench/workbench-ui-store";
import { createWorkspaceStore } from "@/workbench/workspace-store";

function createCollection(ids: string[]) {
  return {
    ids,
    boundsDerived: null,
    geometricCenterCellsDerived: null,
  };
}

function withPlacementPreview(
  session: ReturnType<typeof createInitialEditorSession>,
  preview: {
    definitionId: string;
    interactionMode: "pointer" | "touch";
    gridPoint: { x: number; y: number };
    rotation: 0 | 90 | 180 | 270;
    valid: boolean;
  },
) {
  return {
    ...session,
    currentMode: createPlacementInteractionMode({
      definitionId: preview.definitionId,
      inputMode: preview.interactionMode,
      rotation: preview.rotation,
    }),
    drafts: {
      entities: {
        "draft:placement-preview": {
          id: "draft:placement-preview",
          definitionId: preview.definitionId,
          position: preview.gridPoint,
          rotation: preview.rotation,
          config: {},
          tags: [],
          sourceEntityId: null,
          valid: preview.valid,
          invalidReason: preview.valid ? null : "placement-preview-invalid",
        },
      },
    },
    draftEntities: createCollection(["draft:placement-preview"]),
  };
}

function withMoveDraft(
  session: ReturnType<typeof createInitialEditorSession>,
  document: ReturnType<typeof createStage1SeedWorldDocument>,
  draft: {
    entityId: string;
    interactionMode: "pointer" | "touch";
    gridPoint: { x: number; y: number };
    rotation: 0 | 90 | 180 | 270;
    valid: boolean;
    anchorWorldOffset: { x: number; y: number };
  },
) {
  const sourceEntity = document.entities[draft.entityId]!;

  return {
    ...session,
    currentMode: createMoveInteractionMode({
      entityId: draft.entityId,
      inputMode: draft.interactionMode,
      anchorWorldOffset: draft.anchorWorldOffset,
    }),
    selectedEntities: createCollection([draft.entityId]),
    drafts: {
      entities: {
        [createMoveDraftId(draft.entityId)]: {
          ...sourceEntity,
          id: createMoveDraftId(draft.entityId),
          position: draft.gridPoint,
          rotation: draft.rotation,
          config: { ...sourceEntity.config },
          tags: [...sourceEntity.tags],
          sourceEntityId: draft.entityId,
          valid: draft.valid,
          invalidReason: draft.valid ? null : "move-draft-invalid",
        },
      },
    },
    draftEntities: createCollection([createMoveDraftId(draft.entityId)]),
  };
}

describe("WorkspaceDerivedStore", () => {
  it("derives render bounds from the same shared logic as buildRenderScene", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const workspaceState = {
      document,
      topology,
      editorSession: createInitialEditorSession(),
      editorHistory: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      },
      ui: createInitialWorkbenchUiState(),
      canvasView: createInitialCanvasViewState(),
      simulation: {
        runtimeSnapshot: {
          tick: 0,
          status: "idle" as const,
          entityViews: {},
          patchedEntityIds: [],
        },
        telemetry: {
          tick: 0,
          simulatedHertz: 0,
          entityCount: 0,
        },
        inspectorDetails: null,
        patchSet: createEmptySimulationPatchSet(),
        selection: [],
      },
    };

    const derived = deriveRenderDerivedState({
      workspaceState,
      topology,
      registry,
    });
    const renderScene = buildRenderScene({
      locale: workspaceState.ui.locale,
      document,
      topology,
      registry,
      canvasView: workspaceState.canvasView,
      interaction: {
        selectedEntityIds: getSelectedEntityIds(workspaceState.editorSession),
        placementPreview: getManagedPlacementPreview(workspaceState.editorSession),
        moveDraft: getManagedMoveDraft(
          workspaceState.editorSession,
          workspaceState.document,
        ),
        pendingLinkSourceEntityId: getPendingLinkSourceEntityId(
          workspaceState.editorSession.currentMode,
        ),
      },
      runtimeSnapshot: workspaceState.simulation.runtimeSnapshot,
    });

    expect(derived.cellSizePx).toBe(renderScene.gridSize * renderScene.zoom);
    expect(derived.worldBoundsPx).toEqual({
      width: renderScene.worldWidth,
      height: renderScene.worldHeight,
    });
  });

  it("projects touch placement preview into a shared screen box", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const workspaceState = {
      document,
      topology,
      editorSession: {
        ...withPlacementPreview(createInitialEditorSession(), {
          definitionId: "belt_straight_1x1",
          interactionMode: "touch" as const,
          gridPoint: { x: 2, y: 3 },
          rotation: 0 as const,
          valid: true,
        }),
      },
      editorHistory: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      },
      ui: createInitialWorkbenchUiState(),
      canvasView: {
        offset: { x: 10, y: 20 },
        zoom: 2,
      },
      simulation: {
        runtimeSnapshot: {
          tick: 0,
          status: "idle" as const,
          entityViews: {},
          patchedEntityIds: [],
        },
        telemetry: {
          tick: 0,
          simulatedHertz: 0,
          entityCount: 0,
        },
        inspectorDetails: null,
        patchSet: createEmptySimulationPatchSet(),
        selection: [],
      },
    };
    const scaledGridSize =
      workspaceState.document.documentSettings.gridSize * workspaceState.canvasView.zoom;

    const preview = getManagedPlacementPreview(workspaceState.editorSession)!;

    expect(
      deriveRenderDerivedState({
        workspaceState,
        topology,
        registry,
      }).anchoredPlacementScreenBox,
    ).toEqual({
      left:
        (preview.gridPoint.x *
          workspaceState.document.documentSettings.gridSize -
          workspaceState.canvasView.offset.x) *
        workspaceState.canvasView.zoom,
      top:
        (preview.gridPoint.y *
          workspaceState.document.documentSettings.gridSize -
          workspaceState.canvasView.offset.y) *
        workspaceState.canvasView.zoom,
      width: scaledGridSize,
      height: scaledGridSize,
    });
  });

  it("keeps touch placement screen boxes rotation-aware for non-square footprints", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const workspaceState = {
      document,
      topology,
      editorSession: {
        ...withPlacementPreview(createInitialEditorSession(), {
          definitionId: "item_port_unloader_1",
          interactionMode: "touch" as const,
          gridPoint: { x: 2, y: 3 },
          rotation: 90 as const,
          valid: true,
        }),
      },
      editorHistory: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      },
      ui: createInitialWorkbenchUiState(),
      canvasView: {
        offset: { x: 10, y: 20 },
        zoom: 2,
      },
      simulation: {
        runtimeSnapshot: {
          tick: 0,
          status: "idle" as const,
          entityViews: {},
          patchedEntityIds: [],
        },
        telemetry: {
          tick: 0,
          simulatedHertz: 0,
          entityCount: 0,
        },
        inspectorDetails: null,
        patchSet: createEmptySimulationPatchSet(),
        selection: [],
      },
    };
    const scaledGridSize =
      workspaceState.document.documentSettings.gridSize * workspaceState.canvasView.zoom;

    const rotatedPreview = getManagedPlacementPreview(workspaceState.editorSession)!;

    expect(
      deriveRenderDerivedState({
        workspaceState,
        topology,
        registry,
      }).anchoredPlacementScreenBox,
    ).toEqual({
      left:
        (rotatedPreview.gridPoint.x *
          workspaceState.document.documentSettings.gridSize -
          workspaceState.canvasView.offset.x) *
        workspaceState.canvasView.zoom,
      top:
        (rotatedPreview.gridPoint.y *
          workspaceState.document.documentSettings.gridSize -
          workspaceState.canvasView.offset.y) *
        workspaceState.canvasView.zoom,
      width: scaledGridSize,
      height: scaledGridSize * 3,
    });
  });

  it("prefers draftEntities bounds for touch placement when the legacy preview path cannot resolve a definition", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const workspaceState = {
      document,
      topology,
      editorSession: {
        ...withPlacementPreview(createInitialEditorSession(), {
          definitionId: "missing_definition",
          interactionMode: "touch" as const,
          gridPoint: { x: 999, y: 999 },
          rotation: 0 as const,
          valid: true,
        }),
        draftEntities: {
          ids: ["draft:placement-preview"],
          boundsDerived: {
            left: 4,
            top: 6,
            width: 2,
            height: 3,
          },
          geometricCenterCellsDerived: { x: 5, y: 7.5 },
        },
      },
      editorHistory: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      },
      ui: createInitialWorkbenchUiState(),
      canvasView: {
        offset: { x: 10, y: 20 },
        zoom: 2,
      },
      simulation: {
        runtimeSnapshot: {
          tick: 0,
          status: "idle" as const,
          entityViews: {},
          patchedEntityIds: [],
        },
        telemetry: {
          tick: 0,
          simulatedHertz: 0,
          entityCount: 0,
        },
        inspectorDetails: null,
        patchSet: createEmptySimulationPatchSet(),
        selection: [],
      },
    };

    expect(
      deriveRenderDerivedState({
        workspaceState,
        topology,
        registry,
      }).anchoredPlacementScreenBox,
    ).toEqual({
      left:
        (4 * document.documentSettings.gridSize - workspaceState.canvasView.offset.x) *
        workspaceState.canvasView.zoom,
      top:
        (6 * document.documentSettings.gridSize - workspaceState.canvasView.offset.y) *
        workspaceState.canvasView.zoom,
      width:
        2 * document.documentSettings.gridSize * workspaceState.canvasView.zoom,
      height:
        3 * document.documentSettings.gridSize * workspaceState.canvasView.zoom,
    });
  });

  it("projects touch selection into a shared screen box", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const selectedEntityId = "reactor-1";
    const selectedEntity = document.entities[selectedEntityId]!;
    const definition = topology.entityViews[selectedEntityId]?.definition;
    const workspaceState = {
      document,
      topology,
      editorSession: {
        ...createInitialEditorSession(),
        selectedEntities: createCollection([selectedEntityId]),
        selectionInputMode: "touch" as const,
      },
      editorHistory: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      },
      ui: createInitialWorkbenchUiState(),
      canvasView: {
        offset: { x: 10, y: 20 },
        zoom: 2,
      },
      simulation: {
        runtimeSnapshot: {
          tick: 0,
          status: "idle" as const,
          entityViews: {},
          patchedEntityIds: [],
        },
        telemetry: {
          tick: 0,
          simulatedHertz: 0,
          entityCount: 0,
        },
        inspectorDetails: null,
        patchSet: createEmptySimulationPatchSet(),
        selection: [],
      },
    };

    expect(definition).toBeTruthy();

    const footprint = getRotatedGridFootprint(
      definition!.footprint,
      selectedEntity.rotation,
    );

    expect(
      deriveRenderDerivedState({
        workspaceState,
        topology,
        registry,
      }).anchoredSelectionScreenBox,
    ).toEqual({
      left:
        (selectedEntity.position.x * document.documentSettings.gridSize -
          workspaceState.canvasView.offset.x) * workspaceState.canvasView.zoom,
      top:
        (selectedEntity.position.y * document.documentSettings.gridSize -
          workspaceState.canvasView.offset.y) * workspaceState.canvasView.zoom,
      width:
        footprint.width *
        document.documentSettings.gridSize *
        workspaceState.canvasView.zoom,
      height:
        footprint.height *
        document.documentSettings.gridSize *
        workspaceState.canvasView.zoom,
    });
  });

  it("projects touch multi-selection into the shared selection bounds box", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const selection = ["reactor-1", "filler-1"];
    const workspaceState = {
      document,
      topology,
      editorSession: {
        ...createInitialEditorSession(),
        selectedEntities: createCollection(selection),
        selectionInputMode: "touch" as const,
      },
      editorHistory: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      },
      ui: createInitialWorkbenchUiState(),
      canvasView: {
        offset: { x: 10, y: 20 },
        zoom: 2,
      },
      simulation: {
        runtimeSnapshot: {
          tick: 0,
          status: "idle" as const,
          entityViews: {},
          patchedEntityIds: [],
        },
        telemetry: {
          tick: 0,
          simulatedHertz: 0,
          entityCount: 0,
        },
        inspectorDetails: null,
        patchSet: createEmptySimulationPatchSet(),
        selection: [],
      },
    };
    const bounds = getGridBoundingBox(
      selection.map((entityId) => {
        const entity = document.entities[entityId];

        if (!entity) {
          throw new Error(`Missing entity ${entityId}`);
        }

        const definition = getStage1EntityDefinition(registry, entity.definitionId);

        if (!definition) {
          throw new Error(`Missing definition ${entity.definitionId}`);
        }

        return {
          position: entity.position,
          footprint: getRotatedGridFootprint(
            definition.footprint,
            entity.rotation,
          ),
        };
      }),
    );

    expect(bounds).toBeTruthy();

    expect(
      deriveRenderDerivedState({
        workspaceState,
        topology,
        registry,
      }).anchoredSelectionScreenBox,
    ).toEqual({
      left:
        (bounds!.left * document.documentSettings.gridSize -
          workspaceState.canvasView.offset.x) * workspaceState.canvasView.zoom,
      top:
        (bounds!.top * document.documentSettings.gridSize -
          workspaceState.canvasView.offset.y) * workspaceState.canvasView.zoom,
      width:
        bounds!.width *
        document.documentSettings.gridSize *
        workspaceState.canvasView.zoom,
      height:
        bounds!.height *
        document.documentSettings.gridSize *
        workspaceState.canvasView.zoom,
    });
  });

  it("prefers selectedEntities bounds for touch selection when legacy selection ids are absent", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const workspaceState = {
      document,
      topology,
      editorSession: {
        ...createInitialEditorSession(),
        selectedEntities: {
          ids: ["reactor-1"],
          boundsDerived: {
            left: 5,
            top: 4,
            width: 3,
            height: 2,
          },
          geometricCenterCellsDerived: { x: 6.5, y: 5 },
        },
        selection: [],
        selectionInputMode: "touch" as const,
      },
      editorHistory: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      },
      ui: createInitialWorkbenchUiState(),
      canvasView: {
        offset: { x: 10, y: 20 },
        zoom: 2,
      },
      simulation: {
        runtimeSnapshot: {
          tick: 0,
          status: "idle" as const,
          entityViews: {},
          patchedEntityIds: [],
        },
        telemetry: {
          tick: 0,
          simulatedHertz: 0,
          entityCount: 0,
        },
        inspectorDetails: null,
        patchSet: createEmptySimulationPatchSet(),
        selection: [],
      },
    };

    expect(
      deriveRenderDerivedState({
        workspaceState,
        topology,
        registry,
      }).anchoredSelectionScreenBox,
    ).toEqual({
      left:
        (5 * document.documentSettings.gridSize - workspaceState.canvasView.offset.x) *
        workspaceState.canvasView.zoom,
      top:
        (4 * document.documentSettings.gridSize - workspaceState.canvasView.offset.y) *
        workspaceState.canvasView.zoom,
      width:
        3 * document.documentSettings.gridSize * workspaceState.canvasView.zoom,
      height:
        2 * document.documentSettings.gridSize * workspaceState.canvasView.zoom,
    });
  });

  it("projects touch move drafts into a shared screen box", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const movedEntityId = "filler-1";
    const movedEntity = document.entities[movedEntityId]!;
    const definition = topology.entityViews[movedEntityId]?.definition;
    const workspaceState = {
      document,
      topology,
      editorSession: {
        ...withMoveDraft(createInitialEditorSession(), document, {
          entityId: movedEntityId,
          interactionMode: "touch" as const,
          gridPoint: { x: 19, y: 11 },
          rotation: 180 as const,
          valid: true,
          anchorWorldOffset: { x: 8, y: 8 },
        }),
      },
      editorHistory: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      },
      ui: createInitialWorkbenchUiState(),
      canvasView: {
        offset: { x: 10, y: 20 },
        zoom: 2,
      },
      simulation: {
        runtimeSnapshot: {
          tick: 0,
          status: "idle" as const,
          entityViews: {},
          patchedEntityIds: [],
        },
        telemetry: {
          tick: 0,
          simulatedHertz: 0,
          entityCount: 0,
        },
        inspectorDetails: null,
        patchSet: createEmptySimulationPatchSet(),
        selection: [],
      },
    };

    expect(definition).toBeTruthy();

    const footprint = getRotatedGridFootprint(
      definition!.footprint,
      180,
    );

    expect(
      deriveRenderDerivedState({
        workspaceState,
        topology,
        registry,
      }).anchoredMoveScreenBox,
    ).toEqual({
      left:
        (19 * document.documentSettings.gridSize -
          workspaceState.canvasView.offset.x) * workspaceState.canvasView.zoom,
      top:
        (11 * document.documentSettings.gridSize -
          workspaceState.canvasView.offset.y) * workspaceState.canvasView.zoom,
      width:
        footprint.width *
        document.documentSettings.gridSize *
        workspaceState.canvasView.zoom,
      height:
        footprint.height *
        document.documentSettings.gridSize *
        workspaceState.canvasView.zoom,
    });
  });

  it("projects marquee drafts into a shared screen box", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const workspaceState = {
      document,
      topology,
      editorSession: {
        ...createInitialEditorSession(),
        marqueeRange: {
          originGridPoint: { x: 10, y: 6 },
          gridPoint: { x: 18, y: 13 },
          bounds: {
            left: 10,
            top: 6,
            width: 9,
            height: 8,
          },
          selectionMode: "replace" as const,
        },
      },
      editorHistory: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      },
      ui: createInitialWorkbenchUiState(),
      canvasView: {
        offset: { x: 10, y: 20 },
        zoom: 2,
      },
      simulation: {
        runtimeSnapshot: {
          tick: 0,
          status: "idle" as const,
          entityViews: {},
          patchedEntityIds: [],
        },
        telemetry: {
          tick: 0,
          simulatedHertz: 0,
          entityCount: 0,
        },
        inspectorDetails: null,
        patchSet: createEmptySimulationPatchSet(),
        selection: [],
      },
    };

    expect(
      deriveRenderDerivedState({
        workspaceState,
        topology,
        registry,
      }).marqueeScreenBox,
    ).toEqual({
      left:
        (workspaceState.editorSession.marqueeRange!.bounds.left *
          document.documentSettings.gridSize -
          workspaceState.canvasView.offset.x) *
        workspaceState.canvasView.zoom,
      top:
        (workspaceState.editorSession.marqueeRange!.bounds.top *
          document.documentSettings.gridSize -
          workspaceState.canvasView.offset.y) *
        workspaceState.canvasView.zoom,
      width:
        workspaceState.editorSession.marqueeRange!.bounds.width *
        document.documentSettings.gridSize *
        workspaceState.canvasView.zoom,
      height:
        workspaceState.editorSession.marqueeRange!.bounds.height *
        document.documentSettings.gridSize *
        workspaceState.canvasView.zoom,
    });
  });

  it("prefers marqueeRange bounds when legacy marqueeDraft is absent", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const workspaceState = {
      document,
      topology,
      editorSession: {
        ...createInitialEditorSession(),
        marqueeRange: {
          selectionMode: "replace" as const,
          originGridPoint: { x: 10, y: 6 },
          gridPoint: { x: 18, y: 13 },
          bounds: {
            left: 10,
            top: 6,
            width: 9,
            height: 8,
          },
        },
      },
      editorHistory: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      },
      ui: createInitialWorkbenchUiState(),
      canvasView: {
        offset: { x: 10, y: 20 },
        zoom: 2,
      },
      simulation: {
        runtimeSnapshot: {
          tick: 0,
          status: "idle" as const,
          entityViews: {},
          patchedEntityIds: [],
        },
        telemetry: {
          tick: 0,
          simulatedHertz: 0,
          entityCount: 0,
        },
        inspectorDetails: null,
        patchSet: createEmptySimulationPatchSet(),
        selection: [],
      },
    };

    expect(
      deriveRenderDerivedState({
        workspaceState,
        topology,
        registry,
      }).marqueeScreenBox,
    ).toEqual({
      left:
        (10 * document.documentSettings.gridSize - workspaceState.canvasView.offset.x) *
        workspaceState.canvasView.zoom,
      top:
        (6 * document.documentSettings.gridSize - workspaceState.canvasView.offset.y) *
        workspaceState.canvasView.zoom,
      width:
        9 * document.documentSettings.gridSize * workspaceState.canvasView.zoom,
      height:
        8 * document.documentSettings.gridSize * workspaceState.canvasView.zoom,
    });
  });

  it("does not notify render subscribers when only unused simulation state changes", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const workspaceStore = createWorkspaceStore({
      document,
      topology,
      editorSession: createInitialEditorSession(),
      editorHistory: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      },
      ui: createInitialWorkbenchUiState(),
      canvasView: createInitialCanvasViewState(),
      simulation: {
        runtimeSnapshot: {
          tick: 0,
          status: "idle",
          entityViews: {},
          patchedEntityIds: [],
        },
        telemetry: {
          tick: 0,
          simulatedHertz: 0,
          entityCount: 0,
        },
        inspectorDetails: null,
        patchSet: createEmptySimulationPatchSet(),
        selection: [],
      },
    });
    const topologyStore = createSnapshotStore(topology);
    const derivedStore = createWorkspaceDerivedStore({
      documentStore: workspaceStore.documentStore,
      editorStore: workspaceStore.editorStore,
      uiStore: workspaceStore.uiStore,
      canvasViewStore: workspaceStore.canvasViewStore,
      simulationStore: workspaceStore.simulationStore,
      topologyStore,
      registry,
    });
    const renderListener = vi.fn();

    derivedStore.renderStore.subscribe(renderListener);

    workspaceStore.rootStore.update((state) => ({
      ...state,
      simulation: {
        ...state.simulation,
        telemetry: {
          ...state.simulation.telemetry,
          tick: 1,
        },
      },
    }));

    expect(renderListener).not.toHaveBeenCalled();

    workspaceStore.rootStore.update((state) => ({
      ...state,
      canvasView: {
        ...state.canvasView,
        zoom: 1.5,
      },
    }));

    expect(renderListener).toHaveBeenCalledTimes(1);
    expect(derivedStore.renderStore.getSnapshot().cellSizePx).toBe(
      document.documentSettings.gridSize * 1.5,
    );

    derivedStore.dispose();
    workspaceStore.dispose();
  });

  it("expands render world bounds from draftEntities when legacy preview state is absent", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const base = getStage1BaseDefinition(document.baseId);
    const workspaceState = {
      document,
      topology,
      editorSession: {
        ...createInitialEditorSession(),
        draftEntities: {
          ids: ["draft:placement-preview"],
          boundsDerived: {
            left: 100,
            top: 70,
            width: 5,
            height: 4,
          },
          geometricCenterCellsDerived: { x: 102.5, y: 72 },
        },
      },
      editorHistory: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      },
      ui: createInitialWorkbenchUiState(),
      canvasView: createInitialCanvasViewState(),
      simulation: {
        runtimeSnapshot: {
          tick: 0,
          status: "idle" as const,
          entityViews: {},
          patchedEntityIds: [],
        },
        telemetry: {
          tick: 0,
          simulatedHertz: 0,
          entityCount: 0,
        },
        inspectorDetails: null,
        patchSet: createEmptySimulationPatchSet(),
        selection: [],
      },
    };

    expect(
      deriveRenderDerivedState({
        workspaceState,
        topology,
        registry,
      }).worldBoundsPx,
    ).toEqual({
      width:
        (100 + 5) * document.documentSettings.gridSize +
        document.documentSettings.gridSize * 3,
      height: base.placeableSize * document.documentSettings.gridSize,
    });
  });
});
