import type { DeviceStateMachineDefinition } from "@/domain/registry/types/entity-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";

/** AKEData 1.5.3@10731330-8：PlantingDataTable、RewardSoilTable；基础奖励，不含施肥增产。 */
export const CROP_STATE_MACHINES: Readonly<Record<string, DeviceStateMachineDefinition>> = {
  "soil_grass_1": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "enterRecipeId": "r_soil_grass_1_seedling",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_grass_1_seedling",
          "nextStateId": "watering-1"
        }
      },
      {
        "id": "watering-1",
        "enterRecipeId": "r_soil_grass_1_watering",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_grass_1_watering",
          "nextStateId": "growing-1"
        }
      },
      {
        "id": "growing-1",
        "visualKey": "irrigated",
        "transition": {
          "kind": "elapsed",
          "durationSeconds": 1800,
          "nextStateId": "watering-2"
        }
      },
      {
        "id": "watering-2",
        "enterRecipeId": "r_soil_grass_1_watering",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_grass_1_watering",
          "nextStateId": "growing-2"
        }
      },
      {
        "id": "growing-2",
        "visualKey": "irrigated",
        "transition": {
          "kind": "elapsed",
          "durationSeconds": 1800,
          "nextStateId": "harvest"
        }
      },
      {
        "id": "harvest",
        "enterRecipeId": "r_soil_grass_1_harvest",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_grass_1_harvest",
          "nextStateId": "seedling"
        }
      }
    ]
  },
  "soil_grass_2": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "enterRecipeId": "r_soil_grass_2_seedling",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_grass_2_seedling",
          "nextStateId": "watering-1"
        }
      },
      {
        "id": "watering-1",
        "enterRecipeId": "r_soil_grass_2_watering",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_grass_2_watering",
          "nextStateId": "growing-1"
        }
      },
      {
        "id": "growing-1",
        "visualKey": "irrigated",
        "transition": {
          "kind": "elapsed",
          "durationSeconds": 1800,
          "nextStateId": "watering-2"
        }
      },
      {
        "id": "watering-2",
        "enterRecipeId": "r_soil_grass_2_watering",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_grass_2_watering",
          "nextStateId": "growing-2"
        }
      },
      {
        "id": "growing-2",
        "visualKey": "irrigated",
        "transition": {
          "kind": "elapsed",
          "durationSeconds": 1800,
          "nextStateId": "harvest"
        }
      },
      {
        "id": "harvest",
        "enterRecipeId": "r_soil_grass_2_harvest",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_grass_2_harvest",
          "nextStateId": "seedling"
        }
      }
    ]
  },
  "soil_moss_1": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "enterRecipeId": "r_soil_moss_1_seedling",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_moss_1_seedling",
          "nextStateId": "watering-1"
        }
      },
      {
        "id": "watering-1",
        "enterRecipeId": "r_soil_moss_1_watering",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_moss_1_watering",
          "nextStateId": "growing-1"
        }
      },
      {
        "id": "growing-1",
        "visualKey": "irrigated",
        "transition": {
          "kind": "elapsed",
          "durationSeconds": 3600,
          "nextStateId": "harvest"
        }
      },
      {
        "id": "harvest",
        "enterRecipeId": "r_soil_moss_1_harvest",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_moss_1_harvest",
          "nextStateId": "seedling"
        }
      }
    ]
  },
  "soil_moss_2": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "enterRecipeId": "r_soil_moss_2_seedling",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_moss_2_seedling",
          "nextStateId": "watering-1"
        }
      },
      {
        "id": "watering-1",
        "enterRecipeId": "r_soil_moss_2_watering",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_moss_2_watering",
          "nextStateId": "growing-1"
        }
      },
      {
        "id": "growing-1",
        "visualKey": "irrigated",
        "transition": {
          "kind": "elapsed",
          "durationSeconds": 3600,
          "nextStateId": "harvest"
        }
      },
      {
        "id": "harvest",
        "enterRecipeId": "r_soil_moss_2_harvest",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_moss_2_harvest",
          "nextStateId": "seedling"
        }
      }
    ]
  },
  "soil_moss_3": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "enterRecipeId": "r_soil_moss_3_seedling",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_moss_3_seedling",
          "nextStateId": "watering-1"
        }
      },
      {
        "id": "watering-1",
        "enterRecipeId": "r_soil_moss_3_watering",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_moss_3_watering",
          "nextStateId": "growing-1"
        }
      },
      {
        "id": "growing-1",
        "visualKey": "irrigated",
        "transition": {
          "kind": "elapsed",
          "durationSeconds": 300,
          "nextStateId": "harvest"
        }
      },
      {
        "id": "harvest",
        "enterRecipeId": "r_soil_moss_3_harvest",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_moss_3_harvest",
          "nextStateId": "seedling"
        }
      }
    ]
  },
  "soil_bbflower_1": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "enterRecipeId": "r_soil_bbflower_1_seedling",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_bbflower_1_seedling",
          "nextStateId": "watering-1"
        }
      },
      {
        "id": "watering-1",
        "enterRecipeId": "r_soil_bbflower_1_watering",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_bbflower_1_watering",
          "nextStateId": "growing-1"
        }
      },
      {
        "id": "growing-1",
        "visualKey": "irrigated",
        "transition": {
          "kind": "elapsed",
          "durationSeconds": 300,
          "nextStateId": "harvest"
        }
      },
      {
        "id": "harvest",
        "enterRecipeId": "r_soil_bbflower_1_harvest",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_bbflower_1_harvest",
          "nextStateId": "seedling"
        }
      }
    ]
  },
  "soil_sp_1": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "enterRecipeId": "r_soil_sp_1_seedling",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_sp_1_seedling",
          "nextStateId": "watering-1"
        }
      },
      {
        "id": "watering-1",
        "enterRecipeId": "r_soil_sp_1_watering",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_sp_1_watering",
          "nextStateId": "growing-1"
        }
      },
      {
        "id": "growing-1",
        "visualKey": "irrigated",
        "transition": {
          "kind": "elapsed",
          "durationSeconds": 43200,
          "nextStateId": "harvest"
        }
      },
      {
        "id": "harvest",
        "enterRecipeId": "r_soil_sp_1_harvest",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_sp_1_harvest",
          "nextStateId": "seedling"
        }
      }
    ]
  },
  "soil_sp_2": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "enterRecipeId": "r_soil_sp_2_seedling",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_sp_2_seedling",
          "nextStateId": "watering-1"
        }
      },
      {
        "id": "watering-1",
        "enterRecipeId": "r_soil_sp_2_watering",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_sp_2_watering",
          "nextStateId": "growing-1"
        }
      },
      {
        "id": "growing-1",
        "visualKey": "irrigated",
        "transition": {
          "kind": "elapsed",
          "durationSeconds": 43200,
          "nextStateId": "harvest"
        }
      },
      {
        "id": "harvest",
        "enterRecipeId": "r_soil_sp_2_harvest",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_sp_2_harvest",
          "nextStateId": "seedling"
        }
      }
    ]
  },
  "soil_sp_3": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "enterRecipeId": "r_soil_sp_3_seedling",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_sp_3_seedling",
          "nextStateId": "watering-1"
        }
      },
      {
        "id": "watering-1",
        "enterRecipeId": "r_soil_sp_3_watering",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_sp_3_watering",
          "nextStateId": "growing-1"
        }
      },
      {
        "id": "growing-1",
        "visualKey": "irrigated",
        "transition": {
          "kind": "elapsed",
          "durationSeconds": 14400,
          "nextStateId": "watering-2"
        }
      },
      {
        "id": "watering-2",
        "enterRecipeId": "r_soil_sp_3_watering",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_sp_3_watering",
          "nextStateId": "growing-2"
        }
      },
      {
        "id": "growing-2",
        "visualKey": "irrigated",
        "transition": {
          "kind": "elapsed",
          "durationSeconds": 14400,
          "nextStateId": "watering-3"
        }
      },
      {
        "id": "watering-3",
        "enterRecipeId": "r_soil_sp_3_watering",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_sp_3_watering",
          "nextStateId": "growing-3"
        }
      },
      {
        "id": "growing-3",
        "visualKey": "irrigated",
        "transition": {
          "kind": "elapsed",
          "durationSeconds": 14400,
          "nextStateId": "harvest"
        }
      },
      {
        "id": "harvest",
        "enterRecipeId": "r_soil_sp_3_harvest",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_sp_3_harvest",
          "nextStateId": "seedling"
        }
      }
    ]
  },
  "soil_sp_4": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "enterRecipeId": "r_soil_sp_4_seedling",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_sp_4_seedling",
          "nextStateId": "watering-1"
        }
      },
      {
        "id": "watering-1",
        "enterRecipeId": "r_soil_sp_4_watering",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_sp_4_watering",
          "nextStateId": "growing-1"
        }
      },
      {
        "id": "growing-1",
        "visualKey": "irrigated",
        "transition": {
          "kind": "elapsed",
          "durationSeconds": 14400,
          "nextStateId": "watering-2"
        }
      },
      {
        "id": "watering-2",
        "enterRecipeId": "r_soil_sp_4_watering",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_sp_4_watering",
          "nextStateId": "growing-2"
        }
      },
      {
        "id": "growing-2",
        "visualKey": "irrigated",
        "transition": {
          "kind": "elapsed",
          "durationSeconds": 14400,
          "nextStateId": "watering-3"
        }
      },
      {
        "id": "watering-3",
        "enterRecipeId": "r_soil_sp_4_watering",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_sp_4_watering",
          "nextStateId": "growing-3"
        }
      },
      {
        "id": "growing-3",
        "visualKey": "irrigated",
        "transition": {
          "kind": "elapsed",
          "durationSeconds": 14400,
          "nextStateId": "harvest"
        }
      },
      {
        "id": "harvest",
        "enterRecipeId": "r_soil_sp_4_harvest",
        "visualKey": undefined,
        "transition": {
          "kind": "recipe-completed",
          "recipeId": "r_soil_sp_4_harvest",
          "nextStateId": "seedling"
        }
      }
    ]
  }
};

