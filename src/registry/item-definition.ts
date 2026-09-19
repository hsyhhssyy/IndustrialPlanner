import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import {
  ACTIVITY_LIMITED_FORMULA_1_TAG,
  ACTIVITY_LIMITED_FORMULA_2_TAG,
} from "@/shared/registry/activity-availability";

/** fluidColors 原值来自固定美术原件，并由 Registry 配色对账测试逐项校验。 */
// AI-CORRECTION 2026-09-19: 网站原件不再进入仓库；来源字段记录上游 URL，逐项对账在临时导入批次内完成。
export const ITEM_FLUID_COLOR_SOURCE_URL =
  "https://hsyhhssyy.github.io/Endfield-Building-TopView-Assets/buildings/logistics/fluid-profiles.json";
// AI-REMOVED 2026-09-19:
// Reason: 网站原件不再保存在 resources，旧常量会指向必然不存在的本地文件。
// Trigger: 用户要求展开素材只存在于 .temp/.trash 导入批次。
// Evidence: Registry 运行时只消费下方 fluidColors；导入器在应用前已对网站配色逐项验收。
// Replacement: ITEM_FLUID_COLOR_SOURCE_URL。
// Risk: 常规测试不再离线复核上游原始配色字节；该检查移至导入批次。
// Human Review: Required
//
// Original code:
// export const ITEM_FLUID_COLOR_SOURCE_PATH =
//   "resources/building-assets-site/v1.5-20260917-100609-cst/buildings/logistics/fluid-profiles.json";

