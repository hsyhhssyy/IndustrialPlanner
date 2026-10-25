// @vitest-environment node
import { expect, it } from "vitest";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { restorePlannerSeed, type PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import { createRegistryContract } from "@/registry";
import reference from "./fixtures/compact-layout-memory-reference.json";

it("不同外框的搜索交错执行与独立执行一致，不串扰评分或端口归属", async () => {
  const registry = createRegistryContract(), seed = reference.seed as PlannerSearchSeed;
  const original = JSON.stringify(seed);
  const createSearch = (scenario: typeof reference.cases[number]) => {
    const { network, wires } = restorePlannerSeed(registry, JSON.parse(seed.requestKey), seed);
    const statistics: PlannerSearchStatistics = { strategy: scenario.strategy as "baseline" | "compact", seed: 294883,
      evaluationLimit: 512, evaluations: 0, acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0,
      outline: { width: scenario.size[0]!, height: scenario.size[1]! } };
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
