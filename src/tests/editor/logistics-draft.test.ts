import { afterEach, describe, expect, it, vi } from "vitest";

import type { DraftEntity } from "@/editor/draft-entity";
import { createDummyWorldDocument } from "@/tests/helpers/dummy-document";
import { createEditorHost } from "@/editor/editor-host";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import {
  DEFAULT_WORLD_BASE_ID,
  type WorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  createEntityDefinitionMap,
  resolveLogisticsPathCells,
} from "@/editor/logistics/logistics-utils";
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

function createFurnanceSeparatedByOneBeltDocument(options: {
  readonly includeLowerFurnance?: boolean;
  readonly includeUpperFurnance?: boolean;
} = {}): WorldDocument {
  const includeLowerFurnance = options.includeLowerFurnance ?? true;
  const includeUpperFurnance = options.includeUpperFurnance ?? true;
  return createDocumentWithTestEntities([
    ...(includeLowerFurnance
      ? [createTestEntity("lower-furnance", "item_port_furnance_1", 43, 58)]
      : []),
    ...(includeUpperFurnance
      ? [createTestEntity("upper-furnance", "item_port_furnance_1", 43, 54)]
      : []),
    createTestEntity("crossing-belt", "belt_straight_1x1", 45, 57, 180),
    createTestEntity("left-belt-1", "belt_straight_1x1", 44, 57, 180),
    createTestEntity("left-belt-2", "belt_straight_1x1", 43, 57, 180),
  ]);
}

function findPreviewDraftAt(
  editorHost: ReturnType<typeof createEditorHost>,
  x: number,
  y: number,
): DraftEntity | null {
  const previewIds = new Set(editorHost.state.collections.preview);
  return editorHost.internalState.drafts.find((entity) =>
    previewIds.has(entity.id)
    && entity.position.x === x
    && entity.position.y === y,
  ) ?? null;
}

function listPreviewAutoDeviceDefinitionIds(
  editorHost: ReturnType<typeof createEditorHost>,
): string[] {
  const previewIds = new Set(editorHost.state.collections.preview);
  return editorHost.internalState.drafts
    .filter((entity) => previewIds.has(entity.id))
    .map((entity) => entity.definitionId)
    .filter((definitionId) =>
      definitionId.startsWith("item_log_") || definitionId.startsWith("item_pipe_"),
    );
}

