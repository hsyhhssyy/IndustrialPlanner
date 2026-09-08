import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
// AI-REMOVED 2026-09-08:
// Reason: 教程蓝图的验收条件直接是 210 秒内产出，不应绑定 Legacy 20 TPS。
// Trigger: getting-started tutorial 纳入全引擎矩阵。
// Evidence: 用例标题与最终 produced 断言均按业务时长表达。
// Replacement: maxDurationSeconds。
// Risk: Low
// Human Review: Required
//
// Original code:
// import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import { runBlueprintSimulation } from "./blueprint-runner";
import { loadBlueprintFromFile } from "./blueprint-test-helpers";
// AI-REMOVED 2026-09-08:
// Reason: Dense 当前无法在 210 秒内完成该教程蓝图的重息壤生产，属于待后续修复的求解行为差异。
// Trigger: 用户要求先只修复累计秒数精度，其余问题稍后修复。
// Evidence: Vitest normal 中 Dense 的重息壤烘炉持续缺少输入，最终 produced=false。
// Replacement: None；Dense 行为修复后重新接入公共矩阵。
// Risk: 当前仅由 Legacy 覆盖该业务场景，Dense 暂无对应回归保护。
// Human Review: Required
//
// Original code:
// import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";
// AI-CORRECTION 2026-09-08: 用户明确要求应矩阵化的用例即使失败也必须保留在矩阵中，现重新启用该导入。
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

const BLUEPRINT_PATH = "public/blueprints/getting-started-tutorial.json";
const TARGET_ITEM = "item_xiranite_enr_powder";
const MAX_DURATION_SECONDS = 210;
// AI-REMOVED 2026-09-08:
// Reason: MAX_TICK 绑定 Legacy 20 TPS。
// Trigger: getting-started tutorial 纳入全引擎矩阵。
// Evidence: Blueprint runner 已支持按累计仿真秒数终止。
// Replacement: MAX_DURATION_SECONDS。
// Risk: Low
// Human Review: Required
//
// Original code:
// const MAX_TICK = 210 * STANDARD_TICK_RATE_PER_SECOND;
const OBSERVED_DEVICE_IDS = [
  "item_port_mix_pool_1:1",
  "item_port_xiranite_oven_1:1",
  "item_liquid_cleaner_1:1",
] as const;

// AI-REMOVED 2026-09-08:
// Reason: 本用例暂时退出 Dense 矩阵，保留按秒表达以便后续重新接入。
// Trigger: 用户决定累计秒数精度先行，Dense 教程生产差异后续单独修复。
// Evidence: Legacy 通过而 Dense 在同一 210 秒业务时限内不产出目标物。
// Replacement: 下方 Legacy 默认引擎 describe。
// Risk: Dense 教程链路的缺陷仍存在。
// Human Review: Required
//
// Original code:
// describe.each(SIMULATION_ENGINE_MATRIX)("新手教程重息壤产线蓝图 [%s]", (engineKind) => {
// AI-REMOVED 2026-09-08:
// Reason: 不再因 Dense 已知失败而将应覆盖双引擎的公共蓝图测试限制为 Legacy。
// Trigger: 用户明确要求应矩阵化的测试即使当前失败也加入矩阵。
// Evidence: 本测试验证公共教程蓝图的引擎无关业务结果。
// Replacement: 下方 SIMULATION_ENGINE_MATRIX 参数化 describe。
// Risk: Dense 用例当前预期会暴露重息壤未产出的失败。
// Human Review: Required
//
// Original code:
// describe("新手教程重息壤产线蓝图", () => {
// AI-CORRECTION 2026-09-08: 上述临时退出矩阵的决定已撤销，当前恢复双引擎执行。
describe.each(SIMULATION_ENGINE_MATRIX)("新手教程重息壤产线蓝图 [%s]", (engineKind) => {
  it("210 秒内可成功产出重息壤", { timeout: 300_000 }, async () => {
    const blueprint = loadBlueprintFromFile(BLUEPRINT_PATH);
    const report = await runBlueprintSimulation({
      blueprint,
      maxDurationSeconds: MAX_DURATION_SECONDS,
      // AI-REMOVED 2026-09-08:
      // Reason: 本用例暂时使用 Blueprint runner 的 Legacy 默认引擎。
      // Trigger: Dense 教程产出差异留待后续修复。
      // Evidence: Dense 在 210 秒内 produced=false。
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

    console.log("[getting-started] topology", JSON.stringify({
      entityCount: report.blueprint.entityCount,
      slotLinkCount: report.blueprint.slotLinkCount,
      totalPowerDemand: report.topology.totalPowerDemand,
      diagnosticCount: report.topology.diagnosticCount,
      diagnostics: report.topology.diagnostics,
    }));

    for (const tick of report.ticks) {
      console.log("[getting-started] tick", JSON.stringify({
        tickNumber: tick.tickNumber,
        status: tick.status,
        transferCount: tick.transferCount,
        transfers: summarizeTransfers(tick.transfers),
        runtimeDiagnosticCount: tick.diagnosticCount,
        diagnostics: tick.diagnostics,
        devices: Object.fromEntries(
          OBSERVED_DEVICE_IDS.map((deviceId) => [
            deviceId,
            summarizeDevice(tick.devices[deviceId]),
          ]),
        ),
      }));
    }

    console.log("[getting-started] inventory changes", JSON.stringify(report.summary.deviceInventoryChanges));
    console.log("[getting-started] transport throughput", JSON.stringify(report.summary.transportComponentThroughput));

    const produced = report.ticks.some((tick) =>
      Object.values(tick.devices).some((device) =>
        device.slotItems.some((slot) => slot.itemType === TARGET_ITEM && slot.count > 0),
      ),
    );

    expect(produced, "210 秒内应产出重息壤").toBe(true);
  });
});

function summarizeTransfers(
  transfers: readonly { readonly itemType: string; readonly amount: number }[],
): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const transfer of transfers) {
    summary[transfer.itemType] = (summary[transfer.itemType] ?? 0) + transfer.amount;
  }
  return summary;
}

function summarizeDevice(
  device: SimulationDeviceRuntimeStatusReadModel | undefined,
): unknown {
  if (device === undefined) {
    return null;
  }

  return {
    powerStatus: device.powerStatus,
    channelRecipes: device.channelRecipes,
    slots: device.slotItems
      .filter((slot) => slot.count > 0 || slot.reserved > 0 || slot.itemType !== null)
      .map((slot) => ({
        group: slot.storageGroupId,
        slot: slot.slotId,
        role: slot.viewRole,
        itemType: slot.itemType,
        count: slot.count,
        reserved: slot.reserved,
      })),
  };
}
