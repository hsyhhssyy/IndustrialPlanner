// @vitest-environment node
// 2026-10-23：定价已有可行原始路径时可提前返回0；正证书及真实端点直穿继续保持。
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { PlannerRouter } from "@/blueprint-planner/router";
import { countPlannerCoupledCapacityDeficit } from "@/blueprint-planner/routing-coupled-capacity";
import { PlannerRoutingGrid } from "@/blueprint-planner/routing-grid";
import { EDGES, DELTAS, opposite, type PlannerPort } from "@/blueprint-planner/geometry";
import { restorePlannerSeed, type PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import reference from "./fixtures/coupled-capacity-controls.json";
import { repairPlannerRoutes } from "@/blueprint-planner/route-repair";
import { resolveSearchProfile } from "@/blueprint-planner/search-profile";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";

function wire(direction: number, id: number) {
  const step = DELTAS[direction]!;
  const source: PlannerPort = { entityId: `source-${id}`, groupIndex: 0, portIndex: 0,
    kind: "belt", direction: "output", edge: EDGES[direction]!,
    cell: { x: -step.x, y: -step.y }, outside: { x: 0, y: 0 } };
  const target: PlannerPort = { ...source, entityId: `target-${id}`, direction: "input",
    edge: opposite(source.edge), cell: { x: step.x, y: step.y } };
  return { source, target };
}

it.each(reference.cases)("真实必要容量与完整控制：$name", entry => {
  const registry = createRegistryContract(), seed = entry.seed as unknown as PlannerSearchSeed;
  const before = JSON.stringify(entry), { network, wires } = restorePlannerSeed(registry, JSON.parse(seed.requestKey), seed);
  const router = new PlannerRouter(registry, network.nodes.map(node => node.entity), wires.flatMap(line => [line.source, line.target]),
    { minimumX: 0, minimumY: 0, maximumX: seed.width - 1, maximumY: seed.height - 1, escapeLength: 0 });
  const grid = (router as unknown as { grid: PlannerRoutingGrid }).grid;
  expect(countPlannerCoupledCapacityDeficit(registry, grid, wires,
    { x: 0, y: 0, width: seed.width, height: seed.height })).toBe(entry.expected);
  expect(JSON.stringify(entry)).toBe(before);
});

it.each(reference.cases.filter(entry => entry.expected === 1))(
  "局部零提案返回仍携带完整成对必要事实：$name", async entry => {
    const registry = createRegistryContract(), seed = entry.seed as unknown as PlannerSearchSeed;
    const { network, wires } = restorePlannerSeed(registry, JSON.parse(seed.requestKey), seed);
    const statistics: PlannerSearchStatistics = { seed: 123, evaluationLimit: 0, evaluations: 0,
      acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0,
      outline: { width: seed.width, height: seed.height }, strategy: "compact" };
    const routes = await repairPlannerRoutes(registry, network, wires, seed.routes, statistics, resolveSearchProfile(), 0, () => {});
    expect(routes).toHaveLength(seed.routes.length);
    expect(statistics.evaluations).toBe(0);
    expect(statistics.routeRepairDisconnectedWires).toBe(0);
    expect(statistics.routeRepairCapacityDeficit).toBe(1);
  });

for (const direction of [0, 1, 2, 3]) {
  it(`单格正交直穿满足全部资源，方向${direction}，真实Router可共同重放`, () => {
    const registry = createRegistryContract(), wires = [wire(direction, 0), wire((direction + 1) % 4, 1)];
    const router = new PlannerRouter(registry, [], wires.flatMap(line => [line.source, line.target]),
      { minimumX: 0, minimumY: 0, maximumX: 0, maximumY: 0, escapeLength: 0 });
    for (const line of wires) expect(router.reuse(line.source, line.target, [{ x: 0, y: 0 }])).toBe(true);
    expect(countPlannerCoupledCapacityDeficit(registry, new PlannerRoutingGrid(), wires,
      { x: 0, y: 0, width: 1, height: 1 })).toBe(0);
    expect(router.routes).toHaveLength(2);
  });

  it(`同轴重复穿越没有被可行提前返回放行，方向${direction}`, () => {
    const registry = createRegistryContract(), wires = [wire(direction, 0), wire(direction, 1)];
    expect(countPlannerCoupledCapacityDeficit(registry, new PlannerRoutingGrid(), wires,
      { x: 0, y: 0, width: 1, height: 1 })).toBe(1);
  });
}
