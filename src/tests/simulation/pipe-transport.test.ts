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

function createLiquidPipeTransportBlueprint(initialCount = 2): BlueprintDocument {
  return createBlueprint("pipe-transport", [
    createEntity("source-liquid-storage", "liquid_storager_1", 0, 0, 0, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
      "storageSlotGroups[0].slots[0].initialCount": initialCount,
    }),
    createEntity("pipe", "pipe_straight_1x1", 3, 1),
    createEntity("sink-liquid-storage", "liquid_storager_1", 4, 0),
  ]);
}

describe("REQ-076: pipe transport", () => {
  it("covers pipe transport components and pipe dynamic recipes through a liquid blueprint", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createLiquidPipeTransportBlueprint(),
      registry: createRegistryContract(),
      maxTickNumber: 21,
    });
    const tickOne = getTick(report, 1);
    const tickTwo = getTick(report, 2);
    const tickTwentyOne = getTick(report, 21);
    const pipe = getDevice(report, 1, "pipe");

    expect(tickOne.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source-liquid-storage")
      && transfer.targetSlotId.includes("device:pipe"),
    )).toHaveLength(2);
    expect(tickTwo.transfers.some((transfer) =>
      transfer.sourceSlotId.includes("device:pipe")
      || transfer.targetSlotId.includes("device:pipe"),
    )).toBe(false);
    expect(tickTwentyOne.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:pipe")
      && transfer.targetSlotId.includes("device:sink-liquid-storage"),
    )).toHaveLength(2);
    expect(pipe.slotItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        storageGroupId: "synthetic-input",
        slotId: "slot_1",
        viewRole: "single-view",
        count: 2,
        reserved: 2,
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
    // AI-CORRECTION 2026-05-30: recipeId 已迁移到 channelRecipes["default"]。
    // AI-CORRECTION 2026-07-23: 2 件配方产物总量更高，在库存充足时必须优先于 1 件配方。
    expect(pipe.channelRecipes["default"]?.recipeId).toBe("pipe_straight_1x1:dynamic-pipe-transfer-2");
  });

  it("falls back to the one-item recipe when only one fluid item is available", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createLiquidPipeTransportBlueprint(1),
      registry: createRegistryContract(),
      maxTickNumber: 21,
    });

    expect(getDevice(report, 1, "pipe").channelRecipes["default"]?.recipeId)
      .toBe("pipe_straight_1x1:dynamic-pipe-transfer");
    expect(getTick(report, 21).transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:pipe")
      && transfer.targetSlotId.includes("device:sink-liquid-storage"),
    )).toHaveLength(1);
  });
});

// AI-REMOVED 2026-07-23:
// Reason: 旧测试按 0.5 秒单件管道在 tick 11 交付，无法覆盖新的整数秒门禁和 2/1 双配方。
// Trigger: 用户确认管道每秒结算一次、最高 2/s 且单件可送。
// Evidence: 新断言验证 tick 1 双件入管、tick 2 无搬运、tick 21 双件出管及单件兜底。
// Replacement: 上述两个 REQ-076 测试。
// Risk: Low
// Human Review: Required
//
// Original code:
// const tickEleven = getTick(report, 11);
// const pipe = getDevice(report, 10, "pipe");
// expect(tickEleven.transfers.some((transfer) =>
//   transfer.sourceSlotId.includes("device:pipe")
//   && transfer.targetSlotId.includes("device:sink-liquid-storage"),
// )).toBe(true);
