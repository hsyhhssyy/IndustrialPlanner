import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { RECIPE_CHANNEL_AUTOMATIC_MODE_CONFIG_KEY } from "@/shared/recipe-channel-behavior";
import { runBlueprintSimulation } from "./blueprint-runner";
import { createBlueprint, createEntity, getDevice } from "./blueprint-test-helpers";

const CHRONO_RECIPE_ID =
  "r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic_large";
const LIQUID_XIRANITE_RECIPE_ID =
  "r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic_large";

describe("反应池 Recipe Channel 模式", () => {
  it("keeps old entities and blueprints manual when the mode config is absent", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("legacy-reactor-manual-mode", [
        createEntity("reactor", "mix_pool_2", 0, 0, 0, {
          channelRecipes: { ch1: LIQUID_XIRANITE_RECIPE_ID },
          ...createLiquidXiraniteInputs(4),
        }),
        createEntity("power", "power_diffuser_1", 6, 0),
      ]),
      maxTickNumber: 1,
      registry: createRegistryContract(),
    });

    const runningRecipes = readRunningRecipeIds(getDevice(report, 1, "reactor").channelRecipes);
    expect(runningRecipes).toEqual([LIQUID_XIRANITE_RECIPE_ID]);
  });

  it("starts every satisfiable distinct recipe in automatic mode", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("reactor-automatic-distinct-recipes", [
        createEntity("reactor", "mix_pool_2", 0, 0, 0, {
          [RECIPE_CHANNEL_AUTOMATIC_MODE_CONFIG_KEY]: true,
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_xiranite",
          "storageSlotGroups[0].slots[0].initialCount": 2,
          "storageSlotGroups[0].slots[1].initialItemType": "item_liquid_sewage",
          "storageSlotGroups[0].slots[1].initialCount": 2,
          "storageSlotGroups[0].slots[2].initialItemType": "item_xiranite_powder",
          "storageSlotGroups[0].slots[2].initialCount": 2,
          "storageSlotGroups[0].slots[3].initialItemType": "item_liquid_water",
          "storageSlotGroups[0].slots[3].initialCount": 2,
        }),
        createEntity("power", "power_diffuser_1", 6, 0),
      ]),
      maxTickNumber: 1,
      registry: createRegistryContract(),
    });

    const runningRecipes = readRunningRecipeIds(getDevice(report, 1, "reactor").channelRecipes);
    expect(new Set(runningRecipes)).toEqual(new Set([
      CHRONO_RECIPE_ID,
      LIQUID_XIRANITE_RECIPE_ID,
    ]));
    expect(runningRecipes).toHaveLength(2);
  });

  it("does not run one automatic recipe on multiple channels", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("reactor-automatic-no-duplicate-recipe", [
        createEntity("reactor", "mix_pool_2", 0, 0, 0, {
          [RECIPE_CHANNEL_AUTOMATIC_MODE_CONFIG_KEY]: true,
          ...createLiquidXiraniteInputs(8),
        }),
        createEntity("power", "power_diffuser_1", 6, 0),
      ]),
      maxTickNumber: 1,
      registry: createRegistryContract(),
    });

    expect(readRunningRecipeIds(getDevice(report, 1, "reactor").channelRecipes))
      .toEqual([LIQUID_XIRANITE_RECIPE_ID]);
  });
});

function createLiquidXiraniteInputs(count: number): Record<string, unknown> {
  return {
    "storageSlotGroups[0].slots[0].initialItemType": "item_xiranite_powder",
    "storageSlotGroups[0].slots[0].initialCount": count,
    "storageSlotGroups[0].slots[1].initialItemType": "item_liquid_water",
    "storageSlotGroups[0].slots[1].initialCount": count,
  };
}

function readRunningRecipeIds(
  channelRecipes: ReturnType<typeof getDevice>["channelRecipes"],
): string[] {
  return Object.values(channelRecipes)
    .flatMap((recipe) => recipe?.recipeId === null || recipe?.recipeId === undefined
      ? []
      : [recipe.recipeId])
    .sort();
}
