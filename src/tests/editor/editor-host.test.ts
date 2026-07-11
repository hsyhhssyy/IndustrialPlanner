import { afterEach, describe, expect, it, vi } from "vitest";
import { runInAction } from "mobx";

import type { DraftEntity } from "@/editor/draft-entity";
import { createDummyWorldDocument } from "@/tests/helpers/dummy-document";
import { createEditorHost } from "@/editor/editor-host";
import { EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY } from "@/editor/storage-hook";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import {
  DEFAULT_WORLD_BASE_ID,
  type WorldEntity,
  type WorldDocument,
} from "@/domain/document/world-document";
import {
  EntityCollectionType,
  type EntityCollectionType as EntityCollectionTypeValue,
} from "@/domain/editor/types/editor-types";
import type { GridRect, GridRotation } from "@/domain/shared/grid";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { resolveWorldEntitySpriteLayout } from "@/renderer/scene/render-scene-orchestrator";
import { EDITOR_GRID_CELL_PIXEL_SIZE } from "@/editor/viewport-constants";
import { resolveViewportPointFromWorldPoint } from "@/shared/geometry/viewport-transform";
import { WATER_PURIFIER_NODE_ENTITY_ID } from "@/shared/water-purifier-node";
import {
  readFromIndexedDb,
  saveToIndexedDb,
} from "@/shared/storage/browser-storage";
import { createFakeIndexedDbFactory } from "@/tests/shared/fake-indexed-db";

