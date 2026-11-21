// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerManualLayout, BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import type { PlannerNetwork } from "@/blueprint-planner/model";
import { createRegistryContract } from "@/registry";
import { assertManualFrameOutline, configureManualFrame, manualPositionOutlineConstraint } from "@/blueprint-planner/manual-frame";
import { partitionPlannerDimensions } from "@/blueprint-planner/dimension-schedule";
import { continuationOutline } from "@/blueprint-planner/search-outline";
import { isRectWithinManualBoundary, manualBoundarySceneBounds, projectManualBoundaryRect } from "@/shared/geometry/manual-boundary-position";
import { rotateManualPoint } from "@/shared/geometry/manual-layout-transform";
import { bindManualPositions, manualNodeView, manualLayoutSpace, assertManualLayoutReady, validateManualLayout } from "@/blueprint-planner/manual-constraints";
import { createPlainNode } from "@/blueprint-planner/placement";
import { capturePlannerSeed, restorePlannerSeed, plannerRequestKey } from "@/blueprint-planner/search-seed";
import { assertPlannerCandidateBounds, assertPlannerWarehousePorts } from "@/blueprint-planner/verification";
import { migrateTaskBlueprintSchemas } from "@/blueprint-planner/task-migration";
import { emptyPlannerCheckpoint, PLANNER_ALGORITHM_VERSION, type PlannerCheckpoint } from "@/blueprint-planner/task-checkpoint";
import type { PlannerCandidate } from "@/blueprint-planner/candidate";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import { prepareManualLayout } from "@/blueprint-planner/manual-layout";
import narrowTerminal from "./fixtures/manual-narrow-terminal.json";
import legacy from "./fixtures/legacy-boundary-task.json";
import fixture from "./fixtures/separator-core.json";

const registry = createRegistryContract();
function layout(rotation: 0 | 90 | 180 | 270, left: number | null, right: number | null): BlueprintPlannerManualLayout {
  return { enabled: true, mode: "recipe", orientation: "fixed", facilities: [], placements: [],
    boundary: { rotation, assignments: [], position: { base: 100, left, right } },
    preparation: { sourceKey: "", nodes: [], connections: [], facilityTemplates: [], placementIssues: [] } };
}
function network(manual: BlueprintPlannerManualLayout): PlannerNetwork {
  return { request: { ...structuredClone(fixture.request) as BlueprintPlannerRequest, manualLayout: manual },
    nodes: [], slotLinks: [], initialSlots: [], preferredGasCount: 0, baseSide: 2 };
}

it.each([0, 90, 180, 270] as const)("%s度：完整设备允许贴边，部分和全部跨底边均非法", rotation => {
  const manual = layout(rotation, -10, 14);
  const world = (x: number, y: number, width: number, height: number) => {
    const points = [{ x, y }, { x: x + width, y: y + height }].map(point => rotateManualPoint(point, rotation));
    return { x: Math.min(...points.map(point => point.x)), y: Math.min(...points.map(point => point.y)),
      width: Math.abs(points[1]!.x - points[0]!.x), height: Math.abs(points[1]!.y - points[0]!.y) };
  };
  expect(isRectWithinManualBoundary(world(-10, 95, 24, 5), manual)).toBe(true);
  expect(isRectWithinManualBoundary(world(-10, 96, 24, 5), manual)).toBe(false);
  expect(isRectWithinManualBoundary(world(-10, 101, 24, 5), manual)).toBe(false);
  expect(isRectWithinManualBoundary(world(-11, 95, 24, 5), manual)).toBe(false);
  expect(isRectWithinManualBoundary(world(-10, 95, 25, 5), manual)).toBe(false);
  expect(projectManualBoundaryRect(world(-10, 95, 24, 5), rotation)).toEqual({ x: -10, y: 95, width: 24, height: 5 });
  expect(manualLayoutSpace(network(manual).request).areas[0]!.bounds).toEqual(manualBoundarySceneBounds(manual));
});

