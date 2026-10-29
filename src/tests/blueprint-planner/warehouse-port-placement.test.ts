// @vitest-environment node
import { expect, it } from "vitest";
import { warehousePortViolations, type PlannerWarehouseRect } from "@/blueprint-planner/warehouse-ports";
import { warehouseStorageCounts, warehouseCountRequest, warehousePortProfile, warehouseMaximumRequest } from "@/blueprint-planner/warehouse-port-schedule";
import { partitionPlannerDimensions, assertPlannerDimensionSchedule, PLANNER_DIMENSION_ATTEMPTS } from "@/blueprint-planner/dimension-schedule";
import { PlannerBoundary } from "@/blueprint-planner/boundary";
import { PlannerLayoutKernel } from "@/blueprint-planner/cpu-layout";
import { PLANNER_LAYOUT_GEOMETRY_STRIDE as G } from "@/blueprint-planner/layout-backend";
import { createRegistryContract } from "@/registry";
import { createPlainNode } from "@/blueprint-planner/placement";
import { PlannerItemRules } from "@/shared/planner-item-policy";
import { restorePlannerOutputRequest } from "@/blueprint-planner/output-policy";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { PlannerNetwork } from "@/blueprint-planner/model";
import type { PlannerCandidate } from "@/blueprint-planner/candidate";
import { assertPlannerCandidateBounds, assertPlannerWarehousePorts } from "@/blueprint-planner/verification";
import legacyTask from "./fixtures/legacy-boundary-task.json";
import fixture from "./fixtures/separator-core.json";

const rect = (x: number, kind: number, y = 0, width = 3, height = 1, side = 0): PlannerWarehouseRect => ({ x, y, width, height, kind, side });
const violation = (rects: PlannerWarehouseRect[]) => warehousePortViolations(rects, "continuous", 20, 20);

it("交付仓库口按声明包围盒验收，保留空白边距并支持原图的显式原点", () => {
  const registry = createRegistryContract();
  const request = { ...fixture.request, options: { ...fixture.request.options,
    warehouseBus: "straight", warehousePortPlacement: "continuous" } } as BlueprintPlannerRequest;
  const nodes = [0, 1].map(index => createPlainNode(registry, "unloader_1", `right-${index}`, "supply"));
  nodes.forEach((node, index) => { node.entity.position = { x: 19, y: 5 + index * 3 }; node.entity.rotation = 90; });
  const original = legacyTask.file.checkpoint.best.candidate as unknown as PlannerCandidate;
  const candidate: PlannerCandidate = { ...original, seed: undefined,
    metrics: { ...original.metrics, width: 20, height: 20, area: 400 }, search: { ...original.search, outline: { width: 20, height: 20 } },
    execution: { ...original.execution, blueprint: { ...original.execution.blueprint,
      entities: Object.fromEntries(nodes.map(node => [node.entity.id, node.entity])), entityOrder: nodes.map(node => node.entity.id) } } };
  expect(() => assertPlannerCandidateBounds(registry, candidate)).not.toThrow();
  expect(() => assertPlannerWarehousePorts(registry, request, candidate)).not.toThrow();
  const shifted = structuredClone(candidate);
  for (const entity of Object.values(shifted.execution.blueprint.entities)) { entity.position = { x: entity.position.x + 100, y: entity.position.y - 50 }; }
  expect(() => assertPlannerCandidateBounds(registry, shifted)).toThrow("实体超出");
  expect(() => assertPlannerWarehousePorts(registry, request, shifted)).toThrow();
  const anchored = { ...shifted, outlineOrigin: { x: 100, y: -50 } };
  expect(() => assertPlannerCandidateBounds(registry, anchored)).not.toThrow();
  expect(() => assertPlannerWarehousePorts(registry, request, anchored)).not.toThrow();
});

it("连通标签工作区在规模缩小、种类切换和空输入后不会残留旧分量", () => {
  const labels = new Int32Array(12).fill(99);
  const cases = [
    { rects: [rect(0, 1), rect(4, 1), rect(10, 2), rect(14, 2)], expected: 2 },
    { rects: [rect(0, 1), rect(3, 2), rect(6, 1)], expected: 0 },
    { rects: [], expected: 0 },
    { rects: [rect(0, 2), rect(4, 2)], expected: 1 },
    { rects: [rect(0, 1)], expected: 0 },
  ];
  for (let pass = 0; pass < 3; pass++) for (const { rects, expected } of cases) {
    expect(warehousePortViolations(rects, "continuous", 20, 20, -1, labels)).toBe(expected);
    expect(warehousePortViolations(rects, "continuous", 20, 20, -1, new Int32Array(0))).toBe(expected);
  }
});

