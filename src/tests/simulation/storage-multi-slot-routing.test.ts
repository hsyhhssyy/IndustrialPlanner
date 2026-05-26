import { describe, expect, it } from "vitest";

import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorldEntity } from "@/domain/document/world-document";
import { runBlueprintSimulation } from "@/simulation/blueprint-runner";
import {
  createBlueprint,
  createEntity,
  findSlot,
} from "./blueprint-test-helpers";

const FINAL_TICK = 260;
const SINK_STORAGE_ID = "sink-storage";

describe("协议存储箱多槽入库路由", () => {
  it("直连严格传送带时应从 1、2 槽接收两种物品", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createTwoItemSinkBlueprint({
        finalHopDefinitionId: "belt_straight_1x1",
        finalHopRotation: 270,
      }),
      maxTickNumber: FINAL_TICK,
    });

    expectFirstTwoSlotsToContainBothItems(report);
  });

  it("相邻分流器时应从 1、2 槽接收两种物品", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createTwoItemSinkBlueprint({
        finalHopDefinitionId: "item_log_splitter",
        finalHopRotation: 180,
      }),
      maxTickNumber: FINAL_TICK,
    });

    expectFirstTwoSlotsToContainBothItems(report);
  });
});

function createTwoItemSinkBlueprint(options: {
  readonly finalHopDefinitionId: "belt_straight_1x1" | "item_log_splitter";
  readonly finalHopRotation: WorldEntity["rotation"];
}): BlueprintDocument {
  return createBlueprint(`storage-multi-slot-${options.finalHopDefinitionId}`, [
    createEntity(
      "originium-source",
      "item_port_unloader_1",
      41,
      25,
      180,
      createUnloaderWarehouseLinkConfig("originium-source", "item_originium_ore"),
    ),
    createEntity(
      "iron-source",
      "item_port_unloader_1",
      45,
      25,
      180,
      createUnloaderWarehouseLinkConfig("iron-source", "item_iron_ore"),
    ),
    createEntity("converger", "item_log_converger", 44, 23, 180),
    createEntity("right-entry", "belt_straight_1x1", 46, 24, 270),
    createEntity("right-turn", "belt_turn_ccw_1x1", 46, 23, 180),
    createEntity("right-feed", "belt_straight_1x1", 45, 23, 180),
    createEntity("left-entry", "belt_straight_1x1", 42, 24, 270),
    createEntity("left-turn", "belt_turn_cw_1x1", 42, 23, 90),
    createEntity("left-feed", "belt_straight_1x1", 43, 23, 0),
    createEntity("final-hop", options.finalHopDefinitionId, 44, 22, options.finalHopRotation),
    createEntity(SINK_STORAGE_ID, "item_port_storager_1", 43, 19, 0),
  ]);
}

function createUnloaderWarehouseLinkConfig(
  entityId: string,
  itemId: string,
): WorldEntity["config"] {
  return {
    "links[0].id": "",
    "links[0].linkType": "share-all",
    "links[0].source.entityId": entityId,
    "links[0].source.storageSlotGroupId": "unloader_buffer",
    "links[0].source.slotId": "slot_1",
    "links[0].target.entityId": "warehouse",
    "links[0].target.storageSlotGroupId": "warehouse",
    "links[0].target.slotId": itemId,
    "storageSlotGroups[0].slots[0].ignoreStock": true,
  };
}

function expectFirstTwoSlotsToContainBothItems(
  report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
): void {
  const firstSlot = findSlot(report, FINAL_TICK, SINK_STORAGE_ID, "storage_slot_1", "slot_1");
  const secondSlot = findSlot(report, FINAL_TICK, SINK_STORAGE_ID, "storage_slot_2", "slot_1");

  expect(firstSlot.count).toBeGreaterThan(0);
  expect(secondSlot.count).toBeGreaterThan(0);
  expect([firstSlot.itemType, secondSlot.itemType].sort()).toEqual([
    "item_iron_ore",
    "item_originium_ore",
  ]);
}
