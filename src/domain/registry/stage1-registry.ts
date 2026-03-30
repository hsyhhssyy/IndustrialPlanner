import type { ConfigMutability } from "@/editor/core/command-types";

export type Stage1Medium = "solid" | "liquid";

export interface Stage1ConfigField {
  key: string;
  label: string;
  mutability: ConfigMutability;
}

export interface Stage1EntityDefinition {
  id: string;
  name: string;
  category:
    | "storage"
    | "bus"
    | "logistics"
    | "processor"
    | "track"
    | "dark-pipe";
  footprint: {
    width: number;
    height: number;
  };
  capabilityIds: string[];
  configFields: Stage1ConfigField[];
}

export interface Stage1ItemDefinition {
  id: string;
  name: string;
  medium: Stage1Medium;
  tags: string[];
}

export interface Stage1RecipeDefinition {
  id: string;
  name: string;
  durationSeconds: number;
  inputs: Array<{ itemId: string; amount: number }>;
  outputs: Array<{ itemId: string; amount: number }>;
}

export interface Stage1Registry {
  entityDefinitions: Stage1EntityDefinition[];
  itemDefinitions: Stage1ItemDefinition[];
  recipeDefinitions: Stage1RecipeDefinition[];
}

export const STAGE1_ENTITY_DEFINITIONS: Stage1EntityDefinition[] = [
  {
    id: "item_port_storager_1",
    name: "Protocol Storage Box",
    category: "storage",
    footprint: { width: 2, height: 2 },
    capabilityIds: ["footprint", "inventory-buffer", "warehouse-attachment"],
    configFields: [
      {
        key: "submitToWarehouse",
        label: "Submit To Warehouse",
        mutability: "runtime-mutable",
      },
    ],
  },
  {
    id: "item_port_log_hongs_bus",
    name: "Warehouse Bus Segment",
    category: "bus",
    footprint: { width: 1, height: 1 },
    capabilityIds: ["footprint", "warehouse-bus"],
    configFields: [],
  },
  {
    id: "item_port_log_hongs_bus_source",
    name: "Warehouse Bus Source",
    category: "bus",
    footprint: { width: 1, height: 1 },
    capabilityIds: ["footprint", "warehouse-bus", "warehouse-source"],
    configFields: [],
  },
  {
    id: "item_port_unloader_1",
    name: "Pickup Port",
    category: "logistics",
    footprint: { width: 2, height: 2 },
    capabilityIds: ["footprint", "port-schema", "warehouse-pickup"],
    configFields: [
      {
        key: "pickupIgnoreInventory",
        label: "Ignore Source Inventory",
        mutability: "runtime-mutable",
      },
    ],
  },
  {
    id: "item_port_mix_pool_1",
    name: "Reactor Pool",
    category: "processor",
    footprint: { width: 5, height: 5 },
    capabilityIds: [
      "footprint",
      "port-schema",
      "recipe-processor",
      "parallel-recipe",
      "shared-slot-pool",
      "power-behavior",
    ],
    configFields: [
      {
        key: "selectedRecipeIds",
        label: "Selected Recipes",
        mutability: "runtime-mutable",
      },
      {
        key: "outputRoutes",
        label: "Output Routes",
        mutability: "runtime-mutable",
      },
    ],
  },
  {
    id: "item_port_grinder_1",
    name: "Grinder",
    category: "processor",
    footprint: { width: 3, height: 3 },
    capabilityIds: [
      "footprint",
      "port-schema",
      "recipe-processor",
      "power-behavior",
    ],
    configFields: [],
  },
  {
    id: "item_port_liquid_filling_pd_mc_1",
    name: "Liquid Filling Machine",
    category: "processor",
    footprint: { width: 3, height: 3 },
    capabilityIds: [
      "footprint",
      "port-schema",
      "recipe-processor",
      "power-behavior",
    ],
    configFields: [],
  },
  {
    id: "belt_straight_1x1",
    name: "Belt Straight",
    category: "track",
    footprint: { width: 1, height: 1 },
    capabilityIds: ["footprint", "conveyor-track"],
    configFields: [],
  },
  {
    id: "item_log_splitter",
    name: "Belt Splitter",
    category: "track",
    footprint: { width: 1, height: 1 },
    capabilityIds: ["footprint", "conveyor-track", "splitter"],
    configFields: [],
  },
  {
    id: "item_log_converger",
    name: "Belt Converger",
    category: "track",
    footprint: { width: 1, height: 1 },
    capabilityIds: ["footprint", "conveyor-track", "converger"],
    configFields: [],
  },
  {
    id: "item_log_connector",
    name: "Belt Bridge",
    category: "track",
    footprint: { width: 1, height: 1 },
    capabilityIds: ["footprint", "conveyor-track", "bridge-isolation"],
    configFields: [],
  },
  {
    id: "pipe_straight_1x1",
    name: "Pipe Straight",
    category: "track",
    footprint: { width: 1, height: 1 },
    capabilityIds: ["footprint", "pipe-track"],
    configFields: [],
  },
  {
    id: "item_pipe_splitter",
    name: "Pipe Splitter",
    category: "track",
    footprint: { width: 1, height: 1 },
    capabilityIds: ["footprint", "pipe-track", "splitter"],
    configFields: [],
  },
  {
    id: "item_pipe_converger",
    name: "Pipe Converger",
    category: "track",
    footprint: { width: 1, height: 1 },
    capabilityIds: ["footprint", "pipe-track", "converger"],
    configFields: [],
  },
  {
    id: "item_pipe_connector",
    name: "Pipe Bridge",
    category: "track",
    footprint: { width: 1, height: 1 },
    capabilityIds: ["footprint", "pipe-track", "bridge-isolation"],
    configFields: [],
  },
  {
    id: "item_port_udpipe_loader_1",
    name: "Dark Pipe Inlet",
    category: "dark-pipe",
    footprint: { width: 2, height: 2 },
    capabilityIds: [
      "footprint",
      "port-schema",
      "device-link-source",
      "liquid-destroy-or-forward",
    ],
    configFields: [
      {
        key: "targetEntityId",
        label: "Linked Outlet",
        mutability: "recompile-required",
      },
    ],
  },
  {
    id: "item_port_udpipe_unloader_1",
    name: "Dark Pipe Outlet",
    category: "dark-pipe",
    footprint: { width: 2, height: 2 },
    capabilityIds: [
      "footprint",
      "port-schema",
      "device-link-target",
      "external-liquid-source",
    ],
    configFields: [
      {
        key: "selectedLiquidItemId",
        label: "Selected Liquid",
        mutability: "runtime-mutable",
      },
    ],
  },
];