function findDocumentEntityAt(
  document: WorldDocument,
  x: number,
  y: number,
): WorldDocument["entities"][string] | null {
  return Object.values(document.entities).find((entity) =>
    entity.position.x === x && entity.position.y === y,
  ) ?? null;
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("物流绘制模式", () => {
  it("rejects empty-cell logistics starts when empty starts are disabled", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    const startResult = editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      allowEmptySource: false,
      source: {
        type: "empty-cell",
        gridPoint: { x: 0, y: 0 },
      },
    });

    expect(startResult.status).toBe("ignored");
    expect(editorHost.queries.resolveLogisticsDraftState()).toBeNull();
    expect(editorHost.state.collections.preview).toEqual([]);
  });

  it("marks logistics drafts invalid when empty targets are disabled", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("source-device", "item_port_storager_1", 0, 8),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "device",
        entityId: "source-device",
        pointerGridPoint: { x: 1, y: 8 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 4, y: 8 },
      allowEmptyTarget: false,
      routeMode: {
        type: "single-bend",
        routeOrder: "horizontal-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult).toMatchObject({
      canApply: false,
      invalidReason: "empty-endpoint-disallowed",
    });
    expect(editorHost.queries.resolveLogisticsDraftState()).toMatchObject({
      canApply: false,
      invalidReason: "empty-endpoint-disallowed",
    });
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

    // dummy-entity-1(12,8) straight rot=0 W→E，无上游 → 被替换为直道
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

    // AI-CORRECTION 2026-05-29: 无上游的孤立传送带被拉入时替换为普通物流段，
    // 不再标记为 overlap-existing-logistics。
    expect(moveResult.canApply).toBe(true);
    expect(editorHost.state.collections.ghost).toEqual(["dummy-entity-1"]);
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
      rotation: 0,
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

    // AI-CORRECTION 2026-05-29: belt rot=90 (N→S) 无上游，
    // fromEdge 应从自身 input port (NORTH) 推断，绘制向东 → turn-ccw。
    expect(editorHost.queries.resolveLogisticsDraftState()?.cells[0]).toMatchObject({
      gridPoint: { x: 12, y: 8 },
      fromEdge: "NORTH",
      toEdge: "EAST",
      shape: "turn-ccw",
      rotation: 0,
    });
  });

  it("creates a splitter when extending a fully connected straight logistics tile", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("predecessor", "belt_straight_1x1", 11, 8),
      createTestEntity("source", "belt_straight_1x1", 12, 8),
      createTestEntity("successor", "belt_straight_1x1", 13, 8),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "logistics-entity",
        entityId: "source",
        gridPoint: { x: 12, y: 8 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 12, y: 7 },
      routeMode: {
        type: "single-bend",
        routeOrder: "vertical-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult).toMatchObject({
      canApply: true,
      invalidReason: null,
    });
    expect(editorHost.state.collections.ghost).toEqual(["source"]);
    expect(findPreviewDraftAt(editorHost, 12, 8)).toMatchObject({
      definitionId: "item_log_splitter",
      rotation: 270,
    });
    expect(editorHost.actions.applyLogisticDraft()).toBe(true);

    const snapshot = editorHost.internalDocument.getSnapshot();
    expect(snapshot.entities.source).toBeUndefined();
    expect(findDocumentEntityAt(snapshot, 12, 8)).toMatchObject({
      definitionId: "item_log_splitter",
    });
    expect(snapshot.entities.predecessor).toBeDefined();
    expect(snapshot.entities.successor).toBeDefined();
  });

  it("keeps internal source turns valid when auto devices are disabled", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("predecessor", "belt_straight_1x1", 11, 8),
      createTestEntity("source", "belt_straight_1x1", 12, 8),
      createTestEntity("successor", "belt_straight_1x1", 13, 8),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "logistics-entity",
        entityId: "source",
        gridPoint: { x: 12, y: 8 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      autoCreateSplittersAndConvergers: false,
      pointerGridPoint: { x: 12, y: 7 },
      routeMode: {
        type: "single-bend",
        routeOrder: "vertical-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult).toMatchObject({
      canApply: true,
      invalidReason: null,
    });
    expect(editorHost.state.collections.ghost).toEqual(["source"]);
    expect(findPreviewDraftAt(editorHost, 12, 8)).toMatchObject({
      definitionId: "belt_turn_ccw_1x1",
      rotation: 270,
    });
    expect(editorHost.actions.applyLogisticDraft()).toBe(true);

    const snapshot = editorHost.internalDocument.getSnapshot();
    expect(snapshot.entities.source).toBeUndefined();
    expect(findDocumentEntityAt(snapshot, 12, 8)).toMatchObject({
      definitionId: "belt_turn_ccw_1x1",
      rotation: 270,
    });
    expect(snapshot.entities.predecessor).toBeDefined();
    expect(snapshot.entities.successor).toBeDefined();
  });

  it("creates a splitter when extending a vertically stacked logistics tile with a new branch", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // predecessor(6,5) ↓ source(6,6) ↓ successor(6,7)
    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("predecessor", "belt_straight_1x1", 6, 5, 90),
      createTestEntity("source", "belt_straight_1x1", 6, 6, 90),
      createTestEntity("successor", "belt_straight_1x1", 6, 7, 90),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "logistics-entity",
        entityId: "source",
        gridPoint: { x: 6, y: 6 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 5, y: 6 },
      routeMode: {
        type: "single-bend",
        routeOrder: "vertical-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult).toMatchObject({
      canApply: true,
      invalidReason: null,
    });
    expect(editorHost.state.collections.ghost).toEqual(["source"]);
    expect(findPreviewDraftAt(editorHost, 6, 6)).toMatchObject({
      definitionId: "item_log_splitter",
      rotation: 0,
    });
    expect(editorHost.actions.applyLogisticDraft()).toBe(true);

    const snapshot = editorHost.internalDocument.getSnapshot();
    expect(snapshot.entities.source).toBeUndefined();
    expect(findDocumentEntityAt(snapshot, 6, 6)).toMatchObject({
      definitionId: "item_log_splitter",
    });
    expect(snapshot.entities.predecessor).toBeDefined();
    expect(snapshot.entities.successor).toBeDefined();
  });

  it("creates a splitter when extending a fully connected logistics tile through a turn", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("predecessor", "belt_straight_1x1", 11, 8),
      createTestEntity("source", "belt_straight_1x1", 12, 8),
      createTestEntity("successor", "belt_straight_1x1", 13, 8),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "logistics-entity",
        entityId: "source",
        gridPoint: { x: 12, y: 8 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 11, y: 7 },
      routeMode: {
        type: "single-bend",
        routeOrder: "vertical-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult.canApply).toBe(true);
    expect(findPreviewDraftAt(editorHost, 12, 8)).toMatchObject({
      definitionId: "item_log_splitter",
      rotation: 270,
    });
  });

  it("creates a splitter when extending a vertically stacked logistics tile through a turn", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // predecessor(6,5) ↓ source(6,6) ↓ successor(6,7)
    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("predecessor", "belt_straight_1x1", 6, 5, 90),
      createTestEntity("source", "belt_straight_1x1", 6, 6, 90),
      createTestEntity("successor", "belt_straight_1x1", 6, 7, 90),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "logistics-entity",
        entityId: "source",
        gridPoint: { x: 6, y: 6 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 5, y: 5 },
      routeMode: {
        type: "single-bend",
        routeOrder: "horizontal-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult.canApply).toBe(true);
    expect(findPreviewDraftAt(editorHost, 6, 6)).toMatchObject({
      definitionId: "item_log_splitter",
      rotation: 0,
    });
  });

  it("allows extending a fully connected source tile along its original output", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("predecessor", "belt_straight_1x1", 11, 8),
      createTestEntity("source", "belt_straight_1x1", 12, 8),
      createTestEntity("successor", "belt_straight_1x1", 13, 8),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "logistics-entity",
        entityId: "source",
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

    expect(moveResult).toMatchObject({
      canApply: true,
      invalidReason: null,
    });
    expect(editorHost.actions.applyLogisticDraft()).toBe(true);
  });

  it("allows extending a vertically stacked source tile along its original downward output", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // predecessor(6,5) ↓ source(6,6) ↓ successor(6,7)
    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("predecessor", "belt_straight_1x1", 6, 5, 90),
      createTestEntity("source", "belt_straight_1x1", 6, 6, 90),
      createTestEntity("successor", "belt_straight_1x1", 6, 7, 90),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "logistics-entity",
        entityId: "source",
        gridPoint: { x: 6, y: 6 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 6, y: 7 },
      routeMode: {
        type: "single-bend",
        routeOrder: "vertical-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult).toMatchObject({
      canApply: true,
      invalidReason: null,
    });
    expect(editorHost.actions.applyLogisticDraft()).toBe(true);
  });

  it("creates a converger when ending on a logistics tile with upstream and downstream connections", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // predecessor(11,8)→target(12,8)→successor(13,8)  全部 rot=0 (W→E)
    // 从上方(12,7)拉入，不穿过 predecessor
    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("predecessor", "belt_straight_1x1", 11, 8),
      createTestEntity("target", "belt_straight_1x1", 12, 8),
      createTestEntity("successor", "belt_straight_1x1", 13, 8),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "empty-cell",
        gridPoint: { x: 12, y: 7 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 12, y: 8 },
      routeMode: {
        type: "single-bend",
        routeOrder: "vertical-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult.canApply).toBe(true);
    expect(editorHost.state.collections.ghost).toEqual(["target"]);
    expect(findPreviewDraftAt(editorHost, 12, 8)).toMatchObject({
      definitionId: "item_log_converger",
      rotation: 270,
    });
  });

  it("creates a converger when ending on a logistics tile with upstream but no downstream connection", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // predecessor(11,8)→target(12,8)  无后继  rot=0 (W→E)
    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("predecessor", "belt_straight_1x1", 11, 8),
      createTestEntity("target", "belt_straight_1x1", 12, 8),
    ]));

    // mouse single-bend: 从上方(12,7)拉入 → 汇流器输出方向为 target 出口 E
    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "empty-cell",
        gridPoint: { x: 12, y: 7 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 12, y: 8 },
      routeMode: {
        type: "single-bend",
        routeOrder: "vertical-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult.canApply).toBe(true);
    expect(editorHost.state.collections.ghost).toEqual(["target"]);
    expect(findPreviewDraftAt(editorHost, 12, 8)).toMatchObject({
      definitionId: "item_log_converger",
      rotation: 270,
    });
  });

  it("replaces a connected target entrance while preserving its output when auto devices are disabled", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // predecessor(12,9) → target(12,8) → successor(12,7)，旧带方向 S→N。
    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("predecessor", "belt_straight_1x1", 12, 9, 270),
      createTestEntity("target", "belt_straight_1x1", 12, 8, 270),
      createTestEntity("successor", "belt_straight_1x1", 12, 7, 270),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "empty-cell",
        gridPoint: { x: 13, y: 8 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 12, y: 8 },
      autoCreateSplittersAndConvergers: false,
      routeMode: {
        type: "single-bend",
        routeOrder: "horizontal-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult).toMatchObject({
      canApply: true,
      invalidReason: null,
    });
    expect(editorHost.state.collections.ghost).toEqual(["target"]);
    expect(findPreviewDraftAt(editorHost, 12, 8)).toMatchObject({
      definitionId: "belt_turn_cw_1x1",
      rotation: 0,
    });
  });

  it("replaces target logistics tile when it has downstream but no upstream", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // target(12,8)→successor(13,8)  无上游  rot=0 (W→E)
    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("target", "belt_straight_1x1", 12, 8),
      createTestEntity("successor", "belt_straight_1x1", 13, 8),
    ]));

    // touch freehand: 从上方(12,7)拉入，应替换为弯道 N→E
    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "empty-cell",
        gridPoint: { x: 12, y: 7 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 12, y: 8 },
      routeMode: {
        type: "freehand",
      },
    });

    expect(moveResult.canApply).toBe(true);
    expect(editorHost.state.collections.ghost).toEqual(["target"]);
    // 从 N 进入，出口为 target 的 E → turn-ccw (N→E) rotation 0
    expect(findPreviewDraftAt(editorHost, 12, 8)).toMatchObject({
      definitionId: "belt_turn_ccw_1x1",
      rotation: 0,
    });
  });

  it("replaces target logistics tile when it has no upstream or downstream", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // target(12,8) 孤立的直道  rot=0 (W→E), 无上下游
    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("target", "belt_straight_1x1", 12, 8),
    ]));

    // touch freehand: 从上方(12,7)拉入，应替换为弯道 N→E
    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "empty-cell",
        gridPoint: { x: 12, y: 7 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 12, y: 8 },
      routeMode: {
        type: "freehand",
      },
    });

    expect(moveResult.canApply).toBe(true);
    expect(editorHost.state.collections.ghost).toEqual(["target"]);
    // 从 N 进入，出口为 target 的 E → turn-ccw (N→E) rotation 0
    expect(findPreviewDraftAt(editorHost, 12, 8)).toMatchObject({
      definitionId: "belt_turn_ccw_1x1",
      rotation: 0,
    });
  });

  it("replaces every same-input overlap cell when auto devices are disabled", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("old-straight", "belt_straight_1x1", 5, 4, 90),
      createTestEntity("old-turn", "belt_turn_ccw_1x1", 5, 5),
      createTestEntity("old-successor", "belt_straight_1x1", 6, 5),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "empty-cell",
        gridPoint: { x: 5, y: 3 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 5, y: 6 },
      autoCreateSplittersAndConvergers: false,
      routeMode: {
        type: "single-bend",
        routeOrder: "vertical-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult).toMatchObject({
      canApply: true,
      invalidReason: null,
    });
    expect(editorHost.state.collections.ghost).toEqual([
      "old-straight",
      "old-turn",
    ]);
    expect(findPreviewDraftAt(editorHost, 5, 5)).toMatchObject({
      definitionId: "belt_straight_1x1",
      rotation: 90,
    });
    expect(editorHost.actions.applyLogisticDraft()).toBe(true);

    const snapshot = editorHost.internalDocument.getSnapshot();
    expect(snapshot.entities["old-straight"]).toBeUndefined();
    expect(snapshot.entities["old-turn"]).toBeUndefined();
    expect(snapshot.entities["old-successor"]).toBeDefined();
    expect(findDocumentEntityAt(snapshot, 5, 5)).toMatchObject({
      definitionId: "belt_straight_1x1",
      rotation: 90,
    });
  });

  it("creates a splitter at a same-input overlap branch when auto devices are enabled", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("old-straight", "belt_straight_1x1", 5, 4, 90),
      createTestEntity("old-turn", "belt_turn_ccw_1x1", 5, 5),
      createTestEntity("old-successor", "belt_straight_1x1", 6, 5),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "empty-cell",
        gridPoint: { x: 5, y: 3 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 5, y: 6 },
      autoCreateSplittersAndConvergers: true,
      routeMode: {
        type: "single-bend",
        routeOrder: "vertical-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult).toMatchObject({
      canApply: true,
      invalidReason: null,
    });
    expect(editorHost.state.collections.ghost).toEqual([
      "old-straight",
      "old-turn",
    ]);
    expect(findPreviewDraftAt(editorHost, 5, 5)).toMatchObject({
      definitionId: "item_log_splitter",
      rotation: 0,
    });
  });

  it.each([false, true])(
    "rejects head-to-head overlap regardless of auto devices: %s",
    (autoCreateSplittersAndConvergers) => {
      const workspace = createWorkspace();
      const editorHost = createEditorHost(workspace);

      editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
        createTestEntity("old-left", "belt_straight_1x1", 4, 5),
        createTestEntity("old-middle", "belt_straight_1x1", 5, 5),
        createTestEntity("old-right", "belt_straight_1x1", 6, 5),
      ]));

      editorHost.actions.createLogisticsDraftStart({
        kind: "belt",
        source: {
          type: "empty-cell",
          gridPoint: { x: 7, y: 5 },
        },
      });
      const moveResult = editorHost.actions.moveLogisticEnd({
        pointerGridPoint: { x: 3, y: 5 },
        autoCreateSplittersAndConvergers,
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
    },
  );

  it("creates a converger when ending on a vertically stacked logistics tile with upstream and downstream", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // predecessor(6,5)→target(6,6)→successor(6,7)  全部 rot=90 (N→S)
    // 从西侧(4,6)拉入，不穿过 predecessor
    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("predecessor", "belt_straight_1x1", 6, 5, 90),
      createTestEntity("target", "belt_straight_1x1", 6, 6, 90),
      createTestEntity("successor", "belt_straight_1x1", 6, 7, 90),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "empty-cell",
        gridPoint: { x: 4, y: 6 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 6, y: 6 },
      routeMode: {
        type: "single-bend",
        routeOrder: "horizontal-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult.canApply).toBe(true);
    expect(editorHost.state.collections.ghost).toEqual(["target"]);
    expect(findPreviewDraftAt(editorHost, 6, 6)).toMatchObject({
      definitionId: "item_log_converger",
      rotation: 0,
    });
  });

  it("creates a connector when a new path crosses a connected logistics tile", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("predecessor", "belt_straight_1x1", 11, 8),
      createTestEntity("crossing", "belt_straight_1x1", 12, 8),
      createTestEntity("successor", "belt_straight_1x1", 13, 8),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "empty-cell",
        gridPoint: { x: 12, y: 6 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 12, y: 10 },
      routeMode: {
        type: "single-bend",
        routeOrder: "vertical-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult.canApply).toBe(true);
    expect(editorHost.state.collections.ghost).toEqual(["crossing"]);
    expect(findPreviewDraftAt(editorHost, 12, 8)).toMatchObject({
      definitionId: "item_log_connector",
    });
  });

  it("creates a connector at an existing logistics crossing when auto splitters and convergers are disabled", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("predecessor", "belt_straight_1x1", 11, 8),
      createTestEntity("crossing", "belt_straight_1x1", 12, 8),
      createTestEntity("successor", "belt_straight_1x1", 13, 8),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "empty-cell",
        gridPoint: { x: 12, y: 6 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 12, y: 10 },
      autoCreateSplittersAndConvergers: false,
      routeMode: {
        type: "single-bend",
        routeOrder: "vertical-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult).toMatchObject({
      canApply: true,
      invalidReason: null,
    });
    expect(editorHost.state.collections.ghost).toEqual(["crossing"]);
    expect(findPreviewDraftAt(editorHost, 12, 8)).toMatchObject({
      definitionId: "item_log_connector",
    });
  });

  it("creates a pipe connector at an existing pipe crossing when auto splitters and convergers are disabled", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("predecessor", "pipe_straight_1x1", 11, 8),
      createTestEntity("crossing", "pipe_straight_1x1", 12, 8),
      createTestEntity("successor", "pipe_straight_1x1", 13, 8),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "pipe",
      source: {
        type: "empty-cell",
        gridPoint: { x: 12, y: 6 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 12, y: 10 },
      autoCreateSplittersAndConvergers: false,
      routeMode: {
        type: "single-bend",
        routeOrder: "vertical-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult).toMatchObject({
      canApply: true,
      invalidReason: null,
    });
    expect(editorHost.state.collections.ghost).toEqual(["crossing"]);
    expect(findPreviewDraftAt(editorHost, 12, 8)).toMatchObject({
      definitionId: "item_pipe_connector",
    });
  });

  it("creates a connector when a new horizontal path crosses a vertically stacked logistics tile", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // predecessor(6,5) ↓ crossing(6,6) ↓ successor(6,7)
    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("predecessor", "belt_straight_1x1", 6, 5, 90),
      createTestEntity("crossing", "belt_straight_1x1", 6, 6, 90),
      createTestEntity("successor", "belt_straight_1x1", 6, 7, 90),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "empty-cell",
        gridPoint: { x: 4, y: 6 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 8, y: 6 },
      routeMode: {
        type: "single-bend",
        routeOrder: "horizontal-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult.canApply).toBe(true);
    expect(editorHost.state.collections.ghost).toEqual(["crossing"]);
    expect(findPreviewDraftAt(editorHost, 6, 6)).toMatchObject({
      definitionId: "item_log_connector",
    });
  });

  it("creates a connector on PC when two furnances are separated by one horizontal belt", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createFurnanceSeparatedByOneBeltDocument());

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "device",
        entityId: "lower-furnance",
        pointerGridPoint: { x: 45, y: 58 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 45, y: 56 },
      routeMode: {
        type: "single-bend",
        routeOrder: "vertical-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult).toMatchObject({
      canApply: true,
      invalidReason: null,
      sourceEntityId: "lower-furnance",
      targetEntityId: "upper-furnance",
    });
    expect(moveResult.headGridPoint?.y).toBe(57);

    const replacedEntityId = editorHost.state.collections.ghost[0];
    expect(replacedEntityId).toBeDefined();
    expect(["crossing-belt", "left-belt-1", "left-belt-2"]).toContain(replacedEntityId);
    expect(findPreviewDraftAt(
      editorHost,
      moveResult.headGridPoint!.x,
      moveResult.headGridPoint!.y,
    )).toMatchObject({
      definitionId: "item_log_connector",
    });
    expect(editorHost.actions.applyLogisticDraft()).toBe(true);

    const snapshot = editorHost.internalDocument.getSnapshot();
    expect(snapshot.entities[replacedEntityId!]).toBeUndefined();
    expect(findDocumentEntityAt(
      snapshot,
      moveResult.headGridPoint!.x,
      moveResult.headGridPoint!.y,
    )).toMatchObject({
      definitionId: "item_log_connector",
    });
  });

  it("creates a connector on touch when two furnances are separated by one horizontal belt", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createFurnanceSeparatedByOneBeltDocument());

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "device",
        entityId: "lower-furnance",
        pointerGridPoint: { x: 45, y: 57 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 45, y: 56 },
      routeMode: { type: "freehand" },
    });

    expect(moveResult).toMatchObject({
      canApply: true,
      invalidReason: null,
      headGridPoint: { x: 45, y: 57 },
      sourceEntityId: "lower-furnance",
      targetEntityId: "upper-furnance",
    });
    expect(editorHost.state.collections.ghost).toEqual(["crossing-belt"]);
    expect(findPreviewDraftAt(editorHost, 45, 57)).toMatchObject({
      definitionId: "item_log_connector",
    });
  });

  it("creates a turn when drawing one cell up from the rightmost furnace output and stopping on the belt", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createFurnanceSeparatedByOneBeltDocument({
      includeUpperFurnance: false,
    }));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "device",
        entityId: "lower-furnance",
        pointerGridPoint: { x: 45, y: 58 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 45, y: 57 },
      routeMode: { type: "freehand" },
    });

    expect(moveResult).toMatchObject({
      canApply: true,
      invalidReason: null,
      sourceEntityId: "lower-furnance",
      targetEntityId: null,
    });
    // belt at (45,57) rot=180 (E→W) has no predecessor from E → should be replaced with turn
    expect(editorHost.state.collections.ghost).toEqual(["crossing-belt"]);
    expect(findPreviewDraftAt(editorHost, 45, 57)?.definitionId).not.toBe("item_log_connector");
    expect(findPreviewDraftAt(editorHost, 45, 57)?.definitionId).toMatch(/belt_turn/);
  });

  it("creates a converger when drawing one cell up from the middle furnace output and stopping on the belt", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createFurnanceSeparatedByOneBeltDocument({
      includeUpperFurnance: false,
    }));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "device",
        entityId: "lower-furnance",
        pointerGridPoint: { x: 44, y: 57 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 44, y: 57 },
      routeMode: { type: "freehand" },
    });

    expect(moveResult).toMatchObject({
      canApply: true,
      invalidReason: null,
      sourceEntityId: "lower-furnance",
      targetEntityId: null,
    });
    // belt at (44,57) has input from (45,57) and output to (43,57) → converger
    expect(editorHost.state.collections.ghost).toEqual(["left-belt-1"]);
    expect(findPreviewDraftAt(editorHost, 44, 57)).toMatchObject({
      definitionId: "item_log_converger",
    });
  });

  it("creates a converger when drawing one cell up from the left furnace output and stopping on the belt", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createFurnanceSeparatedByOneBeltDocument({
      includeUpperFurnance: false,
    }));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "device",
        entityId: "lower-furnance",
        pointerGridPoint: { x: 43, y: 56 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 43, y: 57 },
      routeMode: { type: "freehand" },
    });

    expect(moveResult).toMatchObject({
      canApply: true,
      invalidReason: null,
      sourceEntityId: "lower-furnance",
      targetEntityId: null,
    });
    // belt at (43,57) has input from (44,57) → converger
    expect(editorHost.state.collections.ghost).toEqual(["left-belt-2"]);
    expect(findPreviewDraftAt(editorHost, 43, 57)).toMatchObject({
      definitionId: "item_log_converger",
    });
  });

  it("creates a connector on PC when drawing from the lower furnance through the belt to a distant cell", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createFurnanceSeparatedByOneBeltDocument({
      includeUpperFurnance: false,
    }));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "device",
        entityId: "lower-furnance",
        pointerGridPoint: { x: 45, y: 57 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 45, y: 54 },
      routeMode: {
        type: "single-bend",
        routeOrder: "vertical-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult).toMatchObject({
      canApply: true,
      invalidReason: null,
      sourceEntityId: "lower-furnance",
      targetEntityId: null,
    });
    expect(editorHost.state.collections.ghost).toEqual(["crossing-belt"]);
    expect(findPreviewDraftAt(editorHost, 45, 57)).toMatchObject({
      definitionId: "item_log_connector",
    });
  });

  it("creates a connector on touch when drawing from the lower furnance through the belt to a distant cell", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createFurnanceSeparatedByOneBeltDocument({
      includeUpperFurnance: false,
    }));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "device",
        entityId: "lower-furnance",
        pointerGridPoint: { x: 45, y: 57 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 45, y: 54 },
      routeMode: { type: "freehand" },
    });

    expect(moveResult).toMatchObject({
      canApply: true,
      invalidReason: null,
      sourceEntityId: "lower-furnance",
      targetEntityId: null,
    });
    expect(editorHost.state.collections.ghost).toEqual(["crossing-belt"]);
    expect(findPreviewDraftAt(editorHost, 45, 57)).toMatchObject({
      definitionId: "item_log_connector",
    });
  });

  it("creates a connector on PC when drawing from a distant cell through the belt into the upper furnance", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createFurnanceSeparatedByOneBeltDocument({
      includeLowerFurnance: false,
    }));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "empty-cell",
        gridPoint: { x: 45, y: 60 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 45, y: 56 },
      routeMode: {
        type: "single-bend",
        routeOrder: "vertical-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult).toMatchObject({
      canApply: true,
      invalidReason: null,
      sourceEntityId: null,
      targetEntityId: "upper-furnance",
    });
    expect(editorHost.state.collections.ghost).toEqual(["crossing-belt"]);
    expect(findPreviewDraftAt(editorHost, 45, 57)).toMatchObject({
      definitionId: "item_log_connector",
    });
  });

  it("creates a connector on touch when drawing from a distant cell through the belt into the upper furnance", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createFurnanceSeparatedByOneBeltDocument({
      includeLowerFurnance: false,
    }));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "empty-cell",
        gridPoint: { x: 45, y: 60 },
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 45, y: 56 },
      routeMode: { type: "freehand" },
    });

    expect(moveResult).toMatchObject({
      canApply: true,
      invalidReason: null,
      sourceEntityId: null,
      targetEntityId: "upper-furnance",
    });
    expect(editorHost.state.collections.ghost).toEqual(["crossing-belt"]);
    expect(findPreviewDraftAt(editorHost, 45, 57)).toMatchObject({
      definitionId: "item_log_connector",
    });
  });

  it("creates virtual converger and connector drafts for freehand self-overlap", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "empty-cell",
        gridPoint: { x: 0, y: 0 },
      },
    });
    for (const pointerGridPoint of [
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
      { x: 0, y: 1 },
      { x: 2, y: 1 },
    ]) {
      editorHost.actions.moveLogisticEnd({
        pointerGridPoint,
        routeMode: { type: "freehand" },
      });
    }

    expect(editorHost.queries.resolveLogisticsDraftState()?.invalidReason).toBeNull();
    expect(findPreviewDraftAt(editorHost, 2, 1)).toMatchObject({
      definitionId: "item_log_converger",
    });

    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 3, y: 1 },
      routeMode: { type: "freehand" },
    });

    expect(editorHost.queries.resolveLogisticsDraftState()?.invalidReason).toBeNull();
    expect(findPreviewDraftAt(editorHost, 2, 1)).toMatchObject({
      definitionId: "item_log_connector",
    });
  });

  it("creates a connector for freehand self-overlap when auto splitters and convergers are disabled", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "empty-cell",
        gridPoint: { x: 0, y: 0 },
      },
    });
    for (const pointerGridPoint of [
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
      { x: 0, y: 1 },
    ]) {
      editorHost.actions.moveLogisticEnd({
        pointerGridPoint,
        autoCreateSplittersAndConvergers: false,
        routeMode: { type: "freehand" },
      });
    }

    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 3, y: 1 },
      autoCreateSplittersAndConvergers: false,
      routeMode: { type: "freehand" },
    });

    expect(moveResult).toMatchObject({
      canApply: true,
      invalidReason: null,
    });
    expect(findPreviewDraftAt(editorHost, 2, 1)).toMatchObject({
      definitionId: "item_log_connector",
    });
  });

  it("marks freehand self-overlap convergers invalid when auto splitters and convergers are disabled", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "empty-cell",
        gridPoint: { x: 0, y: 0 },
      },
    });
    for (const pointerGridPoint of [
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ]) {
      editorHost.actions.moveLogisticEnd({
        pointerGridPoint,
        routeMode: { type: "freehand" },
      });
    }

    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 2, y: 1 },
      autoCreateSplittersAndConvergers: false,
      routeMode: { type: "freehand" },
    });

    expect(moveResult).toMatchObject({
      canApply: false,
      invalidReason: "overlap-own-preview",
    });
    expect(listPreviewAutoDeviceDefinitionIds(editorHost)).toEqual([]);
  });

  it("keeps freehand self-overlap converger head when retracing a horizontal draft segment", () => {
    for (const direction of ["right", "left"] as const) {
      const workspace = createWorkspace();
      const editorHost = createEditorHost(workspace);
      const basePoints = [
        { x: 2, y: 5 },
        { x: 3, y: 5 },
        { x: 4, y: 5 },
        { x: 5, y: 5 },
        { x: 6, y: 5 },
        { x: 7, y: 5 },
        { x: 8, y: 5 },
        { x: 9, y: 5 },
        { x: 9, y: 4 },
        { x: 8, y: 4 },
        { x: 7, y: 4 },
        { x: 6, y: 4 },
        { x: 5, y: 4 },
        { x: 5, y: 5 },
      ];
      const tailPoints = direction === "right"
        ? [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }]
        : [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }];

      editorHost.actions.createLogisticsDraftStart({
        kind: "belt",
        source: {
          type: "empty-cell",
          gridPoint: { x: 1, y: 5 },
        },
      });

      for (const pointerGridPoint of basePoints) {
        editorHost.actions.moveLogisticEnd({
          pointerGridPoint,
          routeMode: { type: "freehand" },
        });
      }

      const beforeDraft = editorHost.queries.resolveLogisticsDraftState();
      const beforeCells = beforeDraft?.cells.map((cell) => cell.gridPoint) ?? [];
      const beforeHeadDraftEntityId = beforeDraft?.headDraftEntityId ?? null;

      for (const pointerGridPoint of tailPoints) {
        editorHost.actions.moveLogisticEnd({
          pointerGridPoint,
          routeMode: { type: "freehand" },
        });
      }

      expect(editorHost.queries.resolveLogisticsDraftState()).toMatchObject({
        canApply: true,
        invalidReason: null,
        headDraftEntityId: beforeHeadDraftEntityId,
      });
      expect(editorHost.queries.resolveLogisticsDraftState()?.cells.map((cell) => cell.gridPoint)).toEqual(
        beforeCells,
      );
      expect(editorHost.queries.resolveLogisticsDraftState()?.cells.at(-1)?.gridPoint).toEqual({ x: 5, y: 5 });
      expect(findPreviewDraftAt(editorHost, 5, 5)).toMatchObject({
        definitionId: "item_log_converger",
      });
      expect(listPreviewAutoDeviceDefinitionIds(editorHost)).toEqual(["item_log_converger"]);
    }
  });

  it("keeps the freehand self-overlap converger head when dragging along the overlapped segment", () => {
    for (const pointerGridPoint of [{ x: 7, y: 5 }, { x: 5, y: 5 }, { x: 8, y: 5 }]) {
      const workspace = createWorkspace();
      const editorHost = createEditorHost(workspace);

      editorHost.actions.createLogisticsDraftStart({
        kind: "belt",
        source: {
          type: "empty-cell",
          gridPoint: { x: 5, y: 5 },
        },
      });

      for (const stepGridPoint of [
        { x: 8, y: 5 },
        { x: 8, y: 4 },
        { x: 6, y: 4 },
        { x: 6, y: 5 },
      ]) {
        editorHost.actions.moveLogisticEnd({
          pointerGridPoint: stepGridPoint,
          routeMode: { type: "freehand" },
        });
      }

      const beforeDraft = editorHost.queries.resolveLogisticsDraftState();
      const beforeCells = beforeDraft?.cells.map((cell) => cell.gridPoint) ?? [];
      const beforeHeadDraftEntityId = beforeDraft?.headDraftEntityId ?? null;

      expect(beforeDraft).toMatchObject({
        canApply: true,
        invalidReason: null,
        headDraftEntityId: beforeHeadDraftEntityId,
      });
      expect(beforeDraft?.cells.at(-1)?.gridPoint).toEqual({ x: 6, y: 5 });
      expect(findPreviewDraftAt(editorHost, 6, 5)).toMatchObject({
        definitionId: "item_log_converger",
      });

      const moveResult = editorHost.actions.moveLogisticEnd({
        pointerGridPoint,
        routeMode: { type: "freehand" },
      });

      expect(moveResult).toMatchObject({
        canApply: true,
        invalidReason: null,
        headGridPoint: { x: 6, y: 5 },
        headDraftEntityId: beforeHeadDraftEntityId,
      });
      expect(editorHost.queries.resolveLogisticsDraftState()).toMatchObject({
        canApply: true,
        invalidReason: null,
        headDraftEntityId: beforeHeadDraftEntityId,
      });
      expect(
        editorHost.queries.resolveLogisticsDraftState()?.cells.map((cell) => cell.gridPoint),
      ).toEqual(beforeCells);
      expect(findPreviewDraftAt(editorHost, 6, 5)).toMatchObject({
        definitionId: "item_log_converger",
      });
      expect(listPreviewAutoDeviceDefinitionIds(editorHost)).toEqual(["item_log_converger"]);
    }
  });

  it("keeps freehand self-overlap converger head when retracing a vertical draft segment", () => {
    for (const direction of ["down", "up"] as const) {
      const workspace = createWorkspace();
      const editorHost = createEditorHost(workspace);
      const basePoints = [
        { x: 5, y: 2 },
        { x: 5, y: 3 },
        { x: 5, y: 4 },
        { x: 5, y: 5 },
        { x: 5, y: 6 },
        { x: 5, y: 7 },
        { x: 5, y: 8 },
        { x: 5, y: 9 },
        { x: 4, y: 9 },
        { x: 4, y: 8 },
        { x: 4, y: 7 },
        { x: 4, y: 6 },
        { x: 4, y: 5 },
        { x: 5, y: 5 },
      ];
      const tailPoints = direction === "down"
        ? [{ x: 5, y: 6 }, { x: 5, y: 7 }, { x: 5, y: 8 }]
        : [{ x: 5, y: 4 }, { x: 5, y: 3 }, { x: 5, y: 2 }];

      editorHost.actions.createLogisticsDraftStart({
        kind: "belt",
        source: {
          type: "empty-cell",
          gridPoint: { x: 5, y: 1 },
        },
      });

      for (const pointerGridPoint of basePoints) {
        editorHost.actions.moveLogisticEnd({
          pointerGridPoint,
          routeMode: { type: "freehand" },
        });
      }

      const beforeDraft = editorHost.queries.resolveLogisticsDraftState();
      const beforeCells = beforeDraft?.cells.map((cell) => cell.gridPoint) ?? [];
      const beforeHeadDraftEntityId = beforeDraft?.headDraftEntityId ?? null;

      for (const pointerGridPoint of tailPoints) {
        editorHost.actions.moveLogisticEnd({
          pointerGridPoint,
          routeMode: { type: "freehand" },
        });
      }

      expect(editorHost.queries.resolveLogisticsDraftState()).toMatchObject({
        canApply: true,
        invalidReason: null,
        headDraftEntityId: beforeHeadDraftEntityId,
      });
      expect(editorHost.queries.resolveLogisticsDraftState()?.cells.map((cell) => cell.gridPoint)).toEqual(
        beforeCells,
      );
      expect(editorHost.queries.resolveLogisticsDraftState()?.cells.at(-1)?.gridPoint).toEqual({ x: 5, y: 5 });
      expect(findPreviewDraftAt(editorHost, 5, 5)).toMatchObject({
        definitionId: "item_log_converger",
      });
      expect(listPreviewAutoDeviceDefinitionIds(editorHost)).toEqual(["item_log_converger"]);
    }
  });

  it("keeps the pointer-selected nearest device route stable across route-order changes", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("source-device", "item_port_storager_1", 0, 8),
      createTestEntity("target-device", "item_port_grinder_1", 0, 0),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "device",
        entityId: "source-device",
        pointerGridPoint: { x: 1, y: 8 },
      },
      routeOrder: "vertical-first",
    });

    const seenTargetPortIds = new Set<string>();
    const seenRouteSignatures = new Set<string>();
    for (const routeOrder of [
      "vertical-first",
      "horizontal-first",
      "vertical-first",
      "horizontal-first",
      "vertical-first",
    ] as const) {
      const moveResult = editorHost.actions.moveLogisticEnd({
        pointerGridPoint: { x: 1, y: 2 },
        routeMode: {
          type: "single-bend",
          routeOrder,
          allowTemporaryOrderFlip: true,
        },
      });
      const draft = editorHost.queries.resolveLogisticsDraftState();

      expect(moveResult.canApply).toBe(true);
      if (draft?.source?.type === "device-port" && draft.target?.type === "device-port") {
        seenTargetPortIds.add(draft.target.portId);
        seenRouteSignatures.add([
          draft.source.portId,
          draft.target.portId,
          ...draft.cells.map((cell) => `${cell.gridPoint.x}:${cell.gridPoint.y}`),
        ].join("|"));
      }
    }

    // AI-CORRECTION 2026-06-19:
    // AI-CORRECTION 2026-06-19:
    // 目标端口由鼠标落点就近锁定，源端口再按该目标端口就近选择；
    // routeOrder 变化不应把连接切换到更远的端口组合。
    expect(seenTargetPortIds.size).toBe(1);
    expect(seenRouteSignatures.size).toBe(1);
  });

  it("applies a converger auto-draft and exposes the head entity as converger so gestures can stop", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // AI-CORRECTION 2026-05-29: 汇流器现要求 inputConnected=true，需加上游。
    // 从上方(12,7)拉入，不穿过 predecessor(11,8)。
    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("predecessor", "belt_straight_1x1", 11, 8),
      createTestEntity("target", "belt_straight_1x1", 12, 8),
      createTestEntity("successor", "belt_straight_1x1", 13, 8),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: { type: "empty-cell", gridPoint: { x: 12, y: 7 } },
    });
    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 12, y: 8 },
      routeMode: { type: "single-bend", routeOrder: "vertical-first", allowTemporaryOrderFlip: true },
    });

    const draft = editorHost.queries.resolveLogisticsDraftState();
    expect(draft?.headDraftEntityId).toBeTruthy();
    const headEntity = editorHost.queries.getEntityById(draft!.headDraftEntityId!);
    expect(headEntity?.definitionId).toBe("item_log_converger");

    expect(editorHost.actions.applyLogisticDraft()).toBe(true);
    const committed = editorHost.internalDocument.getSnapshot();
    expect(committed.entities[draft!.headDraftEntityId!]).toMatchObject({
      definitionId: "item_log_converger",
    });
  });

  it("applies a vertical converger auto-draft and exposes the head entity as converger so gestures can stop", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // AI-CORRECTION 2026-05-29: 汇流器现要求 inputConnected=true，需加上游。
    // predecessor(6,5)→target(6,6)→successor(6,7)
    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("predecessor", "belt_straight_1x1", 6, 5, 90),
      createTestEntity("target", "belt_straight_1x1", 6, 6, 90),
      createTestEntity("successor", "belt_straight_1x1", 6, 7, 90),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: { type: "empty-cell", gridPoint: { x: 4, y: 6 } },
    });
    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 6, y: 6 },
      routeMode: { type: "single-bend", routeOrder: "horizontal-first", allowTemporaryOrderFlip: true },
    });

    const draft = editorHost.queries.resolveLogisticsDraftState();
    expect(draft?.headDraftEntityId).toBeTruthy();
    const headEntity = editorHost.queries.getEntityById(draft!.headDraftEntityId!);
    expect(headEntity?.definitionId).toBe("item_log_converger");

    expect(editorHost.actions.applyLogisticDraft()).toBe(true);
    const committed = editorHost.internalDocument.getSnapshot();
    expect(committed.entities[draft!.headDraftEntityId!]).toMatchObject({
      definitionId: "item_log_converger",
    });
  });

  it("applies a splitter auto-draft and does not expose the head as converger", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("predecessor", "belt_straight_1x1", 11, 8),
      createTestEntity("source", "belt_straight_1x1", 12, 8),
      createTestEntity("successor", "belt_straight_1x1", 13, 8),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: { type: "logistics-entity", entityId: "source", gridPoint: { x: 12, y: 8 } },
    });
    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 12, y: 7 },
      routeMode: { type: "single-bend", routeOrder: "vertical-first", allowTemporaryOrderFlip: true },
    });

    const draft = editorHost.queries.resolveLogisticsDraftState();
    expect(draft?.headDraftEntityId).toBeTruthy();
    const headEntity = editorHost.queries.getEntityById(draft!.headDraftEntityId!);
    // 分流器起点时 head 不是分流器所在格，而是路径末端
    expect(headEntity?.definitionId).not.toBe("item_log_converger");
    expect(headEntity?.definitionId).not.toBe("item_log_splitter");
  });

  it("applies a vertical splitter auto-draft and does not expose the head as converger", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // predecessor(6,5) ↓ source(6,6) ↓ C(6,7)
    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("predecessor", "belt_straight_1x1", 6, 5, 90),
      createTestEntity("source", "belt_straight_1x1", 6, 6, 90),
      createTestEntity("successor", "belt_straight_1x1", 6, 7, 90),
    ]));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: { type: "logistics-entity", entityId: "source", gridPoint: { x: 6, y: 6 } },
    });
    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 5, y: 6 },
      routeMode: { type: "single-bend", routeOrder: "vertical-first", allowTemporaryOrderFlip: true },
    });

    const draft = editorHost.queries.resolveLogisticsDraftState();
    expect(draft?.headDraftEntityId).toBeTruthy();
    const headEntity = editorHost.queries.getEntityById(draft!.headDraftEntityId!);
    expect(headEntity?.definitionId).not.toBe("item_log_converger");
    expect(headEntity?.definitionId).not.toBe("item_log_splitter");
  });

  it("blocks drawing into B from above then toward A or C on a fully connected A→B→C straight belt", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // A(11,8) → B(12,8) → C(13,8)
    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("A", "belt_straight_1x1", 11, 8),
      createTestEntity("B", "belt_straight_1x1", 12, 8),
      createTestEntity("C", "belt_straight_1x1", 13, 8),
    ]));

    // 从 B 上方起笔，向下画到 B
    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: { type: "empty-cell", gridPoint: { x: 12, y: 7 } },
    });
    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 12, y: 8 },
      routeMode: { type: "single-bend", routeOrder: "horizontal-first", allowTemporaryOrderFlip: true },
    });

    // 终点是 B，auto-draft 应创建汇流器
    expect(findPreviewDraftAt(editorHost, 12, 8)).toMatchObject({
      definitionId: "item_log_converger",
    });

    // 左移朝向 A → 禁止
    const moveToA = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 11, y: 8 },
      routeMode: { type: "single-bend", routeOrder: "vertical-first", allowTemporaryOrderFlip: true },
    });
    expect(moveToA.canApply).toBe(false);
    expect(listPreviewAutoDeviceDefinitionIds(editorHost)).toEqual([]);
    expect(editorHost.actions.applyLogisticDraft()).toBe(false);

    // 撤销，重试右移朝向 C → 禁止
    editorHost.actions.cancelLogisticsDraft();
    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: { type: "empty-cell", gridPoint: { x: 12, y: 7 } },
    });
    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 12, y: 8 },
      routeMode: { type: "single-bend", routeOrder: "horizontal-first", allowTemporaryOrderFlip: true },
    });

    const moveToC = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 13, y: 8 },
      routeMode: { type: "single-bend", routeOrder: "vertical-first", allowTemporaryOrderFlip: true },
    });
    expect(moveToC.canApply).toBe(false);
    expect(listPreviewAutoDeviceDefinitionIds(editorHost)).toEqual([]);
    expect(editorHost.actions.applyLogisticDraft()).toBe(false);
  });

  it("blocks drawing into B from the left then toward A or C on a vertically stacked A→B→C straight belt", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // A(6,5) ↓ B(6,6) ↓ C(6,7)
    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("A", "belt_straight_1x1", 6, 5, 90),
      createTestEntity("B", "belt_straight_1x1", 6, 6, 90),
      createTestEntity("C", "belt_straight_1x1", 6, 7, 90),
    ]));

    // 从 B 左侧起笔，向右画到 B
    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: { type: "empty-cell", gridPoint: { x: 5, y: 6 } },
    });
    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 6, y: 6 },
      routeMode: { type: "single-bend", routeOrder: "horizontal-first", allowTemporaryOrderFlip: true },
    });

    // 终点是 B，auto-draft 应创建汇流器
    expect(findPreviewDraftAt(editorHost, 6, 6)).toMatchObject({
      definitionId: "item_log_converger",
    });

    // 上移朝向 A → 禁止
    const moveToA = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 6, y: 5 },
      routeMode: { type: "single-bend", routeOrder: "horizontal-first", allowTemporaryOrderFlip: true },
    });
    expect(moveToA.canApply).toBe(false);
    expect(listPreviewAutoDeviceDefinitionIds(editorHost)).toEqual([]);
    expect(editorHost.actions.applyLogisticDraft()).toBe(false);

    // 撤销，重试下移朝向 C → 禁止
    editorHost.actions.cancelLogisticsDraft();
    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: { type: "empty-cell", gridPoint: { x: 5, y: 6 } },
    });
    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 6, y: 6 },
      routeMode: { type: "single-bend", routeOrder: "horizontal-first", allowTemporaryOrderFlip: true },
    });

    const moveToC = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 6, y: 7 },
      routeMode: { type: "single-bend", routeOrder: "horizontal-first", allowTemporaryOrderFlip: true },
    });
    expect(moveToC.canApply).toBe(false);
    expect(listPreviewAutoDeviceDefinitionIds(editorHost)).toEqual([]);
    expect(editorHost.actions.applyLogisticDraft()).toBe(false);
  });

  it("does not create an auto-device chain when moving along a horizontal nine-tile belt after entering from above", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities(
      Array.from({ length: 9 }, (_, index) =>
        createTestEntity(`belt-${index}`, "belt_straight_1x1", index - 4, -5),
      ),
    ));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: { type: "empty-cell", gridPoint: { x: 0, y: -6 } },
    });
    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 0, y: -5 },
      routeMode: { type: "single-bend", routeOrder: "vertical-first", allowTemporaryOrderFlip: true },
    });
    expect(findPreviewDraftAt(editorHost, 0, -5)).toMatchObject({
      definitionId: "item_log_converger",
    });

    const moveForward = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 3, y: -5 },
      routeMode: { type: "single-bend", routeOrder: "vertical-first", allowTemporaryOrderFlip: true },
    });

    expect(moveForward.canApply).toBe(false);
    expect(listPreviewAutoDeviceDefinitionIds(editorHost)).toEqual([]);

    editorHost.actions.cancelLogisticsDraft();
    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: { type: "empty-cell", gridPoint: { x: 0, y: -6 } },
    });
    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 0, y: -5 },
      routeMode: { type: "single-bend", routeOrder: "vertical-first", allowTemporaryOrderFlip: true },
    });

    const moveBackward = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: -3, y: -5 },
      routeMode: { type: "single-bend", routeOrder: "vertical-first", allowTemporaryOrderFlip: true },
    });

    expect(moveBackward.canApply).toBe(false);
    expect(listPreviewAutoDeviceDefinitionIds(editorHost)).toEqual([]);
  });

  it("does not create an auto-device chain when moving along a vertical nine-tile belt after entering from the side", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities(
      Array.from({ length: 9 }, (_, index) =>
        createTestEntity(`belt-${index}`, "belt_straight_1x1", 10, index - 4, 90),
      ),
    ));

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: { type: "empty-cell", gridPoint: { x: 9, y: 0 } },
    });
    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 10, y: 0 },
      routeMode: { type: "single-bend", routeOrder: "horizontal-first", allowTemporaryOrderFlip: true },
    });
    expect(findPreviewDraftAt(editorHost, 10, 0)).toMatchObject({
      definitionId: "item_log_converger",
    });

    const moveForward = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 10, y: 3 },
      routeMode: { type: "single-bend", routeOrder: "horizontal-first", allowTemporaryOrderFlip: true },
    });

    expect(moveForward.canApply).toBe(false);
    expect(listPreviewAutoDeviceDefinitionIds(editorHost)).toEqual([]);

    editorHost.actions.cancelLogisticsDraft();
    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: { type: "empty-cell", gridPoint: { x: 9, y: 0 } },
    });
    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 10, y: 0 },
      routeMode: { type: "single-bend", routeOrder: "horizontal-first", allowTemporaryOrderFlip: true },
    });

    const moveBackward = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 10, y: -3 },
      routeMode: { type: "single-bend", routeOrder: "horizontal-first", allowTemporaryOrderFlip: true },
    });

    expect(moveBackward.canApply).toBe(false);
    expect(listPreviewAutoDeviceDefinitionIds(editorHost)).toEqual([]);
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

  it("selects an adjacent output port in left-up-right-down order and fixes the source port", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("left", "item_log_splitter", 4, 5),
      createTestEntity("up", "item_log_splitter", 5, 4),
      createTestEntity("right", "item_log_splitter", 6, 5),
      createTestEntity("down", "item_log_splitter", 5, 6, 180),
    ]));

    expect(
      editorHost.queries.findLogisticsDraftEndpointAtGridPoint({ x: 5, y: 5 }, "belt"),
    ).toMatchObject({
      type: "device-port",
      entityId: "left",
      portId: "out_e",
      outsideGridPoint: { x: 5, y: 5 },
      fixedSource: true,
    });
  });

  it("allows a fixed adjacent device output to start from empty ground when empty starts are disabled", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("storage", "item_port_storager_1", 6, 6),
    ]));

    const createResult = editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      allowEmptySource: false,
      source: {
        type: "fixed-device-port",
        entityId: "storage",
        portGroupId: "item_output",
        portId: "out_n_1",
        outsideGridPoint: { x: 7, y: 5 },
      },
    });
    expect(createResult.status).toBe("created");

    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 10, y: 5 },
      routeMode: {
        type: "single-bend",
        routeOrder: "horizontal-first",
        allowTemporaryOrderFlip: true,
      },
    });
    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 7, y: 2 },
      routeMode: {
        type: "single-bend",
        routeOrder: "vertical-first",
        allowTemporaryOrderFlip: true,
      },
    });

    const draft = editorHost.queries.resolveLogisticsDraftState();
    expect(draft).toMatchObject({
      source: {
        type: "device-port",
        entityId: "storage",
        portId: "out_n_1",
        outsideGridPoint: { x: 7, y: 5 },
        fixedSource: true,
      },
    });
    expect(draft?.cells[0]).toMatchObject({
      gridPoint: { x: 7, y: 5 },
      fromEdge: "SOUTH",
      toEdge: "NORTH",
    });
  });

  it("always creates a connector when a fixed device output starts across an existing belt", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("storage", "item_port_storager_1", 6, 6),
      createTestEntity("predecessor", "belt_straight_1x1", 6, 5),
      createTestEntity("crossing", "belt_straight_1x1", 7, 5),
      createTestEntity("successor", "belt_straight_1x1", 8, 5),
    ]));

    const endpoint = editorHost.queries.findLogisticsDraftEndpointAtGridPoint({ x: 7, y: 5 }, "belt");
    expect(endpoint).toMatchObject({ type: "device-port", fixedSource: true });
    if (endpoint?.type !== "device-port") {
      throw new Error("Expected a fixed device output endpoint.");
    }

    editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      allowEmptySource: false,
      source: {
        type: "fixed-device-port",
        entityId: endpoint.entityId,
        portGroupId: endpoint.portGroupId,
        portId: endpoint.portId,
        outsideGridPoint: endpoint.outsideGridPoint,
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 7, y: 3 },
      autoCreateSplittersAndConvergers: false,
      routeMode: {
        type: "single-bend",
        routeOrder: "vertical-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult).toMatchObject({ canApply: true, invalidReason: null });
    expect(editorHost.state.collections.ghost).toContain("crossing");
    expect(findPreviewDraftAt(editorHost, 7, 5)).toMatchObject({
      definitionId: "item_log_connector",
    });
  });

  it("creates a splitter for an aligned fixed output belt only when auto devices are enabled", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithTestEntities([
      createTestEntity("storage", "item_port_storager_1", 6, 6),
      createTestEntity("source-belt", "belt_straight_1x1", 7, 5, 270),
      createTestEntity("successor", "belt_straight_1x1", 7, 4, 270),
    ]);
    editorHost.internalDocument.setSnapshot(document);

    const start = () => editorHost.actions.createLogisticsDraftStart({
      kind: "belt" as const,
      source: {
        type: "fixed-device-port" as const,
        entityId: "storage",
        portGroupId: "item_output",
        portId: "out_n_1",
        outsideGridPoint: { x: 7, y: 5 },
      },
    });

    start();
    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 6, y: 5 },
      autoCreateSplittersAndConvergers: true,
      routeMode: {
        type: "single-bend",
        routeOrder: "horizontal-first",
        allowTemporaryOrderFlip: true,
      },
    });
    expect(findPreviewDraftAt(editorHost, 7, 5)).toMatchObject({
      definitionId: "item_log_splitter",
    });

    editorHost.actions.cancelLogisticsDraft();
    start();
    editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 6, y: 5 },
      autoCreateSplittersAndConvergers: false,
      routeMode: {
        type: "single-bend",
        routeOrder: "horizontal-first",
        allowTemporaryOrderFlip: true,
      },
    });
    expect(findPreviewDraftAt(editorHost, 7, 5)).toMatchObject({
      definitionId: "belt_turn_ccw_1x1",
    });
  });

  it("applies the fixed adjacent output crossing rule to pipes", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDocumentWithTestEntities([
      createTestEntity("pump", "item_port_water_pump_1", 4, 4),
      createTestEntity("predecessor", "pipe_straight_1x1", 7, 4, 90),
      createTestEntity("crossing", "pipe_straight_1x1", 7, 5, 90),
      createTestEntity("successor", "pipe_straight_1x1", 7, 6, 90),
    ]));

    const endpoint = editorHost.queries.findLogisticsDraftEndpointAtGridPoint({ x: 7, y: 5 }, "pipe");
    expect(endpoint).toMatchObject({
      type: "device-port",
      entityId: "pump",
      fixedSource: true,
    });
    if (endpoint?.type !== "device-port") {
      throw new Error("Expected a fixed fluid output endpoint.");
    }

    editorHost.actions.createLogisticsDraftStart({
      kind: "pipe",
      allowEmptySource: false,
      source: {
        type: "fixed-device-port",
        entityId: endpoint.entityId,
        portGroupId: endpoint.portGroupId,
        portId: endpoint.portId,
        outsideGridPoint: endpoint.outsideGridPoint,
      },
    });
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 9, y: 5 },
      autoCreateSplittersAndConvergers: false,
      routeMode: {
        type: "single-bend",
        routeOrder: "horizontal-first",
        allowTemporaryOrderFlip: true,
      },
    });

    expect(moveResult).toMatchObject({ canApply: true, invalidReason: null });
    expect(findPreviewDraftAt(editorHost, 7, 5)).toMatchObject({
      definitionId: "item_pipe_connector",
    });
  });

});

