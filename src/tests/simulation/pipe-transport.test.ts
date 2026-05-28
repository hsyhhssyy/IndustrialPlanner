import { describe, expect, it } from "vitest";

import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  getDevice,
  getTick,
} from "./blueprint-test-helpers";

function createLiquidPipeTransportBlueprint(): BlueprintDocument {
  return createBlueprint("pipe-transport", [
    createEntity("source-liquid-storage", "item_port_liquid_storager_1", 0, 0, 0, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
      "storageSlotGroups[0].slots[0].initialCount": 1,
    }),
    createEntity("pipe", "pipe_straight_1x1", 3, 1),
    createEntity("sink-liquid-storage", "item_port_liquid_storager_1", 4, 0),
  ]);
}

describe("REQ-076: pipe transport", () => {
  it("covers pipe transport components and pipe dynamic recipes through a liquid blueprint", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createLiquidPipeTransportBlueprint(),
      registry: createRegistryContract(),
      maxTickNumber: 20,
    });
    const tickOne = getTick(report, 1);
    const tickTen = getTick(report, 10);
    const tickTwenty = getTick(report, 20);
    const pipe = getDevice(report, 10, "pipe");

    expect(tickOne.transfers.some((transfer) =>
      transfer.sourceSlotId.includes("device:source-liquid-storage")
      && transfer.targetSlotId.includes("device:pipe"),
    )).toBe(false);
    expect(tickTen.transfers.some((transfer) =>
      transfer.sourceSlotId.includes("device:source-liquid-storage")
      && transfer.targetSlotId.includes("device:pipe"),
    )).toBe(true);
    expect(tickTwenty.transfers.some((transfer) =>
      transfer.sourceSlotId.includes("device:pipe")
      && transfer.targetSlotId.includes("device:sink-liquid-storage"),
    )).toBe(true);
    expect(pipe.slotItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        storageGroupId: "synthetic-input",
        slotId: "slot_1",
        viewRole: "single-view",
      }),
      expect.objectContaining({
        storageGroupId: "synthetic-output",
        slotId: "slot_1",
        viewRole: "single-view",
      }),
    ]));
    expect(report.summary.transportComponentThroughput).toEqual(expect.arrayContaining([
      expect.objectContaining({
        transportClass: "strict-pipe",
        sourceEntityIds: ["pipe"],
        itemAmounts: {
          item_liquid_water: expect.any(Number),
        },
      }),
    ]));
    expect(pipe.recipeId).toBe("pipe_straight_1x1:dynamic-pipe-transfer");
  });
});
