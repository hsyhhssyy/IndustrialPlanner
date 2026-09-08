import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  getFirstTickAtSimulationMilliseconds,
  getTick,
} from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

// AI-REMOVED 2026-09-08:
// Reason: 准入口门禁和计数窗口属于两种求解器应共同满足的业务契约。
// Trigger: 用户确认以整数毫秒表达门禁相位，并要求对应测试接入矩阵。
// Evidence: runBlueprintSimulation 已支持显式选择生产引擎，门禁 tick 可由报告 standardTickRate 精确换算。
// Replacement: 下方 SIMULATION_ENGINE_MATRIX 参数化 describe。
// Risk: Dense 当前可能暴露准入口时序或计数差异。
// Human Review: Required
//
// Original code:
// describe("admission rule runtime counter", () => {
describe.each(SIMULATION_ENGINE_MATRIX)("admission rule runtime counter [%s]", (engineKind) => {
  it("limits admission by a persistent cross-tick counter", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createAdmissionBlueprint({
        sourceItemId: "item_iron_ore",
        admissionItemId: "item_iron_ore",
        limit: 2,
      }),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 5,
      // AI-REMOVED 2026-09-08:
      // Reason: 运行窗口改按业务时间表达，避免绑定 Legacy 的 20 TPS。
      // Trigger: admission-rule 接入求解器矩阵。
      // Evidence: 100 Legacy tick 等于 5 秒。
      // Replacement: maxDurationSeconds: 5。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // maxTickNumber: 100,
    });

    const sourceToAdmissionTransfers = report.ticks.flatMap((tick) =>
      tick.transfers
        .filter((transfer) =>
          transfer.sourceSlotId.includes("device:source")
          && transfer.targetSlotId.includes("device:admission"),
        )
        .map((transfer) => ({ tickNumber: tick.tickNumber, transfer })),
    );
    const expectedSourceToAdmissionTicks = [0, 2_000].map(
      (milliseconds) => getFirstTickAtSimulationMilliseconds(report, milliseconds).tickNumber,
    );
    expect(sourceToAdmissionTransfers.map((entry) => entry.tickNumber))
      .toEqual(expectedSourceToAdmissionTicks);
    // AI-REMOVED 2026-09-08:
    // Reason: 期望值应表达为 0ms、2000ms 相位下的第一 tick，而非 Legacy tick 编号。
    // Trigger: 用户要求门禁测试统一使用整数毫秒时间基准。
    // Evidence: Legacy 下换算结果仍为 tick 1、41；Dense 会按自身 standardTickRate 换算。
    // Replacement: expectedSourceToAdmissionTicks。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // expect(sourceToAdmissionTransfers.map((entry) => entry.tickNumber)).toEqual([1, 41]);
    const admissionOutputTicks = report.ticks.flatMap((tick) =>
      tick.transfers
        .filter((transfer) =>
          transfer.sourceSlotId.includes("device:admission")
          && transfer.targetSlotId.includes("device:belt"),
        )
        .map(() => tick.tickNumber),
    );
    const expectedAdmissionOutputTicks = [2_000, 4_000].map(
      (milliseconds) => getFirstTickAtSimulationMilliseconds(report, milliseconds).tickNumber,
    );
    expect(admissionOutputTicks).toEqual(expectedAdmissionOutputTicks);
    // AI-REMOVED 2026-09-08:
    // Reason: 期望值应表达为 2000ms、4000ms 相位下的第一 tick，而非 Legacy tick 编号。
    // Trigger: 用户要求门禁测试统一使用整数毫秒时间基准。
    // Evidence: Legacy 下换算结果仍为 tick 41、81。
    // Replacement: expectedAdmissionOutputTicks。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // expect(admissionOutputTicks).toEqual([41, 81]);
    const admissionCounter = report.ticks.at(-1)?.devices.admission?.admissionCounters?.["item_input:in_w"];
    expect(admissionCounter).toBeDefined();
    expect(admissionCounter)
      .toMatchObject({
        itemType: "item_iron_ore",
        limit: 2,
        count: 2,
        perMinuteLimit: null,
        rateWindowCount: 2,
        oneMinuteCount: 2,
      });
  });

  it("resets rate admission count at aligned ten-second boundaries", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createAdmissionBlueprint({
        sourceItemId: "item_iron_ore",
        admissionItemId: "item_iron_ore",
        limit: null,
        perMinuteLimit: 12,
      }),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 13,
      // AI-REMOVED 2026-09-08:
      // Reason: 运行窗口改按业务时间表达，避免绑定 Legacy 的 20 TPS。
      // Trigger: admission-rule 接入求解器矩阵。
      // Evidence: 260 Legacy tick 等于 13 秒。
      // Replacement: maxDurationSeconds: 13。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // maxTickNumber: 260,
    });

    const admissionToBeltTransfers = report.ticks.flatMap((tick) =>
      tick.transfers
        .filter((transfer) =>
          transfer.sourceSlotId.includes("device:admission")
          && transfer.targetSlotId.includes("device:belt"),
        )
        .map((transfer) => ({ tickNumber: tick.tickNumber, transfer })),
    );

    const expectedAdmissionToBeltTicks = [2_000, 4_000, 12_000].map(
      (milliseconds) => getFirstTickAtSimulationMilliseconds(report, milliseconds).tickNumber,
    );
    expect(admissionToBeltTransfers.map((entry) => entry.tickNumber))
      .toEqual(expectedAdmissionToBeltTicks);
    const tenSecondFirstTick = getFirstTickAtSimulationMilliseconds(report, 10_000);
    expect(getTick(report, tenSecondFirstTick.tickNumber - 1)
      .devices.admission?.admissionCounters?.["item_input:in_w"])
      .toMatchObject({
        limit: null,
        count: 2,
        perMinuteLimit: 12,
        rateWindowCount: 2,
      });
    expect(tenSecondFirstTick.devices.admission?.admissionCounters?.["item_input:in_w"])
      .toMatchObject({
        limit: null,
        count: 2,
        perMinuteLimit: 12,
        rateWindowCount: 0,
      });
    expect(tenSecondFirstTick.devices.admission?.channelRecipes.default?.recipeId)
      .toBe("log_admission:dynamic-belt-transfer");
    // AI-REMOVED 2026-09-08:
    // Reason: 门禁和窗口边界改用整数毫秒相位定位，不再依赖 Legacy 数组索引与 tick 编号。
    // Trigger: 用户要求统一使用 1s/0.5s 的语义时间，底层以毫秒表达。
    // Evidence: 10 秒相位的第一 tick 在 Legacy 为 201，在 Dense 由 standardTickRate 推导。
    // Replacement: expectedAdmissionToBeltTicks 与 tenSecondFirstTick。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // expect(admissionToBeltTransfers.map((entry) => entry.tickNumber)).toEqual([41, 81, 241]);
    // expect(report.ticks[200]?.devices.admission?.admissionCounters?.["item_input:in_w"])
    // expect(report.ticks[201]?.devices.admission?.admissionCounters?.["item_input:in_w"])
    // expect(report.ticks[201]?.devices.admission?.channelRecipes.default?.recipeId)
  });

  it("applies total and ten-second rate limits independently", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createAdmissionBlueprint({
        sourceItemId: "item_iron_ore",
        admissionItemId: "item_iron_ore",
        limit: 3,
        perMinuteLimit: 12,
      }),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 13,
      // AI-REMOVED 2026-09-08:
      // Reason: 运行窗口改按业务时间表达，避免绑定 Legacy 的 20 TPS。
      // Trigger: admission-rule 接入求解器矩阵。
      // Evidence: 260 Legacy tick 等于 13 秒。
      // Replacement: maxDurationSeconds: 13。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // maxTickNumber: 260,
    });

    const admissionToBeltTransfers = report.ticks.flatMap((tick) =>
      tick.transfers
        .filter((transfer) =>
          transfer.sourceSlotId.includes("device:admission")
          && transfer.targetSlotId.includes("device:belt"),
        )
        .map((transfer) => ({ tickNumber: tick.tickNumber, transfer })),
    );

    const expectedAdmissionToBeltTicks = [2_000, 4_000, 12_000].map(
      (milliseconds) => getFirstTickAtSimulationMilliseconds(report, milliseconds).tickNumber,
    );
    expect(admissionToBeltTransfers.map((entry) => entry.tickNumber))
      .toEqual(expectedAdmissionToBeltTicks);
    // AI-REMOVED 2026-09-08:
    // Reason: 期望值改为 2000ms、4000ms、12000ms 相位下的第一 tick。
    // Trigger: 用户要求门禁测试统一使用整数毫秒时间基准。
    // Evidence: Legacy 下换算结果仍为 tick 41、81、241。
    // Replacement: expectedAdmissionToBeltTicks。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // expect(admissionToBeltTransfers.map((entry) => entry.tickNumber)).toEqual([41, 81, 241]);
    expect(report.ticks.at(-1)?.devices.admission?.admissionCounters?.["item_input:in_w"])
      .toMatchObject({
        limit: 3,
        count: 3,
        perMinuteLimit: 12,
        rateWindowCount: 1,
      });
  });

  it("oneMinuteCount spans exactly 6 ten-second windows, not 7", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createAdmissionBlueprint({
        sourceItemId: "item_iron_ore",
        admissionItemId: "item_iron_ore",
        limit: null,
        perMinuteLimit: 6,
      }),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 120,
      // AI-REMOVED 2026-09-08:
      // Reason: 一分钟滑窗测试应按两分钟业务时长运行，不绑定 Legacy tick 数。
      // Trigger: admission-rule 接入求解器矩阵。
      // Evidence: 2400 Legacy tick 等于 120 秒。
      // Replacement: maxDurationSeconds: 120。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // maxTickNumber: 2400,
    });

    const admissionCounter = report.ticks.at(-1)?.devices.admission?.admissionCounters?.["item_input:in_w"];
    expect(admissionCounter).toBeDefined();
    // 6/min = 每窗 1 个，过去一分钟 = 6 窗，预期 = 6。
    // Bug: pastWindowCounts 最多存 6 个已完成窗口 + 当前窗口 = 7 窗 → 7 件。
    expect(admissionCounter!.oneMinuteCount).toBe(6);
  });

  it("does not admit a different item", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createAdmissionBlueprint({
        sourceItemId: "item_copper_ore",
        admissionItemId: "item_iron_ore",
        limit: 5,
      }),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 4,
      // AI-REMOVED 2026-09-08:
      // Reason: 非匹配物品测试的观察窗口改按业务时间表达，不绑定 Legacy tick 数。
      // Trigger: admission-rule 接入求解器矩阵。
      // Evidence: 80 Legacy tick 等于 4 秒。
      // Replacement: maxDurationSeconds: 4。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // maxTickNumber: 80,
    });

    expect(report.ticks.some((tick) =>
      tick.transfers.some((transfer) =>
        transfer.sourceSlotId.includes("device:source")
        && transfer.targetSlotId.includes("device:admission"),
      ),
    )).toBe(false);
    const admissionCounter = report.ticks.at(-1)?.devices.admission?.admissionCounters?.["item_input:in_w"];
    expect(admissionCounter).toBeDefined();
    expect(admissionCounter)
      .toMatchObject({
        itemType: "item_iron_ore",
        limit: 5,
        count: 0,
        perMinuteLimit: null,
        rateWindowCount: 0,
      });
  });
});

function createAdmissionBlueprint(options: {
  readonly sourceItemId: string;
  readonly admissionItemId: string;
  readonly limit: number | null;
  readonly perMinuteLimit?: number | null;
}) {
  return createBlueprint("admission-rule", [
    createEntity("source", "storager_1", 0, 0, 90, {
      "storageSlotGroups[0].slots[0].initialItemType": options.sourceItemId,
      "storageSlotGroups[0].slots[0].initialCount": 5,
      "storageSlotGroups[0].slots[0].ignoreStock": true,
    }),
    createEntity("admission", "log_admission", 3, 1, 0, {
      "portGroups[0].ports[0].acceptRule": {
        base: { kind: "item", itemId: options.admissionItemId },
        exclude: [],
      },
      "portGroups[0].ports[0].admissionRule": {
        itemId: options.admissionItemId,
        limit: options.limit,
        perMinuteLimit: options.perMinuteLimit ?? null,
      },
    }),
    createEntity("belt", "belt_straight_1x1", 4, 1, 0),
    createEntity("sink", "loader_1", 5, 0, 270),
  ]);
}
