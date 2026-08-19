import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  findSlot,
  getDevice,
} from "./blueprint-test-helpers";

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

describe("resource pump production", () => {
  it.each(RESOURCE_PUMP_CASES)(
    "$definitionId produces $itemId through $recipeId every $durationSeconds seconds",
    async (deviceCase) => {
      const durationTicks = deviceCase.durationSeconds * STANDARD_TICK_RATE_PER_SECOND;
      const maxTickNumber = durationTicks * 2 + 1;
      const report = await runBlueprintSimulation({
        blueprint: createBlueprint(`resource-pump-${deviceCase.recipeId}`, [
          createEntity("pump", deviceCase.definitionId, 0, 0, 0, {
            channelRecipes: { default: deviceCase.recipeId },
          }),
          ...(deviceCase.requiresPower
            ? [createEntity("power", "power_diffuser_1", 4, 0)]
            : []),
        ]),
        maxTickNumber,
        registry: createRegistryContract(),
      });

      expect(report.blueprint.slotLinkCount).toBe(0);
      expect(report.topology.diagnostics).toEqual([]);
      expect(getDevice(report, 1, "pump").channelRecipes.default?.recipeId)
        .toBe(deviceCase.recipeId);
      expect(findSlot(
        report,
        maxTickNumber,
        "pump",
        deviceCase.storageGroupId,
        deviceCase.slotId,
      )).toMatchObject({
        itemType: deviceCase.itemId,
        count: 2,
        ignoreStock: false,
      });
    },
  );

  it.each([
    ["water_pump_1", "fluid_output_buffer", "output_fluid_slot_1", true],
    ["gas_pump_1", "gas_output_buffer", "output_gas_slot_1", false],
  ] as const)(
    "%s remains idle until a recipe is selected",
    async (definitionId, storageGroupId, slotId, requiresPower) => {
      const maxTickNumber = 4 * STANDARD_TICK_RATE_PER_SECOND;
      const report = await runBlueprintSimulation({
        blueprint: createBlueprint(`unconfigured-${definitionId}`, [
          createEntity("pump", definitionId, 0, 0),
          ...(requiresPower
            ? [createEntity("power", "power_diffuser_1", 4, 0)]
            : []),
        ]),
        maxTickNumber,
        registry: createRegistryContract(),
      });

      expect(getDevice(report, maxTickNumber, "pump").channelRecipes.default ?? null)
        .toBeNull();
      expect(findSlot(
        report,
        maxTickNumber,
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
