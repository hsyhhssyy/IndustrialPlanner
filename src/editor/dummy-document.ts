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
    entities: {},
    entityOrder: [],
    explicitLinks: [],
    documentSettings: {
      gridSize: 1,
      showDiagnostics: false,
    },
  };
}