// @vitest-environment node

import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createWorldDocument } from "@/domain/document/world-document";
import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";
import { resolvePlacementValidations } from "@/editor/placement-validation";
import { createEditorStateReadWrite } from "@/editor/state-impl";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { meetsProductionTargets } from "@/blueprint-planner/verification";
import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
import { saveSuccessfulPlanning } from "@/scripts/eda/artifacts";
import { runPlannerBatch } from "@/scripts/eda/planner-runner";
import nugget from "./fixtures/pyrrolite-nugget.json";
import ore from "./fixtures/pyrrolite-ore.json";

it.each([
  { name: "赤铜块外供", input: nugget, width: 30, height: 40 },
  { name: "赤铜矿外供", input: ore, width: 40, height: 50 },
])("$name：旧尺寸回归：五万次以内交付完整产线，真实 Dense 2 TPS 达到 30/min", async ({ name, input, width, height }) => {
  const request = structuredClone(input.request) as BlueprintPlannerRequest;
  const before = JSON.stringify(request);
  const registry = createRegistryContract();
  const workspace: WorkspaceContract = { state: createWorkspaceState(), registry,
    app: null, editor: null, render: null, simulation: null, sync: null, blueprintPlanner: null };
  const planner = new NodePlannerClient();
  const simulation = createSimulationHost(workspace, { engineKind: "dense-v2", workerMode: "runtime", blueprintDenseTickRate: 2 });
  try {
    const candidate = await planner.build(request, 0, 90_000, { maxEvaluations: 50_000, outline: { width, height } });
    const report = await simulation.actions.runBlueprint({ ...candidate.execution, maxWallTimeMs: 120_000 });
    const blueprint = candidate.execution.blueprint;
    if (meetsProductionTargets(request, report)) await saveSuccessfulPlanning(registry, `紧凑验收-${name}`, blueprint, request,
      { engineKind: "dense-v2", ticksPerSecond: 2, metrics: candidate.metrics, search: candidate.search, report });
    expect(planner.threadId).toBeGreaterThan(0);
    expect(candidate.search.evaluations).toBeGreaterThan(0);
    expect(candidate.search.evaluations).toBeLessThanOrEqual(50_000);
    const rects = Object.values(blueprint.entities).map(entity => resolveEntityGridRect({ entity,
      definition: registry.queries.findEntityDefinition(entity.definitionId)! }));
    const actualWidth = Math.max(...rects.map(rect => rect.x + rect.width)) - Math.min(...rects.map(rect => rect.x));
    const actualHeight = Math.max(...rects.map(rect => rect.y + rect.height)) - Math.min(...rects.map(rect => rect.y));
    expect((actualWidth <= width && actualHeight <= height) || (actualWidth <= height && actualHeight <= width)).toBe(true);
    expect([candidate.metrics.width, candidate.metrics.height]).toEqual([actualWidth, actualHeight]);
    registry.baseDefinitions = [...registry.baseDefinitions, { id: "compact-validation-land", name: "空地", tag: "武陵", tags: ["武陵"],
      placeableArea: { width: 1000, height: 1000 }, outerRing: { top: 0, right: 0, bottom: 0, left: 0 }, builtinEntities: [] }];
    const document = createWorldDocument({ baseId: "compact-validation-land" });
    Object.assign(document, { entities: blueprint.entities, entityOrder: blueprint.entityOrder, slotLinks: blueprint.slotLinks });
    const validations = resolvePlacementValidations({ document, workspace, state: createEditorStateReadWrite() });
    expect(Object.entries(validations).filter(([, result]) => !result.canPlace)).toEqual([]);
    expect(report.status).toBe("completed");
    expect(report.engineKind).toBe("dense-v2");
    expect(report.diagnostics.filter(entry => entry.severity === "error")).toEqual([]);
    expect(report.deviceStatuses.filter(entry => ["no-power", "not-in-power-net"].includes(entry.status))).toEqual([]);
    expect(report.probes.find(probe => probe.id === "item_copper_enr2")?.perMinute).toBeGreaterThanOrEqual(30);
    expect(Object.values(blueprint.entities).filter(entity => entity.definitionId.startsWith("cheat_"))).toEqual([]);
    expect(candidate.metrics.productionDeviceCount).toBe(request.plan.recipes.filter(recipe => !recipe.recipeId.startsWith("r_gas_diffuser_"))
      .reduce((count, recipe) => count + Math.ceil(recipe.deviceCount), 0));
    expect(JSON.stringify(request)).toBe(before);
  } finally { simulation.dispose(); await planner.dispose(); }
}, 240_000);

it("多次尝试共享局部评估上限，几何拒绝也消耗预算", async () => {
  const result = await runPlannerBatch(structuredClone(nugget.request) as BlueprintPlannerRequest,
    { engineKind: "dense-v2", attempts: 3, localEvaluations: 7, width: 30, height: 40, candidateSeconds: 30 });
  expect(result.attempts).toBe(3);
  expect(result.localEvaluations).toBe(7);
  expect(result.records.map(record => record.search?.evaluations)).toEqual([3, 2, 2]);
  expect(result.records.every(record => record.search!.acceptedMoves <= record.search!.evaluations)).toBe(true);
}, 120_000);
