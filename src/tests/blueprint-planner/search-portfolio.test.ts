// @vitest-environment node

import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { capturePlannerSeed } from "@/blueprint-planner/search-seed";
import { PlannerSearchPortfolio } from "@/blueprint-planner/search-portfolio";
import { assertPlannerOutline, initialPlannerOutline, breadthOutlines, continuationOutline } from "@/blueprint-planner/search-outline";
import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
import { PlannerCandidateError } from "@/blueprint-planner/model";
import yazhen from "./fixtures/yazhen-syringe.json";

it("全局最优重调度替换旧主种子，重置续搜机会并保留其他输出拓扑", () => {
  const registry = createRegistryContract();
  const request = structuredClone(yazhen.request) as BlueprintPlannerRequest;
  const auto = { ...request, options: { ...request.options, solidOutput: "auto" as const } };
  const stash = { ...request, options: { ...request.options, solidOutput: "stash" as const } };
  const warehouse = { ...request, options: { ...request.options, solidOutput: "warehouse" as const } };
  const old = capturePlannerSeed(stash, createProductionNetwork(registry, stash), [], [], 24, 22);
  const other = capturePlannerSeed(warehouse, createProductionNetwork(registry, warehouse), [], [], 22, 24);
  const pool = new PlannerSearchPortfolio(auto, old);
  pool.remember(other);
  for (let i = 0; i < 20; i++) pool.next(i);
  const best = { ...old, width: 24, height: 12 };
  pool.restart(best);
  expect(pool.next(0).seed).toBe(best);
  expect(pool.next(1).seed).toBe(other);
  expect(pool.snapshot().pools.every(entry => entry.attemptsWithoutImprovement <= 1)).toBe(true);

  // 同面积、同摆位但线路不同的全局改善不能被旧种子去重吞掉。
  const improved = structuredClone(best);
  pool.restart(improved);
  expect(pool.next(0).seed).toBe(improved);
  expect(pool.next(2).continuationStep).toBe(1);
});

it("旧分片和独立重启统一使用全局面积上限，均能领取 19×15", () => {
  const registry = createRegistryContract();
  const request = structuredClone(yazhen.request) as BlueprintPlannerRequest;
  const seed = capturePlannerSeed(request, createProductionNetwork(registry, request), [], [], 24, 22);
  const pool = new PlannerSearchPortfolio(request, seed);
  for (const variant of [0, 3, 4, 7]) {
    const selection = pool.next(variant, true, { area: 288, outputStashCount: 1 });
    expect(selection.maximumArea).toBe(287);
    expect(breadthOutlines(selection.maximumArea!, { width: 5, height: 5 })).toContainEqual({ width: 19, height: 15 });
  }
  expect(pool.next(3, true, { area: 288, outputStashCount: 2 }).maximumArea).toBe(288);
});

it("初排以设备面积两倍为目标，整数取整及各次重启均不超过 70 格", () => {
  expect(initialPlannerOutline(200, { width: 5, height: 5 }, 0)).toEqual({ width: 20, height: 20 });
  for (const area of [9, 75, 200, 2500, 4900]) for (let variant = 0; variant < 18; variant++) {
    const shape = initialPlannerOutline(area, { width: 1, height: 1 }, variant);
    expect(() => assertPlannerOutline(shape)).not.toThrow();
    expect(shape.width * shape.height).toBeGreaterThanOrEqual(area);
    if (variant < 3) expect(shape.width * shape.height).toBeLessThanOrEqual(area * 2);
  }
  expect(() => initialPlannerOutline(4901, { width: 1, height: 1 }, 0)).toThrow("70×70");
  expect(() => initialPlannerOutline(200, { width: 71, height: 1 }, 0)).toThrow("70×70");
});

it("广度、续搜和显式尺寸逐边遵守 70 格，不能仅检查 4900 格总面积", () => {
  for (const shape of breadthOutlines(10000, { width: 1, height: 1 })) {
    expect(shape.width).toBeLessThanOrEqual(70);
    expect(shape.height).toBeLessThanOrEqual(70);
  }
  for (let step = 0; step < 12; step++) {
    const shape = continuationOutline({ width: 100, height: 49 }, step, step);
    expect(() => assertPlannerOutline(shape)).not.toThrow();
  }
  expect(() => assertPlannerOutline({ width: 70, height: 70 })).not.toThrow();
  for (const shape of [{ width: 71, height: 60 }, { width: 60, height: 71 }, { width: 0, height: 70 }]) {
    expect(() => assertPlannerOutline(shape)).toThrow("70");
  }
});

