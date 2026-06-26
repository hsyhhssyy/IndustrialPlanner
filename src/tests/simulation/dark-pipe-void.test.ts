import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { createDarkPipeSlotLink } from "@/shared/dark-pipe-link";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  createWarehouseSlotLink,
  findSlot,
  getDevice,
} from "./blueprint-test-helpers";

describe("dark pipe liquid void", () => {
  it("voids liquid from a single-port dark pipe inlet by hidden recipe", async () => {
    const finalTick = (2 * STANDARD_TICK_RATE_PER_SECOND) + 5;
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("single-dark-pipe-inlet-void", [
        createEntity("inlet", "item_port_udpipe_loader_1", 0, 0, 0, {
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
          "storageSlotGroups[0].slots[0].initialCount": 4,
        }),
      ]),
      maxTickNumber: finalTick,
      registry: createRegistryContract(),
    });

    expect(getDevice(report, 1, "inlet").channelRecipes["void_liquid"]?.recipeId)
      .toBe("r_udpipe_loader_void_liquid_any_internal");
    expect(findSlot(report, finalTick, "inlet", "loader_buffer", "slot_1").count).toBe(0);
  });

  it("voids liquid through two channels on the multi-port dark pipe inlet", async () => {
    const finalTick = (2 * STANDARD_TICK_RATE_PER_SECOND) + 5;
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("multi-dark-pipe-inlet-void", [
        createEntity("inlet", "item_port_udpipe_loader_2", 0, 0, 0, {
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
          "storageSlotGroups[0].slots[0].initialCount": 8,
        }),
      ]),
      maxTickNumber: finalTick,
      registry: createRegistryContract(),
    });

    expect(getDevice(report, 1, "inlet").channelRecipes["void_liquid_1"]?.recipeId)
      .toBe("r_udpipe_loader_multi_void_liquid_any_internal");
    expect(getDevice(report, 1, "inlet").channelRecipes["void_liquid_2"]?.recipeId)
      .toBe("r_udpipe_loader_multi_void_liquid_any_internal");
    expect(findSlot(report, finalTick, "inlet", "loader_buffer", "slot_1").count).toBe(0);
  });

  it("keeps dark pipe outlets empty by default when no warehouse item is selected", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("dark-pipe-outlet-default-empty", [
        createEntity("single-outlet", "item_port_udpipe_unloader_1", 0, 0),
        createEntity("multi-outlet", "item_port_udpipe_unloader_2", 4, 0),
      ]),
      maxTickNumber: STANDARD_TICK_RATE_PER_SECOND,
      registry: createRegistryContract(),
    });

    expect(findSlot(report, STANDARD_TICK_RATE_PER_SECOND, "single-outlet", "unloader_buffer", "slot_1"))
      .toMatchObject({ itemType: null, count: 0 });
    expect(findSlot(report, STANDARD_TICK_RATE_PER_SECOND, "multi-outlet", "unloader_buffer", "slot_1"))
      .toMatchObject({ itemType: null, count: 0 });
  });

  it("does not void liquid from a linked dark pipe inlet with manual recipe channels", async () => {
    const finalTick = (2 * STANDARD_TICK_RATE_PER_SECOND) + 5;
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint(
        "linked-dark-pipe-inlet-manual-void",
        [
          createEntity("inlet", "item_port_udpipe_loader_1", 0, 0, 0, {
            "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
            "storageSlotGroups[0].slots[0].initialCount": 4,
            "recipeChannels[0].manualRecipeOnly": true,
          }),
          createEntity("outlet", "item_port_udpipe_unloader_1", 6, 0),
        ],
        [
          createDarkPipeSlotLink({
            inletEntityId: "inlet",
            outletEntityId: "outlet",
          }),
        ],
      ),
      maxTickNumber: finalTick,
      registry: createRegistryContract(),
    });

    expect(getDevice(report, 1, "inlet").channelRecipes["void_liquid"]).toBeUndefined();
    expect(findSlot(report, finalTick, "inlet", "loader_buffer", "slot_1").count).toBe(4);
  });

  it("outputs liquid through a linked outlet when the inlet is chained to warehouse stock", async () => {
    const finalTick = (3 * STANDARD_TICK_RATE_PER_SECOND) + 5;
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint(
        "linked-dark-pipe-inlet-warehouse-source",
        [
          createEntity("inlet", "item_port_udpipe_loader_1", -6, 0, 0, {
            "storageSlotGroups[0].slots[0].lock": "item_liquid_sewage",
            "storageSlotGroups[0].slots[0].ignoreStock": true,
            "recipeChannels[0].manualRecipeOnly": true,
          }),
          createEntity("outlet", "item_port_udpipe_unloader_1", 0, 0),
          createEntity("pipe", "pipe_straight_1x1", 3, 1),
          createEntity("sink", "item_port_udpipe_loader_1", 4, 0, 0, {
            "recipeChannels[0].manualRecipeOnly": true,
          }),
        ],
        [
          createWarehouseSlotLink("inlet", "item_liquid_sewage", "loader_buffer", "slot_1"),
          createDarkPipeSlotLink({
            inletEntityId: "inlet",
            outletEntityId: "outlet",
          }),
        ],
      ),
      maxTickNumber: finalTick,
      registry: createRegistryContract(),
    });

    const sinkSlot = findSlot(report, finalTick, "sink", "loader_buffer", "slot_1");
    expect(sinkSlot.itemType).toBe("item_liquid_sewage");
    expect(sinkSlot.count).toBeGreaterThan(0);
  });
});