for (const rotation of [0, 90, 180, 270] as const) {
  it.each([[null, null], [-10, null], [null, 14], [-10, 14]] as const)(`${rotation}度无设备先定位：%s/%s，续算保持锁定`, (left, right) => {
    const manual = layout(rotation, left, right), value = network(manual);
    const outline = { width: 24, height: 20 };
    configureManualFrame(registry, value, outline);
    expect(value.manualTransform!.rotation).toBe((360 - rotation) % 360);
    expect(value.manualBoundaryRotation).toBe(0);
    expect(() => assertManualFrameOutline(manual, value.manualTransform, outline)).not.toThrow();
    const smaller = { width: 24, height: 19 };
    configureManualFrame(registry, value, smaller, 1, true);
    expect(() => assertManualFrameOutline(manual, value.manualTransform, smaller)).not.toThrow();
    const forged = { ...value.manualTransform!, translation: { x: value.manualTransform!.translation.x + 1, y: value.manualTransform!.translation.y + 1 } };
    expect(() => assertManualFrameOutline(manual, forged, smaller)).toThrow("精确定位");
    const origin = { x: 8, y: -5 };
    const translated = { ...value.manualTransform!, translation: { x: value.manualTransform!.translation.x + origin.x, y: value.manualTransform!.translation.y + origin.y } };
    expect(() => assertManualFrameOutline(manual, translated, smaller, origin)).not.toThrow();
  });
}

it.each([0, 90, 180, 270] as const)("%s度双侧宽度由格线派生，调度及缩框保留24格并遵守已有30格上限", rotation => {
  const manual = layout(rotation, -10, 14), position = manualPositionOutlineConstraint(registry, manual)!;
  const dimensions = partitionPlannerDimensions(600, { width: 1, height: 1 }, undefined, true, 0,
    { mode: "straight", edge: 30 }, undefined, position).flat();
  expect(dimensions.length).toBeGreaterThan(0);
  expect(new Set(dimensions.map(value => `${value.width}/${value.height}`)).size).toBeLessThanOrEqual(70);
  expect(dimensions.every(value => value.width === 24)).toBe(true);
  const seed = { width: 24, height: 25 };
  const smaller = continuationOutline(seed, 0, 0, { width: 1, height: 1 }, undefined, undefined, position);
  expect(smaller.width * smaller.height).toBeLessThan(600);
  expect(smaller.width).toBe(24);
  const conflict = { ...position, exactWidth: 32, minimumWidth: 32 };
  expect(partitionPlannerDimensions(600, { width: 1, height: 1 }, undefined, true, 0,
    { mode: "straight", edge: 30 }, undefined, conflict).flat()).toHaveLength(0);
});

it("不完整草稿空间查询保留修正入口；倒序双侧阻止求解", () => {
  const manual = layout(0, 10, -10);
  expect(manualLayoutSpace(network(manual).request).areas[0]!.bounds).toEqual({ minX: null, minY: null, maxX: null, maxY: null });
  expect(() => assertManualLayoutReady(registry, network(manual).request, false)).toThrow("正宽度");
  expect(manualBoundarySceneBounds({ ...manual, orientation: "free" })).toEqual({ minX: null, minY: null, maxX: null, maxY: null });
});

