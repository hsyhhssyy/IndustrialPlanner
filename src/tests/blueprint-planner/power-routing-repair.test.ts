// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { PlannerRouter } from "@/blueprint-planner/router";
import { restorePlannerSeed, type PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import { completePlannerPowerRouting } from "@/blueprint-planner/power-routing-repair";
import { placePower } from "@/blueprint-planner/support";
import { collectPoweredEntityIds } from "@/shared/geometry/power-range";
import fixture from "./fixtures/power-route-blockage.json";

const registry = createRegistryContract();
function restore(index = 0) {
  const seed = fixture.captures[index]!.seed as PlannerSearchSeed;
  const { network, wires } = restorePlannerSeed(registry, fixture.request as BlueprintPlannerRequest, seed);
  const boundary = { minimumX: 0, minimumY: 0, maximumX: seed.width - 1, maximumY: seed.height - 1, escapeLength: 0 };
  const endpoints = wires.flatMap(wire => [wire.source, wire.target]);
  const router = new PlannerRouter(registry, network.nodes.map(node => node.entity), endpoints, boundary);
  const key = (wire: typeof wires[number]) => `${wire.source.entityId}/${wire.source.groupIndex}/${wire.source.portIndex}>${wire.target.entityId}/${wire.target.groupIndex}/${wire.target.portIndex}`;
  const byRoute = new Map(wires.map(wire => [key(wire), wire]));
  for (const route of seed.routes) {
    const wire = byRoute.get(`${route.sourcePort}>${route.targetPort}`)!;
    expect(router.reuse(wire.source, wire.target, route.cells, wire.minimumCells)).toBe(true);
  }
  const statistics: PlannerSearchStatistics = { seed: 0, evaluationLimit: 100_000, evaluations: fixture.captures[index]!.evaluation,
    acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: seed };
  return { seed, network, wires, boundary, endpoints, router, byRoute, statistics };
}

it.each([0, 1])("真实完整路由堵住桩位后，保持设备、端口、面积及绝大部分线路完成供电：样本 %s", async index => {
  const { seed, network, wires, boundary, endpoints, router, byRoute, statistics } = restore(index);
  const before = structuredClone({ network, wires, routes: router.routes, entities: router.entities });
  expect(await placePower(registry, network, wires, router.entities, seed, () => {})).toBeNull();
  const result = await completePlannerPowerRouting(registry, network, wires, [], seed, router, statistics, () => {});
  expect(result).not.toBeNull();
  expect({ network, wires, routes: router.routes, entities: router.entities }).toEqual(before);
  expect(statistics.evaluations).toBe(fixture.captures[index]!.evaluation);
  expect(statistics.routingAttempts).toBeGreaterThan(0);
  expect(statistics.routingAttempts).toBeLessThanOrEqual(24);
  const entities = [...network.nodes, ...result!.powerNodes].map(node => node.entity);
  const powered = collectPoweredEntityIds(entities, registry.entityDefinitions);
  expect(network.nodes.filter(node => node.definition.requiresPower).every(node => powered.has(node.entity.id))).toBe(true);
  expect(new Set([...entities, ...result!.router.entities].map(entity => entity.id)).size).toBe(entities.length + result!.router.entities.length);
  for (const node of result!.powerNodes) {
    expect(node.entity.position.x).toBeGreaterThanOrEqual(0);
    expect(node.entity.position.y).toBeGreaterThanOrEqual(0);
    expect(node.entity.position.x + node.definition.footprint.width).toBeLessThanOrEqual(seed.width);
    expect(node.entity.position.y + node.definition.footprint.height).toBeLessThanOrEqual(seed.height);
  }
  const verified = new PlannerRouter(registry, entities, endpoints, boundary);
  expect(result!.router.routes).toHaveLength(wires.length);
  let changed = 0;
  for (const route of result!.router.routes) {
    const wire = byRoute.get(`${route.sourcePort}>${route.targetPort}`)!;
    expect(verified.reuse(wire.source, wire.target, route.cells, wire.minimumCells)).toBe(true);
    const old = router.routes.find(old => old.sourcePort === route.sourcePort && old.targetPort === route.targetPort)!;
    if (JSON.stringify(route.cells) !== JSON.stringify(old.cells)) changed++;
  }
  expect(changed).toBeGreaterThan(0);
  expect(changed).toBeLessThan(wires.length / 10);
  const beforeAttempts = statistics.routingAttempts;
  const complete = await completePlannerPowerRouting(registry, { ...network, nodes: [...network.nodes, ...result!.powerNodes] },
    wires, [], seed, result!.router, statistics, () => {});
  expect(complete!.router).toBe(result!.router);
  expect(complete!.powerNodes).toEqual([]);
  expect(statistics.routingAttempts).toBe(beforeAttempts);
}, 15_000);

it("补电重布中的取消原样向上传播，不转换为普通无解", async () => {
  const { seed, network, wires, router, statistics } = restore();
  const cancelled = new Error("cancelled during power routing");
  await expect(completePlannerPowerRouting(registry, network, wires, [], seed, router, statistics, () => {
    if (statistics.routingAttempts > 0) throw cancelled;
  })).rejects.toBe(cancelled);
  expect(statistics.routingAttempts).toBe(1);
});

it("重布不能借路径缓存绕过新增缓冲约束，失败分支最多尝试 24 次", async () => {
  const { seed, network, wires, router, statistics } = restore();
  for (const wire of wires) wire.minimumCells = seed.width * seed.height + 1;
  const before = structuredClone({ network, wires, routes: router.routes });
  expect(await completePlannerPowerRouting(registry, network, wires, [], seed, router, statistics, () => {})).toBeNull();
  expect(statistics.routingAttempts).toBe(24);
  expect({ network, wires, routes: router.routes }).toEqual(before);
});

it.each(["missing", "duplicate", "foreign"])("拒绝不完整或不属于当前网表的路由：%s", async kind => {
  const { seed, network, wires, router, statistics } = restore();
  if (kind === "missing") router.routes.pop();
  if (kind === "duplicate") router.routes[0] = router.routes[1]!;
  if (kind === "foreign") router.routes[0] = { ...router.routes[0]!, sourcePort: "unknown/0/0" };
  await expect(completePlannerPowerRouting(registry, network, wires, [], seed, router, statistics, () => {}))
    .rejects.toThrow("补电重布要求完整且属于当前网表的线路");
  expect(statistics.routingAttempts).toBe(0);
});
