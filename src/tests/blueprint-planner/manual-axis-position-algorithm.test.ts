// @vitest-environment node
import { afterAll, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { GridRotation } from "@/domain/shared/grid";
import { plannerRequestKey, restorePlannerSeed } from "@/blueprint-planner/search-seed";
import { prepareManualLayout } from "@/blueprint-planner/manual-layout";
import type { PlannerCandidate } from "@/blueprint-planner/candidate";
import { assertPlannerCandidateBounds, assertPlannerWarehousePorts, meetsProductionTargets } from "@/blueprint-planner/verification";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { transformManualPlacement } from "@/shared/geometry/manual-layout-transform";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import separator from "./fixtures/separator-core.json";

const execution = new PlannerBatchSession();
afterAll(() => execution.dispose());
const evidence = resolve(".temp/playwright-test/req051-dual-axis/algorithm", `${Date.now()}-${process.pid}`);
type Mode = "automatic" | "disabled-draft" | "relative-free" | "relative-fixed" | "absolute";

async function requestFor(mode: Mode, rotation: GridRotation = 0): Promise<BlueprintPlannerRequest> {
  const baseline = structuredClone(separator.request) as BlueprintPlannerRequest;
  const request: BlueprintPlannerRequest = { ...baseline, manualLayout: undefined,
    options: { ...baseline.options, warehouseBus: "straight", solidOutput: "warehouse", concurrency: 1,
      evaluationsPerRound: 5_000, randomSeed: 85196838, deterministicSearch: true,
      dimensionLimits: { exactBaseLength: 24, straight: { edge: 28, side: 30 } } } };
  if (mode === "automatic") return request;
  const draft: BlueprintPlannerRequest = { ...request, manualLayout: { enabled: true, mode: "recipe",
    orientation: mode === "relative-free" ? "free" : "fixed", boundary: { rotation, position: null, assignments: [] },
    facilities: [], placements: [], preparation: { sourceKey: "", nodes: [], connections: [], facilityTemplates: [], placementIssues: [] } } };
  const preparation = await prepareManualLayout(execution.workspace.registry, draft);
  const node = preparation.nodes.find(node => node.purpose === "production")!;
  expect(node).toBeDefined();
  const placement = transformManualPlacement({ referenceNode: node, position: { x: 9, y: 17 }, rotation: 0 },
    execution.workspace.registry.queries.findEntityDefinition(node.definitionId)!, { rotation, translation: { x: 0, y: 0 } });
  const current: BlueprintPlannerRequest = { ...draft, manualLayout: { ...draft.manualLayout!, preparation,
    placements: [placement], boundary: { rotation, position: mode === "absolute" ? { base: 24, left: 0, right: 24 } : null,
      assignments: preparation.nodes.filter(node => ["loader_1", "unloader_1"].includes(node.definitionId)).map(referenceNode => ({ referenceNode, side: "base" })) } } };
  const prepared = { ...current, manualLayout: { ...current.manualLayout!, preparation: await prepareManualLayout(execution.workspace.registry, current) } };
  return mode === "disabled-draft" ? { ...prepared, manualLayout: { ...prepared.manualLayout, enabled: false } } : prepared;
}

const primaryAxisCases: readonly { label: string; width: number; height: number;
  position: { left: number | null; right: number | null; top: number | null; base: number | null } }[] = [
  { label: "X左Y自由", position: { left: 0, right: null, top: null, base: null }, width: 24, height: 26 },
  { label: "X右Y自由", position: { left: null, right: 24, top: null, base: null }, width: 24, height: 26 },
  { label: "X自由Y上", position: { left: null, right: null, top: 0, base: null }, width: 26, height: 24 },
  { label: "X自由Y下", position: { left: null, right: null, top: null, base: 24 }, width: 26, height: 24 },
  { label: "X精确Y自由", position: { left: 0, right: 24, top: null, base: null }, width: 24, height: 26 },
  { label: "X自由Y精确", position: { left: null, right: null, top: 0, base: 24 }, width: 26, height: 24 },
  { label: "双轴自由", position: { left: null, right: null, top: null, base: null }, width: 24, height: 26 },
] as const;
const axisCases = primaryAxisCases.flatMap(value => value.label === "X左Y自由" || value.label === "X右Y自由"
  ? [value, { ...value, width: 22, label: value.label + "-22格宽" }]
  : value.label === "X自由Y上" || value.label === "X自由Y下"
    ? [value, { ...value, height: 22, label: value.label + "-22格高" }] : [value]);

it.each(axisCases)("$label：真实Worker、四边独立测距、完整产率和交付复验", async ({ label, position, width, height }) => {
  const base = await requestFor("relative-fixed");
  const request: BlueprintPlannerRequest = { ...base, options: { ...base.options,
    dimensionLimits: label === "X精确Y自由" ? { exactBaseLength: 24, maxSideLength: 28 }
      : label === "X自由Y精确" ? { exactSideLength: 24, maxBaseLength: 28 }
        : { maxBaseLength: 28, maxSideLength: 28 } },
    manualLayout: { ...base.manualLayout!, boundary: { ...base.manualLayout!.boundary, position } } };
  const candidate = await execution.planner.build(request, 0, 20_000,
    { targetOutline: { width, height }, maxEvaluations: 5_000 });
  expect(execution.planner.threadId).toBeGreaterThan(0);
  expect(candidate.manualTransform?.rotation).toBe(0);
  assertPlannerCandidateBounds(execution.workspace.registry, candidate);
  assertPlannerWarehousePorts(execution.workspace.registry, request, candidate);
  const source = request.manualLayout!.placements[0]!;
  const entity = candidate.execution.blueprint.entities[source.referenceNode.id]!;
  const rect = resolveEntityGridRect({ entity, definition: execution.workspace.registry.queries.findEntityDefinition(entity.definitionId)! });
  const original = resolveEntityGridRect({ entity: { ...entity, position: source.position, rotation: source.rotation },
    definition: execution.workspace.registry.queries.findEntityDefinition(entity.definitionId)! });
  const origin = candidate.outlineOrigin ?? { x: 0, y: 0 };
  const distances = { left: rect.x - origin.x, right: origin.x + candidate.metrics.width - rect.x - rect.width,
    top: rect.y - origin.y, bottom: origin.y + candidate.metrics.height - rect.y - rect.height };
  if (position.left !== null) expect(distances.left).toBe(original.x - position.left);
  if (position.right !== null) expect(distances.right).toBe(position.right - original.x - original.width);
  if (position.top !== null) expect(distances.top).toBe(original.y - position.top);
  if (position.base !== null) expect(distances.bottom).toBe(position.base - original.y - original.height);
  // 单端锁定在不同实际外框下保持同一端净距，自由端随尺寸增减。
  if (position.left !== null && position.right === null) expect(distances.right).toBe(width - original.width - distances.left);
  if (position.right !== null && position.left === null) expect(distances.left).toBe(width - original.width - distances.right);
  if (position.top !== null && position.base === null) expect(distances.bottom).toBe(height - original.height - distances.top);
  if (position.base !== null && position.top === null) expect(distances.top).toBe(height - original.height - distances.bottom);
  if (position.left !== null && position.right !== null) expect(candidate.metrics.width).toBe(position.right - position.left);
  if (position.top !== null && position.base !== null) expect(candidate.metrics.height).toBe(position.base - position.top);
  const report = await execution.simulation.actions.runBlueprint(candidate.execution);
  expect(report.status).toBe("completed");
  expect(meetsProductionTargets(request, report), JSON.stringify(report.diagnostics)).toBe(true);
  const reloaded = JSON.parse(JSON.stringify(candidate)) as PlannerCandidate;
  assertPlannerCandidateBounds(execution.workspace.registry, reloaded);
  assertPlannerWarehousePorts(execution.workspace.registry, request, reloaded);
  await mkdir(evidence, { recursive: true });
  await writeFile(resolve(evidence, label + ".json"), JSON.stringify({ request, candidate, distances, report }, null, 2));
}, 30_000);

it("两轴自由与固定相对使用相同输入产生等价成果", async () => {
  const relative = await requestFor("relative-fixed");
  const bounded = { ...relative, manualLayout: { ...relative.manualLayout!, boundary: { ...relative.manualLayout!.boundary,
    position: { base: null, top: null, left: null, right: null } } } };
  expect(plannerRequestKey(bounded)).toBe(plannerRequestKey(relative));
  const locked = { ...bounded, manualLayout: { ...bounded.manualLayout, boundary: { ...bounded.manualLayout.boundary,
    position: { base: null, top: null, left: 0, right: null } } } };
  expect(plannerRequestKey(locked)).not.toBe(plannerRequestKey(relative));
  const options = { targetOutline: { width: 24, height: 26 }, maxEvaluations: 5_000 };
  const first = await execution.planner.build(relative, 0, 20_000, options);
  const second = await execution.planner.build(bounded, 0, 20_000, options);
  // 生成UUID和时间戳独立，等价性比较真实实体、线路及整体变换。
  expect(second.execution.blueprint.entities).toEqual(first.execution.blueprint.entities);
  expect(second.execution.blueprint.entityOrder).toEqual(first.execution.blueprint.entityOrder);
  expect(second.execution.blueprint.slotLinks).toEqual(first.execution.blueprint.slotLinks);
  expect(second.manualTransform).toEqual(first.manualTransform);
  expect(() => restorePlannerSeed(execution.workspace.registry, bounded, first.seed!)).not.toThrow();
  expect(() => restorePlannerSeed(execution.workspace.registry, relative, second.seed!)).not.toThrow();
  expect(() => restorePlannerSeed(execution.workspace.registry, locked, first.seed!)).toThrow();
}, 60_000);
