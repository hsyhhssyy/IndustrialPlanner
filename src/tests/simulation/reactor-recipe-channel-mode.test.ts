import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/reactor-recipe-channel-mode/index.json
// Risk: Low；断言与被测动作不变。
// Human Review: Required
// Original code:
// import { RECIPE_CHANNEL_AUTOMATIC_MODE_CONFIG_KEY } from "@/shared/recipe-channel-behavior";
import { runBlueprintSimulation } from "./blueprint-runner";
// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/reactor-recipe-channel-mode/index.json
// Risk: Low；断言与被测动作不变。
// Human Review: Required
// Original code:
// import {
//   createBlueprint,
//   createEntity,
//   findFirstTick,
//   getDevice,
// } from "./blueprint-test-helpers";
import { findFirstTick, getDevice } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

const CHRONO_RECIPE_ID =
  "r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic_large";
const LIQUID_XIRANITE_RECIPE_ID =
  "r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic_large";

describe.each(SIMULATION_ENGINE_MATRIX)("反应池 Recipe Channel 模式 [%s]", (engineKind) => {
  it("keeps old entities and blueprints manual when the mode config is absent", async () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/reactor-recipe-channel-mode/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // createBlueprint("legacy-reactor-manual-mode", [
    //         createEntity("reactor", "mix_pool_2", 0, 0, 0, {
    //           channelRecipes: { ch1: LIQUID_XIRANITE_RECIPE_ID },
    //           ...createLiquidXiraniteInputs(4),
    //         }),
    //         createEntity("power", "power_diffuser_1", 6, 0),
    //       ])
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/reactor-recipe-channel-mode/scene-01-legacy-reactor-manual-mode-82b00369.schema6.json"),
      maxDurationSeconds: 0.5,
      engineKind,
      registry: createRegistryContract(),
    });

    const runningTick = findFirstTick(report, (tick) =>
      readRunningRecipeIds(tick.devices.reactor?.channelRecipes ?? {}).length > 0
    );
    const runningRecipes = readRunningRecipeIds(
      getDevice(report, runningTick.tickNumber, "reactor").channelRecipes,
    );
    expect(runningRecipes).toEqual([LIQUID_XIRANITE_RECIPE_ID]);
  });

  it("starts every satisfiable distinct recipe in automatic mode", async () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/reactor-recipe-channel-mode/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // createBlueprint("reactor-automatic-distinct-recipes", [
    //         createEntity("reactor", "mix_pool_2", 0, 0, 0, {
    //           [RECIPE_CHANNEL_AUTOMATIC_MODE_CONFIG_KEY]: true,
    //           "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_xiranite",
    //           "storageSlotGroups[0].slots[0].initialCount": 2,
    //           "storageSlotGroups[0].slots[1].initialItemType": "item_liquid_sewage",
    //           "storageSlotGroups[0].slots[1].initialCount": 2,
    //           "storageSlotGroups[0].slots[2].initialItemType": "item_xiranite_powder",
    //           "storageSlotGroups[0].slots[2].initialCount": 2,
    //           "storageSlotGroups[0].slots[3].initialItemType": "item_liquid_water",
    //           "storageSlotGroups[0].slots[3].initialCount": 2,
    //         }),
    //         createEntity("power", "power_diffuser_1", 6, 0),
    //       ])
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/reactor-recipe-channel-mode/scene-02-reactor-automatic-distinct-recipes-980d786d.schema6.json"),
      maxDurationSeconds: 0.5,
      engineKind,
      registry: createRegistryContract(),
    });

    const runningTick = findFirstTick(report, (tick) =>
      readRunningRecipeIds(tick.devices.reactor?.channelRecipes ?? {}).length > 0
    );
    const runningRecipes = readRunningRecipeIds(
      getDevice(report, runningTick.tickNumber, "reactor").channelRecipes,
    );
    expect(new Set(runningRecipes)).toEqual(new Set([
      CHRONO_RECIPE_ID,
      LIQUID_XIRANITE_RECIPE_ID,
    ]));
    expect(runningRecipes).toHaveLength(2);
  });

  it("does not run one automatic recipe on multiple channels", async () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/reactor-recipe-channel-mode/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // createBlueprint("reactor-automatic-no-duplicate-recipe", [
    //         createEntity("reactor", "mix_pool_2", 0, 0, 0, {
    //           [RECIPE_CHANNEL_AUTOMATIC_MODE_CONFIG_KEY]: true,
    //           ...createLiquidXiraniteInputs(8),
    //         }),
    //         createEntity("power", "power_diffuser_1", 6, 0),
    //       ])
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/reactor-recipe-channel-mode/scene-03-reactor-automatic-no-duplicate-recipe-95b28f14.schema6.json"),
      maxDurationSeconds: 0.5,
      engineKind,
      registry: createRegistryContract(),
    });

    const runningTick = findFirstTick(report, (tick) =>
      readRunningRecipeIds(tick.devices.reactor?.channelRecipes ?? {}).length > 0
    );
    expect(readRunningRecipeIds(getDevice(report, runningTick.tickNumber, "reactor").channelRecipes))
      .toEqual([LIQUID_XIRANITE_RECIPE_ID]);
  });
});

// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/reactor-recipe-channel-mode/index.json
// Risk: Low；断言与被测动作不变。
// Human Review: Required
// Original code:
// function createLiquidXiraniteInputs(count: number): Record<string, unknown> {
//   return {
//     "storageSlotGroups[0].slots[0].initialItemType": "item_xiranite_powder",
//     "storageSlotGroups[0].slots[0].initialCount": count,
//     "storageSlotGroups[0].slots[1].initialItemType": "item_liquid_water",
//     "storageSlotGroups[0].slots[1].initialCount": count,
//   };
// }

function readRunningRecipeIds(
  channelRecipes: ReturnType<typeof getDevice>["channelRecipes"],
): string[] {
  return Object.values(channelRecipes)
    .flatMap((recipe) => recipe?.recipeId === null || recipe?.recipeId === undefined
      ? []
      : [recipe.recipeId])
    .sort();
}