it("真实设备网络的定位经过seed恢复与最终交付复核，篡改变换、尺寸或原点均拒绝", () => {
  const node = createPlainNode(registry, "power_diffuser_1", "locked-power", "power");
  const referenceNode = manualNodeView(node);
  const manual: BlueprintPlannerManualLayout = { ...layout(0, -10, 14),
    placements: [{ referenceNode, position: { x: -5, y: 80 }, rotation: 0 }],
    preparation: { ...layout(0, -10, 14).preparation, nodes: [referenceNode] } };
  const value = { ...network(manual), nodes: [node] };
  const outline = { width: 24, height: 25, baseSide: 2 };
  configureManualFrame(registry, value, outline);
  bindManualPositions(registry, value);
  const seed = capturePlannerSeed(value.request, value, [], [], outline.width, outline.height);
  const restored = restorePlannerSeed(registry, value.request, seed);
  expect(restored.network.nodes[0]!.entity.position).toEqual(node.entity.position);
  expect(() => assertManualFrameOutline(manual, restored.network.manualTransform, seed)).not.toThrow();
  const forged = structuredClone(seed);
  Object.assign(forged.network.manualTransform!, { translation: { x: forged.network.manualTransform!.translation.x + 1, y: forged.network.manualTransform!.translation.y } });
  expect(() => restorePlannerSeed(registry, value.request, forged)).toThrow();
  expect(() => restorePlannerSeed(registry, value.request, { ...seed, width: 23 })).toThrow("精确定位");
  const original = structuredClone(legacy.file) as unknown as BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest; checkpoint: PlannerCheckpoint };
  const baseline = original.checkpoint.best!.candidate;
  const candidate: PlannerCandidate = { ...baseline, seed, manualTransform: value.manualTransform,
    metrics: { ...baseline.metrics, ...outline, area: 600, entityCount: 1 }, search: { ...baseline.search, outline },
    execution: { ...baseline.execution, blueprint: createBlueprintDocument({ baseId: value.request.plan.sourceBaseId,
      name: "定位验收", initialGridPoint: { x: 0, y: 0 }, entityOrder: [node.entity.id], entities: { [node.entity.id]: node.entity }, slotLinks: [] }) } };
  expect(() => assertPlannerCandidateBounds(registry, candidate)).not.toThrow();
  expect(() => assertPlannerWarehousePorts(registry, value.request, candidate)).not.toThrow();
  expect(() => assertPlannerWarehousePorts(registry, value.request, { ...candidate, metrics: { ...candidate.metrics, width: 23, area: 575 } })).toThrow("精确定位");
  expect(() => assertPlannerWarehousePorts(registry, value.request, { ...candidate, outlineOrigin: { x: 1, y: 0 } })).toThrow("精确定位");
  Object.assign(original, { algorithmVersion: PLANNER_ALGORITHM_VERSION, request: value.request,
    checkpoint: { ...emptyPlannerCheckpoint(), best: { ...original.checkpoint.best!, candidate } } });
  const exported = JSON.parse(JSON.stringify(original)) as typeof original;
  const imported = migrateTaskBlueprintSchemas(exported) as typeof original;
  expect(imported.request.manualLayout!.boundary.position).toEqual(manual.boundary.position);
  expect(() => assertPlannerWarehousePorts(registry, imported.request, imported.checkpoint.best!.candidate)).not.toThrow();
  expect(restorePlannerSeed(registry, imported.request, imported.checkpoint.best!.candidate.seed!).network.manualTransform).toEqual(value.manualTransform);
  Reflect.deleteProperty(exported.request.manualLayout!.boundary, "position");
  Reflect.deleteProperty(exported.checkpoint.best!.candidate.seed!.network.request.manualLayout!.boundary, "position");
  const oldKey = JSON.parse(exported.checkpoint.best!.candidate.seed!.requestKey) as BlueprintPlannerRequest;
  Reflect.deleteProperty(oldKey.manualLayout!.boundary, "position");
  Object.assign(exported.checkpoint.best!.candidate.seed!, { requestKey: plannerRequestKey(oldKey) });
  const upgraded = migrateTaskBlueprintSchemas(exported) as typeof original;
  expect(upgraded.request.manualLayout!.boundary.position).toBeNull();
  expect(upgraded.checkpoint.best!.candidate.seed!.network.request.manualLayout!.boundary.position).toBeNull();
});

it("双侧零宽以及安全整数格线相减溢出均拒绝启动", () => {
  for (const [left, right] of [[5, 5], [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]]) {
    expect(() => assertManualLayoutReady(registry, network(layout(0, left!, right!)).request, false)).toThrow("正宽度");
  }
});

it.each([
  { base: Number.MAX_SAFE_INTEGER + 1, left: null, right: null },
  { base: 100, left: -Number.MAX_SAFE_INTEGER - 1, right: null },
  { base: 100, left: null, right: Number.MAX_SAFE_INTEGER + 1 },
])("拒绝非安全整数边界格线：%j", position => {
  const manual = layout(0, null, null);
  const request = network({ ...manual, boundary: { ...manual.boundary, position } }).request;
  expect(() => assertManualLayoutReady(registry, request, false)).toThrow("安全整数");
});

