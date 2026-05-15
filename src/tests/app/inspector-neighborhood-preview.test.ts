import { describe, expect, it } from "vitest";

import { resolveInspectorNeighborhoodPreviewModel } from "@/app/shell/inspector/inspector-neighborhood-preview-model";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import { DEFAULT_WORLD_BASE_ID } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";

function createEntityDefinition(options: {
  id: string;
  width: number;
  height: number;
}): EntityDefinition {
  return {
    id: options.id,
    nameKey: options.id,
    spriteId: options.id,
    footprint: {
      width: options.width,
      height: options.height,
    },
    uiGroup: "hidden",
    tags: [],
    requiresPower: false,
    powerDemand: 0,
    inspectors: [],
    portGroups: [],
    storageSlotGroups: [],
    recipeChannels: [],
    portStorageBindings: [],
    links: [],
  };
}

function createEntity(options: {
  id: string;
  definitionId: string;
  x: number;
  y: number;
  rotation?: WorldEntity["rotation"];
}): WorldEntity {
  return {
    id: options.id,
    definitionId: options.definitionId,
    position: {
      x: options.x,
      y: options.y,
    },
    rotation: options.rotation ?? 0,
    config: {},
    tags: [],
  };
}

function createWorldDocument(entities: WorldEntity[]): WorldDocument {
  return {
    schemaVersion: 1,
    documentKey: "inspector-neighborhood-preview-test",
    baseId: DEFAULT_WORLD_BASE_ID,
    meta: {
      id: "inspector-neighborhood-preview-test",
      name: "Inspector Neighborhood Preview Test",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    entityOrder: entities.map((entity) => entity.id),
    slotLinks: [],
    documentSettings: {
      viewport: {
        center: {
          x: 0,
          y: 0,
        },
        gridSize: 1,
      },
    },
  };
}

describe("resolveInspectorNeighborhoodPreviewModel", () => {
  it("uses the rotated selected footprint expanded by four cells as the preview bounds", () => {
    const selectedDefinition = createEntityDefinition({ id: "selected-definition", width: 2, height: 3 });
    const entityDefinitionMap = new Map([
      [selectedDefinition.id, selectedDefinition],
    ]);
    const selectedEntity = createEntity({
      id: "selected",
      definitionId: selectedDefinition.id,
      x: 10,
      y: 20,
      rotation: 90,
    });
    const model = resolveInspectorNeighborhoodPreviewModel({
      document: createWorldDocument([selectedEntity]),
      entityDefinitionMap,
      selectedEntityId: selectedEntity.id,
    });

    expect(model?.bounds).toEqual({
      left: 6,
      top: 16,
      width: 11,
      height: 10,
    });
    expect(model?.highlightedEntityId).toBe("selected");
  });

  it("includes entities intersecting the cropped region and excludes border-touching outsiders", () => {
    const selectedDefinition = createEntityDefinition({ id: "selected-definition", width: 2, height: 3 });
    const oneByOneDefinition = createEntityDefinition({ id: "one-by-one", width: 1, height: 1 });
    const partialDefinition = createEntityDefinition({ id: "partial", width: 2, height: 2 });
    const entityDefinitionMap = new Map([
      [selectedDefinition.id, selectedDefinition],
      [oneByOneDefinition.id, oneByOneDefinition],
      [partialDefinition.id, partialDefinition],
    ]);
    const selectedEntity = createEntity({
      id: "selected",
      definitionId: selectedDefinition.id,
      x: 10,
      y: 20,
      rotation: 90,
    });
    const partialEntity = createEntity({
      id: "partial-left",
      definitionId: partialDefinition.id,
      x: 5,
      y: 18,
    });
    const insideEntity = createEntity({
      id: "inside-bottom-right",
      definitionId: oneByOneDefinition.id,
      x: 16,
      y: 25,
    });
    const outsideEntity = createEntity({
      id: "outside-right-border",
      definitionId: oneByOneDefinition.id,
      x: 17,
      y: 25,
    });
    const model = resolveInspectorNeighborhoodPreviewModel({
      document: createWorldDocument([
        selectedEntity,
        partialEntity,
        insideEntity,
        outsideEntity,
      ]),
      entityDefinitionMap,
      selectedEntityId: selectedEntity.id,
    });

    expect(model?.entities.map((entry) => entry.entity.id)).toEqual([
      "selected",
      "partial-left",
      "inside-bottom-right",
    ]);
  });
});