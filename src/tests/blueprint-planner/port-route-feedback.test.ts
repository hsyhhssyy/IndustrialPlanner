// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// AI-CORRECTION 2026-11-21: 内部模块fixture不提供生产目标/执行预算，只读取共享目标轴，不调用整任务工厂校验。
// Original code: import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { resolvePlannerDimensionConstraint } from "@/shared/planner-dimension-limits";
import { createRegistryContract } from "@/registry";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { PlannerCandidateError } from "@/blueprint-planner/model";
import { PlannerRouter } from "@/blueprint-planner/router";
import { restorePlannerSeed, type PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import fixture from "./fixtures/port-feedback-escape.json";

it.each([false, true])("真实失败反馈改配等价端口且保持固定端口约束：固定=%s", async fixed => {
  const registry = createRegistryContract();
  // AI-CORRECTION 2026-11-21: 该夹具仅是无仓库口的未验收模块中间态，补当前生产搜索目标轴，不将其当交付成品。
  // Original code: const { network, wires } = restorePlannerSeed(registry, fixture.request as BlueprintPlannerRequest, fixture.seed as PlannerSearchSeed);
  const request = fixture.request as BlueprintPlannerRequest, raw = structuredClone(fixture.seed) as PlannerSearchSeed;
  expect(raw.network.nodes.some(n => ["loader_1", "unloader_1"].includes(n.entity.definitionId))).toBe(false);
  // AI-CORRECTION 2026-11-21: 仅解析搜索目标，保留空目标/无预算的内部几何fixture职责。
  // Original code: const seed = { ...raw, network: { ...raw.network, baseSide: createProductionNetwork(registry, request).baseSide } };
  const seed = { ...raw, network: { ...raw.network, baseSide: resolvePlannerDimensionConstraint(registry, request)!.baseSide } };
  const { network, wires } = restorePlannerSeed(registry, request, seed);
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
  // 2026-11-14：反馈接口使用稳定线路索引；原有端口重配与固定位置断言不变。
  search.penalize(0);
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
