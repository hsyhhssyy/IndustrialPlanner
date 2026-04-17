import type { RecipeDefinition } from "@/domain/types/registry/recipe-definition";

export const RECIPE_DEFINITIONS: RecipeDefinition[] = [
  {
    id: "r_crusher_grass_powder_2_from_grass_2_basic",
    nameKey: "registry.recipe.r_crusher_grass_powder_2_from_grass_2_basic.name",
    durationSeconds: 2,
    inputs: [{ itemId: "item_plant_grass_2", amount: 1 }],
    outputs: [{ itemId: "item_plant_grass_powder_2", amount: 2 }],
    machineId: "",
    tags: []
  },
  {
    id: "r_mix_pool_liquid_plant_grass_2_from_powder_and_water_basic",
    nameKey:
      "registry.recipe.r_mix_pool_liquid_plant_grass_2_from_powder_and_water_basic.name",
    durationSeconds: 2,
    inputs: [
      { itemId: "item_liquid_water", amount: 1 },
      { itemId: "item_plant_grass_powder_2", amount: 1 },
    ],
    outputs: [{ itemId: "item_liquid_plant_grass_2", amount: 1 }],
    machineId: "item_port_mix_pool_1",
    tags: [],
  },
  {
    id: "r_liquid_filling_iron_bottle_grass_2_default",
    nameKey: "registry.recipe.r_liquid_filling_iron_bottle_grass_2_default.name",
    durationSeconds: 2,
    inputs: [
      { itemId: "item_liquid_plant_grass_2", amount: 1 },
      { itemId: "item_iron_bottle", amount: 1 },
    ],
    outputs: [
      { itemId: "item_iron_bottle_filled_liquid_plant_grass_2", amount: 1 },
    ],
    machineId: "item_port_liquid_filling_pd_mc_1",
    tags: [],
  },
  {
    id: "r_crusher_grass_powder_1_from_grass_1_basic",
    nameKey: "registry.recipe.r_crusher_grass_powder_1_from_grass_1_basic.name",
    durationSeconds: 2,
    inputs: [{ itemId: "item_plant_grass_1", amount: 1 }],
    outputs: [{ itemId: "item_plant_grass_powder_1", amount: 2 }],
    machineId: "item_port_grinder_1",
    tags: [],
  },
  {
    id: "r_mix_pool_liquid_plant_grass_1_from_powder_and_water_basic",
    nameKey:
      "registry.recipe.r_mix_pool_liquid_plant_grass_1_from_powder_and_water_basic.name",
    durationSeconds: 2,
    inputs: [
      { itemId: "item_liquid_water", amount: 1 },
      { itemId: "item_plant_grass_powder_1", amount: 1 },
    ],
    outputs: [{ itemId: "item_liquid_plant_grass_1", amount: 1 }],
    machineId: "item_port_mix_pool_1",
    tags: [],
  },
  {
    id: "r_liquid_filling_iron_bottle_grass_1_default",
    nameKey: "registry.recipe.r_liquid_filling_iron_bottle_grass_1_default.name",
    durationSeconds: 2,
    inputs: [
      { itemId: "item_liquid_plant_grass_1", amount: 1 },
      { itemId: "item_iron_bottle", amount: 1 },
    ],
    outputs: [
      { itemId: "item_iron_bottle_filled_liquid_plant_grass_1", amount: 1 },
    ],
    machineId: "item_port_liquid_filling_pd_mc_1",
    tags: [],
  },
];
