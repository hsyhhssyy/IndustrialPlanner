import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { createDarkPipeSlotLink } from "@/shared/dark-pipe-link";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  getDevice,
} from "./blueprint-test-helpers";

const ITEM_ID = "item_liquid_xiranite";
const ADMISSION_COUNTER_ID = "fluid_input:in_w";
const FINAL_TICK = 70 * STANDARD_TICK_RATE_PER_SECOND;

describe("dark pipe linked throughput", () => {
  it("keeps a linked single-port dark pipe at 120 fluid per minute in both directions", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint(
        "single-dark-pipe-linked-throughput",
        [
          createEntity("source", "liquid_storager_1", 0, 0, 0, {
            "storageSlotGroups[0].slots[0].initialItemType": ITEM_ID,
            "storageSlotGroups[0].slots[0].initialCount": 500,
          }),
          createEntity("input-pipe", "pipe_straight_1x1", 3, 1),
          createMeteredPipeAdmission("input-meter", 4, 1, 0),
          createEntity("inlet", "udpipe_loader_1", 5, 0),
          createEntity("outlet", "udpipe_unloader_1", 10, 0),
          createEntity("output-pipe", "pipe_straight_1x1", 13, 1),
          createEntity("sink", "liquid_storager_1", 14, 0),
        ],
        [createDarkPipeSlotLink({ inletEntityId: "inlet", outletEntityId: "outlet" })],
      ),
      maxTickNumber: FINAL_TICK,
      registry: createRegistryContract(),
    });

    expect(readOneMinuteCount(report, "input-meter")).toBe(120);
    expect(countRecentOutputTransfers(report, "outlet")).toBe(120);
  });

  it("keeps both ports of a linked multi-port dark pipe at 120 fluid per minute", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint(
        "multi-dark-pipe-linked-throughput",
        [
          // 保持用户问题蓝图的实体顺序；旧求解器会因该顺序让输入、输出相位交替，吞吐减半。
          createEntity("outlet", "udpipe_unloader_2", 7, 19, 90),
          createEntity("inlet", "udpipe_loader_2", 7, 23, 270),
          createEntity("source-1", "liquid_storager_1", 9, 28, 270, {
            "storageSlotGroups[0].slots[0].initialItemType": ITEM_ID,
            "storageSlotGroups[0].slots[0].initialCount": 500,
          }),
          createEntity("source-2", "liquid_storager_1", 6, 28, 270, {
            "storageSlotGroups[0].slots[0].initialItemType": ITEM_ID,
            "storageSlotGroups[0].slots[0].initialCount": 500,
          }),
          createEntity("sink-1", "liquid_storager_1", 0, 16, 180),
          createEntity("sink-2", "liquid_storager_1", 0, 19, 180),
          createEntity("output-turn-1", "pipe_turn_ccw_1x1", 8, 18, 180),
          createEntity("output-pipe-1a", "pipe_straight_1x1", 7, 18, 180),
          createEntity("output-pipe-1b", "pipe_straight_1x1", 6, 18, 180),
          createEntity("output-pipe-1c", "pipe_straight_1x1", 5, 18, 180),
          createEntity("output-pipe-1d", "pipe_straight_1x1", 4, 18, 180),
          createEntity("output-turn-2", "pipe_turn_ccw_1x1", 3, 18, 90),
          createEntity("output-pipe-1e", "pipe_straight_1x1", 3, 19, 90),
          createEntity("output-turn-3", "pipe_turn_cw_1x1", 3, 20, 270),
          createEntity("output-pipe-2a", "pipe_straight_1x1", 10, 18, 270),
          createEntity("output-turn-4", "pipe_turn_ccw_1x1", 10, 17, 180),
          createEntity("output-pipe-2b", "pipe_straight_1x1", 9, 17, 180),
          createEntity("output-pipe-2c", "pipe_straight_1x1", 8, 17, 180),
          createEntity("output-pipe-2d", "pipe_straight_1x1", 7, 17, 180),
          createEntity("output-pipe-2e", "pipe_straight_1x1", 6, 17, 180),
          createEntity("output-pipe-2f", "pipe_straight_1x1", 5, 17, 180),
          createEntity("output-pipe-2g", "pipe_straight_1x1", 4, 17, 180),
          createEntity("output-pipe-2h", "pipe_straight_1x1", 3, 17, 180),
          createEntity("input-pipe-1", "pipe_straight_1x1", 10, 27, 270),
          createEntity("input-turn-1", "pipe_turn_cw_1x1", 7, 27, 90),
          createEntity("input-turn-2", "pipe_turn_ccw_1x1", 8, 27, 270),
          createMeteredPipeAdmission("input-meter-1", 8, 26, 270),
          createMeteredPipeAdmission("input-meter-2", 10, 26, 270),
        ],
        [createDarkPipeSlotLink({ inletEntityId: "inlet", outletEntityId: "outlet" })],
      ),
      maxTickNumber: FINAL_TICK,
      registry: createRegistryContract(),
    });

    expect([
      readOneMinuteCount(report, "input-meter-1"),
      readOneMinuteCount(report, "input-meter-2"),
    ]).toEqual([120, 120]);
    expect(countRecentOutputTransfers(report, "outlet")).toBe(240);
  });
});

function createMeteredPipeAdmission(
  id: string,
  x: number,
  y: number,
  rotation: 0 | 90 | 180 | 270,
) {
  return createEntity(id, "pipe_admission", x, y, rotation, createAdmissionConfig());
}

function createAdmissionConfig() {
  return {
    "portGroups[0].ports[0].acceptRule": {
      base: { kind: "item" as const, itemId: ITEM_ID },
      exclude: [],
    },
    "portGroups[0].ports[0].admissionRule": {
      itemId: ITEM_ID,
      limit: null,
      perMinuteLimit: null,
    },
  };
}

function readOneMinuteCount(
  report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
  deviceId: string,
): number | undefined {
  return getDevice(report, FINAL_TICK, deviceId)
    .admissionCounters?.[ADMISSION_COUNTER_ID]?.oneMinuteCount;
}

function countRecentOutputTransfers(
  report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
  outletEntityId: string,
): number {
  const windowStartTick = FINAL_TICK - (60 * STANDARD_TICK_RATE_PER_SECOND);
  return report.ticks.reduce((total, tick) => {
    if (tick.tickNumber <= windowStartTick) {
      return total;
    }
    return total + tick.transfers.reduce((tickTotal, transfer) =>
      transfer.sourceSlotId.includes(`device:${outletEntityId}/`)
        ? tickTotal + transfer.amount
        : tickTotal,
    0);
  }, 0);
}
