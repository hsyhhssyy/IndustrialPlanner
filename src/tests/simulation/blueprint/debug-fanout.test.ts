import { describe, it } from "vitest";
import { runBlueprintSimulation } from "@/simulation/blueprint-runner";
import { createBlueprint, createEntity, getTick } from "../blueprint-test-helpers";

describe("debug-fanout", () => {
  it("debug", async () => {
    const blockedConfig = Object.fromEntries([0, 1, 2, 3, 4, 5].flatMap((index) => [
      [`storageSlotGroups[0].slots[${index}].initialItemType`, "item_copper_ore"],
      [`storageSlotGroups[0].slots[${index}].initialCount`, 50],
    ]));
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("blocked-fanout", [
        createEntity("source-storage", "item_port_storager_1", 0, 1, 0, {
          "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
          "storageSlotGroups[0].slots[0].initialCount": 1,
        }),
        createEntity("belt-source", "belt_straight_1x1", 0, 0, 270),
        createEntity("splitter", "item_log_splitter", 0, -1, 90),
        createEntity("belt-blocked", "belt_straight_1x1", 0, -2, 270),
        createEntity("blocked-storage", "item_port_storager_1", 0, -5, 0, blockedConfig),
        createEntity("belt-open", "belt_straight_1x1", 1, -1, 0),
        createEntity("open-storage", "item_port_storager_1", 2, -1, 90),
      ]),
      maxTickNumber: 150,
    });

    console.log("Diagnostics:", JSON.stringify(report.topology.diagnostics));
    console.log("Topology ID:", report.topology.topologyId);

    for (const tick of report.ticks) {
      if (tick.transfers.length > 0) {
        console.log(`Tick ${tick.tickNumber} transfers (${tick.transfers.length}):`);
        for (const t of tick.transfers) {
          console.log(`  ${t.sourceSlotId} -> ${t.targetSlotId} [${t.itemType}]`);
        }
      }
    }

    // Check device inventory changes
    console.log("\nDevice inventory changes:");
    for (const change of report.summary.deviceInventoryChanges) {
      console.log(`  ${change.deviceId}:`);
      for (const sc of change.slotChanges) {
        if (sc.initialItemType || sc.finalItemType) {
          console.log(`    ${sc.storageGroupId}/${sc.slotId}: ${sc.initialItemType}(${sc.initialCount}) -> ${sc.finalItemType}(${sc.finalCount})`);
        }
      }
    }
  });
});
