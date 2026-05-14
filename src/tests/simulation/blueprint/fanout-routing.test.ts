import { describe, expect, it } from "vitest";

import { runBlueprintSimulation } from "@/simulation/blueprint-runner";
import {
  createBlueprint,
  createEntity,
  findSlotWithItem,
  getTick,
} from "../blueprint-test-helpers";

describe("REQ-076: fanout routing", () => {
  it("routes around blocked fan-out inputs instead of starving open downstream capacity", async () => {
    const blockedConfig = Object.fromEntries([0, 1, 2, 3, 4, 5].flatMap((index) => [
      [`storageSlotGroups[0].slots[${index}].initialItemType`, "item_copper_ore"],
      [`storageSlotGroups[0].slots[${index}].initialCount`, 50],
    ]));
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("blocked-fanout", [
        createEntity("source-storage", "item_port_storager_1", 0, 0, 0, {
          "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
          "storageSlotGroups[0].slots[0].initialCount": 1,
        }),
        createEntity("blocked-storage", "item_port_storager_1", 0, -3, 0, blockedConfig),
        createEntity("open-storage", "item_port_storager_1", 1, -3),
      ]),
      maxTickNumber: 1,
    });
    const tickOne = getTick(report, 1);

    expect(tickOne.transfers.some((transfer) =>
      transfer.targetSlotId.includes("device:blocked-storage"),
    )).toBe(false);
    expect(tickOne.transfers.some((transfer) =>
      transfer.targetSlotId.includes("device:open-storage"),
    )).toBe(true);
    expect(findSlotWithItem(report, 1, "open-storage", "item_iron_ore"))
      .toMatchObject({
        storageGroupId: "item_storage",
        itemType: "item_iron_ore",
        count: 1,
      });
  });
});
