import { describe, expect, it } from "vitest";

import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import { runBlueprintSimulation } from "@/simulation/blueprint-runner";
import {
  createBlueprint,
  createEntity,
  getDevice,
  getTick,
} from "./blueprint-test-helpers";

function createBeltTransportBlueprint(): BlueprintDocument {
  return createBlueprint("belt-transport", [
    createEntity("source-storage", "item_port_storager_1", 0, 0, 0, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
      "storageSlotGroups[0].slots[0].initialCount": 20,
    }),
    createEntity("belt", "belt_straight_1x1", 0, -1, 270),
    createEntity("sink-storage", "item_port_storager_1", 0, -4),
  ]);
}

describe("REQ-076: belt transport", () => {
  it("covers layered reverse solving, split belt buffers, and belt dynamic recipes through a transport blueprint", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBeltTransportBlueprint(),
      maxTickNumber: 60,
    });
    const tickOne = getTick(report, 1);
    const tickTwenty = getTick(report, 20);
    const tickSixty = getTick(report, 60);
    const belt = getDevice(report, 20, "belt");

    expect(tickOne.transfers.some((transfer) =>
      transfer.sourceSlotId.includes("device:source-storage")
      && transfer.targetSlotId.includes("device:belt"),
    )).toBe(false);
    expect(tickTwenty.transfers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemType: "item_iron_ore",
        amount: 1,
      }),
    ]));
    expect(tickTwenty.transfers.some((transfer) =>
      transfer.sourceSlotId.includes("device:source-storage")
      && transfer.targetSlotId.includes("device:belt"),
    )).toBe(true);
    expect(tickSixty.transfers.some((transfer) =>
      transfer.sourceSlotId.includes("device:belt")
      && transfer.targetSlotId.includes("device:sink-storage"),
    )).toBe(true);
    expect(getDevice(report, 20, "source-storage").slotItems).toHaveLength(6);
    expect(belt.slotItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        storageGroupId: "item_buffer",
        slotId: "slot_1",
        viewRole: "input-view",
      }),
      expect.objectContaining({
        storageGroupId: "item_buffer",
        slotId: "slot_1",
        viewRole: "output-view",
      }),
    ]));
    expect(report.summary.transportComponentThroughput).toEqual(expect.arrayContaining([
      expect.objectContaining({
        transportClass: "strict-belt",
        sourceEntityIds: ["belt"],
        itemAmounts: {
          item_iron_ore: expect.any(Number),
        },
      }),
    ]));
    expect(belt.recipeId).toBe("belt_straight_1x1:dynamic-belt-transfer");
  });
});
