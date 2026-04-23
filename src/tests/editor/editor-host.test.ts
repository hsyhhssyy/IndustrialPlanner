import { afterEach, describe, expect, it } from "vitest";
import { runInAction } from "mobx";

import { createDummyWorldDocument } from "@/editor/dummy-document";
import { createEditorHost } from "@/editor/editor-host";
import { EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY } from "@/editor/storage-hook";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { createWorkspaceState } from "@/domain/state/workspace-state";
import { createRegistryContract } from "@/registry";
import { resolveWorldEntitySpriteLayout } from "@/renderer/scene/render-scene-orchestrator";

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
  it("updates viewport rect through editor actions", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    expect(editorHost.internalState.internalPersistState.lastDocumentId).toBeNull();

    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 1024,
      height: 768,
    });

    expect(editorHost.internalState.viewport.clientRect.left).toBe(120);
    expect(editorHost.internalState.viewport.clientRect.top).toBe(80);
    expect(editorHost.state.viewport.clientRect.left).toBe(120);
    expect(editorHost.state.viewport.clientRect.top).toBe(80);
    expect(editorHost.internalState.viewport.clientRect.width).toBe(1024);
    expect(editorHost.internalState.viewport.clientRect.height).toBe(768);
    expect(editorHost.state.viewport.clientRect.width).toBe(1024);
    expect(editorHost.state.viewport.clientRect.height).toBe(768);
    expect(workspace.editor?.state.viewport.clientRect.left).toBe(120);
    expect(workspace.editor?.state.viewport.clientRect.top).toBe(80);
    expect(workspace.editor?.state.viewport.clientRect.width).toBe(1024);
    expect(workspace.editor?.state.viewport.clientRect.height).toBe(768);
    expect(editorHost.state.viewport.center.x).toBe(0);
    expect(editorHost.state.viewport.center.y).toBe(0);
  });

  it("moves viewport center by viewport pixel vector through editor actions", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.moveViewportByViewportPixelVector({
      startViewportPixel: {
        x: 64,
        y: 80,
      },
      endViewportPixel: {
        x: 96,
        y: 48,
      },
    });

    expect(editorHost.state.viewport.center.x).toBeCloseTo(-2);
    expect(editorHost.state.viewport.center.y).toBeCloseTo(2);
    expect(workspace.editor?.state.viewport.center.x).toBeCloseTo(-2);
    expect(workspace.editor?.state.viewport.center.y).toBeCloseTo(2);
  });

  it("compensates viewport center after later rect changes to preserve screen position", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();
    const entity = document.entities["dummy-entity-1"];
    const definition = workspace.registry.entityDefinitions.find(
      (item) => item.id === entity?.definitionId,
    );

    expect(entity).toBeDefined();
    expect(definition).toBeDefined();

    if (!entity || !definition) {
      throw new Error("Expected dummy belt entity and definition to be present.");
    }

    editorHost.internalDocument.setSnapshot(document);

    const initialRect = {
      left: 0,
      top: 0,
      width: 400,
      height: 400,
    };
    editorHost.actions.setViewportClientRect(initialRect);

    const initialLayout = resolveWorldEntitySpriteLayout({
      entity,
      footprint: definition.footprint,
      viewportBounds: {
        left: 0,
        top: 0,
        width: initialRect.width,
        height: initialRect.height,
      },
      viewportCenter: editorHost.state.viewport.center,
      gridSize: editorHost.state.viewport.gridSize,
    });
    const initialAbsolutePosition = {
      x: initialRect.left + initialLayout.x,
      y: initialRect.top + initialLayout.y,
    };

    editorHost.actions.setViewportClientRect({
      left: 200,
      top: 0,
      width: 200,
      height: 400,
    });

    expect(editorHost.state.viewport.center.x).toBeCloseTo(6.25);
    expect(editorHost.state.viewport.center.y).toBeCloseTo(0);

    const nextRect = editorHost.state.viewport.clientRect;
    const nextLayout = resolveWorldEntitySpriteLayout({
      entity,
      footprint: definition.footprint,
      viewportBounds: {
        left: 0,
        top: 0,
        width: nextRect.width,
        height: nextRect.height,
      },
      viewportCenter: editorHost.state.viewport.center,
      gridSize: editorHost.state.viewport.gridSize,
    });
    const nextAbsolutePosition = {
      x: nextRect.left + nextLayout.x,
      y: nextRect.top + nextLayout.y,
    };

    expect(nextAbsolutePosition.x).toBeCloseTo(initialAbsolutePosition.x);
    expect(nextAbsolutePosition.y).toBeCloseTo(initialAbsolutePosition.y);
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