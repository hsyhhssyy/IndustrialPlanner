import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
// AI-REMOVED 2026-09-08:
// Reason: 70 秒吞吐窗口改为累计仿真秒数，不再绑定 Legacy 20 TPS。
// Trigger: protocol storage throughput 纳入全引擎矩阵。
// Evidence: 准入口计数器的契约直接以每分钟表达。
// Replacement: maxDurationSeconds 与 getLastTick。
// Risk: Low
// Human Review: Required
//
// Original code:
// import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  getDevice,
  getLastTick,
  resolveSimulationMillisecondsAtFirstTick,
} from "./blueprint-test-helpers";
// AI-REMOVED 2026-09-08:
// Reason: Dense 当前没有在协议储存箱首槽留下该用例要求观察到的库存状态，属于待后续修复的行为差异。
// Trigger: 用户要求先只修复累计秒数精度，其余问题稍后修复。
// Evidence: Vitest normal 中 Dense 的 firstSlotObservedByDevice 为空，而 Legacy 满足断言。
// Replacement: None；Dense 行为修复后重新接入公共矩阵。
// Risk: 当前仅由 Legacy 覆盖协议储存箱持续吞吐场景。
// Human Review: Required
//
// Original code:
// import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";
// AI-CORRECTION 2026-09-08: 用户明确要求应矩阵化的用例即使失败也必须保留在矩阵中，现重新启用该导入。
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

const ITEM_ID = "item_xiranite_powder";
const ADMISSION_COUNTER_ID = "item_input:in_w";
const FINAL_DURATION_SECONDS = 70;
// AI-REMOVED 2026-09-08:
// Reason: FINAL_TICK 绑定 Legacy tick 编号。
// Trigger: protocol storage throughput 纳入全引擎矩阵。
// Evidence: 测试目标是 70 秒后的完整一分钟吞吐率。
// Replacement: FINAL_DURATION_SECONDS。
// Risk: Low
// Human Review: Required
//
// Original code:
// const FINAL_TICK = 70 * STANDARD_TICK_RATE_PER_SECOND;
const FULL_BELT_RATE_PER_MINUTE = 30;
const BALANCED_STORAGE_DEVICE_IDS = ["storage"] as const;

// AI-REMOVED 2026-09-08:
// Reason: 本用例暂时退出 Dense 矩阵，保留按秒窗口与原业务断言。
// Trigger: 用户决定累计秒数精度先行，Dense 首槽状态差异后续单独修复。
// Evidence: Legacy 通过而 Dense 未观察到 storage_slot_1 库存。
// Replacement: 下方 Legacy 默认引擎 describe。
// Risk: Dense 协议储存箱槽位行为的缺陷仍存在。
// Human Review: Required
//
// Original code:
// describe.each(SIMULATION_ENGINE_MATRIX)("协议储存箱持续吞吐 [%s]", (engineKind) => {
// AI-REMOVED 2026-09-08:
// Reason: 不再因 Dense 已知失败而将应覆盖双引擎的协议储存箱测试限制为 Legacy。
// Trigger: 用户明确要求应矩阵化的测试即使当前失败也加入矩阵。
// Evidence: 本测试验证协议储存箱持续吞吐与槽位使用这一引擎无关业务结果。
// Replacement: 下方 SIMULATION_ENGINE_MATRIX 参数化 describe。
// Risk: Dense 用例当前预期会暴露首槽未观察到库存的失败。
// Human Review: Required
//
// Original code:
// describe("协议储存箱持续吞吐", () => {
// AI-CORRECTION 2026-09-08: 上述临时退出矩阵的决定已撤销，当前恢复双引擎执行。
// AI-CORRECTION 2026-09-09: 同门禁 tick 瞬时穿透是游戏行为；Legacy 会把同 tick 新入库存错误滞留到下一门禁，故本契约仅运行 Dense。
describe.each(SIMULATION_ENGINE_MATRIX)("协议储存箱持续吞吐 [%s]", (engineKind) => {
  it.runIf(engineKind === "dense-v2")(
    "三路传送带应在同一 1000ms 门禁 tick 穿透第一槽并保持每路 30/min",
    async () => {
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
        maxDurationSeconds: FINAL_DURATION_SECONDS,
        // AI-REMOVED 2026-09-08:
        // Reason: 本用例暂时使用 Blueprint runner 的 Legacy 默认引擎。
        // Trigger: Dense 协议储存箱槽位行为留待后续修复。
        // Evidence: Dense 的 firstSlotObservedByDevice 为空。
        // Replacement: runBlueprintSimulation 默认 engineKind。
        // Risk: Dense 暂不执行此断言。
        // Human Review: Required
        //
        // Original code:
        // engineKind,
        // AI-CORRECTION 2026-09-08: Dense 已知失败不再作为排除矩阵的理由，恢复显式传入矩阵引擎。
        engineKind,
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
      // AI-REMOVED 2026-09-09:
      // Reason: 提交快照必须观察到第一槽库存的断言把 Legacy 的一门禁周期滞留误当成游戏行为。
      // Trigger: 用户确认协议储存箱在输入输出同门禁 tick 时应瞬时穿透，不应持有到下一帧。
      // Evidence: Dense 同 tick 入出 transfer 完整且吞吐为 30/min，提交快照库存为零；Legacy 才会观察到第一槽滞留。
      // Replacement: expectBalancedStorageInstantPassThrough。
      // Risk: Low；第一槽使用改由 transfer 路径验证，不再依赖 tick 末库存。
      // Human Review: Required
      //
      // Original code:
      // expectOnlyFirstStorageSlotUsedAtEveryTick(report);
      expectBalancedStorageInstantPassThrough(report);
    },
  );
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
    getDevice(report, getLastTick(report).tickNumber, deviceId)
      .admissionCounters?.[ADMISSION_COUNTER_ID]?.oneMinuteCount ?? 0,
  );
}

