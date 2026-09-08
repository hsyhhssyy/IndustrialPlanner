import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
// AI-REMOVED 2026-09-08:
// Reason: 公共蓝图测试改按业务秒数与首次业务事件定位，不再绑定 Legacy 20 TPS。
// Trigger: resource pump production 纳入全引擎矩阵。
// Evidence: 配方定义已直接提供 durationSeconds。
// Replacement: BlueprintSimulationTickReport.elapsedSimulationSeconds
// Risk: Low
// Human Review: Required
//
// Original code:
// import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  findFirstTick,
  findSlot,
  getDevice,
  getLastTick,
} from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

const RESOURCE_PUMP_CASES = [
  {
    definitionId: "water_pump_1",
    recipeId: "r_pump_water_basic",
    itemId: "item_liquid_water",
    storageGroupId: "fluid_output_buffer",
    slotId: "output_fluid_slot_1",
    durationSeconds: 1,
    requiresPower: true,
  },
  {
    definitionId: "water_pump_1",
    recipeId: "r_pump_acid_basic",
    itemId: "item_liquid_acid",
    storageGroupId: "fluid_output_buffer",
    slotId: "output_fluid_slot_1",
    durationSeconds: 1,
    requiresPower: true,
  },
  {
    definitionId: "gas_pump_1",
    recipeId: "r_gas_collector_inert_basic",
    itemId: "item_gas_inert",
    storageGroupId: "gas_output_buffer",
    slotId: "output_gas_slot_1",
    durationSeconds: 3,
    requiresPower: false,
  },
  {
    definitionId: "gas_pump_1",
    recipeId: "r_gas_collector_xiranite_basic",
    itemId: "item_gas_xiranite",
    storageGroupId: "gas_output_buffer",
    slotId: "output_gas_slot_1",
    durationSeconds: 3,
    requiresPower: false,
  },
] as const;

describe.each(SIMULATION_ENGINE_MATRIX)("resource pump production [%s]", (engineKind) => {
  it.each(RESOURCE_PUMP_CASES)(
    "$definitionId produces $itemId through $recipeId every $durationSeconds seconds",
    async (deviceCase) => {
      // AI-REMOVED 2026-09-08:
      // Reason: 固定 durationTicks/maxTickNumber 只适用于 Legacy 20 TPS。
      // Trigger: resource pump production 纳入全引擎矩阵。
      // Evidence: 首次运行到第二份产出的业务时间应为 2 × durationSeconds。
      // Replacement: 下方首次运行/首次达到 count=2 的事件定位与 elapsedSimulationSeconds 断言。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // const durationTicks = deviceCase.durationSeconds * STANDARD_TICK_RATE_PER_SECOND;
      // const maxTickNumber = durationTicks * 2 + 1;
      const report = await runBlueprintSimulation({
        blueprint: createBlueprint(`resource-pump-${deviceCase.recipeId}`, [
          createEntity("pump", deviceCase.definitionId, 0, 0, 0, {
            channelRecipes: { default: deviceCase.recipeId },
          }),
          ...(deviceCase.requiresPower
            ? [createEntity("power", "power_diffuser_1", 4, 0)]
            : []),
        ]),
        maxDurationSeconds: deviceCase.durationSeconds * 2 + 1,
        engineKind,
        registry: createRegistryContract(),
      });

      expect(report.blueprint.slotLinkCount).toBe(0);
      expect(report.topology.diagnostics).toEqual([]);
      const started = findFirstTick(report, (tick) =>
        tick.devices.pump?.channelRecipes.default?.recipeId === deviceCase.recipeId
      );
      const completed = findFirstTick(report, (tick) =>
        tick.devices.pump?.slotItems.some((slot) =>
          slot.storageGroupId === deviceCase.storageGroupId
          && slot.slotId === deviceCase.slotId
          && slot.itemType === deviceCase.itemId
          && slot.count === 2
        ) === true
      );
      expect(getDevice(report, started.tickNumber, "pump").channelRecipes.default?.recipeId)
        .toBe(deviceCase.recipeId);
      expect(findSlot(
        report,
        completed.tickNumber,
        "pump",
        deviceCase.storageGroupId,
        deviceCase.slotId,
      )).toMatchObject({
        itemType: deviceCase.itemId,
        count: 2,
        ignoreStock: false,
      });
      expect(completed.elapsedSimulationSeconds - started.elapsedSimulationSeconds)
        .toBeCloseTo(deviceCase.durationSeconds * 2);
    },
  );

  it.each([
    ["water_pump_1", "fluid_output_buffer", "output_fluid_slot_1", true],
    ["gas_pump_1", "gas_output_buffer", "output_gas_slot_1", false],
  ] as const)(
    "%s remains idle until a recipe is selected",
    async (definitionId, storageGroupId, slotId, requiresPower) => {
      // AI-REMOVED 2026-09-08:
      // Reason: 固定 4 × 20 tick 改为直接声明 4 秒观察窗口。
      // Trigger: resource pump production 纳入全引擎矩阵。
      // Evidence: 本用例验证未选择配方时持续空闲，与 tick 编号无关。
      // Replacement: maxDurationSeconds: 4 与 getLastTick。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // const maxTickNumber = 4 * STANDARD_TICK_RATE_PER_SECOND;
      const report = await runBlueprintSimulation({
        blueprint: createBlueprint(`unconfigured-${definitionId}`, [
          createEntity("pump", definitionId, 0, 0),
          ...(requiresPower
            ? [createEntity("power", "power_diffuser_1", 4, 0)]
            : []),
        ]),
        maxDurationSeconds: 4,
        engineKind,
        registry: createRegistryContract(),
      });

      const finalTick = getLastTick(report).tickNumber;
      expect(getDevice(report, finalTick, "pump").channelRecipes.default ?? null)
        .toBeNull();
      expect(findSlot(
        report,
        finalTick,
        "pump",
        storageGroupId,
        slotId,
      )).toMatchObject({
        itemType: null,
        count: 0,
        ignoreStock: false,
      });
    },
  );
});
