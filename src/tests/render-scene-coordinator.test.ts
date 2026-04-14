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
import { createInitialCanvasViewState } from "@/workbench/state/workspace-state";
import { createInitialWorkbenchUiState } from "@/workbench/state/workbench-ui-store";

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
  const topologyStore = createSnapshotStore(topology);
  const source: RenderSceneCoordinatorSource = {
    documentStore,
    editorStore,
    uiStore,
    canvasViewStore,
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
      topologyStore,
    },
  };
}

describe("RenderSceneCoordinator", () => {
  it("batches edit-scene store changes into one RAF-presented scene and ignores status-message churn", () => {
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

    harness.stores.uiStore.setSnapshot({
      ...harness.stores.uiStore.getSnapshot(),
      statusMessageKey: "status.edit",
    });

    expect(frameCallbacks.size).toBe(0);
    expect(presentScene).toHaveBeenCalledTimes(1);

    harness.stores.documentStore.setSnapshot({
      ...harness.stores.documentStore.getSnapshot(),
      entities: {
        ...harness.stores.documentStore.getSnapshot().entities,
        "reactor-1": {
          ...harness.stores.documentStore.getSnapshot().entities["reactor-1"]!,
          position: { x: 19, y: 12 },
        },
      },
    });

    expect(frameCallbacks.size).toBe(1);

    const documentFrame = frameCallbacks.values().next().value;

    if (!documentFrame) {
      throw new Error("Missing queued animation frame for document change.");
    }

    frameCallbacks.clear();
    documentFrame(24);

    expect(presentScene).toHaveBeenCalledTimes(2);
    const updatedScene = presentScene.mock.calls[1]?.[0] as
      | RenderSceneModel
      | undefined;
    const movedSprite = updatedScene?.entities.find(
      (entity) => entity.entityId === "reactor-1",
    );

    expect(movedSprite?.x).toBe(19 * harness.stores.documentStore.getSnapshot().documentSettings.gridSize);

    coordinator.dispose();
  });
});
