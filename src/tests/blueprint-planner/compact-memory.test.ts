// @vitest-environment node
import { expect, it } from "vitest";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { restorePlannerSeed, type PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
// AI-CORRECTION 2026-11-21: 内部模块fixture不提供生产目标/执行预算，只读取共享目标轴，不调用整任务工厂校验。
// Original code: import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { resolvePlannerDimensionConstraint } from "@/shared/planner-dimension-limits";
import { PlannerBoundary } from "@/blueprint-planner/boundary";
import { getPlannerPorts, opposite } from "@/blueprint-planner/geometry";
import { createRegistryContract } from "@/registry";
import reference from "./fixtures/compact-layout-memory-reference.json";

it("不同外框的搜索交错执行与独立执行一致，不串扰评分或端口归属", async () => {
  // AI-CORRECTION 2026-11-21: 该历史West姿态只作未验收评分初态；baseSide声明目标South，并不宣称现有口已在South。
  // Original code: const registry = createRegistryContract(), seed = reference.seed as PlannerSearchSeed;
  const registry = createRegistryContract(), raw = structuredClone(reference.seed) as PlannerSearchSeed;
  const request = JSON.parse(raw.requestKey);
  const warehouses = raw.network.nodes.filter(n => ["loader_1", "unloader_1"].includes(n.entity.definitionId));
  expect(warehouses.length).toBeGreaterThan(0);
  for (const n of warehouses) expect(opposite(getPlannerPorts(registry, n.entity, registry.queries.findEntityDefinition(n.entity.definitionId)!,
    n.entity.definitionId === "loader_1" ? "input" : "output")[0]!.edge)).toBe("WEST");
  // AI-CORRECTION 2026-11-21: 仅解析搜索目标，保留空目标/无预算的内部几何fixture职责。
  // Original code: const seed = { ...raw, network: { ...raw.network, baseSide: createProductionNetwork(registry, request).baseSide } };
  const seed = { ...raw, network: { ...raw.network, baseSide: resolvePlannerDimensionConstraint(registry, request)!.baseSide } };
  const original = JSON.stringify(seed);
  const createSearch = (scenario: typeof reference.cases[number]) => {
    const { network, wires } = restorePlannerSeed(registry, JSON.parse(seed.requestKey), seed);
    const statistics: PlannerSearchStatistics = { strategy: scenario.strategy as "baseline" | "compact", seed: 294883,
      evaluationLimit: 512, evaluations: 0, acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0,
      outline: { width: scenario.size[0]!, height: scenario.size[1]! } };
    expect(new PlannerBoundary(registry, network, statistics.outline).resolve(network.nodes.map(n => ({ ...n.entity.position, rotation: n.entity.rotation }))).violations).toBeGreaterThan(0);
    return { network, wires, statistics, search: new CompactLayoutSearch(registry, network, wires, statistics) };
  };
  const advance = async (state: ReturnType<typeof createSearch>) => {
    const feasible = await state.search.advance(64, () => {});
    state.search.applyBest();
    expect(state.statistics.evaluations).toBeLessThanOrEqual(512);
    return structuredClone({ feasible, statistics: state.statistics, wires: state.wires,
      poses: state.network.nodes.map(node => ({ position: node.entity.position, rotation: node.entity.rotation })) });
  };
  const independent = [];
  for (const scenario of reference.cases) {
    const state = createSearch(scenario), trajectory = [];
    for (let step = 0; step < 8; step++) trajectory.push(await advance(state));
    independent.push(trajectory);
  }
  const interleaved = reference.cases.map(createSearch);
  for (let step = 0; step < 8; step++) {
    for (const [index, state] of interleaved.entries()) {
      expect(await advance(state)).toEqual(independent[index]![step]);
    }
  }
  expect(JSON.stringify(seed)).toBe(original);
});
