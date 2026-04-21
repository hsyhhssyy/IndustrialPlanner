import { afterEach, describe, expect, it } from "vitest";
import { runInAction } from "mobx";

import { createDummyWorldDocument } from "@/editor/dummy-document";
import { createEditorHost } from "@/editor/editor-host";
import { EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY } from "@/editor/storage-hook";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { createWorkspaceState } from "@/domain/state/workspace-state";
import { createRegistryContract } from "@/registry";

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
  };
}

afterEach(() => {
  localStorage.clear();
});

describe("createEditorHost", () => {
  it("updates viewport pixel size through editor actions", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    expect(editorHost.internalState.internalPersistState.lastDocumentId).toBeNull();

    editorHost.actions.setViewportPixelSize({
      width: 1024,
      height: 768,
    });

    expect(editorHost.internalState.viewport.pixelSize.width).toBe(1024);
    expect(editorHost.internalState.viewport.pixelSize.height).toBe(768);
    expect(editorHost.state.viewport.pixelSize.width).toBe(1024);
    expect(editorHost.state.viewport.pixelSize.height).toBe(768);
    expect(workspace.editor?.state.viewport.pixelSize.width).toBe(1024);
    expect(workspace.editor?.state.viewport.pixelSize.height).toBe(768);
  });

  it.each<[string | null]>([[null], [""], ["document-1"]])(
    "loads the dummy document on startup for persisted lastDocumentId=%p",
    async (lastDocumentId) => {
      localStorage.setItem(
        EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY,
        JSON.stringify({
          lastDocumentId,
        }),
      );

      const workspace = createWorkspace();
      const editorHost = createEditorHost(workspace);

      await flushMicrotasks();

      expect(editorHost.document.getSnapshot()).toEqual(
        createDummyWorldDocument(),
      );
    },
  );

  it("hydrates internal persist state from localStorage and persists later changes", () => {
    localStorage.setItem(
      EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify({
        lastDocumentId: "document-1",
      }),
    );

    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    expect(editorHost.internalState.internalPersistState.lastDocumentId).toBe(
      "document-1",
    );

    runInAction(() => {
      editorHost.internalState.internalPersistState.lastDocumentId =
        "document-2";
    });

    expect(localStorage.getItem(EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        lastDocumentId: "document-2",
      }),
    );

    editorHost.dispose();
    runInAction(() => {
      editorHost.internalState.internalPersistState.lastDocumentId = null;
    });

    expect(localStorage.getItem(EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        lastDocumentId: "document-2",
      }),
    );
  });
});

async function flushMicrotasks(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}