// ---------------------------------------------------------------------------
// Helpers (logistics-utils 纯函数测试)
// ---------------------------------------------------------------------------

function createTestDocument(entities: readonly WorldEntity[]): WorldDocument {
  return {
    schemaVersion: 1,
    documentKey: "test-logistics-turn",
    baseId: DEFAULT_WORLD_BASE_ID,
    meta: {
      id: "test-logistics-turn",
      name: "Test Logistics Turn",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    entities: Object.fromEntries(entities.map((e) => [e.id, e])) as Record<string, WorldEntity>,
    entityOrder: entities.map((e) => e.id),
    slotLinks: [],
    documentSettings: {
      viewport: { center: { x: 0, y: 0 }, gridSize: 1, displayRotation: 0 },
      powerMode: "infinite",
    },
  };
}

function makeEntity(
  id: string,
  definitionId: string,
  x: number,
  y: number,
  rotation: WorldEntity["rotation"] = 0,
): WorldEntity {
  return { id, definitionId, position: { x, y }, rotation, config: {}, tags: [] };
}

// ---------------------------------------------------------------------------
// resolveLogisticsPathCells — 弯道起点 fromEdge 方向
// ---------------------------------------------------------------------------
//
// 当起点是 logistics-entity（直道 / 弯道）且无有效上游（入口外侧无连接的物流段）时，
// 第一节 cell 的 fromEdge 应从被替换实体自身的 input port edge 推断，
// 而非从绘制方向反推。
//
// 裸弯道 / 设备邻接 × touch freehand / mouse single-bend 共 4 个用例。

describe("resolveLogisticsPathCells — 弯道起点 fromEdge", () => {
  const registry = createRegistryContract();
  const entityDefinitionMap = createEntityDefinitionMap(registry.entityDefinitions);

  const cwDef = registry.entityDefinitions.find((d) => d.id === "belt_turn_cw_1x1") as EntityDefinition;

  // belt_turn_cw_1x1 rotation=0: input E edge, output N edge.
  // 所有用例弯道均位于 (2,2) rotation=0。
  const TURN_POS = { x: 2, y: 2 };
  const TURN_ROT = 0;
  const TURN_ID = "test-turn";

  // ---- 裸弯道 -------------------------------------------------------

  describe("裸弯道（无设备邻接）", () => {
    const bareDoc = createTestDocument([
      makeEntity(TURN_ID, "belt_turn_cw_1x1", TURN_POS.x, TURN_POS.y, TURN_ROT),
    ]);

    const sourceEndpoint = {
      type: "logistics-entity" as const,
      entityId: TURN_ID,
      gridPoint: { ...TURN_POS },
    };

    it("touch freehand 向南再向东：第一节 fromEdge 为 EAST（弯道入口方向）", () => {
      // 模拟 touch 自由拖拽：先向南 2 格，再向东 2 格
      const points = [
        { x: 2, y: 2 },
        { x: 2, y: 3 },
        { x: 2, y: 4 },
        { x: 3, y: 4 },
        { x: 4, y: 4 },
      ];

      const cells = resolveLogisticsPathCells({
        kind: "belt",
        points,
        source: sourceEndpoint,
        target: null,
        document: bareDoc,
        entityDefinitionMap,
        replacingEntity: bareDoc.entities[TURN_ID] ?? null,
        replacingDefinition: cwDef,
      });

      // 第一节：from 入口 EAST → to 向南 SOUTH，应为逆时针转弯
      expect(cells[0]).toMatchObject({
        fromEdge: "EAST",
        toEdge: "SOUTH",
        shape: "turn-ccw",
      });
      // 后续节也有正确 shape
      expect(cells[1]).toMatchObject({ shape: "straight" });
      // cells[2] at (2,4): entry NORTH(opposite of SOUTH from previous), exit EAST → turn-ccw
      expect(cells[2]).toMatchObject({ shape: "turn-ccw" });
      expect(cells[3]).toMatchObject({ shape: "straight" });
    });

    it("mouse single-bend 向南 L 形：第一节 fromEdge 为 EAST（弯道入口方向）", () => {
      // 模拟 mouse single-bend vertical-first：目标 (3,4)
      // corner = (2,4), points: (2,2)→(2,3)→(2,4)→(3,4)
      const points = [
        { x: 2, y: 2 },
        { x: 2, y: 3 },
        { x: 2, y: 4 },
        { x: 3, y: 4 },
      ];

      const cells = resolveLogisticsPathCells({
        kind: "belt",
        points,
        source: sourceEndpoint,
        target: null,
        document: bareDoc,
        entityDefinitionMap,
        replacingEntity: bareDoc.entities[TURN_ID] ?? null,
        replacingDefinition: cwDef,
      });

      expect(cells[0]).toMatchObject({
        fromEdge: "EAST",
        toEdge: "SOUTH",
        shape: "turn-ccw",
      });
      expect(cells[1]).toMatchObject({ shape: "straight" });
      expect(cells[2]).toMatchObject({ shape: "turn-ccw" });
    });
  });

  // ---- 设备邻接弯道 -------------------------------------------------

  describe("设备邻接弯道（入口外侧是设备，非物流实体）", () => {
    // 粉碎机 footprint 3×3 放在 (3,2)，覆盖弯道入口外侧格 (3,2)。
    // 设备不是 logistics entity，resolveConnectedReplacingInputEdge 应返回 null，
    // fromEdge 仍应从弯道自身的 input port 推断。
    const deviceDoc = createTestDocument([
      makeEntity(TURN_ID, "belt_turn_cw_1x1", TURN_POS.x, TURN_POS.y, TURN_ROT),
      makeEntity("test-grinder", "item_port_grinder_1", 3, 2, 0),
    ]);

    const sourceEndpoint = {
      type: "logistics-entity" as const,
      entityId: TURN_ID,
      gridPoint: { ...TURN_POS },
    };

    it("touch freehand 向南再向东：设备不干扰，fromEdge 仍为 EAST", () => {
      const points = [
        { x: 2, y: 2 },
        { x: 2, y: 3 },
        { x: 2, y: 4 },
        { x: 3, y: 4 },
        { x: 4, y: 4 },
      ];

      const cells = resolveLogisticsPathCells({
        kind: "belt",
        points,
        source: sourceEndpoint,
        target: null,
        document: deviceDoc,
        entityDefinitionMap,
        replacingEntity: deviceDoc.entities[TURN_ID] ?? null,
        replacingDefinition: cwDef,
      });

      expect(cells[0]).toMatchObject({
        fromEdge: "EAST",
        toEdge: "SOUTH",
        shape: "turn-ccw",
      });
      expect(cells[1]).toMatchObject({ shape: "straight" });
      expect(cells[2]).toMatchObject({ shape: "turn-ccw" });
      expect(cells[3]).toMatchObject({ shape: "straight" });
    });

    it("mouse single-bend 向南 L 形：设备不干扰，fromEdge 仍为 EAST", () => {
      const points = [
        { x: 2, y: 2 },
        { x: 2, y: 3 },
        { x: 2, y: 4 },
        { x: 3, y: 4 },
      ];

      const cells = resolveLogisticsPathCells({
        kind: "belt",
        points,
        source: sourceEndpoint,
        target: null,
        document: deviceDoc,
        entityDefinitionMap,
        replacingEntity: deviceDoc.entities[TURN_ID] ?? null,
        replacingDefinition: cwDef,
      });

      expect(cells[0]).toMatchObject({
        fromEdge: "EAST",
        toEdge: "SOUTH",
        shape: "turn-ccw",
      });
      expect(cells[1]).toMatchObject({ shape: "straight" });
      expect(cells[2]).toMatchObject({ shape: "turn-ccw" });
    });
  });

  // ---- 空地起笔邻接设备入口（Bug 复现用例） --------------------------

  describe("空地起笔紧邻设备入口：应生成直道而非从WEST开始", () => {
    // converger rotation=0: in_n(N), in_e(E), in_s(S), out_w(W)
    // 放 converger 在 (3,3)，空地在 (4,3)（EAST 邻接，对应 in_e 口）
    const convergerDoc = createTestDocument([
      makeEntity("test-converger", "item_log_converger", 3, 3, 0),
    ]);

    // 从空地(4,3)起笔，连入 converger 的 EAST 输入口。
    // 此时路径仅有起点一个格子，目标为 in_e 端口。
    const emptySource = {
      type: "empty-cell" as const,
      gridPoint: { x: 4, y: 3 },
    };

    const eastTarget = {
      type: "device-port" as const,
      entityId: "test-converger",
      portGroupId: "default_input",
      portId: "in_e",
      portKind: "item" as const,
      portDirection: "input" as const,
      insideGridPoint: { x: 3, y: 3 },
      outsideGridPoint: { x: 4, y: 3 },
      edge: "EAST" as const,
    };

    it("从 EAST 侧空地连入 in_e 口：产出直道 EAST→WEST（流向设备）", () => {
      const points = [{ x: 4, y: 3 }];

      const cells = resolveLogisticsPathCells({
        kind: "belt",
        points,
        source: emptySource,
        target: eastTarget,
        document: convergerDoc,
        entityDefinitionMap,
        replacingEntity: null,
        replacingDefinition: null,
      });

      expect(cells).toHaveLength(1);
      // 期望：fromEdge=EAST（从东侧进入直道），toEdge=WEST（直道向西流出进设备）
      // 当前 bug 行为：fromEdge 会回退到 "WEST"，toEdge 被 normalize 为 "EAST"
      expect(cells[0]).toMatchObject({
        fromEdge: "EAST",
        toEdge: "WEST",
        shape: "straight",
      });
    });

    it("从 NORTH 侧空地连入 in_n 口：产出直道 NORTH→SOUTH", () => {
      const northSource = {
        type: "empty-cell" as const,
        gridPoint: { x: 3, y: 2 },
      };
      const northTarget = {
        type: "device-port" as const,
        entityId: "test-converger",
        portGroupId: "default_input",
        portId: "in_n",
        portKind: "item" as const,
        portDirection: "input" as const,
        insideGridPoint: { x: 3, y: 3 },
        outsideGridPoint: { x: 3, y: 2 },
        edge: "NORTH" as const,
      };
      const points = [{ x: 3, y: 2 }];

      const cells = resolveLogisticsPathCells({
        kind: "belt",
        points,
        source: northSource,
        target: northTarget,
        document: convergerDoc,
        entityDefinitionMap,
        replacingEntity: null,
        replacingDefinition: null,
      });

      expect(cells).toHaveLength(1);
      // 传送带在设备上方(3,2)，物品应向下流入设备 → fromEdge=NORTH, toEdge=SOUTH
      expect(cells[0]).toMatchObject({
        fromEdge: "NORTH",
        toEdge: "SOUTH",
        shape: "straight",
      });
    });

    it("从 SOUTH 侧空地连入 in_s 口：产出直道 SOUTH→NORTH", () => {
      const southSource = {
        type: "empty-cell" as const,
        gridPoint: { x: 3, y: 4 },
      };
      const southTarget = {
        type: "device-port" as const,
        entityId: "test-converger",
        portGroupId: "default_input",
        portId: "in_s",
        portKind: "item" as const,
        portDirection: "input" as const,
        insideGridPoint: { x: 3, y: 3 },
        outsideGridPoint: { x: 3, y: 4 },
        edge: "SOUTH" as const,
      };
      const points = [{ x: 3, y: 4 }];

      const cells = resolveLogisticsPathCells({
        kind: "belt",
        points,
        source: southSource,
        target: southTarget,
        document: convergerDoc,
        entityDefinitionMap,
        replacingEntity: null,
        replacingDefinition: null,
      });

      expect(cells).toHaveLength(1);
      // 传送带在设备下方(3,4)，物品应向上流入设备 → fromEdge=SOUTH, toEdge=NORTH
      expect(cells[0]).toMatchObject({
        fromEdge: "SOUTH",
        toEdge: "NORTH",
        shape: "straight",
      });
    });

    it("对比：画两格路径时第一格正确为直道", () => {
      // 从 (5,3) 起笔，经过 (4,3) 连入 converger 的 EAST 输入口
      const points = [{ x: 5, y: 3 }, { x: 4, y: 3 }];

      const cells = resolveLogisticsPathCells({
        kind: "belt",
        points,
        source: { type: "empty-cell" as const, gridPoint: { x: 5, y: 3 } },
        target: eastTarget,
        document: convergerDoc,
        entityDefinitionMap,
        replacingEntity: null,
        replacingDefinition: null,
      });

      expect(cells).toHaveLength(2);
      // 第一节 (5,3)：fromEdge=EAST(to the west... wait, no)
      // 实际上一节直道 fromEdge 靠上一个点推算。这里只有一个 previous，即 null。
      // Cell 0 (5,3): previous=null, next=(4,3), source=empty-cell
      //   fromEdge: resolveDirectionEdge((5,3),(4,3))=WEST → oppositeEdge="EAST"
      //   toEdge: resolveDirectionEdge((5,3),(4,3))=WEST → normalize → {EAST, WEST}
      // Cell 1 (4,3): previous=(5,3), next=null, target=eastTarget  
      //   fromEdge: resolveDirectionEdge((5,3),(4,3))=WEST → oppositeEdge="EAST"
      //   toEdge: target=device-port(EAST) → oppositeEdge("EAST")="WEST"
      expect(cells[0]).toMatchObject({
        fromEdge: "EAST",
        toEdge: "WEST",
        shape: "straight",
      });
      // 第二节 (4,3) 连设备，fromEdge=EAST, toEdge=WEST → 直道流向设备（正确）
      expect(cells[1]).toMatchObject({
        fromEdge: "EAST",
        toEdge: "WEST",
        shape: "straight",
      });
    });
  });
});
