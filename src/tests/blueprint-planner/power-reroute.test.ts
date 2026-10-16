// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createPlannerCandidate } from "@/blueprint-planner/candidate";
import type { PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import { meetsOperatingLimits, meetsProductionTargets } from "@/blueprint-planner/verification";
import { BlueprintExecutionClient } from "@/simulation/blueprint";
import { createDenseBlueprintEngine } from "@/simulation/dense/blueprint-engine";
import { saveSuccessfulPlanning } from "@/scripts/eda/artifacts";
import fixture from "./fixtures/power-reroute-seed.json";

it("首解布通但供电失败后，保留合法桩位重布，固定 25×20 内通过 Dense 2 TPS 验产", async () => {
  const registry = createRegistryContract(), seed = fixture.seed as unknown as PlannerSearchSeed;
  const request = JSON.parse(seed.requestKey) as BlueprintPlannerRequest;
  const candidate = await createPlannerCandidate(registry, request, 0, () => {}, () => {}, {
    seed, targetOutline: { width: 25, height: 20 }, maximumArea: 500, maxEvaluations: 60_000, coolingEvaluations: 300_000,
    firstSolution: true, attemptStrategy: { ...fixture.strategy, conduitTopology: "trunk", restart: false, reduce: false },
    profile: fixture.profile, diagnostics: true,
  });
  expect(candidate.search.evaluations).toBeLessThanOrEqual(60_000);
  expect(candidate.search.powerReroutes).toBeGreaterThan(0);
  expect(candidate.search.summary?.rejections.power).toBeGreaterThan(0);
  expect(candidate.metrics.area).toBe(500);
  const executor = new BlueprintExecutionClient(registry, "dense-v2", "runtime", options => createDenseBlueprintEngine(registry, options), 2);
  try {
    const report = await executor.run(candidate.execution);
    expect(meetsProductionTargets(request, report)).toBe(true);
    expect(meetsOperatingLimits(candidate.supplyAudit, report)).toBe(true);
    await saveSuccessfulPlanning(registry, "供电桩位重布回归", candidate.execution.blueprint, request,
      { metrics: candidate.metrics, search: candidate.search, report, warmStart: true });
  } finally { executor.dispose(); }
}, 60_000);
