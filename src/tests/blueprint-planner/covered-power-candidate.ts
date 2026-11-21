import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { PlannerCandidate } from "@/blueprint-planner/candidate";
import { assertPlannerCandidateBounds, assertPlannerWarehousePorts } from "@/blueprint-planner/verification";
import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";
import fixture from "./fixtures/power-validation.json";

/** 调度只替换完成顺序；实体、外部夹具和声明外框使用同一真实合法成品。该成品没有仓库出入口，无须转动设备。 */
export function coveredPowerCandidate(registry: RegistryContract, search: Partial<PlannerCandidate["search"]> = {}): PlannerCandidate {
  const candidate: PlannerCandidate = {
    execution: { ...structuredClone(fixture.execution),
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/blueprint-planner/power-validation/covered.schema7.json") } as PlannerCandidate["execution"],
    metrics: structuredClone(fixture.metrics), connections: [],
    supplyAudit: { operatingLimits: [], splitterCount: 0, bufferedAdmissions: 0 },
    search: { seed: 0, evaluationLimit: 10000, evaluations: 0, acceptedMoves: 0, routingAttempts: 0,
      initialWireLength: 0, finalWireLength: 0, ...search, outline: { ...fixture.metrics, baseSide: 2 } },
  };
  assertPlannerCandidateBounds(registry, candidate);
  assertPlannerWarehousePorts(registry, fixture.request as BlueprintPlannerRequest, candidate);
  return candidate;
}
