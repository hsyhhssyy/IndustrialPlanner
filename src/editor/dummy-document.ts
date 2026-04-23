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
      "dummy-entity-2": {
        id: "dummy-entity-2",
        definitionId: "item_port_storager_1",
        position: {
          x: 4,
          y: 4,
        },
        rotation: 0,
        config: {},
        tags: [],
      },
      "dummy-entity-3": {
        id: "dummy-entity-3",
        definitionId: "item_port_grinder_1",
        position: {
          x: 10,
          y: 4,
        },
        rotation: 0,
        config: {},
        tags: [],
      },
      "dummy-entity-4": {
        id: "dummy-entity-4",
        definitionId: "item_port_mix_pool_1",
        position: {
          x: 16,
          y: 3,
        },
        rotation: 0,
        config: {},
        tags: [],
      },
      "dummy-entity-5": {
        id: "dummy-entity-5",
        definitionId: "item_port_liquid_filling_pd_mc_1",
        position: {
          x: 24,
          y: 4,
        },
        rotation: 0,
        config: {},
        tags: [],
      },
      "dummy-entity-6": {
        id: "dummy-entity-6",
        definitionId: "item_log_splitter",
        position: {
          x: 14,
          y: 10,
        },
        rotation: 90,
        config: {},
        tags: [],
      },
      "dummy-entity-7": {
        id: "dummy-entity-7",
        definitionId: "pipe_straight_1x1",
        position: {
          x: 20,
          y: 11,
        },
        rotation: 0,
        config: {},
        tags: [],
      },
      "dummy-entity-8": {
        id: "dummy-entity-8",
        definitionId: "item_port_udpipe_loader_1",
        position: {
          x: 26,
          y: 10,
        },
        rotation: 180,
        config: {},
        tags: [],
      },
    },
    entityOrder: [
      "dummy-entity-2",
      "dummy-entity-3",
      "dummy-entity-4",
      "dummy-entity-5",
      "dummy-entity-1",
      "dummy-entity-6",
      "dummy-entity-7",
      "dummy-entity-8",
    ],
    explicitLinks: [],
    documentSettings: {
      gridSize: 1,
      showDiagnostics: false,
    },
  };
}