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

describe("dark pipe warehouse ingress", () => {
  it("submits fluid from an unlinked single-port dark pipe inlet to the single-base warehouse", async () => {
    const finalTick = STANDARD_TICK_RATE_PER_SECOND;
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("single-dark-pipe-inlet-warehouse", [
        createEntity("source", "udpipe_unloader_1", 0, 0, 0, {
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
          "storageSlotGroups[0].slots[0].initialCount": 1,
        }),
        createEntity("pipe", "pipe_straight_1x1", 3, 1),
        createEntity("inlet", "udpipe_loader_1", 4, 0),
      ]),
      maxTickNumber: finalTick,
      registry: createRegistryContract(),
    });

    expect(getDevice(report, finalTick, "inlet").channelRecipes).toEqual({});
    expect(findSlot(report, finalTick, "inlet", "loader_buffer", "slot_1")).toMatchObject({
      itemType: null,
      count: 0,
    });
    expect(listWarehouseIngressTransfers(report)).toEqual([
      expect.objectContaining({ itemType: "item_liquid_water", amount: 1 }),
    ]);
  });

  it("submits fluid from an unlinked multi-port dark pipe inlet to the single-base warehouse", async () => {
    const finalTick = STANDARD_TICK_RATE_PER_SECOND;
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("multi-dark-pipe-inlet-warehouse", [
        createEntity("source", "udpipe_unloader_1", 0, 0, 0, {
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
          "storageSlotGroups[0].slots[0].initialCount": 1,
        }),
        createEntity("pipe", "pipe_straight_1x1", 3, 1),
        createEntity("inlet", "udpipe_loader_2", 4, 0),
      ]),
      maxTickNumber: finalTick,
      registry: createRegistryContract(),
    });

    expect(getDevice(report, finalTick, "inlet").channelRecipes).toEqual({});
    expect(findSlot(report, finalTick, "inlet", "loader_buffer", "slot_1")).toMatchObject({
      itemType: null,
      count: 0,
    });
    expect(listWarehouseIngressTransfers(report)).toEqual([
      expect.objectContaining({ itemType: "item_liquid_water", amount: 1 }),
    ]);
  });

  it("keeps dark pipe outlets empty by default when no warehouse item is selected", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("dark-pipe-outlet-default-empty", [
        createEntity("single-outlet", "udpipe_unloader_1", 0, 0),
        createEntity("multi-outlet", "udpipe_unloader_2", 4, 0),
      ]),
      maxTickNumber: STANDARD_TICK_RATE_PER_SECOND,
      registry: createRegistryContract(),
    });

    expect(findSlot(report, STANDARD_TICK_RATE_PER_SECOND, "single-outlet", "unloader_buffer", "slot_1"))
      .toMatchObject({ itemType: null, count: 0 });
    expect(findSlot(report, STANDARD_TICK_RATE_PER_SECOND, "multi-outlet", "unloader_buffer", "slot_1"))
      .toMatchObject({ itemType: null, count: 0 });
  });

  it("keeps fluid in the local share-all storage of a linked dark pipe inlet", async () => {
    const finalTick = (2 * STANDARD_TICK_RATE_PER_SECOND) + 5;
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint(
        "linked-dark-pipe-inlet-manual-void",
        [
          createEntity("inlet", "udpipe_loader_1", 0, 0, 0, {
            "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
            "storageSlotGroups[0].slots[0].initialCount": 4,
          }),
          createEntity("outlet", "udpipe_unloader_1", 6, 0),
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

    expect(getDevice(report, 1, "inlet").channelRecipes).toEqual({});
    expect(findSlot(report, finalTick, "inlet", "loader_buffer", "slot_1").count).toBe(4);
    expect(listWarehouseIngressTransfers(report)).toEqual([]);
  });

  it("outputs liquid through a linked outlet when the inlet is chained to warehouse stock", async () => {
    const finalTick = (3 * STANDARD_TICK_RATE_PER_SECOND) + 5;
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint(
        "linked-dark-pipe-inlet-warehouse-source",
        [
          createEntity("inlet", "udpipe_loader_1", -6, 0, 0, {
            "storageSlotGroups[0].slots[0].lock": "item_liquid_sewage",
            "storageSlotGroups[0].slots[0].ignoreStock": true,
          }),
          createEntity("outlet", "udpipe_unloader_1", 0, 0),
          createEntity("pipe", "pipe_straight_1x1", 3, 1),
          createEntity("sink", "udpipe_loader_1", 4, 0),
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

    expect(findSlot(report, finalTick, "sink", "loader_buffer", "slot_1")).toMatchObject({
      itemType: null,
      count: 0,
    });
    expect(listWarehouseIngressTransfers(report).some((transfer) =>
      transfer.itemType === "item_liquid_sewage",
    )).toBe(true);
  });
});

function listWarehouseIngressTransfers(
  report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
) {
  return report.ticks.flatMap((tick) => tick.transfers).filter((transfer) =>
    transfer.targetSlotId.includes("/node:warehouse/slot:"),
  );
}