it("合并连通或各类分别连通，禁止同类被空隙拆散", () => {
  expect(violation([rect(0, 1), rect(3, 2), rect(6, 1), rect(9, 2)])).toBe(0);
  expect(violation([rect(0, 1), rect(3, 1), rect(10, 2), rect(13, 2)])).toBe(0);
  expect(violation([rect(0, 1), rect(4, 1), rect(10, 2), rect(14, 2)])).toBeGreaterThan(0);
  expect(violation([rect(0, 1), rect(4, 1)])).toBeGreaterThan(0);
  expect(warehousePortViolations([rect(0, 1), rect(4, 1)], "any", 20, 20)).toBe(0);
});

it("跨拐角必须实体共边，拐角空格及仅角点接触不能连通", () => {
  expect(violation([rect(0, 1), rect(0, 1, 1, 1, 3, 3)])).toBe(0);
  expect(violation([rect(1, 1), rect(0, 1, 1, 1, 3, 3)])).toBeGreaterThan(0);
  expect(violation([rect(0, 1), rect(0, 1, 2, 1, 3, 3)])).toBeGreaterThan(0);
});

it("整边模式必须覆盖指定整边，不能空一格、重叠或换边", () => {
  const list = [rect(0, 1), rect(3, 2)];
  expect(warehousePortViolations(list, "full-side", 6, 8, 0)).toBe(0);
  expect(warehousePortViolations(list, "full-side", 7, 8, 0)).toBeGreaterThan(0);
  expect(warehousePortViolations([rect(0, 1), rect(2, 2)], "full-side", 6, 8, 0)).toBeGreaterThan(0);
  expect(warehousePortViolations(list, "full-side", 6, 8, 2)).toBeGreaterThan(0);
  expect(warehousePortViolations([], "full-side", 6, 8)).toBeGreaterThan(0);
});

it("按固定选择与自动产物的实际运力枚举口数，组合多不重复增加尺寸", () => {
  const profile = { pickupLength: 6, storageLength: 3, fixedStorageCount: 2,
    automatic: [{ itemId: "a", count: 2 }, { itemId: "b", count: 2 }, { itemId: "c", count: 3 }] };
  expect(warehouseStorageCounts(profile)).toEqual([2, 4, 5, 6, 7, 9]);
  const shards = partitionPlannerDimensions(500, { width: 3, height: 3 }, profile);
  const dimensions = shards.flat();
  expect(dimensions).toHaveLength(24);
  for (const dimension of dimensions) {
    expect(dimension.weight).toBe(1);
    expect(dimension.area).toBeLessThan(500);
    expect(dimension.warehouseSide! % 2 === 0 ? dimension.width : dimension.height).toBe(6 + 3 * dimension.storageCount!);
  }
  const schedule = { generation: 0, targetArea: 500, minimum: { width: 3, height: 3 }, attemptsPerTask: PLANNER_DIMENSION_ATTEMPTS, warehousePorts: profile };
  expect(() => assertPlannerDimensionSchedule(schedule, shards.map(dimensions => ({ dimensions, dimensionCursor: 0 })))).not.toThrow();
  const tampered = structuredClone(shards);
  Object.assign(tampered[0]![0]!, { storageCount: 0 });
  expect(() => assertPlannerDimensionSchedule(schedule, tampered.map(dimensions => ({ dimensions, dimensionCursor: 0 })))).toThrow();
});

