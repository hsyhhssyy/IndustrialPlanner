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
// Trigger: pipe-transport 接入 Host 行为矩阵。
// Evidence: getFirstTickAtSimulationMilliseconds 可按报告 standardTickRate 定位相同业务相位。
// Replacement: getFirstTickAtSimulationMilliseconds。
// Risk: Low
// Human Review: Required
//
// Original code:
// import { getTick } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

function createLiquidPipeTransportBlueprint(initialCount = 2): BlueprintDocument {
  return createBlueprint("pipe-transport", [
    createEntity("source-liquid-storage", "liquid_storager_1", 0, 0, 180, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
      "storageSlotGroups[0].slots[0].initialCount": initialCount,
    }),
    createEntity("pipe", "pipe_straight_1x1", 3, 1),
    createEntity("sink-liquid-storage", "liquid_storager_1", 4, 0, 180),
  ]);
}

// AI-REMOVED 2026-09-08:
// Reason: 管道运输属于所有生产求解器应满足的 Host 行为。
// Trigger: 用户确认门禁类测试改为 Host 行为矩阵。
// Evidence: 用例只通过 runBlueprintSimulation 公共入口观察传输和设备状态。
// Replacement: 下方 SIMULATION_ENGINE_MATRIX 参数化 describe。
// Risk: Dense 可能暴露运输时序或投影差异。
// Human Review: Required
//
// Original code:
// describe("REQ-076: pipe transport", () => {
describe.each(SIMULATION_ENGINE_MATRIX)("REQ-076: pipe transport [%s]", (engineKind) => {
  // AI-CORRECTION 2026-07-30: 回滚 — 恢复 0.5s 门禁（10 tick）+ 单件配方。
  // 时序：tick 1 入管 1 件 → tick 11 出管 1 件 + 入管第 2 件 → tick 21 出管第 2 件。
  it("covers pipe transport components and pipe dynamic recipes through a liquid blueprint", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createLiquidPipeTransportBlueprint(),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 1.5,
      // AI-REMOVED 2026-09-08:
      // Reason: 观察窗口按业务时间表达，不绑定 Legacy tick 25。
      // Trigger: pipe-transport 接入求解器矩阵。
      // Evidence: 1500ms 足以覆盖 1000ms 相位下的第一 tick。
      // Replacement: maxDurationSeconds: 1.5。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // maxTickNumber: 25,
    });
    const zeroMillisecondTick = getFirstTickAtSimulationMilliseconds(report, 0);
    const halfSecondTick = getFirstTickAtSimulationMilliseconds(report, 500);
    const oneSecondTick = getFirstTickAtSimulationMilliseconds(report, 1_000);
    const pipe = getDevice(report, zeroMillisecondTick.tickNumber, "pipe");
    // AI-REMOVED 2026-09-08:
    // Reason: tick 1/11/21 是 Legacy 坐标，业务含义分别是 0ms/500ms/1000ms 相位第一 tick。
    // Trigger: 用户要求门禁测试使用整数毫秒基准。
    // Evidence: helper 由各引擎 standardTickRate 精确换算。
    // Replacement: zeroMillisecondTick、halfSecondTick 与 oneSecondTick。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // const tickOne = getTick(report, 1);
    // const tickTwo = getTick(report, 2);
    // const tickEleven = getTick(report, 11);
    // const tickTwentyOne = getTick(report, 21);
    // const pipe = getDevice(report, 1, "pipe");

    // tick 1: 第 1 件进入管道
    expect(zeroMillisecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source-liquid-storage")
      && transfer.targetSlotId.includes("device:pipe"),
    )).toHaveLength(1);
    // AI-REMOVED 2026-09-08:
    // Reason: “tick 2 无搬运”只存在于 Legacy 的 50ms 中间帧；Dense 在 0ms 与 500ms 间没有可观察帧。
    // Trigger: pipe-transport 改为跨引擎 Host 行为矩阵。
    // Evidence: 两引擎共同契约是只在 500ms 相位搬运，由 0ms/500ms/1000ms 事件断言覆盖。
    // Replacement: halfSecondTick 与 oneSecondTick 的相位断言。
    // Risk: Legacy 的中间帧门禁仍由 pipe-phase-gating 内部回归测试覆盖。
    // Human Review: Required
    //
    // Original code:
    // const tickTwo = getTick(report, 2);
    // expect(tickTwo.transfers.some((transfer) =>
    //   transfer.sourceSlotId.includes("device:pipe")
    //   || transfer.targetSlotId.includes("device:pipe"),
    // )).toBe(false);
    // tick 11: 第 1 件出管到 sink + 第 2 件入管
    expect(halfSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:pipe")
      && transfer.targetSlotId.includes("device:sink-liquid-storage"),
    )).toHaveLength(1);
    expect(halfSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source-liquid-storage")
      && transfer.targetSlotId.includes("device:pipe"),
    )).toHaveLength(1);
    // tick 21: 第 2 件出管到 sink
    expect(oneSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:pipe")
      && transfer.targetSlotId.includes("device:sink-liquid-storage"),
    )).toHaveLength(1);
    expect(pipe.slotItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        storageGroupId: "synthetic-input",
        slotId: "slot_1",
        viewRole: "single-view",
        count: 1,
        reserved: 1,
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
    // AI-CORRECTION 2026-07-30: 回滚 — 单配方无 -2 后缀。
    expect(pipe.channelRecipes["default"]?.recipeId).toBe("pipe_straight_1x1:dynamic-pipe-transfer");
  });

  // AI-CORRECTION 2026-07-30: 回滚 — 单配方下 1 件与 2 件行为一致，只验证 1 件场景。
  it("transports a single fluid item through the pipe in 0.5s ticks", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createLiquidPipeTransportBlueprint(1),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 1,
      // AI-REMOVED 2026-09-08:
      // Reason: 观察窗口按业务时间表达，不绑定 Legacy tick 21。
      // Trigger: pipe-transport 接入求解器矩阵。
      // Evidence: 1000ms 足以覆盖 500ms 相位下的第一 tick。
      // Replacement: maxDurationSeconds: 1。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // maxTickNumber: 21,
    });

    // tick 1: 入管
    const zeroMillisecondTick = getFirstTickAtSimulationMilliseconds(report, 0);
    const halfSecondTick = getFirstTickAtSimulationMilliseconds(report, 500);
    expect(zeroMillisecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source-liquid-storage")
      && transfer.targetSlotId.includes("device:pipe"),
    )).toHaveLength(1);
    // tick 11: 出管到 sink
    expect(halfSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:pipe")
      && transfer.targetSlotId.includes("device:sink-liquid-storage"),
    )).toHaveLength(1);
    expect(getDevice(report, zeroMillisecondTick.tickNumber, "pipe").channelRecipes["default"]?.recipeId)
      .toBe("pipe_straight_1x1:dynamic-pipe-transfer");
  });
});

// AI-REMOVED 2026-07-23:
// Reason: 旧测试按 0.5 秒单件管道在 tick 11 交付，无法覆盖新的整数秒门禁和 2/1 双配方。
// Trigger: 用户确认管道每秒结算一次、最高 2/s 且单件可送。
// Evidence: 新断言验证 tick 1 双件入管、tick 2 无搬运、tick 21 双件出管及单件兜底。
// Replacement: 上述两个 REQ-076 测试。
// Risk: Low
// Human Review: Required
// AI-CORRECTION 2026-07-30: 回滚 — 上述 AI-REMOVED 块的判断被证明方向错误，恢复 0.5 秒单件测试。
//
// Original code (was restored above):
