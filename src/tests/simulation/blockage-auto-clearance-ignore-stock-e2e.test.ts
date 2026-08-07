import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { createBlueprint, createEntity, getDevice } from "./blueprint-test-helpers";

/**
 * 端到端回归测试：扩容反应池自动清堵不应清除 ignoreStock=true 的槽位
 *
 * 复现 https://github.com/hsyhhssyy/IndustrialPlanner/issues/26
 *
 * 用户场景（模拟 16× 倍速运行 600 tick）：
 *   扩容反应池 shared_input_buffer（8 槽 ×50）中：
 *     槽 0-3 设为无限供给（ignoreStock）：水、污水、息壤粉末、蓝铁粉末
 *     槽 4-7 预填满液化息壤、壤晶废液等 → 模拟产线已经跑了一段时间、缓冲即将堵满
 *   配方链路（3 频道）：
 *     ch1: 息壤粉末 + 水 → 液化息壤
 *     ch2: 液化息壤 + 污水 → 壤晶废液 + 惰性壤晶废液
 *     ch3: 壤晶废液 + 蓝铁粉末 → 污水 + 壤晶
 *   预期：3 频道同时堵塞 → 自动清堵触发 → 清空非无限槽位，保留无限槽。
 *   实际（bug）：自动清堵清空了所有槽位（含无限槽），后续产物流入带 ignoreStock
 *   标记的空槽后，产物在面板显示为 ∞。
 */
describe("扩容反应池自动清堵 - ignoreStock 保护 (端到端复现 #26)", () => {
  const TICK_COUNT = 600;

  const REACTOR_ID = "reactor";
  const SHARED_BUFFER = "shared_input_buffer";
  const REACTOR_DEVICE_KEY = "reactor";

  /** 用户设为无限的 4 种原料 */
  const INFINITE_ITEM_IDS = new Set([
    "item_liquid_water",     // 水
    "item_liquid_sewage",    // 污水
    "item_xiranite_powder",  // 息壤粉末
    "item_iron_powder",      // 蓝铁粉末
  ]);

  /** 产线运行过程中产生（不应被标记为无限）的产物 */
  const INTERMEDIATE_ITEM_PREFIXES = [
    "item_liquid_xiranite",          // 液化息壤
    "item_liquid_xiranite_poly",     // 壤晶废液
    "item_liquid_xiranite_lowpoly",  // 惰性壤晶废液
    "item_xiranite_poly",            // 壤晶（固体产物）
  ];

  it("不清除 ignoreStock=true 的槽位，产物不继承无限标记", async () => {
    const registry = createRegistryContract();

    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("issue-26-e2e", [
        createEntity(REACTOR_ID, "mix_pool_2", 0, 0, 0, {
          // 手动指定 3 个频道的配方
          channelRecipes: {
            ch1: "r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic_large",
            ch2: "r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic_large",
            ch3: "r_chrono_mix_pool_inert_waste_liquid_water_slag_from_waste_liquid_and_iron_powder_basic_large",
          },
          // ──── 槽位 0: 水（无限）────
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
          "storageSlotGroups[0].slots[0].initialCount": 50,
          "storageSlotGroups[0].slots[0].ignoreStock": true,
          // ──── 槽位 1: 污水（无限）────
          "storageSlotGroups[0].slots[1].initialItemType": "item_liquid_sewage",
          "storageSlotGroups[0].slots[1].initialCount": 50,
          "storageSlotGroups[0].slots[1].ignoreStock": true,
          // ──── 槽位 2: 息壤粉末（无限）────
          "storageSlotGroups[0].slots[2].initialItemType": "item_xiranite_powder",
          "storageSlotGroups[0].slots[2].initialCount": 50,
          "storageSlotGroups[0].slots[2].ignoreStock": true,
          // ──── 槽位 3: 蓝铁粉末（无限）────
          "storageSlotGroups[0].slots[3].initialItemType": "item_iron_powder",
          "storageSlotGroups[0].slots[3].initialCount": 50,
          "storageSlotGroups[0].slots[3].ignoreStock": true,
          // ──── 槽位 4: 液化息壤（占位，让 ch2 可立即启动）────
          "storageSlotGroups[0].slots[4].initialItemType": "item_liquid_xiranite",
          "storageSlotGroups[0].slots[4].initialCount": 50,
          // ──── 槽位 5: 壤晶废液（占位，让 ch3 可立即启动）────
          "storageSlotGroups[0].slots[5].initialItemType": "item_liquid_xiranite_poly",
          "storageSlotGroups[0].slots[5].initialCount": 50,
          // ──── 槽位 6-7: 惰性壤晶废液（占位填满缓冲）────
          "storageSlotGroups[0].slots[6].initialItemType": "item_liquid_xiranite_lowpoly",
          "storageSlotGroups[0].slots[6].initialCount": 50,
          "storageSlotGroups[0].slots[7].initialItemType": "item_liquid_xiranite_lowpoly",
          "storageSlotGroups[0].slots[7].initialCount": 50,
        }),
        createEntity("power", "power_diffuser_1", 6, 0),
      ]),
      maxTickNumber: TICK_COUNT,
      registry,
    });

    // ──── 断言：最终快照中 ignoreStock=true 的槽位只应有无限原料 ────
    const device = getDevice(report, TICK_COUNT, REACTOR_DEVICE_KEY);
    const infiniteSlots = device.slotItems.filter((s) => s.ignoreStock);

    // 应至少有 4 个无限槽位（如果 bug 存在可能会有更多槽位被标记为无限）
    expect(
      infiniteSlots.length,
      `最终快照中 ignoreStock=true 的槽位数应为 4，但实际有 ${infiniteSlots.length}`,
    ).toBe(4);

    // 所有 ignoreStock=true 的槽位只能包含用户指定的 4 种无限原料
    for (const slot of infiniteSlots) {
      const itemType = slot.itemType;
      expect(
        itemType,
        `槽位 ${slot.slotId} 标记为无限但物品为 "${itemType}"，不应被产物污染`,
      ).not.toBeNull();

      // ❌ Bug 表现：产物（液化息壤、壤晶废液等）带上了 ignoreStock=true
      expect(
        INFINITE_ITEM_IDS.has(itemType!),
        `槽位 ${slot.slotId} ignoreStock=true 但物品为 "${itemType}"，` +
        `这是 bug — 产物不应继承无限标记。该槽位原本是用户设为无限的原料槽，` +
        `被自动清堵清空后，产物流入并继承了拓扑中的 ignoreStock。`,
      ).toBe(true);
    }

    // ──── 验证产物没有继承无限标记 ────
    for (const slot of device.slotItems) {
      if (slot.itemType !== null && INTERMEDIATE_ITEM_PREFIXES.some(
        (prefix) => slot.itemType!.startsWith(prefix),
      )) {
        expect(
          slot.ignoreStock,
          `产物 ${slot.itemType} 在槽位 ${slot.slotId} 不应被标记为无限`,
        ).toBe(false);
      }
    }
  });
});
