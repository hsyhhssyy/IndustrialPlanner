// @vitest-environment node

import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { BlueprintExecutionClient } from "@/simulation/blueprint";
import { createDenseBlueprintEngine } from "@/simulation/dense/blueprint-engine";
import { meetsProductionTargets } from "@/blueprint-planner/verification";
import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
import { readPlanningInput } from "@/scripts/eda/planning-input";
import { saveSuccessfulPlanning } from "@/scripts/eda/artifacts";
import plant from "./fixtures/plant-preload.json";

it("EDA 使用 Dense 2 TPS 编译和执行真实蓝图", async () => {
  const registry = createRegistryContract();
  const planner = new NodePlannerClient();
  let compiledTickRate: number | undefined;
  const executor = new BlueprintExecutionClient(registry, "dense-v2", "runtime", (options) => {
    compiledTickRate = options.topology.standardTickRate;
    return createDenseBlueprintEngine(registry, options);
  }, 2);
  try {
    const request = readPlanningInput(registry, plant);
    const candidate = await planner.build(request, 0, 30_000);
    const report = await executor.run({ ...candidate.execution, maxWallTimeMs: 30_000 });
    expect(compiledTickRate).toBe(2);
    expect(report.engineKind).toBe("dense-v2");
    expect(meetsProductionTargets(request, report)).toBe(true);
    expect(report.observationSeconds).toBe(120);
    await saveSuccessfulPlanning(registry, "Dense-2TPS-真实执行", candidate.execution.blueprint, request,
      { compiledTickRate, metrics: candidate.metrics, report });
  } finally {
    executor.dispose();
    await planner.dispose();
  }
}, 60_000);
