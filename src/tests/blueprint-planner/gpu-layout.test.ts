// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { PlannerGpuLayout } from "@/blueprint-planner/gpu-layout";
import { plannerLayoutBatchSize, type PlannerLayoutBackend, type PlannerLayoutBatch } from "@/blueprint-planner/layout-backend";
import { createPlainNode } from "@/blueprint-planner/placement";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import fixture from "./fixtures/yazhen-syringe.json";

function layout(backend: PlannerLayoutBackend, seed = 0) {
  const registry = createRegistryContract();
  const node = createPlainNode(registry, "belt_straight_1x1", "moving", "logistics");
  node.entity.position = { x: -2, y: -2 };
  const statistics: PlannerSearchStatistics = { seed, evaluationLimit: 100, evaluations: 0, acceptedMoves: 0,
    routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: { width: 4, height: 4 } };
  const search = new CompactLayoutSearch(registry, { request: structuredClone(fixture.request) as BlueprintPlannerRequest,
    nodes: [node], slotLinks: [], initialSlots: [], preferredGasCount: 0 }, [], statistics, undefined, backend);
  return { node, statistics, search };
}

it("批次不超次数预算，小预算和超能力布局由 CPU 承担", () => {
  for (let budget = 32; budget <= 20_000; budget += 97) {
    const batch = plannerLayoutBatchSize(24, 324, budget)!;
    expect(batch.chains * batch.steps).toBeLessThanOrEqual(budget);
    expect(batch.chains).toBeLessThanOrEqual(32);
  }
  expect(plannerLayoutBatchSize(24, 324, 20_000)).toEqual({ chains: 32, steps: 625 });
  expect(plannerLayoutBatchSize(65, 100, 2000)).toBeNull();
  expect(plannerLayoutBatchSize(24, 1025, 2000)).toBeNull();
  expect(plannerLayoutBatchSize(24, 324, 31)).toBeNull();
});

it("GPU 候选仍受 CPU 完整几何规则约束；初始检查不派发，分片种子互异", async () => {
  const batches: PlannerLayoutBatch[] = [];
  const backend: PlannerLayoutBackend = { search: async input => {
    batches.push(input);
    return { evaluations: input.chains * input.parameters[4]!, kernelMs: 1,
      poses: [[{ x: 20, y: 20, rotation: 0 }], [{ x: 2, y: 2, rotation: 0 }]] };
  } };
  const first = layout(backend), second = layout(backend, 32);
  expect(await first.search.advance(0, () => {})).toBe(false);
  expect(batches).toHaveLength(0);
  expect(await first.search.advance(100, () => {})).toBe(true);
  first.search.applyBest();
  expect(first.node.entity.position).toEqual({ x: 2, y: 2 });
  expect(first.statistics).toMatchObject({ evaluations: 96, gpuEvaluations: 96, gpuCheckedLayouts: 2, gpuFeasibleLayouts: 1 });
  await second.search.advance(100, () => {});
  expect(batches[0]!.parameters[5]).not.toBe(batches[1]!.parameters[5]);
  await first.search.advance(4, () => {});
  expect(first.statistics.evaluations).toBe(100);
  expect(first.statistics.gpuEvaluations).toBe(96);
});

it("GPU 批次完成后暂停也结算次数；无硬件时回退 CPU 且不虚增 GPU 计数", async () => {
  let completed = false;
  const test = layout({ search: async input => {
    completed = true;
    return { evaluations: input.chains * input.parameters[4]!, kernelMs: 1, poses: [] };
  } });
  await expect(test.search.advance(100, () => { if (completed) throw new DOMException("暂停", "AbortError"); }))
    .rejects.toMatchObject({ name: "AbortError" });
  expect(test.statistics.evaluations).toBe(96);
  const gpu = new PlannerGpuLayout();
  try {
    const fallback = layout(gpu);
    await fallback.search.advance(100, () => {});
    // AI-REMOVED 2026-10-10: 回退使用同一个批量协议，96 次批次后仍剩 4 次预算。
    // Trigger: 用户要求统一 CPU/GPU；Evidence: 两后端相同 batch；Replacement: 下方分批计费断言。
    // Risk: Low；Human Review: Required。
    // expect(fallback.statistics.evaluations).toBe(100);
    expect(fallback.statistics.evaluations).toBe(96);
    // CPU 回退同样保留已计费的其他独立链候选，领取队列不重复扣费。
    while (fallback.search.hasPendingLayouts) {
      await fallback.search.advance(0, () => {});
      expect(fallback.statistics.evaluations).toBe(96);
    }
    await fallback.search.advance(4, () => {});
    expect(fallback.statistics.evaluations).toBe(100);
    expect(fallback.statistics.gpuEvaluations ?? 0).toBe(0);
    expect(gpu.available).toBe(false);
    expect(gpu.metrics.fallbackReason).toBeDefined();
  } finally { gpu.dispose(); }
});

it("首个候选布线失败后仍能领取同批其他已计费布局，不重复计算或扣费", async () => {
  let batches = 0;
  const test = layout({ search: async input => {
    batches++;
    return { evaluations: input.chains * input.parameters[4]!, kernelMs: 1,
      poses: [[{ x: 1, y: 1, rotation: 0 }], [{ x: 2, y: 2, rotation: 0 }]] };
  } });
  expect(await test.search.advance(96, () => {})).toBe(true);
  test.search.applyBest();
  const first = { ...test.node.entity.position };
  expect(test.search.hasPendingLayouts).toBe(true);
  expect(await test.search.advance(0, () => {})).toBe(true);
  test.search.applyBest();
  expect(test.node.entity.position).not.toEqual(first);
  expect(test.search.hasPendingLayouts).toBe(false);
  expect(test.statistics.evaluations).toBe(96);
  expect(batches).toBe(1);
});
