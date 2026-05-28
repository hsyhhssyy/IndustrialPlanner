import { describe, expect, it } from "vitest";

import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorldEntity } from "@/domain/document/world-document";
import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "@/simulation/blueprint-runner";
import {
  createBlueprint,
  createEntity,
  findSlot,
} from "./blueprint-test-helpers";

const FINAL_TICK = 260;
const SINK_STORAGE_ID = "sink-storage";
const STORAGE_FILL_OBSERVE_TICK = 2000;
const OBSERVE_STORAGE_ID = "observe-storage";
const OTHER_STORAGE_ID = "other-storage";

describe("协议存储箱多槽入库路由", () => {
  it("直连严格传送带时应从 1、2 槽接收两种物品", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createTwoItemSinkBlueprint({
        finalHopDefinitionId: "belt_straight_1x1",
        finalHopRotation: 270,
      }),
      registry: createRegistryContract(),
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
      registry: createRegistryContract(),
      maxTickNumber: FINAL_TICK,
    });

    expectFirstTwoSlotsToContainBothItems(report);
  });
});

describe("存储箱满槽观察测试", () => {
  it("当任意其他存储箱至少 2 个槽位有物品时，观察对象存储箱应至少 1 个槽位有物品", async () => {
    const blueprint = createStorageFillObserveBlueprint();
    const report = await runBlueprintSimulation({
      blueprint,
      registry: createRegistryContract(),
      maxTickNumber: STORAGE_FILL_OBSERVE_TICK,
    });

    const storagerIds = [OBSERVE_STORAGE_ID, OTHER_STORAGE_ID];
    const violations: string[] = [];
    let maxOtherFilledSlots = 0;

    for (const tick of report.ticks) {
      const observeFilled = countFilledSlots(report, tick.tickNumber, OBSERVE_STORAGE_ID);
      const otherFilled = Math.max(
        0,
        ...storagerIds
          .filter((id) => id !== OBSERVE_STORAGE_ID)
          .map((id) => countFilledSlots(report, tick.tickNumber, id)),
      );

      maxOtherFilledSlots = Math.max(maxOtherFilledSlots, otherFilled);
      if (otherFilled >= 2 && observeFilled < 1) {
        violations.push(
          `tick ${tick.tickNumber}: ${OTHER_STORAGE_ID} 有 ${otherFilled} 个槽位有物品，但 ${OBSERVE_STORAGE_ID} 只有 ${observeFilled} 个`,
        );
      }
    }

    expect(maxOtherFilledSlots).toBeGreaterThanOrEqual(2);
    expect(violations).toHaveLength(0);
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

function createStorageFillObserveBlueprint(): BlueprintDocument {
  return createBlueprint("storage-fill-observe", [
    createEntity(
      "originium-source",
      "item_port_unloader_1",
      32,
      26,
      180,
      createUnloaderWarehouseLinkConfig("originium-source", "item_originium_ore"),
    ),
    createEntity(
      "iron-source",
      "item_port_unloader_1",
      35,
      26,
      180,
      createUnloaderWarehouseLinkConfig("iron-source", "item_iron_ore"),
    ),
    createEntity(OBSERVE_STORAGE_ID, "item_port_storager_1", 33, 18, 0, createObserveStorageInitialConfig()),
    createEntity("converger", "item_log_converger", 34, 24, 180),
    createEntity("left-entry", "belt_straight_1x1", 33, 25, 270),
    createEntity("left-turn", "belt_turn_cw_1x1", 33, 24, 90),
    createEntity("right-entry", "belt_straight_1x1", 36, 25, 270),
    createEntity("right-turn", "belt_turn_ccw_1x1", 36, 24, 180),
    createEntity("right-feed", "belt_straight_1x1", 35, 24, 180),
    createEntity("splitter", "item_log_splitter", 34, 21, 180),
    createEntity("splitter-input-1", "belt_straight_1x1", 34, 23, 270),
    createEntity("splitter-input-2", "belt_straight_1x1", 34, 22, 270),
    createEntity("splitter-output", "belt_straight_1x1", 35, 21, 0),
    createEntity(OTHER_STORAGE_ID, "item_port_storager_1", 36, 19, 90),
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

function createObserveStorageInitialConfig(): WorldEntity["config"] {
  return Object.fromEntries(
    Array.from({ length: 6 }, (_, index) => [
      [
        `storageSlotGroups[${index}].slots[0].initialItemType`,
        "item_originium_ore",
      ],
      [
        `storageSlotGroups[${index}].slots[0].initialCount`,
        1,
      ],
    ]).flat(),
  );
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

function countFilledSlots(
  report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
  tickNumber: number,
  deviceId: string,
): number {
  return report.ticks
    .find((tick) => tick.tickNumber === tickNumber)
    ?.devices[deviceId]
    ?.slotItems
    .filter((slot) => slot.count > 0)
    .length ?? 0;
}
