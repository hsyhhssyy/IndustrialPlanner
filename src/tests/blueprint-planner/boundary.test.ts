// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createWorldDocument } from "@/domain/document/world-document";
import { createRegistryContract } from "@/registry";
import { createEditorStateReadWrite } from "@/editor/state-impl";
import { resolvePlacementValidations } from "@/editor/placement-validation";
import { resolveEntityGridRect, areGridRectsIntersecting } from "@/shared/geometry/power-range";
import { PlannerBoundary, resolvePlannerBusMask } from "@/blueprint-planner/boundary";
import { createPlainNode } from "@/blueprint-planner/placement";
import { getPlannerPorts } from "@/blueprint-planner/geometry";
import type { PlannerNetwork } from "@/blueprint-planner/model";
import { emptyPlannerCheckpoint, PLANNER_ALGORITHM_VERSION, restorePlannerTaskFile } from "@/blueprint-planner/task-checkpoint";
import { createPlannerPlacementRegistry } from "@/scripts/eda/placement-scene";
import { runPlannerBatch } from "@/scripts/eda/planner-runner";
import separator from "./fixtures/separator-core.json";

it("面数是上限，直角不可使用相对边，U 型必须为连接边预留位置", () => {
  for (const shape of ["straight", "corner", "u-shaped"] as const) {
    expect(resolvePlannerBusMask(shape, 0, 15)).toBe(0);
    expect(resolvePlannerBusMask(shape, 1, 14)).toBe(1);
    expect(resolvePlannerBusMask(shape, 1, 1)).toBeNull();
    expect(resolvePlannerBusMask(shape, 15, 0)).toBeNull();
  }
  expect(resolvePlannerBusMask("straight", 3, 0)).toBeNull();
  expect(resolvePlannerBusMask("corner", 3, 12)).toBe(3);
  expect(resolvePlannerBusMask("corner", 5, 0)).toBeNull();
  expect(resolvePlannerBusMask("corner", 7, 0)).toBeNull();
  expect(resolvePlannerBusMask("u-shaped", 10, 4)).toBe(11);
  expect(resolvePlannerBusMask("u-shaped", 10, 1)).toBe(14);
  expect(resolvePlannerBusMask("u-shaped", 10, 5)).toBeNull();
  expect(resolvePlannerBusMask("u-shaped", 7, 8)).toBe(7);
});

it("仓库口按连接侧归属一面，换盒重新锚定；外接传送带禁止同面，管道不占用传送带边", () => {
  const registry = createRegistryContract();
  const request = structuredClone(separator.request) as BlueprintPlannerRequest;
  const dock = createPlainNode(registry, "unloader_1", "dock", "supply");
  const belt = { ...createPlainNode(registry, registry.queries.resolveLogisticsDefinitionId("belt", "straight"), "belt", "supply"), external: true };
  const network: PlannerNetwork = { request, nodes: [dock, belt], slotLinks: [], initialSlots: [], preferredGasCount: 0 };
  const boundary = new PlannerBoundary(registry, network, { width: 13, height: 11 });
  const west = boundary.proposals(0).find(pose => pose.x === 0 && pose.y === 2)!;
  const entry = boundary.entries[0]!;
  expect(entry.geometry[west.rotation / 90]!.edge).toBe("WEST");
  const beltWest = boundary.proposals(1).find(pose => pose.x === 0 && pose.y === 6)!;
  expect(boundary.resolve([west, beltWest]).violations).toBeGreaterThan(0);
  const beltEast = boundary.proposals(1).find(pose => pose.x === 12 && pose.y === 6)!;
  expect(boundary.resolve([west, beltEast])).toEqual({ busMask: 8, violations: 0 });
  expect(boundary.resolve([{ ...west, x: 1 }, beltEast]).violations).toBeGreaterThan(0);
  const smaller = new PlannerBoundary(registry, network, { width: 9, height: 8 });
  const moved = { ...beltEast };
  smaller.snap(1, moved);
  expect(moved.x).toBe(8);
  expect(smaller.resolve([west, moved]).violations).toBe(0);
  const pipe = { ...createPlainNode(registry, registry.queries.resolveLogisticsDefinitionId("pipe", "straight"), "pipe", "supply"), external: true };
  const pipes = new PlannerBoundary(registry, { ...network, nodes: [dock, pipe] }, { width: 13, height: 11 });
  const pipeWest = pipes.proposals(1).find(pose => pose.x === 0 && pose.y === 6)!;
  expect(pipes.resolve([west, pipeWest]).violations).toBe(0);
});

it("直线口位短边放不下时仍能选择长边，不把贪心初始化误当无解", () => {
  const registry = createRegistryContract(), request = structuredClone(separator.request) as BlueprintPlannerRequest;
  const nodes = Array.from({ length: 4 }, (_, index) => createPlainNode(registry, "unloader_1", `dock-${index}`, "supply"));
  const network: PlannerNetwork = { request, nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 };
  const boundary = new PlannerBoundary(registry, network, { width: 20, height: 6 });
  boundary.arrange(0);
  const result = boundary.resolve(nodes.map(node => ({ ...node.entity.position, rotation: node.entity.rotation })));
  expect(result.violations).toBe(0);
  expect([1, 4]).toContain(result.busMask);
});

