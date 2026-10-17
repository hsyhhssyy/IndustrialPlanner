// @vitest-environment node
/**
 * 2026-10-17：跨模块供料重建、中心对称提案及同面积选优。
 * 以完整 120 分离芯需求检查共享惰气；不把最终产物倍数当成上游设备倍数。
 */
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { areGridRectsContaining, resolveEntityGridRect, resolveGasDiffusionRangeGridRect } from "@/shared/geometry/power-range";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { prepareProductionDevices } from "@/blueprint-planner/production-preparation";
import { guideProductionPlacement } from "@/blueprint-planner/production-refinement";
import { PlannerPlacement } from "@/blueprint-planner/placement";
import { resolveSearchProfile } from "@/blueprint-planner/search-profile";
import { capturePlannerSeed, restorePlannerSeed } from "@/blueprint-planner/search-seed";
import { wireProductionNetwork } from "@/blueprint-planner/wiring";
import { comparePlannerRanks } from "@/blueprint-planner/quality";
import { combineRepeatedPlannerCandidate, repeatedPlannerRequest } from "@/blueprint-planner/repeated-plan";
import type { PlannerCandidate } from "@/blueprint-planner/candidate";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import { readPlanningInput } from "@/scripts/eda/planning-input";
import { saveSuccessfulPlanning } from "@/scripts/eda/artifacts";
import { plannerAttemptStrategy } from "@/blueprint-planner/strategy-schedule";
import { meetsOperatingLimits, meetsProductionTargets } from "@/blueprint-planner/verification";
import input from "@/shared/eda-regression/cases/filter-core-120-2s.json";
import repeated from "./fixtures/repeated-unit.json";
import plant from "./fixtures/plant-preload.json";

it("完整需求重建共享同一单口惰气源，设备产能和旧种子保持不变", async () => {
  const registry = createRegistryContract();
  const request = { ...input.request, options: { ...input.request.options, evaluationsPerRound: 20_000 } } as BlueprintPlannerRequest;
  const prepare = async (shared: boolean) => {
    const network = createProductionNetwork(registry, request);
    const placement = new PlannerPlacement(registry, 68, 1, 1, 0, 1);
    await prepareProductionDevices(registry, network, placement, 1,
      resolveSearchProfile({ initialClearance: 0, fluidGroupSize: 1, separateOperatingSupply: shared ? 0 : 1 }),
      { strategy: "compact", conduitTopology: shared ? "shared" : "local", stashPackingVariant: 0 }, () => {});
    return { network, placement };
  };
  const old = await prepare(false);
  const wires = await wireProductionNetwork(registry, old.network, old.placement, () => {}, true);
  const seed = capturePlannerSeed(request, old.network, wires, [], 70, 70), snapshot = JSON.stringify(seed);
  const next = await prepare(true);
  const preferred = guideProductionPlacement(registry, next.network, seed, 42);
  const inert = next.network.nodes.filter(node => node.purpose === "supply" && node.outputs.some(flow => flow.itemId === "item_gas_inert"));
  expect(inert).toHaveLength(1);
  expect(inert[0]!.definition.id).toBe("udpipe_unloader_1");
  expect(inert[0]!.outputs).toEqual([{ itemId: "item_gas_inert", perMinute: 66 }]);
  expect(inert[0]!.supplyTargets).toHaveLength(3);
  expect(next.network.nodes.filter(node => node.recipe?.id === "r_furnace_carbon_mtl_from_grass_1_basic")).toHaveLength(1);
  expect(next.network.nodes.filter(node => node.recipe?.id === "tools_proc_filter_core_2")).toHaveLength(2);
  const nextWires = await wireProductionNetwork(registry, next.network, next.placement, () => {}, true, true, false, undefined, { preferred });
  expect(nextWires.filter(wire => wire.source.entityId === inert[0]!.entity.id)
    .reduce((total, wire) => total + wire.perMinute, 0)).toBe(66);
  expect(JSON.stringify(seed)).toBe(snapshot);
});

