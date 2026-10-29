// @vitest-environment node
import { describe, expect, it } from "vitest";
import { plannerUnitCount, plannerUnitQuota, plannerUnitStrategy, assertPlannerUnitCatalog, plannerUnitsCompatible } from "@/blueprint-planner/search-unit";

describe("尺寸×设备×拓扑的独立调度", () => {
  const catalog = { outputs: [0, 1], packings: ["2", "2"], converters: [0, 2], reductions: [], conduits: ["shared", "local"] as const };
  it("完整覆盖离散组合，每一轮布局变化但结构决策不变，JSON 恢复不重抽", () => {
    const count = Number(plannerUnitCount(catalog)), keys = new Set<string>();
    expect(count).toBe(16);
    for (let cursor = 0; cursor < count; cursor++) {
      const first = plannerUnitStrategy(catalog, "20/30/any/any", cursor, 17);
      const second = plannerUnitStrategy(catalog, "20/30/any/any", cursor + count, 17);
      keys.add(first.unitKey!);
      expect(second).toMatchObject({ unitKey: first.unitKey, outputSeed: first.outputSeed, converterSeed: first.converterSeed,
        packingSeed: first.packingSeed, conduitTopology: first.conduitTopology, matchingSeed: first.matchingSeed });
      expect(second.layoutSeed).not.toBe(first.layoutSeed);
      expect(plannerUnitStrategy(JSON.parse(JSON.stringify(catalog)), "20/30/any/any", cursor, 17)).toEqual(first);
    }
    expect(keys.size).toBe(count);
  });
  it("原图减量集合独立进入设备轴，大于 32 位的组合数无需预先展开", () => {
    const reduced = { ...catalog, reductions: ["a", "b"] };
    const seen = new Set(Array.from({ length: 4 }, (_, cursor) => JSON.stringify(plannerUnitStrategy(reduced, "20/30/any/any", cursor, 17).unitReduction)));
    expect(seen.size).toBe(4);
    expect(plannerUnitCount({ ...catalog, reductions: Array.from({ length: 60 }, (_, index) => `source-${index}`) })).toBe(16n << 60n);
  });
  it("每个组合独享 X，不分摊拓扑额度；小于 X 的尾额保留，中断仅领取未完成部分", () => {
    expect(plannerUnitQuota(60_000, 20_000)).toBe(20_000);
    expect(plannerUnitQuota(40_000, 20_000)).toBe(20_000);
    expect(plannerUnitQuota(20_000, 20_000)).toBe(20_000);
    expect(plannerUnitQuota(19_999, 20_000)).toBe(0);
    expect(plannerUnitQuota(15_000, 20_000, 5_000)).toBe(15_000);
    expect(plannerUnitQuota(14_999, 20_000, 5_000)).toBe(0);
    expect(() => plannerUnitQuota(20_000, 20_000, 20_000)).toThrow();
  });
  it("不重复目录项，不能跨设备或拓扑复用种子；兼容组合允许跨尺寸复用", () => {
    expect(() => assertPlannerUnitCatalog(catalog)).not.toThrow();
    expect(() => assertPlannerUnitCatalog({ ...catalog, converters: [0, 0] })).toThrow();
    const first = plannerUnitStrategy(catalog, "20/30/any/any", 0, 17);
    const otherSize = plannerUnitStrategy(catalog, "21/28/any/any", 0, 17);
    const otherTopology = plannerUnitStrategy(catalog, "20/30/any/any", 1, 17);
    expect(plannerUnitsCompatible(first.unitKey, otherSize.unitKey)).toBe(true);
    expect(plannerUnitsCompatible(first.unitKey, otherTopology.unitKey)).toBe(false);
    expect(plannerUnitsCompatible(undefined, first.unitKey)).toBe(false);
  });
});