const WORLD_DOCUMENT_DATABASE_LOCATION = {
  databaseName: "v3-industrial-planner",
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

function createTestEntity(
  id: string,
  definitionId: string,
  x: number,
  y: number,
  rotation: 0 | 90 | 180 | 270 = 0,
): WorldDocument["entities"][string] {
  return {
    id,
    definitionId,
    position: { x, y },
    rotation,
    config: {},
    tags: [],
  };
}

function createDocumentWithTestEntities(
  entities: readonly WorldDocument["entities"][string][],
): WorldDocument {
  const document = createDummyWorldDocument();
  document.entities = Object.fromEntries(entities.map((entity) => [entity.id, entity]));
  document.entityOrder = entities.map((entity) => entity.id);
  return document;
}

type EditorHostForTest = ReturnType<typeof createEditorHost>;

interface CollectionRelativeLayoutEntry {
  readonly id: string;
  readonly definitionId: string;
  readonly position: WorldEntity["position"];
  readonly rotation: GridRotation;
  readonly relativeRect: GridRect;
}

interface CollectionRelativeLayout {
  readonly boundingBox: GridRect;
  readonly entries: readonly CollectionRelativeLayoutEntry[];
}

function createComplexRotationDrafts(): DraftEntity[] {
  return [
    createRotationDraft("preview-mix-pool", "item_port_mix_pool_1", 20, 20, 0),
    createRotationDraft("preview-furnace", "item_port_furnance_1", 30, 21, 180),
    createRotationDraft("preview-belt", "belt_straight_1x1", 27, 27, 270),
    createRotationDraft("preview-hydro", "item_port_hydro_planter_1", 36, 25, 90),
    createRotationDraft("preview-large-pool", "item_port_mix_pool_2", 42, 18, 270),
    createRotationDraft("preview-planter", "item_port_planter_1", 20, 30, 0),
  ];
}

function createRotationDraft(
  id: string,
  definitionId: string,
  x: number,
  y: number,
  rotation: GridRotation,
): DraftEntity {
  return {
    id,
    originalEntityId: id,
    definitionId,
    position: { x, y },
    rotation,
    config: {},
    tags: [],
  };
}

function collectRelativeLayout(
  editorHost: EditorHostForTest,
  collectionType: EntityCollectionTypeValue,
): CollectionRelativeLayout {
  const geometry = editorHost.queries.findEntityCollectionGeometry(collectionType);
  if (geometry === null) {
    throw new Error(`Expected ${collectionType} geometry to exist.`);
  }

  return {
    boundingBox: geometry.boundingBox,
    entries: editorHost.state.collections[collectionType].map((entityId) => {
      const entity = editorHost.queries.getEntityById(entityId);
      if (entity === null) {
        throw new Error(`Expected entity ${entityId} to exist.`);
      }

      const footprint = resolveRotatedFootprintForTest(
        editorHost,
        entity.definitionId,
        entity.rotation,
      );

      return {
        id: entity.id,
        definitionId: entity.definitionId,
        position: { ...entity.position },
        rotation: entity.rotation,
        relativeRect: {
          x: entity.position.x - geometry.boundingBox.x,
          y: entity.position.y - geometry.boundingBox.y,
          width: footprint.width,
          height: footprint.height,
        },
      };
    }),
  };
}

function resolveRotatedFootprintForTest(
  editorHost: EditorHostForTest,
  definitionId: string,
  rotation: GridRotation,
): { readonly width: number; readonly height: number } {
  const definition = editorHost.workspace.registry.entityDefinitions.find(
    (entityDefinition) => entityDefinition.id === definitionId,
  );
  if (definition === undefined) {
    throw new Error(`Unknown entity definition: ${definitionId}`);
  }

  return rotation === 90 || rotation === 270
    ? {
      width: definition.footprint.height,
      height: definition.footprint.width,
    }
    : {
      width: definition.footprint.width,
      height: definition.footprint.height,
    };
}

function expectLayoutMatchesRotation(
  initialLayout: CollectionRelativeLayout,
  currentLayout: CollectionRelativeLayout,
  turnCount: number,
): void {
  const angle = ((turnCount * 90) % 360) as GridRotation;
  const expectedBoundingBoxSize = angle === 90 || angle === 270
    ? {
      width: initialLayout.boundingBox.height,
      height: initialLayout.boundingBox.width,
    }
    : {
      width: initialLayout.boundingBox.width,
      height: initialLayout.boundingBox.height,
    };
  const currentById = new Map(
    currentLayout.entries.map((entry) => [entry.id, entry]),
  );

  expect(currentLayout.boundingBox).toMatchObject(expectedBoundingBoxSize);
  expect(currentLayout.entries).toHaveLength(initialLayout.entries.length);

  for (const initialEntry of initialLayout.entries) {
    const currentEntry = currentById.get(initialEntry.id);
    expect(currentEntry, `Missing rotated entry ${initialEntry.id}`).toBeDefined();
    expect(currentEntry?.definitionId).toBe(initialEntry.definitionId);
    expect(currentEntry?.relativeRect).toEqual(
      rotateRelativeRectForTest(
        initialEntry.relativeRect,
        initialLayout.boundingBox,
        angle,
      ),
    );
    expect(currentEntry?.rotation).toBe(rotateGridRotationForTest(
      initialEntry.rotation,
      angle,
    ));
  }

  expectNoOverlappingRelativeRects(currentLayout);
}

function rotateRelativeRectForTest(
  rect: GridRect,
  boundingBox: Pick<GridRect, "width" | "height">,
  angle: GridRotation,
): GridRect {
  switch (angle) {
    case 90:
      return {
        x: boundingBox.height - rect.y - rect.height,
        y: rect.x,
        width: rect.height,
        height: rect.width,
      };
    case 180:
      return {
        x: boundingBox.width - rect.x - rect.width,
        y: boundingBox.height - rect.y - rect.height,
        width: rect.width,
        height: rect.height,
      };
    case 270:
      return {
        x: rect.y,
        y: boundingBox.width - rect.x - rect.width,
        width: rect.height,
        height: rect.width,
      };
    case 0:
    default:
      return { ...rect };
  }
}

function rotateGridRotationForTest(
  rotation: GridRotation,
  angle: GridRotation,
): GridRotation {
  return ((rotation + angle) % 360) as GridRotation;
}

function expectNoOverlappingRelativeRects(layout: CollectionRelativeLayout): void {
  for (let leftIndex = 0; leftIndex < layout.entries.length; leftIndex += 1) {
    const leftEntry = layout.entries[leftIndex];
    if (leftEntry === undefined) {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < layout.entries.length; rightIndex += 1) {
      const rightEntry = layout.entries[rightIndex];
      if (rightEntry === undefined) {
        continue;
      }

      expect(
        areGridRectsOverlapping(leftEntry.relativeRect, rightEntry.relativeRect),
        `${leftEntry.id} should not overlap ${rightEntry.id}`,
      ).toBe(false);
    }
  }
}

function areGridRectsOverlapping(left: GridRect, right: GridRect): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function toAbsoluteRotationState(layout: CollectionRelativeLayout): readonly unknown[] {
  return layout.entries.map((entry) => ({
    id: entry.id,
    definitionId: entry.definitionId,
    position: entry.position,
    rotation: entry.rotation,
  }));
}

function createStorageToFactorySlotLink(): WorldDocument["slotLinks"][number] {
  return {
    id: "storage-to-factory",
    linkType: "share-cap",
    source: {
      entityId: "storage",
      storageSlotGroupId: "storage_slot_1",
      slotId: "slot_1",
    },
    target: {
      entityId: "factory",
      storageSlotGroupId: "item_input_buffer",
      slotId: "input_slot_1",
    },
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

  it("creates and removes one-to-one dark pipe slot links", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithTestEntities([
      {
        ...createTestEntity("inlet", "item_port_udpipe_loader_2", 0, 0),
        config: {
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
          "storageSlotGroups[0].slots[0].initialCount": 8,
        },
      },
      {
        ...createTestEntity("outlet", "item_port_udpipe_unloader_1", 8, 0),
        config: {
          "links[0].id": "",
          "links[0].linkType": "share-all",
          "links[0].source.entityId": "outlet",
          "links[0].source.storageSlotGroupId": "unloader_buffer",
          "links[0].source.slotId": "slot_1",
          "links[0].target.entityId": "warehouse",
          "links[0].target.storageSlotGroupId": "warehouse",
          "links[0].target.slotId": "item_liquid_water",
          "storageSlotGroups[0].slots[0].ignoreStock": true,
        },
      },
    ]);
    editorHost.internalDocument.setSnapshot(document);

    expect(editorHost.actions.createDarkPipeLink({
      sourceEntityId: "inlet",
      targetEntityId: "outlet",
    })).toBe(true);

    const linked = editorHost.document.getSnapshot();
    expect(linked.slotLinks).toEqual([{
      id: "dark-pipe-link:outlet:inlet",
      linkType: "share-all",
      source: {
        entityId: "outlet",
        storageSlotGroupId: "unloader_buffer",
        slotId: "slot_1",
      },
      target: {
        entityId: "inlet",
        storageSlotGroupId: "loader_buffer",
        slotId: "slot_1",
      },
    }]);
    expect(linked.entities.outlet?.config).toEqual({});
    expect(linked.entities.inlet?.config).toEqual({
      "recipeChannels[0].manualRecipeOnly": true,
      "recipeChannels[1].manualRecipeOnly": true,
    });
    expect(editorHost.actions.createDarkPipeLink({
      sourceEntityId: "inlet",
      targetEntityId: "outlet",
    })).toBe(false);

    expect(editorHost.actions.removeDarkPipeLink("outlet")).toBe(true);
    const unlinked = editorHost.document.getSnapshot();
    expect(unlinked.slotLinks).toEqual([]);
    expect(unlinked.entities.inlet?.config).toEqual({});
    expect(unlinked.entities.outlet?.config).toEqual({});
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
      x: -12,
      y: -12,
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
      x: 88,
      y: 88,
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
      displayRotation: 0,
    });
    expect(editorHost.state.history.records).toHaveLength(0);
    expect(editorHost.state.history.undoDepth).toBe(0);
  });

  it("sets and persists viewport display rotation without recording history", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    await flushMicrotasks();

    const documentKey = editorHost.document.getSnapshot().documentKey;
    const initialViewportCenter = {
      ...editorHost.state.viewport.center,
    };

    editorHost.actions.setViewportDisplayRotation(90);

    expect(editorHost.internalState.viewport.displayRotation).toBe(90);
    expect(editorHost.state.viewport.displayRotation).toBe(90);
    expect(editorHost.state.viewport.center).toEqual(initialViewportCenter);
    expect(workspace.editor?.state.viewport.displayRotation).toBe(90);

    editorHost.actions.setViewportDisplayRotation(123 as never);

    expect(editorHost.state.viewport.displayRotation).toBe(90);

    editorHost.actions.setViewportDisplayRotation(270);

    await flushMicrotasks();

    const storedDocument = await readStoredWorldDocument(documentKey);

    expect(storedDocument?.documentSettings.viewport).toEqual({
      center: {
        x: 0,
        y: 0,
      },
      gridSize: 1,
      displayRotation: 270,
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

  it("syncs powered collection after placement and movement actions", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.createSinglePlacementDraft(
      "item_port_power_diffuser_1",
      { x: 0, y: 0 },
    );
    expect(editorHost.actions.applyPlacementDraft()).toBe(true);

    editorHost.actions.createSinglePlacementDraft(
      "item_port_grinder_1",
      { x: 6, y: 6 },
    );
    expect(editorHost.actions.applyPlacementDraft()).toBe(true);

    editorHost.actions.createSinglePlacementDraft(
      "item_port_storager_1",
      { x: 30, y: 30 },
    );
    expect(editorHost.actions.applyPlacementDraft()).toBe(true);

    expect(editorHost.state.collections.powered).toEqual([
      "item_port_power_diffuser_1:1",
      "item_port_grinder_1:1",
    ]);

    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "item_port_grinder_1:1",
    });
    editorHost.actions.moveCollectionTo({
      collectionType: EntityCollectionType.selection,
      startGridPoint: { x: 0, y: 0 },
      endGridPoint: { x: 30, y: 30 },
    });

    expect(editorHost.state.collections.powered).toEqual([
      "item_port_power_diffuser_1:1",
    ]);
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

  it("snaps water purifier node placement previews to the outer ring edge", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.createSinglePlacementDraft(WATER_PURIFIER_NODE_ENTITY_ID, {
      x: 37,
      y: -5,
    });

    const draftId = editorHost.state.collections.preview[0];
    expect(draftId).toBeDefined();
    expect(editorHost.queries.getEntityById(draftId ?? "")).toMatchObject({
      definitionId: WATER_PURIFIER_NODE_ENTITY_ID,
      position: {
        x: 24,
        y: -10,
      },
      rotation: 0,
    });

    editorHost.actions.moveCollectionTo({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 37, y: -5 },
      endGridPoint: { x: 44, y: -4 },
    });

    expect(editorHost.queries.getEntityById(draftId ?? "")).toMatchObject({
      position: {
        x: 31,
        y: -10,
      },
      rotation: 0,
    });
  });

  it("marks water purifier node drafts too far from the outer edge invalid", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.createSinglePlacementDraft(WATER_PURIFIER_NODE_ENTITY_ID, {
      x: 37,
      y: 20,
    });

    const draftId = editorHost.state.collections.preview[0];
    expect(draftId).toBeDefined();
    expect(
      editorHost.state.collections[EntityCollectionType.invalidPlacement].contains(draftId ?? ""),
    ).toBe(true);
    expect(editorHost.queries.getEntityPlacementValidation(draftId ?? "").reasons).toEqual([
      {
        code: "outside-base",
        message: "必须靠近地图边缘放置",
      },
    ]);
    expect(editorHost.actions.applyPlacementDraft()).toBe(false);
    expect(editorHost.document.getSnapshot().entityOrder).toEqual([]);
  });

  it("keeps water purifier node rotation fixed away from corners", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.createSinglePlacementDraft(WATER_PURIFIER_NODE_ENTITY_ID, {
      x: 37,
      y: -5,
    });
    const draftId = editorHost.state.collections.preview[0];

    editorHost.actions.rotateCollection(EntityCollectionType.preview);

    expect(editorHost.queries.getEntityById(draftId ?? "")).toMatchObject({
      position: {
        x: 24,
        y: -10,
      },
      rotation: 0,
    });
  });

  it("switches water purifier node snap edge when rotating near a corner", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.createSinglePlacementDraft(WATER_PURIFIER_NODE_ENTITY_ID, {
      x: 1,
      y: -5,
    });
    const draftId = editorHost.state.collections.preview[0];

    expect(editorHost.queries.getEntityById(draftId ?? "")).toMatchObject({
      position: {
        x: -10,
        y: -10,
      },
      rotation: 0,
    });

    editorHost.actions.rotateCollection(EntityCollectionType.preview);

    expect(editorHost.queries.getEntityById(draftId ?? "")).toMatchObject({
      position: {
        x: -10,
        y: -10,
      },
      rotation: 270,
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

    // 最终 ID 由 commit 时基于文档状态重新分配，不再从 draft ID 剥前缀推导。
    const finalDoc = editorHost.document.getSnapshot();
    const finalEntityOrder = finalDoc.entityOrder.slice(-2);

    expect(finalEntityOrder).toHaveLength(2);
    const [sourceFinalId, targetFinalId] = finalEntityOrder;

    expect(finalDoc.entityOrder.slice(-2)).toEqual([
      sourceFinalId,
      targetFinalId,
    ]);
    expect(editorHost.document.getSnapshot().slotLinks).toEqual([{
      id: expect.any(String),
      linkType: "share-all",
      source: {
        entityId: sourceFinalId,
        storageSlotGroupId: "output",
        slotId: "output-slot",
      },
      target: {
        entityId: targetFinalId,
        storageSlotGroupId: "input",
        slotId: "input-slot",
      },
    }]);
    expect(editorHost.internalState.internalTransientState.placementDraftSlotLinks).toBeNull();
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

  it("switches a document entity definition, clears config, and removes stale slot links", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithTestEntities([
      {
        ...createTestEntity("factory", "item_port_filling_pd_mc_1", 10, 10),
        config: { recipe: "old" },
      },
      createTestEntity("storage", "item_port_storager_1", 4, 10),
    ]);
    document.slotLinks = [createStorageToFactorySlotLink()];

    editorHost.internalDocument.setSnapshot(document);

    expect(
      editorHost.actions.replaceEntityDefinition(
        "factory",
        "item_port_liquid_filling_pd_mc_1",
      ),
    ).toBe(true);

    const snapshot = editorHost.document.getSnapshot();
    expect(snapshot.entities.factory).toMatchObject({
      definitionId: "item_port_liquid_filling_pd_mc_1",
      config: {},
    });
    expect(snapshot.entities.storage).toEqual(document.entities.storage);
    expect(snapshot.slotLinks).toEqual([]);
  });

  it("applies a switched move draft, while cancel restores the original entity", () => {
    const applyWorkspace = createWorkspace();
    const applyEditorHost = createEditorHost(applyWorkspace);
    const applyDocument = createDocumentWithTestEntities([
      {
        ...createTestEntity("factory", "item_port_filling_pd_mc_1", 10, 10),
        config: { recipe: "old" },
      },
      createTestEntity("storage", "item_port_storager_1", 4, 10),
    ]);
    applyDocument.slotLinks = [createStorageToFactorySlotLink()];
    applyEditorHost.internalDocument.setSnapshot(applyDocument);
    applyEditorHost.internalState.collections.selection.replace(["factory"]);
    applyEditorHost.actions.createMoveOperationDraft();

    const applyDraftId = applyEditorHost.state.collections.preview[0];
    expect(applyDraftId).toBeDefined();
    expect(
      applyEditorHost.actions.replaceEntityDefinition(
        applyDraftId ?? "",
        "item_port_liquid_filling_pd_mc_1",
      ),
    ).toBe(true);
    expect(applyEditorHost.actions.applyMoveOerationDraft()).toBe(true);
    expect(applyEditorHost.document.getSnapshot().entities.factory).toMatchObject({
      definitionId: "item_port_liquid_filling_pd_mc_1",
      config: {},
    });
    expect(applyEditorHost.document.getSnapshot().slotLinks).toEqual([]);

    const cancelWorkspace = createWorkspace();
    const cancelEditorHost = createEditorHost(cancelWorkspace);
    const cancelDocument = createDocumentWithTestEntities([
      {
        ...createTestEntity("factory", "item_port_filling_pd_mc_1", 10, 10),
        config: { recipe: "old" },
      },
    ]);
    cancelEditorHost.internalDocument.setSnapshot(cancelDocument);
    cancelEditorHost.internalState.collections.selection.replace(["factory"]);
    cancelEditorHost.actions.createMoveOperationDraft();

    const cancelDraftId = cancelEditorHost.state.collections.preview[0];
    expect(
      cancelEditorHost.actions.replaceEntityDefinition(
        cancelDraftId ?? "",
        "item_port_liquid_filling_pd_mc_1",
      ),
    ).toBe(true);
    cancelEditorHost.actions.cancelMoveOperationDraft();
    expect(cancelEditorHost.document.getSnapshot().entities.factory).toEqual(
      cancelDocument.entities.factory,
    );
  });

  it("blocks applying move operation drafts outside the base outer ring", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDummyWorldDocument();

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);

    editorHost.actions.createMoveOperationDraft();

    const previewDraftId = editorHost.state.collections.preview[0];
    const previewDraft = editorHost.internalState.drafts.find((entity) => entity.id === previewDraftId);

    if (!previewDraft || previewDraftId === undefined) {
      throw new Error("Expected move operation preview draft to exist.");
    }

    runInAction(() => {
      previewDraft.position = { x: -11, y: 4 };
    });

    expect(editorHost.actions.applyMoveOerationDraft()).toBe(false);
    expect(editorHost.document.getSnapshot().entities["dummy-entity-2"]).toEqual(
      document.entities["dummy-entity-2"],
    );
    expect(editorHost.state.collections.selection).toEqual(["dummy-entity-2"]);
    expect(editorHost.state.collections.ghost).toEqual(["dummy-entity-2"]);
    expect(editorHost.state.collections.preview).toEqual([previewDraftId]);
    expect(editorHost.internalState.drafts.find((entity) => entity.id === previewDraftId)).toBeDefined();
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

  it("blocks direct collection moves outside the base outer ring", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithTestEntities([
      createTestEntity("pipe", "pipe_straight_1x1", -4, 5),
    ]);

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.collections.selection.replace(["pipe"]);

    editorHost.actions.moveCollectionTo({
      collectionType: EntityCollectionType.selection,
      startGridPoint: { x: 0, y: 0 },
      endGridPoint: { x: -7, y: 0 },
    });

    expect(editorHost.document.getSnapshot().entities.pipe).toEqual(document.entities.pipe);
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

  it("computes collection geometry center and pivot from document order", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithTestEntities([
      createTestEntity("ordered-first", "belt_straight_1x1", 0, 0, 90),
      createTestEntity("ordered-second", "belt_straight_1x1", 2, 0, 270),
    ]);

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.collections.selection.replace([
      "ordered-second",
      "ordered-first",
    ]);

    expect(editorHost.queries.findEntityCollectionGeometry(EntityCollectionType.selection)).toEqual({
      boundingBox: {
        x: 0,
        y: 0,
        width: 3,
        height: 1,
      },
      centerPoint: {
        x: 1.5,
        y: 0.5,
      },
      pivotCell: {
        x: 1,
        y: 0,
      },
    });
  });

  it("falls back to collection order for pivot phase when any entity is outside document order", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithTestEntities([
      createTestEntity("ordered-first", "belt_straight_1x1", 0, 0, 90),
      createTestEntity("fallback-first", "belt_straight_1x1", 2, 0, 270),
    ]);

    document.entityOrder = ["ordered-first"];
    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.collections.selection.replace([
      "fallback-first",
      "ordered-first",
    ]);

    expect(editorHost.queries.findEntityCollectionGeometry(EntityCollectionType.selection)?.pivotCell).toEqual({
      x: 1,
      y: 0,
    });
  });

  it("moves a collection center point to a client pixel and breaks ties left/up", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const firstDraft: DraftEntity = {
      id: "preview-left",
      originalEntityId: "preview-left",
      definitionId: "belt_straight_1x1",
      position: { x: 0, y: 0 },
      rotation: 0,
      config: {},
      tags: [],
    };
    const secondDraft: DraftEntity = {
      id: "preview-right",
      originalEntityId: "preview-right",
      definitionId: "belt_straight_1x1",
      position: { x: 1, y: 0 },
      rotation: 0,
      config: {},
      tags: [],
    };

    editorHost.actions.setViewportClientRect({
      left: 0,
      top: 0,
      width: 400,
      height: 400,
    });
    editorHost.internalState.drafts = [firstDraft, secondDraft];
    editorHost.internalState.collections.preview.replace([
      firstDraft.id,
      secondDraft.id,
    ]);

    editorHost.actions.moveCollectionCenterPointTo(
      EntityCollectionType.preview,
      resolveViewportPointFromWorldPoint({
        viewportBounds: editorHost.state.viewport.clientRect,
        viewportCenter: editorHost.state.viewport.center,
        gridCellPixelSize: editorHost.state.viewport.gridCellPixelSize,
        displayRotation: editorHost.state.viewport.displayRotation,
        worldPoint: {
          x: 10.5,
          y: 20.5,
        },
      }),
    );

    expect(editorHost.internalState.drafts.map((draft) => draft.position)).toEqual([
      { x: 9, y: 20 },
      { x: 10, y: 20 },
    ]);
  });

  it("rotates entity collections around the collection center point through editor actions", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithTestEntities([
      createTestEntity("left", "belt_straight_1x1", 10, 10),
      createTestEntity("right", "belt_straight_1x1", 11, 10),
    ]);

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.collections.selection.replace(["left", "right"]);

    editorHost.actions.rotateCollectionAroundCenterPoint(EntityCollectionType.selection, 90);

    expect(editorHost.document.getSnapshot().entities.left).toMatchObject({
      position: { x: 11, y: 10 },
      rotation: 90,
    });
    expect(editorHost.document.getSnapshot().entities.right).toMatchObject({
      position: { x: 11, y: 11 },
      rotation: 90,
    });
    expect(editorHost.queries.findEntityCollectionGridRect("selection")).toEqual({
      x: 11,
      y: 10,
      width: 1,
      height: 2,
    });
  });

  it("keeps a complex mouse-centered collection layout exact through four fixed-pointer rotations", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const drafts = createComplexRotationDrafts();
    const fixedMousePoint = resolveViewportPointFromWorldPoint({
      viewportBounds: editorHost.state.viewport.clientRect,
      viewportCenter: editorHost.state.viewport.center,
      gridCellPixelSize: editorHost.state.viewport.gridCellPixelSize,
      displayRotation: editorHost.state.viewport.displayRotation,
      worldPoint: {
        x: 34.25,
        y: 27.75,
      },
    });

    editorHost.internalState.drafts = drafts;
    editorHost.internalState.collections.preview.replace(drafts.map((draft) => draft.id));
    editorHost.actions.moveCollectionCenterPointTo(
      EntityCollectionType.preview,
      fixedMousePoint,
    );

    const initialLayout = collectRelativeLayout(editorHost, EntityCollectionType.preview);
    const initialAbsoluteState = toAbsoluteRotationState(initialLayout);

    expect(initialLayout.entries).toHaveLength(6);
    expect(initialLayout.boundingBox.width).toBeGreaterThan(20);
    expect(initialLayout.boundingBox.height).toBeGreaterThan(10);

    for (let turnCount = 1; turnCount <= 4; turnCount += 1) {
      editorHost.actions.rotateCollectionAroundCenterPoint(EntityCollectionType.preview, 90);
      editorHost.actions.moveCollectionCenterPointTo(
        EntityCollectionType.preview,
        fixedMousePoint,
      );
      const currentLayout = collectRelativeLayout(editorHost, EntityCollectionType.preview);

      expectLayoutMatchesRotation(initialLayout, currentLayout, turnCount);
      if (turnCount === 1) {
        expect(toAbsoluteRotationState(currentLayout)).not.toEqual(initialAbsoluteState);
      }
      if (turnCount === 4) {
        expect(toAbsoluteRotationState(currentLayout)).toEqual(initialAbsoluteState);
      }
    }
  });

  it("keeps a complex touch pivot collection layout exact through four rotations", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const drafts = createComplexRotationDrafts();

    editorHost.internalState.drafts = drafts;
    editorHost.internalState.collections.preview.replace(drafts.map((draft) => draft.id));

    const initialLayout = collectRelativeLayout(editorHost, EntityCollectionType.preview);
    const initialAbsoluteState = toAbsoluteRotationState(initialLayout);

    expect(initialLayout.entries).toHaveLength(6);
    expect(initialLayout.boundingBox.width).toBeGreaterThan(20);
    expect(initialLayout.boundingBox.height).toBeGreaterThan(10);

    for (let turnCount = 1; turnCount <= 4; turnCount += 1) {
      editorHost.actions.rotateCollectionAroundPivotCell(EntityCollectionType.preview, 90);
      const currentLayout = collectRelativeLayout(editorHost, EntityCollectionType.preview);

      expectLayoutMatchesRotation(initialLayout, currentLayout, turnCount);
      if (turnCount === 1) {
        expect(toAbsoluteRotationState(currentLayout)).not.toEqual(initialAbsoluteState);
      }
      if (turnCount === 4) {
        expect(toAbsoluteRotationState(currentLayout)).toEqual(initialAbsoluteState);
      }
    }
  });

  it("blocks direct collection rotations outside the base outer ring", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithTestEntities([
      createTestEntity("pipe-top", "pipe_straight_1x1", -15, 0),
      createTestEntity("pipe-bottom", "pipe_straight_1x1", -15, 8),
    ]);

    editorHost.internalDocument.setSnapshot(document);
    editorHost.internalState.collections.selection.replace(["pipe-top", "pipe-bottom"]);

    editorHost.actions.rotateCollectionAroundPivotCell(EntityCollectionType.selection, 90);

    expect(editorHost.document.getSnapshot().entities["pipe-top"]).toEqual(
      document.entities["pipe-top"],
    );
    expect(editorHost.document.getSnapshot().entities["pipe-bottom"]).toEqual(
      document.entities["pipe-bottom"],
    );
  });

  it("keeps 1x1 pivot-cell preview rotation in place without clamping negative grid positions", () => {
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

    editorHost.actions.rotateCollectionAroundPivotCell(EntityCollectionType.preview, 90);

    expect(editorHost.internalState.drafts[0]).toMatchObject({
      id: "preview-belt",
      position: {
        x: -2,
        y: 3,
      },
      rotation: 90,
    });
  });

  it("keeps pivot-cell collection rotation closed after four turns", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const drafts: DraftEntity[] = [
      {
        id: "preview-left",
        originalEntityId: "preview-left",
        definitionId: "belt_straight_1x1",
        position: { x: -2, y: 3 },
        rotation: 0,
        config: {},
        tags: [],
      },
      {
        id: "preview-right",
        originalEntityId: "preview-right",
        definitionId: "belt_straight_1x1",
        position: { x: -1, y: 3 },
        rotation: 0,
        config: {},
        tags: [],
      },
    ];

    editorHost.internalState.drafts = drafts;
    editorHost.internalState.collections.preview.replace(drafts.map((draft) => draft.id));

    for (let step = 0; step < 4; step += 1) {
      editorHost.actions.rotateCollectionAroundPivotCell(EntityCollectionType.preview, 90);
    }

    expect(editorHost.internalState.drafts.map((draft) => ({
      position: draft.position,
      rotation: draft.rotation,
    }))).toEqual([
      { position: { x: -2, y: 3 }, rotation: 0 },
      { position: { x: -1, y: 3 }, rotation: 0 },
    ]);
  });

  it("keeps expanded reaction pool preview rotation idempotent after four turns", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const initialDraft: DraftEntity = {
      id: "preview-large-reaction-pool",
      originalEntityId: "preview-large-reaction-pool",
      definitionId: "item_port_mix_pool_2",
      position: {
        x: 10,
        y: 10,
      },
      rotation: 0,
      config: {},
      tags: [],
    };

    editorHost.internalState.drafts = [initialDraft];
    editorHost.internalState.collections.preview.replace([initialDraft.id]);

    for (let step = 0; step < 4; step += 1) {
      editorHost.actions.rotateCollection(EntityCollectionType.preview);
    }

    expect(editorHost.internalState.drafts[0]).toMatchObject({
      id: initialDraft.id,
      definitionId: initialDraft.definitionId,
      position: initialDraft.position,
      rotation: 0,
    });
  });

  it("keeps single preview draft rotation idempotent for every registry footprint", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    for (const definition of workspace.registry.entityDefinitions) {
      const initialDraft: DraftEntity = {
        id: `preview-${definition.id}`,
        originalEntityId: `preview-${definition.id}`,
        definitionId: definition.id,
        position: {
          x: 10,
          y: 10,
        },
        rotation: 0,
        config: {},
        tags: [],
      };

      editorHost.internalState.drafts = [initialDraft];
      editorHost.internalState.collections.preview.replace([initialDraft.id]);

      for (let step = 0; step < 4; step += 1) {
        editorHost.actions.rotateCollection(EntityCollectionType.preview);
      }

      expect({
        definitionId: definition.id,
        position: editorHost.internalState.drafts[0]?.position,
        rotation: editorHost.internalState.drafts[0]?.rotation,
      }).toEqual({
        definitionId: definition.id,
        position: initialDraft.position,
        rotation: 0,
      });
    }
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
      "powered",
      "invalid-placement",
    ]);
    expect(
      editorHost.queries.findEntityCollectionGridRect("selection"),
    ).toBeNull();
    expect(editorHost.queries.findEntityCollectionGridRect("marquee")).toBeNull();
    expect(editorHost.queries.findEntityCollectionGridRect("reverse-marquee")).toBeNull();
    expect(editorHost.queries.findEntityCollectionGridRect("preview")).toBeNull();
    expect(editorHost.queries.findEntityCollectionGridRect("ghost")).toBeNull();
    expect(editorHost.queries.findEntityCollectionGridRect("logistics-head")).toBeNull();
    expect(editorHost.queries.findEntityCollectionGridRect("powered")).toBeNull();
    expect(editorHost.queries.findEntityCollectionGridRect("invalid-placement")).toBeNull();
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

  it("finds the world grid cell for a client pixel point", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });

    const gridCell = editorHost.queries.findGridCellForClientPixelPoint(
      resolveClientPixelPointForGridCell(editorHost, { x: 4, y: 4 }),
    );

    expect(gridCell).toEqual({ x: 4, y: 4 });
  });

  it("round-trips grid cell queries through display rotation", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    editorHost.actions.setViewportDisplayRotation(90);

    const rect = editorHost.queries.findClientRectForGridCell({ x: 1, y: 0 });
    const gridCell = rect === null
      ? null
      : editorHost.queries.findGridCellForClientPixelPoint({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });

    expect(rect).toEqual({
      left: 304,
      top: 296,
      width: 16,
      height: 16,
    });
    expect(gridCell).toEqual({ x: 1, y: 0 });
  });

  it("pans the viewport through the inverse display rotation", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.setViewportClientRect({
      left: 0,
      top: 0,
      width: 400,
      height: 400,
    });
    editorHost.actions.setViewportDisplayRotation(90);

    editorHost.actions.moveViewportByClientPixelVector({
      startClientPixel: {
        x: 200,
        y: 200,
      },
      endClientPixel: {
        x: 216,
        y: 200,
      },
    });

    expect(editorHost.state.viewport.center.x).toBeCloseTo(0);
    expect(editorHost.state.viewport.center.y).toBeCloseTo(1);
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
          displayRotation: 0 as const,
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
      y: -8.25,
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
          displayRotation: 0,
        },
      },
    });

    expect(editorHost.state.viewport.center).toEqual({
      x: 92,
      y: -12,
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
          displayRotation: 0 as const,
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

    expect(editorHost.document.getSnapshot()).toEqual({
      ...valleyDocument,
      entities: {
        ...valleyDocument.entities,
        "protocol-core:valley4_protocol_core": {
          id: "protocol-core:valley4_protocol_core",
          definitionId: "item_port_sp_hub_1",
          position: { x: 0, y: 0 },
          rotation: 0,
          config: {},
          tags: [],
        },
      },
      entityOrder: ["protocol-core:valley4_protocol_core", ...valleyDocument.entityOrder],
    });
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
    expect(document.entityOrder).toEqual(["protocol-core:valley4_infra_outpost"]);
    expect(document.entities["protocol-core:valley4_infra_outpost"]).toEqual({
      id: "protocol-core:valley4_infra_outpost",
      definitionId: "item_port_sp_hub_1",
      position: { x: 0, y: 0 },
      rotation: 0,
      config: {},
      tags: [],
    });
    expect(editorHost.internalState.internalPersistState.latestDocumentIdByBaseId.valley4_infra_outpost).toBe(
      document.documentKey,
    );
    await expect(readStoredWorldDocument(document.documentKey)).resolves.toEqual(document);
  });

  // ---- 2026-05-24: 物流边界检测测试 ----

  it("blocks belt placement when drawn outside placeableArea", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // 传送带从界内向界外绘制，应阻止提交。
    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: { type: "empty-cell", gridPoint: { x: 0, y: 10 } },
    });

    // 绘制到界外 (x < 0)
    const result = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: -1, y: 10 },
      routeMode: { type: "freehand" },
    });

    expect(result.canApply).toBe(false);
    expect(result.invalidReason).toBe("outside-base");
  });

  it("blocks belt placement when drawn outside outerRing", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // 传送带从界内向非常远的界外绘制
    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: { type: "empty-cell", gridPoint: { x: 10, y: 10 } },
    });

    const result = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: -10, y: 10 },
      routeMode: { type: "freehand" },
    });

    expect(result.canApply).toBe(false);
    expect(result.invalidReason).toBe("outside-base");
  });

  it("allows pipe placement outside placeableArea but blocks outside outerRing", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // 管道可以出 placeableArea 但不能出 outerRing。
    // placeableArea: 0-80, outerRing: left=5 → -5 to 85
    editorHost.actions.createLogisticsDraftStart({
      kind: "pipe",
      source: { type: "empty-cell", gridPoint: { x: 5, y: 10 } },
    });

    // 管道绘制到 placeableArea 外、outerRing 内 (x=-4 在 outerRing left=-5 内)
    const resultInsideOuterRing = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: -4, y: 10 },
      routeMode: { type: "freehand" },
    });

    expect(resultInsideOuterRing.canApply).toBe(true);
    expect(resultInsideOuterRing.invalidReason).toBeNull();

    // 管道绘制到 outerRing 外 (x=-11 < outerRing left=-10)
    editorHost.actions.cancelLogisticsDraft();

    editorHost.actions.createLogisticsDraftStart({
      kind: "pipe",
      source: { type: "empty-cell", gridPoint: { x: 5, y: 10 } },
    });

    const resultOutsideOuterRing = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: -11, y: 10 },
      routeMode: { type: "freehand" },
    });

    expect(resultOutsideOuterRing.canApply).toBe(false);
    expect(resultOutsideOuterRing.invalidReason).toBe("outside-base");
  });

  it("blocks belt multi-cell path when any cell is outside placeableArea", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // 整条传送带路径中任一点出界即整条不可提交。
    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: { type: "empty-cell", gridPoint: { x: 5, y: 10 } },
    });

    // 保持不走回头路，避免触发 overlap-own-preview。
    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 5, y: 5 },
      routeMode: { type: "freehand" },
    });

    // 出界 → 整条不可提交
    const result = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: -1, y: 5 },
      routeMode: { type: "freehand" },
    });

    expect(result.canApply).toBe(false);
    expect(result.invalidReason).toBe("outside-base");
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

  return resolveViewportPointFromWorldPoint({
    worldPoint: {
      x: cell.x + 0.5,
      y: cell.y + 0.5,
    },
    viewportBounds: editorHost.state.viewport.clientRect,
    viewportCenter: editorHost.state.viewport.center,
    gridCellPixelSize: gridCellSize,
    displayRotation: editorHost.state.viewport.displayRotation,
  });
}
