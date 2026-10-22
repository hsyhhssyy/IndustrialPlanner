import { describe, expect, it } from "vitest";
import { assertPlannerDimensionSchedule, partitionPlannerDimensions, PLANNER_DIMENSION_ATTEMPTS } from "@/blueprint-planner/dimension-schedule";

describe("用户设计的包围盒尺寸分片", () => {
  // 2026-10-21：v52 的 900 批针剂未派发 16×30；包含当前面积的前沿漏掉同宽严格缩边。
  it("允许同面积时仍覆盖严格缩小的相邻整数前沿，并可唯一归属及恢复", () => {
    const minimum = { width: 5, height: 5 };
    for (const warehousePorts of [undefined, { pickupLength: 16, storageLength: 3, fixedStorageCount: 0, automatic: [] }]) {
      const dimensions = partitionPlannerDimensions(496, minimum, warehousePorts, true);
      expect(dimensions.flat()).toEqual(expect.arrayContaining([
        expect.objectContaining({ width: 16, height: 31, area: 496 }),
        expect.objectContaining({ width: 16, height: 30, area: 480 }),
      ]));
      const keys = dimensions.flat().map(value => `${value.width}/${value.height}/${value.warehouseSide ?? "any"}/${value.storageCount ?? "any"}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(() => assertPlannerDimensionSchedule({ generation: 1, targetArea: 496, minimum, warehousePorts,
        inclusive: true, attemptsPerTask: PLANNER_DIMENSION_ATTEMPTS },
      dimensions.map(list => ({ dimensions: list, dimensionCursor: 0 })))).not.toThrow();
    }
  });

  it("相同权重先分配大外框，不让 70 格边长截断造成的小面积抢占首轮", () => {
    const shards = partitionPlannerDimensions(4900, { width: 5, height: 5 }, undefined, true);
    expect(shards[0]![0]).toMatchObject({ width: 70, height: 70, area: 4900 });
    const first = shards.map(shard => shard[0]!);
    for (let i = 1; i < first.length; i++) expect(first[i]!.area).toBeLessThanOrEqual(first[i - 1]!.area);
    expect(new Set(shards.flat().map(value => value.width)).size).toBe(66);
  });

  it("完整枚举严格小于当前面积的整数前沿，每个尺寸唯一归属，权重始终为正", () => {
    const shards = partitionPlannerDimensions(400, { width: 3, height: 3 });
    const dimensions = shards.flat();
    expect(shards).toHaveLength(32);
    expect(dimensions).toHaveLength(68);
    expect(new Set(dimensions.map(value => `${value.width}/${value.height}`)).size).toBe(dimensions.length);
    for (const value of dimensions) {
      expect(value.height).toBe(Math.min(70, Math.floor(399 / value.width)));
      expect(value.area).toBe(value.width * value.height);
      expect(value.area).toBeLessThan(400);
      expect(value.weight).toBeGreaterThan(0);
      if (Math.max(value.width, value.height) <= 2 * Math.min(value.width, value.height)) expect(value.weight).toBe(1);
    }
    expect(dimensions).toEqual(expect.arrayContaining([
      { width: 19, height: 21, area: 399, weight: 1 },
      { width: 21, height: 19, area: 399, weight: 1 },
    ]));
    const weights = shards.map(list => list.reduce((sum, dimension) => sum + dimension.weight, 0));
    expect(Math.max(...weights) - Math.min(...weights)).toBeLessThanOrEqual(1);
    expect(partitionPlannerDimensions(400, { width: 3, height: 3 })).toEqual(shards);
  });

  it("尺寸不足时允许空分片；全部为空时不制造尺寸", () => {
    expect(partitionPlannerDimensions(10, { width: 3, height: 3 }).filter(list => list.length)).toEqual([
      [{ width: 3, height: 3, area: 9, weight: 1 }],
    ]);
    expect(partitionPlannerDimensions(9, { width: 3, height: 3 })).toEqual(Array.from({ length: 32 }, () => []));
  });

  it("JSON 往返保存顺序与游标，拒绝重复归属、遗漏、零权重和非法游标", () => {
    const schedule = { generation: 2, targetArea: 400, minimum: { width: 3, height: 3 }, attemptsPerTask: PLANNER_DIMENSION_ATTEMPTS };
    const shards = partitionPlannerDimensions(400, schedule.minimum).map(dimensions => ({ dimensions, dimensionCursor: dimensions.length - 1 }));
    expect(() => assertPlannerDimensionSchedule(schedule, JSON.parse(JSON.stringify(shards)))).not.toThrow();
    for (const corrupt of [
      (copy: typeof shards) => { copy[1]!.dimensions[0] = copy[0]!.dimensions[0]!; },
      (copy: typeof shards) => { copy[0]!.dimensions.pop(); },
      (copy: typeof shards) => { copy[0]!.dimensions[0] = { ...copy[0]!.dimensions[0]!, weight: 0 }; },
      (copy: typeof shards) => { copy[0]!.dimensionCursor = copy[0]!.dimensions.length; },
    ]) {
      const copy = structuredClone(shards);
      corrupt(copy);
      expect(() => assertPlannerDimensionSchedule(schedule, copy)).toThrow();
    }
  });
});
