// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { SimulationBlueprintRunRequest } from "@/domain/simulation";
import { createRegistryContract } from "@/registry";
import { BlueprintExecutionClient } from "@/simulation/blueprint";
import { createDenseBlueprintEngine } from "@/simulation/dense/blueprint-engine";
import { assertPlannerCandidateBounds, meetsProductionTargets } from "@/blueprint-planner/verification";
import type { PlannerCandidate } from "@/blueprint-planner/candidate";
import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";
import fixture from "./fixtures/power-validation.json";

const directory = "src/tests/fixtures/blueprints/blueprint-planner/power-validation/";

it.each(["covered", "no-pylon", "stash-outside"])("Dense 2 TPS 真实检查机器与协议储存箱供电：%s", async name => {
  const registry = createRegistryContract();
  const executor = new BlueprintExecutionClient(registry, "dense-v2", "runtime", options => createDenseBlueprintEngine(registry, options), 2);
  try {
    const blueprint = loadBlueprintFromFile(`${directory}${name}.schema7.json`);
    const report = await executor.run({ ...fixture.execution, blueprint } as SimulationBlueprintRunRequest);
    expect(report.engineKind).toBe("dense-v2");
    expect(report.status).toBe("completed");
    const unpowered = report.deviceStatuses.filter(entry => entry.status === "no-power" || entry.status === "not-in-power-net")
      .map(entry => entry.entityId);
    if (name === "covered") expect(unpowered).toEqual([]);
    else if (name === "no-pylon") expect(unpowered).toEqual(expect.arrayContaining(["eda-device-0", "eda-device-1", "eda-device-2", "eda-output-3"]));
    else expect(unpowered).toEqual(["eda-output-3"]);
    expect(meetsProductionTargets(fixture.request as BlueprintPlannerRequest, report)).toBe(name === "covered");
    // 即使产量条件为空，也不能让没电的机器或箱子通过供电门槛。
    expect(meetsProductionTargets({ ...fixture.request, plan: { ...fixture.request.plan, targets: [] } } as BlueprintPlannerRequest, report))
      .toBe(name === "covered");
  } finally { executor.dispose(); }
}, 40_000);

it("验收逐边核对真实包围盒，拒绝超限统计、伪造面积和隐藏的远端设备", () => {
  const registry = createRegistryContract();
  const candidate: Pick<PlannerCandidate, "execution" | "metrics"> = {
    execution: { ...fixture.execution, blueprint: loadBlueprintFromFile(`${directory}covered.schema7.json`) } as SimulationBlueprintRunRequest,
    metrics: fixture.metrics };
  expect(() => assertPlannerCandidateBounds(registry, candidate)).not.toThrow();
  for (const metrics of [{ ...candidate.metrics, width: 71, height: 50, area: 3550 },
    { ...candidate.metrics, width: 50, height: 71, area: 3550 }, { ...candidate.metrics, area: 1 }]) {
    expect(() => assertPlannerCandidateBounds(registry, { ...candidate, metrics })).toThrow();
  }
  const outside = { ...candidate, execution: { ...candidate.execution,
    blueprint: loadBlueprintFromFile(`${directory}stash-outside.schema7.json`) } };
  expect(() => assertPlannerCandidateBounds(registry, outside)).toThrow("实体超出");
  expect(() => assertPlannerCandidateBounds(registry, { ...candidate,
    execution: { ...candidate.execution, blueprint: loadBlueprintFromFile(`${directory}stash-beyond-limit.schema7.json`) },
    metrics: { ...candidate.metrics, width: 70, height: 70, area: 4900 } })).toThrow("70");
});
