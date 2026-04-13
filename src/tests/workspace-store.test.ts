import { describe, expect, it, vi } from "vitest";
import { createStage1SeedWorldDocument } from "@/domain/document/stage1-seed-world-document";
import { createInitialEditorSession } from "@/editor/core/editor-session";
import { createEmptySimulationPatchSet } from "@/simulation/protocol/simulation-patch";
import { createWorkspaceStore } from "@/workbench/workspace-store";
import { createInitialCanvasViewState } from "@/workbench/workspace-state";
import { createInitialWorkbenchUiState } from "@/workbench/workbench-ui-store";

describe("WorkspaceStore", () => {
  it("fans out slice subscriptions from one root state without notifying untouched slices", () => {
    const store = createWorkspaceStore({
      document: createStage1SeedWorldDocument(),
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

  it("exposes raw document alongside documentStore at the top level", () => {
    const store = createWorkspaceStore({
      document: createStage1SeedWorldDocument(),
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

    const nextDocument = createStage1SeedWorldDocument();

    expect(store.document).toBe(store.documentStore.getSnapshot());

    store.rootStore.update((state) => ({
      ...state,
      document: nextDocument,
    }));

    expect(store.document).toBe(nextDocument);
    expect(store.documentStore.getSnapshot()).toBe(nextDocument);

    store.dispose();
  });
});
