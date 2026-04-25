import { afterEach, describe, expect, it } from "vitest";
import { runInAction } from "mobx";

import { createDummyWorldDocument } from "@/editor/dummy-document";
import { createEditorHost } from "@/editor/editor-host";
import { EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY } from "@/editor/storage-hook";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import type { WorldEntity } from "@/domain/entity/world-document";
import { EntityCollectionType } from "@/domain/state/types";
import { createWorkspaceState } from "@/domain/state/workspace-state";
import { createRegistryContract } from "@/registry";
import { resolveWorldEntitySpriteLayout } from "@/renderer/scene/render-scene-orchestrator";
import { resolveWorldGridCellPixelSize } from "@/shared/geometry/viewport-transform";

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
    expect("drafts" in editorHost.state).toBe(false);
    expect(editorHost.internalState.drafts).toEqual([]);

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

  it("moves viewport center by client pixel vector through editor actions", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.moveViewportByClientPixelVector({
      startClientPixel: {
        x: 64,
        y: 80,
      },
      endClientPixel: {
        x: 96,
        y: 48,
      },
    });

    expect(editorHost.state.viewport.center.x).toBeCloseTo(-2);
    expect(editorHost.state.viewport.center.y).toBeCloseTo(2);
    expect(workspace.editor?.state.viewport.center.x).toBeCloseTo(-2);
    expect(workspace.editor?.state.viewport.center.y).toBeCloseTo(2);
  });

  it("zooms viewport through multiplicative steps in both directions", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const expectedGridSizeAfterZoomIn = Math.pow(2, 1 / 3);

    editorHost.actions.zoom(2);

    expect(editorHost.state.viewport.gridSize).toBeCloseTo(expectedGridSizeAfterZoomIn);
    expect(workspace.editor?.state.viewport.gridSize).toBeCloseTo(expectedGridSizeAfterZoomIn);
    expect(
      resolveWorldGridCellPixelSize(editorHost.state.viewport.gridSize),
    ).toBeCloseTo(resolveWorldGridCellPixelSize(1) * expectedGridSizeAfterZoomIn);

    editorHost.actions.zoom(-2);

    expect(editorHost.state.viewport.gridSize).toBeCloseTo(1);
    expect(workspace.editor?.state.viewport.gridSize).toBeCloseTo(1);
  });

  it("ignores zero and non-finite zoom steps", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.zoom(0);
    editorHost.actions.zoom(Number.NaN);
    editorHost.actions.zoom(Number.POSITIVE_INFINITY);

    expect(editorHost.state.viewport.gridSize).toBe(1);
    expect(workspace.editor?.state.viewport.gridSize).toBe(1);
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

  it("finds the entity occupying the grid cell at a client pixel point", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });

    const entity = editorHost.queries.findEntityAtClientPixelPoint(
      resolveClientPixelPointForGridCell(editorHost, { x: 5, y: 5 }),
    );
    const emptyCellEntity = editorHost.queries.findEntityAtClientPixelPoint(
      resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 0 }),
    );

    expect(entity?.id).toBe("dummy-entity-2");
    expect(emptyCellEntity).toBeNull();
  });

  it("gets entities by id from the world document first and then drafts", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.drafts = [
      {
        id: "draft-only",
        definitionId: "belt_straight_1x1",
        position: { x: 9, y: 9 },
        rotation: 0,
        config: {},
        tags: [],
      },
      {
        id: "dummy-entity-1",
        definitionId: "belt_straight_1x1",
        position: { x: 11, y: 11 },
        rotation: 0,
        config: {},
        tags: ["draft-shadow"],
      },
    ];

    expect(editorHost.queries.getEntityById("dummy-entity-1")).toBe(
      document.entities["dummy-entity-1"],
    );
    expect(editorHost.queries.getEntityById("draft-only")?.id).toBe("draft-only");
    expect(editorHost.queries.getEntityById("missing-entity")).toBeNull();
  });

  it("lists document entities plus draft entities as a union by id", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.drafts = [
      {
        id: "draft-only",
        definitionId: "belt_straight_1x1",
        position: { x: 9, y: 9 },
        rotation: 0,
        config: {},
        tags: [],
      },
      {
        id: "dummy-entity-2",
        definitionId: "belt_straight_1x1",
        position: { x: 11, y: 11 },
        rotation: 0,
        config: {},
        tags: ["draft-shadow"],
      },
    ];

    const entityIds = editorHost.queries.listEntities().map((entity) => entity.id);

    expect(entityIds).toContain("dummy-entity-1");
    expect(entityIds).toContain("dummy-entity-2");
    expect(entityIds).toContain("draft-only");
    expect(entityIds.filter((entityId) => entityId === "dummy-entity-2")).toHaveLength(1);
    expect(entityIds.filter((entityId) => entityId === "draft-only")).toHaveLength(1);
    expect(entityIds).toHaveLength(Object.keys(document.entities).length + 1);
  });

  it("adds the requested entity into selectedEntities through editor actions", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();
    const draftEntity: WorldEntity = {
      id: "draft-only",
      definitionId: "belt_straight_1x1",
      position: { x: 9, y: 9 },
      rotation: 0,
      config: {},
      tags: [],
    };

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.drafts = [draftEntity];

    editorHost.actions.selectEntity("dummy-entity-1");
    editorHost.actions.selectEntity("draft-only");
    editorHost.actions.selectEntity("missing-entity");

    expect(Object.keys(editorHost.state.selectedEntities)).toEqual([
      "dummy-entity-1",
      "draft-only",
    ]);
    expect(editorHost.state.selectedEntities["dummy-entity-1"]).toMatchObject(
      document.entities["dummy-entity-1"] ?? {},
    );
    expect(editorHost.state.selectedEntities["draft-only"]).toMatchObject(draftEntity);
  });

  it("computes grid rects for selected and preview entity collections", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();
    const selectedStorager = document.entities["dummy-entity-2"];
    const selectedBelt = document.entities["dummy-entity-1"];

    if (!selectedStorager || !selectedBelt) {
      throw new Error("Expected dummy selected entities to be present.");
    }

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.selectedEntities = {
      [selectedStorager.id]: selectedStorager,
      [selectedBelt.id]: selectedBelt,
    };
    editorHost.internalState.previewEntities = {
      "preview-unloader": {
        id: "preview-unloader",
        definitionId: "item_port_unloader_1",
        position: {
          x: -2,
          y: 3,
        },
        rotation: 90,
        config: {},
        tags: [],
      },
      "preview-belt": {
        id: "preview-belt",
        definitionId: "belt_straight_1x1",
        position: {
          x: 4,
          y: 8,
        },
        rotation: 0,
        config: {},
        tags: [],
      },
    };

    expect(
      editorHost.queries.findEntityCollectionGridRect("selection"),
    ).toEqual({
      x: 4,
      y: 4,
      width: 9,
      height: 5,
    });
    expect(editorHost.queries.findEntityCollectionGridRect("preview")).toEqual({
      x: -2,
      y: 3,
      width: 7,
      height: 6,
    });
  });

  it("does not expose draft as an entity collection type", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalState.drafts = [
      {
        id: "draft-only",
        definitionId: "item_port_storager_1",
        position: {
          x: 40,
          y: 40,
        },
        rotation: 0,
        config: {},
        tags: [],
      },
    ];

    expect(Object.values(EntityCollectionType)).toEqual(["selection", "preview"]);
    expect(
      editorHost.queries.findEntityCollectionGridRect("selection"),
    ).toBeNull();
    expect(editorHost.queries.findEntityCollectionGridRect("preview")).toBeNull();
  });

  it("computes the client rect for a world grid cell", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });

    const rect = editorHost.queries.findClientRectForGridCell({ x: 4, y: 4 });

    expect(rect).toEqual({
      left: 384,
      top: 344,
      width: 16,
      height: 16,
    });
  });

  it("uses rotated footprint when resolving entity hits from client pixel points", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();

    document.entities["rotated-entity"] = {
      id: "rotated-entity",
      definitionId: "item_port_unloader_1",
      position: {
        x: 8,
        y: 12,
      },
      rotation: 90,
      config: {},
      tags: [],
    };
    document.entityOrder.push("rotated-entity");

    editorHost.internalDocument.setSnapshot(document);
    editorHost.actions.setViewportClientRect({
      left: 0,
      top: 0,
      width: 400,
      height: 400,
    });

    const hitEntity = editorHost.queries.findEntityAtClientPixelPoint(
      resolveClientPixelPointForGridCell(editorHost, { x: 8, y: 13 }),
    );
    const missEntity = editorHost.queries.findEntityAtClientPixelPoint(
      resolveClientPixelPointForGridCell(editorHost, { x: 9, y: 13 }),
    );

    expect(hitEntity?.id).toBe("rotated-entity");
    expect(missEntity).toBeNull();
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

function resolveClientPixelPointForGridCell(
  editorHost: ReturnType<typeof createEditorHost>,
  cell: {
    x: number;
    y: number;
  },
): {
  x: number;
  y: number;
} {
  const gridCellSize = resolveWorldGridCellPixelSize(
    editorHost.state.viewport.gridSize,
  );

  return {
    x:
      editorHost.state.viewport.clientRect.left
      +
      editorHost.state.viewport.clientRect.width / 2
      + (cell.x + 0.5 - editorHost.state.viewport.center.x) * gridCellSize,
    y:
      editorHost.state.viewport.clientRect.top
      +
      editorHost.state.viewport.clientRect.height / 2
      + (cell.y + 0.5 - editorHost.state.viewport.center.y) * gridCellSize,
  };
}
