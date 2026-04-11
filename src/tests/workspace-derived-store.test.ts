import { describe, expect, it, vi } from "vitest";
import { compileStage1World } from "@/domain/compiler/stage1-compiler";
import { createStage1SeedWorldDocument } from "@/domain/document/stage1-seed-world-document";
import { createStage1Registry } from "@/domain/registry/stage1-registry";
import { buildRenderScene } from "@/renderer/scene/build-render-scene";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { createSnapshotStore } from "@/shared/snapshot-store/snapshot-store";
import { createEmptySimulationPatchSet } from "@/simulation/protocol/simulation-patch";
import { createInitialEditorSession } from "@/editor/core/editor-session";
import { getPendingLinkSourceEntityId } from "@/editor/contracts/interaction-mode";
import { createWorkspaceDerivedStore } from "@/workbench/workspace-derived-store";
import { deriveRenderDerivedState } from "@/workbench/workspace-derived-state";
import { createInitialCanvasViewState } from "@/workbench/workspace-state";
import { createInitialWorkbenchUiState } from "@/workbench/workbench-ui-store";
import { createWorkspaceStore } from "@/workbench/workspace-store";

describe("WorkspaceDerivedStore", () => {
  it("derives render bounds from the same shared logic as buildRenderScene", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const workspaceState = {
      document,
      editor: {
        session: createInitialEditorSession(),
        history: {
          canUndo: false,
          canRedo: false,
          undoDepth: 0,
          redoDepth: 0,
        },
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
        selectedEntityIds: workspaceState.editor.session.selection,
        placementPreview: workspaceState.editor.session.placementPreview,
        moveDraft: workspaceState.editor.session.moveDraft,
        pendingLinkSourceEntityId: getPendingLinkSourceEntityId(
          workspaceState.editor.session.currentMode,
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
      editor: {
        session: {
          ...createInitialEditorSession(),
          placementPreview: {
            definitionId: "belt_straight_1x1",
            interactionMode: "touch" as const,
            gridPoint: { x: 2, y: 3 },
            rotation: 0 as const,
            valid: true,
          },
        },
        history: {
          canUndo: false,
          canRedo: false,
          undoDepth: 0,
          redoDepth: 0,
        },
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

    expect(
      deriveRenderDerivedState({
        workspaceState,
        topology,
        registry,
      }).anchoredPlacementScreenBox,
    ).toEqual({
      left:
        (workspaceState.editor.session.placementPreview!.gridPoint.x *
          workspaceState.document.documentSettings.gridSize -
          workspaceState.canvasView.offset.x) *
        workspaceState.canvasView.zoom,
      top:
        (workspaceState.editor.session.placementPreview!.gridPoint.y *
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
      editor: {
        session: {
          ...createInitialEditorSession(),
          placementPreview: {
            definitionId: "item_port_unloader_1",
            interactionMode: "touch" as const,
            gridPoint: { x: 2, y: 3 },
            rotation: 90 as const,
            valid: true,
          },
        },
        history: {
          canUndo: false,
          canRedo: false,
          undoDepth: 0,
          redoDepth: 0,
        },
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

    expect(
      deriveRenderDerivedState({
        workspaceState,
        topology,
        registry,
      }).anchoredPlacementScreenBox,
    ).toEqual({
      left:
        (workspaceState.editor.session.placementPreview!.gridPoint.x *
          workspaceState.document.documentSettings.gridSize -
          workspaceState.canvasView.offset.x) *
        workspaceState.canvasView.zoom,
      top:
        (workspaceState.editor.session.placementPreview!.gridPoint.y *
          workspaceState.document.documentSettings.gridSize -
          workspaceState.canvasView.offset.y) *
        workspaceState.canvasView.zoom,
      width: scaledGridSize,
      height: scaledGridSize * 3,
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
      editor: {
        session: {
          ...createInitialEditorSession(),
          selection: [selectedEntityId],
          selectionInputMode: "touch" as const,
        },
        history: {
          canUndo: false,
          canRedo: false,
          undoDepth: 0,
          redoDepth: 0,
        },
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

  it("projects touch move drafts into a shared screen box", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const movedEntityId = "filler-1";
    const movedEntity = document.entities[movedEntityId]!;
    const definition = topology.entityViews[movedEntityId]?.definition;
    const workspaceState = {
      document,
      editor: {
        session: {
          ...createInitialEditorSession(),
          moveDraft: {
            entityId: movedEntityId,
            interactionMode: "touch" as const,
            originGridPoint: movedEntity.position,
            gridPoint: { x: 19, y: 11 },
            rotation: 180 as const,
            valid: true,
            anchorWorldOffset: { x: 8, y: 8 },
            entities: [
              {
                entityId: movedEntityId,
                originGridPoint: movedEntity.position,
                gridPoint: { x: 19, y: 11 },
                originRotation: movedEntity.rotation,
                rotation: 180 as const,
              },
            ],
          },
        },
        history: {
          canUndo: false,
          canRedo: false,
          undoDepth: 0,
          redoDepth: 0,
        },
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
      editor: {
        session: {
          ...createInitialEditorSession(),
          marqueeDraft: {
            interactionMode: "pointer" as const,
            selectionMode: "replace" as const,
            originGridPoint: { x: 10, y: 6 },
            gridPoint: { x: 18, y: 13 },
            bounds: {
              left: 10,
              top: 6,
              width: 9,
              height: 8,
            },
            entityIds: ["reactor-1", "filler-1"],
            baseSelection: ["reactor-1"],
          },
        },
        history: {
          canUndo: false,
          canRedo: false,
          undoDepth: 0,
          redoDepth: 0,
        },
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
        (workspaceState.editor.session.marqueeDraft!.bounds.left *
          document.documentSettings.gridSize -
          workspaceState.canvasView.offset.x) *
        workspaceState.canvasView.zoom,
      top:
        (workspaceState.editor.session.marqueeDraft!.bounds.top *
          document.documentSettings.gridSize -
          workspaceState.canvasView.offset.y) *
        workspaceState.canvasView.zoom,
      width:
        workspaceState.editor.session.marqueeDraft!.bounds.width *
        document.documentSettings.gridSize *
        workspaceState.canvasView.zoom,
      height:
        workspaceState.editor.session.marqueeDraft!.bounds.height *
        document.documentSettings.gridSize *
        workspaceState.canvasView.zoom,
    });
  });

  it("does not notify render subscribers when only unused simulation state changes", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const workspaceStore = createWorkspaceStore({
      document,
      editor: {
        session: createInitialEditorSession(),
        history: {
          canUndo: false,
          canRedo: false,
          undoDepth: 0,
          redoDepth: 0,
        },
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
});
