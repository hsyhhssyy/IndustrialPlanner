// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createPlannerCandidate, type PlannerCandidate } from "@/blueprint-planner/candidate";
import { reconstructVerifiedPlannerSeed } from "@/blueprint-planner/blueprint-network";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { restorePlannerSeed } from "@/blueprint-planner/search-seed";
import { plannerAttemptStrategy } from "@/blueprint-planner/strategy-schedule";
import { meetsOperatingLimits, meetsProductionTargets } from "@/blueprint-planner/verification";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import fixture from "./fixtures/verified-contraction.json";

it("仅用已验收成品重建网表，丢弃旧缓存后仍能计费缩边并通过真实 Dense 验收", async () => {
  const session = new PlannerBatchSession();
  const request = structuredClone(fixture.request) as BlueprintPlannerRequest;
  const candidate = structuredClone(fixture.candidate) as PlannerCandidate;
  const original = JSON.stringify(candidate);
  try {
    const report = await session.simulation.actions.runBlueprint({ ...candidate.execution,
      warmupSeconds: 360, observationSeconds: 600, inventorySampleCount: 9, collectAnalysis: true });
    expect(meetsProductionTargets(request, report)).toBe(true);
    expect(meetsOperatingLimits(candidate.supplyAudit, report)).toBe(true);
    const seed = reconstructVerifiedPlannerSeed(session.workspace.registry, request, candidate, report);
    expect(candidate.seed).toBeUndefined();
    expect(seed.network.request).toEqual(request);
    expect(seed.network.request.blueprintSource).toBeUndefined();
    expect(seed.network.nodes).toHaveLength(41);
    expect(seed.wires).toHaveLength(47);
    expect(seed.network.initialSlots).toEqual(candidate.execution.scene.initialSlots);
    expect(JSON.stringify(candidate)).toBe(original);
    expect(() => reconstructVerifiedPlannerSeed(session.workspace.registry,
      { ...request, plan: { ...request.plan, targets: [{ itemId: "item_copper_enr2", perMinute: 1000 }] } }, candidate, report)).toThrow("有效验收");
    for (const randomSeed of [1, 17]) {
      const result = await createPlannerCandidate(session.workspace.registry, request, randomSeed, () => {}, () => {}, {
        seed, targetOutline: { width: 42, height: 17 }, maximumArea: 730, maxEvaluations: 64,
        attemptStrategy: { ...plannerAttemptStrategy(randomSeed), unitKey: "contraction-test", reduce: false, restart: false },
      });
      expect(result.search.evaluations).toBeGreaterThan(0);
      expect(result.search.evaluations).toBeLessThanOrEqual(64);
      expect(result.metrics.area).toBe(714);
      const measured = await session.simulation.actions.runBlueprint({ ...result.execution, warmupSeconds: 360, observationSeconds: 600 });
      expect(meetsProductionTargets(request, measured)).toBe(true);
      expect(meetsOperatingLimits(result.supplyAudit, measured)).toBe(true);
    }
    const { network, wires } = restorePlannerSeed(session.workspace.registry, request, seed);
    const statistics: PlannerSearchStatistics = { seed: 1, evaluationLimit: 1, evaluations: 0, acceptedMoves: 0,
      routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: { width: 42, height: 17 }, strategy: "compact" };
    const search = new CompactLayoutSearch(session.workspace.registry, network, wires, statistics);
    search.prepareContraction(seed);
    await search.advance(0, () => {});
    expect(statistics.evaluations).toBe(0);
    await search.advance(750, () => {});
    expect(statistics.evaluations).toBe(1);
    await search.advance(750, () => {});
    expect(statistics.evaluations).toBe(1);
  } finally { session.dispose(); }
}, 60_000);
