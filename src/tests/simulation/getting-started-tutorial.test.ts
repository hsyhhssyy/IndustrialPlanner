import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import { runBlueprintSimulation } from "./blueprint-runner";
import { loadBlueprintFromFile } from "./blueprint-test-helpers";

const BLUEPRINT_PATH = "public/blueprints/getting-started-tutorial.json";
const TARGET_ITEM = "item_xiranite_enr_powder";
const MAX_TICK = 210 * STANDARD_TICK_RATE_PER_SECOND;
const OBSERVED_DEVICE_IDS = [
  "item_port_mix_pool_1:1",
  "item_port_mix_pool_1:2",
  "item_port_xiranite_oven_1:1",
] as const;

describe("新手教程重息壤产线蓝图", () => {
  it("210 秒内可成功产出重息壤", { timeout: 300_000 }, async () => {
    const blueprint = loadBlueprintFromFile(BLUEPRINT_PATH);
    const report = await runBlueprintSimulation({
      blueprint,
      maxTickNumber: MAX_TICK,
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