it("所有朝向与非整段边长的盒外存取线可施工、连续接源桩，且没有实体进入盒内", () => {
  const registry = createRegistryContract();
  const request = structuredClone(separator.request) as BlueprintPlannerRequest;
  const workspace: WorkspaceContract = { state: createWorkspaceState(), registry,
    app: null, editor: null, render: null, simulation: null, sync: null, audio: null, blueprintPlanner: null };
  // AI-REMOVED 2026-10-12:
  // Reason: 虚构地图身份使结构化白名单验收失真，且不应修改原 Registry。
  // Trigger: 用户授权修正 EDA 验收上下文，保留验收目标、断言和真实设备规则。
  // Evidence: 新增白名单回归通过；旧场景使用未注册于设备白名单的临时地图 ID。
  // Replacement: @/scripts/eda/placement-scene#createPlannerPlacementRegistry
  // Risk: 临时几何只验收模板，实际地图落位仍须按真实几何检查。
  // Human Review: Required
  //
  // Original code:
  //   registry.baseDefinitions = [...registry.baseDefinitions, { id: "boundary-land", name: "空地", tag: "武陵", tags: ["武陵"],
  //     placeableArea: { width: 1000, height: 1000 }, outerRing: { top: 0, right: 0, bottom: 0, left: 0 }, builtinEntities: [] }];
  const validationRegistry = createPlannerPlacementRegistry(registry, request.plan.sourceBaseId, { width: 1000, height: 1000 });
  for (const width of [3, 8, 11, 16]) for (const height of [3, 8, 13]) for (const mask of [1, 2, 4, 8, 3, 6, 12, 9, 7, 14, 13, 11]) {
    const network: PlannerNetwork = { request, nodes: [], slotLinks: [], initialSlots: [], preferredGasCount: 0 };
    const boundary = new PlannerBoundary(registry, network, { width, height });
    const fixtures = boundary.fixtures(mask);
    const rects = fixtures.map(entity => resolveEntityGridRect({ entity, definition: registry.queries.findEntityDefinition(entity.definitionId)! }));
    for (const rect of rects) expect(areGridRectsIntersecting(rect, { x: 0, y: 0, width, height })).toBe(false);
    const document = createWorldDocument({ baseId: request.plan.sourceBaseId });
    const entities = fixtures.map(entity => ({ ...entity, position: { x: entity.position.x + 20, y: entity.position.y + 20 } }));
    document.entities = Object.fromEntries(entities.map(entity => [entity.id, entity])); document.entityOrder = entities.map(entity => entity.id);
    const invalid = Object.entries(resolvePlacementValidations({ document, workspace: { ...workspace, registry: validationRegistry }, state: createEditorStateReadWrite() }))
      .filter(([, result]) => !result.canPlace);
    expect(invalid, `${width}×${height} mask=${mask}`).toEqual([]);
  }
});

it.each(["compact-portfolio-1", "compact-portfolio-2", "compact-breadth-1"])("%s 的旧自由布局迁移配置和历史，不把未验收面积作为当前最优", async algorithmVersion => {
  const request = structuredClone(separator.request) as BlueprintPlannerRequest;
  Object.assign(request.options, { warehouseBus: "free" });
  const file = { formatVersion: 1 as const, algorithmVersion, taskId: "boundary-migration", request,
    checkpoint: { obsolete: true }, progress: { taskId: "boundary-migration", status: "waiting" as const, phase: "preparing" as const,
      startedAt: 1, elapsedMs: 10, estimatedProgress: null, candidateCount: 2, validatedCandidateCount: 1,
      bestArea: 120, message: null, evaluatedProposals: 50, roundEvaluatedProposals: 50, areaHistory: [{ evaluatedProposals: 50, bestArea: 120 }] } };
  const restored = await restorePlannerTaskFile(file, createRegistryContract());
  expect(restored.algorithmVersion).toBe(PLANNER_ALGORITHM_VERSION);
  expect(restored.request.options.warehouseBus).toBe("corner");
  expect(restored.checkpoint).toEqual({ ...emptyPlannerCheckpoint(), attempt: 2, evaluations: 50, legacyHistoryLength: 1 });
  expect(restored.progress.areaHistory).toEqual(file.progress.areaHistory);
  expect(restored.progress).toMatchObject({ bestArea: null, evaluatedProposals: 50, elapsedMs: 10 });
  expect(request.options.warehouseBus).toBe("free");
});

it.each(["straight", "corner", "u-shaped"] as const)("%s：混合仓库与外接传送带在真实 Worker 生成并达到 60/min，面积和导出均不含存取线", async warehouseBus => {
  const request = structuredClone(separator.request) as BlueprintPlannerRequest;
  Object.assign(request.options, { warehouseBus, itemPolicies: [{ itemId: "item_xiranite_powder", supply: "external" }] });
  const result = await runPlannerBatch(request, { engineKind: "dense-v2", attempts: 3, localEvaluations: 30_000,
    width: 16, height: 16, candidateSeconds: 45 });
  const success = result.records.find(record => record.outcome === "success");
  expect(success, result.records.map(record => record.error).join("\n")).toBeDefined();
  expect(success!.area).toBe(256);
  expect(success!.constraints).toEqual({ placementErrors: [], excessiveOperatingInputs: [] });
  expect(success!.measuredOutputs![0]!.perMinute).toBeGreaterThanOrEqual(60);
  const { readFile } = await import("node:fs/promises");
  const blueprint = JSON.parse(await readFile(`${success!.artifactPath}/blueprint.json`, "utf8"));
  const registry = createRegistryContract();
  const entities = Object.values(blueprint.entities) as import("@/domain/document/world-document").WorldEntity[];
  expect(entities.some(entity => entity.definitionId === "log_hongs_bus" || entity.definitionId === "log_hongs_bus_source")).toBe(false);
  expect(success!.search!.quality!.occupiedCells).toBeGreaterThan(0);
  const dockEdges = entities.filter(entity => entity.definitionId === "unloader_1").map(entity =>
    getPlannerPorts(registry, entity, registry.queries.findEntityDefinition(entity.definitionId)!, "output")[0]!.edge);
  expect(dockEdges.length).toBeGreaterThan(0);
}, 150_000);
