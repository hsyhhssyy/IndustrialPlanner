// AI-REMOVED 2026-10-17:
// Reason: 回归只固定问题条件，不能绑定算法版本、尺寸分片或计算检查点。
// Trigger: 用户要求同一用例跨算法版本运行并检测首解搜索退化。
// Evidence: controller 的版本拦截和 assertPlannerDimensionSchedule 的内部状态一致性校验。
// Replacement: 同名 JSON 的声明式任务，以及 loadEdaRegressionInput + 正式 Host 冷启动。
// Risk: 确定性批次的成绩与历史异步调度成绩不能直接等同；验收门槛不变。
// Human Review: Required
// Original code (原 xiranite-2s-first-solution.json，禁止作为有效输入恢复):
// {
//   "formatVersion": 1,
//   "algorithmVersion": "first-solution-9",
//   "taskId": "78376845-d650-4d50-8462-95150ee9aceb",
//   "request": {
//     "plan": {
//       "name": "",
//       "sourceBaseId": "wuling_agricultural_land",
//       "targets": [
//         {
//           "itemId": "item_xiranite_powder",
//           "perMinute": 360
//         }
//       ],
//       "externalSupplies": [],
//       "infiniteItemIds": [
//         "item_liquid_sewage"
//       ],
//       "byproductItemIds": [],
//       "containsModules": false,
//       "unresolvedPerMinute": 0,
//       "activeActivityIds": [],
//       "recipes": [
//         {
//           "recipeId": "r_furnace_carbon_mtl_from_grass_2_basic",
//           "cyclesPerMinute": 180,
//           "deviceCount": 6,
//           "inputs": [
//             {
//               "itemId": "item_plant_grass_2",
//               "perMinute": 180
//             }
//           ],
//           "outputs": [
//             {
//               "itemId": "item_carbon_mtl",
//               "perMinute": 360
//             }
//           ],
//           "runningInputs": []
//         },
//         {
//           "recipeId": "r_hydro_planter_grass_2_from_seed_2_and_water_basic",
//           "cyclesPerMinute": 180,
//           "deviceCount": 6,
//           "inputs": [
//             {
//               "itemId": "item_plant_grass_seed_2",
//               "perMinute": 180
//             },
//             {
//               "itemId": "item_liquid_water",
//               "perMinute": 180
//             }
//           ],
//           "outputs": [
//             {
//               "itemId": "item_plant_grass_2",
//               "perMinute": 360
//             }
//           ],
//           "runningInputs": []
//         },
//         {
//           "recipeId": "r_seedcol_grass_seed_2_from_grass_2_basic",
//           "cyclesPerMinute": 180,
//           "deviceCount": 6,
//           "inputs": [
//             {
//               "itemId": "item_plant_grass_2",
//               "perMinute": 180
//             }
//           ],
//           "outputs": [
//             {
//               "itemId": "item_plant_grass_seed_2",
//               "perMinute": 180
//             }
//           ],
//           "runningInputs": []
//         },
//         {
//           "recipeId": "r_pump_water_basic",
//           "cyclesPerMinute": 540,
//           "deviceCount": 9,
//           "inputs": [],
//           "outputs": [
//             {
//               "itemId": "item_liquid_water",
//               "perMinute": 540
//             }
//           ],
//           "runningInputs": []
//         },
//         {
//           "recipeId": "xiranite_oven_xiranite_powder_2",
//           "cyclesPerMinute": 360,
//           "deviceCount": 12,
//           "inputs": [
//             {
//               "itemId": "item_carbon_mtl",
//               "perMinute": 360
//             },
//             {
//               "itemId": "item_liquid_water",
//               "perMinute": 360
//             }
//           ],
//           "outputs": [
//             {
//               "itemId": "item_xiranite_powder",
//               "perMinute": 360
//             }
//           ],
//           "runningInputs": []
//         }
//       ],
//       "supplyPolicies": [
//         {
//           "itemId": "item_gas_inert",
//           "source": "external"
//         }
//       ]
//     },
//     "options": {
//       "warehousePortPlacement": "continuous",
//       "solidSupply": "warehouse",
//       "fluidSupply": "conduit",
//       "warehouseBus": "straight",
//       "solidOutput": "auto",
//       "byproducts": "destroy",
//       "plantStartup": "preload",
//       "converterStartup": "reject",
//       "evaluationsPerRound": 19800000,
//       "concurrency": 32,
//       "gpu": true,
//       "itemPolicies": [
//         {
//           "itemId": "item_xiranite_powder",
//           "output": "auto"
//         },
//         {
//           "itemId": "item_liquid_water",
//           "supply": "conduit"
//         },
//         {
//           "itemId": "item_gas_inert",
//           "supply": "conduit"
//         }
//       ],
//       "blueprintOptimizations": {
//         "reassignPorts": false,
//         "reassignConnections": false,
//         "rebuildLogistics": false,
//         "mergeBoundaryFacilities": false
//       }
//     }
//   },
//   "checkpoint": {
//     "attempt": 0,
//     "evaluations": 0,
//     "portfolio": {
//       "pools": []
//     },
//     "best": null,
//     "pendingCandidate": null,
//     "result": null,
//     "savedBlueprintId": null,
//     "randomSeed": 1928356741,
//     "parallel": {
//       "count": 32,
//       "originTaskId": "78376845-d650-4d50-8462-95150ee9aceb",
//       "baseAttempt": 0,
//       "baseVariant": 0,
//       "nextShard": 0,
//       "baseEvaluations": 0,
//       "baseValidatedCandidates": 0,
//       "requestKey": "{\"boundaryVersion\":1,\"plan\":{\"name\":\"\",\"sourceBaseId\":\"wuling_agricultural_land\",\"targets\":[{\"itemId\":\"item_xiranite_powder\",\"perMinute\":360}],\"externalSupplies\":[],\"infiniteItemIds\":[\"item_liquid_sewage\"],\"byproductItemIds\":[],\"containsModules\":false,\"unresolvedPerMinute\":0,\"activeActivityIds\":[],\"recipes\":[{\"recipeId\":\"r_furnace_carbon_mtl_from_grass_2_basic\",\"cyclesPerMinute\":180,\"deviceCount\":6,\"inputs\":[{\"itemId\":\"item_plant_grass_2\",\"perMinute\":180}],\"outputs\":[{\"itemId\":\"item_carbon_mtl\",\"perMinute\":360}],\"runningInputs\":[]},{\"recipeId\":\"r_hydro_planter_grass_2_from_seed_2_and_water_basic\",\"cyclesPerMinute\":180,\"deviceCount\":6,\"inputs\":[{\"itemId\":\"item_plant_grass_seed_2\",\"perMinute\":180},{\"itemId\":\"item_liquid_water\",\"perMinute\":180}],\"outputs\":[{\"itemId\":\"item_plant_grass_2\",\"perMinute\":360}],\"runningInputs\":[]},{\"recipeId\":\"r_seedcol_grass_seed_2_from_grass_2_basic\",\"cyclesPerMinute\":180,\"deviceCount\":6,\"inputs\":[{\"itemId\":\"item_plant_grass_2\",\"perMinute\":180}],\"outputs\":[{\"itemId\":\"item_plant_grass_seed_2\",\"perMinute\":180}],\"runningInputs\":[]},{\"recipeId\":\"r_pump_water_basic\",\"cyclesPerMinute\":540,\"deviceCount\":9,\"inputs\":[],\"outputs\":[{\"itemId\":\"item_liquid_water\",\"perMinute\":540}],\"runningInputs\":[]},{\"recipeId\":\"xiranite_oven_xiranite_powder_2\",\"cyclesPerMinute\":360,\"deviceCount\":12,\"inputs\":[{\"itemId\":\"item_carbon_mtl\",\"perMinute\":360},{\"itemId\":\"item_liquid_water\",\"perMinute\":360}],\"outputs\":[{\"itemId\":\"item_xiranite_powder\",\"perMinute\":360}],\"runningInputs\":[]}],\"supplyPolicies\":[{\"itemId\":\"item_gas_inert\",\"source\":\"external\"}]},\"options\":{\"warehousePortPlacement\":\"continuous\",\"solidSupply\":\"warehouse\",\"fluidSupply\":\"conduit\",\"warehouseBus\":\"straight\",\"solidOutput\":\"auto\",\"byproducts\":\"destroy\",\"plantStartup\":\"preload\",\"evaluationsPerRound\":0,\"itemPolicies\":[{\"itemId\":\"item_xiranite_powder\",\"output\":\"auto\"},{\"itemId\":\"item_liquid_water\",\"supply\":\"conduit\"},{\"itemId\":\"item_gas_inert\",\"supply\":\"conduit\"}],\"blueprintOptimizations\":{\"reassignPorts\":false,\"reassignConnections\":false,\"rebuildLogistics\":false,\"mergeBoundaryFacilities\":false},\"budgetMs\":0}}",
//       "ownedShards": [
//         0,
//         1,
//         2,
//         3,
//         4,
//         5,
//         6,
//         7,
//         8,
//         9,
//         10,
//         11,
//         12,
//         13,
//         14,
//         15,
//         16,
//         17,
//         18,
//         19,
//         20,
//         21,
//         22,
//         23,
//         24,
//         25,
//         26,
//         27,
//         28,
//         29,
//         30,
//         31
//       ],
//       "shards": [
//         {
//           "index": 0,
//           "nextVariant": 0,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 30,
//               "height": 51,
//               "area": 1530,
//               "weight": 1
//             },
//             {
//               "width": 8,
//               "height": 70,
//               "area": 560,
//               "weight": 0.25098039215686274
//             },
//             {
//               "width": 5,
//               "height": 70,
//               "area": 350,
//               "weight": 0.09803921568627451
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 1,
//           "nextVariant": 1,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 51,
//               "height": 30,
//               "area": 1530,
//               "weight": 1
//             },
//             {
//               "width": 7,
//               "height": 70,
//               "area": 490,
//               "weight": 0.19215686274509805
//             },
//             {
//               "width": 6,
//               "height": 70,
//               "area": 420,
//               "weight": 0.1411764705882353
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 2,
//           "nextVariant": 2,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 22,
//               "height": 69,
//               "area": 1518,
//               "weight": 0.9921568627450981
//             },
//             {
//               "width": 12,
//               "height": 70,
//               "area": 840,
//               "weight": 0.5411764705882353
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 3,
//           "nextVariant": 3,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 23,
//               "height": 66,
//               "area": 1518,
//               "weight": 0.9921568627450981
//             },
//             {
//               "width": 11,
//               "height": 70,
//               "area": 770,
//               "weight": 0.4745098039215686
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 4,
//           "nextVariant": 4,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 66,
//               "height": 23,
//               "area": 1518,
//               "weight": 0.9921568627450981
//             },
//             {
//               "width": 10,
//               "height": 70,
//               "area": 700,
//               "weight": 0.39215686274509803
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 5,
//           "nextVariant": 5,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 69,
//               "height": 22,
//               "area": 1518,
//               "weight": 0.9921568627450981
//             },
//             {
//               "width": 9,
//               "height": 70,
//               "area": 630,
//               "weight": 0.3176470588235294
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 6,
//           "nextVariant": 6,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 24,
//               "height": 63,
//               "area": 1512,
//               "weight": 0.9882352941176471
//             },
//             {
//               "width": 37,
//               "height": 41,
//               "area": 1517,
//               "weight": 0.6627450980392157
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 7,
//           "nextVariant": 7,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 28,
//               "height": 54,
//               "area": 1512,
//               "weight": 0.9882352941176471
//             },
//             {
//               "width": 41,
//               "height": 37,
//               "area": 1517,
//               "weight": 0.6627450980392157
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 8,
//           "nextVariant": 8,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 54,
//               "height": 28,
//               "area": 1512,
//               "weight": 0.9882352941176471
//             },
//             {
//               "width": 14,
//               "height": 70,
//               "area": 980,
//               "weight": 0.6313725490196078
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 9,
//           "nextVariant": 9,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 63,
//               "height": 24,
//               "area": 1512,
//               "weight": 0.9882352941176471
//             },
//             {
//               "width": 13,
//               "height": 70,
//               "area": 910,
//               "weight": 0.5862745098039216
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 10,
//           "nextVariant": 10,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 25,
//               "height": 61,
//               "area": 1525,
//               "weight": 0.9803921568627451
//             },
//             {
//               "width": 39,
//               "height": 39,
//               "area": 1521,
//               "weight": 0.6627450980392157
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 11,
//           "nextVariant": 11,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 61,
//               "height": 25,
//               "area": 1525,
//               "weight": 0.9803921568627451
//             },
//             {
//               "width": 38,
//               "height": 40,
//               "area": 1520,
//               "weight": 0.6627450980392157
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 12,
//           "nextVariant": 12,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 60,
//               "height": 25,
//               "area": 1500,
//               "weight": 0.9803921568627451
//             },
//             {
//               "width": 40,
//               "height": 38,
//               "area": 1520,
//               "weight": 0.6627450980392157
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 13,
//           "nextVariant": 13,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 31,
//               "height": 49,
//               "area": 1519,
//               "weight": 0.9725490196078431
//             },
//             {
//               "width": 17,
//               "height": 70,
//               "area": 1190,
//               "weight": 0.7666666666666667
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 14,
//           "nextVariant": 14,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 49,
//               "height": 31,
//               "area": 1519,
//               "weight": 0.9725490196078431
//             },
//             {
//               "width": 16,
//               "height": 70,
//               "area": 1120,
//               "weight": 0.7215686274509804
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 15,
//           "nextVariant": 15,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 48,
//               "height": 31,
//               "area": 1488,
//               "weight": 0.9725490196078431
//             },
//             {
//               "width": 15,
//               "height": 70,
//               "area": 1050,
//               "weight": 0.6764705882352942
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 16,
//           "nextVariant": 16,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 26,
//               "height": 58,
//               "area": 1508,
//               "weight": 0.9686274509803922
//             },
//             {
//               "width": 42,
//               "height": 36,
//               "area": 1512,
//               "weight": 0.7686274509803922
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 17,
//           "nextVariant": 17,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 58,
//               "height": 26,
//               "area": 1508,
//               "weight": 0.9686274509803922
//             },
//             {
//               "width": 35,
//               "height": 43,
//               "area": 1505,
//               "weight": 0.7686274509803922
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 18,
//           "nextVariant": 18,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 57,
//               "height": 26,
//               "area": 1482,
//               "weight": 0.9686274509803922
//             },
//             {
//               "width": 44,
//               "height": 34,
//               "area": 1496,
//               "weight": 0.7686274509803922
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 19,
//           "nextVariant": 19,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 29,
//               "height": 52,
//               "area": 1508,
//               "weight": 0.9666666666666667
//             },
//             {
//               "width": 43,
//               "height": 35,
//               "area": 1505,
//               "weight": 0.7686274509803923
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 20,
//           "nextVariant": 20,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 52,
//               "height": 29,
//               "area": 1508,
//               "weight": 0.9666666666666667
//             },
//             {
//               "width": 36,
//               "height": 42,
//               "area": 1512,
//               "weight": 0.7686274509803922
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 21,
//           "nextVariant": 21,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 27,
//               "height": 56,
//               "area": 1512,
//               "weight": 0.9529411764705882
//             },
//             {
//               "width": 47,
//               "height": 32,
//               "area": 1504,
//               "weight": 0.8823529411764706
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 22,
//           "nextVariant": 22,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 56,
//               "height": 27,
//               "area": 1512,
//               "weight": 0.9529411764705882
//             },
//             {
//               "width": 19,
//               "height": 70,
//               "area": 1330,
//               "weight": 0.8568627450980392
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 23,
//           "nextVariant": 23,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 55,
//               "height": 27,
//               "area": 1485,
//               "weight": 0.9529411764705882
//             },
//             {
//               "width": 18,
//               "height": 70,
//               "area": 1260,
//               "weight": 0.8117647058823529
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 24,
//           "nextVariant": 24,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 68,
//               "height": 22,
//               "area": 1496,
//               "weight": 0.9490196078431372
//             },
//             {
//               "width": 46,
//               "height": 33,
//               "area": 1518,
//               "weight": 0.8823529411764706
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 25,
//           "nextVariant": 25,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 67,
//               "height": 22,
//               "area": 1474,
//               "weight": 0.9490196078431372
//             },
//             {
//               "width": 32,
//               "height": 47,
//               "area": 1504,
//               "weight": 0.8823529411764706
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 26,
//           "nextVariant": 26,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 65,
//               "height": 23,
//               "area": 1495,
//               "weight": 0.9470588235294117
//             },
//             {
//               "width": 20,
//               "height": 70,
//               "area": 1400,
//               "weight": 0.9019607843137255
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 27,
//           "nextVariant": 27,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 64,
//               "height": 23,
//               "area": 1472,
//               "weight": 0.9470588235294117
//             },
//             {
//               "width": 34,
//               "height": 45,
//               "area": 1530,
//               "weight": 0.8823529411764706
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 28,
//           "nextVariant": 28,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 21,
//               "height": 70,
//               "area": 1470,
//               "weight": 0.9470588235294117
//             },
//             {
//               "width": 45,
//               "height": 34,
//               "area": 1530,
//               "weight": 0.8823529411764706
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 29,
//           "nextVariant": 29,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 70,
//               "height": 21,
//               "area": 1470,
//               "weight": 0.9470588235294117
//             },
//             {
//               "width": 33,
//               "height": 46,
//               "area": 1518,
//               "weight": 0.8823529411764706
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 30,
//           "nextVariant": 30,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 50,
//               "height": 30,
//               "area": 1500,
//               "weight": 0.9411764705882353
//             },
//             {
//               "width": 53,
//               "height": 28,
//               "area": 1484,
//               "weight": 0.9333333333333333
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         },
//         {
//           "index": 31,
//           "nextVariant": 31,
//           "attempts": 0,
//           "evaluations": 0,
//           "validatedCandidates": 0,
//           "portfolio": {
//             "pools": []
//           },
//           "pendingCandidate": null,
//           "shapeVisits": {},
//           "dimensions": [
//             {
//               "width": 62,
//               "height": 24,
//               "area": 1488,
//               "weight": 0.9411764705882353
//             },
//             {
//               "width": 59,
//               "height": 25,
//               "area": 1475,
//               "weight": 0.9313725490196079
//             }
//           ],
//           "dimensionCursor": 0,
//           "strategyStates": {},
//           "shapeEvaluations": {}
//         }
//       ],
//       "dimensionSchedule": {
//         "generation": 0,
//         "targetArea": 1530,
//         "deviceArea": 765,
//         "boundaryLength": 0,
//         "inclusive": true,
//         "minimum": {
//           "width": 5,
//           "height": 5
//         },
//         "attemptsPerTask": 300000,
//         "repeatedUnits": 3
//       }
//     }
//   },
//   "progress": {
//     "taskId": "78376845-d650-4d50-8462-95150ee9aceb",
//     "status": "waiting",
//     "phase": "optimization",
//     "planningStarted": true,
//     "startedAt": 1792175793015,
//     "elapsedMs": 0,
//     "estimatedProgress": null,
//     "candidateCount": 0,
//     "evaluatedProposals": 0,
//     "roundEvaluatedProposals": 0,
//     "validatedCandidateCount": 0,
//     "bestArea": null,
//     "areaHistory": [],
//     "message": "计算已暂停，可以继续。",
//     "initialArea": 1530,
//     "activeWorkerCount": 0
//   }
// }
