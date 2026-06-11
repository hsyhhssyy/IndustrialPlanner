import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { ACTIVITY_LIMITED_FORMULA_1_TAG } from "@/shared/registry/activity-availability";

describe("activity registry tags", () => {
  it("marks all current item_activity_ items as limited formula activity content", () => {
    const registry = createRegistryContract();
    const activityItems = registry.itemDefinitions.filter((item) => item.id.startsWith("item_activity_"));

    expect(activityItems.map((item) => item.id).sort()).toEqual([
      "item_activity_xiranite_bottle",
      "item_activity_xiranite_cmpt",
      "item_activity_xiranite_enr_bottle",
      "item_activity_xiranite_enr_bottle_filled_liquid_plant_grass_2",
      "item_activity_xiranite_enr_cmpt",
      "item_activity_xiranite_enr_hulu",
      "item_activity_xiranite_enr_tool",
      "item_activity_xiranite_hulu",
    ]);
    expect(activityItems.every((item) => item.tags.includes(ACTIVITY_LIMITED_FORMULA_1_TAG))).toBe(true);
  });

  it("marks recipes that directly consume or produce current activity items", () => {
    const registry = createRegistryContract();
    const recipeIdsWithActivityItems = registry.recipeDefinitions
      .filter((recipe) => [...recipe.inputs, ...recipe.outputs].some((port) => port.itemId.startsWith("item_activity_")))
      .map((recipe) => recipe.id)
      .sort();

    expect(recipeIdsWithActivityItems).toEqual([
      "r_component_activity_xiranite_cmpt_from_xiranite_powder_basic",
      "r_component_activity_xiranite_enr_cmpt_from_xiranite_enr_powder_basic",
      "r_dismantling_activity_xiranite_enr_bottle_grass_2_basic",
      "r_filling_activity_xiranite_enr_bottle_grass_2_basic",
      "r_packaging_activity_xiranite_enr_hulu_from_activity_xiranite_enr_bottle_filled_liquid_plant_grass_2_and_activity_xiranite_enr_tool_basic",
      "r_packaging_activity_xiranite_enr_tool_from_activity_xiranite_enr_cmpt_and_copper_enr_basic",
      "r_packaging_activity_xiranite_hulu_from_activity_xiranite_bottle_and_activity_xiranite_cmpt_basic",
      "r_shaper_activity_xiranite_bottle_from_xiranite_powder_basic",
      "r_shaper_activity_xiranite_enr_bottle_from_xiranite_enr_powder_basic",
    ]);
    expect(recipeIdsWithActivityItems.every((recipeId) =>
      registry.recipeDefinitions.find((recipe) => recipe.id === recipeId)?.tags.includes(ACTIVITY_LIMITED_FORMULA_1_TAG) === true,
    )).toBe(true);
  });
});