it("手选存货口和存储箱不被自动组合覆盖，恢复保留同一请求", () => {
  const request = structuredClone(fixture.request) as BlueprintPlannerRequest;
  Object.assign(request.options, { warehousePortPlacement: "full-side", solidOutput: "auto", itemPolicies: [
    { itemId: "fixed", output: "warehouse" }, { itemId: "box", output: "stash" },
  ] });
  const profile = { pickupLength: 3, storageLength: 3, fixedStorageCount: 1, automatic: [{ itemId: "a", count: 2 }, { itemId: "b", count: 2 }] };
  const variants = [0, 1].map(variant => warehouseCountRequest(request, profile, 3, variant));
  expect(variants[0]!.options).not.toEqual(variants[1]!.options);
  for (const variant of variants) {
    expect(variant.options.itemPolicies).toContainEqual({ itemId: "fixed", output: "warehouse" });
    expect(variant.options.itemPolicies).toContainEqual({ itemId: "box", output: "stash" });
    expect(restorePlannerOutputRequest(request, variant.options)).toEqual(variant);
  }
  expect(() => warehouseCountRequest(request, profile, 2, 0)).toThrow();
});

it("实际设备清单计入多运力存货口，指定边初排和移动不会换边", () => {
  const registry = createRegistryContract(), request = structuredClone(fixture.request) as BlueprintPlannerRequest;
  Object.assign(request.options, { warehousePortPlacement: "full-side", solidOutput: "auto", itemPolicies: [] });
  const nodes = [createPlainNode(registry, "unloader_1", "pickup", "supply"),
    createPlainNode(registry, "loader_1", "storage1", "product"), createPlainNode(registry, "loader_1", "storage2", "product")];
  for (const node of nodes.slice(1)) node.inputs.push({ itemId: request.plan.targets[0]!.itemId, perMinute: 30 });
  const network: PlannerNetwork = { request, nodes, initialSlots: [], slotLinks: [], preferredGasCount: 0 };
  const profile = warehousePortProfile(registry, request, network);
  expect(profile.automatic).toEqual([{ itemId: request.plan.targets[0]!.itemId, count: 2 }]);
  expect(warehouseMaximumRequest(request).options.solidOutput).toBe("warehouse");
  for (const warehouseSide of [0, 1, 2, 3]) {
    const boundary = new PlannerBoundary(registry, network, { width: warehouseSide % 2 ? 12 : 9, height: warehouseSide % 2 ? 9 : 12, warehouseSide });
    boundary.arrange(0);
    const poses = nodes.map(node => ({ ...node.entity.position, rotation: node.entity.rotation }));
    expect(boundary.resolve(poses).violations).toBe(0);
    expect(boundary.resolve(poses).busMask).toBe(1 << warehouseSide);
  }
  const itemId = request.plan.infiniteItemIds[0]!;
  const rules = new PlannerItemRules(registry, { ...request.options, itemPolicies: [{ itemId, supply: "external" }] });
  expect(rules.requiresWarehouseSupply(itemId)).toBe(true);
});

it("数值评分按完整规则计入连续性罚分", () => {
  const geometry = new Int32Array(3 * 4 * G);
  for (let i = 0; i < 3; i++) for (let turn = 0; turn < 4; turn++) {
    const offset = (i * 4 + turn) * G;
    geometry[offset] = 3; geometry[offset + 1] = 1; geometry[offset + 2] = 0;
    geometry[offset + 3] = 1; geometry[offset + 72] = 1; geometry[offset + 73] = 1;
  }
  const kernel = new PlannerLayoutKernel({ chains: 1, parameters: new Int32Array([3, 0, 12, 10, 1, 1, 8000, 1, 0, 0]),
    geometry, edges: new Int32Array(), overlaps: new Int32Array(9), poses: new Int32Array([0, 0, 0, 3, 0, 0, 6, 0, 0]) });
  const valid = kernel.score();
  kernel.poses[6] = 8;
  expect(kernel.score() - valid).toBe(10000);
});

