import { describe, expect, it, vi } from "vitest";
import { createStage1SeedWorldDocument } from "@/domain/document/stage1-seed-world-document";
import { compileStage1World } from "@/domain/compiler/stage1-compiler";
import { createStage1Registry } from "@/domain/registry/stage1-registry";
import { createSnapshotStore } from "@/shared/snapshot-store/snapshot-store";
import {
  createRenderSceneCoordinator,
  type RenderSceneCoordinatorSource,
} from "@/renderer/host/render-scene-coordinator";
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
  const simulationStore = createSnapshotStore<SimulationState>({
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
  });
  const topologyStore = createSnapshotStore(topology);
  const source: RenderSceneCoordinatorSource = {
    documentStore,
    editorStore,
    uiStore,
    canvasViewStore,
    simulationStore,
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
      topologyStore,
    },
  };
}

describe("RenderSceneCoordinator", () => {
  it("batches store changes into one RAF-presented scene and ignores irrelevant simulation changes", () => {
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

    coordinator.dispose();
  });
});
