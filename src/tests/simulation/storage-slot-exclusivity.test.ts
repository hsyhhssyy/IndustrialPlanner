import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { createBlueprint, createEntity, getDevice } from "./blueprint-test-helpers";

/**
 * 回归测试：槽位组内互斥规则（§3.4）
 *
 * 规则：同一存储槽组内不同槽不可容纳相同物品。
 * Bug 背景：findInputSlotForItem 曾因"先判容量、后判类型"的顺序错误，
 * 导致满容槽位被跳过、配方产物流入另一空槽，违反互斥规则。
 *
 * 修复：类型匹配优先 → 匹配成功但满容 → 立即返回 null（不另找空槽）。
 */
describe("存储槽位组内互斥规则", () => {
  // 扩容反应池配方 2s = 40 ticks，需要至少 80 ticks 跑两轮验证行为
  const TICK_COUNT = 100;

  it("扩容反应池 — 同一液体满容时配方产出不会溢出到其他空槽", async () => {
    const registry = createRegistryContract();

    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("slot-exclusivity-overflow", [
        createEntity("reactor", "mix_pool_2", 0, 0, 0, {
          channelRecipes: {
            // 息壤粉末 + 水 → 液化息壤（immediate-consume, 2s = 40 ticks）
            ch1: "r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic_large",
          },
          // 槽位 0: 液化息壤满容 50/50 — 模拟"产物占用槽位已满"的场景
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_xiranite",
          "storageSlotGroups[0].slots[0].initialCount": 50,
          // 槽位 1: 息壤粉末 × 10 — 足够多轮配方尝试
          "storageSlotGroups[0].slots[1].initialItemType": "item_xiranite_powder",
          "storageSlotGroups[0].slots[1].initialCount": 10,
          // 槽位 2: 水 × 10 — 足够多轮配方尝试
          "storageSlotGroups[0].slots[2].initialItemType": "item_liquid_water",
          "storageSlotGroups[0].slots[2].initialCount": 10,
        }),
        createEntity("power", "power_diffuser_1", 6, 0),
      ]),
      maxTickNumber: TICK_COUNT,
      registry,
    });

    const reactorTick = getDevice(report, TICK_COUNT, "reactor");
    expect(reactorTick).toBeDefined();

    // 关键断言：只应有一个槽位持有 item_liquid_xiranite
    const liquidXiraniteSlots = reactorTick.slotItems.filter(
      (s) => s.itemType === "item_liquid_xiranite",
    );
    expect(
      liquidXiraniteSlots.length,
      "同一液体不应出现在多个槽位中（组内互斥规则）",
    ).toBeLessThanOrEqual(1);

    // 满容槽位不应被新产出"追加"
    const liquidXiraniteSlot = liquidXiraniteSlots[0];
    if (liquidXiraniteSlot) {
      expect(
        liquidXiraniteSlot.count,
        "满容槽位数量不应超过初始值 50",
      ).toBeLessThanOrEqual(50);
    }
  });

  it("扩容反应池 — 配方输入完成、产物满容阻塞", async () => {
    const registry = createRegistryContract();

    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("slot-exclusivity-block", [
        createEntity("reactor", "mix_pool_2", 0, 0, 0, {
          channelRecipes: {
            ch1: "r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic_large",
          },
          // 液化息壤满容
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_xiranite",
          "storageSlotGroups[0].slots[0].initialCount": 50,
          // 原料
          "storageSlotGroups[0].slots[1].initialItemType": "item_xiranite_powder",
          "storageSlotGroups[0].slots[1].initialCount": 10,
          "storageSlotGroups[0].slots[2].initialItemType": "item_liquid_water",
          "storageSlotGroups[0].slots[2].initialCount": 10,
        }),
        createEntity("power", "power_diffuser_1", 6, 0),
      ]),
      maxTickNumber: TICK_COUNT,
      registry,
    });

    // 满容后配方应阻塞 — 阻塞清理可能已触发，验证相同液体没有溢出到空槽
    const reactorTick = getDevice(report, TICK_COUNT, "reactor");
    const liquidXiraniteSlots = reactorTick.slotItems.filter(
      (s) => s.itemType === "item_liquid_xiranite",
    );
    expect(
      liquidXiraniteSlots.length,
      "满容阻塞不应导致同一液体溢出到其他空槽",
    ).toBeLessThanOrEqual(1);
  });

  it("扩容反应池 — 有空余容量时正常追加到已有槽位（不退化为空槽）", async () => {
    const registry = createRegistryContract();

    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("slot-exclusivity-normal", [
        createEntity("reactor", "mix_pool_2", 0, 0, 0, {
          channelRecipes: {
            ch1: "r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic_large",
          },
          // 液化息壤 10/50 — 有 40 空余容量
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_xiranite",
          "storageSlotGroups[0].slots[0].initialCount": 10,
          // 原料充足（2s 配方在 100 tick 最多完成 2 轮）
          "storageSlotGroups[0].slots[1].initialItemType": "item_xiranite_powder",
          "storageSlotGroups[0].slots[1].initialCount": 5,
          "storageSlotGroups[0].slots[2].initialItemType": "item_liquid_water",
          "storageSlotGroups[0].slots[2].initialCount": 5,
        }),
        createEntity("power", "power_diffuser_1", 6, 0),
      ]),
      maxTickNumber: TICK_COUNT,
      registry,
    });

    const reactorTick = getDevice(report, TICK_COUNT, "reactor");

    // 不应出现两个 liquid_xiranite 槽位
    const liquidXiraniteSlots = reactorTick.slotItems.filter(
      (s) => s.itemType === "item_liquid_xiranite",
    );
    expect(
      liquidXiraniteSlots.length,
      "同一液体不应出现在多个槽位中",
    ).toBeLessThanOrEqual(1);

    // 应有产出增加
    if (liquidXiraniteSlots.length === 1) {
      expect(
        liquidXiraniteSlots[0].count,
        "液化息壤数量应在 10 基础上增加",
      ).toBeGreaterThan(10);
    }
  });

  it("普通反应池 — 同一液体满容时不会溢出到其他空槽", async () => {
    const registry = createRegistryContract();

    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("slot-exclusivity-mix-pool-1", [
        createEntity("pool", "mix_pool_1", 0, 0, 0, {
          channelRecipes: {
            ch1: "r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic",
          },
          // 液化息壤满容 50/50
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_xiranite",
          "storageSlotGroups[0].slots[0].initialCount": 50,
          // 原料
          "storageSlotGroups[0].slots[1].initialItemType": "item_xiranite_powder",
          "storageSlotGroups[0].slots[1].initialCount": 3,
          "storageSlotGroups[0].slots[2].initialItemType": "item_liquid_water",
          "storageSlotGroups[0].slots[2].initialCount": 3,
        }),
        createEntity("power", "power_diffuser_1", 6, 0),
      ]),
      maxTickNumber: TICK_COUNT,
      registry,
    });

    const poolTick = getDevice(report, TICK_COUNT, "pool");

    const liquidXiraniteSlots = poolTick.slotItems.filter(
      (s) => s.itemType === "item_liquid_xiranite",
    );
    expect(
      liquidXiraniteSlots.length,
      "普通反应池：同一液体不应出现在多个槽位中",
    ).toBeLessThanOrEqual(1);
  });
});
