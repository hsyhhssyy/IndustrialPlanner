import { describe, expect, it } from "vitest";

import { PeriodicEnvironmentTransformation } from "@/simulation/environment/periodic-transformation";

const conversions = {
  ming: new Map([["raw", "ming-product"], ["ming-product", "secondary"]]),
  hui: new Map([["raw", "hui-product"]]),
  heng: new Map([["raw", "heng-product"]]),
};

const probabilities = {
  ming: [0.2, 0.4, 0.6, 1],
  hui: [0.2, 0.4, 0.6, 1],
  heng: [0.4, 0.8],
};

function createRegionFixture(
  samples: readonly number[],
  items = ["raw"],
  sourceIds = ["a", "b", "c", "d"],
  slotIds = ["belt"],
  settings = { periodMs: 10_000, probabilities },
) {
  const slots = new Map([["belt", items]]);
  const settledSlots: string[] = [];
  let draws = 0;
  const runtime = new PeriodicEnvironmentTransformation<string, string, string, string>({
    next() {
      const sample = samples[draws++];
      if (sample === undefined) throw new Error("发生了额外抽样");
      return sample;
    },
  }, (slotId, transformItem) => {
    settledSlots.push(slotId);
    const contents = slots.get(slotId);
    if (contents) slots.set(slotId, contents.map(transformItem));
  });
  const region = { regionId: "region", sourceIds, slotIds, conversions, ...settings };
  runtime.addRegion(region, 0);
  return { runtime, region, slots, settledSlots, draws: () => draws };
}

