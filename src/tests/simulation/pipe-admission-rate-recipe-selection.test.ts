import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  getFirstTickAtSimulationMilliseconds,
  getDevice,
} from "./blueprint-test-helpers";
// AI-REMOVED 2026-09-08:
// Reason: 准入门禁改由整数毫秒定位，不再直接按引擎 tick 编号读取。
// Trigger: pipe-admission-rate-recipe-selection 接入 Host 行为矩阵。
// Evidence: getFirstTickAtSimulationMilliseconds 可按 standardTickRate 定位相同业务相位。
// Replacement: getFirstTickAtSimulationMilliseconds。
// Risk: Low
// Human Review: Required
//
// Original code:
// import { getTick } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

// AI-REMOVED 2026-09-08:
// Reason: 管道准入计数与配方选择是所有生产求解器共同的 Host 行为。
// Trigger: 用户确认下一类测试接入 Host 行为矩阵。
// Evidence: 用例只通过 runBlueprintSimulation 公共入口观察传输、计数器和配方。
// Replacement: 下方 SIMULATION_ENGINE_MATRIX 参数化 describe。
// Risk: Dense 可能暴露准入窗口或配方推进差异。
// Human Review: Required
//
// Original code:
// describe("pipe admission rate-aware recipe selection", () => {
describe.each(SIMULATION_ENGINE_MATRIX)(
  "pipe admission rate-aware recipe selection [%s]",
  (engineKind) => {
  // AI-CORRECTION 2026-07-30: 回滚 — 恢复 0.5s(10tick) 单件配方 + 容量 1。
  // 准入计数在物品离开准入口时递增，而非进入时。
  // 时序：tick 1 入 → tick 11 出（第一个配方完成）→ tick 21 出（第二个）...
  it("counts only released items and does not prefetch beyond a one-item window allowance", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("pipe-admission-one-item-window", [
        createEntity("source", "liquid_storager_1", 0, 0, 180, {
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
          "storageSlotGroups[0].slots[0].initialCount": 4,
        }),
        createEntity("admission", "pipe_admission", 3, 1, 0, {
          "portGroups[0].ports[0].acceptRule": {
            base: { kind: "item", itemId: "item_liquid_water" },
            exclude: [],
          },
          "portGroups[0].ports[0].admissionRule": {
            itemId: "item_liquid_water",
            limit: null,
            perMinuteLimit: 6,
          },
        }),
        createEntity("sink", "liquid_storager_1", 4, 0, 180),
      ]),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 1.5,
      // AI-REMOVED 2026-09-08:
      // Reason: 观察窗口按业务时间表达，不绑定 Legacy tick 21。
      // Trigger: 准入测试接入求解器矩阵。
      // Evidence: 1500ms 足以覆盖 1000ms 相位下的第一 tick。
      // Replacement: maxDurationSeconds: 1.5。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // maxTickNumber: 21,
    });
    const zeroMillisecondTick = getFirstTickAtSimulationMilliseconds(report, 0);
    const halfSecondTick = getFirstTickAtSimulationMilliseconds(report, 500);
    const oneSecondTick = getFirstTickAtSimulationMilliseconds(report, 1_000);

    // tick 1: 1 件入准入（容量 1）
    // AI-CORRECTION 2026-09-08: tick 1/11/21 分别按 0/500/1000ms 第一 tick 定位。
    expect(zeroMillisecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(1);
    expect(getDevice(report, zeroMillisecondTick.tickNumber, "admission").admissionCounters?.["fluid_input:in_w"])
      .toMatchObject({
        count: 0,
        perMinuteLimit: 6,
        rateWindowCount: 0,
      });
    // AI-CORRECTION 2026-07-30: 回滚 — 单配方无 -2 后缀。
    expect(getDevice(report, zeroMillisecondTick.tickNumber, "admission").channelRecipes.default?.recipeId)
      .toBe("pipe_admission:dynamic-pipe-transfer");
    // tick 11: 1 件出准入口（配方 0.5s 完成），准入计数递增，速率额度耗尽
    expect(halfSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:admission")
      && transfer.targetSlotId.includes("device:sink"),
    )).toHaveLength(1);
    expect(halfSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(0);
    // tick 21: 无出无入（速率额度已用尽）
    expect(oneSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:admission")
      && transfer.targetSlotId.includes("device:sink"),
    )).toHaveLength(0);
    expect(oneSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(0);
    expect(getDevice(report, oneSecondTick.tickNumber, "admission").admissionCounters?.["fluid_input:in_w"])
      .toMatchObject({
        count: 1,
        perMinuteLimit: 6,
        rateWindowCount: 1,
      });
    expect(getDevice(report, oneSecondTick.tickNumber, "admission").slotItems.reduce(
      (total, slot) => total + slot.count,
      0,
    )).toBe(0);
  });

  // AI-CORRECTION 2026-07-30: 回滚 — 单配方下速率窗口按每 0.5s 搬运 1 件累进。
  // 每 10 tick（0.5s）出 1 件，同时入 1 件。18/min → 每窗口 3 件额度。
  it("transfers exactly one item per 0.5s tick within the rate allowance", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("pipe-admission-rate-recipe-selection", [
        createEntity("source", "liquid_storager_1", 0, 0, 180, {
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
          "storageSlotGroups[0].slots[0].initialCount": 4,
        }),
        createEntity("admission", "pipe_admission", 3, 1, 0, {
          "portGroups[0].ports[0].acceptRule": {
            base: { kind: "item", itemId: "item_liquid_water" },
            exclude: [],
          },
          "portGroups[0].ports[0].admissionRule": {
            itemId: "item_liquid_water",
            limit: null,
            perMinuteLimit: 18,
          },
        }),
        createEntity("sink", "liquid_storager_1", 4, 0, 180),
      ]),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 2.5,
      // AI-REMOVED 2026-09-08:
      // Reason: 观察窗口按业务时间表达，不绑定 Legacy tick 41。
      // Trigger: 准入测试接入求解器矩阵。
      // Evidence: 2500ms 足以覆盖 2000ms 相位下的第一 tick。
      // Replacement: maxDurationSeconds: 2.5。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // maxTickNumber: 41,
    });
    const zeroMillisecondTick = getFirstTickAtSimulationMilliseconds(report, 0);
    const halfSecondTick = getFirstTickAtSimulationMilliseconds(report, 500);
    const oneSecondTick = getFirstTickAtSimulationMilliseconds(report, 1_000);
    const oneAndHalfSecondTick = getFirstTickAtSimulationMilliseconds(report, 1_500);
    const twoSecondTick = getFirstTickAtSimulationMilliseconds(report, 2_000);

    // AI-CORRECTION 2026-08-01: 容量从 2 降为 1，tick 1 只能预缓冲 1 件（旧断言 toHaveLength(2)）。
    // AI-CORRECTION 2026-09-08: tick 1/11/21/31/41 分别按 0/500/1000/1500/2000ms 第一 tick 定位。
    expect(zeroMillisecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(1);
    expect(getDevice(report, zeroMillisecondTick.tickNumber, "admission").admissionCounters?.["fluid_input:in_w"])
      .toMatchObject({
        count: 0,
        perMinuteLimit: 18,
        rateWindowCount: 0,
      });
    expect(getDevice(report, zeroMillisecondTick.tickNumber, "admission").channelRecipes.default?.recipeId)
      .toBe("pipe_admission:dynamic-pipe-transfer");
    // tick 11: 第 1 件出准入 + 补入 1 件（buffer 恢复满）
    expect(halfSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:admission")
      && transfer.targetSlotId.includes("device:sink"),
    )).toHaveLength(1);
    expect(halfSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(1);
    expect(getDevice(report, halfSecondTick.tickNumber, "admission").admissionCounters?.["fluid_input:in_w"])
      .toMatchObject({
        count: 1,
        perMinuteLimit: 18,
        rateWindowCount: 1,
      });
    // AI-CORRECTION 2026-08-01: 容量 1 下 tick 21 出 1 后 bufferedCount=0 < rateRemaining=1，仍可入 1 件（旧断言 toHaveLength(0)）。
    expect(oneSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:admission")
      && transfer.targetSlotId.includes("device:sink"),
    )).toHaveLength(1);
    expect(oneSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(1);
    expect(getDevice(report, oneSecondTick.tickNumber, "admission").admissionCounters?.["fluid_input:in_w"])
      .toMatchObject({
        count: 2,
        perMinuteLimit: 18,
        rateWindowCount: 2,
      });
    // tick 31: 第 3 件出准入，速率额度用尽，不再入
    expect(oneAndHalfSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:admission")
      && transfer.targetSlotId.includes("device:sink"),
    )).toHaveLength(1);
    expect(oneAndHalfSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(0);
    // tick 41: 无剩余物品
    expect(twoSecondTick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:admission")
      && transfer.targetSlotId.includes("device:sink"),
    )).toHaveLength(0);
    expect(getDevice(report, twoSecondTick.tickNumber, "admission").admissionCounters?.["fluid_input:in_w"])
      .toMatchObject({
        count: 3,
        perMinuteLimit: 18,
        rateWindowCount: 3,
      });
  });
});
