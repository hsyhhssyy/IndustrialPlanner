import { describe, expect, it } from "vitest";

import { ITEM_DEFINITIONS } from "@/registry/item-definition";
import { RECIPE_DEFINITIONS } from "@/registry/recipe-definition";
import { lookupText } from "@/shared/i18n";
import {
  ACTIVITY_LIMITED_FORMULA_1_TAG,
  ACTIVITY_LIMITED_FORMULA_2_TAG,
} from "@/shared/registry/activity-availability";

const PRIOR_ACTIVITY_ITEM_IDS = [
  "item_activity_xiranite_bottle",
  "item_activity_xiranite_cmpt",
  "item_activity_xiranite_enr_bottle",
  "item_activity_xiranite_enr_cmpt",
] as const;

const PRIOR_ACTIVITY_RECIPE_IDS = [
  "r_component_activity_xiranite_cmpt_from_xiranite_powder_basic",
  "r_component_activity_xiranite_enr_cmpt_from_xiranite_enr_powder_basic",
  "r_shaper_activity_xiranite_bottle_from_xiranite_powder_basic",
  "r_shaper_activity_xiranite_enr_bottle_from_xiranite_enr_powder_basic",
] as const;

const BUBBLE_STRIKE_ITEMS = [
  { id: "item_activity_xiranite_nugget", nameZh: "实验息壤块", nameEn: "Proto Xiranite", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG] },
  { id: "item_activity_xiranite_box", nameZh: "实验龙泡泡外壳", nameEn: "Proto Chubby Lung Shell", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG] },
  { id: "item_activity_copper_xiranite_tool", nameZh: "实验铜骨骼", nameEn: "Proto Cuprium Frame", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG] },
  { id: "item_activity_xiranite_lung", nameZh: "息壤龙泡泡", nameEn: "Xiranite Chubby Lung", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG, "调度券地区:武陵", "调度券价值:100"] },
  { id: "item_activity_xiranite_enr_nugget", nameZh: "实验重息壤块", nameEn: "Proto Heavy Xiranite", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG] },
  { id: "item_activity_xiranite_enr_box", nameZh: "实验龙泡泡重壳", nameEn: "Proto Chubby Lung Heavy Shell", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG] },
  { id: "item_activity_copper_poly_gas", nameZh: "实验息壤铜气", nameEn: "Proto Xiran-Cuprium Gas", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG, "gas"] },
  { id: "item_activity_copper_poly", nameZh: "实验息壤铜锭", nameEn: "Proto Xiran-Cuprium", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG] },
  { id: "item_activity_copper_poly_cmpt", nameZh: "实验息壤铜零件", nameEn: "Proto Xiran-Cuprium Part", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG] },
  { id: "item_activity_copper_poly_tool", nameZh: "实验息壤铜骨骼", nameEn: "Proto Xiran-Cuprium Frame", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG] },
  { id: "item_activity_xiranite_enr_lung", nameZh: "重息壤龙泡泡", nameEn: "Heavy Xiranite Chubby Lung", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG, "调度券地区:武陵", "调度券价值:200"] },
] as const;