// AI-REMOVED 2026-09-09:
// Reason: 旧辅助函数要求第一槽必须在某个 tick 提交快照中持有物品，错误固化了 Legacy 的门禁周期滞留。
// Trigger: 用户要求按游戏中的同门禁 tick 瞬时穿透语义增加约束，并跳过待淘汰的 Legacy。
// Evidence: Dense 的协议存储箱入出 transfer 同 tick 配对，tick 末槽位为空；Legacy 才会将新入物品保留到下一门禁。
// Replacement: expectBalancedStorageInstantPassThrough。
// Risk: Low；第一槽使用由 transfer 槽位路径继续覆盖。
// Human Review: Required
//
// Original code:
// function expectOnlyFirstStorageSlotUsedAtEveryTick(
//   report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
// ): void {
//   const firstSlotObservedByDevice = new Set<string>();
//
//   for (const tick of report.ticks) {
//     for (const deviceId of BALANCED_STORAGE_DEVICE_IDS) {
//       const slotItems = tick.devices[deviceId]?.slotItems;
//       expect(slotItems, `tick ${tick.tickNumber}: 缺少协议存储箱 ${deviceId} 的槽位状态`).toBeDefined();
//
//       const filledSlots = slotItems?.filter((slot) => slot.count > 0) ?? [];
//       if (filledSlots.some((slot) => slot.storageGroupId === "storage_slot_1")) {
//         firstSlotObservedByDevice.add(deviceId);
//       }
//       expect(
//         filledSlots.filter((slot) => slot.storageGroupId !== "storage_slot_1"),
//         `tick ${tick.tickNumber}: 协议存储箱 ${deviceId} 的第 2～6 格不应有物品`,
//       ).toEqual([]);
//     }
//   }
//
//   expect([...firstSlotObservedByDevice].sort()).toEqual([...BALANCED_STORAGE_DEVICE_IDS].sort());
// }
function expectBalancedStorageInstantPassThrough(
  report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
): void {
  for (const tick of report.ticks) {
    for (const deviceId of BALANCED_STORAGE_DEVICE_IDS) {
      const slotItems = tick.devices[deviceId]?.slotItems;
      expect(slotItems, `tick ${tick.tickNumber}: 缺少协议存储箱 ${deviceId} 的槽位状态`).toBeDefined();

      const filledSlots = slotItems?.filter((slot) => slot.count > 0) ?? [];
      expect(
        filledSlots,
        `tick ${tick.tickNumber}: 协议存储箱 ${deviceId} 同门禁 tick 穿透后不应滞留物品`,
      ).toEqual([]);
    }
  }

  for (let lane = 1; lane <= 3; lane += 1) {
    const inputTransferTicks = readTransferTickNumbers(
      report,
      `input-meter-${lane}`,
      "storage",
    );
    const outputTransferTicks = readTransferTickNumbers(
      report,
      "storage",
      `output-meter-${lane}`,
    );

    expect(inputTransferTicks.length, `第 ${lane} 路应有物品进入协议存储箱`).toBeGreaterThan(0);
    expect(
      outputTransferTicks,
      `第 ${lane} 路协议存储箱输入和输出必须发生在同一门禁 tick`,
    ).toEqual(inputTransferTicks);
  }

  const storageTransfers = report.ticks.flatMap((tick) =>
    tick.transfers
      .filter((transfer) =>
        isDeviceSlot(transfer.sourceSlotId, "storage")
        || isDeviceSlot(transfer.targetSlotId, "storage")
      )
      .map((transfer) => ({ tickNumber: tick.tickNumber, transfer })),
  );
  expect(storageTransfers.length, "协议存储箱应发生输入输出搬运").toBeGreaterThan(0);

  for (const { tickNumber, transfer } of storageTransfers) {
    const storageSlotId = isDeviceSlot(transfer.sourceSlotId, "storage")
      ? transfer.sourceSlotId
      : transfer.targetSlotId;
    expect(
      storageSlotId,
      `tick ${tickNumber}: 协议存储箱搬运必须只经过第一槽`,
    ).toContain("/node:storage_slot_1.");

    const elapsedMilliseconds = resolveSimulationMillisecondsAtFirstTick(
      report.topology.standardTickRate,
      tickNumber,
    );
    expect(
      elapsedMilliseconds % 1_000,
      `tick ${tickNumber}: 协议存储箱搬运必须发生在 1000ms 门禁相位`,
    ).toBe(0);
  }
}

function readTransferTickNumbers(
  report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
  sourceDeviceId: string,
  targetDeviceId: string,
): number[] {
  return report.ticks.flatMap((tick) =>
    tick.transfers.some((transfer) =>
      isDeviceSlot(transfer.sourceSlotId, sourceDeviceId)
      && isDeviceSlot(transfer.targetSlotId, targetDeviceId)
    )
      ? [tick.tickNumber]
      : [],
  );
}

function isDeviceSlot(slotId: string, deviceId: string): boolean {
  return slotId.startsWith(`device:${deviceId}/`);
}
