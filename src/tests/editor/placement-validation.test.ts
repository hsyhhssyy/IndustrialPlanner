import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditorHost } from "@/editor/editor-host";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import {
  createWorldDocument,
  type WorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import {
  buildBaseBuiltinEntityId,
  type BaseBuiltinEntityDefinition,
} from "@/domain/registry/types/base-definition";
import { PLACEMENT_BEHAVIOR_TYPE } from "@/domain/registry/types/entity-placement-behavior";
import { createRegistryContract } from "@/registry";

const TEST_BUILTIN_BASE_ID = "test_builtin_base";
const TEST_OUTER_RING_BASE_ID = "test_outer_ring_base";

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

function createEntity(
  id: string,
  definitionId: string,
  x: number,
  y: number,
  rotation: WorldEntity["rotation"] = 0,
): WorldEntity {
  return {
    id,
    definitionId,
    position: { x, y },
    rotation,
    config: {},
    tags: [],
  };
}

function createDocumentWithEntities(
  entities: readonly WorldEntity[],
  baseId?: string,
): WorldDocument {
  return {
    ...createWorldDocument({ baseId }),
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    entityOrder: entities.map((entity) => entity.id),
  };
}

function registerBuiltinBase(
  workspace: WorkspaceContract,
  builtinEntities: readonly BaseBuiltinEntityDefinition[],
): void {
  workspace.registry.baseDefinitions = [
    ...workspace.registry.baseDefinitions,
    {
      id: TEST_BUILTIN_BASE_ID,
      name: "测试内置设备基地",
      placeableArea: { width: 40, height: 40 },
      outerRing: { top: 0, right: 0, bottom: 0, left: 0 },
      tag: "测试",
      builtinEntities,
    },
  ];
}

function registerOuterRingBase(workspace: WorkspaceContract): void {
  workspace.registry.baseDefinitions = [
    ...workspace.registry.baseDefinitions,
    {
      id: TEST_OUTER_RING_BASE_ID,
      name: "测试扩展范围基地",
      placeableArea: { width: 10, height: 10 },
      outerRing: { top: 5, right: 5, bottom: 5, left: 5 },
      tag: "测试",
    },
  ];
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("placement validation", () => {
  it("registers default placement behavior on every entity definition", () => {
    const registry = createRegistryContract();

    expect(registry.entityDefinitions.every((definition) =>
      definition.placementBehaviors.some((behavior) =>
        behavior.type === PLACEMENT_BEHAVIOR_TYPE.defaultPlacement,
      ),
    )).toBe(true);
  });

  it("caches ordered placement reasons and keeps invalid placement placeable", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithEntities([
      createEntity("existing-machine", "item_port_grinder_1", -1, 0),
      createEntity("outside-belt", "belt_straight_1x1", -1, 0),
    ]);

    editorHost.internalDocument.setSnapshot(document);

    expect(
      editorHost.state.collections[EntityCollectionType.invalidPlacement],
    ).toEqual(["existing-machine", "outside-belt"]);
    expect(
      editorHost.queries.getEntityPlacementValidation("outside-belt").reasons.map((reason) =>
        reason.code,
      ),
    ).toEqual(["outside-base", "overlap"]);
    expect(
      editorHost.queries.getEntityPlacementValidation("outside-belt").canPlace,
    ).toBe(false);

    editorHost.actions.createSinglePlacementDraft("item_port_grinder_1", { x: 0, y: 0 });
    const draftId = editorHost.state.collections[EntityCollectionType.preview][0];

    expect(draftId).toBeDefined();
    expect(
      editorHost.state.collections[EntityCollectionType.invalidPlacement].contains(draftId ?? ""),
    ).toBe(true);
    expect(editorHost.actions.applyPlacementDraft()).toBe(true);

    const finalId = draftId?.startsWith("placement-draft:")
      ? draftId.slice("placement-draft:".length)
      : draftId;

    expect(finalId).toBeDefined();
    expect(
      editorHost.document.getSnapshot().entities[finalId ?? ""],
    ).toBeDefined();
    expect(
      editorHost.state.collections[EntityCollectionType.invalidPlacement].contains(finalId ?? ""),
    ).toBe(true);
  });

  it("allows configured devices and dedicated pipes to overlap without invalidating either device", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithEntities([
      createEntity("belt", "belt_straight_1x1", 0, 0),
      createEntity("pipe", "pipe_straight_1x1", 0, 0),
    ]);

    editorHost.internalDocument.setSnapshot(document);

    expect(editorHost.state.collections[EntityCollectionType.invalidPlacement]).toEqual([]);
    expect(editorHost.queries.getEntityPlacementValidation("belt").canPlace).toBe(true);
    expect(editorHost.queries.getEntityPlacementValidation("pipe").canPlace).toBe(true);
  });

  it("blocks single device drafts outside the base outer ring", () => {
    const workspace = createWorkspace();
    registerOuterRingBase(workspace);
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDocumentWithEntities([], TEST_OUTER_RING_BASE_ID));
    editorHost.actions.createSinglePlacementDraft("item_port_grinder_1", { x: -5, y: 5 });

    const draftId = editorHost.state.collections[EntityCollectionType.preview][0];
    expect(draftId).toBeDefined();
    expect(
      editorHost.queries.getEntityPlacementValidation(draftId ?? "").reasons.map((reason) =>
        reason.code,
      ),
    ).toEqual(["outside-base"]);
    expect(editorHost.actions.applyPlacementDraft()).toBe(false);
    expect(editorHost.document.getSnapshot().entityOrder).toEqual([]);
  });

  it("allows dedicated pipes outside placeableArea but inside the base outer ring", () => {
    const workspace = createWorkspace();
    registerOuterRingBase(workspace);
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDocumentWithEntities([], TEST_OUTER_RING_BASE_ID));
    editorHost.actions.createSinglePlacementDraft("pipe_straight_1x1", { x: -4, y: 5 });

    const draftId = editorHost.state.collections[EntityCollectionType.preview][0];
    expect(draftId).toBeDefined();
    expect(editorHost.queries.getEntityPlacementValidation(draftId ?? "").canPlace).toBe(true);
    expect(editorHost.actions.applyPlacementDraft()).toBe(true);
    expect(editorHost.document.getSnapshot().entityOrder).toHaveLength(1);
  });

  it("keeps 1x1 overlap invalid so the renderer can show only the red frame", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithEntities([
      createEntity("belt", "belt_straight_1x1", 0, 0),
      createEntity("machine", "item_port_grinder_1", 0, 0),
    ]);

    editorHost.internalDocument.setSnapshot(document);

    expect(
      editorHost.state.collections[EntityCollectionType.invalidPlacement].contains("belt"),
    ).toBe(true);
    expect(
      editorHost.queries.getEntityPlacementValidation("belt").reasons.map((reason) =>
        reason.code,
      ),
    ).toEqual(["overlap"]);
  });

  it("lists base builtin entities for rendering and invalidates only overlapping document entities", () => {
    const workspace = createWorkspace();
    const builtinEntityId = buildBaseBuiltinEntityId({
      baseId: TEST_BUILTIN_BASE_ID,
      builtinEntityId: "source",
    });
    registerBuiltinBase(workspace, [
      {
        id: "source",
        definitionId: "item_port_log_hongs_bus_source",
        position: { x: 0, y: 0 },
        rotation: 0,
      },
    ]);
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithEntities([
      createEntity("overlapping-machine", "item_port_grinder_1", 0, 0),
    ], TEST_BUILTIN_BASE_ID);

    editorHost.internalDocument.setSnapshot(document);

    expect(editorHost.document.getSnapshot().entities[builtinEntityId]).toBeUndefined();
    expect(editorHost.queries.listEntities().map((entity) => entity.id)).toContain(
      builtinEntityId,
    );
    expect(
      editorHost.state.collections[EntityCollectionType.invalidPlacement],
    ).toEqual(["overlapping-machine"]);
    expect(
      editorHost.queries.getEntityPlacementValidation("overlapping-machine").reasons.map(
        (reason) => reason.code,
      ),
    ).toEqual(["overlap"]);
    expect(editorHost.queries.getEntityPlacementValidation(builtinEntityId).canPlace).toBe(true);
  });

  it("uses base builtin warehouse bus sources when validating document bus segments", () => {
    const workspace = createWorkspace();
    registerBuiltinBase(workspace, [
      {
        id: "source",
        definitionId: "item_port_log_hongs_bus_source",
        position: { x: 0, y: 0 },
        rotation: 0,
      },
    ]);
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithEntities([
      createEntity("segment", "item_port_log_hongs_bus", 4, 0),
      createEntity("loader", "item_port_loader_1", 8, 0),
      createEntity("isolated-unloader", "item_port_unloader_1", 20, 20),
    ], TEST_BUILTIN_BASE_ID);

    editorHost.internalDocument.setSnapshot(document);

    expect(editorHost.queries.getEntityPlacementValidation("segment").canPlace).toBe(true);
    expect(editorHost.queries.getEntityPlacementValidation("loader").canPlace).toBe(true);
    expect(
      editorHost.queries.getEntityPlacementValidation("isolated-unloader").reasons.map(
        (reason) => reason.code,
      ),
    ).toEqual(["warehouse-bus-disconnected"]);
  });

  it("resolves base builtin device ports as logistics endpoints", () => {
    const workspace = createWorkspace();
    const builtinEntityId = buildBaseBuiltinEntityId({
      baseId: TEST_BUILTIN_BASE_ID,
      builtinEntityId: "storage",
    });
    registerBuiltinBase(workspace, [
      {
        id: "storage",
        definitionId: "item_port_storager_1",
        position: { x: 0, y: 0 },
        rotation: 0,
      },
    ]);
    const editorHost = createEditorHost(workspace);

    editorHost.internalDocument.setSnapshot(createDocumentWithEntities([], TEST_BUILTIN_BASE_ID));

    const endpoint = editorHost.queries.findLogisticsDraftEndpointAtGridPoint(
      { x: 1, y: 0 },
      "belt",
    );

    expect(endpoint).toMatchObject({
      type: "device-port",
      entityId: builtinEntityId,
      portDirection: "output",
    });
    expect(editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "device",
        entityId: builtinEntityId,
        pointerGridPoint: { x: 1, y: 0 },
      },
    }).sourceEntityId).toBe(builtinEntityId);
  });

  it("validates warehouse bus connection by footprint edge adjacency", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithEntities([
      createEntity("source", "item_port_log_hongs_bus_source", 0, 0),
      createEntity("segment", "item_port_log_hongs_bus", 4, 0),
      createEntity("loader", "item_port_loader_1", 8, 0),
      createEntity("isolated-unloader", "item_port_unloader_1", 20, 20),
    ]);

    editorHost.internalDocument.setSnapshot(document);

    expect(editorHost.queries.getEntityPlacementValidation("segment").canPlace).toBe(true);
    expect(editorHost.queries.getEntityPlacementValidation("loader").canPlace).toBe(true);
    expect(
      editorHost.queries.getEntityPlacementValidation("isolated-unloader").reasons.map((reason) =>
        reason.code,
      ),
    ).toEqual(["warehouse-bus-disconnected"]);
    expect(
      editorHost.state.collections[EntityCollectionType.invalidPlacement],
    ).toEqual(["isolated-unloader"]);
  });

  // ---- 物流设备放置替换 (同族替换) ----

  it("allows placement-draft over same-family belt logistics device without overlap error", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithEntities([
      createEntity("existing-belt", "belt_straight_1x1", 5, 5),
    ]);

    editorHost.internalDocument.setSnapshot(document);

    // 在相同位置放置 item_log_connector（同族 BeltFamily）
    editorHost.actions.createSinglePlacementDraft("item_log_connector", { x: 5, y: 5 });
    const draftId = editorHost.state.collections[EntityCollectionType.preview][0];

    expect(draftId).toBeDefined();
    // 预览 draft 不应在 invalidPlacement 中
    expect(
      editorHost.state.collections[EntityCollectionType.invalidPlacement].contains(draftId ?? ""),
    ).toBe(false);
    // 原有 belt 也不应在 invalidPlacement 中（被替换放行）
    expect(
      editorHost.state.collections[EntityCollectionType.invalidPlacement].contains("existing-belt"),
    ).toBe(false);
  });

  it("allows placement-draft over same-family pipe logistics device without overlap error", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithEntities([
      createEntity("existing-pipe", "pipe_straight_1x1", 3, 3),
    ]);

    editorHost.internalDocument.setSnapshot(document);

    // 在相同位置放置 item_pipe_connector（同族 PipeFamily）
    editorHost.actions.createSinglePlacementDraft("item_pipe_connector", { x: 3, y: 3 });
    const draftId = editorHost.state.collections[EntityCollectionType.preview][0];

    expect(draftId).toBeDefined();
    expect(
      editorHost.state.collections[EntityCollectionType.invalidPlacement].contains(draftId ?? ""),
    ).toBe(false);
    expect(
      editorHost.state.collections[EntityCollectionType.invalidPlacement].contains("existing-pipe"),
    ).toBe(false);
  });

  it("replaces existing same-family belt entity on applyPlacementDraft", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithEntities([
      createEntity("belt-to-replace", "belt_straight_1x1", 5, 5),
    ]);

    editorHost.internalDocument.setSnapshot(document);

    editorHost.actions.createSinglePlacementDraft("item_log_connector", { x: 5, y: 5 });
    expect(editorHost.actions.applyPlacementDraft()).toBe(true);

    const finalDoc = editorHost.document.getSnapshot();

    // 旧 belt 被删除
    expect(finalDoc.entities["belt-to-replace"]).toBeUndefined();
    // 新 connector 存在
    const connectorEntity = Object.values(finalDoc.entities).find(
      (entity) => entity.definitionId === "item_log_connector",
    );
    expect(connectorEntity).toBeDefined();
    expect(connectorEntity?.position).toEqual({ x: 5, y: 5 });
  });

  it("replaces existing same-family pipe entity on applyPlacementDraft", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithEntities([
      createEntity("pipe-to-replace", "pipe_straight_1x1", 3, 3),
    ]);

    editorHost.internalDocument.setSnapshot(document);

    editorHost.actions.createSinglePlacementDraft("item_pipe_connector", { x: 3, y: 3 });
    expect(editorHost.actions.applyPlacementDraft()).toBe(true);

    const finalDoc = editorHost.document.getSnapshot();

    expect(finalDoc.entities["pipe-to-replace"]).toBeUndefined();
    const connectorEntity = Object.values(finalDoc.entities).find(
      (entity) => entity.definitionId === "item_pipe_connector",
    );
    expect(connectorEntity).toBeDefined();
    expect(connectorEntity?.position).toEqual({ x: 3, y: 3 });
  });

  it("allows same-family logistics-to-logistics replacement (connector over splitter)", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithEntities([
      createEntity("my-splitter", "item_log_splitter", 5, 5),
    ]);

    editorHost.internalDocument.setSnapshot(document);

    editorHost.actions.createSinglePlacementDraft("item_log_connector", { x: 5, y: 5 });
    const draftId = editorHost.state.collections[EntityCollectionType.preview][0];

    expect(draftId).toBeDefined();
    expect(
      editorHost.state.collections[EntityCollectionType.invalidPlacement].contains(draftId ?? ""),
    ).toBe(false);
    expect(editorHost.actions.applyPlacementDraft()).toBe(true);

    const finalDoc = editorHost.document.getSnapshot();
    expect(finalDoc.entities["my-splitter"]).toBeUndefined();
    expect(
      Object.values(finalDoc.entities).some((e) => e.definitionId === "item_log_connector"),
    ).toBe(true);
  });

  it("does NOT allow cross-family replacement: PipeFamily over BeltFamily", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithEntities([
      createEntity("belt", "belt_straight_1x1", 5, 5),
    ]);

    editorHost.internalDocument.setSnapshot(document);

    // PipeFamily 的 connector 放到 BeltFamily 的 belt 上（管道设备没有 allowPipeOverlap）
    editorHost.actions.createSinglePlacementDraft("item_pipe_connector", { x: 5, y: 5 });
    const draftId = editorHost.state.collections[EntityCollectionType.preview][0];

    expect(draftId).toBeDefined();
    // 跨族应仍然报 overlap
    expect(
      editorHost.state.collections[EntityCollectionType.invalidPlacement].contains(draftId ?? ""),
    ).toBe(true);
    expect(
      editorHost.queries.getEntityPlacementValidation(draftId ?? "").reasons.map((r) => r.code),
    ).toEqual(["overlap"]);

    // 即使强行 apply，也不应删除旧实体
    editorHost.actions.applyPlacementDraft();
    const finalDoc = editorHost.document.getSnapshot();
    expect(finalDoc.entities["belt"]).toBeDefined();
  });

  it("does NOT allow replacement when draft is placed on non-family entity", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithEntities([
      createEntity("machine", "item_port_grinder_1", 5, 5),
    ]);

    editorHost.internalDocument.setSnapshot(document);

    editorHost.actions.createSinglePlacementDraft("item_log_connector", { x: 5, y: 5 });
    const draftId = editorHost.state.collections[EntityCollectionType.preview][0];

    expect(draftId).toBeDefined();
    // grinder 没有 BeltFamily / PipeFamily，仍报 overlap
    expect(
      editorHost.state.collections[EntityCollectionType.invalidPlacement].contains(draftId ?? ""),
    ).toBe(true);
    expect(
      editorHost.queries.getEntityPlacementValidation(draftId ?? "").reasons.map((r) => r.code),
    ).toEqual(["overlap"]);
  });

  it("removes slotLinks pointing to replaced entity on applyPlacementDraft", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithEntities([
      createEntity("belt-to-replace", "belt_straight_1x1", 5, 5),
    ]);

    // 手动写入指向该 belt 的 slotLink
    editorHost.internalDocument.setSnapshot({
      ...document,
      slotLinks: [
        {
          id: "link-1",
          linkType: "share-all",
          source: { entityId: "belt-to-replace", storageSlotGroupId: "g", slotId: "s" },
          target: { entityId: "other-entity", storageSlotGroupId: "g2", slotId: "s2" },
        },
      ],
    });

    editorHost.actions.createSinglePlacementDraft("item_log_connector", { x: 5, y: 5 });
    expect(editorHost.actions.applyPlacementDraft()).toBe(true);

    const finalDoc = editorHost.document.getSnapshot();

    expect(finalDoc.entities["belt-to-replace"]).toBeUndefined();
    // slotLink 指向被替换实体，应被移除
    expect(finalDoc.slotLinks).toHaveLength(0);
  });
});
