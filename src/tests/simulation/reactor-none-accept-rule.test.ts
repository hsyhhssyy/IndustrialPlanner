import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  getDevice,
  getLastTick,
} from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

describe.each(SIMULATION_ENGINE_MATRIX)(
  "reactor output port acceptRule: none blocks output [%s]",
  (engineKind) => {
  // AI-REMOVED 2026-09-08:
  // Reason: TICK_COUNT=1 在两个引擎中代表不同仿真时长。
  // Trigger: reactor none accept rule 纳入全引擎矩阵。
  // Evidence: 用例验证首个 0.5 秒观察窗口内不存在任何物流边。
  // Replacement: maxDurationSeconds: 0.5 与 getLastTick。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const TICK_COUNT = 1;

  it("blocks all transfer when no output port config is set", async () => {
    const registry = createRegistryContract();

    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("reactor-none-blocks-output", [
        createEntity("reactor", "mix_pool_2", 0, 0, 0, {
          channelRecipes: {
            ch1: "r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic_large",
            ch2: "r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic_large",
          },
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_xiranite",
          "storageSlotGroups[0].slots[0].initialCount": 2,
          "storageSlotGroups[0].slots[1].initialItemType": "item_liquid_sewage",
          "storageSlotGroups[0].slots[1].initialCount": 2,
          "storageSlotGroups[0].slots[2].initialItemType": "item_xiranite_powder",
          "storageSlotGroups[0].slots[2].initialCount": 2,
          "storageSlotGroups[0].slots[3].initialItemType": "item_liquid_water",
          "storageSlotGroups[0].slots[3].initialCount": 2,
        }),
        createEntity("power", "power_diffuser_1", 6, 0),
      ]),
      maxDurationSeconds: 0.5,
      engineKind,
      registry,
    });

    // 没有任何物流传输 — 输出端口 acceptRule=none，边未建立
    expect(report.summary.totalTransferCount).toBe(0);
    expect(report.summary.transportComponentThroughput.length).toBe(0);

    const reactorTick = getDevice(report, getLastTick(report).tickNumber, "reactor");
    expect(reactorTick).toBeDefined();
  });
  },
);
