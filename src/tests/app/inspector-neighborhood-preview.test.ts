import { describe, expect, it } from "vitest";

import { resolveInspectorPortOutputCallouts } from "@/app/shell/inspector/inspector-neighborhood-preview";
import { resolveInspectorNeighborhoodPreviewModel } from "@/app/shell/inspector/inspector-neighborhood-preview-model";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import { DEFAULT_WORLD_BASE_ID } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";
import { createRegistryContract } from "@/registry";

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
    displayOrder: 100,
    tags: [],
    requiresPower: false,
    powerDemand: 0,
    inspectors: [],
    placementBehaviors: [],
    portGroups: [],
    storageSlotGroups: [],
    recipeChannels: [],
    portStorageBindings: [],
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
    schemaVersion: 3,
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
      powerMode: "real" as const,
      viewport: {
        center: {
          x: 0,
          y: 0,
        },
        gridSize: 1,
        displayRotation: 0,
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

  it("resolves output port callouts for expanded reaction pool", () => {
    const registry = createRegistryContract();
    const selectedDefinition = registry.entityDefinitions.find((definition) =>
      definition.id === "mix_pool_2",
    );
    if (selectedDefinition === undefined) {
      throw new Error("Expected expanded reaction pool definition.");
    }

    const selectedEntity = createEntity({
      id: "selected",
      definitionId: selectedDefinition.id,
      x: 10,
      y: 20,
    });
    const document = createWorldDocument([selectedEntity]);
    const entityDefinitionMap = new Map([
      [selectedDefinition.id, selectedDefinition],
    ]);
    const previewModel = resolveInspectorNeighborhoodPreviewModel({
      document,
      entityDefinitionMap,
      selectedEntityId: selectedEntity.id,
    });
    if (previewModel === null) {
      throw new Error("Expected preview model.");
    }

    const callouts = resolveInspectorPortOutputCallouts({
      bounds: previewModel.bounds,
      document,
      entityDefinitionMap,
      height: 260,
      selectedEntityId: selectedEntity.id,
      width: 280,
    });

    expect(callouts.map((callout) => callout.label)).toEqual(["P1", "P2", "P3"]);
    expect(callouts.map((callout) => callout.portKind)).toEqual(["item", "fluid", "fluid"]);
    expect(callouts.find((callout) => callout.id === "item_output")?.markerPoints.length).toBe(4);
    const itemOutput = callouts.find((callout) => callout.id === "item_output");
    expect(itemOutput?.labelY).toBeLessThan(itemOutput?.targetY ?? 0);
    const fluidOutputA = callouts.find((callout) => callout.id === "fluid_output_a");
    expect(fluidOutputA?.labelX).toBeLessThan(fluidOutputA?.targetX ?? 0);
  });

  it("resolves output port callouts for protocol core warehouse links", () => {
    const registry = createRegistryContract();
    const selectedDefinition = registry.entityDefinitions.find((definition) =>
      definition.id === "sp_hub_1",
    );
    if (selectedDefinition === undefined) {
      throw new Error("Expected protocol core definition.");
    }

    expect(selectedDefinition.inspectors.some((inspector) =>
      inspector.type === INSPECTOR_TYPE.portOutputConfig,
    )).toBe(false);
    expect(selectedDefinition.inspectors.filter((inspector) =>
      inspector.type === INSPECTOR_TYPE.warehouseItemLink,
    )).toHaveLength(1);

    const selectedEntity = createEntity({
      id: "selected",
      definitionId: selectedDefinition.id,
      x: 10,
      y: 20,
    });
    const document = createWorldDocument([selectedEntity]);
    const entityDefinitionMap = new Map([
      [selectedDefinition.id, selectedDefinition],
    ]);
    const previewModel = resolveInspectorNeighborhoodPreviewModel({
      document,
      entityDefinitionMap,
      selectedEntityId: selectedEntity.id,
    });
    if (previewModel === null) {
      throw new Error("Expected preview model.");
    }

    const callouts = resolveInspectorPortOutputCallouts({
      bounds: previewModel.bounds,
      document,
      entityDefinitionMap,
      height: 260,
      selectedEntityId: selectedEntity.id,
      width: 280,
    });

    expect(callouts.map((callout) => callout.id)).toEqual([
      "item_output_w2",
      "item_output_w5",
      "item_output_w8",
      "item_output_e2",
      "item_output_e5",
      "item_output_e8",
    ]);
    expect(callouts.map((callout) => callout.label)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6"]);
    expect(callouts.map((callout) => callout.portKind)).toEqual([
      "item",
      "item",
      "item",
      "item",
      "item",
      "item",
    ]);
    expect(callouts.every((callout) => callout.markerPoints.length === 1)).toBe(true);
  });

  it("resolves per-port priority callouts when custom priority groups are enabled", () => {
    const registry = createRegistryContract();
    const selectedDefinition = registry.entityDefinitions.find((definition) =>
      definition.id === "log_splitter",
    );
    if (selectedDefinition === undefined) {
      throw new Error("Expected splitter definition.");
    }

    const selectedEntity: WorldEntity = {
      ...createEntity({
        id: "selected",
        definitionId: selectedDefinition.id,
        x: 10,
        y: 20,
      }),
      config: {
        customPortPriorityGroups: true,
        portPriorityGroups: {
          "item_output:out_w": 1,
        },
      },
    };
    const document = createWorldDocument([selectedEntity]);
    const entityDefinitionMap = new Map([
      [selectedDefinition.id, selectedDefinition],
    ]);
    const previewModel = resolveInspectorNeighborhoodPreviewModel({
      document,
      entityDefinitionMap,
      selectedEntityId: selectedEntity.id,
    });
    if (previewModel === null) {
      throw new Error("Expected preview model.");
    }

    const callouts = resolveInspectorPortOutputCallouts({
      bounds: previewModel.bounds,
      document,
      entityDefinitionMap,
      height: 260,
      selectedEntityId: selectedEntity.id,
      width: 280,
    });

    expect(callouts.map((callout) => callout.id)).toEqual([
      "item_output:out_e",
      "item_output:out_w",
      "item_output:out_s",
      "item_input:in_n",
    ]);
    expect(callouts.map((callout) => callout.label)).toEqual([
      "P1.1-G5",
      "P1.2-G1",
      "P1.3-G5",
      "P2.1-G5",
    ]);
    expect(callouts.every((callout) => callout.markerPoints.length === 1)).toBe(true);
  });

  it("does not render splitter port callouts when custom priority groups are off", () => {
    const registry = createRegistryContract();
    const selectedDefinition = registry.entityDefinitions.find((definition) =>
      definition.id === "log_splitter",
    );
    if (selectedDefinition === undefined) {
      throw new Error("Expected splitter definition.");
    }

    const selectedEntity = createEntity({
      id: "selected",
      definitionId: selectedDefinition.id,
      x: 10,
      y: 20,
    });
    const document = createWorldDocument([selectedEntity]);
    const entityDefinitionMap = new Map([
      [selectedDefinition.id, selectedDefinition],
    ]);
    const previewModel = resolveInspectorNeighborhoodPreviewModel({
      document,
      entityDefinitionMap,
      selectedEntityId: selectedEntity.id,
    });
    if (previewModel === null) {
      throw new Error("Expected preview model.");
    }

    const callouts = resolveInspectorPortOutputCallouts({
      bounds: previewModel.bounds,
      document,
      entityDefinitionMap,
      height: 260,
      selectedEntityId: selectedEntity.id,
      width: 280,
    });

    expect(callouts).toEqual([]);
  });
});