it("停滞续搜可交换长宽空间，但总面积、固定设施和显式边界保持约束", () => {
  const seed = { width: 20, height: 20 };
  expect(continuationOutline(seed, 1, 0)).toEqual({ width: 19, height: 20 });
  expect(continuationOutline(seed, 2, 1)).toEqual({ width: 20, height: 19 });
  const shapes = Array.from({ length: 16 }, (_, i) => continuationOutline(seed, i, i + 2));
  expect(shapes).toContainEqual({ width: 21, height: 19 });
  expect(shapes).toContainEqual({ width: 18, height: 22 });
  expect(shapes.every(shape => shape.width * shape.height < 400)).toBe(true);
  for (let i = 2; i < 18; i++) {
    const shape = continuationOutline(seed, i, i, { width: 10, height: 18 }, { width: 21, height: 23 });
    expect(shape.width).toBeGreaterThanOrEqual(10);
    expect(shape.height).toBeGreaterThanOrEqual(18);
    expect(shape.width).toBeLessThanOrEqual(21);
    expect(shape.height).toBeLessThanOrEqual(23);
    expect(shape.width * shape.height).toBeLessThan(400);
  }
});

it("面积前沿先覆盖不同长宽比，跳过固定设施无法容纳的尺寸", () => {
  const shapes = breadthOutlines(399, { width: 10, height: 12 }, { width: 28, height: 30 });
  const widths = shapes.map(shape => shape.width);
  expect(new Set(widths).size).toBe(widths.length);
  expect(widths.slice(0, 4).every((width, index) => widths.slice(0, index).every(other => other !== width))).toBe(true);
  expect(Math.max(...widths.slice(0, 4)) - Math.min(...widths.slice(0, 4))).toBeGreaterThan(10);
  expect(shapes.every(shape => shape.width >= 10 && shape.height >= 12
    && shape.width <= 28 && shape.height <= 30 && shape.width * shape.height <= 399)).toBe(true);
  expect(new Set(widths)).toEqual(new Set(Array.from({ length: 19 }, (_, index) => index + 10)));
});

// AI-REMOVED 2026-10-10:
// Reason: 旧用例验证可跨分片借用的临时选择器；新设计要求永久唯一归属并通过保存的游标恢复。
// Trigger: 用户要求固定尺寸唯一归属 32 分片、跨领取轮转和验收后统一切换。
// Evidence: 旧调度每次临时选尺寸，旧任务回写可能覆盖新游标。
// Replacement: dimension-schedule.test.ts 与 global-rescheduling.test.ts
// Risk: 调度顺序与历史任务恢复语义变化；由分片及 Host 回归覆盖。
// Human Review: Required
// Original code:
// it("并发领取不重复占用同拓扑尺寸，恢复后优先访问较少的比例", () => {
//   const shapes = breadthOutlines(399, { width: 10, height: 12 }, { width: 28, height: 30 });
//   const visits = new Map<string, number>(), occupied = new Set<string>();
//   const count = (key: string) => visits.get(key) ?? 0;
//   const first = selectBreadthOutline(shapes, "stash", count, occupied)!;
//   occupied.add(breadthOutlineKey("stash", first));
//   const second = selectBreadthOutline(shapes, "stash", count, occupied)!;
//   expect(second).not.toEqual(first);
//   occupied.clear();
//   visits.set(breadthOutlineKey("stash", first), 1);
//   expect(selectBreadthOutline(shapes, "stash", count, occupied)).toEqual(second);
//   for (const index of [0, 1]) {
//     const assigned = selectBreadthOutline(shapes, "warehouse", count, occupied, { count: 2, index })!;
//     expect(assigned.width % 2).toBe(index);
//   }
//   const partitioned = shapes.slice(0, 2);
//   const owned = selectBreadthOutline(partitioned, "warehouse", count, occupied,
//     { count: 2, index: partitioned[0]!.width % 2 })!;
//   occupied.add(breadthOutlineKey("warehouse", owned));
//   expect(selectBreadthOutline(partitioned, "warehouse", count, occupied,
//     { count: 2, index: owned.width % 2 })).toEqual(partitioned.find(shape => shape.width !== owned.width));
// });
//
it("布局池保留同面积的不同摆位、去重、限制容量并在改善后恢复最优分支", () => {
  // 此用例只验证池的纯数据调度契约；生产可行性由调用方真实验收，另有 Worker 集成测试覆盖。
  const request = structuredClone(yazhen.request) as BlueprintPlannerRequest;
  const seed = capturePlannerSeed(request, createProductionNetwork(createRegistryContract(), request), [], [], 20, 20);
  const original = JSON.stringify(seed);
  const pool = new PlannerSearchPortfolio(request, seed);
  pool.remember(structuredClone(seed));
  expect(pool.next(0).seed).toBe(seed);
  expect(pool.next(1).continuationStep).toBe(1);
  for (let i = 1; i < 7; i++) {
    const other = structuredClone(seed);
    other.network.nodes[i]!.entity.position = { ...other.network.nodes[i]!.entity.position, x: i };
    pool.remember(other);
  }
  const selections = Array.from({ length: 40 }, (_, i) => pool.next(i + 2)).filter(item => item.seed);
  const retained = new Set(selections.map(item => item.seed));
  expect(retained.size).toBe(4);
  expect(retained.has(seed)).toBe(true);
  expect(selections.filter(item => item.seed === seed).length).toBeGreaterThan(selections.length / 2);
  expect(selections.some(item => item.continuationStep! >= 2)).toBe(true);
  expect(pool.next(43).seed).toBeUndefined();
  expect(pool.next(44, false).seed).toBeUndefined();
  const improved = { ...structuredClone(seed), width: 19 };
  pool.remember(improved);
  expect(pool.next(44)).toMatchObject({ seed: improved, continuationStep: 0 });
  expect(JSON.stringify(seed)).toBe(original);
});

