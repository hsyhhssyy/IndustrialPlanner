import { afterEach, describe, expect, it, vi } from "vitest";
import { runInAction } from "mobx";

import type { DraftEntity } from "@/editor/draft-entity";
import { createDummyWorldDocument } from "@/editor/dummy-document";
import { createEditorHost } from "@/editor/editor-host";
import { EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY } from "@/editor/storage-hook";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import {
  DEFAULT_WORLD_BASE_ID,
  type WorldDocument,
} from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { resolveWorldEntitySpriteLayout } from "@/renderer/scene/render-scene-orchestrator";
import { EDITOR_GRID_CELL_PIXEL_SIZE } from "@/editor/viewport-constants";
import {
  readFromIndexedDb,
  saveToIndexedDb,
} from "@/shared/storage/browser-storage";
import { createFakeIndexedDbFactory } from "@/tests/shared/fake-indexed-db";

const WORLD_DOCUMENT_DATABASE_LOCATION = {
  databaseName: "industrial-planner",
  storeName: "worddocument",
};

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

  it("clamps viewport center to the current base warning bounds while panning", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.moveViewportByClientPixelVector({
      startClientPixel: {
        x: 0,
        y: 0,
      },
      endClientPixel: {
        x: 1600,
        y: 1600,
      },
    });

    expect(editorHost.state.viewport.center).toEqual({
      x: -7,
      y: -7,
    });

    editorHost.actions.moveViewportByClientPixelVector({
      startClientPixel: {
        x: 1600,
        y: 1600,
      },
      endClientPixel: {
        x: 0,
        y: 0,
      },
    });

    expect(editorHost.state.viewport.center).toEqual({
      x: 87,
      y: 87,
    });
  });

  it("zooms viewport through multiplicative steps in both directions", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const expectedGridSizeAfterZoomIn = Math.pow(2, 1 / 3);

    editorHost.actions.zoom(2);

    expect(editorHost.state.viewport.gridSize).toBeCloseTo(expectedGridSizeAfterZoomIn);
    expect(workspace.editor?.state.viewport.gridSize).toBeCloseTo(expectedGridSizeAfterZoomIn);
    expect(editorHost.state.viewport.gridCellPixelSize).toBeCloseTo(
      EDITOR_GRID_CELL_PIXEL_SIZE * expectedGridSizeAfterZoomIn,
    );

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

  it("clamps zoom to the 50% and 800% gridSize limits", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.zoom(999);

    expect(editorHost.state.viewport.gridSize).toBe(8);
    expect(editorHost.state.viewport.gridCellPixelSize).toBe(EDITOR_GRID_CELL_PIXEL_SIZE * 8);

    editorHost.actions.zoom(-999);

    expect(editorHost.state.viewport.gridSize).toBe(0.5);
    expect(editorHost.state.viewport.gridCellPixelSize).toBe(EDITOR_GRID_CELL_PIXEL_SIZE * 0.5);
  });

  it("persists viewport center and grid size without recording history", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    await flushMicrotasks();

    const documentKey = editorHost.document.getSnapshot().documentKey;

    editorHost.actions.moveViewportByClientPixelVector({
      startClientPixel: {
        x: 16,
        y: 0,
      },
      endClientPixel: {
        x: 0,
        y: 32,
      },
    });
    editorHost.actions.zoom(2);

    await flushMicrotasks();

    const storedDocument = await readStoredWorldDocument(documentKey);

    expect(storedDocument?.documentSettings.viewport).toEqual({
      center: {
        x: 1,
        y: -2,
      },
      gridSize: editorHost.state.viewport.gridSize,
    });
    expect(editorHost.state.history.records).toHaveLength(0);
    expect(editorHost.state.history.undoDepth).toBe(0);
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
      gridCellPixelSize: editorHost.state.viewport.gridCellPixelSize,
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
      gridCellPixelSize: editorHost.state.viewport.gridCellPixelSize,
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

  it("finds draft entities at a client pixel point and prioritizes them over document entities", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.drafts = [
      {
        id: "draft-only",
        originalEntityId: "draft-only",
        definitionId: "belt_straight_1x1",
        position: { x: 0, y: 0 },
        rotation: 0,
        config: {},
        tags: [],
      },
      {
        id: "preview-storager",
        originalEntityId: "dummy-entity-2",
        definitionId: "item_port_storager_1",
        position: { x: 4, y: 4 },
        rotation: 0,
        config: {},
        tags: ["preview"],
      },
    ];
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });

    const draftOnlyEntity = editorHost.queries.findEntityAtClientPixelPoint(
      resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 0 }),
    );
    const overlappingDraftEntity = editorHost.queries.findEntityAtClientPixelPoint(
      resolveClientPixelPointForGridCell(editorHost, { x: 5, y: 5 }),
    );

    expect(draftOnlyEntity?.id).toBe("draft-only");
    expect(overlappingDraftEntity?.id).toBe("preview-storager");
  });

  it("gets entities by id from the world document first and then drafts", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.drafts = [
      {
        id: "draft-only",
        originalEntityId: "draft-only",
        definitionId: "belt_straight_1x1",
        position: { x: 9, y: 9 },
        rotation: 0,
        config: {},
        tags: [],
      },
      {
        id: "dummy-entity-1",
        originalEntityId: "dummy-entity-1",
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

  it("patches entity config values through editor actions", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();

    editorHost.internalDocument.setSnapshot(document);

    editorHost.actions.patchEntityConfig("dummy-entity-2", {
      "storageSlotGroups[0].slots[0].initialItemType": "item_copper_ore",
      "storageSlotGroups[0].slots[0].initialCount": 7,
    });

    expect(editorHost.document.getSnapshot().entities["dummy-entity-2"]?.config).toEqual({
      "storageSlotGroups[0].slots[0].initialItemType": "item_copper_ore",
      "storageSlotGroups[0].slots[0].initialCount": 7,
    });

    editorHost.actions.patchEntityConfig("missing-entity", {
      "storageSlotGroups[0].slots[0].initialCount": 9,
    });

    expect(editorHost.document.getSnapshot().entities["dummy-entity-2"]?.config).toEqual({
      "storageSlotGroups[0].slots[0].initialItemType": "item_copper_ore",
      "storageSlotGroups[0].slots[0].initialCount": 7,
    });
  });

  it("lists document entities plus draft entities as a union by id", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.drafts = [
      {
        id: "draft-only",
        originalEntityId: "draft-only",
        definitionId: "belt_straight_1x1",
        position: { x: 9, y: 9 },
        rotation: 0,
        config: {},
        tags: [],
      },
      {
        id: "dummy-entity-2",
        originalEntityId: "dummy-entity-2",
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

  it("mutates entity collections through editor actions", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();
    const draftEntity: DraftEntity = {
      id: "draft-only",
      originalEntityId: "draft-only",
      definitionId: "belt_straight_1x1",
      position: { x: 9, y: 9 },
      rotation: 0,
      config: {},
      tags: [],
    };

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.drafts = [draftEntity];

    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "dummy-entity-1",
    });
    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "draft-only",
    });
    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "missing-entity",
    });
    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "dummy-entity-1",
    });
    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.preview,
      entityId: "draft-only",
    });

    expect(editorHost.state.collections.selection).toEqual([
      "dummy-entity-1",
      "draft-only",
    ]);
    expect(editorHost.state.collections.selection.contains("dummy-entity-1")).toBe(true);
    expect(editorHost.state.collections.selection.contains("missing-entity")).toBe(false);
    expect(editorHost.state.collections.preview).toEqual(["draft-only"]);
    expect(editorHost.state.collections.preview.contains("draft-only")).toBe(true);

    editorHost.actions.removeFromCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "dummy-entity-1",
    });
    editorHost.actions.removeFromCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "missing-entity",
    });

    expect(editorHost.state.collections.selection).toEqual(["draft-only"]);
    expect(editorHost.state.collections.selection.contains("dummy-entity-1")).toBe(false);

    editorHost.actions.clearCollection(EntityCollectionType.preview);

    expect(editorHost.state.collections.preview).toEqual([]);
    expect(editorHost.state.collections.preview.contains("preview-only")).toBe(false);
  });

  it("updates marquee collections from grid rect and clears both when cancelled", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.drafts = [
      {
        id: "draft-only",
        originalEntityId: "draft-only",
        definitionId: "belt_straight_1x1",
        position: { x: 9, y: 9 },
        rotation: 0,
        config: {},
        tags: [],
      },
    ];

    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.marquee,
      entityId: "dummy-entity-2",
    });
    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.reverseMarquee,
      entityId: "dummy-entity-3",
    });
    editorHost.actions.setMarqueeRange(EntityCollectionType.marquee, {
      x: 9,
      y: 8,
      width: 4,
      height: 2,
    });

    expect(editorHost.state.collections.marquee).toEqual([
      "dummy-entity-1",
      "draft-only",
    ]);
    expect(editorHost.state.marqueeGridRect).toEqual({
      x: 9,
      y: 8,
      width: 4,
      height: 2,
    });

    editorHost.actions.setMarqueeRange(EntityCollectionType.reverseMarquee, {
      x: 9,
      y: 4,
      width: 4,
      height: 1,
    });

    expect(
      editorHost.state.collections[EntityCollectionType.reverseMarquee],
    ).toEqual(["dummy-entity-3"]);
    expect(editorHost.state.marqueeGridRect).toEqual({
      x: 9,
      y: 4,
      width: 4,
      height: 1,
    });

    editorHost.actions.setMarqueeRange(EntityCollectionType.marquee, {
      x: 9,
      y: 9,
      width: 1,
      height: 1,
    });

    expect(editorHost.state.collections.marquee).toEqual(["draft-only"]);

    editorHost.actions.cancelMarquee();

    expect(editorHost.state.collections.marquee).toEqual([]);
    expect(
      editorHost.state.collections[EntityCollectionType.reverseMarquee],
    ).toEqual([]);
    expect(editorHost.state.marqueeGridRect).toBeNull();
  });

  it("applies marquee additions, removes reverse marquee entities, and clears both collections", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();
    const draftEntity: DraftEntity = {
      id: "draft-only",
      originalEntityId: "draft-only",
      definitionId: "belt_straight_1x1",
      position: { x: 9, y: 9 },
      rotation: 0,
      config: {},
      tags: [],
    };

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.drafts = [draftEntity];

    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "dummy-entity-2",
    });
    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.marquee,
      entityId: "dummy-entity-1",
    });
    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.marquee,
      entityId: "dummy-entity-2",
    });
    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.marquee,
      entityId: "draft-only",
    });
    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.reverseMarquee,
      entityId: "dummy-entity-2",
    });
    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.reverseMarquee,
      entityId: "missing-entity",
    });
    editorHost.internalState.marqueeGridRect = {
      x: 3,
      y: 4,
      width: 2,
      height: 2,
    };

    editorHost.actions.applyMarquee();

    expect(editorHost.state.collections.selection).toEqual([
      "dummy-entity-1",
      "draft-only",
    ]);
    expect(editorHost.state.collections.marquee).toEqual([]);
    expect(
      editorHost.state.collections[EntityCollectionType.reverseMarquee],
    ).toEqual([]);
    expect(editorHost.state.marqueeGridRect).toBeNull();
  });

  it("creates single-placement drafts with odd footprints centered on the provided grid point", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.createSinglePlacementDraft("item_port_storager_1", {
      x: 10,
      y: 20,
    });

    const draftId = editorHost.state.collections.preview[0];
    expect(draftId).toBeDefined();
    expect(editorHost.queries.getEntityById(draftId ?? "")).toMatchObject({
      definitionId: "item_port_storager_1",
      position: {
        x: 9,
        y: 19,
      },
      rotation: 0,
    });
    expect(editorHost.queries.findEntityCollectionGridRect(EntityCollectionType.preview)).toEqual({
      x: 9,
      y: 19,
      width: 3,
      height: 3,
    });
  });

  it("uses the left/up center cell for even single-placement footprints", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.createSinglePlacementDraft("item_port_log_hongs_bus", {
      x: 10,
      y: 20,
    });

    const draftId = editorHost.state.collections.preview[0];
    expect(draftId).toBeDefined();
    expect(editorHost.queries.getEntityById(draftId ?? "")).toMatchObject({
      definitionId: "item_port_log_hongs_bus",
      position: {
        x: 9,
        y: 17,
      },
      rotation: 0,
    });
    expect(editorHost.queries.findEntityCollectionGridRect(EntityCollectionType.preview)).toEqual({
      x: 9,
      y: 17,
      width: 4,
      height: 8,
    });
  });

  it("creates and applies blueprint placement drafts with remapped slot links", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const blueprint = createBlueprintDocument({
      name: "双设备蓝图",
      baseId: DEFAULT_WORLD_BASE_ID,
      initialGridPoint: { x: 10, y: 10 },
      entities: {
        source: {
          id: "source",
          definitionId: "item_port_storager_1",
          position: { x: 9, y: 9 },
          rotation: 0,
          config: {},
          tags: [],
        },
        target: {
          id: "target",
          definitionId: "item_port_storager_1",
          position: { x: 12, y: 9 },
          rotation: 90,
          config: {},
          tags: ["test"],
        },
      },
      entityOrder: ["source", "target"],
      slotLinks: [{
        id: "blueprint-link",
        linkType: "share-all",
        source: {
          entityId: "source",
          storageSlotGroupId: "output",
          slotId: "output-slot",
        },
        target: {
          entityId: "target",
          storageSlotGroupId: "input",
          slotId: "input-slot",
        },
      }],
    });

    editorHost.actions.createBlueprintPlacementDraft?.(blueprint, { x: 30, y: 15 });

    expect(editorHost.state.collections.preview).toHaveLength(2);

    const [sourceDraftId, targetDraftId] = editorHost.state.collections.preview;

    expect(editorHost.queries.getEntityById(sourceDraftId ?? "")).toMatchObject({
      definitionId: "item_port_storager_1",
      position: { x: 29, y: 14 },
      rotation: 0,
    });
    expect(editorHost.queries.getEntityById(targetDraftId ?? "")).toMatchObject({
      definitionId: "item_port_storager_1",
      position: { x: 32, y: 14 },
      rotation: 90,
      tags: ["test"],
    });
    expect(editorHost.internalState.internalTransientState.placementDraftSlotLinks).toEqual([{
      id: expect.any(String),
      linkType: "share-all",
      source: {
        entityId: sourceDraftId,
        storageSlotGroupId: "output",
        slotId: "output-slot",
      },
      target: {
        entityId: targetDraftId,
        storageSlotGroupId: "input",
        slotId: "input-slot",
      },
    }]);

    expect(editorHost.actions.applyPlacementDraft()).toBe(true);
    expect(editorHost.state.collections.preview).toEqual([]);
    expect(editorHost.document.getSnapshot().entityOrder.slice(-2)).toEqual([
      sourceDraftId,
      targetDraftId,
    ]);
    expect(editorHost.document.getSnapshot().slotLinks).toEqual([{
      id: expect.any(String),
      linkType: "share-all",
      source: {
        entityId: sourceDraftId,
        storageSlotGroupId: "output",
        slotId: "output-slot",
      },
      target: {
        entityId: targetDraftId,
        storageSlotGroupId: "input",
        slotId: "input-slot",
      },
    }]);
    expect(editorHost.internalState.internalTransientState.placementDraftSlotLinks).toBeNull();
  });

  it("creates and applies a single-bend belt logistics draft from an empty cell", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    const startResult = editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "empty-cell",
        gridPoint: { x: 0, y: 0 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 2, y: 1 },
      routeMode: {
        type: "single-bend",
        routeOrder: "vertical-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(startResult.status).toBe("created");
    expect(moveResult).toMatchObject({
      status: "updated",
      canApply: true,
      invalidReason: null,
      headGridPoint: { x: 2, y: 1 },
    });
    expect(editorHost.queries.resolveLogisticsDraftState()?.cells.map((cell) => ({
      x: cell.gridPoint.x,
      y: cell.gridPoint.y,
      definitionId: cell.shape,
    }))).toEqual([
      { x: 0, y: 0, definitionId: "straight" },
      { x: 0, y: 1, definitionId: "turn-ccw" },
      { x: 1, y: 1, definitionId: "straight" },
      { x: 2, y: 1, definitionId: "straight" },
    ]);
    expect(editorHost.state.collections[EntityCollectionType.logisticsHead]).toEqual([
      editorHost.state.collections.preview.at(-1),
    ]);

    expect(editorHost.actions.applyLogisticDraft()).toBe(true);
    expect(editorHost.state.collections.preview).toEqual([]);
    expect(editorHost.state.collections[EntityCollectionType.logisticsHead]).toEqual([]);
    expect(editorHost.queries.resolveLogisticsDraftState()).toBeNull();
    expect(editorHost.queries.listEntities().filter((entity) =>
      entity.id.startsWith("logistics-draft:belt"),
    )).toHaveLength(4);
  });

  it("reuses preview draft ids for unchanged logistics cells across updates", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "empty-cell",
        gridPoint: { x: 0, y: 0 },
      },
    });
    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 2, y: 0 },
      routeMode: {
        type: "single-bend",
        routeOrder: "horizontal-first",
        allowTemporaryOrderFlip: true,
      },
    });

    const previewBefore = [...editorHost.state.collections.preview];

    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 3, y: 0 },
      routeMode: {
        type: "single-bend",
        routeOrder: "horizontal-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(editorHost.state.collections.preview.slice(0, previewBefore.length)).toEqual(previewBefore);
    expect(editorHost.state.collections.preview).toHaveLength(4);
  });

  it("does not reuse preview draft ids when a logistics cell changes definition", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "empty-cell",
        gridPoint: { x: 0, y: 0 },
      },
    });
    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 2, y: 0 },
      routeMode: {
        type: "single-bend",
        routeOrder: "horizontal-first",
        allowTemporaryOrderFlip: true,
      },
    });

    const previewBefore = [...editorHost.state.collections.preview];

    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 2, y: 1 },
      routeMode: {
        type: "single-bend",
        routeOrder: "vertical-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(editorHost.state.collections.preview[0]).toBe(previewBefore[0]);
    expect(editorHost.state.collections.preview[1]).not.toBe(previewBefore[1]);
  });

  it("marks logistics drafts invalid when they overlap existing path tiles", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "empty-cell",
        gridPoint: { x: 11, y: 8 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 12, y: 8 },
      routeMode: {
        type: "single-bend",
        routeOrder: "horizontal-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult).toMatchObject({
      canApply: false,
      invalidReason: "overlap-existing-logistics",
    });
    expect(editorHost.actions.applyLogisticDraft()).toBe(false);
    expect(editorHost.internalDocument.getSnapshot().entities["dummy-entity-1"]).toBeDefined();
  });

  it("replaces only the starting logistics tile when applying from an existing path", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "logistics-entity",
        entityId: "dummy-entity-1",
        gridPoint: { x: 12, y: 8 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 13, y: 8 },
      routeMode: {
        type: "single-bend",
        routeOrder: "horizontal-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult.canApply).toBe(true);
    expect(editorHost.state.collections.ghost).toEqual(["dummy-entity-1"]);
    expect(editorHost.actions.applyLogisticDraft()).toBe(true);

    const snapshot = editorHost.internalDocument.getSnapshot();
    expect(snapshot.entities["dummy-entity-1"]).toBeUndefined();
    expect(Object.values(snapshot.entities).filter((entity) =>
      entity.definitionId.startsWith("belt_")
      && entity.position.y === 8
      && (entity.position.x === 12 || entity.position.x === 13),
    )).toHaveLength(2);
  });

  it("uses a real predecessor connection when shaping the first replaced logistics tile", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();

    document.entities["dummy-entity-1"] = {
      ...document.entities["dummy-entity-1"]!,
      position: { x: 12, y: 8 },
      rotation: 90,
    };
    document.entities["dummy-belt-predecessor"] = {
      id: "dummy-belt-predecessor",
      definitionId: "belt_straight_1x1",
      position: { x: 12, y: 7 },
      rotation: 90,
      config: {},
      tags: [],
    };
    document.entityOrder = [
      ...document.entityOrder.filter((entityId) => entityId !== "dummy-belt-predecessor"),
      "dummy-belt-predecessor",
    ];
    editorHost.internalDocument.setSnapshot(document);

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "logistics-entity",
        entityId: "dummy-entity-1",
        gridPoint: { x: 12, y: 8 },
      },
    });
    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 13, y: 8 },
      routeMode: {
        type: "single-bend",
        routeOrder: "horizontal-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(editorHost.queries.resolveLogisticsDraftState()?.cells[0]).toMatchObject({
      gridPoint: { x: 12, y: 8 },
      fromEdge: "NORTH",
      toEdge: "EAST",
      shape: "turn-ccw",
      rotation: 90,
    });
  });

  it("keeps an existing-source logistics draft when the first step points back into its connected predecessor", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();

    document.entities["dummy-entity-1"] = {
      ...document.entities["dummy-entity-1"]!,
      position: { x: 12, y: 8 },
      rotation: 180,
    };
    document.entities["dummy-belt-predecessor"] = {
      id: "dummy-belt-predecessor",
      definitionId: "belt_straight_1x1",
      position: { x: 13, y: 8 },
      rotation: 180,
      config: {},
      tags: [],
    };
    document.entityOrder = [
      ...document.entityOrder.filter((entityId) => entityId !== "dummy-belt-predecessor"),
      "dummy-belt-predecessor",
    ];
    editorHost.internalDocument.setSnapshot(document);

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "logistics-entity",
        entityId: "dummy-entity-1",
        gridPoint: { x: 12, y: 8 },
      },
    });
    const initialCells = editorHost.queries.resolveLogisticsDraftState()?.cells.map((cell) => ({
      gridPoint: cell.gridPoint,
      fromEdge: cell.fromEdge,
      toEdge: cell.toEdge,
      shape: cell.shape,
      rotation: cell.rotation,
    }));

    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 13, y: 8 },
      routeMode: {
        type: "single-bend",
        routeOrder: "horizontal-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult).toMatchObject({
      status: "ignored",
      headGridPoint: { x: 12, y: 8 },
    });
    expect(editorHost.queries.resolveLogisticsDraftState()?.cells.map((cell) => ({
      gridPoint: cell.gridPoint,
      fromEdge: cell.fromEdge,
      toEdge: cell.toEdge,
      shape: cell.shape,
      rotation: cell.rotation,
    }))).toEqual(initialCells);
  });

  it("allows an existing-source logistics draft to start away from its connected predecessor", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();

    document.entities["dummy-entity-1"] = {
      ...document.entities["dummy-entity-1"]!,
      position: { x: 12, y: 8 },
      rotation: 180,
    };
    document.entities["dummy-belt-predecessor"] = {
      id: "dummy-belt-predecessor",
      definitionId: "belt_straight_1x1",
      position: { x: 13, y: 8 },
      rotation: 180,
      config: {},
      tags: [],
    };
    document.entityOrder = [
      ...document.entityOrder.filter((entityId) => entityId !== "dummy-belt-predecessor"),
      "dummy-belt-predecessor",
    ];
    editorHost.internalDocument.setSnapshot(document);

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "logistics-entity",
        entityId: "dummy-entity-1",
        gridPoint: { x: 12, y: 8 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 12, y: 7 },
      routeMode: {
        type: "single-bend",
        routeOrder: "horizontal-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult).toMatchObject({
      status: "updated",
      headGridPoint: { x: 12, y: 7 },
    });
    expect(editorHost.queries.resolveLogisticsDraftState()?.cells).toMatchObject([
      {
        gridPoint: { x: 12, y: 8 },
        fromEdge: "EAST",
        toEdge: "NORTH",
      },
      {
        gridPoint: { x: 12, y: 7 },
      },
    ]);
  });

  it("ignores stale replaced tile rotation when no predecessor is connected", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();

    document.entities["dummy-entity-1"] = {
      ...document.entities["dummy-entity-1"]!,
      position: { x: 12, y: 8 },
      rotation: 90,
    };
    editorHost.internalDocument.setSnapshot(document);

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "logistics-entity",
        entityId: "dummy-entity-1",
        gridPoint: { x: 12, y: 8 },
      },
    });
    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 13, y: 8 },
      routeMode: {
        type: "single-bend",
        routeOrder: "horizontal-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(editorHost.queries.resolveLogisticsDraftState()?.cells[0]).toMatchObject({
      gridPoint: { x: 12, y: 8 },
      fromEdge: "WEST",
      toEdge: "EAST",
      shape: "straight",
      rotation: 0,
    });
  });

  it("resolves logistics endpoints without treating splitter devices as replaceable path tiles", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());

    expect(
      editorHost.queries.findLogisticsDraftEndpointAtGridPoint({ x: 12, y: 8 }, "belt"),
    ).toMatchObject({
      type: "logistics-entity",
      entityId: "dummy-entity-1",
    });
    expect(
      editorHost.queries.findLogisticsDraftEndpointAtGridPoint({ x: 14, y: 10 }, "belt"),
    ).toMatchObject({
      type: "device-port",
      entityId: "dummy-entity-6",
      portDirection: "output",
    });
  });

  it("creates move operation ghost entities and preview drafts from the current selection", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.drafts = [
      {
        id: "persisted-draft",
        originalEntityId: "persisted-origin",
        definitionId: "belt_straight_1x1",
        position: { x: 30, y: 30 },
        rotation: 0,
        config: {},
        tags: ["persisted"],
      },
    ];
    editorHost.internalState.collections.selection.replace([
      "dummy-entity-1",
      "dummy-entity-2",
    ]);

    editorHost.actions.createMoveOperationDraft();

    expect(editorHost.state.collections.selection).toEqual([
      "dummy-entity-1",
      "dummy-entity-2",
    ]);
    expect(editorHost.state.collections.ghost).toEqual([
      "dummy-entity-1",
      "dummy-entity-2",
    ]);
    expect(editorHost.state.collections.preview).toHaveLength(2);
    expect(editorHost.internalState.drafts).toHaveLength(3);

    const createdDrafts = editorHost.state.collections.preview.map((draftId) =>
      editorHost.internalState.drafts.find((entity) => entity.id === draftId) ?? null,
    );

    expect(createdDrafts).toHaveLength(2);
    expect(createdDrafts[0]).toMatchObject({
      definitionId: document.entities["dummy-entity-1"]?.definitionId,
      position: document.entities["dummy-entity-1"]?.position,
      rotation: document.entities["dummy-entity-1"]?.rotation,
      config: document.entities["dummy-entity-1"]?.config,
      tags: document.entities["dummy-entity-1"]?.tags,
      originalEntityId: "dummy-entity-1",
    });
    expect(createdDrafts[1]).toMatchObject({
      definitionId: document.entities["dummy-entity-2"]?.definitionId,
      position: document.entities["dummy-entity-2"]?.position,
      rotation: document.entities["dummy-entity-2"]?.rotation,
      config: document.entities["dummy-entity-2"]?.config,
      tags: document.entities["dummy-entity-2"]?.tags,
      originalEntityId: "dummy-entity-2",
    });
    expect(createdDrafts[0]?.id).not.toBe("dummy-entity-1");
    expect(createdDrafts[1]?.id).not.toBe("dummy-entity-2");
    expect(
      editorHost.internalState.drafts.find((entity) => entity.id === "persisted-draft"),
    ).toBeDefined();
  });

  it("applies move operation drafts back into ghost entities and clears operation state", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.drafts = [
      {
        id: "persisted-draft",
        originalEntityId: "persisted-origin",
        definitionId: "belt_straight_1x1",
        position: { x: 30, y: 30 },
        rotation: 0,
        config: {},
        tags: ["persisted"],
      },
    ];
    editorHost.internalState.collections.selection.replace(["dummy-entity-1"]);

    editorHost.actions.createMoveOperationDraft();

    const previewDraftId = editorHost.state.collections.preview[0];
    const previewDraft = editorHost.internalState.drafts.find((entity) => entity.id === previewDraftId);

    if (!previewDraft) {
      throw new Error("Expected move operation preview draft to exist.");
    }

    runInAction(() => {
      previewDraft.position = { x: 20, y: 18 };
      previewDraft.rotation = 180;
    });

    expect(editorHost.actions.applyMoveOerationDraft()).toBe(true);
    expect(editorHost.document.getSnapshot().entities["dummy-entity-1"]).toMatchObject({
      position: { x: 20, y: 18 },
      rotation: 180,
    });
    expect(editorHost.state.collections.selection).toEqual([]);
    expect(editorHost.state.collections.ghost).toEqual([]);
    expect(editorHost.state.collections.preview).toEqual([]);
    expect(editorHost.internalState.drafts).toHaveLength(1);
    expect(editorHost.internalState.drafts[0]?.id).toBe("persisted-draft");
  });

  it("keeps multi-selection after applying move operation drafts for multiple entities", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.collections.selection.replace(["dummy-entity-1", "dummy-entity-2"]);

    editorHost.actions.createMoveOperationDraft();

    expect(editorHost.actions.applyMoveOerationDraft()).toBe(true);
    expect(editorHost.state.collections.selection).toEqual(["dummy-entity-1", "dummy-entity-2"]);
    expect(editorHost.state.collections.ghost).toEqual([]);
    expect(editorHost.state.collections.preview).toEqual([]);
  });

  it("cancels move operation drafts by clearing ghost and preview state only", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.drafts = [
      {
        id: "persisted-draft",
        originalEntityId: "persisted-origin",
        definitionId: "belt_straight_1x1",
        position: { x: 30, y: 30 },
        rotation: 0,
        config: {},
        tags: ["persisted"],
      },
    ];
    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);

    editorHost.actions.createMoveOperationDraft();
    editorHost.actions.cancelMoveOperationDraft();

    expect(editorHost.state.collections.ghost).toEqual([]);
    expect(editorHost.state.collections.preview).toEqual([]);
    expect(editorHost.internalState.drafts).toHaveLength(1);
    expect(editorHost.internalState.drafts[0]?.id).toBe("persisted-draft");
    expect(editorHost.document.getSnapshot().entities["dummy-entity-2"]).toEqual(
      document.entities["dummy-entity-2"],
    );
  });

  it("moves entity collections by grid point vector through editor actions", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();
    const draftOnlyEntity: DraftEntity = {
      id: "draft-only",
      originalEntityId: "draft-only",
      definitionId: "belt_straight_1x1",
      position: { x: 9, y: 9 },
      rotation: 0,
      config: {},
      tags: [],
    };
    const documentShadowDraft: DraftEntity = {
      id: "dummy-entity-1",
      originalEntityId: "dummy-entity-1",
      definitionId: "belt_straight_1x1",
      position: { x: 30, y: 30 },
      rotation: 0,
      config: {},
      tags: ["draft-shadow"],
    };

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.drafts = [draftOnlyEntity, documentShadowDraft];
    editorHost.internalState.collections.selection.replace([
      "dummy-entity-1",
      "draft-only",
      "missing-entity",
    ]);

    editorHost.actions.moveCollectionTo({
      collectionType: EntityCollectionType.selection,
      startGridPoint: { x: 2, y: 2 },
      endGridPoint: { x: 5, y: 0 },
    });

    expect(editorHost.document.getSnapshot().entities["dummy-entity-1"]?.position).toEqual({
      x: 15,
      y: 6,
    });
    expect(editorHost.document.getSnapshot().entities["dummy-entity-2"]?.position).toEqual({
      x: 4,
      y: 4,
    });
    expect(editorHost.internalState.drafts.find((entity) => entity.id === "draft-only")?.position).toEqual({
      x: 12,
      y: 7,
    });
    expect(
      editorHost.internalState.drafts.find((entity) => entity.tags.includes("draft-shadow"))
        ?.position,
    ).toEqual({
      x: 30,
      y: 30,
    });
  });

  it("deletes entity collections from document, drafts, and stale collection references", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();
    const draftOnlyEntity: DraftEntity = {
      id: "draft-only",
      originalEntityId: "draft-only",
      definitionId: "belt_straight_1x1",
      position: { x: 9, y: 9 },
      rotation: 0,
      config: {},
      tags: [],
    };
    const movePreviewDraft: DraftEntity = {
      id: "move-draft:dummy-entity-1",
      originalEntityId: "dummy-entity-1",
      definitionId: "belt_straight_1x1",
      position: { x: 30, y: 30 },
      rotation: 0,
      config: {},
      tags: ["draft-shadow"],
    };
    const unrelatedDraft: DraftEntity = {
      id: "persisted-draft",
      originalEntityId: "persisted-draft",
      definitionId: "belt_straight_1x1",
      position: { x: 18, y: 11 },
      rotation: 0,
      config: {},
      tags: [],
    };

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.drafts = [draftOnlyEntity, movePreviewDraft, unrelatedDraft];
    editorHost.internalState.collections.selection.replace([
      "dummy-entity-1",
      "draft-only",
      "missing-entity",
    ]);
    editorHost.internalState.collections.preview.replace([
      "draft-only",
      "move-draft:dummy-entity-1",
      "dummy-entity-2",
    ]);
    editorHost.internalState.collections.ghost.replace(["dummy-entity-1"]);
    editorHost.internalState.collections.marquee.replace([
      "dummy-entity-1",
      "dummy-entity-2",
    ]);
    editorHost.internalState.marqueeGridRect = {
      x: 1,
      y: 1,
      width: 2,
      height: 2,
    };

    editorHost.actions.deleteCollection(EntityCollectionType.selection);

    expect(editorHost.document.getSnapshot().entities["dummy-entity-1"]).toBeUndefined();
    expect(editorHost.document.getSnapshot().entities["dummy-entity-2"]).toEqual(
      document.entities["dummy-entity-2"],
    );
    expect(editorHost.internalState.drafts.map((entity) => entity.id)).toEqual([
      "persisted-draft",
    ]);
    expect(editorHost.state.collections.selection).toEqual([]);
    expect(editorHost.state.collections.preview).toEqual(["dummy-entity-2"]);
    expect(editorHost.state.collections.ghost).toEqual([]);
    expect(editorHost.state.collections.marquee).toEqual(["dummy-entity-2"]);
    expect(editorHost.state.marqueeGridRect).toEqual({
      x: 1,
      y: 1,
      width: 2,
      height: 2,
    });
  });

  it("rotates entity collections around the collection bounding center through editor actions", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.collections.selection.replace([
      "dummy-entity-2",
      "dummy-entity-1",
    ]);

    editorHost.actions.rotateCollection(EntityCollectionType.selection);

    expect(editorHost.document.getSnapshot().entities["dummy-entity-2"]).toMatchObject({
      position: {
        x: 8,
        y: 2,
      },
      rotation: 90,
    });
    expect(editorHost.document.getSnapshot().entities["dummy-entity-1"]).toMatchObject({
      position: {
        x: 6,
        y: 10,
      },
      rotation: 90,
    });
    expect(editorHost.queries.findEntityCollectionGridRect("selection")).toEqual({
      x: 6,
      y: 2,
      width: 5,
      height: 9,
    });
  });

  it("rotates preview draft collections without clamping negative grid positions", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalState.drafts = [
      {
        id: "preview-belt",
        originalEntityId: "preview-belt",
        definitionId: "belt_straight_1x1",
        position: {
          x: -2,
          y: 3,
        },
        rotation: 0,
        config: {},
        tags: [],
      },
    ];
    editorHost.internalState.collections.preview.replace(["preview-belt"]);

    editorHost.actions.rotateCollection(EntityCollectionType.preview);

    expect(editorHost.internalState.drafts[0]).toMatchObject({
      id: "preview-belt",
      position: {
        x: -2,
        y: 3,
      },
      rotation: 90,
    });
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
    editorHost.internalState.drafts = [
      {
        id: "preview-unloader",
        originalEntityId: "preview-unloader",
        definitionId: "item_port_unloader_1",
        position: {
          x: -2,
          y: 3,
        },
        rotation: 90,
        config: {},
        tags: [],
      },
      {
        id: "preview-belt",
        originalEntityId: "preview-belt",
        definitionId: "belt_straight_1x1",
        position: {
          x: 4,
          y: 8,
        },
        rotation: 0,
        config: {},
        tags: [],
      },
    ];
    editorHost.internalState.collections.selection.replace([
      selectedStorager.id,
      selectedBelt.id,
    ]);
    editorHost.internalState.collections.preview.replace([
      "preview-unloader",
      "preview-belt",
    ]);

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
        originalEntityId: "draft-only",
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

    expect(Object.values(EntityCollectionType)).toEqual([
      "selection",
      "marquee",
      "reverse-marquee",
      "preview",
      "ghost",
      "logistics-head",
    ]);
    expect(
      editorHost.queries.findEntityCollectionGridRect("selection"),
    ).toBeNull();
    expect(editorHost.queries.findEntityCollectionGridRect("marquee")).toBeNull();
    expect(editorHost.queries.findEntityCollectionGridRect("reverse-marquee")).toBeNull();
    expect(editorHost.queries.findEntityCollectionGridRect("preview")).toBeNull();
    expect(editorHost.queries.findEntityCollectionGridRect("ghost")).toBeNull();
    expect(editorHost.queries.findEntityCollectionGridRect("logistics-head")).toBeNull();
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

  it("finds the world grid cell for a client pixle point", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });

    const gridCell = editorHost.queries.findGridCellForClientPixlePoint(
      resolveClientPixelPointForGridCell(editorHost, { x: 4, y: 4 }),
    );

    expect(gridCell).toEqual({ x: 4, y: 4 });
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

  it.each<[string | null]>([[null], [""]])(
    "creates and persists a new world document on startup for empty lastDocumentId=%p",
    async (lastDocumentId) => {
      vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
      localStorage.setItem(
        EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY,
        JSON.stringify({
          lastDocumentId,
        }),
      );

      const workspace = createWorkspace();
      const editorHost = createEditorHost(workspace);

      await flushMicrotasks();

      const document = editorHost.document.getSnapshot();

      expect(document.documentKey).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(document.baseId).toBe(DEFAULT_WORLD_BASE_ID);
      expect(editorHost.internalState.internalPersistState.lastDocumentId).toBe(
        document.documentKey,
      );
      expect(editorHost.internalState.internalPersistState.latestDocumentIdByBaseId).toEqual({
        [DEFAULT_WORLD_BASE_ID]: document.documentKey,
      });
      await expect(readStoredWorldDocument(document.documentKey)).resolves.toEqual(document);
    },
  );

  it("hydrates the last opened document from IndexedDB on startup", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    const persistedDocument = {
      ...createDummyWorldDocument(),
      documentKey: "22222222-2222-4222-8222-222222222222",
      meta: {
        ...createDummyWorldDocument().meta,
        name: "Persisted World",
      },
      documentSettings: {
        ...createDummyWorldDocument().documentSettings,
        viewport: {
          center: {
            x: 12.5,
            y: -8.25,
          },
          gridSize: 4,
        },
      },
    };
    await saveStoredWorldDocument(persistedDocument);
    localStorage.setItem(
      EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify({
        lastDocumentId: persistedDocument.documentKey,
      }),
    );

    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    await flushMicrotasks();

    expect(editorHost.document.getSnapshot()).toEqual(persistedDocument);
    expect(editorHost.internalState.internalPersistState.lastDocumentId).toBe(
      persistedDocument.documentKey,
    );
    expect(editorHost.internalState.internalPersistState.latestDocumentIdByBaseId).toEqual({
      [DEFAULT_WORLD_BASE_ID]: persistedDocument.documentKey,
    });
    expect(editorHost.state.viewport.center).toEqual({
      x: 12.5,
      y: -7,
    });
    expect(editorHost.state.viewport.gridSize).toBe(4);
    expect(editorHost.state.viewport.gridCellPixelSize).toBe(
      EDITOR_GRID_CELL_PIXEL_SIZE * 4,
    );
  });

  it("clamps loaded viewport center to the current base warning bounds", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const nextDocument = createDummyWorldDocument();

    editorHost.internalDocument.setSnapshot({
      ...nextDocument,
      baseId: DEFAULT_WORLD_BASE_ID,
      documentSettings: {
        ...nextDocument.documentSettings,
        viewport: {
          center: {
            x: 999,
            y: -999,
          },
          gridSize: 1,
        },
      },
    });

    expect(editorHost.state.viewport.center).toEqual({
      x: 87,
      y: -7,
    });
  });

  it("writes document snapshot changes back into IndexedDB", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    await flushMicrotasks();

    const currentDocument = editorHost.document.getSnapshot();
    const nextDocument: WorldDocument = {
      ...currentDocument,
      meta: {
        ...currentDocument.meta,
        name: "Saved From Snapshot",
      },
    };

    editorHost.internalDocument.setSnapshot(nextDocument);

    await flushMicrotasks();

    await expect(readStoredWorldDocument(nextDocument.documentKey)).resolves.toEqual(nextDocument);
  });

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
        latestDocumentIdByBaseId: {},
      }),
    );

    editorHost.dispose();
    runInAction(() => {
      editorHost.internalState.internalPersistState.lastDocumentId = null;
    });

    expect(localStorage.getItem(EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        lastDocumentId: "document-2",
        latestDocumentIdByBaseId: {},
      }),
    );
  });

  it("lists base document summaries and loads the latest document for a base", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    const wulingDocument = {
      ...createDummyWorldDocument(),
      documentKey: "22222222-2222-4222-8222-222222222222",
      baseId: "wuling_protocol_core",
      meta: {
        ...createDummyWorldDocument().meta,
        updatedAt: "2026-05-10T08:00:00.000Z",
      },
      entityOrder: ["dummy-entity-2", "dummy-entity-3"],
    };
    const valleyDocument = {
      ...createDummyWorldDocument(),
      documentKey: "33333333-3333-4333-8333-333333333333",
      baseId: "valley4_protocol_core",
      meta: {
        ...createDummyWorldDocument().meta,
        updatedAt: "2026-05-10T09:00:00.000Z",
      },
      entityOrder: ["dummy-entity-2"],
      documentSettings: {
        ...createDummyWorldDocument().documentSettings,
        viewport: {
          center: {
            x: -3.5,
            y: 9.25,
          },
          gridSize: 2,
        },
      },
    };

    await saveStoredWorldDocument(wulingDocument);
    await saveStoredWorldDocument(valleyDocument);
    localStorage.setItem(
      EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify({
        lastDocumentId: wulingDocument.documentKey,
        latestDocumentIdByBaseId: {
          wuling_protocol_core: wulingDocument.documentKey,
          valley4_protocol_core: valleyDocument.documentKey,
        },
      }),
    );

    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    await flushMicrotasks();

    const summaries = await editorHost.queries.listBaseDocumentSummaries();
    const valleySummary = summaries.find((summary) => summary.baseId === "valley4_protocol_core");

    expect(valleySummary).toEqual({
      baseId: "valley4_protocol_core",
      documentKey: valleyDocument.documentKey,
      entityCount: 1,
      updatedAt: "2026-05-10T09:00:00.000Z",
    });

    await expect(editorHost.actions.loadLatestBaseDocument("valley4_protocol_core")).resolves.toBe(true);

    expect(editorHost.document.getSnapshot()).toEqual(valleyDocument);
    expect(editorHost.internalState.internalPersistState.lastDocumentId).toBe(valleyDocument.documentKey);
    expect(editorHost.internalState.internalPersistState.latestDocumentIdByBaseId).toMatchObject({
      valley4_protocol_core: valleyDocument.documentKey,
    });
    expect(editorHost.state.viewport.center).toEqual({
      x: -3.5,
      y: 9.25,
    });
    expect(editorHost.state.viewport.gridSize).toBe(2);
    expect(editorHost.state.viewport.gridCellPixelSize).toBe(
      EDITOR_GRID_CELL_PIXEL_SIZE * 2,
    );
  });

  it("creates a new document when a base has no latest document", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    await flushMicrotasks();

    await expect(editorHost.actions.loadLatestBaseDocument("valley4_infra_outpost")).resolves.toBe(true);

    const document = editorHost.document.getSnapshot();

    expect(document.baseId).toBe("valley4_infra_outpost");
    expect(document.entityOrder).toEqual([]);
    expect(editorHost.internalState.internalPersistState.latestDocumentIdByBaseId.valley4_infra_outpost).toBe(
      document.documentKey,
    );
    await expect(readStoredWorldDocument(document.documentKey)).resolves.toEqual(document);
  });
});

async function flushMicrotasks(iterations = 20): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

function readStoredWorldDocument(
  documentKey: string,
): Promise<WorldDocument | null> {
  return readFromIndexedDb<WorldDocument>({
    ...WORLD_DOCUMENT_DATABASE_LOCATION,
    key: documentKey,
  });
}

function saveStoredWorldDocument(document: WorldDocument): Promise<WorldDocument> {
  return saveToIndexedDb(
    {
      ...WORLD_DOCUMENT_DATABASE_LOCATION,
      key: document.documentKey,
    },
    document,
  );
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
  const gridCellSize = editorHost.state.viewport.gridCellPixelSize;

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