it("完整重建保留可用摆位与端口偏好，少量提案内交付同面积真实产线", async () => {
  const session = new PlannerBatchSession();
  try {
    const request = readPlanningInput(session.workspace.registry, plant);
    const baseline = await session.planner.build(request, 0, 30_000);
    await saveSuccessfulPlanning(session.workspace.registry, "production-guidance-baseline", baseline.execution.blueprint,
      request, { metrics: baseline.metrics, search: baseline.search });
    const original = JSON.stringify(baseline.seed);
    const candidate = await session.planner.build(request, 1, 30_000, { seed: baseline.seed,
      firstSolution: false, maximumArea: baseline.metrics.area,
      targetOutline: { width: baseline.metrics.width, height: baseline.metrics.height }, maxEvaluations: 20_000,
      attemptStrategy: { ...plannerAttemptStrategy(1), restart: false, reduce: true, conduitTopology: "shared" } });
    const report = await session.simulation.actions.runBlueprint(candidate.execution);
    expect(candidate.metrics.area).toBeLessThanOrEqual(baseline.metrics.area);
    expect(candidate.search.evaluations).toBeLessThanOrEqual(1000);
    expect(meetsProductionTargets(request, report)).toBe(true);
    expect(meetsOperatingLimits(candidate.supplyAudit, report)).toBe(true);
    expect(JSON.stringify(baseline.seed)).toBe(original);
    await saveSuccessfulPlanning(session.workspace.registry, "production-guidance-refined", candidate.execution.blueprint,
      request, { report, metrics: candidate.metrics, search: candidate.search });
  } finally { await session.dispose(); }
}, 60_000);

it("独立重复子网存在 180 度组合提案，原始种子不可变", () => {
  const registry = createRegistryContract(), request = repeated.request as BlueprintPlannerRequest;
  const candidate = combineRepeatedPlannerCandidate(registry, request, repeated.unit as unknown as PlannerCandidate,
    repeatedPlannerRequest(request, { width: 30, height: 51 })!);
  const seed = candidate.seed!, snapshot = JSON.stringify(seed);
  const network = restorePlannerSeed(registry, request, seed).network;
  guideProductionPlacement(registry, network, seed, 42);
  const differences = network.nodes.map(node => {
    const original = seed.network.nodes.find(other => other.entity.id === node.entity.id)!;
    return (node.entity.rotation - original.entity.rotation + 360) % 360;
  });
  expect(differences).toContain(180);
  expect(differences.every(turn => turn === 0 || turn === 180)).toBe(true);
  for (const node of network.nodes.filter(node => node.recipe?.requiredEnvironmentAnyOf?.length)) {
    const covered = network.nodes.some(environment => {
      const output = environment.recipe?.environmentOutput;
      if (!output || !node.recipe!.requiredEnvironmentAnyOf!.includes(output.itemId)) return false;
      const range = resolveGasDiffusionRangeGridRect({ entity: environment.entity, definition: environment.definition, rangeId: output.rangeId });
      return range !== null && areGridRectsContaining(range, resolveEntityGridRect({ entity: node.entity, definition: node.definition }));
    });
    expect(covered, node.entity.id).toBe(true);
  }
  expect(JSON.stringify(seed)).toBe(snapshot);
});

it("同面积先减少供给设施再减少口数，任何面积增加都不能由少入口抵消", () => {
  expect(comparePlannerRanks({ area: 480, supplyFacilityCount: 2 }, { area: 480, supplyFacilityCount: 3 })).toBeLessThan(0);
  expect(comparePlannerRanks({ area: 480, supplyFacilityCount: 1, supplyPortCount: 1, secondary: 1000 },
    { area: 480, supplyFacilityCount: 1, supplyPortCount: 2, secondary: 0 })).toBeLessThan(0);
  expect(comparePlannerRanks({ area: 481, supplyFacilityCount: 1 }, { area: 480, supplyFacilityCount: 4 })).toBeGreaterThan(0);
});
