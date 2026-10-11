// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerBlueprintInput, BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import { blueprintRecognitionScene } from "@/blueprint-planner/blueprint-scene";
import { assertBlueprintRecognition, assertBlueprintSteadyState } from "@/blueprint-planner/blueprint-analysis";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { PlannerCpuLayout } from "@/blueprint-planner/cpu-layout";
import { createPlainNode, PlannerPlacement } from "@/blueprint-planner/placement";
import { getPlannerPorts } from "@/blueprint-planner/geometry";
import { meetsProductionTargets } from "@/blueprint-planner/verification";
import { meetsStashSubmission } from "@/blueprint-planner/stash-submission";
import { emptyPlannerCheckpoint, PLANNER_ALGORITHM_VERSION, restorePlannerTaskFile } from "@/blueprint-planner/task-checkpoint";
import { createRegistryContract } from "@/registry";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import { saveSuccessfulPlanning } from "@/scripts/eda/artifacts";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";
import fixture from "./fixtures/separator-core.json";

const directory = "src/tests/fixtures/blueprints/blueprint-planner/stash-submission/";
const request: BlueprintPlannerRequest = { ...fixture.request as BlueprintPlannerRequest,
  plan: { ...fixture.request.plan, targets: [{ itemId: "item_filter_core", perMinute: 90 }] } };

it("初排、固定设备登记及移除后重建都不为无下游的收货箱预留出口", () => {
  const registry = createRegistryContract();
  for (const method of ["place", "reserve", "remove"] as const) for (const reverse of [false, true]) {
    const placement = new PlannerPlacement(registry, 10, 0, 0, 0, 1);
    const box = createPlainNode(registry, "storager_1", "stash", "product");
    box.entity.position = { x: 3, y: 3 };
    box.inputs.push({ itemId: "item_filter_core", perMinute: 30 });
    const power = createPlainNode(registry, "power_diffuser_1", "blocker", "power");
    power.entity.position = { x: 3, y: 6 };
    const [first, second] = reverse ? [power, box] : [box, power];
    if (method === "reserve") placement.reserve([first]);
    else placement.place(first, first.entity.position);
    if (method === "remove") placement.remove([]);
    expect(placement.canPlace(second, second.entity.position, 0)).toBe(true);
    expect(() => placement.place(second, second.entity.position)).not.toThrow();
  }
});

function inputFor(variant: string): BlueprintPlannerBlueprintInput {
  const blueprint = loadBlueprintFromFile(`${directory}${variant}.schema7.json`);
  return { blueprint, activeActivityIds: [], boundaries: [
    { entityId: "stash", kind: "facility", direction: "output", portGroupId: "", portId: "", itemId: "item_filter_core" },
    ...[0, 1, 2].map(index => ({ entityId: `source-${index}`, kind: "facility" as const, direction: "input" as const,
      portGroupId: "", portId: "", itemId: "item_filter_core" })),
  ] };
}

