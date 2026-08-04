import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  getDevice,
} from "./blueprint-test-helpers";

const ITEM_ID = "item_xiranite_powder";
const ADMISSION_COUNTER_ID = "item_input:in_w";
const FINAL_TICK = 70 * STANDARD_TICK_RATE_PER_SECOND;
const FULL_BELT_RATE_PER_MINUTE = 30;
const BALANCED_STORAGE_DEVICE_IDS = ["storage"] as const;

describe("协议储存箱持续吞吐", () => {
  it("三路传送带应以每路 30/min 同时满速输入和输出", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("protocol-storage-full-throughput", [
        // 保持用户蓝图的设备顺序，覆盖输入、输出同时持续工作的调度路径。
        createEntity("source", "storager_1", 14, 25, 0, {
          channelRecipes: { warehouse_submit: "r_warehouse_submit" },
          "storageSlotGroups[0].slots[0].initialItemType": ITEM_ID,
          "storageSlotGroups[0].slots[0].initialCount": 50,
          "storageSlotGroups[0].slots[0].ignoreStock": true,
        }),
        createEntity("input-belt-1", "belt_straight_1x1", 14, 24, 270),
        createEntity("output-belt-1", "belt_straight_1x1", 14, 18, 270),
        createEntity("input-belt-2", "belt_straight_1x1", 15, 24, 270),
        createEntity("output-belt-2", "belt_straight_1x1", 15, 18, 270),
        createEntity("input-belt-3", "belt_straight_1x1", 16, 24, 270),
        createEntity("output-belt-3", "belt_straight_1x1", 16, 18, 270),
        createEntity("sink", "storager_1", 14, 15, 0, {
          channelRecipes: { warehouse_submit: "r_warehouse_submit" },
        }),
        createEntity("storage", "storager_1", 14, 20, 0, {
          channelRecipes: { warehouse_submit: "r_warehouse_submit" },
        }),
        createMeteredBeltAdmission("input-meter-1", 14, 23),
        createMeteredBeltAdmission("input-meter-2", 15, 23),
        createMeteredBeltAdmission("input-meter-3", 16, 23),
        createMeteredBeltAdmission("output-meter-1", 14, 19),
        createMeteredBeltAdmission("output-meter-2", 15, 19),
        createMeteredBeltAdmission("output-meter-3", 16, 19),
      ]),
      maxTickNumber: FINAL_TICK,
      registry: createRegistryContract(),
    });

    const inputRates = readOneMinuteCounts(report, [
      "input-meter-1",
      "input-meter-2",
      "input-meter-3",
    ]);
    const outputRates = readOneMinuteCounts(report, [
      "output-meter-1",
      "output-meter-2",
      "output-meter-3",
    ]);

    expect(inputRates).toEqual([
      FULL_BELT_RATE_PER_MINUTE,
      FULL_BELT_RATE_PER_MINUTE,
      FULL_BELT_RATE_PER_MINUTE,
    ]);
    expect(outputRates).toEqual([
      FULL_BELT_RATE_PER_MINUTE,
      FULL_BELT_RATE_PER_MINUTE,
      FULL_BELT_RATE_PER_MINUTE,
    ]);
    expect(inputRates.reduce((total, rate) => total + rate, 0)).toBe(90);
    expect(outputRates.reduce((total, rate) => total + rate, 0)).toBe(90);
    expectOnlyFirstStorageSlotUsedAtEveryTick(report);
  });
});

function createMeteredBeltAdmission(id: string, x: number, y: number) {
  return createEntity(id, "log_admission", x, y, 270, {
    "portGroups[0].ports[0].acceptRule": {
      base: { kind: "item", itemId: ITEM_ID },
      exclude: [],
    },
    "portGroups[0].ports[0].admissionRule": {
      itemId: ITEM_ID,
      limit: null,
      perMinuteLimit: null,
    },
  });
}

function readOneMinuteCounts(
  report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
  deviceIds: readonly string[],
): number[] {
  return deviceIds.map((deviceId) =>
    getDevice(report, FINAL_TICK, deviceId)
      .admissionCounters?.[ADMISSION_COUNTER_ID]?.oneMinuteCount ?? 0,
  );
}

function expectOnlyFirstStorageSlotUsedAtEveryTick(
  report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
): void {
  const firstSlotObservedByDevice = new Set<string>();

  for (const tick of report.ticks) {
    for (const deviceId of BALANCED_STORAGE_DEVICE_IDS) {
      const slotItems = tick.devices[deviceId]?.slotItems;
      expect(slotItems, `tick ${tick.tickNumber}: 缺少协议存储箱 ${deviceId} 的槽位状态`).toBeDefined();

      const filledSlots = slotItems?.filter((slot) => slot.count > 0) ?? [];
      if (filledSlots.some((slot) => slot.storageGroupId === "storage_slot_1")) {
        firstSlotObservedByDevice.add(deviceId);
      }
      expect(
        filledSlots.filter((slot) => slot.storageGroupId !== "storage_slot_1"),
        `tick ${tick.tickNumber}: 协议存储箱 ${deviceId} 的第 2～6 格不应有物品`,
      ).toEqual([]);
    }
  }

  expect([...firstSlotObservedByDevice].sort()).toEqual([...BALANCED_STORAGE_DEVICE_IDS].sort());
}
