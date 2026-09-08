import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
// AI-REMOVED 2026-09-08:
// Reason: 公共蓝图测试改按累计仿真秒数和业务事件定位，不再绑定 Legacy 20 TPS。
// Trigger: production 测试纳入全引擎矩阵。
// Evidence: 配方耗时由 desiredSeconds 定义，Legacy tick 1→41 与 Dense tick 1→5 都表示 2 秒。
// Replacement: BlueprintSimulationTickReport.elapsedSimulationSeconds
// Risk: Low
// Human Review: Required
//
// Original code:
// import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import {
  createBlueprint,
  createEntity,
  findFirstTick,
  findSlot,
  getDevice,
} from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

describe.each(SIMULATION_ENGINE_MATRIX)("REQ-076: production [%s]", (engineKind) => {
  it("projects production runtime status and final inventory from recipe blueprints", async () => {
    // AI-REMOVED 2026-09-08:
    // Reason: 固定 completionTick 只适用于 Legacy 20 TPS，不能表达跨引擎的 2 秒配方契约。
    // Trigger: production 测试纳入全引擎矩阵。
    // Evidence: 首次运行帧到首次产出帧的累计仿真时间在两个引擎中均为 2 秒。
    // Replacement: 下方 findFirstTick 业务事件与 elapsedSimulationSeconds 差值断言。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // const completionTick = 2 * STANDARD_TICK_RATE_PER_SECOND + 1;
    const registry = createRegistryContract();
    const grinderReport = await runBlueprintSimulation({
      blueprint: createBlueprint("grinder-production", [
        createEntity("grinder", "grinder_1", 0, 0, 0, {
          "storageSlotGroups[0].slots[0].initialItemType": "item_iron_nugget",
          "storageSlotGroups[0].slots[0].initialCount": 1,
        }),
        createEntity("power", "power_diffuser_1", 4, 0),
      ]),
      maxDurationSeconds: 3,
      engineKind,
      registry,
    });
    const furnaceReport = await runBlueprintSimulation({
      blueprint: createBlueprint("furnace-production", [
        createEntity("furnace", "furnance_1", 0, 0, 0, {
          "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
          "storageSlotGroups[0].slots[0].initialCount": 1,
        }),
        createEntity("power", "power_diffuser_1", 4, 0),
      ]),
      maxDurationSeconds: 3,
      engineKind,
      registry,
    });

    const grinderStarted = findFirstTick(grinderReport, (tick) =>
      tick.devices.grinder?.channelRecipes.default?.recipeId
        === "r_crusher_iron_powder_from_iron_nugget_basic"
    );
    const grinderCompleted = findFirstTick(grinderReport, (tick) =>
      tick.devices.grinder?.slotItems.some((slot) =>
        slot.storageGroupId === "item_output_buffer"
        && slot.slotId === "output_slot_1"
        && slot.itemType === "item_iron_powder"
        && slot.count === 1
      ) === true
    );
    expect(getDevice(grinderReport, grinderStarted.tickNumber, "grinder").channelRecipes["default"]).toMatchObject({
      recipeId: "r_crusher_iron_powder_from_iron_nugget_basic",
      progressSeconds: 0,
      desiredSeconds: 2,
    });
    expect(findSlot(grinderReport, grinderCompleted.tickNumber, "grinder", "item_output_buffer", "output_slot_1"))
      .toMatchObject({
        itemType: "item_iron_powder",
        count: 1,
      });
    expect(grinderCompleted.elapsedSimulationSeconds - grinderStarted.elapsedSimulationSeconds)
      .toBeCloseTo(2);

    const furnaceStarted = findFirstTick(furnaceReport, (tick) =>
      tick.devices.furnace?.channelRecipes.default?.recipeId
        === "r_furnace_iron_nugget_from_iron_ore_basic"
    );
    const furnaceCompleted = findFirstTick(furnaceReport, (tick) =>
      tick.devices.furnace?.slotItems.some((slot) =>
        slot.storageGroupId === "item_output_buffer"
        && slot.slotId === "output_item_slot_1"
        && slot.itemType === "item_iron_nugget"
        && slot.count === 1
      ) === true
    );
    expect(getDevice(furnaceReport, furnaceStarted.tickNumber, "furnace").channelRecipes["default"]).toMatchObject({
      recipeId: "r_furnace_iron_nugget_from_iron_ore_basic",
      progressSeconds: 0,
      desiredSeconds: 2,
    });
    expect(findSlot(furnaceReport, furnaceCompleted.tickNumber, "furnace", "item_output_buffer", "output_item_slot_1"))
      .toMatchObject({
        itemType: "item_iron_nugget",
        count: 1,
      });
    expect(furnaceCompleted.elapsedSimulationSeconds - furnaceStarted.elapsedSimulationSeconds)
      .toBeCloseTo(2);
  });

  it("treats ignoreStock recipe inputs as infinite even when their actual count is zero", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("infinite-gas-purifier-inputs", [
        createEntity("purifier", "liquid_purifier_1_gas", 0, 0, 0, {
          "storageSlotGroups[0].slots[0].initialItemType": "item_gas_copper",
          "storageSlotGroups[0].slots[0].initialCount": 0,
          "storageSlotGroups[0].slots[0].ignoreStock": true,
          "storageSlotGroups[2].slots[0].initialItemType": "item_filter_core",
          "storageSlotGroups[2].slots[0].initialCount": 0,
          "storageSlotGroups[2].slots[0].ignoreStock": true,
        }),
        createEntity("power", "power_diffuser_1", 6, 0),
      ]),
      maxDurationSeconds: 0.5,
      engineKind,
      registry: createRegistryContract(),
    });

    const runningTick = findFirstTick(report, (tick) =>
      tick.devices.purifier?.channelRecipes.default?.recipeId
        === "liquid_purifier_gas_copper_enr_1"
    );
    expect(getDevice(report, runningTick.tickNumber, "purifier").channelRecipes["default"]).toMatchObject({
      recipeId: "liquid_purifier_gas_copper_enr_1",
      state: "running",
    });
    expect(findSlot(report, runningTick.tickNumber, "purifier", "gas_input_buffer", "input_gas_slot_1"))
      .toMatchObject({
        itemType: "item_gas_copper",
        count: 0,
        ignoreStock: true,
      });
    expect(findSlot(report, runningTick.tickNumber, "purifier", "item_input_buffer", "input_item_slot_1"))
      .toMatchObject({
        itemType: "item_filter_core",
        count: 0,
        ignoreStock: true,
      });
  });
});
