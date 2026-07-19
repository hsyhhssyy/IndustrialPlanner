import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import {
  WATER_PURIFIER_DEFAULT_OUTPUT_MODE,
  WATER_PURIFIER_MANUAL_OUTPUT_PER_MINUTE_CONFIG_KEY,
  WATER_PURIFIER_NODE_ENTITY_ID,
  WATER_PURIFIER_OUTPUT_ITEM_ID,
  WATER_PURIFIER_OUTPUT_MODE_CONFIG_KEY,
  WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID,
  WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID,
} from "@/shared/water-purifier-node";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  findSlot,
  getDevice,
} from "./blueprint-test-helpers";

const COMPLETION_TICK = STANDARD_TICK_RATE_PER_SECOND + 1;

describe("净水节点 runtime", () => {
  it("input-derived mode immediately frees all three 2-drop input slots and later stores sewage in the 500 buffer", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("water-purifier-node-input-derived", [
        createWaterPurifierNode({
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_sewage",
          "storageSlotGroups[0].slots[0].initialCount": 2,
          "storageSlotGroups[1].slots[0].initialItemType": "item_liquid_sewage",
          "storageSlotGroups[1].slots[0].initialCount": 2,
          "storageSlotGroups[2].slots[0].initialItemType": "item_liquid_sewage",
          "storageSlotGroups[2].slots[0].initialCount": 2,
        }),
        createEntity("power", "power_diffuser_1", 28, -5),
      ]),
      maxTickNumber: COMPLETION_TICK,
      registry: createRegistryContract(),
    });

    expect(getDevice(report, 1, "water-node").channelRecipes).toMatchObject({
      intake_1: { recipeId: "r_water_purifier_node_collect_sewage_basic" },
      intake_2: { recipeId: "r_water_purifier_node_collect_sewage_basic" },
      intake_3: { recipeId: "r_water_purifier_node_collect_sewage_basic" },
    });
    expect(findSlot(report, 1, "water-node", "input_buffer_1", "slot_1")).toMatchObject({
      count: 0,
    });
    expect(findSlot(report, 1, "water-node", "input_buffer_2", "slot_1")).toMatchObject({
      count: 0,
    });
    expect(findSlot(report, 1, "water-node", "input_buffer_3", "slot_1")).toMatchObject({
      count: 0,
    });
    expect(findSlot(report, COMPLETION_TICK, "water-node", WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID, "slot_1"))
      .toMatchObject({
        itemType: "item_liquid_sewage",
        count: 6,
      });
  });

  it("converts 30 sewage in the internal buffer to 1 xiranite waste liquid", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("water-purifier-node-byproduct", [
        createWaterPurifierNode({
          "storageSlotGroups[3].slots[0].initialItemType": "item_liquid_sewage",
          "storageSlotGroups[3].slots[0].initialCount": 30,
        }),
        createEntity("power", "power_diffuser_1", 28, -5),
      ]),
      maxTickNumber: COMPLETION_TICK,
      registry: createRegistryContract(),
    });

    expect(findSlot(report, COMPLETION_TICK, "water-node", WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID, "slot_1"))
      .toMatchObject({
        itemType: WATER_PURIFIER_OUTPUT_ITEM_ID,
        count: 1,
      });
  });

  it("manual mode produces the configured per-minute output without sewage input", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("water-purifier-node-manual-output", [
        createWaterPurifierNode({
          [WATER_PURIFIER_OUTPUT_MODE_CONFIG_KEY]: "manual-rate",
          [WATER_PURIFIER_MANUAL_OUTPUT_PER_MINUTE_CONFIG_KEY]: 60,
        }),
        createEntity("power", "power_diffuser_1", 28, -5),
      ]),
      maxTickNumber: STANDARD_TICK_RATE_PER_SECOND,
      registry: createRegistryContract(),
    });

    expect(findSlot(report, STANDARD_TICK_RATE_PER_SECOND, "water-node", WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID, "slot_1"))
      .toMatchObject({
        itemType: WATER_PURIFIER_OUTPUT_ITEM_ID,
        count: 1,
      });
  });

  it("manual mode keeps sewage intake running but disables automatic byproduct output", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("water-purifier-node-manual-disables-input", [
        createWaterPurifierNode({
          [WATER_PURIFIER_OUTPUT_MODE_CONFIG_KEY]: "manual-rate",
          [WATER_PURIFIER_MANUAL_OUTPUT_PER_MINUTE_CONFIG_KEY]: 0,
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_sewage",
          "storageSlotGroups[0].slots[0].initialCount": 2,
          "storageSlotGroups[3].slots[0].initialItemType": "item_liquid_sewage",
          "storageSlotGroups[3].slots[0].initialCount": 30,
        }),
        createEntity("power", "power_diffuser_1", 28, -5),
      ]),
      maxTickNumber: 5,
      registry: createRegistryContract(),
    });

    expect(getDevice(report, 1, "water-node").channelRecipes).toMatchObject({
      intake_1: { recipeId: "r_water_purifier_node_collect_sewage_basic" },
    });
    expect(getDevice(report, 5, "water-node").channelRecipes).not.toHaveProperty("byproduct");
    expect(findSlot(report, 1, "water-node", "input_buffer_1", "slot_1")).toMatchObject({
      count: 0,
    });
    expect(findSlot(report, 5, "water-node", WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID, "slot_1")).toMatchObject({
      itemType: "item_liquid_sewage",
      count: 30,
    });
  });
});

function createWaterPurifierNode(config: Record<string, unknown>) {
  return createEntity("water-node", WATER_PURIFIER_NODE_ENTITY_ID, 0, -5, 0, {
    [WATER_PURIFIER_OUTPUT_MODE_CONFIG_KEY]: WATER_PURIFIER_DEFAULT_OUTPUT_MODE,
    ...config,
  });
}
