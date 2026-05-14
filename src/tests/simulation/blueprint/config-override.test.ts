import { describe, expect, it } from "vitest";

import { runBlueprintSimulation } from "@/simulation/blueprint-runner";
import {
  createBlueprint,
  createEntity,
  findSlot,
  getTick,
} from "../blueprint-test-helpers";

describe("REQ-076: config overrides", () => {
  it("runs a self-contained blueprint and applies slot plus port config overrides", async () => {
    const blueprint = createBlueprint("config-overrides", [
      createEntity("source-storage", "item_port_storager_1", 0, 0, 0, {
        "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
        "storageSlotGroups[0].slots[0].initialCount": 7,
        "storageSlotGroups[0].slots[0].ignoreStock": true,
        "portGroups[1].ports[0].count": 3,
      }),
      createEntity("sink-storage", "item_port_storager_1", 0, -3),
    ]);

    const report = await runBlueprintSimulation({
      blueprint,
      maxTickNumber: 1,
    });

    expect(report.blueprint).toMatchObject({
      name: "config-overrides",
      baseId: "wuling_protocol_core",
      entityCount: 2,
      slotLinkCount: 0,
    });
    expect(report.execution).toEqual({
      maxTickNumber: 1,
      totalTicksCaptured: 2,
    });
    expect(report.ticks.map((tick) => tick.tickNumber)).toEqual([0, 1]);
    expect(report.summary.totalTicksCaptured).toBe(2);
    expect(report.topology.topologyId.length).toBeGreaterThan(0);

    expect(findSlot(report, 0, "source-storage", "item_storage", "slot_1"))
      .toMatchObject({
        itemType: "item_iron_ore",
        count: 7,
      });
    expect(findSlot(report, 1, "source-storage", "item_storage", "slot_1").count)
      .toBe(7);
    expect(findSlot(report, 1, "sink-storage", "item_storage", "slot_1"))
      .toMatchObject({
        itemType: "item_iron_ore",
        count: 3,
      });
    expect(getTick(report, 1).transfers).toHaveLength(3);
  });
});