export const ITEM_DEFINITIONS: ItemDefinition[] = [
  {
    id: "item_bottled_food_1",
    nameKey: "registry.item.item_bottled_food_1.name",
    iconId: "item_bottled_food_1",
    tags: ["调度券地区:四号谷地", "调度券价值:10"],
    displayOrder: 10000,
  },
  {
    id: "item_bottled_food_2",
    nameKey: "registry.item.item_bottled_food_2.name",
    iconId: "item_bottled_food_2",
    tags: ["调度券地区:四号谷地", "调度券价值:27"],
    displayOrder: 10000,
  },
  {
    id: "item_bottled_food_3",
    nameKey: "registry.item.item_bottled_food_3.name",
    iconId: "item_bottled_food_3",
    tags: ["调度券地区:四号谷地", "调度券价值:70"],
    displayOrder: 10000,
  },
  {
    id: "item_bottled_food_4",
    nameKey: "registry.item.item_bottled_food_4.name",
    iconId: "item_bottled_food_4",
    tags: ["调度券地区:武陵", "调度券价值:16"],
    displayOrder: 10000,
  },
  {
    id: "item_bottled_food_5",
    nameKey: "registry.item.item_bottled_food_5.name",
    iconId: "item_bottled_food_5",
    tags: ["调度券地区:武陵", "调度券价值:22"],
    displayOrder: 10000,
  },
  {
    id: "item_bottled_rec_hp_1",
    nameKey: "registry.item.item_bottled_rec_hp_1.name",
    iconId: "item_bottled_rec_hp_1",
    tags: ["调度券地区:四号谷地", "调度券价值:10"],
    displayOrder: 10000,
  },
  {
    id: "item_bottled_rec_hp_2",
    nameKey: "registry.item.item_bottled_rec_hp_2.name",
    iconId: "item_bottled_rec_hp_2",
    tags: ["调度券地区:四号谷地", "调度券价值:27"],
    displayOrder: 10000,
  },
  {
    id: "item_bottled_rec_hp_3",
    nameKey: "registry.item.item_bottled_rec_hp_3.name",
    iconId: "item_bottled_rec_hp_3",
    tags: ["调度券地区:四号谷地", "调度券价值:70"],
    displayOrder: 10000,
  },
  {
    id: "item_bottled_rec_hp_4",
    nameKey: "registry.item.item_bottled_rec_hp_4.name",
    iconId: "item_bottled_rec_hp_4",
    tags: ["调度券地区:武陵", "调度券价值:16"],
    displayOrder: 10000,
  },
  {
    id: "item_bottled_rec_hp_5",
    nameKey: "registry.item.item_bottled_rec_hp_5.name",
    iconId: "item_bottled_rec_hp_5",
    tags: ["调度券地区:武陵", "调度券价值:22"],
    displayOrder: 10000,
  },
  {
    id: "item_carbon_enr",
    nameKey: "registry.item.item_carbon_enr.name",
    iconId: "item_carbon_enr",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_carbon_enr_powder",
    nameKey: "registry.item.item_carbon_enr_powder.name",
    iconId: "item_carbon_enr_powder",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_carbon_mtl",
    nameKey: "registry.item.item_carbon_mtl.name",
    iconId: "item_carbon_mtl",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_carbon_powder",
    nameKey: "registry.item.item_carbon_powder.name",
    iconId: "item_carbon_powder",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_crystal_enr",
    nameKey: "registry.item.item_crystal_enr.name",
    iconId: "item_crystal_enr",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_crystal_enr_powder",
    nameKey: "registry.item.item_crystal_enr_powder.name",
    iconId: "item_crystal_enr_powder",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_crystal_powder",
    nameKey: "registry.item.item_crystal_powder.name",
    iconId: "item_crystal_powder",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_crystal_shell",
    nameKey: "registry.item.item_crystal_shell.name",
    iconId: "item_crystal_shell",
    tags: ["调度券地区:四号谷地", "调度券价值:1"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_ore",
    nameKey: "registry.item.item_copper_ore.name",
    iconId: "item_copper_ore",
    tags: ["矿石", "自然资源"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_bottle",
    nameKey: "registry.item.item_copper_bottle.name",
    iconId: "item_copper_bottle",
    tags: ["瓶子"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_bottle_filled_water",
    nameKey: "registry.item.item_copper_bottle_filled_water.name",
    iconId: "item_copper_bottle_filled_water",
    tags: ["瓶子", "瓶装液体", "container:item_copper_bottle", "container-item:item_liquid_water"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_bottle_filled_liquid_plant_grass_1",
    nameKey: "registry.item.item_copper_bottle_filled_liquid_plant_grass_1.name",
    iconId: "item_copper_bottle_filled_liquid_plant_grass_1",
    tags: ["瓶子", "瓶装液体", "container:item_copper_bottle", "container-item:item_liquid_plant_grass_1"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_bottle_filled_liquid_plant_grass_2",
    nameKey: "registry.item.item_copper_bottle_filled_liquid_plant_grass_2.name",
    iconId: "item_copper_bottle_filled_liquid_plant_grass_2",
    tags: ["瓶子", "瓶装液体", "container:item_copper_bottle", "container-item:item_liquid_plant_grass_2"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_bottle_filled_liquid_xiranite",
    nameKey: "registry.item.item_copper_bottle_filled_liquid_xiranite.name",
    iconId: "item_copper_bottle_filled_liquid_xiranite",
    tags: ["瓶子", "瓶装液体", "container:item_copper_bottle", "container-item:item_liquid_xiranite"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_bottle_filled_liquid_sewage",
    nameKey: "registry.item.item_copper_bottle_filled_liquid_sewage.name",
    iconId: "item_copper_bottle_filled_liquid_sewage",
    tags: ["瓶子", "瓶装液体", "container:item_copper_bottle", "container-item:item_liquid_sewage"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_bottle_filled_liquid_xiranite_poly",
    nameKey: "registry.item.item_copper_bottle_filled_liquid_xiranite_poly.name",
    iconId: "item_copper_bottle_filled_liquid_xiranite_poly",
    tags: ["瓶子", "瓶装液体", "container:item_copper_bottle", "container-item:item_liquid_xiranite_poly"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_bottle_filled_liquid_xiranite_lowpoly",
    nameKey: "registry.item.item_copper_bottle_filled_liquid_xiranite_lowpoly.name",
    iconId: "item_copper_bottle_filled_liquid_xiranite_lowpoly",
    tags: ["瓶子", "瓶装液体", "container:item_copper_bottle", "container-item:item_liquid_xiranite_lowpoly"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_enr_bottle",
    nameKey: "registry.item.item_copper_enr_bottle.name",
    iconId: "item_copper_enr_bottle",
    tags: ["瓶子"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_enr_bottle_filled_water",
    nameKey: "registry.item.item_copper_enr_bottle_filled_water.name",
    iconId: "item_copper_enr_bottle_filled_water",
    tags: ["瓶子", "瓶装液体", "container:item_copper_enr_bottle", "container-item:item_liquid_water"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_enr_bottle_filled_liquid_plant_grass_1",
    nameKey: "registry.item.item_copper_enr_bottle_filled_liquid_plant_grass_1.name",
    iconId: "item_copper_enr_bottle_filled_liquid_plant_grass_1",
    tags: ["瓶子", "瓶装液体", "container:item_copper_enr_bottle", "container-item:item_liquid_plant_grass_1"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_enr_bottle_filled_liquid_plant_grass_2",
    nameKey: "registry.item.item_copper_enr_bottle_filled_liquid_plant_grass_2.name",
    iconId: "item_copper_enr_bottle_filled_liquid_plant_grass_2",
    tags: ["瓶子", "瓶装液体", "container:item_copper_enr_bottle", "container-item:item_liquid_plant_grass_2"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_enr_bottle_filled_liquid_xiranite",
    nameKey: "registry.item.item_copper_enr_bottle_filled_liquid_xiranite.name",
    iconId: "item_copper_enr_bottle_filled_liquid_xiranite",
    tags: ["瓶子", "瓶装液体", "container:item_copper_enr_bottle", "container-item:item_liquid_xiranite"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_enr_bottle_filled_liquid_sewage",
    nameKey: "registry.item.item_copper_enr_bottle_filled_liquid_sewage.name",
    iconId: "item_copper_enr_bottle_filled_liquid_sewage",
    tags: ["瓶子", "瓶装液体", "container:item_copper_enr_bottle", "container-item:item_liquid_sewage"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_enr_bottle_filled_liquid_xiranite_poly",
    nameKey: "registry.item.item_copper_enr_bottle_filled_liquid_xiranite_poly.name",
    iconId: "item_copper_enr_bottle_filled_liquid_xiranite_poly",
    tags: ["瓶子", "瓶装液体", "container:item_copper_enr_bottle", "container-item:item_liquid_xiranite_poly"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_enr_bottle_filled_liquid_xiranite_lowpoly",
    nameKey: "registry.item.item_copper_enr_bottle_filled_liquid_xiranite_lowpoly.name",
    iconId: "item_copper_enr_bottle_filled_liquid_xiranite_lowpoly",
    tags: ["瓶子", "瓶装液体", "container:item_copper_enr_bottle", "container-item:item_liquid_xiranite_lowpoly"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_enr",
    nameKey: "registry.item.item_copper_enr.name",
    iconId: "item_copper_enr",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_copper_powder",
    nameKey: "registry.item.item_copper_powder.name",
    iconId: "item_copper_powder",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_copper_nugget",
    nameKey: "registry.item.item_copper_nugget.name",
    iconId: "item_copper_nugget",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_copper_enr2",
    nameKey: "registry.item.item_copper_enr2.name",
    iconId: "item_copper_enr2",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_copper_enr2_cmpt",
    nameKey: "registry.item.item_copper_enr2_cmpt.name",
    iconId: "item_copper_enr2_cmpt",
    tags: ["调度券地区:武陵", "调度券价值:70"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_jar",
    nameKey: "registry.item.item_copper_jar.name",
    iconId: "item_copper_jar",
    tags: ["容器", "容器:气体"],
    displayOrder: 10000,
  },
  {
    id: "item_liquid_acid",
    nameKey: "registry.item.item_liquid_acid.name",
    iconId: "item_liquid_acid",
    tags: [
      "liquid",
      // AI-REMOVED 2026-09-14:
      // Reason: 手写颜色与现有美术配色表不一致，颜色改由 fluidColors 结构化字段承载。
      // Trigger: 用户要求 Registry 成为流体颜色的唯一运行时真源并退役颜色 tag。
      // Evidence: 美术表 item_liquid_acid.body=#ffeea0，旧 tag 为 #d97a1f。
      // Replacement: 本物品 fluidColors。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // "liquid_color:#d97a1f",
      "自然资源",
      "无限供应",
    ],
    fluidColors: { body: "#ffeea0", skin: "#ffd200", skin2: "#89462d", splash: "#ffebbb" },
    displayOrder: 10000,
  },
  {
    id: "item_liquid_copper",
    nameKey: "registry.item.item_liquid_copper.name",
    iconId: "item_liquid_copper",
    tags: [
      "liquid",
      // AI-REMOVED 2026-09-14:
      // Reason: 手写颜色与现有美术配色表不一致，颜色改由 fluidColors 结构化字段承载。
      // Trigger: 用户要求 Registry 成为流体颜色的唯一运行时真源并退役颜色 tag。
      // Evidence: 美术表 item_liquid_copper.body=#ff4800，旧 tag 为 #8b2a2a。
      // Replacement: 本物品 fluidColors。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // "liquid_color:#8b2a2a",
    ],
    fluidColors: { body: "#ff4800", skin: "#ff5300", skin2: "#ff0000", splash: "#ffaaac" },
    displayOrder: 10000,
  },
  {
    id: "item_liquid_copper_enr",
    nameKey: "registry.item.item_liquid_copper_enr.name",
    iconId: "item_liquid_copper_enr",
    tags: [
      "liquid",
      // AI-REMOVED 2026-09-14:
      // Reason: 手写颜色与现有美术配色表不一致，颜色改由 fluidColors 结构化字段承载。
      // Trigger: 用户要求 Registry 成为流体颜色的唯一运行时真源并退役颜色 tag。
      // Evidence: 美术表 item_liquid_copper_enr.body=#ff4800，旧 tag 为 #6b0f1a。
      // Replacement: 本物品 fluidColors。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // "liquid_color:#6b0f1a",
    ],
    fluidColors: { body: "#ff4800", skin: "#ff7400", skin2: "#ff7400", splash: "#ffb6ac" },
    displayOrder: 10000,
  },
  {
    id: "item_liquid_sewage",
    nameKey: "registry.item.item_liquid_sewage.name",
    iconId: "item_liquid_sewage",
    tags: [
      "liquid",
      // AI-REMOVED 2026-09-14:
      // Reason: 手写颜色与现有美术配色表不一致，颜色改由 fluidColors 结构化字段承载。
      // Trigger: 用户要求 Registry 成为流体颜色的唯一运行时真源并退役颜色 tag。
      // Evidence: 美术表 item_liquid_sewage.body=#290d05，旧 tag 为 #808080。
      // Replacement: 本物品 fluidColors。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // "liquid_color:#808080",
    ],
    fluidColors: { body: "#290d05", skin: "#82516c", skin2: "#1d020c", splash: "#a290ba" },
    displayOrder: 10000,
  },
  {
    id: "item_liquid_xiranite_poly",
    nameKey: "registry.item.item_liquid_xiranite_poly.name",
    iconId: "item_liquid_xiranite_poly",
    tags: [
      "liquid",
      // AI-REMOVED 2026-09-14:
      // Reason: 手写颜色与现有美术配色表不一致，颜色改由 fluidColors 结构化字段承载。
      // Trigger: 用户要求 Registry 成为流体颜色的唯一运行时真源并退役颜色 tag。
      // Evidence: 美术表 item_liquid_xiranite_poly.body=#11433b，旧 tag 为 #111111。
      // Replacement: 本物品 fluidColors。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // "liquid_color:#111111",
    ],
    fluidColors: { body: "#11433b", skin: "#00ceff", skin2: "#0f3724", splash: "#89b5a8" },
    displayOrder: 10000,
  },
  {
    id: "item_liquid_xiranite_lowpoly",
    nameKey: "registry.item.item_liquid_xiranite_lowpoly.name",
    iconId: "item_liquid_xiranite_lowpoly",
    tags: [
      "liquid",
      // AI-REMOVED 2026-09-14:
      // Reason: 手写颜色与现有美术配色表不一致，颜色改由 fluidColors 结构化字段承载。
      // Trigger: 用户要求 Registry 成为流体颜色的唯一运行时真源并退役颜色 tag。
      // Evidence: 美术表 item_liquid_xiranite_lowpoly.body=#062923，旧 tag 为 #4a2f1f。
      // Replacement: 本物品 fluidColors。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // "liquid_color:#4a2f1f",
    ],
    fluidColors: { body: "#062923", skin: "#22879f", skin2: "#0f3724", splash: "#71a59e" },
    displayOrder: 10000,
  },
  {
    id: "item_liquid_xiranite_enr",
    nameKey: "registry.item.item_liquid_xiranite_enr.name",
    iconId: "item_liquid_xiranite_enr",
    tags: [
      "liquid",
      // AI-REMOVED 2026-09-14:
      // Reason: 手写颜色与现有美术配色表不一致，颜色改由 fluidColors 结构化字段承载。
      // Trigger: 用户要求 Registry 成为流体颜色的唯一运行时真源并退役颜色 tag。
      // Evidence: 美术表 item_liquid_xiranite_enr.body=#fff799，旧 tag 为 #0e6a47。
      // Replacement: 本物品 fluidColors。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // "liquid_color:#0e6a47",
    ],
    fluidColors: { body: "#fff799", skin: "#e4e9c1", skin2: "#f1d200", splash: "#d1f3af" },
    displayOrder: 10000,
  },
  {
    id: "item_xiranite_poly",
    nameKey: "registry.item.item_xiranite_poly.name",
    iconId: "item_xiranite_poly",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_activity_xiranite_cmpt",
    nameKey: "registry.item.item_activity_xiranite_cmpt.name",
    iconId: "item_activity_xiranite_cmpt",
    tags: [ACTIVITY_LIMITED_FORMULA_1_TAG],
    displayOrder: 10000,
  },
  {
    id: "item_activity_xiranite_enr_cmpt",
    nameKey: "registry.item.item_activity_xiranite_enr_cmpt.name",
    iconId: "item_activity_xiranite_enr_cmpt",
    tags: [ACTIVITY_LIMITED_FORMULA_1_TAG],
    displayOrder: 10000,
  },
  {
    id: "item_activity_xiranite_bottle",
    nameKey: "registry.item.item_activity_xiranite_bottle.name",
    iconId: "item_activity_xiranite_bottle",
    tags: [ACTIVITY_LIMITED_FORMULA_1_TAG],
    displayOrder: 10000,
  },
  {
    id: "item_activity_xiranite_enr_bottle",
    nameKey: "registry.item.item_activity_xiranite_enr_bottle.name",
    iconId: "item_activity_xiranite_enr_bottle",
    tags: [ACTIVITY_LIMITED_FORMULA_1_TAG, "瓶子"],
    displayOrder: 10000,
  },
  {
    id: "item_activity_xiranite_nugget",
    nameKey: "registry.item.item_activity_xiranite_nugget.name",
    iconId: "item_activity_xiranite_nugget",
    tags: [ACTIVITY_LIMITED_FORMULA_2_TAG],
    displayOrder: 10000,
  },
  {
    id: "item_activity_xiranite_box",
    nameKey: "registry.item.item_activity_xiranite_box.name",
    iconId: "item_activity_xiranite_box",
    tags: [ACTIVITY_LIMITED_FORMULA_2_TAG],
    displayOrder: 10000,
  },
  {
    id: "item_activity_copper_xiranite_tool",
    nameKey: "registry.item.item_activity_copper_xiranite_tool.name",
    iconId: "item_activity_copper_xiranite_tool",
    tags: [ACTIVITY_LIMITED_FORMULA_2_TAG],
    displayOrder: 10000,
  },
  {
    id: "item_activity_xiranite_lung",
    nameKey: "registry.item.item_activity_xiranite_lung.name",
    iconId: "item_activity_xiranite_lung",
    tags: [ACTIVITY_LIMITED_FORMULA_2_TAG, "调度券地区:武陵", "调度券价值:100"],
    displayOrder: 10000,
  },
  {
    id: "item_activity_xiranite_enr_nugget",
    nameKey: "registry.item.item_activity_xiranite_enr_nugget.name",
    iconId: "item_activity_xiranite_enr_nugget",
    tags: [ACTIVITY_LIMITED_FORMULA_2_TAG],
    displayOrder: 10000,
  },
  {
    id: "item_activity_xiranite_enr_box",
    nameKey: "registry.item.item_activity_xiranite_enr_box.name",
    iconId: "item_activity_xiranite_enr_box",
    tags: [ACTIVITY_LIMITED_FORMULA_2_TAG],
    displayOrder: 10000,
  },
  {
    id: "item_activity_copper_poly_gas",
    nameKey: "registry.item.item_activity_copper_poly_gas.name",
    iconId: "item_activity_copper_poly_gas",
    tags: [ACTIVITY_LIMITED_FORMULA_2_TAG, "gas"],
    fluidColors: { body: "#ff0a0d", skin: "#5aa800" },
    displayOrder: 10000,
  },
  {
    id: "item_activity_copper_poly",
    nameKey: "registry.item.item_activity_copper_poly.name",
    iconId: "item_activity_copper_poly",
    tags: [ACTIVITY_LIMITED_FORMULA_2_TAG],
    displayOrder: 10000,
  },
  {
    id: "item_activity_copper_poly_cmpt",
    nameKey: "registry.item.item_activity_copper_poly_cmpt.name",
    iconId: "item_activity_copper_poly_cmpt",
    tags: [ACTIVITY_LIMITED_FORMULA_2_TAG],
    displayOrder: 10000,
  },
  {
    id: "item_activity_copper_poly_tool",
    nameKey: "registry.item.item_activity_copper_poly_tool.name",
    iconId: "item_activity_copper_poly_tool",
    tags: [ACTIVITY_LIMITED_FORMULA_2_TAG],
    displayOrder: 10000,
  },
  {
    id: "item_activity_xiranite_enr_lung",
    nameKey: "registry.item.item_activity_xiranite_enr_lung.name",
    iconId: "item_activity_xiranite_enr_lung",
    tags: [ACTIVITY_LIMITED_FORMULA_2_TAG, "调度券地区:武陵", "调度券价值:200"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_bottle_filled_liquid_acid",
    nameKey: "registry.item.item_iron_bottle_filled_liquid_acid.name",
    iconId: "item_iron_bottle_filled_liquid_acid",
    tags: ["瓶子", "瓶装液体", "container:item_iron_bottle", "container-item:item_liquid_acid"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_bottle_filled_liquid_copper",
    nameKey: "registry.item.item_iron_bottle_filled_liquid_copper.name",
    iconId: "item_iron_bottle_filled_liquid_copper",
    tags: ["瓶子", "瓶装液体", "container:item_iron_bottle", "container-item:item_liquid_copper"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_bottle_filled_liquid_copper_enr",
    nameKey: "registry.item.item_iron_bottle_filled_liquid_copper_enr.name",
    iconId: "item_iron_bottle_filled_liquid_copper_enr",
    tags: ["瓶子", "瓶装液体", "container:item_iron_bottle", "container-item:item_liquid_copper_enr"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_bottle_filled_liquid_xiranite_enr",
    nameKey: "registry.item.item_iron_bottle_filled_liquid_xiranite_enr.name",
    iconId: "item_iron_bottle_filled_liquid_xiranite_enr",
    tags: ["瓶子", "瓶装液体", "container:item_iron_bottle", "container-item:item_liquid_xiranite_enr"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_bottle_filled_liquid_acid",
    nameKey: "registry.item.item_glass_bottle_filled_liquid_acid.name",
    iconId: "item_glass_bottle_filled_liquid_acid",
    tags: ["瓶子", "瓶装液体", "container:item_glass_bottle", "container-item:item_liquid_acid"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_bottle_filled_liquid_copper",
    nameKey: "registry.item.item_glass_bottle_filled_liquid_copper.name",
    iconId: "item_glass_bottle_filled_liquid_copper",
    tags: ["瓶子", "瓶装液体", "container:item_glass_bottle", "container-item:item_liquid_copper"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_bottle_filled_liquid_copper_enr",
    nameKey: "registry.item.item_glass_bottle_filled_liquid_copper_enr.name",
    iconId: "item_glass_bottle_filled_liquid_copper_enr",
    tags: ["瓶子", "瓶装液体", "container:item_glass_bottle", "container-item:item_liquid_copper_enr"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_bottle_filled_liquid_xiranite_enr",
    nameKey: "registry.item.item_glass_bottle_filled_liquid_xiranite_enr.name",
    iconId: "item_glass_bottle_filled_liquid_xiranite_enr",
    tags: ["瓶子", "瓶装液体", "container:item_glass_bottle", "container-item:item_liquid_xiranite_enr"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_enr_bottle_filled_liquid_acid",
    nameKey: "registry.item.item_glass_enr_bottle_filled_liquid_acid.name",
    iconId: "item_glass_enr_bottle_filled_liquid_acid",
    tags: ["瓶子", "瓶装液体", "container:item_glass_enr_bottle", "container-item:item_liquid_acid"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_enr_bottle_filled_liquid_copper",
    nameKey: "registry.item.item_glass_enr_bottle_filled_liquid_copper.name",
    iconId: "item_glass_enr_bottle_filled_liquid_copper",
    tags: ["瓶子", "瓶装液体", "container:item_glass_enr_bottle", "container-item:item_liquid_copper"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_enr_bottle_filled_liquid_copper_enr",
    nameKey: "registry.item.item_glass_enr_bottle_filled_liquid_copper_enr.name",
    iconId: "item_glass_enr_bottle_filled_liquid_copper_enr",
    tags: ["瓶子", "瓶装液体", "container:item_glass_enr_bottle", "container-item:item_liquid_copper_enr"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_enr_bottle_filled_liquid_xiranite_enr",
    nameKey: "registry.item.item_glass_enr_bottle_filled_liquid_xiranite_enr.name",
    iconId: "item_glass_enr_bottle_filled_liquid_xiranite_enr",
    tags: ["瓶子", "瓶装液体", "container:item_glass_enr_bottle", "container-item:item_liquid_xiranite_enr"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_enr_bottle_filled_liquid_acid",
    nameKey: "registry.item.item_iron_enr_bottle_filled_liquid_acid.name",
    iconId: "item_iron_enr_bottle_filled_liquid_acid",
    tags: ["瓶子", "瓶装液体", "container:item_iron_enr_bottle", "container-item:item_liquid_acid"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_enr_bottle_filled_liquid_copper",
    nameKey: "registry.item.item_iron_enr_bottle_filled_liquid_copper.name",
    iconId: "item_iron_enr_bottle_filled_liquid_copper",
    tags: ["瓶子", "瓶装液体", "container:item_iron_enr_bottle", "container-item:item_liquid_copper"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_enr_bottle_filled_liquid_copper_enr",
    nameKey: "registry.item.item_iron_enr_bottle_filled_liquid_copper_enr.name",
    iconId: "item_iron_enr_bottle_filled_liquid_copper_enr",
    tags: ["瓶子", "瓶装液体", "container:item_iron_enr_bottle", "container-item:item_liquid_copper_enr"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_enr_bottle_filled_liquid_xiranite_enr",
    nameKey: "registry.item.item_iron_enr_bottle_filled_liquid_xiranite_enr.name",
    iconId: "item_iron_enr_bottle_filled_liquid_xiranite_enr",
    tags: ["瓶子", "瓶装液体", "container:item_iron_enr_bottle", "container-item:item_liquid_xiranite_enr"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_bottle_filled_liquid_acid",
    nameKey: "registry.item.item_copper_bottle_filled_liquid_acid.name",
    iconId: "item_copper_bottle_filled_liquid_acid",
    tags: ["瓶子", "瓶装液体", "container:item_copper_bottle", "container-item:item_liquid_acid"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_bottle_filled_liquid_copper",
    nameKey: "registry.item.item_copper_bottle_filled_liquid_copper.name",
    iconId: "item_copper_bottle_filled_liquid_copper",
    tags: ["瓶子", "瓶装液体", "container:item_copper_bottle", "container-item:item_liquid_copper"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_bottle_filled_liquid_copper_enr",
    nameKey: "registry.item.item_copper_bottle_filled_liquid_copper_enr.name",
    iconId: "item_copper_bottle_filled_liquid_copper_enr",
    tags: ["瓶子", "瓶装液体", "container:item_copper_bottle", "container-item:item_liquid_copper_enr"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_bottle_filled_liquid_xiranite_enr",
    nameKey: "registry.item.item_copper_bottle_filled_liquid_xiranite_enr.name",
    iconId: "item_copper_bottle_filled_liquid_xiranite_enr",
    tags: ["瓶子", "瓶装液体", "container:item_copper_bottle", "container-item:item_liquid_xiranite_enr"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_enr_bottle_filled_liquid_acid",
    nameKey: "registry.item.item_copper_enr_bottle_filled_liquid_acid.name",
    iconId: "item_copper_enr_bottle_filled_liquid_acid",
    tags: ["瓶子", "瓶装液体", "container:item_copper_enr_bottle", "container-item:item_liquid_acid"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_enr_bottle_filled_liquid_copper",
    nameKey: "registry.item.item_copper_enr_bottle_filled_liquid_copper.name",
    iconId: "item_copper_enr_bottle_filled_liquid_copper",
    tags: ["瓶子", "瓶装液体", "container:item_copper_enr_bottle", "container-item:item_liquid_copper"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_enr_bottle_filled_liquid_copper_enr",
    nameKey: "registry.item.item_copper_enr_bottle_filled_liquid_copper_enr.name",
    iconId: "item_copper_enr_bottle_filled_liquid_copper_enr",
    tags: ["瓶子", "瓶装液体", "container:item_copper_enr_bottle", "container-item:item_liquid_copper_enr"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_enr_bottle_filled_liquid_xiranite_enr",
    nameKey: "registry.item.item_copper_enr_bottle_filled_liquid_xiranite_enr.name",
    iconId: "item_copper_enr_bottle_filled_liquid_xiranite_enr",
    tags: ["瓶子", "瓶装液体", "container:item_copper_enr_bottle", "container-item:item_liquid_xiranite_enr"],
    displayOrder: 10000,
  },
  {
    id: "item_activity_xiranite_enr_bottle_filled_liquid_plant_grass_2",
    nameKey: "registry.item.item_activity_xiranite_enr_bottle_filled_liquid_plant_grass_2.name",
    iconId: "item_activity_xiranite_enr_bottle_filled_liquid_plant_grass_2",
    tags: [ACTIVITY_LIMITED_FORMULA_1_TAG, "瓶子", "瓶装液体", "container:item_activity_xiranite_enr_bottle", "container-item:item_liquid_plant_grass_2"],
    displayOrder: 10000,
  },
  {
    id: "item_activity_xiranite_enr_tool",
    nameKey: "registry.item.item_activity_xiranite_enr_tool.name",
    iconId: "item_activity_xiranite_enr_tool",
    tags: [ACTIVITY_LIMITED_FORMULA_1_TAG],
    displayOrder: 10000,
  },
  {
    id: "item_activity_xiranite_hulu",
    nameKey: "registry.item.item_activity_xiranite_hulu.name",
    iconId: "item_activity_xiranite_hulu",
    tags: [ACTIVITY_LIMITED_FORMULA_1_TAG, "调度券地区:武陵", "调度券价值:40"],
    displayOrder: 10000,
  },
  {
    id: "item_activity_xiranite_enr_hulu",
    nameKey: "registry.item.item_activity_xiranite_enr_hulu.name",
    iconId: "item_activity_xiranite_enr_hulu",
    tags: [ACTIVITY_LIMITED_FORMULA_1_TAG, "调度券地区:武陵", "调度券价值:120"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_cmpt",
    nameKey: "registry.item.item_copper_cmpt.name",
    iconId: "item_copper_cmpt",
    tags: ["调度券地区:武陵", "调度券价值:1"],
    displayOrder: 10000,
  },
  {
    id: "item_copper_enr_cmpt",
    nameKey: "registry.item.item_copper_enr_cmpt.name",
    iconId: "item_copper_enr_cmpt",
    tags: ["调度券地区:武陵", "调度券价值:48"],
    displayOrder: 10000,
  },
  {
    id: "item_equip_script_1",
    nameKey: "registry.item.item_equip_script_1.name",
    iconId: "item_equip_script_1",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_equip_script_2",
    nameKey: "registry.item.item_equip_script_2.name",
    iconId: "item_equip_script_2",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_equip_script_3",
    nameKey: "registry.item.item_equip_script_3.name",
    iconId: "item_equip_script_3",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_equip_script_4",
    nameKey: "registry.item.item_equip_script_4.name",
    iconId: "item_equip_script_4",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_equip_script_4_1",
    nameKey: "registry.item.item_equip_script_4_1.name",
    iconId: "item_equip_script_4_1",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_equip_script_4_2",
    nameKey: "registry.item.item_equip_script_4_2.name",
    iconId: "item_equip_script_4_2",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_equip_script_4_3",
    nameKey: "registry.item.item_equip_script_4_3.name",
    iconId: "item_equip_script_4_3",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_filter_core",
    nameKey: "registry.item.item_filter_core.name",
    iconId: "item_filter_core",
    tags: ["调度券地区:武陵", "调度券价值:1"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_bottle",
    nameKey: "registry.item.item_glass_bottle.name",
    iconId: "item_glass_bottle",
    tags: ["瓶子", "调度券地区:四号谷地", "调度券价值:2"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_bottle_filled_water",
    nameKey: "registry.item.item_glass_bottle_filled_water.name",
    iconId: "item_glass_bottle_filled_water",
    tags: ["瓶子", "瓶装液体", "container:item_glass_bottle", "container-item:item_liquid_water"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_bottle_filled_liquid_plant_grass_1",
    nameKey: "registry.item.item_glass_bottle_filled_liquid_plant_grass_1.name",
    iconId: "item_glass_bottle_filled_liquid_plant_grass_1",
    tags: ["瓶子", "瓶装液体", "container:item_glass_bottle", "container-item:item_liquid_plant_grass_1"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_bottle_filled_liquid_plant_grass_2",
    nameKey: "registry.item.item_glass_bottle_filled_liquid_plant_grass_2.name",
    iconId: "item_glass_bottle_filled_liquid_plant_grass_2",
    tags: ["瓶子", "瓶装液体", "container:item_glass_bottle", "container-item:item_liquid_plant_grass_2"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_bottle_filled_liquid_xiranite",
    nameKey: "registry.item.item_glass_bottle_filled_liquid_xiranite.name",
    iconId: "item_glass_bottle_filled_liquid_xiranite",
    tags: ["瓶子", "瓶装液体", "container:item_glass_bottle", "container-item:item_liquid_xiranite"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_bottle_filled_liquid_sewage",
    nameKey: "registry.item.item_glass_bottle_filled_liquid_sewage.name",
    iconId: "item_glass_bottle_filled_liquid_sewage",
    tags: ["瓶子", "瓶装液体", "container:item_glass_bottle", "container-item:item_liquid_sewage"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_bottle_filled_liquid_xiranite_poly",
    nameKey: "registry.item.item_glass_bottle_filled_liquid_xiranite_poly.name",
    iconId: "item_glass_bottle_filled_liquid_xiranite_poly",
    tags: ["瓶子", "瓶装液体", "container:item_glass_bottle", "container-item:item_liquid_xiranite_poly"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_bottle_filled_liquid_xiranite_lowpoly",
    nameKey: "registry.item.item_glass_bottle_filled_liquid_xiranite_lowpoly.name",
    iconId: "item_glass_bottle_filled_liquid_xiranite_lowpoly",
    tags: ["瓶子", "瓶装液体", "container:item_glass_bottle", "container-item:item_liquid_xiranite_lowpoly"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_cmpt",
    nameKey: "registry.item.item_glass_cmpt.name",
    iconId: "item_glass_cmpt",
    tags: ["调度券地区:四号谷地", "调度券价值:1"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_enr_bottle",
    nameKey: "registry.item.item_glass_enr_bottle.name",
    iconId: "item_glass_enr_bottle",
    tags: ["瓶子"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_enr_bottle_filled_water",
    nameKey: "registry.item.item_glass_enr_bottle_filled_water.name",
    iconId: "item_glass_enr_bottle_filled_water",
    tags: ["瓶子", "瓶装液体", "container:item_glass_enr_bottle", "container-item:item_liquid_water"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_enr_bottle_filled_liquid_plant_grass_1",
    nameKey: "registry.item.item_glass_enr_bottle_filled_liquid_plant_grass_1.name",
    iconId: "item_glass_enr_bottle_filled_liquid_plant_grass_1",
    tags: ["瓶子", "瓶装液体", "container:item_glass_enr_bottle", "container-item:item_liquid_plant_grass_1"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_enr_bottle_filled_liquid_plant_grass_2",
    nameKey: "registry.item.item_glass_enr_bottle_filled_liquid_plant_grass_2.name",
    iconId: "item_glass_enr_bottle_filled_liquid_plant_grass_2",
    tags: ["瓶子", "瓶装液体", "container:item_glass_enr_bottle", "container-item:item_liquid_plant_grass_2"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_enr_bottle_filled_liquid_xiranite",
    nameKey: "registry.item.item_glass_enr_bottle_filled_liquid_xiranite.name",
    iconId: "item_glass_enr_bottle_filled_liquid_xiranite",
    tags: ["瓶子", "瓶装液体", "container:item_glass_enr_bottle", "container-item:item_liquid_xiranite"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_enr_bottle_filled_liquid_sewage",
    nameKey: "registry.item.item_glass_enr_bottle_filled_liquid_sewage.name",
    iconId: "item_glass_enr_bottle_filled_liquid_sewage",
    tags: ["瓶子", "瓶装液体", "container:item_glass_enr_bottle", "container-item:item_liquid_sewage"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_enr_bottle_filled_liquid_xiranite_poly",
    nameKey: "registry.item.item_glass_enr_bottle_filled_liquid_xiranite_poly.name",
    iconId: "item_glass_enr_bottle_filled_liquid_xiranite_poly",
    tags: ["瓶子", "瓶装液体", "container:item_glass_enr_bottle", "container-item:item_liquid_xiranite_poly"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_enr_bottle_filled_liquid_xiranite_lowpoly",
    nameKey: "registry.item.item_glass_enr_bottle_filled_liquid_xiranite_lowpoly.name",
    iconId: "item_glass_enr_bottle_filled_liquid_xiranite_lowpoly",
    tags: ["瓶子", "瓶装液体", "container:item_glass_enr_bottle", "container-item:item_liquid_xiranite_lowpoly"],
    displayOrder: 10000,
  },
  {
    id: "item_glass_enr_cmpt",
    nameKey: "registry.item.item_glass_enr_cmpt.name",
    iconId: "item_glass_enr_cmpt",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_iron_bottle",
    nameKey: "registry.item.item_iron_bottle.name",
    iconId: "item_iron_bottle",
    tags: ["瓶子"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_bottle_filled_water",
    nameKey: "registry.item.item_iron_bottle_filled_water.name",
    iconId: "item_iron_bottle_filled_water",
    tags: ["瓶子", "瓶装液体", "container:item_iron_bottle", "container-item:item_liquid_water"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_bottle_filled_liquid_plant_grass_1",
    nameKey: "registry.item.item_iron_bottle_filled_liquid_plant_grass_1.name",
    iconId: "item_iron_bottle_filled_liquid_plant_grass_1",
    tags: ["瓶子", "瓶装液体", "container:item_iron_bottle", "container-item:item_liquid_plant_grass_1"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_bottle_filled_liquid_plant_grass_2",
    nameKey: "registry.item.item_iron_bottle_filled_liquid_plant_grass_2.name",
    iconId: "item_iron_bottle_filled_liquid_plant_grass_2",
    tags: ["瓶子", "瓶装液体", "container:item_iron_bottle", "container-item:item_liquid_plant_grass_2"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_bottle_filled_liquid_xiranite",
    nameKey: "registry.item.item_iron_bottle_filled_liquid_xiranite.name",
    iconId: "item_iron_bottle_filled_liquid_xiranite",
    tags: ["瓶子", "瓶装液体", "container:item_iron_bottle", "container-item:item_liquid_xiranite"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_bottle_filled_liquid_sewage",
    nameKey: "registry.item.item_iron_bottle_filled_liquid_sewage.name",
    iconId: "item_iron_bottle_filled_liquid_sewage",
    tags: ["瓶子", "瓶装液体", "container:item_iron_bottle", "container-item:item_liquid_sewage"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_bottle_filled_liquid_xiranite_poly",
    nameKey: "registry.item.item_iron_bottle_filled_liquid_xiranite_poly.name",
    iconId: "item_iron_bottle_filled_liquid_xiranite_poly",
    tags: ["瓶子", "瓶装液体", "container:item_iron_bottle", "container-item:item_liquid_xiranite_poly"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_bottle_filled_liquid_xiranite_lowpoly",
    nameKey: "registry.item.item_iron_bottle_filled_liquid_xiranite_lowpoly.name",
    iconId: "item_iron_bottle_filled_liquid_xiranite_lowpoly",
    tags: ["瓶子", "瓶装液体", "container:item_iron_bottle", "container-item:item_liquid_xiranite_lowpoly"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_cmpt",
    nameKey: "registry.item.item_iron_cmpt.name",
    iconId: "item_iron_cmpt",
    tags: ["调度券地区:四号谷地", "调度券价值:1"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_enr",
    nameKey: "registry.item.item_iron_enr.name",
    iconId: "item_iron_enr",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_iron_enr_bottle",
    nameKey: "registry.item.item_iron_enr_bottle.name",
    iconId: "item_iron_enr_bottle",
    tags: ["瓶子"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_enr_bottle_filled_water",
    nameKey: "registry.item.item_iron_enr_bottle_filled_water.name",
    iconId: "item_iron_enr_bottle_filled_water",
    tags: ["瓶子", "瓶装液体", "container:item_iron_enr_bottle", "container-item:item_liquid_water"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_enr_bottle_filled_liquid_plant_grass_1",
    nameKey: "registry.item.item_iron_enr_bottle_filled_liquid_plant_grass_1.name",
    iconId: "item_iron_enr_bottle_filled_liquid_plant_grass_1",
    tags: ["瓶子", "瓶装液体", "container:item_iron_enr_bottle", "container-item:item_liquid_plant_grass_1"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_enr_bottle_filled_liquid_plant_grass_2",
    nameKey: "registry.item.item_iron_enr_bottle_filled_liquid_plant_grass_2.name",
    iconId: "item_iron_enr_bottle_filled_liquid_plant_grass_2",
    tags: ["瓶子", "瓶装液体", "container:item_iron_enr_bottle", "container-item:item_liquid_plant_grass_2"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_enr_bottle_filled_liquid_xiranite",
    nameKey: "registry.item.item_iron_enr_bottle_filled_liquid_xiranite.name",
    iconId: "item_iron_enr_bottle_filled_liquid_xiranite",
    tags: ["瓶子", "瓶装液体", "container:item_iron_enr_bottle", "container-item:item_liquid_xiranite"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_enr_bottle_filled_liquid_sewage",
    nameKey: "registry.item.item_iron_enr_bottle_filled_liquid_sewage.name",
    iconId: "item_iron_enr_bottle_filled_liquid_sewage",
    tags: ["瓶子", "瓶装液体", "container:item_iron_enr_bottle", "container-item:item_liquid_sewage"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_enr_bottle_filled_liquid_xiranite_poly",
    nameKey: "registry.item.item_iron_enr_bottle_filled_liquid_xiranite_poly.name",
    iconId: "item_iron_enr_bottle_filled_liquid_xiranite_poly",
    tags: ["瓶子", "瓶装液体", "container:item_iron_enr_bottle", "container-item:item_liquid_xiranite_poly"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_enr_bottle_filled_liquid_xiranite_lowpoly",
    nameKey: "registry.item.item_iron_enr_bottle_filled_liquid_xiranite_lowpoly.name",
    iconId: "item_iron_enr_bottle_filled_liquid_xiranite_lowpoly",
    tags: ["瓶子", "瓶装液体", "container:item_iron_enr_bottle", "container-item:item_liquid_xiranite_lowpoly"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_enr_cmpt",
    nameKey: "registry.item.item_iron_enr_cmpt.name",
    iconId: "item_iron_enr_cmpt",
    tags: ["调度券地区:四号谷地", "调度券价值:3"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_enr_powder",
    nameKey: "registry.item.item_iron_enr_powder.name",
    iconId: "item_iron_enr_powder",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_iron_nugget",
    nameKey: "registry.item.item_iron_nugget.name",
    iconId: "item_iron_nugget",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_iron_ore",
    nameKey: "registry.item.item_iron_ore.name",
    iconId: "item_iron_ore",
    tags: ["矿石", "自然资源"],
    displayOrder: 10000,
  },
  {
    id: "item_iron_powder",
    nameKey: "registry.item.item_iron_powder.name",
    iconId: "item_iron_powder",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_liquid_plant_grass_1",
    nameKey: "registry.item.item_liquid_plant_grass_1.name",
    iconId: "item_liquid_plant_grass_1",
    tags: [
      "liquid",
      // AI-REMOVED 2026-09-14:
      // Reason: 手写颜色与现有美术配色表不一致，颜色改由 fluidColors 结构化字段承载。
      // Trigger: 用户要求 Registry 成为流体颜色的唯一运行时真源并退役颜色 tag。
      // Evidence: 美术表 item_liquid_plant_grass_1.body=#0c844b，旧 tag 为 #35c8b6。
      // Replacement: 本物品 fluidColors。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // "liquid_color:#35c8b6",
    ],
    fluidColors: { body: "#0c844b", skin: "#26b938", skin2: "#14601e", splash: "#c0f5c2" },
    displayOrder: 10000,
  },
  {
    id: "item_liquid_plant_grass_2",
    nameKey: "registry.item.item_liquid_plant_grass_2.name",
    iconId: "item_liquid_plant_grass_2",
    tags: [
      "liquid",
      // AI-REMOVED 2026-09-14:
      // Reason: 手写颜色与现有美工配色表不一致，颜色改由 fluidColors 结构化字段承载。
      // Trigger: 用户要求 Registry 成为流体颜色的唯一运行时真源并退役颜色 tag。
      // Evidence: 美术表 item_liquid_plant_grass_2.body=#137669，旧 tag 为 #9be870。
      // Replacement: 本物品 fluidColors。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // "liquid_color:#9be870",
    ],
    fluidColors: { body: "#137669", skin: "#2bd115", skin2: "#153c24", splash: "#9ad39a" },
    displayOrder: 10000,
  },
  {
    id: "item_liquid_water",
    nameKey: "registry.item.item_liquid_water.name",
    iconId: "item_liquid_water",
    tags: [
      "liquid",
      // AI-REMOVED 2026-09-14:
      // Reason: 手写颜色与现有美术配色表不一致，颜色改由 fluidColors 结构化字段承载。
      // Trigger: 用户要求 Registry 成为流体颜色的唯一运行时真源并退役颜色 tag。
      // Evidence: 美术表 item_liquid_water.body=#5c9fe0，旧 tag 为 #82d6ff。
      // Replacement: 本物品 fluidColors。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // "liquid_color:#82d6ff",
      "自然资源",
      "无限供应",
    ],
    fluidColors: { body: "#5c9fe0", skin: "#52b1d1", skin2: "#07243a", splash: "#afe7ee" },
    displayOrder: 10000,
  },
  {
    id: "item_liquid_xiranite",
    nameKey: "registry.item.item_liquid_xiranite.name",
    iconId: "item_liquid_xiranite",
    tags: [
      "liquid",
      // AI-REMOVED 2026-09-14:
      // Reason: 手写颜色与现有美术配色表不一致，颜色改由 fluidColors 结构化字段承载。
      // Trigger: 用户要求 Registry 成为流体颜色的唯一运行时真源并退役颜色 tag。
      // Evidence: 美术表 item_liquid_xiranite.body=#fff699，旧 tag 为 #1f7a3a。
      // Replacement: 本物品 fluidColors。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // "liquid_color:#1f7a3a",
    ],
    fluidColors: { body: "#fff699", skin: "#ffffcb", skin2: "#f8ec9b", splash: "#c5d7b6" },
    displayOrder: 10000,
  },
  {
    id: "item_gas_inert",
    nameKey: "registry.item.item_gas_inert.name",
    iconId: "item_gas_inert",
    tags: [
      "gas",
      // AI-REMOVED 2026-09-14:
      // Reason: 手写颜色与现有美术配色表不一致，颜色改由 fluidColors 结构化字段承载。
      // Trigger: 用户要求 Registry 成为流体颜色的唯一运行时真源并退役颜色 tag。
      // Evidence: 美术表 item_gas_inert.body=#00d5ff，旧 tag 为 #3366cc。
      // Replacement: 本物品 fluidColors。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // "gas_color:#3366cc",
      "自然资源",
    ],
    fluidColors: { body: "#00d5ff", skin: "#6bf7ff" },
    displayOrder: 10000,
  },
  {
    id: "item_gas_xiranite",
    nameKey: "registry.item.item_gas_xiranite.name",
    iconId: "item_gas_xiranite",
    tags: [
      "gas",
      // AI-REMOVED 2026-09-14:
      // Reason: 手写颜色与现有美术配色表不一致，颜色改由 fluidColors 结构化字段承载。
      // Trigger: 用户要求 Registry 成为流体颜色的唯一运行时真源并退役颜色 tag。
      // Evidence: 美术表 item_gas_xiranite.body=#8bc048，旧 tag 为 #62bf4b。
      // Replacement: 本物品 fluidColors。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // "gas_color:#62bf4b",
      "自然资源",
    ],
    fluidColors: { body: "#8bc048", skin: "#8fb56c" },
    displayOrder: 10000,
  },
  {
    id: "item_gas_xiranite_enr",
    nameKey: "registry.item.item_gas_xiranite_enr.name",
    iconId: "item_gas_xiranite_enr",
    tags: ["gas"],
    fluidColors: { body: "#d3eebc", skin: "#8eff00" },
    displayOrder: 10000,
  },
  {
    id: "item_gas_copper",
    nameKey: "registry.item.item_gas_copper.name",
    iconId: "item_gas_copper",
    tags: ["gas"],
    fluidColors: { body: "#b44c34", skin: "#d16f50" },
    displayOrder: 10000,
  },
  {
    id: "item_gas_copper_enr",
    nameKey: "registry.item.item_gas_copper_enr.name",
    iconId: "item_gas_copper_enr",
    tags: ["gas"],
    fluidColors: { body: "#c32d2d", skin: "#ff8e01" },
    displayOrder: 10000,
  },
  {
    id: "item_gas_water",
    nameKey: "registry.item.item_gas_water.name",
    iconId: "item_gas_water",
    tags: ["gas"],
    fluidColors: { body: "#ffffff", skin: "#51b4f8" },
    displayOrder: 10000,
  },
  {
    id: "item_gas_copper_enr2",
    nameKey: "registry.item.item_gas_copper_enr2.name",
    iconId: "item_gas_copper_enr2",
    tags: ["gas"],
    fluidColors: { body: "#fa911e", skin: "#ff9500" },
    displayOrder: 10000,
  },
  {
    id: "item_gasjar_copper_gas_acid",
    nameKey: "registry.item.item_gasjar_copper_gas_acid.name",
    iconId: "item_gasjar_copper_gas_acid",
    tags: ["container:item_copper_jar", "container-item:item_gas_acid"],
    displayOrder: 10000,
  },
  {
    id: "item_gasjar_copper_gas_copper",
    nameKey: "registry.item.item_gasjar_copper_gas_copper.name",
    iconId: "item_gasjar_copper_gas_copper",
    tags: ["container:item_copper_jar", "container-item:item_gas_copper"],
    displayOrder: 10000,
  },
  {
    id: "item_gasjar_copper_gas_copper_enr",
    nameKey: "registry.item.item_gasjar_copper_gas_copper_enr.name",
    iconId: "item_gasjar_copper_gas_copper_enr",
    tags: ["container:item_copper_jar", "container-item:item_gas_copper_enr"],
    displayOrder: 10000,
  },
  {
    id: "item_gasjar_copper_gas_copper_enr2",
    nameKey: "registry.item.item_gasjar_copper_gas_copper_enr2.name",
    iconId: "item_gasjar_copper_gas_copper_enr2",
    tags: ["container:item_copper_jar", "container-item:item_gas_copper_enr2"],
    displayOrder: 10000,
  },
  {
    id: "item_gasjar_copper_gas_inert",
    nameKey: "registry.item.item_gasjar_copper_gas_inert.name",
    iconId: "item_gasjar_copper_gas_inert",
    tags: ["container:item_copper_jar", "container-item:item_gas_inert"],
    displayOrder: 10000,
  },
  {
    id: "item_gasjar_copper_gas_water",
    nameKey: "registry.item.item_gasjar_copper_gas_water.name",
    iconId: "item_gasjar_copper_gas_water",
    tags: ["container:item_copper_jar", "container-item:item_gas_water"],
    displayOrder: 10000,
  },
  {
    id: "item_gasjar_copper_gas_xiranite",
    nameKey: "registry.item.item_gasjar_copper_gas_xiranite.name",
    iconId: "item_gasjar_copper_gas_xiranite",
    tags: ["container:item_copper_jar", "container-item:item_gas_xiranite"],
    displayOrder: 10000,
  },
  {
    id: "item_gasjar_copper_gas_xiranite_enr",
    nameKey: "registry.item.item_gasjar_copper_gas_xiranite_enr.name",
    iconId: "item_gasjar_copper_gas_xiranite_enr",
    tags: ["container:item_copper_jar", "container-item:item_gas_xiranite_enr"],
    displayOrder: 10000,
  },
  {
    id: "item_muck_feces_1",
    nameKey: "registry.item.item_muck_feces_1.name",
    iconId: "item_muck_feces_1",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_muck_xiranite_1",
    nameKey: "registry.item.item_muck_xiranite_1.name",
    iconId: "item_muck_xiranite_1",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_originium_enr_powder",
    nameKey: "registry.item.item_originium_enr_powder.name",
    iconId: "item_originium_enr_powder",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_originium_ore",
    nameKey: "registry.item.item_originium_ore.name",
    iconId: "item_originium_ore",
    tags: ["矿石", "自然资源"],
    displayOrder: 10000,
  },
  {
    id: "item_originium_powder",
    nameKey: "registry.item.item_originium_powder.name",
    iconId: "item_originium_powder",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_bbflower_1",
    nameKey: "registry.item.item_plant_bbflower_1.name",
    iconId: "item_plant_bbflower_1",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_bbflower_powder_1",
    nameKey: "registry.item.item_plant_bbflower_powder_1.name",
    iconId: "item_plant_bbflower_powder_1",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_bbflower_seed_1",
    nameKey: "registry.item.item_plant_bbflower_seed_1.name",
    iconId: "item_plant_bbflower_seed_1",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_grass_1",
    nameKey: "registry.item.item_plant_grass_1.name",
    iconId: "item_plant_grass_1",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_grass_2",
    nameKey: "registry.item.item_plant_grass_2.name",
    iconId: "item_plant_grass_2",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_grass_powder_1",
    nameKey: "registry.item.item_plant_grass_powder_1.name",
    iconId: "item_plant_grass_powder_1",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_grass_powder_2",
    nameKey: "registry.item.item_plant_grass_powder_2.name",
    iconId: "item_plant_grass_powder_2",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_grass_seed_1",
    nameKey: "registry.item.item_plant_grass_seed_1.name",
    iconId: "item_plant_grass_seed_1",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_grass_seed_2",
    nameKey: "registry.item.item_plant_grass_seed_2.name",
    iconId: "item_plant_grass_seed_2",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_moss_1",
    nameKey: "registry.item.item_plant_moss_1.name",
    iconId: "item_plant_moss_1",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_moss_2",
    nameKey: "registry.item.item_plant_moss_2.name",
    iconId: "item_plant_moss_2",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_moss_3",
    nameKey: "registry.item.item_plant_moss_3.name",
    iconId: "item_plant_moss_3",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_moss_enr_powder_1",
    nameKey: "registry.item.item_plant_moss_enr_powder_1.name",
    iconId: "item_plant_moss_enr_powder_1",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_moss_enr_powder_2",
    nameKey: "registry.item.item_plant_moss_enr_powder_2.name",
    iconId: "item_plant_moss_enr_powder_2",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_moss_powder_1",
    nameKey: "registry.item.item_plant_moss_powder_1.name",
    iconId: "item_plant_moss_powder_1",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_moss_powder_2",
    nameKey: "registry.item.item_plant_moss_powder_2.name",
    iconId: "item_plant_moss_powder_2",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_moss_powder_3",
    nameKey: "registry.item.item_plant_moss_powder_3.name",
    iconId: "item_plant_moss_powder_3",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_moss_seed_1",
    nameKey: "registry.item.item_plant_moss_seed_1.name",
    iconId: "item_plant_moss_seed_1",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_moss_seed_2",
    nameKey: "registry.item.item_plant_moss_seed_2.name",
    iconId: "item_plant_moss_seed_2",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_moss_seed_3",
    nameKey: "registry.item.item_plant_moss_seed_3.name",
    iconId: "item_plant_moss_seed_3",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_sp_1",
    nameKey: "registry.item.item_plant_sp_1.name",
    iconId: "item_plant_sp_1",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_sp_2",
    nameKey: "registry.item.item_plant_sp_2.name",
    iconId: "item_plant_sp_2",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_sp_3",
    nameKey: "registry.item.item_plant_sp_3.name",
    iconId: "item_plant_sp_3",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_sp_4",
    nameKey: "registry.item.item_plant_sp_4.name",
    iconId: "item_plant_sp_4",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_sp_seed_1",
    nameKey: "registry.item.item_plant_sp_seed_1.name",
    iconId: "item_plant_sp_seed_1",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_sp_seed_2",
    nameKey: "registry.item.item_plant_sp_seed_2.name",
    iconId: "item_plant_sp_seed_2",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_sp_seed_3",
    nameKey: "registry.item.item_plant_sp_seed_3.name",
    iconId: "item_plant_sp_seed_3",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_sp_seed_4",
    nameKey: "registry.item.item_plant_sp_seed_4.name",
    iconId: "item_plant_sp_seed_4",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_plant_tundra_wood",
    nameKey: "registry.item.item_plant_tundra_wood.name",
    iconId: "item_plant_tundra_wood",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_proc_battery_1",
    nameKey: "registry.item.item_proc_battery_1.name",
    iconId: "item_proc_battery_1",
    tags: ["调度券地区:四号谷地", "调度券价值:16"],
    displayOrder: 10000,
  },
  {
    id: "item_proc_battery_2",
    nameKey: "registry.item.item_proc_battery_2.name",
    iconId: "item_proc_battery_2",
    tags: ["调度券地区:四号谷地", "调度券价值:30"],
    displayOrder: 10000,
  },
  {
    id: "item_proc_battery_3",
    nameKey: "registry.item.item_proc_battery_3.name",
    iconId: "item_proc_battery_3",
    tags: ["调度券地区:四号谷地", "调度券价值:70"],
    displayOrder: 10000,
  },
  {
    id: "item_proc_battery_4",
    nameKey: "registry.item.item_proc_battery_4.name",
    iconId: "item_proc_battery_4",
    tags: ["调度券地区:武陵", "调度券价值:25"],
    displayOrder: 10000,
  },
  {
    id: "item_proc_battery_5",
    nameKey: "registry.item.item_proc_battery_5.name",
    iconId: "item_proc_battery_5",
    tags: ["调度券地区:武陵", "调度券价值:54"],
    displayOrder: 10000,
  },
  {
    id: "item_proc_bomb_1",
    nameKey: "registry.item.item_proc_bomb_1.name",
    iconId: "item_proc_bomb_1",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_quartz_enr",
    nameKey: "registry.item.item_quartz_enr.name",
    iconId: "item_quartz_enr",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_quartz_enr_powder",
    nameKey: "registry.item.item_quartz_enr_powder.name",
    iconId: "item_quartz_enr_powder",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_quartz_glass",
    nameKey: "registry.item.item_quartz_glass.name",
    iconId: "item_quartz_glass",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_quartz_powder",
    nameKey: "registry.item.item_quartz_powder.name",
    iconId: "item_quartz_powder",
    tags: [],
    displayOrder: 10000,
  },
  {
    id: "item_quartz_sand",
    nameKey: "registry.item.item_quartz_sand.name",
    iconId: "item_quartz_sand",
    tags: ["矿石", "自然资源"],
    displayOrder: 10000,
  },
  {
    id: "item_xiranite_enr_powder",
    nameKey: "registry.item.item_xiranite_enr_powder.name",
    iconId: "item_xiranite_enr_powder",
    tags: ["调度券地区:武陵", "调度券价值:27"],
    displayOrder: 10000,
  },
  {
    id: "item_xiranite_powder",
    nameKey: "registry.item.item_xiranite_powder.name",
    iconId: "item_xiranite_powder",
    tags: ["调度券地区:武陵", "调度券价值:1"],
    displayOrder: 10000,
  },
  {
    id: "item_gas_acid",
    nameKey: "registry.item.item_gas_acid.name",
    iconId: "item_gas_acid",
    tags: [
      "gas",
      // AI-REMOVED 2026-09-14:
      // Reason: 手写颜色与现有美术配色表不一致，颜色改由 fluidColors 结构化字段承载。
      // Trigger: 用户要求 Registry 成为流体颜色的唯一运行时真源并退役颜色 tag。
      // Evidence: 美术表 item_gas_acid.body=#e5c95e，旧 tag 为 #f0b840。
      // Replacement: 本物品 fluidColors。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // "gas_color:#f0b840",
    ],
    fluidColors: { body: "#e5c95e", skin: "#c9aa1a" },
    displayOrder: 10000,
  },
];
