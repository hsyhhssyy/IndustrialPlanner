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
import { PLACEMENT_BEHAVIOR_TYPE } from "@/domain/registry/types/entity-placement-behavior";
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
): WorldDocument {
  return {
    ...createWorldDocument(),
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    entityOrder: entities.map((entity) => entity.id),
  };
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
