// @vitest-environment node
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { repairPlannerRoutes } from "@/blueprint-planner/route-repair";
import { capturePlannerSeed, restorePlannerSeed, type PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import { resolveSearchProfile } from "@/blueprint-planner/search-profile";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import reference from "./fixtures/compact-layout-memory-reference.json";

function scenario(limit: number) {
  const registry = createRegistryContract(), seed = structuredClone(reference.seed) as unknown as PlannerSearchSeed;
  const request = JSON.parse(seed.requestKey);
  const { network, wires } = restorePlannerSeed(registry, request, seed);
  const statistics: PlannerSearchStatistics = { seed: 12345, evaluationLimit: limit, evaluations: 0, acceptedMoves: 0,
    routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: { width: seed.width, height: seed.height }, strategy: "compact" };
  return { registry, seed, request, network, wires, statistics };
}

it("部分布线修复允许外部仓库链接，实际补齐线路且不改写输入种子", async () => {
  const { registry, seed, network, wires, statistics } = scenario(64), before = JSON.stringify(seed);
  expect(network.slotLinks.length).toBeGreaterThan(0);
  const routes = await repairPlannerRoutes(registry, network, wires, seed.routes.slice(0, -1), statistics, resolveSearchProfile(), 64, () => {});
  expect(routes).toHaveLength(wires.length);
  expect(new Set(routes!.map(route => `${route.sourcePort}>${route.targetPort}`)).size).toBe(wires.length);
  expect(statistics.evaluations).toBeGreaterThan(0);
  expect(statistics.evaluations).toBeLessThanOrEqual(64);
  expect(statistics.routeRepairImprovements).toBeGreaterThan(0);
  expect(JSON.stringify(seed)).toBe(before);
});

it("局部修复按总预算截断，取消时恢复完整网表快照", async () => {
  const first = scenario(1);
  await repairPlannerRoutes(first.registry, first.network, first.wires, first.seed.routes.slice(0, -1), first.statistics, resolveSearchProfile(), 100, () => {});
  expect(first.statistics.evaluations).toBe(1);
  const second = scenario(64);
  const snapshot = () => capturePlannerSeed(second.request, second.network, second.wires, second.seed.routes, second.seed.width, second.seed.height);
  const before = snapshot();
  let checks = 0;
  await expect(repairPlannerRoutes(second.registry, second.network, second.wires, second.seed.routes.slice(0, -1), second.statistics,
    resolveSearchProfile(), 64, () => { if (++checks === 3) throw new DOMException("测试取消", "AbortError"); })).rejects.toMatchObject({ name: "AbortError" });
  expect(snapshot()).toEqual(before);
});

// 2026-10-21：真实几何始终拒绝的方向应因停滞提前返回，不能耗尽整批预算阻止其他尺寸获得机会。
it("无法容纳设备的边界在无连通改善后让出剩余预算", async () => {
  const { registry, seed, network, wires, statistics } = scenario(20_000);
  const bounded = { ...statistics, outline: { width: 1, height: 1 } };
  const initial = seed.routes.slice(0, -1);
  const routes = await repairPlannerRoutes(registry, network, wires, initial, bounded, resolveSearchProfile(), 20_000, () => {});
  expect(routes).toEqual(initial);
  expect(bounded.evaluations).toBeGreaterThan(0);
  expect(bounded.evaluations).toBeLessThan(20_000);
  expect(bounded.routeRepairImprovements ?? 0).toBe(0);
});
