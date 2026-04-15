import { describe, expect, it, vi } from "vitest";
import { compileStage1World } from "@/domain/compiler/stage1-compiler";
import { createStage1SeedWorldDocument } from "@/domain/document/stage1-seed-world-document";
import { createStage1Registry } from "@/domain/registry/stage1-registry";
import { createInitialEditorSession } from "@/editor/core/editor-session";
import { createWorkspaceStore } from "@/workbench/state/workspace-store";
import { createInitialCanvasViewState } from "@/workspace/workspace-state";
import { createInitialWorkbenchUiState } from "@/workbench/state/workbench-ui-store";

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
    });
    const documentListener = vi.fn();
    const uiListener = vi.fn();
    const currentState = store.getSnapshot();

    store.documentStore.subscribe(documentListener);
    store.uiStore.subscribe(uiListener);

    const publishedState = store.publishState({
      ...currentState,
      ui: {
        ...currentState.ui,
        locale: "en-US",
      },
    });

    expect(store.getSnapshot()).toBe(publishedState);
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

    store.publishState({
      ...store.getSnapshot(),
      ui: {
        ...store.getSnapshot().ui,
        locale: "en-US",
      },
    });

    expect(editorListener).not.toHaveBeenCalled();

    store.publishState({
      ...store.getSnapshot(),
      editorHistory: nextHistory,
    });

    expect(editorListener).toHaveBeenCalledTimes(1);
    expect(store.editorHistory).toBe(nextHistory);
    expect(store.editorHistoryStore.getSnapshot()).toBe(nextHistory);
    expect(store.editorStore.getSnapshot().history).toBe(nextHistory);

    store.dispose();
  });
});
