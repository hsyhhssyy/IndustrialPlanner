import { describe, expect, it, vi } from "vitest";
import { compileStage1World } from "@/domain/compiler/stage1-compiler";
import { createStage1SeedWorldDocument } from "@/domain/document/stage1-seed-world-document";
import { createStage1Registry } from "@/domain/registry/stage1-registry";
import { createInitialEditorSession } from "@/editor/core/editor-session";
import { createEmptySimulationPatchSet } from "@/simulation/protocol/simulation-patch";
import { createWorkspaceStore } from "@/workbench/workspace-store";
import { createInitialCanvasViewState } from "@/workbench/workspace-state";
import { createInitialWorkbenchUiState } from "@/workbench/workbench-ui-store";

describe("WorkspaceStore", () => {
  it("fans out slice subscriptions from one root state without notifying untouched slices", () => {
    const document = createStage1SeedWorldDocument();
    const topology = compileStage1World(document, createStage1Registry());
    const store = createWorkspaceStore({
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
      runtimeSnapshot: {
        tick: 0,
        status: "idle",
        entityViews: {},
        patchedEntityIds: [],
      },
      simulationSelection: [],
      simulationInspectorDetails: null,
      simulationPatchSet: createEmptySimulationPatchSet(),
    });
    const documentListener = vi.fn();
    const uiListener = vi.fn();

    store.documentStore.subscribe(documentListener);
    store.uiStore.subscribe(uiListener);

    store.rootStore.update((state) => ({
      ...state,
      ui: {
        ...state.ui,
        locale: "en-US",
      },
    }));

    expect(uiListener).toHaveBeenCalledTimes(1);
    expect(documentListener).not.toHaveBeenCalled();

    store.dispose();
  });

  it("exposes top-level editor session/history slices while keeping editorStore compatible", () => {
    const document = createStage1SeedWorldDocument();
    const topology = compileStage1World(document, createStage1Registry());
    const store = createWorkspaceStore({
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
      runtimeSnapshot: {
        tick: 0,
        status: "idle",
        entityViews: {},
        patchedEntityIds: [],
      },
      simulationSelection: [],
      simulationInspectorDetails: null,
      simulationPatchSet: createEmptySimulationPatchSet(),
    });

    const editorListener = vi.fn();
    const nextHistory = {
      ...store.editorHistory,
      canUndo: true,
      undoDepth: 1,
    };

    store.editorStore.subscribe(editorListener);

    expect(store.editorSession).toBe(store.editorSessionStore.getSnapshot());
    expect(store.editorHistory).toBe(store.editorHistoryStore.getSnapshot());
    expect(store.editorStore.getSnapshot().session).toBe(store.editorSession);
    expect(store.editorStore.getSnapshot().history).toBe(store.editorHistory);

    store.rootStore.update((state) => ({
      ...state,
      ui: {
        ...state.ui,
        locale: "en-US",
      },
    }));

    expect(editorListener).not.toHaveBeenCalled();

    store.rootStore.update((state) => ({
      ...state,
      editorHistory: nextHistory,
    }));

    expect(editorListener).toHaveBeenCalledTimes(1);
    expect(store.editorHistory).toBe(nextHistory);
    expect(store.editorHistoryStore.getSnapshot()).toBe(nextHistory);
    expect(store.editorStore.getSnapshot().history).toBe(nextHistory);

    store.dispose();
  });

  it("exposes top-level simulation shared slices", () => {
    const document = createStage1SeedWorldDocument();
    const topology = compileStage1World(document, createStage1Registry());
    const store = createWorkspaceStore({
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
      runtimeSnapshot: {
        tick: 0,
        status: "idle",
        entityViews: {},
        patchedEntityIds: [],
      },
      simulationSelection: [],
      simulationInspectorDetails: null,
      simulationPatchSet: createEmptySimulationPatchSet(),
    });

    const nextDocument = createStage1SeedWorldDocument();
    const nextTopology = compileStage1World(nextDocument, createStage1Registry());
    const nextRuntimeSnapshot = {
      tick: 1,
      status: "running" as const,
      entityViews: {},
      patchedEntityIds: ["reactor-1"],
    };
    const nextInspectorDetails = {
      entityId: "reactor-1",
      tick: 1,
      lines: [],
      effectiveConfig: {},
      patchConfig: {},
    };
    const nextPatchSet = {
      entityConfigByEntityId: {
        "reactor-1": {
          targetRate: 12,
        },
      },
    };
    const selectionListener = vi.fn();

    store.simulationSelectionStore.subscribe(selectionListener);

    expect(store.topology).toBe(store.topologyStore.getSnapshot());
    expect(store.runtimeSnapshot).toBe(store.runtimeSnapshotStore.getSnapshot());
    expect(store.simulationSelection).toBe(store.simulationSelectionStore.getSnapshot());
    expect(store.simulationInspectorDetails).toBe(
      store.simulationInspectorDetailsStore.getSnapshot(),
    );
    expect(store.simulationPatchSet).toBe(store.simulationPatchSetStore.getSnapshot());

    store.rootStore.update((state) => ({
      ...state,
      simulationInspectorDetails: nextInspectorDetails,
    }));

    expect(selectionListener).not.toHaveBeenCalled();

    store.rootStore.update((state) => ({
      ...state,
      topology: nextTopology,
      runtimeSnapshot: nextRuntimeSnapshot,
      simulationInspectorDetails: nextInspectorDetails,
      simulationPatchSet: nextPatchSet,
      simulationSelection: ["reactor-1"],
    }));

    expect(store.topology).toBe(nextTopology);
    expect(store.topologyStore.getSnapshot()).toBe(nextTopology);
    expect(store.runtimeSnapshot).toBe(nextRuntimeSnapshot);
    expect(store.runtimeSnapshotStore.getSnapshot()).toBe(nextRuntimeSnapshot);
    expect(selectionListener).toHaveBeenCalledTimes(1);
    expect(store.simulationSelection).toEqual(["reactor-1"]);
    expect(store.simulationSelectionStore.getSnapshot()).toEqual(["reactor-1"]);
    expect(store.simulationInspectorDetails).toBe(nextInspectorDetails);
    expect(store.simulationInspectorDetailsStore.getSnapshot()).toBe(nextInspectorDetails);
    expect(store.simulationPatchSet).toBe(nextPatchSet);
    expect(store.simulationPatchSetStore.getSnapshot()).toBe(nextPatchSet);

    store.dispose();
  });
});