it("第三档的零存货口与双存货口都能由真实 Worker 生成并通过 Dense 产率验收", async () => {
  const { NodePlannerClient } = await import("@/scripts/eda/node-planner-client");
  const { PlannerBatchSession } = await import("@/scripts/eda/planner-runner");
  const { saveSuccessfulPlanning } = await import("@/scripts/eda/artifacts");
  const { assertPlannerWarehousePorts, meetsProductionTargets } = await import("@/blueprint-planner/verification");
  const { createProductionNetwork } = await import("@/blueprint-planner/production-network");
  const { prepareProductionDevices } = await import("@/blueprint-planner/production-preparation");
  const { PlannerPlacement } = await import("@/blueprint-planner/placement");
  const { resolveSearchProfile } = await import("@/blueprint-planner/search-profile");
  const request = structuredClone(fixture.request) as BlueprintPlannerRequest;
  Object.assign(request.options, { warehousePortPlacement: "full-side", solidOutput: "auto", warehouseBus: "straight", itemPolicies: [], evaluationsPerRound: 20000 });
  const registry = createRegistryContract(), network = createProductionNetwork(registry, warehouseMaximumRequest(request));
  const searchProfile = resolveSearchProfile({ areaWeight: 0.4, congestionWeight: 2, fluidGroupSize: 2 });
  const placement = new PlannerPlacement(registry, 68, 1, 1, searchProfile.initialClearance, 1);
  placement.maximumX = 70;
  await prepareProductionDevices(registry, network, placement, 0, searchProfile,
    { strategy: "compact", stashPackingVariant: 0, conduitTopology: "shared" }, () => {});
  const profile = warehousePortProfile(registry, request, network);
  expect(warehouseStorageCounts(profile)).toEqual([0, 2]);
  const dimensions = partitionPlannerDimensions(400, { width: 3, height: 3 }, profile).flat().filter(value => value.warehouseSide === 0);
  const client = new NodePlannerClient(), session = new PlannerBatchSession();
  try {
    for (const [variant, dimension] of dimensions.entries()) {
      const assigned = warehouseCountRequest(request, profile, dimension.storageCount!, variant);
      const candidate = await client.build(assigned, variant, 20000, { targetOutline: dimension, maxEvaluations: 20000, strategy: "compact" });
      expect(() => assertPlannerWarehousePorts(registry, request, candidate)).not.toThrow();
      const report = await session.simulation.actions.runBlueprint(candidate.execution);
      expect(meetsProductionTargets(request, report)).toBe(true);
      await saveSuccessfulPlanning(registry, `warehouse-ports-regression-${dimension.storageCount}`, candidate.execution.blueprint,
        request, { report, metrics: candidate.metrics, search: candidate.search });
    }
  } finally { await client.dispose(); await session.dispose(); }
}, 60000);

it("正式 Host 按口数分片、收缩面积并导出可恢复检查点", async () => {
  const { PlannerBatchSession } = await import("@/scripts/eda/planner-runner");
  const { createBlueprintPlannerHost } = await import("@/blueprint-planner/blueprint-planner-host");
  const { parsePlannerTaskFile } = await import("@/blueprint-planner/task-checkpoint");
  const { saveSuccessfulPlanning } = await import("@/scripts/eda/artifacts");
  const request = structuredClone(fixture.request) as BlueprintPlannerRequest;
  Object.assign(request.options, { warehousePortPlacement: "full-side", solidOutput: "auto", warehouseBus: "straight", itemPolicies: [], evaluationsPerRound: 40000, concurrency: 1, gpu: false });
  const session = new PlannerBatchSession();
  session.workspace.simulation = session.simulation;
  const host = createBlueprintPlannerHost(session.workspace, { storage: null, worker: {
    build: (input, variant, _ms, budget, signal, update, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy) =>
      session.planner.build(input, variant, 20000, { maxEvaluations: budget, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy }, update, signal),
    dispose: () => { void session.planner.dispose(); },
  } });
  try {
    await host.whenSettled();
    const id = host.actions.start(request);
    await host.whenSettled();
    const file = parsePlannerTaskFile(JSON.parse(JSON.stringify(host.queries.exportTask(id))), session.workspace.registry);
    expect(file.progress.status).toBe("waiting");
    // AI-CORRECTION 2026-10-29：面积更新会作废未完成单元；不足完整 X 的尾额必须保留，不能凑满统计。
    expect(file.progress.roundEvaluatedProposals! + (file.checkpoint.unspentEvaluations ?? 0)).toBe(40000);
    expect(file.checkpoint.best).not.toBeNull();
    const schedule = file.checkpoint.parallel!.dimensionSchedule!;
    expect(schedule.warehousePorts?.automatic).toEqual([{ itemId: "item_filter_core", count: 2 }]);
    const best = file.checkpoint.best!;
    expect(schedule.targetArea).toBe(best.candidate.metrics.area);
    await saveSuccessfulPlanning(session.workspace.registry, "warehouse-ports-host-regression", best.candidate.execution.blueprint,
      request, { report: best.report, metrics: best.candidate.metrics, search: best.candidate.search });
  } finally { host.dispose(); await session.dispose(); }
}, 60000);
