// @vitest-environment node
// 2026-10-21：端口占位推动和共同容量评分须共同解除仅主体推动无法跨过的状态。
// 依据：.docs/common/eda/算法探索/算法探索20261021-通用布线进展与搜索预算.md，Windows probe219–228。
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { repairPlannerRoutes } from "@/blueprint-planner/route-repair";
import { restorePlannerSeed, type PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import { resolveSearchProfile } from "@/blueprint-planner/search-profile";
import { PlannerRouter } from "@/blueprint-planner/router";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import fixture from "./fixtures/forced-turn-port-push.json";

it("有限预算内解除共同瓶颈，返回全部真实合法路径且不修改输入", async () => {
  const registry = createRegistryContract(), seed = fixture.seed as unknown as PlannerSearchSeed;
  const original = JSON.stringify(seed), request = JSON.parse(seed.requestKey);
  const { network, wires } = restorePlannerSeed(registry, request, seed);
  const profile = resolveSearchProfile(fixture.profile);
  const statistics: PlannerSearchStatistics = { seed: fixture.randomSeed, evaluationLimit: fixture.hardLimit,
    evaluations: 0, acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0,
    outline: { width: seed.width, height: seed.height }, strategy: "compact" };
  const makeRouter = () => new PlannerRouter(registry, network.nodes.map(node => node.entity),
    wires.flatMap(wire => [wire.source, wire.target]),
    { minimumX: 0, minimumY: 0, maximumX: seed.width - 1, maximumY: seed.height - 1, escapeLength: 0 });
  expect(makeRouter().staticConstraints(wires)).toEqual({ disconnectedWires: 0, capacityDeficit: 1 });
  const routes = await repairPlannerRoutes(registry, network, wires, seed.routes, statistics, profile, fixture.window, () => {});
  expect(routes).toHaveLength(wires.length);
  expect(statistics.evaluations).toBeLessThanOrEqual(fixture.hardLimit);
  expect(statistics.routeRepairImprovements).toBeGreaterThan(0);
  const router = makeRouter();
  for (const route of routes!) {
    const wire = wires.find(wire => route.sourcePort === `${wire.source.entityId}/${wire.source.groupIndex}/${wire.source.portIndex}`
      && route.targetPort === `${wire.target.entityId}/${wire.target.groupIndex}/${wire.target.portIndex}`)!;
    expect(wire).toBeDefined();
    if (route.cells.length) expect(router.reuse(wire.source, wire.target, route.cells, wire.minimumCells)).toBe(true);
    else await router.connect(wire.source, wire.target, () => {}, wire.minimumCells);
  }
  expect(router.routes).toHaveLength(wires.length);
  expect(router.staticConstraints(wires)).toEqual({ disconnectedWires: 0, capacityDeficit: 0 });
  expect(await new CompactLayoutSearch(registry, network, wires, { ...statistics, evaluations: 0 }, profile)
    .advance(0, () => {})).toBe(true);
  expect(JSON.stringify(seed)).toBe(original);
});