it("全局面积上限覆盖备用布局、独立重启及自动输出的另一种拓扑", () => {
  const registry = createRegistryContract();
  const request = structuredClone(yazhen.request) as BlueprintPlannerRequest;
  const stash = capturePlannerSeed(request, createProductionNetwork(registry, request), [], [], 17, 23);
  const auto = { ...request, options: { ...request.options, solidOutput: "auto" as const } };
  const pool = new PlannerSearchPortfolio(auto, stash);
  const warehouse = { ...request, options: { ...request.options, solidOutput: "warehouse" as const } };
  const other = capturePlannerSeed(warehouse, createProductionNetwork(registry, warehouse), [], [], 20, 20);
  pool.remember(other);
  for (let variant = 0; variant < 40; variant++) {
    const next = pool.next(variant);
    expect(next.maximumArea).toBe(390);
    const box = continuationOutline(next.seed ?? { width: 27, height: 29 }, variant,
      next.continuationStep ?? variant + 2, { width: 5, height: 10 }, undefined, next.maximumArea);
    expect(box.width * box.height).toBeLessThan(391);
  }
  expect(pool.next(0, false).maximumArea).toBeUndefined();
  expect(() => continuationOutline(stash, 0, 0, { width: 20, height: 20 }, undefined, 390)).toThrow("面积上限");
  expect(() => continuationOutline(stash, 0, 0, { width: 20, height: 20 }, undefined, 390)).toThrow(PlannerCandidateError);
});

it("真实 Worker 中新增固定存取口也不能撑破全局面积上限", async () => {
  const client = new NodePlannerClient();
  try {
    for (const strategy of ["baseline", "compact"] as const) {
      const statistics = await client.build(structuredClone(yazhen.request) as BlueprintPlannerRequest, 7, 30_000,
        { strategy, maximumArea: 440, maxEvaluations: 7 }).then(candidate => candidate.search, (error: unknown) => {
        expect(error).toBeInstanceOf(PlannerCandidateError);
        return (error as PlannerCandidateError).search!;
      });
      expect(statistics.evaluations).toBeLessThanOrEqual(7);
      expect(statistics.maximumArea).toBe(440);
      expect(statistics.outline.width * statistics.outline.height).toBeLessThanOrEqual(440);
      expect(statistics.experiments).toEqual(strategy === "compact" ? ["power-dedup", "partial-rebuild"] : ["power-dedup"]);
    }
  } finally { await client.dispose(); }
}, 40_000);

it("真实 Worker 按调度器指定的宽高建立搜索盒子", async () => {
  const client = new NodePlannerClient();
  const targetOutline = { width: 20, height: 20 };
  try {
    const statistics = await client.build(structuredClone(yazhen.request) as BlueprintPlannerRequest, 7, 30_000,
      { strategy: "compact", maximumArea: 440, targetOutline, maxEvaluations: 7 })
      .then(candidate => candidate.search, (error: unknown) => {
        expect(error).toBeInstanceOf(PlannerCandidateError);
        return (error as PlannerCandidateError).search!;
      });
    expect(statistics.outline).toEqual(targetOutline);
    expect(statistics.evaluations).toBeLessThanOrEqual(7);
  } finally { await client.dispose(); }
}, 40_000);
