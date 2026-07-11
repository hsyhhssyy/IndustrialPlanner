import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  getDevice,
} from "./blueprint-test-helpers";

describe("reactor output port acceptRule: none blocks output", () => {
  const TICK_COUNT = 1;

  it("blocks all transfer when no output port config is set", async () => {
    const registry = createRegistryContract();

    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("reactor-none-blocks-output", [
        createEntity("reactor", "item_port_mix_pool_2", 0, 0, 0, {
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
        createEntity("power", "item_port_power_diffuser_1", 6, 0),
      ]),
      maxTickNumber: TICK_COUNT,
      registry,
    });

    // 没有任何物流传输 — 输出端口 acceptRule=none，边未建立
    expect(report.summary.totalTransferCount).toBe(0);
    expect(report.summary.transportComponentThroughput.length).toBe(0);

    const reactorTick = getDevice(report, TICK_COUNT, "reactor");
    expect(reactorTick).toBeDefined();
  });
});
