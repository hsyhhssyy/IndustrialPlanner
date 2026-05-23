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
});
