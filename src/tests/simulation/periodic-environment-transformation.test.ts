import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { compileFormationTransfer } from "@/simulation/environment/formation-transfer";
import { PeriodicEnvironmentTransformation, type ReadProjection } from "@/simulation/environment/periodic-transformation";
import { RecipeRandom } from "@/simulation/recipe-selection";

const registry = createRegistryContract();
const formation = registry.formationDefinitions[0]!;
const raw = "item_xiranite_powder";
const product = "item_xiranite_ming";

function fixture(n: number, ratio = 0.2, sides: ReadProjection[] = [() => "ming"]) {
  const cells = Array.from({ length: n }, (_, i) => ["in-" + i, "out-" + i]);
  const stocks = new Map<string, string>();
  const sampled: string[] = [];
  const definitions = { ...formation, effects: { ...formation.effects, ming: {
    ...formation.effects.ming, selectionRatioByLayer: [ratio, 0.4, 0.6, 1],
  } } };
  const settleItems = compileFormationTransfer(registry, definitions, []);
  const runtime = new PeriodicEnvironmentTransformation([{
    regionId: "region", formationId: formation.id, gridRect: { x: 0, y: 0, width: n, height: 1 },
    sourceDeviceId: "forge", sources: sides, cells, period: 10_000, settleItems,
  }], new RecipeRandom(), (slot, convert) => {
    if (slot.startsWith("in-")) sampled.push(slot);
    const item = stocks.get(slot);
    if (!item) return false;
    stocks.set(slot, convert(item));
    return true;
  });
  const fill = () => cells.forEach(([, slot]) => stocks.set(slot!, raw));
  return { runtime, stocks, sampled, fill };
}

describe("世界时钟与传送带选格", () => {
  it.each([[0, .2, 0], [1, .2, 1], [5, .2, 1], [6, .2, 2], [25, .2, 5], [25, .28, 7], [25, 0, 0], [25, 1, 25]])(
    "%i 格按 %f 每跳选 %i 格，满载十跳始终足额", (n, ratio, expected) => {
      const { runtime, stocks, sampled, fill } = fixture(n, ratio);
      for (let cycle = 1; cycle <= 10; cycle++) {
        fill();
        sampled.length = 0;
        runtime.settle(cycle * 10_000);
        expect(sampled.length).toBe(expected);
        expect(new Set(sampled).size).toBe(expected);
        expect([...stocks.values()].filter(item => item === product)).toHaveLength(expected);
      }
    });

  it("同一随机输入获得相同坐标。空带、已转产物和其他物料占用名额", () => {
    const full = fixture(25);
    full.fill();
    full.runtime.settle(10_000);
    const mixed = fixture(25);
    mixed.fill();
    const slots = full.sampled.map(id => id.replace("in-", "out-"));
    mixed.stocks.delete(slots[0]!);
    mixed.stocks.set(slots[1]!, product);
    mixed.stocks.set(slots[2]!, "item_copper_ore");
    mixed.stocks.set(slots[3]!, "item_copper_nugget");
    mixed.runtime.settle(10_000);
    expect(mixed.sampled).toEqual(full.sampled);
    expect(mixed.stocks.get(slots[3]!)).toBe("item_copper_ming");
    expect([...mixed.stocks.values()].filter(item => item === product)).toHaveLength(2);
    expect([...mixed.stocks.values()].filter(item => item === raw)).toHaveLength(20);
  });

  it("6 秒停工，18 秒复工，第 20 秒转化。读快照和重复提交均不重做边界", () => {
    let running = true;
    const { runtime, stocks, sampled, fill } = fixture(1, .2, [() => running ? "ming" : undefined]);
    fill();
    runtime.settle(6_000);
    running = false;
    runtime.settle(18_000);
    expect(runtime.snapshots(18_000)[0]).toMatchObject({ progressTimeUnits: 8000, active: false });
    running = true;
    runtime.settle(19_999);
    expect(stocks.get("out-0")).toBe(raw);
    runtime.settle(20_000);
    expect(stocks.get("out-0")).toBe(product);
    runtime.settle(22_000);
    expect(sampled).toHaveLength(1);
  });

  it("恢复或重建按世界时间进入下个边界，快进覆盖每一跳", () => {
    const { runtime, sampled } = fixture(1);
    runtime.seek(9_000);
    runtime.settle(31_000);
    expect(sampled).toHaveLength(3);
    runtime.seek(30_000);
    runtime.settle(30_000);
    expect(sampled).toHaveLength(3);
    expect(runtime.nextBoundary).toBe(40_000);
  });

  it.each([[4, 0, "ming", 4, 25], [3, 1, "heng", 1, 10], [2, 2, "heng", 2, 20], [0, 1, "hui", 1, 5]] as const)(
    "%i 明 %i 晦按边界时的 %s %i 层选 %i 格", (ming, hui, effect, layers, quota) => {
      const sources: ReadProjection[] = [...Array.from({ length: ming }, () => () => "ming" as const),
        ...Array.from({ length: hui }, () => () => "hui" as const)];
      const { runtime, sampled } = fixture(25, .2, sources);
      expect(runtime.snapshots(9999)[0]).toMatchObject({ effect, layers });
      runtime.settle(10_000);
      expect(sampled).toHaveLength(quota);
    });
});

// AI-REMOVED 2026-11-26:
// Reason: ST3-RQ-002 测试夹具及断言改为读取配方行为、独立投影口和真实工序维度。
// Trigger: 阵列四层必成、双口独立和跨读者单一配方来源的已确认需求。
// Evidence: 此文件的原有声明或消费者引用已迁入下述实现，回归清单见 ST3-RQ-002 执行日志。
// Replacement: 本文件中对应测试及 src/tests/simulation/formation-projections.test.ts
// Risk: 恢复历史逻辑会同时启用两条业务路径。
// Human Review: Required
//
// Original code:
//     programSignature: "fixture-program",
//
//     sourceIds, slotIds, conversions, ...settings,
//
//       programSignature: "fixture-program",
//
//       probability: null,
//
//       effect: "ming", layers: 1, probability: 0.2, active: true,
//
//       effect: null, layers: 0, probability: null, progressTimeUnits: 6_000, active: false,
//
//       effect: null, layers: 0, probability: null, progressTimeUnits: 6_000, active: false,
//
//       probabilities: { ming: [1], hui: [0.2], heng: [0.3] },
