import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import { createBlueprint, createEntity, getDevice } from "./blueprint-test-helpers";

// 重息壤产线验证：水泵 + 暗管(水/污水) → 混合池B(息壤+水→液化息壤)
// → 混合池C(液化息壤+污水→废液) → 希壤炉(息壤+废液→重息壤)
// 本测试通过 initialItemType 预种流体，跳过管道布线，聚焦配方链正确性。

describe("重息壤产线配方链验证", () => {
  const MAX_TICK = 30 * STANDARD_TICK_RATE_PER_SECOND; // 30 秒

  it("步骤1: 混合池 — 息壤+水→液化息壤", { timeout: 300_000 }, async () => {
    const registry = createRegistryContract();
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("step1-xiranite-liquid", [
        createEntity("pool", "mix_pool_1", 0, 0, 0, {
          channelRecipes: {
            ch1: "r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic",
          },
          // 混合池 shared_input_buffer: kind=item, filter=any, 5 slots
          "storageSlotGroups[0].slots[0].initialItemType": "item_xiranite_powder",
          "storageSlotGroups[0].slots[0].initialCount": 10,
          "storageSlotGroups[0].slots[1].initialItemType": "item_liquid_water",
          "storageSlotGroups[0].slots[1].initialCount": 10,
        }),
        createEntity("power", "power_diffuser_1", 6, 0),
      ]),
      maxTickNumber: MAX_TICK,
      registry,
    });

    // 30秒后验证：息壤+水→液化息壤 (immediate-consume, 2s/次)
    // immediate-consume 配方在 progress=0% 立即消耗原料，产物写入同一 buffer 的空槽
    const slotItems = getDevice(report, MAX_TICK, "pool").slotItems;
    console.log("[step1] 30s 槽位:", JSON.stringify(slotItems));

    const liquidXiraniteSlot = slotItems.find(s => s.itemType === "item_liquid_xiranite");

    expect(liquidXiraniteSlot, "应有液化息壤产出").toBeDefined();
    expect(liquidXiraniteSlot!.count, "液化息壤数量应>0").toBeGreaterThan(0);
    // 10 息壤 + 10 水 → 应产出 10 液化息壤
    expect(liquidXiraniteSlot!.count, "2s/次 × 30s = ~15次，但原料各10 ≈ 10个产出").toBe(10);
  });

  it("步骤2: 混合池 — 液化息壤+污水→废液+低聚废液", { timeout: 300_000 }, async () => {
    const registry = createRegistryContract();
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("step2-waste-liquid", [
        createEntity("pool", "mix_pool_1", 0, 0, 0, {
          channelRecipes: {
            ch1: "r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic",
          },
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_xiranite",
          "storageSlotGroups[0].slots[0].initialCount": 10,
          "storageSlotGroups[0].slots[1].initialItemType": "item_liquid_sewage",
          "storageSlotGroups[0].slots[1].initialCount": 10,
        }),
        createEntity("power", "power_diffuser_1", 6, 0),
      ]),
      maxTickNumber: MAX_TICK,
      registry,
    });

    // immediate-consume: 原料立即消耗，产物写入空槽
    const slotItems = getDevice(report, MAX_TICK, "pool").slotItems;
    console.log("[step2] 30s 槽位:", JSON.stringify(slotItems));

    const polySlot = slotItems.find(s => s.itemType === "item_liquid_xiranite_poly");
    const lowpolySlot = slotItems.find(s => s.itemType === "item_liquid_xiranite_lowpoly");

    expect(polySlot, "应有废液(liquid_xiranite_poly)产出").toBeDefined();
    expect(polySlot!.count, "废液数量应>0").toBeGreaterThan(0);
    expect(polySlot!.count, "10液化息壤+10污水 → 10废液").toBe(10);
    expect(lowpolySlot, "应有低聚废液产出").toBeDefined();
    expect(lowpolySlot!.count, "低聚废液数量应>0").toBeGreaterThan(0);
    expect(lowpolySlot!.count, "联产也是10").toBe(10);
  });

  it("步骤3: 希壤炉 — 息壤+废液→重息壤", { timeout: 300_000 }, async () => {
    const registry = createRegistryContract();
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("step3-xiranite-enr", [
        createEntity("oven", "xiranite_oven_1", 0, 0, 0, {
          channelRecipes: {
            default: "r_xiranite_oven_xiranite_enr_powder_from_xiranite_powder_and_waste_liquid_basic",
          },
          // createSimpleProductionDevice: [item_input, fluid_input, item_output]
          "storageSlotGroups[0].slots[0].initialItemType": "item_xiranite_powder",
          "storageSlotGroups[0].slots[0].initialCount": 10,
          "storageSlotGroups[1].slots[0].initialItemType": "item_liquid_xiranite_poly",
          "storageSlotGroups[1].slots[0].initialCount": 5,
        }),
        createEntity("power", "power_diffuser_1", 6, 0),
      ]),
      maxTickNumber: MAX_TICK,
      registry,
    });

    const slotItems = getDevice(report, MAX_TICK, "oven").slotItems;
    console.log("[step3] 30s 槽位:", JSON.stringify(slotItems));

    const enrSlot = slotItems.find(s => s.itemType === "item_xiranite_enr_powder");

    expect(enrSlot, "应有重息壤(xiranite_enr_powder)产出").toBeDefined();
    expect(enrSlot!.count, "重息壤数量应>0").toBeGreaterThan(0);
  });
});
