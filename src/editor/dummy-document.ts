import type { WorldDocument } from "@/domain/entity/world-document";

export function createDummyWorldDocument(): WorldDocument {
  return {
    schemaVersion: 1,
    baseId: "dummy-world",
    meta: {
      id: "dummy-world",
      name: "Dummy World",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    entities: {
      "dummy-entity-1": {
        id: "dummy-entity-1",
        definitionId: "belt_straight_1x1",
        position: {
          x: 12,
          y: 8,
        },
        rotation: 0,
        config: {},
        tags: [],
      },
    },
    entityOrder: ["dummy-entity-1"],
    explicitLinks: [],
    documentSettings: {
      gridSize: 1,
      showDiagnostics: false,
    },
  };
}