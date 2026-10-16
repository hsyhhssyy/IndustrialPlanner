import type { DeviceStateMachineDefinition } from "@/domain/registry/types/entity-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";

/** AKEData 1.5.3@10731330-8：PlantingDataTable、RewardSoilTable；基础奖励，不含施肥增产。 */
// AI-CORRECTION 2026-10-15: 四种旧田块收获量与十二种食材田块按 1.6.3@11010254-4 对齐；新增田块独立运行，不模拟变异率。
// AI-CORRECTION 2026-10-15: 状态使用有序 transitions，计时时长归属状态，可在分支迁移中继承。
// AI-CORRECTION 2026-10-15: 三种普通食材田块已接入育种；按用户确认假定累计 30 秒完成，每轮重置，完成后不退化。
// AI-CORRECTION 2026-10-16: 育种后生长与收获使用独立外观键；计时、配方与迁移规则保持原义。
export const CROP_STATE_MACHINES: Readonly<Record<string, DeviceStateMachineDefinition>> = {
  "soil_grass_1": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_grass_1_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_grass_1_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_grass_1_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_grass_1_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 1800,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "watering-2"
          }
        ]
      },
      {
        "id": "watering-2",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_grass_1_watering",
        "visualKey": undefined,
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_grass_1_watering",
            "nextStateId": "growing-2"
          }
        ]
      },
      {
        "id": "growing-2",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "mature-irrigated",
        "timerDurationSeconds": 1800,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ]
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_grass_1_harvest",
        "visualKey": undefined,
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_grass_1_harvest",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_grass_2": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_grass_2_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_grass_2_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_grass_2_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_grass_2_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 1800,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "watering-2"
          }
        ]
      },
      {
        "id": "watering-2",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_grass_2_watering",
        "visualKey": undefined,
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_grass_2_watering",
            "nextStateId": "growing-2"
          }
        ]
      },
      {
        "id": "growing-2",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "mature-irrigated",
        "timerDurationSeconds": 1800,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ]
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_grass_2_harvest",
        "visualKey": undefined,
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_grass_2_harvest",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_moss_1": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_moss_1_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_moss_1_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_moss_1_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_moss_1_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 3600,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ]
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_moss_1_harvest",
        "visualKey": undefined,
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_moss_1_harvest",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_moss_2": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_moss_2_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_moss_2_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_moss_2_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_moss_2_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 3600,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ]
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_moss_2_harvest",
        "visualKey": undefined,
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_moss_2_harvest",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_moss_3": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_moss_3_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_moss_3_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_moss_3_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_moss_3_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 300,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ]
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_moss_3_harvest",
        "visualKey": undefined,
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_moss_3_harvest",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_bbflower_1": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_bbflower_1_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_bbflower_1_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_bbflower_1_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_bbflower_1_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 300,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ]
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_bbflower_1_harvest",
        "visualKey": undefined,
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_bbflower_1_harvest",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_sp_1": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_sp_1_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_sp_1_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_sp_1_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_sp_1_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 43200,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ]
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_sp_1_harvest",
        "visualKey": undefined,
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_sp_1_harvest",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_sp_2": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_sp_2_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_sp_2_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_sp_2_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_sp_2_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 43200,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ]
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_sp_2_harvest",
        "visualKey": undefined,
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_sp_2_harvest",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_sp_3": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_sp_3_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_sp_3_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_sp_3_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_sp_3_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 14400,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "watering-2"
          }
        ]
      },
      {
        "id": "watering-2",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_sp_3_watering",
        "visualKey": undefined,
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_sp_3_watering",
            "nextStateId": "growing-2"
          }
        ]
      },
      {
        "id": "growing-2",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "mature-irrigated",
        "timerDurationSeconds": 14400,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "watering-3"
          }
        ]
      },
      {
        "id": "watering-3",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_sp_3_watering",
        "visualKey": undefined,
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_sp_3_watering",
            "nextStateId": "growing-3"
          }
        ]
      },
      {
        "id": "growing-3",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "mature-irrigated",
        "timerDurationSeconds": 14400,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ]
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_sp_3_harvest",
        "visualKey": undefined,
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_sp_3_harvest",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_sp_4": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_sp_4_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_sp_4_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_sp_4_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_sp_4_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 14400,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "watering-2"
          }
        ]
      },
      {
        "id": "watering-2",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_sp_4_watering",
        "visualKey": undefined,
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_sp_4_watering",
            "nextStateId": "growing-2"
          }
        ]
      },
      {
        "id": "growing-2",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "mature-irrigated",
        "timerDurationSeconds": 14400,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "watering-3"
          }
        ]
      },
      {
        "id": "watering-3",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_sp_4_watering",
        "visualKey": undefined,
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_sp_4_watering",
            "nextStateId": "growing-3"
          }
        ]
      },
      {
        "id": "growing-3",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "mature-irrigated",
        "timerDurationSeconds": 14400,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ]
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_sp_4_harvest",
        "visualKey": undefined,
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_sp_4_harvest",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_corp_bean_1": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_corp_bean_1_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_bean_1_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_corp_bean_1_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_bean_1_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 28800,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ]
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_corp_bean_1_harvest",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_bean_1_harvest",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_corp_cabbage_1": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_corp_cabbage_1_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_cabbage_1_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_corp_cabbage_1_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_cabbage_1_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 28800,
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_cabbage_1_refinement",
            "nextStateId": "growing-refined",
            "inheritTimer": true
          },
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ],
        "enterRecipeId": "r_soil_corp_cabbage_1_refinement"
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_corp_cabbage_1_harvest",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_cabbage_1_harvest",
            "nextStateId": "seedling"
          }
        ]
      },
      {
        "id": "growing-refined",
        "nameKey": "registry.deviceState.growing_refined",
        "visualKey": "refined-irrigated",
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest-refined"
          }
        ]
      },
      {
        "id": "harvest-refined",
        "nameKey": "registry.deviceState.harvest_refined",
        "visualKey": "refined",
        "enterRecipeId": "r_soil_corp_cabbage_1_harvest_refined",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_cabbage_1_harvest_refined",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_corp_cabbage_2": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_corp_cabbage_2_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_cabbage_2_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_corp_cabbage_2_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_cabbage_2_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 28800,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ]
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_corp_cabbage_2_harvest",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_cabbage_2_harvest",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_corp_canolaflower_1": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_corp_canolaflower_1_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_canolaflower_1_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_corp_canolaflower_1_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_canolaflower_1_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 28800,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ]
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_corp_canolaflower_1_harvest",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_canolaflower_1_harvest",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_corp_mushroom_1": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_corp_mushroom_1_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_mushroom_1_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_corp_mushroom_1_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_mushroom_1_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 28800,
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_mushroom_1_refinement",
            "nextStateId": "growing-refined",
            "inheritTimer": true
          },
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ],
        "enterRecipeId": "r_soil_corp_mushroom_1_refinement"
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_corp_mushroom_1_harvest",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_mushroom_1_harvest",
            "nextStateId": "seedling"
          }
        ]
      },
      {
        "id": "growing-refined",
        "nameKey": "registry.deviceState.growing_refined",
        "visualKey": "refined-irrigated",
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest-refined"
          }
        ]
      },
      {
        "id": "harvest-refined",
        "nameKey": "registry.deviceState.harvest_refined",
        "visualKey": "refined",
        "enterRecipeId": "r_soil_corp_mushroom_1_harvest_refined",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_mushroom_1_harvest_refined",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_corp_mushroom_2": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_corp_mushroom_2_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_mushroom_2_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_corp_mushroom_2_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_mushroom_2_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 28800,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ]
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_corp_mushroom_2_harvest",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_mushroom_2_harvest",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_corp_potato_1": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_corp_potato_1_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_potato_1_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_corp_potato_1_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_potato_1_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 28800,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ]
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_corp_potato_1_harvest",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_potato_1_harvest",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_corp_strawberry_1": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_corp_strawberry_1_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_strawberry_1_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_corp_strawberry_1_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_strawberry_1_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 28800,
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_strawberry_1_refinement",
            "nextStateId": "growing-refined",
            "inheritTimer": true
          },
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ],
        "enterRecipeId": "r_soil_corp_strawberry_1_refinement"
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_corp_strawberry_1_harvest",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_strawberry_1_harvest",
            "nextStateId": "seedling"
          }
        ]
      },
      {
        "id": "growing-refined",
        "nameKey": "registry.deviceState.growing_refined",
        "visualKey": "refined-irrigated",
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest-refined"
          }
        ]
      },
      {
        "id": "harvest-refined",
        "nameKey": "registry.deviceState.harvest_refined",
        "visualKey": "refined",
        "enterRecipeId": "r_soil_corp_strawberry_1_harvest_refined",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_strawberry_1_harvest_refined",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_corp_strawberry_2": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_corp_strawberry_2_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_strawberry_2_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_corp_strawberry_2_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_strawberry_2_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 28800,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ]
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_corp_strawberry_2_harvest",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_strawberry_2_harvest",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_corp_sugarcane_1": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_corp_sugarcane_1_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_sugarcane_1_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_corp_sugarcane_1_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_sugarcane_1_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 28800,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ]
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_corp_sugarcane_1_harvest",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_sugarcane_1_harvest",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_corp_tomato_1": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_corp_tomato_1_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_tomato_1_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_corp_tomato_1_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_tomato_1_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 28800,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ]
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_corp_tomato_1_harvest",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_tomato_1_harvest",
            "nextStateId": "seedling"
          }
        ]
      }
    ]
  },
  "soil_corp_whitegourd_1": {
    "initialStateId": "seedling",
    "channelId": "growth",
    "states": [
      {
        "id": "seedling",
        "nameKey": "registry.deviceState.seedling",
        "enterRecipeId": "r_soil_corp_whitegourd_1_seedling",
        "visualKey": "empty",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_whitegourd_1_seedling",
            "nextStateId": "watering-1"
          }
        ]
      },
      {
        "id": "watering-1",
        "nameKey": "registry.deviceState.watering",
        "enterRecipeId": "r_soil_corp_whitegourd_1_watering",
        "visualKey": "seedling",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_whitegourd_1_watering",
            "nextStateId": "growing-1"
          }
        ]
      },
      {
        "id": "growing-1",
        "nameKey": "registry.deviceState.growing",
        "visualKey": "irrigated",
        "timerDurationSeconds": 28800,
        "transitions": [
          {
            "kind": "elapsed",
            "nextStateId": "harvest"
          }
        ]
      },
      {
        "id": "harvest",
        "nameKey": "registry.deviceState.harvest",
        "enterRecipeId": "r_soil_corp_whitegourd_1_harvest",
        "transitions": [
          {
            "kind": "recipe-completed",
            "recipeId": "r_soil_corp_whitegourd_1_harvest",
            "nextStateId": "seedling"
          }
        ]
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
        "amount": 30
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
        "amount": 30
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
        "amount": 30
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
        "amount": 30
      }
    ],
    "machineId": "soil_sp_4",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_corp_bean_1_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_bean_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_corp_bean_1_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_bean_1",
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
    "id": "r_soil_corp_bean_1_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_corp_bean_1",
        "amount": 30
      },
      {
        "itemId": "item_byproduct_bean_1",
        "amount": 3
      }
    ],
    "machineId": "soil_corp_bean_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_corp_cabbage_1_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_cabbage_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_corp_cabbage_1_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_cabbage_1",
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
    "id": "r_soil_corp_cabbage_1_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_corp_cabbage_1",
        "amount": 30
      }
    ],
    "machineId": "soil_corp_cabbage_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_corp_cabbage_2_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_cabbage_2",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_corp_cabbage_2_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_cabbage_2",
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
    "id": "r_soil_corp_cabbage_2_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_corp_cabbage_1",
        "amount": 30
      },
      {
        "itemId": "item_corp_cabbage_2",
        "amount": 30
      }
    ],
    "machineId": "soil_corp_cabbage_2",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_corp_canolaflower_1_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_canolaflower_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_corp_canolaflower_1_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_canolaflower_1",
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
    "id": "r_soil_corp_canolaflower_1_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_corp_canolaflower_1",
        "amount": 30
      }
    ],
    "machineId": "soil_corp_canolaflower_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_corp_mushroom_1_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_mushroom_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_corp_mushroom_1_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_mushroom_1",
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
    "id": "r_soil_corp_mushroom_1_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_corp_mushroom_1",
        "amount": 30
      }
    ],
    "machineId": "soil_corp_mushroom_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_corp_mushroom_2_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_mushroom_2",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_corp_mushroom_2_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_mushroom_2",
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
    "id": "r_soil_corp_mushroom_2_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_corp_mushroom_1",
        "amount": 30
      },
      {
        "itemId": "item_corp_mushroom_2",
        "amount": 30
      }
    ],
    "machineId": "soil_corp_mushroom_2",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_corp_potato_1_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_potato_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_corp_potato_1_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_potato_1",
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
    "id": "r_soil_corp_potato_1_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_corp_potato_1",
        "amount": 30
      },
      {
        "itemId": "item_byproduct_potato_1",
        "amount": 3
      }
    ],
    "machineId": "soil_corp_potato_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_corp_strawberry_1_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_strawberry_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_corp_strawberry_1_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_strawberry_1",
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
    "id": "r_soil_corp_strawberry_1_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_corp_strawberry_1",
        "amount": 30
      }
    ],
    "machineId": "soil_corp_strawberry_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_corp_strawberry_2_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_strawberry_2",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_corp_strawberry_2_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_strawberry_2",
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
    "id": "r_soil_corp_strawberry_2_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_corp_strawberry_1",
        "amount": 30
      },
      {
        "itemId": "item_corp_strawberry_2",
        "amount": 30
      }
    ],
    "machineId": "soil_corp_strawberry_2",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_corp_sugarcane_1_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_sugarcane_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_corp_sugarcane_1_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_sugarcane_1",
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
    "id": "r_soil_corp_sugarcane_1_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_corp_sugarcane_1",
        "amount": 30
      }
    ],
    "machineId": "soil_corp_sugarcane_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_corp_tomato_1_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_tomato_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_corp_tomato_1_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_tomato_1",
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
    "id": "r_soil_corp_tomato_1_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_corp_tomato_1",
        "amount": 30
      }
    ],
    "machineId": "soil_corp_tomato_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_corp_whitegourd_1_seedling",
    "nameKey": "registry.recipe.crop_seedling.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_whitegourd_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ]
  },
  {
    "id": "r_soil_corp_whitegourd_1_watering",
    "nameKey": "registry.recipe.crop_watering.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_whitegourd_1",
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
    "id": "r_soil_corp_whitegourd_1_harvest",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_corp_whitegourd_1",
        "amount": 30
      }
    ],
    "machineId": "soil_corp_whitegourd_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_corp_cabbage_1_refinement",
    "nameKey": "registry.recipe.crop_refinement.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_cabbage_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "requiredEnvironmentAnyOf": [
      "item_gas_xiranite"
    ]
  },
  {
    "id": "r_soil_corp_cabbage_1_harvest_refined",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_corp_cabbage_1",
        "amount": 30
      },
      {
        "itemId": "item_corp_cabbage_2",
        "amount": 30
      }
    ],
    "machineId": "soil_corp_cabbage_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_corp_mushroom_1_refinement",
    "nameKey": "registry.recipe.crop_refinement.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_mushroom_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "requiredEnvironmentAnyOf": [
      "item_gas_xiranite"
    ]
  },
  {
    "id": "r_soil_corp_mushroom_1_harvest_refined",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_corp_mushroom_1",
        "amount": 30
      },
      {
        "itemId": "item_corp_mushroom_2",
        "amount": 30
      }
    ],
    "machineId": "soil_corp_mushroom_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  },
  {
    "id": "r_soil_corp_strawberry_1_refinement",
    "nameKey": "registry.recipe.crop_refinement.name",
    "durationSeconds": 30,
    "inputs": [],
    "outputs": [],
    "machineId": "soil_corp_strawberry_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "requiredEnvironmentAnyOf": [
      "item_gas_xiranite"
    ]
  },
  {
    "id": "r_soil_corp_strawberry_1_harvest_refined",
    "nameKey": "registry.recipe.crop_harvest.name",
    "durationSeconds": 2,
    "inputs": [],
    "outputs": [
      {
        "itemId": "item_corp_strawberry_1",
        "amount": 30
      },
      {
        "itemId": "item_corp_strawberry_2",
        "amount": 30
      }
    ],
    "machineId": "soil_corp_strawberry_1",
    "recipeType": "immediate-consume",
    "tags": [
      "ToolboxHidden",
      "StateControlled"
    ],
    "outputTarget": "warehouse"
  }
];
