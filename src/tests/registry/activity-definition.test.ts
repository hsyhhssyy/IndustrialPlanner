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
  { id: "item_activity_limited_formula_2_1", name: "息壤块", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG] },
  { id: "item_activity_limited_formula_2_2", name: "息壤壳", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG] },
  { id: "item_activity_limited_formula_2_3", name: "息壤骨架", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG] },
  { id: "item_activity_limited_formula_2_4", name: "息壤龙泡泡", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG] },
  { id: "item_activity_limited_formula_2_5", name: "重息壤块", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG] },
  { id: "item_activity_limited_formula_2_6", name: "重息壤壳", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG] },
  { id: "item_activity_limited_formula_2_7", name: "实验息壤铜气", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG, "gas"] },
  { id: "item_activity_limited_formula_2_8", name: "实验息壤铜块", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG] },
  { id: "item_activity_limited_formula_2_9", name: "实验息壤铜零件", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG] },
  { id: "item_activity_limited_formula_2_10", name: "重息壤骨架", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG] },
  { id: "item_activity_limited_formula_2_11", name: "重息壤龙泡泡", tags: [ACTIVITY_LIMITED_FORMULA_2_TAG] },
] as const;

const BUBBLE_STRIKE_RECIPES = [
  {
    id: "r_furnace_activity_limited_formula_2_1",
    durationSeconds: 2,
    inputs: [{ itemId: "item_xiranite_powder", amount: 1 }],
    outputs: [{ itemId: "item_activity_limited_formula_2_1", amount: 1 }],
    machineId: "furnance_1",
  },
  {
    id: "r_component_activity_limited_formula_2_2",
    durationSeconds: 2,
    inputs: [{ itemId: "item_activity_limited_formula_2_1", amount: 1 }],
    outputs: [{ itemId: "item_activity_limited_formula_2_2", amount: 1 }],
    machineId: "cmpt_mc_1",
  },
  {
    id: "r_packaging_activity_limited_formula_2_3",
    durationSeconds: 2,
    inputs: [
      { itemId: "item_xiranite_powder", amount: 1 },
      { itemId: "item_copper_cmpt", amount: 4 },
    ],
    outputs: [{ itemId: "item_activity_limited_formula_2_3", amount: 1 }],
    machineId: "tools_asm_mc_1",
  },
  {
    id: "r_packaging_activity_limited_formula_2_4",
    durationSeconds: 10,
    inputs: [
      { itemId: "item_activity_limited_formula_2_3", amount: 5 },
      { itemId: "item_activity_limited_formula_2_2", amount: 5 },
    ],
    outputs: [{ itemId: "item_activity_limited_formula_2_4", amount: 1 }],
    machineId: "tools_asm_mc_1",
  },
  {
    id: "r_furnace_activity_limited_formula_2_5",
    durationSeconds: 10,
    inputs: [{ itemId: "item_xiranite_enr_powder", amount: 1 }],
    outputs: [{ itemId: "item_activity_limited_formula_2_5", amount: 1 }],
    machineId: "furnance_1",
  },
  {
    id: "r_component_activity_limited_formula_2_6",
    durationSeconds: 10,
    inputs: [{ itemId: "item_activity_limited_formula_2_5", amount: 1 }],
    outputs: [{ itemId: "item_activity_limited_formula_2_6", amount: 1 }],
    machineId: "cmpt_mc_1",
  },
  {
    id: "r_gas_reactor_activity_limited_formula_2_7",
    durationSeconds: 2,
    inputs: [
      { itemId: "item_gas_copper", amount: 2 },
      { itemId: "item_gas_xiranite", amount: 1 },
    ],
    outputs: [{ itemId: "item_activity_limited_formula_2_7", amount: 1 }],
    machineId: "gas_reactor_1",
    requiredGasDiffusion: "item_gas_inert",
  },
  {
    id: "r_transmuter_2_solid_activity_limited_formula_2_8",
    durationSeconds: 2,
    inputs: [{ itemId: "item_activity_limited_formula_2_7", amount: 1 }],
    outputs: [{ itemId: "item_activity_limited_formula_2_8", amount: 1 }],
    machineId: "transmuter_2_solidtrans",
  },
  {
    id: "r_component_activity_limited_formula_2_9",
    durationSeconds: 2,
    inputs: [{ itemId: "item_activity_limited_formula_2_8", amount: 1 }],
    outputs: [{ itemId: "item_activity_limited_formula_2_9", amount: 1 }],
    machineId: "cmpt_mc_1",
  },
  {
    id: "r_packaging_activity_limited_formula_2_10",
    durationSeconds: 10,
    inputs: [
      { itemId: "item_activity_limited_formula_2_9", amount: 5 },
      { itemId: "item_activity_limited_formula_2_5", amount: 1 },
    ],
    outputs: [{ itemId: "item_activity_limited_formula_2_10", amount: 1 }],
    machineId: "tools_asm_mc_1",
  },
  {
    id: "r_packaging_activity_limited_formula_2_11",
    durationSeconds: 10,
    inputs: [
      { itemId: "item_activity_limited_formula_2_10", amount: 1 },
      { itemId: "item_activity_limited_formula_2_6", amount: 1 },
    ],
    outputs: [{ itemId: "item_activity_limited_formula_2_11", amount: 1 }],
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
        iconId: "missing-item-icon",
        tags: expected.tags,
      });
      expect(lookupText("zh-CN", item?.nameKey ?? "")).toBe(expected.name);
      expect(lookupText("en-US", item?.nameKey ?? "")).toBe(expected.name);
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
      expect(bubbleStrikeRecipes.find((recipe) => recipe.id === expected.id)).toMatchObject({
        ...expected,
        recipeType: "immediate-consume",
        tags: [ACTIVITY_LIMITED_FORMULA_2_TAG],
      });
    }

    expect(PRIOR_ACTIVITY_RECIPE_IDS.every(
      (recipeId) => RECIPE_DEFINITIONS.some(
        (recipe) => recipe.id === recipeId && recipe.tags.includes(ACTIVITY_LIMITED_FORMULA_1_TAG),
      ),
    )).toBe(true);
  });
});