it.each([
  { orientation: "free" as const, rotation: 0 as const },
  // AI-REMOVED 2026-11-21: Reason: 新版固定朝向不再要求方向选择；Trigger: 双轴定位契约；Evidence: rotation:null按0执行；Replacement: 下方固定null正例；Risk: Low；Human Review: Required
  // { orientation: "fixed" as const, rotation: null },
  { orientation: "free" as const, rotation: null },
])("非UI绝对模式拒绝不完整条件：%j", ({ orientation, rotation }) => {
  const original = layout(0, -10, 14);
  const manual = { ...original, orientation, boundary: { ...original.boundary, rotation } };
  const value = network(manual);
  // 前两步仍可保存和修正草稿；执行入口不得把position当作休眠配置放行。
  expect(() => validateManualLayout(registry, value.request)).not.toThrow();
  expect(() => assertManualLayoutReady(registry, value.request, false)).toThrow("按边界定位要求");
  expect(() => configureManualFrame(registry, value, { width: 24, height: 20 })).toThrow("按边界定位要求");
  expect(() => manualPositionOutlineConstraint(registry, manual)).toThrow("按边界定位要求");
  expect(() => assertManualFrameOutline(manual, { rotation: 0, translation: { x: 10, y: -80 } }, { width: 24, height: 20 })).toThrow("按边界定位要求");
  const legal = network(original);
  configureManualFrame(registry, legal, { width: 24, height: 20 });
  const seed = capturePlannerSeed(legal.request, legal, [], [], 24, 20);
  const changedSeed = { ...seed, requestKey: plannerRequestKey(value.request), network: { ...seed.network, request: value.request } };
  expect(() => restorePlannerSeed(registry, value.request, changedSeed)).toThrow("按边界定位要求");
  const disabled = { ...manual, enabled: false };
  expect(() => assertManualLayoutReady(registry, network(disabled).request, false)).not.toThrow();
  expect(() => configureManualFrame(registry, network(disabled), { width: 24, height: 20 })).not.toThrow();
  expect(manualPositionOutlineConstraint(registry, disabled)).toBeUndefined();
});

it.each(["free", "fixed"] as const)("相对模式%s保持无界，不要求底边方向", orientation => {
  const original = layout(0, null, null);
  const manual = { ...original, orientation, boundary: { ...original.boundary, rotation: null, position: null } };
  expect(manualBoundarySceneBounds(manual)).toEqual({ minX: null, maxX: null, minY: null, maxY: null });
  expect(() => assertManualLayoutReady(registry, network(manual).request, false)).not.toThrow();
  expect(manualPositionOutlineConstraint(registry, manual)).toBeUndefined();
});

it.each([0, 90, 180, 270] as const)("%s度固定双侧只确定宽度，改变纵深仍满足同一三条边", rotation => {
  const manual = layout(rotation, -10, 14), value = network(manual);
  const first = { width: 24, height: 20 };
  const deeper = { width: 24, height: 30 };
  configureManualFrame(registry, value, first);
  const firstTransform = value.manualTransform!;
  configureManualFrame(registry, value, deeper, 0, true);
  expect(() => assertManualFrameOutline(manual, value.manualTransform, deeper)).not.toThrow();
  const firstRect = { x: -firstTransform.translation.x, y: -firstTransform.translation.y, ...first };
  const deeperRect = { x: -value.manualTransform!.translation.x, y: -value.manualTransform!.translation.y, ...deeper };
  expect(firstRect).toMatchObject({ y: 80, width: 24, height: 20 });
  expect(deeperRect).toMatchObject({ y: 70, width: 24, height: 30 });
  const bounds = manualBoundarySceneBounds(manual);
  expect([bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].filter(bound => bound === null)).toHaveLength(1);
  const position = manualPositionOutlineConstraint(registry, manual)!;
  const firstDimensions = partitionPlannerDimensions(480, { width: 1, height: 1 }, undefined, true, 0, undefined, undefined, position).flat();
  const deeperDimensions = partitionPlannerDimensions(720, { width: 1, height: 1 }, undefined, true, 0, undefined, undefined, position).flat();
  expect(firstDimensions.some(dimension => dimension.width === first.width && dimension.height === first.height)).toBe(true);
  expect(deeperDimensions.some(dimension => dimension.width === deeper.width && dimension.height === deeper.height)).toBe(true);
});

