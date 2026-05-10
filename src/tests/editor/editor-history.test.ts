import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createDummyWorldDocument } from "@/editor/dummy-document";
import { createEditorHost } from "@/editor/editor-host";
import { readEditorHistoryState } from "@/editor/history/history-storage";
import { createRegistryContract } from "@/registry";
import { createFakeIndexedDbFactory } from "@/tests/shared/fake-indexed-db";

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
  vi.unstubAllGlobals();
});

describe("editor document history", () => {
  it("records document writes and replays undo, redo, restore, and redo truncation", () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const editor = createEditorHost(createWorkspace());
    editor.internalDocument.setSnapshot(createDummyWorldDocument());

    editor.actions.patchEntityConfig("dummy-entity-2", {
      foo: "bar",
    });

    expect(editor.state.history.records).toHaveLength(1);
    expect(editor.state.history.cursorSequence).toBe(1);
    expect(editor.state.history.redoDepth).toBe(0);
    expect(editor.state.history.records[0]?.action.type).toBe("entity.config.patch");
    expect(
      editor.document.getSnapshot().entities["dummy-entity-2"]?.config.foo,
    ).toBe("bar");

    editor.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "dummy-entity-2",
    });
    editor.actions.moveCollectionTo({
      collectionType: EntityCollectionType.selection,
      startGridPoint: {
        x: 0,
        y: 0,
      },
      endGridPoint: {
        x: 2,
        y: 1,
      },
    });

    expect(editor.state.history.records).toHaveLength(2);
    expect(editor.state.history.cursorSequence).toBe(2);
    expect(
      editor.document.getSnapshot().entities["dummy-entity-2"]?.position,
    ).toEqual({
      x: 6,
      y: 5,
    });

    expect(editor.actions.undoDocumentHistory()).toBe(true);
    expect(editor.state.history.cursorSequence).toBe(1);
    expect(editor.state.history.redoDepth).toBe(1);
    expect(
      editor.document.getSnapshot().entities["dummy-entity-2"]?.position,
    ).toEqual({
      x: 4,
      y: 4,
    });
    expect(
      editor.document.getSnapshot().entities["dummy-entity-2"]?.config.foo,
    ).toBe("bar");

    expect(editor.actions.restoreDocumentHistoryTo(0)).toBe(true);
    expect(editor.state.history.cursorSequence).toBe(0);
    expect(editor.state.history.redoDepth).toBe(2);
    expect(
      editor.document.getSnapshot().entities["dummy-entity-2"]?.config.foo,
    ).toBeUndefined();

    expect(editor.actions.redoDocumentHistory()).toBe(true);
    expect(editor.actions.redoDocumentHistory()).toBe(true);
    expect(editor.state.history.cursorSequence).toBe(2);
    expect(
      editor.document.getSnapshot().entities["dummy-entity-2"]?.position,
    ).toEqual({
      x: 6,
      y: 5,
    });

    expect(editor.actions.restoreDocumentHistoryTo(1)).toBe(true);
    expect(editor.state.history.cursorSequence).toBe(1);
    expect(editor.state.history.redoDepth).toBe(1);

    editor.actions.patchEntityConfig("dummy-entity-2", {
      foo: "baz",
    });

    expect(editor.state.history.records).toHaveLength(2);
    expect(editor.state.history.cursorSequence).toBe(2);
    expect(editor.state.history.redoDepth).toBe(0);
    expect(editor.actions.redoDocumentHistory()).toBe(false);
    expect(
      editor.document.getSnapshot().entities["dummy-entity-2"]?.position,
    ).toEqual({
      x: 4,
      y: 4,
    });
    expect(
      editor.document.getSnapshot().entities["dummy-entity-2"]?.config.foo,
    ).toBe("baz");
  });

  it("clears history without changing the document", () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const editor = createEditorHost(createWorkspace());
    editor.internalDocument.setSnapshot(createDummyWorldDocument());

    editor.actions.patchEntityConfig("dummy-entity-2", {
      foo: "bar",
    });

    editor.actions.clearDocumentHistory();

    expect(editor.state.history.records).toHaveLength(0);
    expect(editor.state.history.undoDepth).toBe(0);
    expect(editor.state.history.redoDepth).toBe(0);
    expect(editor.actions.undoDocumentHistory()).toBe(false);
    expect(
      editor.document.getSnapshot().entities["dummy-entity-2"]?.config.foo,
    ).toBe("bar");
  });

  it("persists history records in IndexedDB by document key", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const editor = createEditorHost(createWorkspace());
    const document = createDummyWorldDocument();

    editor.internalDocument.setSnapshot(document);
    editor.actions.patchEntityConfig("dummy-entity-2", {
      foo: "bar",
    });

    await flushAsyncWork();

    const persistedState = await readEditorHistoryState(document.documentKey);

    expect(persistedState?.documentKey).toBe(document.documentKey);
    expect(persistedState?.cursorSequence).toBe(1);
    expect(persistedState?.records).toHaveLength(1);
    expect(persistedState?.records[0]?.action.label).toBe("修改设备配置");
  });
});

async function flushAsyncWork(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}
