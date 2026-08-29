import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import {
  ACTIVITY_LIMITED_FORMULA_1_TAG,
  ACTIVITY_LIMITED_FORMULA_2_TAG,
} from "@/shared/registry/activity-availability";

describe("activity registry tags", () => {
  it("marks all current item_activity_ items as limited formula activity content", () => {
    const registry = createRegistryContract();
    const activityItems = registry.itemDefinitions.filter((item) => item.id.startsWith("item_activity_"));

    expect(activityItems.map((item) => item.id).sort()).toEqual([
      "item_activity_limited_formula_2_1",
      "item_activity_limited_formula_2_2",
      "item_activity_limited_formula_2_3",
      "item_activity_limited_formula_2_4",
      "item_activity_limited_formula_2_5",
      "item_activity_limited_formula_2_6",
      "item_activity_limited_formula_2_7",
      "item_activity_limited_formula_2_8",
      "item_activity_limited_formula_2_9",
      "item_activity_limited_formula_2_10",
      "item_activity_limited_formula_2_11",
      "item_activity_xiranite_bottle",
      "item_activity_xiranite_cmpt",
      "item_activity_xiranite_enr_bottle",
      "item_activity_xiranite_enr_bottle_filled_liquid_plant_grass_2",
      "item_activity_xiranite_enr_cmpt",
      "item_activity_xiranite_enr_hulu",
      "item_activity_xiranite_enr_tool",
      "item_activity_xiranite_hulu",
    ].sort());
    expect(activityItems.every((item) =>
      item.tags.includes(ACTIVITY_LIMITED_FORMULA_1_TAG)
      || item.tags.includes(ACTIVITY_LIMITED_FORMULA_2_TAG)
    )).toBe(true);
  });

  it("marks recipes that directly consume or produce current activity items", () => {
    const registry = createRegistryContract();
    const recipeIdsWithActivityItems = registry.recipeDefinitions
      .filter((recipe) => [...recipe.inputs, ...recipe.outputs].some((port) => port.itemId.startsWith("item_activity_")))
      .map((recipe) => recipe.id)
      .sort();

    expect(recipeIdsWithActivityItems).toEqual([
      "r_component_activity_limited_formula_2_2",
      "r_component_activity_limited_formula_2_6",
      "r_component_activity_limited_formula_2_9",
      "r_component_activity_xiranite_cmpt_from_xiranite_powder_basic",
      "r_component_activity_xiranite_enr_cmpt_from_xiranite_enr_powder_basic",
      "r_dismantling_activity_xiranite_enr_bottle_grass_2_basic",
      "r_filling_activity_xiranite_enr_bottle_grass_2_basic",
      "r_furnace_activity_limited_formula_2_1",
      "r_furnace_activity_limited_formula_2_5",
      "r_gas_reactor_activity_limited_formula_2_7",
      "r_packaging_activity_limited_formula_2_3",
      "r_packaging_activity_limited_formula_2_4",
      "r_packaging_activity_limited_formula_2_10",
      "r_packaging_activity_limited_formula_2_11",
      "r_packaging_activity_xiranite_enr_hulu_from_activity_xiranite_enr_bottle_filled_liquid_plant_grass_2_and_activity_xiranite_enr_tool_basic",
      "r_packaging_activity_xiranite_enr_tool_from_activity_xiranite_enr_cmpt_and_copper_enr_basic",
      "r_packaging_activity_xiranite_hulu_from_activity_xiranite_bottle_and_activity_xiranite_cmpt_basic",
      "r_shaper_activity_xiranite_bottle_from_xiranite_powder_basic",
      "r_shaper_activity_xiranite_enr_bottle_from_xiranite_enr_powder_basic",
      "r_transmuter_2_solid_activity_limited_formula_2_8",
    ].sort());
    expect(recipeIdsWithActivityItems.every((recipeId) =>
      registry.recipeDefinitions.find((recipe) => recipe.id === recipeId)?.tags.some(
        (tag) => tag === ACTIVITY_LIMITED_FORMULA_1_TAG || tag === ACTIVITY_LIMITED_FORMULA_2_TAG,
      ) === true,
    )).toBe(true);
  });
});