it.each([
  { orientation: "free" as const, rotation: 0 as const },
  // AI-REMOVED 2026-11-21: Reason: 新版固定朝向不再要求方向选择；Trigger: 双轴定位契约；Evidence: rotation:null按0执行；Replacement: 下方固定null正例；Risk: Low；Human Review: Required
  // { orientation: "fixed" as const, rotation: null },
  { orientation: "free" as const, rotation: null },
])("已有固定存取口的不完整绝对草稿仍可准备清单，不能执行：%j", async ({ orientation, rotation }) => {
  const original = structuredClone(narrowTerminal) as BlueprintPlannerRequest;
  const source = original.manualLayout!;
  const manual = { ...source, orientation, boundary: { ...source.boundary, rotation, position: { base: 13, left: 0, right: 3 } },
    preparation: { ...source.preparation, connections: [] } };
  const request = { ...original, manualLayout: manual };
  const before = structuredClone(request);
  const prepared = await prepareManualLayout(registry, request);
  expect(prepared.nodes.length).toBeGreaterThan(0);
  expect(request).toEqual(before);
  expect(() => assertManualLayoutReady(registry, { ...request, manualLayout: { ...manual, preparation: prepared } })).toThrow("按边界定位要求");
});

it("Y双端精确限定高度，X自由保留横向伸缩；交付篡改高度或顶线均拒绝", () => {
  const original = layout(0, null, null);
  const manual = { ...original, boundary: { ...original.boundary, position: { base: 24, top: 0, left: null, right: null } } };
  const value = network(manual);
  const constraint = manualPositionOutlineConstraint(registry, manual)!;
  expect(constraint).toMatchObject({ exactHeight: 24, minimumHeight: 24 });
  const dimensions = partitionPlannerDimensions(720, { width: 1, height: 1 }, undefined, true, 0,
    undefined, undefined, constraint).flat();
  expect(dimensions.length).toBeGreaterThan(0);
  expect(dimensions.every(item => item.height === 24)).toBe(true);
  expect(new Set(dimensions.map(item => item.width)).size).toBeGreaterThan(1);
  configureManualFrame(registry, value, { width: 26, height: 24 });
  expect(value.manualTransform!.rotation).toBe(0);
  expect(() => assertManualFrameOutline(manual, value.manualTransform, { width: 26, height: 24 })).not.toThrow();
  expect(() => assertManualFrameOutline(manual, value.manualTransform, { width: 26, height: 25 })).toThrow();
  expect(() => assertManualFrameOutline(manual, value.manualTransform, { width: 26, height: 24 }, { x: 0, y: 1 })).toThrow();
});

it.each([
  { base: null, top: NaN, left: null, right: null },
  { base: null, top: Infinity, left: null, right: null },
  { base: null, top: 0.5, left: null, right: null },
  { base: 24, top: 24, left: null, right: null },
  { base: 23, top: 24, left: null, right: null },
  { base: Number.MAX_SAFE_INTEGER, top: -Number.MAX_SAFE_INTEGER, left: null, right: null },
])("非法Y轴格线阻止启动：%j", position => {
  const original = layout(0, null, null);
  const manual = { ...original, boundary: { ...original.boundary, position } };
  expect(() => assertManualLayoutReady(registry, network(manual).request, false)).toThrow();
});


it("固定方向未选择旧方向也可执行，按草稿实际朝向0定位", () => {
  const original = layout(0, null, null);
  const manual = { ...original, boundary: { ...original.boundary, rotation: null } };
  const value = network(manual);
  expect(() => assertManualLayoutReady(registry, value.request, false)).not.toThrow();
  configureManualFrame(registry, value, { width: 24, height: 20 });
  expect(value.manualTransform!.rotation).toBe(0);
  expect(() => assertManualFrameOutline(manual, value.manualTransform, { width: 24, height: 20 })).not.toThrow();
});
