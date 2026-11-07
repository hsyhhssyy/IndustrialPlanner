// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { PlannerCandidateError } from "@/blueprint-planner/model";
import { PlannerRouter } from "@/blueprint-planner/router";
import { restorePlannerSeed, type PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import fixture from "./fixtures/port-feedback-escape.json";

it.each([false, true])("真实失败反馈改配等价端口且保持固定端口约束：固定=%s", async fixed => {
  const registry = createRegistryContract();
  const { network, wires } = restorePlannerSeed(registry, fixture.request as BlueprintPlannerRequest, fixture.seed as PlannerSearchSeed);
  const statistics: PlannerSearchStatistics = { strategy: "compact", seed: 0, evaluationLimit: 0, evaluations: 0,
    acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0,
    outline: { width: fixture.seed.width, height: fixture.seed.height } };
  const search = new CompactLayoutSearch(registry, network, wires, statistics, undefined, undefined,
    new Set(fixed ? ["source", "target"] : []));
  search.applyBest();
  const poses = network.nodes.map(node => ({ position: { ...node.entity.position }, rotation: node.entity.rotation }));
  const original = structuredClone(wires[0]!);
  const connect = () => {
    const router = new PlannerRouter(registry, network.nodes.map(node => node.entity), wires.flatMap(wire => [wire.source, wire.target]),
      { minimumX: 0, minimumY: 0, maximumX: fixture.seed.width - 1, maximumY: fixture.seed.height - 1, escapeLength: 0 });
    return router.connect(wires[0]!.source, wires[0]!.target, () => {});
  };
  await expect(connect()).rejects.toBeInstanceOf(PlannerCandidateError);
  search.penalize(wires[0]!);
  search.applyBest();
  expect(network.nodes.map(node => ({ position: node.entity.position, rotation: node.entity.rotation }))).toEqual(poses);
  expect(wires[0]!.itemIds).toEqual(original.itemIds);
  expect(wires[0]!.perMinute).toBe(original.perMinute);
  if (fixed) {
    expect(wires[0]).toEqual(original);
    await expect(connect()).rejects.toBeInstanceOf(PlannerCandidateError);
  } else {
    expect(wires[0]!.source).not.toEqual(original.source);
    await expect(connect()).resolves.toBeGreaterThan(0);
  }
});