const BUBBLE_STRIKE_RECIPES = [
  {
    id: "furnance_activity_xiranite_nugget_1",
    nameZh: "实验息壤块生产",
    nameEn: "Proto Xiranite Production",
    durationSeconds: 2,
    inputs: [{ itemId: "item_xiranite_powder", amount: 1 }],
    outputs: [{ itemId: "item_activity_xiranite_nugget", amount: 1 }],
    machineId: "furnance_1",
  },
  {
    id: "shaper_activity_xiranite_box_1",
    nameZh: "实验龙泡泡外壳生产",
    nameEn: "Proto Chubby Lung Shell Production",
    durationSeconds: 2,
    inputs: [{ itemId: "item_activity_xiranite_nugget", amount: 1 }],
    outputs: [{ itemId: "item_activity_xiranite_box", amount: 1 }],
    machineId: "shaper_1",
  },
  {
    id: "tools_proc_activity_xiranite_copper_tool_1",
    nameZh: "实验铜骨骼合成",
    nameEn: "Proto Cuprium Frame Production",
    durationSeconds: 2,
    inputs: [
      { itemId: "item_copper_cmpt", amount: 4 },
      { itemId: "item_xiranite_powder", amount: 1 },
    ],
    outputs: [{ itemId: "item_activity_copper_xiranite_tool", amount: 1 }],
    machineId: "tools_asm_mc_1",
  },
  {
    id: "tools_proc_activity_xiranite_lung",
    nameZh: "息壤龙泡泡合成",
    nameEn: "Xiranite Chubby Lung Production",
    durationSeconds: 10,
    inputs: [
      { itemId: "item_activity_xiranite_box", amount: 5 },
      { itemId: "item_activity_copper_xiranite_tool", amount: 5 },
    ],
    outputs: [{ itemId: "item_activity_xiranite_lung", amount: 1 }],
    machineId: "tools_asm_mc_1",
  },
  {
    id: "furnance_activity_xiranite_enr_nugget_1",
    nameZh: "实验重息壤块生产",
    nameEn: "Proto Heavy Xiranite Production",
    durationSeconds: 10,
    inputs: [{ itemId: "item_xiranite_enr_powder", amount: 1 }],
    outputs: [{ itemId: "item_activity_xiranite_enr_nugget", amount: 1 }],
    machineId: "furnance_1",
  },
  {
    id: "shaper_gas_activity_xiranite_enr_box_1",
    nameZh: "实验龙泡泡重壳生产",
    nameEn: "Proto Chubby Lung Heavy Shell Production",
    durationSeconds: 10,
    inputs: [
      { itemId: "item_activity_xiranite_enr_nugget", amount: 1 },
      { itemId: "item_gas_inert", amount: 5 },
    ],
    outputs: [{ itemId: "item_activity_xiranite_enr_box", amount: 1 }],
    machineId: "shaper_1_gas",
  },
  {
    id: "gas_reactor_activity_copper_poly_gas_1",
    nameZh: "实验息壤铜气生产",
    nameEn: "Proto Xiran-Cuprium Gas Production",
    durationSeconds: 2,
    inputs: [
      { itemId: "item_gas_copper", amount: 2 },
      { itemId: "item_gas_xiranite", amount: 1 },
    ],
    outputs: [{ itemId: "item_activity_copper_poly_gas", amount: 1 }],
    machineId: "gas_reactor_1",
    requiredGasDiffusion: "item_gas_inert",
  },
  {
    id: "liquid_transmuter_2_activity_copper_poly_1",
    nameZh: "实验息壤铜锭转化",
    nameEn: "Proto Xiran-Cuprium Transmutation",
    durationSeconds: 2,
    inputs: [{ itemId: "item_activity_copper_poly_gas", amount: 1 }],
    outputs: [{ itemId: "item_activity_copper_poly", amount: 1 }],
    machineId: "transmuter_2_solidtrans",
  },
  {
    id: "liquid_transmuter_2_activity_copper_poly_gas_1",
    nameZh: "实验息壤铜气转化",
    nameEn: "Proto Xiran-Cuprium Gas Transmutation",
    durationSeconds: 2,
    inputs: [{ itemId: "item_activity_copper_poly", amount: 1 }],
    outputs: [{ itemId: "item_activity_copper_poly_gas", amount: 1 }],
    machineId: "transmuter_2_gastrans",
  },
  {
    id: "component_activity_copper_poly_cmpt",
    nameZh: "实验息壤铜零件生产",
    nameEn: "Proto Xiran-Cuprium Part Production",
    durationSeconds: 10,
    inputs: [{ itemId: "item_activity_copper_poly", amount: 5 }],
    outputs: [{ itemId: "item_activity_copper_poly_cmpt", amount: 1 }],
    machineId: "cmpt_mc_1",
  },
  {
    id: "tools_proc_activity_copper_poly_tool_1",
    nameZh: "实验息壤铜骨骼合成",
    nameEn: "Proto Xiran-Cuprium Frame Production",
    durationSeconds: 10,
    inputs: [
      { itemId: "item_activity_copper_poly_cmpt", amount: 1 },
      { itemId: "item_xiranite_enr_powder", amount: 1 },
    ],
    outputs: [{ itemId: "item_activity_copper_poly_tool", amount: 1 }],
    machineId: "tools_asm_mc_1",
  },
  {
    id: "tools_proc_activity_xiranite_enr_lung",
    nameZh: "重息壤龙泡泡合成",
    nameEn: "Heavy Xiranite Chubby Lung Production",
    durationSeconds: 10,
    inputs: [
      { itemId: "item_activity_xiranite_enr_box", amount: 1 },
      { itemId: "item_activity_copper_poly_tool", amount: 1 },
    ],
    outputs: [{ itemId: "item_activity_xiranite_enr_lung", amount: 1 }],
    machineId: "tools_asm_mc_1",
  },
] as const;

