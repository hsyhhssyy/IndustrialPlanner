import { DEFAULT_STAGE1_BASE_ID } from "@/domain/base/stage1-bases";
import type {
  WorldDocument,
  WorldEntity,
} from "@/domain/document/world-document";

const STAGE1_BOOTSTRAP_TIMESTAMP = "2026-03-30T00:00:00.000Z";

export function createStage1SeedWorldDocument(): WorldDocument {
  const entities: Record<string, WorldEntity> = {
    "storage-1": {
      id: "storage-1",
      definitionId: "item_port_storager_1",
      position: { x: 3, y: 4 },
      rotation: 0,
      config: {
        submitToWarehouse: true,
      },
      tags: ["stage1-seed"],
    },
    "bus-source-1": {
      id: "bus-source-1",
      definitionId: "item_port_log_hongs_bus_source",
      position: { x: 7, y: 4 },
      rotation: 0,
      config: {},
      tags: ["stage1-seed"],
    },
    "reactor-1": {
      id: "reactor-1",
      definitionId: "item_port_mix_pool_1",
      position: { x: 12, y: 6 },
      rotation: 0,
      config: {
        selectedRecipeIds: [
          "r_mix_pool_liquid_plant_grass_2_from_powder_and_water_basic",
        ],
      },
      tags: ["stage1-seed"],
    },
    "filler-1": {
      id: "filler-1",
      definitionId: "item_port_liquid_filling_pd_mc_1",
      position: { x: 18, y: 6 },
      rotation: 90,
      config: {},
      tags: ["stage1-seed"],
    },
    "dark-outlet-1": {
      id: "dark-outlet-1",
      definitionId: "item_port_udpipe_unloader_1",
      position: { x: 12, y: 2 },
      rotation: 180,
      config: {
        selectedLiquidItemId: "item_liquid_water",
      },
      tags: ["stage1-seed"],
    },
  };

  return {
    schemaVersion: 2,
    baseId: DEFAULT_STAGE1_BASE_ID,
    meta: {
      id: "stage1-seed",
      name: "Stage1 Scaffold Seed",
      createdAt: STAGE1_BOOTSTRAP_TIMESTAMP,
      updatedAt: STAGE1_BOOTSTRAP_TIMESTAMP,
    },
    entities,
    entityOrder: Object.keys(entities),
    explicitLinks: [],
    documentSettings: {
      gridSize: 56,
      showDiagnostics: true,
    },
  };
}
