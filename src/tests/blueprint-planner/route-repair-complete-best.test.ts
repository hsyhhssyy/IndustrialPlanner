// @vitest-environment node
// 2026-10-23：v66探索回退独立后仍须满足相同完整事实保留契约；断言与原3000额度不变，本轮未运行Vitest。
// 2026-10-23：真实回归见 .docs/common/eda/算法探索/算法探索20261023-续修尝试与方向收敛.md。
// 旧版同3000额度把完整安全33/35替换为容量不足34/35；本测试不要求该暖态已经完整布通。
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { repairPlannerRoutes } from "@/blueprint-planner/route-repair";
import { PlannerRouter } from "@/blueprint-planner/router";
import { capturePlannerSeed, comparePlannerPartialSeeds, restorePlannerSeed, type PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import { resolveSearchProfile, type PlannerSearchProfile } from "@/blueprint-planner/search-profile";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import type { PlannerAttemptStrategy } from "@/blueprint-planner/strategy-schedule";
import reference from "./fixtures/complete-best-repair-v1.json";

it.each(reference.cases)("完整事实保留不被轴代理的假进展覆盖：$name", async fixture => {
  const registry = createRegistryContract(), seed = structuredClone(fixture.seed) as unknown as PlannerSearchSeed;
  const original = JSON.stringify(seed), request = JSON.parse(seed.requestKey);
  const { network, wires } = restorePlannerSeed(registry, request, seed);
  const profile = resolveSearchProfile(fixture.profile as Partial<PlannerSearchProfile>);
  const outline = { width: seed.width, height: seed.height };
  const statistics: PlannerSearchStatistics = { seed: fixture.layoutSeed, attemptStrategy: fixture.strategy as PlannerAttemptStrategy,
    evaluationLimit: reference.limit, evaluations: 0, acceptedMoves: 0, routingAttempts: 0,
    initialWireLength: 0, finalWireLength: 0, outline, strategy: "compact" };
  const router = () => new PlannerRouter(registry, network.nodes.map(node => node.entity), wires.flatMap(wire => [wire.source, wire.target]),
    { minimumX: 0, minimumY: 0, maximumX: seed.width - 1, maximumY: seed.height - 1, escapeLength: 0 });
  const initial = router().staticConstraints(wires);
  expect(initial).toEqual({ disconnectedWires: 0, capacityDeficit: 0 });
  expect(seed.routes).toHaveLength(33);

  const routes = await repairPlannerRoutes(registry, network, wires, seed.routes, statistics, profile, reference.window, () => {});
  expect(routes).toBeDefined();
  expect(statistics.evaluations).toBeGreaterThan(0);
  expect(statistics.evaluations).toBeLessThanOrEqual(reference.limit);
  expect(routes!.length).toBeGreaterThanOrEqual(seed.routes.length);
  const returned = router().staticConstraints(wires);
  expect(returned).toEqual(initial);
  expect(statistics.routeRepairDisconnectedWires).toBe(returned.disconnectedWires);
  expect(statistics.routeRepairCapacityDeficit).toBe(returned.capacityDeficit);
  expect(comparePlannerPartialSeeds({ ...capturePlannerSeed(request, network, wires, routes!, seed.width, seed.height), ...returned },
    { ...seed, ...initial })).toBeLessThanOrEqual(0);

  const verification = { ...statistics, evaluationLimit: 1, evaluations: 0 };
  expect(await new CompactLayoutSearch(registry, network, wires, verification, profile).advance(0, () => {})).toBe(true);
  const replay = router();
  for (const route of routes!) {
    const wire = wires.find(value => `${value.source.entityId}/${value.source.groupIndex}/${value.source.portIndex}` === route.sourcePort
      && `${value.target.entityId}/${value.target.groupIndex}/${value.target.portIndex}` === route.targetPort)!;
    expect(wire).toBeDefined();
    if (route.cells.length) expect(replay.reuse(wire.source, wire.target, route.cells, wire.minimumCells)).toBe(true);
    else await replay.connect(wire.source, wire.target, () => {}, wire.minimumCells);
  }
  expect(replay.routes).toHaveLength(routes!.length);
  expect(JSON.stringify(seed)).toBe(original);
});