describe("activity registry definitions", () => {
  it("assigns the exact bubble strike items, domains, and Chinese names", () => {
    const bubbleStrikeItems = ITEM_DEFINITIONS
      .filter((item) => item.tags.includes(ACTIVITY_LIMITED_FORMULA_2_TAG));

    expect(bubbleStrikeItems.map((item) => item.id).sort())
      .toEqual(BUBBLE_STRIKE_ITEMS.map((item) => item.id).sort());
    for (const expected of BUBBLE_STRIKE_ITEMS) {
      const item = bubbleStrikeItems.find((candidate) => candidate.id === expected.id);
      expect(item).toMatchObject({
        iconId: expected.id,
        tags: expected.tags,
      });
      expect(lookupText("zh-CN", item?.nameKey ?? "")).toBe(expected.nameZh);
      expect(lookupText("en-US", item?.nameKey ?? "")).toBe(expected.nameEn);
    }

    expect(PRIOR_ACTIVITY_ITEM_IDS.every(
      (itemId) => ITEM_DEFINITIONS.some(
        (item) => item.id === itemId && item.tags.includes(ACTIVITY_LIMITED_FORMULA_1_TAG),
      ),
    )).toBe(true);
  });

  it("assigns the exact bubble strike production chain", () => {
    const bubbleStrikeRecipes = RECIPE_DEFINITIONS
      .filter((recipe) => recipe.tags.includes(ACTIVITY_LIMITED_FORMULA_2_TAG));

    expect(bubbleStrikeRecipes.map((recipe) => recipe.id).sort())
      .toEqual(BUBBLE_STRIKE_RECIPES.map((recipe) => recipe.id).sort());
    for (const expected of BUBBLE_STRIKE_RECIPES) {
      const { nameZh, nameEn, ...expectedDefinition } = expected;
      const recipe = bubbleStrikeRecipes.find((candidate) => candidate.id === expected.id);
      expect(recipe).toMatchObject({
        ...expectedDefinition,
        recipeType: "immediate-consume",
        tags: [ACTIVITY_LIMITED_FORMULA_2_TAG],
      });
      expect(lookupText("zh-CN", recipe?.nameKey ?? "")).toBe(nameZh);
      expect(lookupText("en-US", recipe?.nameKey ?? "")).toBe(nameEn);
    }

    expect(PRIOR_ACTIVITY_RECIPE_IDS.every(
      (recipeId) => RECIPE_DEFINITIONS.some(
        (recipe) => recipe.id === recipeId && recipe.tags.includes(ACTIVITY_LIMITED_FORMULA_1_TAG),
      ),
    )).toBe(true);
  });
});