describe("周期区域环境转化底座", () => {
  it("运行六秒后停工十二秒，恢复四秒时仅结算一次", () => {
    const { runtime, slots, settledSlots } = createRegionFixture([0.1]);
    runtime.setSourceEffect("a", "ming", 0);
    runtime.setSourceEffect("a", null, 6_000);
    runtime.settle(18_000);
    expect(runtime.progress("region", 18_000)).toBe(6_000);
    expect(settledSlots).toEqual([]);
    runtime.setSourceEffect("b", "hui", 18_000);
    runtime.settle(21_999);
    expect(runtime.progress("region", 21_999)).toBe(9_999);
    expect(slots.get("belt")).toEqual(["raw"]);
    runtime.settle(22_000);
    runtime.settle(22_000);
    expect(runtime.progress("region", 22_000)).toBe(0);
    expect(settledSlots).toEqual(["belt"]);
    expect(slots.get("belt")).toEqual(["hui-product"]);
  });

  it("相同来源和范围拆除重建时从零计时并撤销旧周期", () => {
    const { runtime, region, settledSlots } = createRegionFixture([0.1]);
    runtime.setSourceEffect("a", "ming", 0);
    expect(runtime.progress("region", 6_000)).toBe(6_000);
    runtime.removeRegion(region.regionId);
    expect(runtime.progress("region", 6_000)).toBeUndefined();
    runtime.addRegion(region, 6_000);
    expect(runtime.progress("region", 6_000)).toBe(0);
    runtime.settle(10_000);
    runtime.settle(15_999);
    expect(settledSlots).toEqual([]);
    runtime.settle(16_000);
    expect(settledSlots).toEqual(["belt"]);
  });

  it("触发时只聚合当时运行的来源，同一物理槽内独立抽样并在下一周期重试", () => {
    const { runtime, slots, settledSlots, draws } = createRegionFixture(
      [0.39, 0.4, 0.1],
      ["raw", "raw", "unmapped"],
      ["a", "a", "b", "c", "d"],
      ["belt", "belt"],
    );
    runtime.setSourceEffect("a", "ming", 0);
    runtime.setSourceEffect("b", "ming", 0);
    runtime.setSourceEffect("c", "ming", 0);
    runtime.setSourceEffect("d", "hui", 10_000);
    runtime.settle(10_000);
    expect(settledSlots).toEqual(["belt"]);
    expect(draws()).toBe(2);
    expect(slots.get("belt")).toEqual(["heng-product", "raw", "unmapped"]);
    runtime.setSourceEffect("d", null, 20_000);
    runtime.settle(20_000);
    expect(settledSlots).toEqual(["belt", "belt"]);
    expect(draws()).toBe(3);
    expect(slots.get("belt")).toEqual(["heng-product", "ming-product", "unmapped"]);
  });

  it("重复来源只计一层，四层必成且单次触发只转换一条映射", () => {
    const { runtime, slots, draws } = createRegionFixture(
      [0.2],
      ["raw"],
      ["a", "a", "b", "c", "d"],
    );
    runtime.setSourceEffect("a", "ming", 0);
    runtime.settle(10_000);
    expect(slots.get("belt")).toEqual(["raw"]);
    expect(draws()).toBe(1);
    runtime.setSourceEffect("b", "ming", 10_001);
    runtime.setSourceEffect("c", "ming", 10_001);
    runtime.setSourceEffect("d", "ming", 10_001);
    runtime.settle(20_000);
    expect(slots.get("belt")).toEqual(["ming-product"]);
    expect(draws()).toBe(1);
  });

  it("两明两晦按两层衡结算，并读取触发时槽中的物品", () => {
    const { runtime, slots, draws } = createRegionFixture([0.79, 0.8]);
    runtime.setSourceEffect("a", "ming", 0);
    runtime.setSourceEffect("b", "hui", 0);
    runtime.setSourceEffect("c", "ming", 0);
    runtime.setSourceEffect("d", "hui", 0);
    slots.set("outside", slots.get("belt")!);
    slots.set("belt", ["raw", "raw"]);
    runtime.settle(10_000);
    expect(slots.get("belt")).toEqual(["heng-product", "raw"]);
    expect(slots.get("outside")).toEqual(["raw"]);
    expect(draws()).toBe(2);
  });

  it.each([
    ["ming", 2, 0.4, "ming-product"],
    ["ming", 3, 0.6, "ming-product"],
    ["hui", 2, 0.4, "hui-product"],
    ["hui", 3, 0.6, "hui-product"],
  ] as const)("%s 的 %s 层使用对应的概率", (effect, layers, threshold, product) => {
    const sourceIds = ["a", "b", "c"].slice(0, layers);
    const { runtime, slots } = createRegionFixture([threshold - 0.01, threshold], ["raw", "raw"], sourceIds);
    for (const sourceId of sourceIds) runtime.setSourceEffect(sourceId, effect, 0);
    runtime.settle(10_000);
    expect(slots.get("belt")).toEqual([product, "raw"]);
  });

  it("按区域声明的周期和概率结算", () => {
    const { runtime, region, slots, draws } = createRegionFixture(
      [0.64, 0.65], ["raw", "raw"], ["a"], ["belt"],
      { periodMs: 3_500, probabilities: { ming: [0.65], hui: [0.4], heng: [0.15] } },
    );
    slots.set("other-belt", ["raw"]);
    runtime.addRegion({
      ...region,
      regionId: "other-region",
      slotIds: ["other-belt"],
      periodMs: 4_000,
      probabilities: { ming: [1], hui: [0.2], heng: [0.3] },
    }, 0);
    runtime.setSourceEffect("a", "ming", 0);
    expect(runtime.nextDueTimeMs()).toBe(3_500);
    runtime.settle(3_499);
    expect(draws()).toBe(0);
    runtime.settle(3_500);
    expect(slots.get("belt")).toEqual(["ming-product", "raw"]);
    expect(slots.get("other-belt")).toEqual(["raw"]);
    expect(runtime.nextDueTimeMs()).toBe(4_000);
    runtime.settle(4_000);
    expect(slots.get("other-belt")).toEqual(["ming-product"]);
    expect(runtime.nextDueTimeMs()).toBe(7_000);
    expect(draws()).toBe(2);
  });
});
