import { describe, expect, it } from "vitest";
import { assertPlannerDimensionSchedule, partitionPlannerDimensions, plannerDimensionUnitCursor, PLANNER_DIMENSION_ATTEMPTS } from "@/blueprint-planner/dimension-schedule";

describe("用户设计的包围盒尺寸分片", () => {
// AI-REMOVED 2026-10-26:
// Reason: 撤下 beta1 之后加入的包含前沿补点与大外框优先策略专用断言。
// Trigger: 用户确认恢复 beta1/2 搜索策略，保留业务与物理正确性修复。
// Evidence: 原代码 SHA256 84f56769bbb9055d9eb5dadb71423450785a337c58b3ce92c223b4fca3bec19b；beta1 dimension-schedule/compact-layout 活动策略。
// Replacement: 保留的尺寸唯一归属、整数前沿、游标恢复和几何/CPU/GPU 正确性用例。
// Risk: 对应后续搜索策略不再执行；不改变物料、供电和产率验收。
// Human Review: Required
// Original code:
//
//   // 2026-10-21：v52 的 900 批针剂未派发 16×30；包含当前面积的前沿漏掉同宽严格缩边。
//   it("允许同面积时仍覆盖严格缩小的相邻整数前沿，并可唯一归属及恢复", () => {
//     const minimum = { width: 5, height: 5 };
//     for (const warehousePorts of [undefined, { pickupLength: 16, storageLength: 3, fixedStorageCount: 0, automatic: [] }]) {
//       const dimensions = partitionPlannerDimensions(496, minimum, warehousePorts, true);
//       expect(dimensions.flat()).toEqual(expect.arrayContaining([
//         expect.objectContaining({ width: 16, height: 31, area: 496 }),
//         expect.objectContaining({ width: 16, height: 30, area: 480 }),
//       ]));
//       const keys = dimensions.flat().map(value => `${value.width}/${value.height}/${value.warehouseSide ?? "any"}/${value.storageCount ?? "any"}`);
//       expect(new Set(keys).size).toBe(keys.length);
//       expect(() => assertPlannerDimensionSchedule({ generation: 1, targetArea: 496, minimum, warehousePorts,
//         inclusive: true, attemptsPerTask: PLANNER_DIMENSION_ATTEMPTS },
//       dimensions.map(list => ({ dimensions: list, dimensionCursor: 0 })))).not.toThrow();
//     }
//   });

// AI-REMOVED 2026-10-26:
// Reason: 撤下 beta1 之后加入的包含前沿补点与大外框优先策略专用断言。
// Trigger: 用户确认恢复 beta1/2 搜索策略，保留业务与物理正确性修复。
// Evidence: 原代码 SHA256 cd9f4f46bc2823d795476929ffe227740a28fd12e5d1efd89e04ffd9917748db；beta1 dimension-schedule/compact-layout 活动策略。
// Replacement: 保留的尺寸唯一归属、整数前沿、游标恢复和几何/CPU/GPU 正确性用例。
// Risk: 对应后续搜索策略不再执行；不改变物料、供电和产率验收。
// Human Review: Required
// Original code:
//
//
//   it("相同权重先分配大外框，不让 70 格边长截断造成的小面积抢占首轮", () => {
//     const shards = partitionPlannerDimensions(4900, { width: 5, height: 5 }, undefined, true);
//     expect(shards[0]![0]).toMatchObject({ width: 70, height: 70, area: 4900 });
//     const first = shards.map(shard => shard[0]!);
//     for (let i = 1; i < first.length; i++) expect(first[i]!.area).toBeLessThanOrEqual(first[i - 1]!.area);
//     expect(new Set(shards.flat().map(value => value.width)).size).toBe(66);
//   });


  it("枚举严格小于当前面积的不可扩张前沿，以搜索单元唯一分片，权重始终为正", () => {
    const shards = partitionPlannerDimensions(400, { width: 3, height: 3 });
    const dimensions = shards.flat();
    expect(shards).toHaveLength(32);
    expect(dimensions).toHaveLength(32);
    expect(new Set(dimensions.map(value => `${value.width}/${value.height}`)).size).toBe(30);
    for (const value of dimensions) {
      expect(value.height).toBe(Math.min(70, Math.floor(399 / value.width)));
      expect(value.width === 70 || (value.width + 1) * value.height > 399).toBe(true);
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

  it("单一外框以独立单元补足全部分片；无可用外框时不制造尺寸", () => {
    expect(partitionPlannerDimensions(10, { width: 3, height: 3 }).filter(list => list.length)).toEqual(
      Array.from({ length: 32 }, () => [{ width: 3, height: 3, area: 9, weight: 1 }]),
    );
    expect(partitionPlannerDimensions(9, { width: 3, height: 3 })).toEqual(Array.from({ length: 32 }, () => []));
  });

  it("人工设备群允许整体旋转时保留完整跨度，排除伪可行方框并保存分片约束", () => {
    const manualSpans = [{ width: 37, height: 22 }, { width: 22, height: 37 }];
    const schedule = { generation: 0, targetArea: 1036, minimum: { width: 22, height: 22 }, manualSpans,
      inclusive: true, attemptsPerTask: PLANNER_DIMENSION_ATTEMPTS };
    const shards = partitionPlannerDimensions(1036, schedule.minimum, undefined, true, 0, undefined, manualSpans);
    const shapes = shards.flat();
    expect(shards.every(shard => shard.length > 0)).toBe(true);
    expect(shapes.some(shape => shape.width === 32 && shape.height === 32)).toBe(false);
    expect(shapes.some(shape => shape.width === 37 && shape.height === 28)).toBe(true);
    expect(shapes.some(shape => shape.width === 28 && shape.height === 37)).toBe(true);
    for (const shape of shapes) expect(Math.max(shape.width, shape.height)).toBeGreaterThanOrEqual(37);
    for (let width = 22; width <= 47; width++) for (let height = 22; height <= 47; height++) {
      if (width * height <= 1036 && Math.max(width, height) >= 37) {
        expect(shapes.some(shape => shape.width >= width && shape.height >= height)).toBe(true);
      }
    }
    expect(() => assertPlannerDimensionSchedule(JSON.parse(JSON.stringify(schedule)),
      shards.map(dimensions => ({ dimensions, dimensionCursor: 0 })))).not.toThrow();
  });

  it("JSON 往返保存外框及单元归属，拒绝篡改分配、遗漏、零权重和非法游标", () => {
    const schedule = { generation: 2, targetArea: 400, minimum: { width: 3, height: 3 }, attemptsPerTask: PLANNER_DIMENSION_ATTEMPTS };
    const shards = partitionPlannerDimensions(400, schedule.minimum).map(dimensions => ({ dimensions, dimensionCursor: dimensions.length - 1 }));
    expect(() => assertPlannerDimensionSchedule(schedule, JSON.parse(JSON.stringify(shards)))).not.toThrow();
    for (const corrupt of [
      (copy: typeof shards) => { copy[1]!.dimensions[0] = { ...copy[0]!.dimensions[0]!, width: 71 }; },
      (copy: typeof shards) => { copy[0]!.dimensions.pop(); },
      (copy: typeof shards) => { copy[0]!.dimensions[0] = { ...copy[0]!.dimensions[0]!, weight: 0 }; },
      (copy: typeof shards) => { copy[0]!.dimensionCursor = copy[0]!.dimensions.length; },
    ]) {
      const copy = structuredClone(shards);
      corrupt(copy);
      expect(() => assertPlannerDimensionSchedule(schedule, copy)).toThrow();
    }
  });

  // AI-REMOVED 2026-11-05:
  // Reason: 不可扩张前沿方案破坏既有并发/轮转契约，撤回对应专用断言。
  // Trigger: global-rescheduling.test.ts 四项回归失败。
  // Evidence: .temp/full-check/runs/20261105-115130-111537/test.log。
  // Replacement: 上方完整尺寸唯一归属和恢复断言；全局重调度测试保持原样。
  // Risk: 保留原调度的低效尺寸。Human Review: Required
  // Original code:
  //   it.each([399, 1297, 2844, 4108, 4900])("面积 %i 的自由前沿覆盖所有可行整数盒子，且保留的盒子不能再扩张", area => {
  //     const minimum = { width: 5, height: 5 };
  //     const dimensions = partitionPlannerDimensions(area, minimum, undefined, true).flat();
  //     for (let width = minimum.width; width <= 70; width++) {
  //       for (let height = minimum.height; height <= 70; height++) {
  //         if (width * height > area) continue;
  //         expect(dimensions.some(shape => shape.width >= width && shape.height >= height)).toBe(true);
  //       }
  //     }
  //     for (const shape of dimensions) {
  //       expect(shape.width === 70 || (shape.width + 1) * shape.height > area).toBe(true);
  //       expect(shape.height === 70 || shape.width * (shape.height + 1) > area).toBe(true);
  //     }
  //     if (area === 4900) expect(dimensions).toEqual([{ width: 70, height: 70, area: 4900, weight: 1 }]);
  //   });


  it("整边仓库模式保留各指定边，不用自由外框包含关系合并", () => {
    const warehousePorts = { pickupLength: 16, storageLength: 3, fixedStorageCount: 0, automatic: [] };
    const dimensions = partitionPlannerDimensions(4900, { width: 5, height: 5 }, warehousePorts, true).flat();
    expect(dimensions).toHaveLength(32);
    expect(new Set(dimensions.map(shape => shape.warehouseSide))).toEqual(new Set([0, 1, 2, 3]));
    for (const shape of dimensions) expect([shape.width, shape.height].sort((a, b) => a - b)).toEqual([16, 70]);
  });

  it.each([9, 150, 399, 1297, 2844, 4108, 4900])("面积 %i 的联合分片保持几何覆盖，并在重复轮次中无重复或遗漏单元", area => {
    const minimum = { width: area < 100 ? 3 : 5, height: area < 100 ? 3 : 5 };
    const shards = partitionPlannerDimensions(area, minimum, undefined, true).map(dimensions => ({ dimensions }));
    const shapes = new Map(shards.flatMap(shard => shard.dimensions).map(shape => [`${shape.width}/${shape.height}`, shape]));
    expect(shards.every(shard => shard.dimensions.length > 0)).toBe(true);
    for (let width = minimum.width; width <= 70; width++) for (let height = minimum.height; height <= 70; height++) {
      if (width * height <= area) expect([...shapes.values()].some(shape => shape.width >= width && shape.height >= height)).toBe(true);
    }
    for (const shape of shapes.values()) {
      const cursors = shards.flatMap((shard, index) => shard.dimensions.some(value => value.width === shape.width && value.height === shape.height)
        ? Array.from({ length: 10 }, (_, round) => plannerDimensionUnitCursor(shards, index, shape, round)) : []).sort((a, b) => a - b);
      expect(cursors).toEqual(Array.from({ length: cursors.length }, (_, index) => index));
    }
    const copy = JSON.parse(JSON.stringify(shards)) as typeof shards;
    const dimension = shards[0]!.dimensions[0]!;
    expect(plannerDimensionUnitCursor(copy, 0, dimension, 7)).toBe(plannerDimensionUnitCursor(shards, 0, dimension, 7));
    expect(() => plannerDimensionUnitCursor(shards, -1, dimension, 0)).toThrow("归属或游标");
    expect(() => plannerDimensionUnitCursor(shards, 0, dimension, -1)).toThrow("归属或游标");
  });

});
