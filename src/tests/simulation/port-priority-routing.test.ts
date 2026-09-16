import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { getDevice, getLastTick, loadBlueprintFromFile } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

const OUTPUT_ITEM_ID = "item_xiranite_poly";

describe.each(SIMULATION_ENGINE_MATRIX)(
  "port priority routing assembly [%s]",
  (engineKind) => {
    it.each([
      {
        name: "routes scarce cargo only through the higher-priority output",
        blueprintFile: "src/tests/fixtures/blueprints/simulation/port-priority-routing/scene-02-mix-pool-solid-output-priority-scarce.schema6.json",
        expectedPortIds: ["out_n_4"],
      },
      {
        name: "fills the higher-priority output before overflowing through the lower-priority output in the same tick",
        blueprintFile: "src/tests/fixtures/blueprints/simulation/port-priority-routing/scene-01-mix-pool-solid-output-priority-routing.schema6.json",
        expectedPortIds: ["out_n_4", "out_n_3"],
      },
    ])("$name", async ({ blueprintFile, expectedPortIds }) => {
      const report = await runBlueprintSimulation({
        blueprint: loadBlueprintFromFile(blueprintFile),
        registry: createRegistryContract(),
        engineKind,
        maxDurationSeconds: 0.5,
      });
      const firstOutputTick = report.ticks.find((tick) => tick.transfers.some((transfer) =>
        transfer.sourceSlotId.includes("device:pool/")
        && transfer.itemType === OUTPUT_ITEM_ID,
      ));
      const movedPortIds = firstOutputTick?.transfers
        .filter((transfer) =>
          transfer.sourceSlotId.includes("device:pool/")
          && transfer.itemType === OUTPUT_ITEM_ID,
        )
        .map((transfer) => {
          if (transfer.edgeId.includes("item_output.out_n_4")) {
            return "out_n_4";
          }
          if (transfer.edgeId.includes("item_output.out_n_3")) {
            return "out_n_3";
          }
          return "unexpected";
        }) ?? [];

      expect(report.topology.diagnostics).toEqual([]);
      expect(firstOutputTick).toBeDefined();
      expect(movedPortIds).toEqual(expectedPortIds);
    });

    it.each([
      {
        beltLength: 1,
        blueprintFile: "src/tests/fixtures/blueprints/simulation/port-priority-routing/scene-03-mix-pool-single-input-priority-stream.schema6.json",
      },
      {
        beltLength: 4,
        blueprintFile: "src/tests/fixtures/blueprints/simulation/port-priority-routing/scene-04-mix-pool-four-belt-priority-stream.schema6.json",
      },
    ])("keeps a 32.5-second single-input stream on G1 with separate storage sinks and $beltLength belt tile(s)", async ({ beltLength, blueprintFile }) => {
      const report = await runBlueprintSimulation({
        blueprint: loadBlueprintFromFile(blueprintFile),
        registry: createRegistryContract(),
        engineKind,
        maxDurationSeconds: 32.5,
      });
      const finalTick = getLastTick(report);
      const g1Count = countDeviceItem(report, finalTick.tickNumber, "sink-g1");
      const g9Count = countDeviceItem(report, finalTick.tickNumber, "sink-g9");
      const maximumInputTransfersInOneTick = Math.max(...report.ticks.map((tick) =>
        tick.transfers.filter((transfer) =>
          transfer.targetSlotId.includes("device:pool/")
          && transfer.itemType === OUTPUT_ITEM_ID,
        ).length,
      ));
      const ratio = g9Count === 0 ? `${g1Count}:0` : `${g1Count / g9Count}:1`;

      console.info(
        `[port-priority] engine=${engineKind} beltLength=${beltLength} elapsed=${finalTick.elapsedSimulationSeconds}s G1=${g1Count} G9=${g9Count} ratio=${ratio}`,
      );

      expect(report.topology.diagnostics).toEqual([]);
      expect(maximumInputTransfersInOneTick).toBe(1);
      expect(g1Count + g9Count).toBeGreaterThanOrEqual(10);
      expect(g9Count, `${engineKind} / ${beltLength} 格输出带不应向 G9 储存箱持续分流`).toBe(0);
    });
  },
);

function countDeviceItem(
  report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
  tickNumber: number,
  deviceId: string,
): number {
  return getDevice(report, tickNumber, deviceId).slotItems
    .filter((slot) => slot.itemType === OUTPUT_ITEM_ID)
    .reduce((total, slot) => total + slot.count, 0);
}
