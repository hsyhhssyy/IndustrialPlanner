import { describe, expect, it, vi } from "vitest";
import { createStage1SeedWorldDocument } from "@/domain/document/stage1-seed-world-document";
import { compileStage1World } from "@/domain/compiler/stage1-compiler";
import { createStage1Registry } from "@/domain/registry/stage1-registry";
import { createSnapshotStore } from "@/shared/snapshot-store/snapshot-store";
import {
  createRenderSceneCoordinator,
  type RenderSceneCoordinatorSource,
} from "@/renderer/host/render-scene-coordinator";
import type { RenderSceneModel } from "@/renderer/scene/types";
import { createInitialEditorSession } from "@/editor/core/editor-session";
import type { SimulationState } from "@/simulation/host/simulation-host";
import { createInitialCanvasViewState } from "@/workbench/workspace-state";
import { createInitialWorkbenchUiState } from "@/workbench/workbench-ui-store";
import { createEmptySimulationPatchSet } from "@/simulation/protocol/simulation-patch";

function createCoordinatorHarness() {
  const document = createStage1SeedWorldDocument();
  const registry = createStage1Registry();
  const topology = compileStage1World(document, registry);
  const documentStore = createSnapshotStore(document);
  const editorStore = createSnapshotStore({
    session: createInitialEditorSession(),
    history: {
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
      redoDepth: 0,
    },
  });
  const uiStore = createSnapshotStore(createInitialWorkbenchUiState());
  const canvasViewStore = createSnapshotStore(createInitialCanvasViewState());
  const initialSimulationState: SimulationState = {
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
  };
  const simulationStore = createSnapshotStore(initialSimulationState);
  const runtimeSnapshotStore = createSnapshotStore(
    initialSimulationState.runtimeSnapshot,
  );
  const simulationSelectionStore = createSnapshotStore(
    initialSimulationState.selection,
  );
  const topologyStore = createSnapshotStore(topology);
  const source: RenderSceneCoordinatorSource = {
    documentStore,
    editorStore,
    uiStore,
    canvasViewStore,
    runtimeSnapshotStore,
    simulationSelectionStore,
    topologyStore,
    registry,
  };

  return {
    source,
    stores: {
      documentStore,
      editorStore,
      uiStore,
      canvasViewStore,
      simulationStore,
      runtimeSnapshotStore,
      simulationSelectionStore,
      topologyStore,
    },
  };
}

describe("RenderSceneCoordinator", () => {
  it("batches store changes into one RAF-presented scene and ignores unrelated simulation slices", () => {
    const harness = createCoordinatorHarness();
    const presentScene = vi.fn();
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;

    const coordinator = createRenderSceneCoordinator({
      source: harness.source,
      presentScene,
      requestFrame: (callback) => {
        const frameId = nextFrameId++;
        frameCallbacks.set(frameId, callback);
        return frameId;
      },
      cancelFrame: (frameId) => {
        frameCallbacks.delete(frameId);
      },
    });

    expect(frameCallbacks.size).toBe(1);

    harness.stores.canvasViewStore.setSnapshot({
      offset: { x: 12, y: 8 },
      zoom: 1.5,
    });
    harness.stores.uiStore.setSnapshot({
      ...harness.stores.uiStore.getSnapshot(),
      locale: "en-US",
    });

    expect(frameCallbacks.size).toBe(1);
    expect(presentScene).not.toHaveBeenCalled();

    const initialFrame = frameCallbacks.values().next().value;

    if (!initialFrame) {
      throw new Error("Missing queued animation frame.");
    }

    frameCallbacks.clear();
    initialFrame(16);

    expect(presentScene).toHaveBeenCalledTimes(1);
    expect(presentScene.mock.calls[0]?.[0]).toMatchObject({
      zoom: 1.5,
      viewportOffset: { x: 12, y: 8 },
    });

    harness.stores.simulationStore.setSnapshot({
      ...harness.stores.simulationStore.getSnapshot(),
      inspectorDetails: {
        entityId: "reactor-1",
        tick: 1,
        lines: [],
        effectiveConfig: {},
        patchConfig: {},
      },
    });

    expect(frameCallbacks.size).toBe(0);
    expect(presentScene).toHaveBeenCalledTimes(1);

    harness.stores.uiStore.setSnapshot({
      ...harness.stores.uiStore.getSnapshot(),
      phase: "simulate",
    });

    expect(frameCallbacks.size).toBe(1);

    const phaseFrame = frameCallbacks.values().next().value;

    if (!phaseFrame) {
      throw new Error("Missing queued animation frame for phase change.");
    }

    frameCallbacks.clear();
    phaseFrame(24);

    expect(presentScene).toHaveBeenCalledTimes(2);

    harness.stores.simulationSelectionStore.setSnapshot(["reactor-1"]);

    expect(frameCallbacks.size).toBe(1);

    const selectionFrame = frameCallbacks.values().next().value;

    if (!selectionFrame) {
      throw new Error("Missing queued animation frame for selection change.");
    }

    frameCallbacks.clear();
    selectionFrame(32);

    expect(presentScene).toHaveBeenCalledTimes(3);
    const selectionScene = presentScene.mock.calls[2]?.[0] as
      | RenderSceneModel
      | undefined;
    const selectedSprite = selectionScene?.entities.find(
      (entity) => entity.entityId === "reactor-1",
    );

    expect(selectedSprite?.selected).toBe(true);

    coordinator.dispose();
  });
});
