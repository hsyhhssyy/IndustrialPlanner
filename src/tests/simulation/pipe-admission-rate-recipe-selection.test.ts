import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  getDevice,
  getTick,
} from "./blueprint-test-helpers";

describe("pipe admission rate-aware recipe selection", () => {
  // AI-CORRECTION 2026-07-30: 回滚 — 恢复 0.5s(10tick) 单件配方 + 容量 1。
  // 准入计数在物品离开准入口时递增，而非进入时。
  // 时序：tick 1 入 → tick 11 出（第一个配方完成）→ tick 21 出（第二个）...
  it("counts only released items and does not prefetch beyond a one-item window allowance", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("pipe-admission-one-item-window", [
        createEntity("source", "liquid_storager_1", 0, 0, 0, {
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
        createEntity("sink", "liquid_storager_1", 4, 0),
      ]),
      registry: createRegistryContract(),
      maxTickNumber: 21,
    });

    // tick 1: 1 件入准入（容量 1）
    expect(getTick(report, 1).transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(1);
    expect(getDevice(report, 1, "admission").admissionCounters?.["fluid_input:in_w"])
      .toMatchObject({
        count: 0,
        perMinuteLimit: 6,
        rateWindowCount: 0,
      });
    // AI-CORRECTION 2026-07-30: 回滚 — 单配方无 -2 后缀。
    expect(getDevice(report, 1, "admission").channelRecipes.default?.recipeId)
      .toBe("pipe_admission:dynamic-pipe-transfer");
    // tick 11: 1 件出准入口（配方 0.5s 完成），准入计数递增，速率额度耗尽
    expect(getTick(report, 11).transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:admission")
      && transfer.targetSlotId.includes("device:sink"),
    )).toHaveLength(1);
    expect(getTick(report, 11).transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(0);
    // tick 21: 无出无入（速率额度已用尽）
    expect(getTick(report, 21).transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:admission")
      && transfer.targetSlotId.includes("device:sink"),
    )).toHaveLength(0);
    expect(getTick(report, 21).transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(0);
    expect(getDevice(report, 21, "admission").admissionCounters?.["fluid_input:in_w"])
      .toMatchObject({
        count: 1,
        perMinuteLimit: 6,
        rateWindowCount: 1,
      });
    expect(getDevice(report, 21, "admission").slotItems.reduce(
      (total, slot) => total + slot.count,
      0,
    )).toBe(0);
  });

  // AI-CORRECTION 2026-07-30: 回滚 — 单配方下速率窗口按每 0.5s 搬运 1 件累进。
  // 每 10 tick（0.5s）出 1 件，同时入 1 件。18/min → 每窗口 3 件额度。
  it("transfers exactly one item per 0.5s tick within the rate allowance", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("pipe-admission-rate-recipe-selection", [
        createEntity("source", "liquid_storager_1", 0, 0, 0, {
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
        createEntity("sink", "liquid_storager_1", 4, 0),
      ]),
      registry: createRegistryContract(),
      maxTickNumber: 41,
    });

    // AI-CORRECTION 2026-08-01: 容量从 2 降为 1，tick 1 只能预缓冲 1 件（旧断言 toHaveLength(2)）。
    expect(getTick(report, 1).transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(1);
    expect(getDevice(report, 1, "admission").admissionCounters?.["fluid_input:in_w"])
      .toMatchObject({
        count: 0,
        perMinuteLimit: 18,
        rateWindowCount: 0,
      });
    expect(getDevice(report, 1, "admission").channelRecipes.default?.recipeId)
      .toBe("pipe_admission:dynamic-pipe-transfer");
    // tick 11: 第 1 件出准入 + 补入 1 件（buffer 恢复满）
    expect(getTick(report, 11).transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:admission")
      && transfer.targetSlotId.includes("device:sink"),
    )).toHaveLength(1);
    expect(getTick(report, 11).transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(1);
    expect(getDevice(report, 11, "admission").admissionCounters?.["fluid_input:in_w"])
      .toMatchObject({
        count: 1,
        perMinuteLimit: 18,
        rateWindowCount: 1,
      });
    // AI-CORRECTION 2026-08-01: 容量 1 下 tick 21 出 1 后 bufferedCount=0 < rateRemaining=1，仍可入 1 件（旧断言 toHaveLength(0)）。
    expect(getTick(report, 21).transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:admission")
      && transfer.targetSlotId.includes("device:sink"),
    )).toHaveLength(1);
    expect(getTick(report, 21).transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(1);
    expect(getDevice(report, 21, "admission").admissionCounters?.["fluid_input:in_w"])
      .toMatchObject({
        count: 2,
        perMinuteLimit: 18,
        rateWindowCount: 2,
      });
    // tick 31: 第 3 件出准入，速率额度用尽，不再入
    expect(getTick(report, 31).transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:admission")
      && transfer.targetSlotId.includes("device:sink"),
    )).toHaveLength(1);
    expect(getTick(report, 31).transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(0);
    // tick 41: 无剩余物品
    expect(getTick(report, 41).transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:admission")
      && transfer.targetSlotId.includes("device:sink"),
    )).toHaveLength(0);
    expect(getDevice(report, 41, "admission").admissionCounters?.["fluid_input:in_w"])
      .toMatchObject({
        count: 3,
        perMinuteLimit: 18,
        rateWindowCount: 3,
      });
  });
});
