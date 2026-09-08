import { describe, expect, it } from "vitest";

import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  getFirstTickAtSimulationMilliseconds,
  getDevice,
} from "./blueprint-test-helpers";
// AI-REMOVED 2026-09-08:
// Reason: 门禁相位改由整数毫秒定位，不再直接按引擎 tick 编号读取。
// Trigger: belt-transport 接入 Host 行为矩阵。
// Evidence: getFirstTickAtSimulationMilliseconds 可按报告 standardTickRate 定位相同业务相位。
// Replacement: getFirstTickAtSimulationMilliseconds。
// Risk: Low
// Human Review: Required
//
// Original code:
// import { getTick } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

function createBeltTransportBlueprint(): BlueprintDocument {
  return createBlueprint("belt-transport", [
    createEntity("source-storage", "storager_1", 0, 0, 0, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
      "storageSlotGroups[0].slots[0].initialCount": 20,
    }),
    createEntity("belt", "belt_straight_1x1", 0, -1, 270),
    createEntity("sink-storage", "storager_1", 0, -4),
  ]);
}

// AI-REMOVED 2026-09-08:
// Reason: 传送带运输属于所有生产求解器应满足的 Host 行为。
// Trigger: 用户确认门禁类测试改为 Host 行为矩阵。
// Evidence: 用例只通过 runBlueprintSimulation 公共入口观察传输和设备状态。
// Replacement: 下方 SIMULATION_ENGINE_MATRIX 参数化 describe。
// Risk: Dense 可能暴露运输时序或投影差异。
// Human Review: Required
//
// Original code:
// describe("REQ-076: belt transport", () => {
describe.each(SIMULATION_ENGINE_MATRIX)("REQ-076: belt transport [%s]", (engineKind) => {
  it("covers layered reverse solving, split belt buffers, and belt dynamic recipes through a transport blueprint", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBeltTransportBlueprint(),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 2.5,
      // AI-REMOVED 2026-09-08:
      // Reason: 观察窗口按业务时间表达，不绑定 Legacy tick 41。
      // Trigger: belt-transport 接入求解器矩阵。
      // Evidence: 2500ms 足以覆盖 2000ms 相位下的第一 tick。
      // Replacement: maxDurationSeconds: 2.5。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // maxTickNumber: 41,
    });
    const zeroMillisecondTick = getFirstTickAtSimulationMilliseconds(report, 0);
    const twoSecondTick = getFirstTickAtSimulationMilliseconds(report, 2_000);
    const belt = getDevice(report, twoSecondTick.tickNumber, "belt");
    // AI-REMOVED 2026-09-08:
    // Reason: tick 1/41 是 Legacy 坐标，业务含义分别是 0ms/2000ms 相位第一 tick。
    // Trigger: 用户要求门禁测试使用整数毫秒基准。
    // Evidence: helper 由各引擎 standardTickRate 精确换算。
    // Replacement: zeroMillisecondTick 与 twoSecondTick。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // const tickOne = getTick(report, 1);
    // const tickFortyOne = getTick(report, 41);
    // const belt = getDevice(report, 41, "belt");

    expect(zeroMillisecondTick.transfers.some((transfer) =>
      transfer.sourceSlotId.includes("device:source-storage")
      && transfer.targetSlotId.includes("device:belt"),
    )).toBe(true);
    expect(twoSecondTick.transfers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemType: "item_iron_ore",
        amount: 1,
      }),
    ]));
    expect(twoSecondTick.transfers.some((transfer) =>
      transfer.sourceSlotId.includes("device:source-storage")
      && transfer.targetSlotId.includes("device:belt"),
    )).toBe(true);
    expect(twoSecondTick.transfers.some((transfer) =>
      transfer.sourceSlotId.includes("device:belt")
      && transfer.targetSlotId.includes("device:sink-storage"),
    )).toBe(true);
    expect(getDevice(report, twoSecondTick.tickNumber, "source-storage").slotItems).toHaveLength(6);
    // AI-REMOVED 2026-09-08:
    // Reason: 源仓状态读取仍绑定 Legacy tick 41，Dense 矩阵无法共享该物理 tick 坐标。
    // Trigger: Host 行为矩阵复核发现遗漏。
    // Evidence: twoSecondTick 已表示两个引擎共同的 2000ms 门禁相位。
    // Replacement: getDevice(report, twoSecondTick.tickNumber, "source-storage")。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // expect(getDevice(report, 41, "source-storage").slotItems).toHaveLength(6);
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
    // AI-CORRECTION 2026-05-30: recipeId 已迁移到 channelRecipes["default"]。
    expect(belt.channelRecipes["default"]?.recipeId).toBe("belt_straight_1x1:dynamic-belt-transfer");
  });
});
