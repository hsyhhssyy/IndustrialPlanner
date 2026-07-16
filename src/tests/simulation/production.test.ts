import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import {
  createBlueprint,
  createEntity,
  findSlot,
  getDevice,
} from "./blueprint-test-helpers";

describe("REQ-076: production", () => {
  it("projects production runtime status and final inventory from recipe blueprints", async () => {
    const completionTick = 2 * STANDARD_TICK_RATE_PER_SECOND + 1;
    const registry = createRegistryContract();
    const grinderReport = await runBlueprintSimulation({
      blueprint: createBlueprint("grinder-production", [
        createEntity("grinder", "item_port_grinder_1", 0, 0, 0, {
          "storageSlotGroups[0].slots[0].initialItemType": "item_iron_nugget",
          "storageSlotGroups[0].slots[0].initialCount": 1,
        }),
        createEntity("power", "item_port_power_diffuser_1", 4, 0),
      ]),
      maxTickNumber: completionTick,
      registry,
    });
    const furnaceReport = await runBlueprintSimulation({
      blueprint: createBlueprint("furnace-production", [
        createEntity("furnace", "item_port_furnance_1", 0, 0, 0, {
          "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
          "storageSlotGroups[0].slots[0].initialCount": 1,
        }),
        createEntity("power", "item_port_power_diffuser_1", 4, 0),
      ]),
      maxTickNumber: completionTick,
      registry,
    });

    expect(getDevice(grinderReport, 1, "grinder").channelRecipes["default"]).toMatchObject({
      recipeId: "r_crusher_iron_powder_from_iron_nugget_basic",
      progressSeconds: 0,
      desiredSeconds: 2,
    });
    expect(findSlot(grinderReport, completionTick, "grinder", "item_output_buffer", "output_slot_1"))
      .toMatchObject({
        itemType: "item_iron_powder",
        count: 1,
      });
    expect(getDevice(furnaceReport, 1, "furnace").channelRecipes["default"]).toMatchObject({
      recipeId: "r_furnace_iron_nugget_from_iron_ore_basic",
      progressSeconds: 0,
      desiredSeconds: 2,
    });
    expect(findSlot(furnaceReport, completionTick, "furnace", "item_output_buffer", "output_item_slot_1"))
      .toMatchObject({
        itemType: "item_iron_nugget",
        count: 1,
      });
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
        createEntity("power", "item_port_power_diffuser_1", 6, 0),
      ]),
      maxTickNumber: 1,
      registry: createRegistryContract(),
    });

    expect(getDevice(report, 1, "purifier").channelRecipes["default"]).toMatchObject({
      recipeId: "liquid_purifier_gas_copper_enr_1",
      state: "running",
    });
    expect(findSlot(report, 1, "purifier", "gas_input_buffer", "input_gas_slot_1"))
      .toMatchObject({
        itemType: "item_gas_copper",
        count: 0,
        ignoreStock: true,
      });
    expect(findSlot(report, 1, "purifier", "item_input_buffer", "input_item_slot_1"))
      .toMatchObject({
        itemType: "item_filter_core",
        count: 0,
        ignoreStock: true,
      });
  });
});