export const STAGE1_ITEM_DEFINITIONS: Stage1ItemDefinition[] = [
  { id: "item_liquid_water", name: "Clean Water", medium: "liquid", tags: [] },
  {
    id: "item_liquid_plant_grass_2",
    name: "Yazhen Solution",
    medium: "liquid",
    tags: [],
  },
  {
    id: "item_plant_grass_powder_2",
    name: "Yazhen Powder",
    medium: "solid",
    tags: [],
  },
  { id: "item_plant_grass_2", name: "Yazhen", medium: "solid", tags: [] },
  {
    id: "item_plant_grass_powder_1",
    name: "Jincao Powder",
    medium: "solid",
    tags: [],
  },
  { id: "item_plant_grass_1", name: "Jincao", medium: "solid", tags: [] },
  {
    id: "item_liquid_plant_grass_1",
    name: "Jincao Solution",
    medium: "liquid",
    tags: [],
  },
  { id: "item_iron_bottle", name: "Blue Iron Bottle", medium: "solid", tags: [] },
  {
    id: "item_iron_bottle_filled_liquid_plant_grass_2",
    name: "Blue Iron Bottle (Yazhen Solution)",
    medium: "solid",
    tags: ["bottled-liquid"],
  },
  {
    id: "item_iron_bottle_filled_liquid_plant_grass_1",
    name: "Blue Iron Bottle (Jincao Solution)",
    medium: "solid",
    tags: ["bottled-liquid"],
  },
];

export const STAGE1_RECIPE_DEFINITIONS: Stage1RecipeDefinition[] = [
  {
    id: "r_crusher_grass_powder_2_from_grass_2_basic",
    name: "Crush Yazhen",
    durationSeconds: 2,
    inputs: [{ itemId: "item_plant_grass_2", amount: 1 }],
    outputs: [{ itemId: "item_plant_grass_powder_2", amount: 2 }],
  },
  {
    id: "r_mix_pool_liquid_plant_grass_2_from_powder_and_water_basic",
    name: "Mix Yazhen Solution",
    durationSeconds: 2,
    inputs: [
      { itemId: "item_liquid_water", amount: 1 },
      { itemId: "item_plant_grass_powder_2", amount: 1 },
    ],
    outputs: [{ itemId: "item_liquid_plant_grass_2", amount: 1 }],
  },
  {
    id: "r_liquid_filling_iron_bottle_grass_2_default",
    name: "Fill Bottle With Yazhen Solution",
    durationSeconds: 2,
    inputs: [
      { itemId: "item_liquid_plant_grass_2", amount: 1 },
      { itemId: "item_iron_bottle", amount: 1 },
    ],
    outputs: [
      { itemId: "item_iron_bottle_filled_liquid_plant_grass_2", amount: 1 },
    ],
  },
  {
    id: "r_crusher_grass_powder_1_from_grass_1_basic",
    name: "Crush Jincao",
    durationSeconds: 2,
    inputs: [{ itemId: "item_plant_grass_1", amount: 1 }],
    outputs: [{ itemId: "item_plant_grass_powder_1", amount: 2 }],
  },
  {
    id: "r_mix_pool_liquid_plant_grass_1_from_powder_and_water_basic",
    name: "Mix Jincao Solution",
    durationSeconds: 2,
    inputs: [
      { itemId: "item_liquid_water", amount: 1 },
      { itemId: "item_plant_grass_powder_1", amount: 1 },
    ],
    outputs: [{ itemId: "item_liquid_plant_grass_1", amount: 1 }],
  },
  {
    id: "r_liquid_filling_iron_bottle_grass_1_default",
    name: "Fill Bottle With Jincao Solution",
    durationSeconds: 2,
    inputs: [
      { itemId: "item_liquid_plant_grass_1", amount: 1 },
      { itemId: "item_iron_bottle", amount: 1 },
    ],
    outputs: [
      { itemId: "item_iron_bottle_filled_liquid_plant_grass_1", amount: 1 },
    ],
  },
];

export function createStage1Registry(): Stage1Registry {
  return {
    entityDefinitions: STAGE1_ENTITY_DEFINITIONS,
    itemDefinitions: STAGE1_ITEM_DEFINITIONS,
    recipeDefinitions: STAGE1_RECIPE_DEFINITIONS,
  };
}

export function getStage1EntityDefinition(
  registry: Stage1Registry,
  definitionId: string,
): Stage1EntityDefinition | undefined {
  return registry.entityDefinitions.find((definition) => definition.id === definitionId);
}
