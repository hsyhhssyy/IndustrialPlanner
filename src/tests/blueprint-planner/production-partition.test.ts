// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildProductionPartition, productionPartitionRegions } from "@/blueprint-planner/production-partition";
import { assertPlannerUnitCatalog, plannerUnitCount, plannerUnitStrategy, plannerUnitsCompatible } from "@/blueprint-planner/search-unit";

describe("完整生产链分层模块化", () => {
  const ids = ["1", "2", "3", "4", "5", "6", "7"];
  const edges = [["1", "3"], ["2", "3"], ["4", "6"], ["5", "6"], ["3", "7"], ["6", "7"]].map(([from, to]) => ({ from: from!, to: to! }));
  const names = (level: readonly (readonly number[])[], nodes = ids) => level.map(group => group.map(index => nodes[index]!).sort().join(",")).sort();
  it("按用户示例展开整链、两条子链与最终装配，再展开子链内部", () => {
    const { levels } = buildProductionPartition(ids, edges, 2);
    expect(names(levels[0]!)).toEqual(["1,2,3,4,5,6,7"]);
    expect(names(levels[1]!)).toEqual(["1,2,3", "4,5,6", "7"]);
    expect(names(levels[2]!)).toEqual(ids);
    for (const level of levels) expect(level.flat().sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
  it("共享上游保持唯一归属，细层模块不跨越粗层边界", () => {
    const nodes = [...ids, "shared"], graph = [...edges, { from: "shared", to: "3" }, { from: "shared", to: "6" }];
    const { levels } = buildProductionPartition(nodes, graph, 4);
    expect(names(levels[1]!, nodes)).toEqual(["1,2,3", "4,5,6", "7", "shared"]);
    for (const [index, level] of levels.entries()) {
      expect(level.flat().sort()).toEqual(nodes.map((_, index) => index));
      if (index) for (const group of level) expect(levels[index - 1]!.some(parent => group.every(node => parent.includes(node)))).toBe(true);
    }
  });
  it("回流环不能拆开；多终点与孤立设备仍完整覆盖", () => {
    const nodes = ["a", "b", "c", "d", "e", "isolated"];
    const graph = [{ from: "a", to: "b" }, { from: "b", to: "a" }, { from: "b", to: "c" }, { from: "b", to: "d" }, { from: "e", to: "d" }];
    for (const level of buildProductionPartition(nodes, graph, 5).levels) {
      expect(level.flat().sort()).toEqual([0, 1, 2, 3, 4, 5]);
      expect(level.find(group => group.includes(0))).toContain(1);
    }
  });
  it("单链不制造伪分叉，空图可处理，错误依赖立即拒绝", () => {
    expect(buildProductionPartition(["a", "b"], [{ from: "a", to: "b" }], 2).levels).toEqual([[[0, 1]], [[0, 1]], [[0, 1]]]);
    expect(buildProductionPartition([], [], 2).levels).toEqual([[]]);
    expect(() => buildProductionPartition(ids, [{ from: "missing", to: "7" }], 1)).toThrow();
    expect(() => buildProductionPartition(ids, edges, -1)).toThrow();
  });
  it("物流分流与供料终端传递依赖，不制造生产层级；辅助节点归属仍嵌套且完整", () => {
    const nodes = [...ids, "supply", "junction", "output"];
    const graph = [...edges.filter(edge => edge.from !== "1"), { from: "1", to: "junction" }, { from: "junction", to: "3" },
      { from: "supply", to: "3" }, { from: "supply", to: "6" }, { from: "7", to: "output" }];
    const { levels } = buildProductionPartition(nodes, graph, 2, new Set(ids));
    expect(levels.map(level => level.length)).toEqual([1, 3, 7]);
    expect(names(levels[1]!.map(group => group.filter(index => index < 7)))).toEqual(["1,2,3", "4,5,6", "7"]);
    expect(levels[1]!.find(group => group.includes(0))).toContain(8);
    for (const [index, level] of levels.entries()) {
      expect(level.flat().sort((a, b) => a - b)).toEqual(nodes.map((_, index) => index));
      if (index) for (const group of level) expect(levels[index - 1]!.some(parent => group.every(node => parent.includes(node)))).toBe(true);
    }
  });
  it.each([false, true])("区域在原外框内完整分配且互不重叠：转置=%s", transpose => {
    const groups = buildProductionPartition(ids, edges, 1).levels[1]!;
    const regions = productionPartitionRegions(groups, ids.map(() => ({ width: 4, height: 3 })), { width: 24, height: 18 }, transpose)!;
    expect(regions.reduce((sum, box) => sum + box.width * box.height, 0)).toBe(432);
    for (const [index, box] of regions.entries()) {
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(24); expect(box.y + box.height).toBeLessThanOrEqual(18);
      for (const other of regions.slice(index + 1)) expect(box.x >= other.x + other.width || other.x >= box.x + box.width
        || box.y >= other.y + other.height || other.y >= box.y + box.height).toBe(true);
    }
  });
  it("融合占一半组合；深度与独立布局状态可恢复，分区不改变配方/供需拓扑", () => {
    const catalog = { outputs: [0], packings: ["1"], converters: [0], reductions: [], conduits: ["shared"] as const, partitionDepths: [0, 1, 0, 2] };
    expect(plannerUnitCount(catalog)).toBe(4n);
    const strategies = Array.from({ length: 4 }, (_, cursor) => plannerUnitStrategy(catalog, "24/18/any/any", cursor, 37));
    expect(strategies.map(strategy => strategy.partitionDepth)).toEqual([0, 1, 0, 2]);
    expect(new Set(strategies.map(strategy => strategy.unitKey)).size).toBe(4);
    expect(new Set(strategies.map(strategy => strategy.matchingSeed)).size).toBe(1);
    for (const [cursor, strategy] of strategies.entries()) {
      expect(plannerUnitStrategy(JSON.parse(JSON.stringify(catalog)), "24/18/any/any", cursor, 37)).toEqual(strategy);
      expect(plannerUnitStrategy(catalog, "24/18/any/any", cursor + 4, 37)).toMatchObject({ unitKey: strategy.unitKey, partitionDepth: strategy.partitionDepth });
    }
    expect(plannerUnitsCompatible(strategies[0]!.unitKey, strategies[1]!.unitKey)).toBe(false);
    expect(() => assertPlannerUnitCatalog({ ...catalog, partitionDepths: [3] })).toThrow();
  });
  it("模块矩形容纳设备和边界接口；切分不可行时不扩大外框", () => {
    const groups = [[0], [1], [2]], sizes = groups.map(() => ({ width: 5, height: 5 }));
    expect(productionPartitionRegions(groups, sizes, { width: 10, height: 10 })).toBeNull();
    const regions = productionPartitionRegions(groups, sizes, { width: 21, height: 14 })!;
    expect(regions).toHaveLength(3);
    for (const region of regions) {
      expect(region.width).toBeGreaterThanOrEqual(7);
      expect(region.height).toBeGreaterThanOrEqual(7);
    }
    expect(regions.reduce((sum, region) => sum + region.width * region.height, 0)).toBe(294);
  });
  it("有限预算前缀覆盖全部供液拓扑，完整周期无重复遗漏且保留一半融合组合", () => {
    const catalog = { outputs: [0], packings: ["1"], converters: [0, 1], reductions: [],
      conduits: ["shared", "trunk", "local"] as const, partitionDepths: [0, 1, 0, 2] };
    const count = Number(plannerUnitCount(catalog));
    const strategies = Array.from({ length: count }, (_, cursor) => plannerUnitStrategy(catalog, "58/70/any/any", cursor, 37));
    expect(new Set(strategies.slice(0, 4).map(strategy => strategy.conduitTopology))).toEqual(new Set(catalog.conduits));
    expect(strategies.slice(0, 4).map(strategy => strategy.partitionDepth)).toEqual([0, 1, 0, 2]);
    expect(strategies[3]!.conduitTopology).toBe("local");
    expect(new Set(strategies.map(strategy => strategy.unitKey)).size).toBe(count);
    expect(strategies.filter(strategy => strategy.partitionDepth === 0)).toHaveLength(count / 2);
    for (const conduit of catalog.conduits) for (const converter of catalog.converters) {
      expect(strategies.filter(strategy => strategy.conduitTopology === conduit && strategy.converterSeed === converter)
        .map(strategy => strategy.partitionDepth).sort()).toEqual([0, 0, 1, 2]);
    }
    const original = plannerUnitStrategy({ ...catalog, partitionDepths: undefined }, "58/70/any/any", 0, 37);
    expect(strategies[0]).toEqual(original);
    for (const [cursor, strategy] of strategies.entries()) expect(plannerUnitStrategy(catalog, "58/70/any/any", cursor + count, 37))
      .toMatchObject({ unitKey: strategy.unitKey, partitionDepth: strategy.partitionDepth, conduitTopology: strategy.conduitTopology });
  });
});