it("中心协议储存箱全部出口被实体堵住，三路输入仍每 10 秒提交并持续接收 90/min", async () => {
  const session = new PlannerBatchSession();
  try {
    const registry = session.workspace.registry, input = inputFor("powered"), blueprint = input.blueprint;
    const before = JSON.stringify(blueprint), box = blueprint.entities.stash!;
    const definition = registry.queries.findEntityDefinition(box.definitionId)!;
    const blocker = blueprint.entities.blocker!;
    const rect = resolveEntityGridRect({ entity: blocker, definition });
    expect(getPlannerPorts(registry, box, definition, "output").every(port => port.outside.x >= rect.x
      && port.outside.x < rect.x + rect.width && port.outside.y >= rect.y && port.outside.y < rect.y + rect.height)).toBe(true);
    for (const backend of [undefined, new PlannerCpuLayout()]) {
      const nodes = blueprint.entityOrder.map(id => {
        const entity = blueprint.entities[id]!;
        return { ...createPlainNode(registry, entity.definitionId, id, id === "stash" ? "product" : "logistics"), entity,
          inputs: id === "stash" ? [{ itemId: "item_filter_core", perMinute: 90 }] : [] };
      });
      const statistics: PlannerSearchStatistics = { seed: 1, evaluationLimit: 1, evaluations: 0, acceptedMoves: 0,
        routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: { width: 10, height: 10 } };
      const search = new CompactLayoutSearch(registry, { request, nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 }, [], statistics, undefined, backend);
      expect(await search.advance(0, () => {})).toBe(true);
    }
    const execution = blueprintRecognitionScene(registry, input, blueprint, 600);
    expect(execution.scene.externalEntities).toEqual([]);
    const report = await session.simulation.actions.runBlueprint(execution);
    expect(meetsProductionTargets(request, report)).toBe(true);
    expect(report.probes.find(probe => probe.id === "item_filter_core")?.amount).toBe(900);
    expect(report.probes.find(probe => probe.id === "stash-submit:stash")?.amount).toBe(0);
    expect(() => assertBlueprintRecognition(registry, input, report)).not.toThrow();
    expect(() => assertBlueprintSteadyState(registry, report, execution.probes)).not.toThrow();
    const periods = await session.simulation.actions.runBlueprint({ ...execution, warmupSeconds: 0,
      observationSeconds: 40, inventorySampleCount: 81 });
    const drops = periods.inventorySamples.filter((sample, index, all) => index > 0
      && (sample.itemAmounts.item_filter_core ?? 0) < (all[index - 1]!.itemAmounts.item_filter_core ?? 0));
    expect(drops.length).toBeGreaterThanOrEqual(3);
    for (let index = 1; index < drops.length; index++) expect(drops[index]!.simulationSeconds - drops[index - 1]!.simulationSeconds).toBe(10);
    expect(JSON.stringify(blueprint)).toBe(before);
    await saveSuccessfulPlanning(registry, "协议储存箱中心堵口90每分钟", blueprint, input, { execution, report, periods });
  } finally { await session.dispose(); }
}, 60_000);

it.each(["unpowered", "disabled"])("%s：短窗口有流入仍拒绝验收，不能用箱内容量掩盖未提交", async variant => {
  const session = new PlannerBatchSession();
  try {
    const input = inputFor(variant);
    const execution = { ...blueprintRecognitionScene(session.workspace.registry, input), warmupSeconds: 0, observationSeconds: 20 };
    const report = await session.simulation.actions.runBlueprint(execution);
    expect(report.status).toBe("completed");
    expect(report.probes.find(probe => probe.id === "item_filter_core")!.perMinute).toBeGreaterThan(0);
    expect(meetsStashSubmission(report)).toBe(false);
    expect(meetsProductionTargets(request, report)).toBe(false);
    expect(() => assertBlueprintRecognition(session.workspace.registry, input, report)).toThrow(variant === "unpowered" ? "未供电" : "自动提交");
  } finally { await session.dispose(); }
});

it("旧算法保留生成任务的累计进度，含箱出口的原图基线必须重新识别且原件不变", async () => {
  const registry = createRegistryContract();
  const file: BlueprintPlannerTaskFile = { formatVersion: 1, algorithmVersion: "seeded-strategies-1", taskId: "old-stash-task",
    request: fixture.request as BlueprintPlannerRequest,
    checkpoint: { ...emptyPlannerCheckpoint(), attempt: 3, evaluations: 100 },
    progress: { taskId: "old-stash-task", status: "waiting", phase: "preparing", startedAt: 1, elapsedMs: 200,
      estimatedProgress: null, evaluatedProposals: 100, roundEvaluatedProposals: 0, candidateCount: 3,
      validatedCandidateCount: 0, bestArea: null, areaHistory: [], message: null } };
  const before = JSON.stringify(file);
  const restored = await restorePlannerTaskFile(file, registry);
  expect(restored.algorithmVersion).toBe(PLANNER_ALGORITHM_VERSION);
  expect(restored.progress).toMatchObject({ evaluatedProposals: 100, candidateCount: 3, elapsedMs: 200 });
  expect(restored.checkpoint).toMatchObject({ attempt: 3, evaluations: 100, pendingCandidate: null, best: null });
  const original = { ...file, request: { ...fixture.request as BlueprintPlannerRequest, blueprintSource: inputFor("powered") } };
  await expect(restorePlannerTaskFile(original, registry)).rejects.toThrow("重新识别");
  expect(JSON.stringify(file)).toBe(before);
});