/** 育苗和收获保留各 2 秒操作时间；环境浇水累计 30 秒，可暂停。 */
export const CROP_RECIPES: readonly RecipeDefinition[] = [
  {
    "id": "r_soil_grass_1_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_grass_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_grass_1_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_grass_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "requiredEnvironmentAnyOf": [
      "item_liquid_water",
      "item_gas_water"
    ]
  },
  {
    "id": "r_soil_grass_1_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_plant_grass_1",
        "amount": 10
      }
    ],
    "machineId": "soil_grass_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_grass_2_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_grass_2",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_grass_2_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_grass_2",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "requiredEnvironmentAnyOf": [
      "item_liquid_water",
      "item_gas_water"
    ]
  },
  {
    "id": "r_soil_grass_2_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_plant_grass_2",
        "amount": 10
      }
    ],
    "machineId": "soil_grass_2",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_moss_1_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_moss_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_moss_1_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_moss_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "requiredEnvironmentAnyOf": [
      "item_liquid_water",
      "item_gas_water"
    ]
  },
  {
    "id": "r_soil_moss_1_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_plant_moss_1",
        "amount": 10
      }
    ],
    "machineId": "soil_moss_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_moss_2_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_moss_2",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_moss_2_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_moss_2",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "requiredEnvironmentAnyOf": [
      "item_liquid_water",
      "item_gas_water"
    ]
  },
  {
    "id": "r_soil_moss_2_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_plant_moss_2",
        "amount": 10
      }
    ],
    "machineId": "soil_moss_2",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_moss_3_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_moss_3",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_moss_3_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_moss_3",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "requiredEnvironmentAnyOf": [
      "item_liquid_water",
      "item_gas_water"
    ]
  },
  {
    "id": "r_soil_moss_3_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_plant_moss_3",
        "amount": 10
      }
    ],
    "machineId": "soil_moss_3",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_bbflower_1_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_bbflower_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_bbflower_1_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_bbflower_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "requiredEnvironmentAnyOf": [
      "item_liquid_water",
      "item_gas_water"
    ]
  },
  {
    "id": "r_soil_bbflower_1_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_plant_bbflower_1",
        "amount": 10
      }
    ],
    "machineId": "soil_bbflower_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_sp_1_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_sp_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_sp_1_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_sp_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "requiredEnvironmentAnyOf": [
      "item_liquid_water",
      "item_gas_water"
    ]
  },
  {
    "id": "r_soil_sp_1_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_plant_sp_1",
        "amount": 3
      }
    ],
    "machineId": "soil_sp_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_sp_2_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_sp_2",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_sp_2_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_sp_2",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "requiredEnvironmentAnyOf": [
      "item_liquid_water",
      "item_gas_water"
    ]
  },
  {
    "id": "r_soil_sp_2_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_plant_sp_2",
        "amount": 3
      }
    ],
    "machineId": "soil_sp_2",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_sp_3_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_sp_3",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_sp_3_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_sp_3",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "requiredEnvironmentAnyOf": [
      "item_liquid_water",
      "item_gas_water"
    ]
  },
  {
    "id": "r_soil_sp_3_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_plant_sp_3",
        "amount": 3
      }
    ],
    "machineId": "soil_sp_3",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_sp_4_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_sp_4",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_sp_4_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_sp_4",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "requiredEnvironmentAnyOf": [
      "item_liquid_water",
      "item_gas_water"
    ]
  },
  {
    "id": "r_soil_sp_4_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_plant_sp_4",
        "amount": 3
      }
    ],
    "machineId": "soil_sp_4",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  }
];
