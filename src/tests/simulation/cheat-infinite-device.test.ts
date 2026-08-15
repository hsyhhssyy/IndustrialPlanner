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

const DEVICE_CASES = [
  {
    entityId: "solid",
    definitionId: "cheat_infinite_solid",
    itemId: "item_iron_ore",
    recipeId: "r_cheat_infinite_solid_void_any_internal",
  },
  {
    entityId: "liquid",
    definitionId: "cheat_infinite_liquid",
    itemId: "item_liquid_water",
    recipeId: "r_cheat_infinite_liquid_void_any_internal",
  },
  {
    entityId: "gas",
    definitionId: "cheat_infinite_gas",
    itemId: "item_gas_inert",
    recipeId: "r_cheat_infinite_gas_void_any_internal",
  },
] as const;

describe("cheat infinite device simulation", () => {
  it("destroys strict-domain inputs while retaining a 50-item infinite output slot", async () => {
    const finalTick = (2 * STANDARD_TICK_RATE_PER_SECOND) + 5;
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint(
        "cheat-infinite-device",
        DEVICE_CASES.map((deviceCase, index) => createEntity(
          deviceCase.entityId,
          deviceCase.definitionId,
          index * 3,
          0,
          0,
          {
            "storageSlotGroups[0].slots[0].initialItemType": deviceCase.itemId,
            "storageSlotGroups[0].slots[0].initialCount": 8,
            "storageSlotGroups[1].slots[0].initialItemType": deviceCase.itemId,
          },
        )),
      ),
      maxTickNumber: finalTick,
      registry: createRegistryContract(),
    });

    for (const deviceCase of DEVICE_CASES) {
      for (const channelId of ["void_1", "void_2", "void_3", "void_4"]) {
        expect(getDevice(report, 1, deviceCase.entityId).channelRecipes[channelId]?.recipeId)
          .toBe(deviceCase.recipeId);
      }
      expect(findSlot(
        report,
        finalTick,
        deviceCase.entityId,
        "destroy_buffer",
        "destroy_slot_1",
      ).count).toBe(0);
      expect(findSlot(
        report,
        finalTick,
        deviceCase.entityId,
        "infinite_output_buffer",
        "infinite_output_slot_1",
      )).toMatchObject({
        itemType: deviceCase.itemId,
        count: 50,
        ignoreStock: true,
      });
    }
  });
});
