// @vitest-environment node
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { prepareManualLayout, createManualProductionNetwork, stabilizeManualNodes } from "@/blueprint-planner/manual-layout";
import { assertManualLayoutReady, bindManualPositions, manualLayoutSpace, validateManualLayout } from "@/blueprint-planner/manual-constraints";
import { configureManualFrame, manualFrameBounds, manualWarehouseMask } from "@/blueprint-planner/manual-frame";
import { PlannerBoundary } from "@/blueprint-planner/boundary";
import { createPlainNode, PlannerPlacement } from "@/blueprint-planner/placement";
import { prepareProductionDevices } from "@/blueprint-planner/production-preparation";
import { resolveSearchProfile } from "@/blueprint-planner/search-profile";
import { capturePlannerSeed, restorePlannerSeed } from "@/blueprint-planner/search-seed";
import { transformManualPlacement } from "@/shared/geometry/manual-layout-transform";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { PlannerLayoutKernel } from "@/blueprint-planner/cpu-layout";
import { PLANNER_LAYOUT_GEOMETRY_STRIDE as G, plannerBusConflictCount } from "@/blueprint-planner/layout-backend";
import fixture from "./fixtures/separator-core.json";

const registry = createRegistryContract();

it("数值搜索对每个口执行所属边吸附，存取线掩码排除相反方向", () => {
  const geometry = new Int32Array(4 * G);
  for (let turn = 0; turn < 4; turn++) {
    const start = turn * G;
    geometry[start] = turn % 2 ? 1 : 3; geometry[start + 1] = turn % 2 ? 3 : 1;
    geometry[start + 2] = turn; geometry[start + 3] = 1;
    geometry[start + 75] = 3; geometry[start + 76] = 3;
  }
  const input = { chains: 1, parameters: new Int32Array([1, 0, 10, 10, 50, 123, 8000, 1, 0, 0]),
    geometry, edges: new Int32Array(), overlaps: new Int32Array(1), poses: new Int32Array([2, 0, 0]) };
  const kernel = new PlannerLayoutKernel(input);
  const legal = new PlannerLayoutKernel({ ...input, poses: new Int32Array([9, 2, 1]) });
  expect(kernel.score()).toBeGreaterThan(legal.score() + 9000);
  for (let index = 0; index < 50; index++) {
    kernel.propose();
    expect(kernel.poses[2]).toBe(1);
    expect(kernel.poses[0]).toBe(9);
  }
  expect(plannerBusConflictCount(3, [0, 1, 0, 1], [0, 0, 0, 0], 14)).toBe(0);
  expect(plannerBusConflictCount(3, [0, 1, 0, 1], [0, 0, 1, 0], 14)).toBe(1);
});
async function prepared(): Promise<BlueprintPlannerRequest> {
  const request: BlueprintPlannerRequest = { ...structuredClone(fixture.request) as BlueprintPlannerRequest,
    manualLayout: { enabled: true, mode: "recipe", orientation: "fixed", boundary: { rotation: 0, assignments: [] },
      facilities: [], placements: [], preparation: { sourceKey: "", nodes: [], connections: [], facilityTemplates: [], placementIssues: [] } } };
  return { ...request, manualLayout: { ...request.manualLayout!, preparation: await prepareManualLayout(registry, request) } };
}

it.each([0, 90, 180, 270] as const)("非正方形设备整体旋转 %s 度保留完整占地，四次旋转回到原位", rotation => {
  const node = createPlainNode(registry, "unloader_1", "test", "supply");
  const placement = { referenceNode: { id: "test", definitionId: node.definition.id, recipeId: null, purpose: "supply" as const, inputs: [], outputs: [] },
    position: { x: -12, y: 7 }, rotation: 90 as const };
  const rect = resolveEntityGridRect({ definition: node.definition, entity: { ...node.entity, ...placement } });
  const expected = rotation === 0 ? { x: rect.x, y: rect.y } : rotation === 90 ? { x: -rect.y - rect.height, y: rect.x }
    : rotation === 180 ? { x: -rect.x - rect.width, y: -rect.y - rect.height } : { x: rect.y, y: -rect.x - rect.width };
  const transformed = transformManualPlacement(placement, node.definition, { rotation, translation: { x: 20, y: 30 } });
  expect(transformed.position).toEqual({ x: expected.x + 20, y: expected.y + 30 });
  expect(transformed.rotation).toBe((90 + rotation) % 360);
  let full = placement;
  for (let index = 0; index < 4; index++) full = transformManualPlacement(full, node.definition, { rotation: 90, translation: { x: 0, y: 0 } }) as typeof full;
  expect(full).toEqual(placement);
});

it("无界草稿接受负坐标和远离原点的设备群，有限搜索按跨度归一化", async () => {
  const request = await prepared(), manual = request.manualLayout!;
  const referenceNode = manual.preparation.nodes.find(node => node.purpose === "production")!;
  const current = { ...request, manualLayout: { ...manual, placements: [{ referenceNode, position: { x: -1200, y: 800 }, rotation: 0 as const }] } };
  current.manualLayout.preparation = await prepareManualLayout(registry, current);
  expect(() => assertManualLayoutReady(registry, current)).not.toThrow();
  expect(manualLayoutSpace(current).areas[0]!.bounds).toEqual({ minX: null, minY: null, maxX: null, maxY: null });
  const bounds = manualFrameBounds(registry, current.manualLayout, 0);
  expect(bounds.x).toBe(-1200);
  const network = createManualProductionNetwork(registry, current);
  configureManualFrame(registry, network, { width: 25, height: 20 });
  bindManualPositions(registry, network, 0, false);
  const entity = network.nodes.find(node => node.manualPlacement)!.entity;
  expect(entity.position).toEqual({ x: Math.floor((25 - bounds.width) / 2), y: Math.floor((20 - bounds.height) / 2) });
  expect(entity.rotation).toBe(0);
});

it("存取口只关联所属边；边方向、种子恢复与独立边界裁判保持一致", async () => {
  const request = await prepared(), manual = request.manualLayout!;
  const referenceNode = manual.preparation.nodes.find(node => node.definitionId === "unloader_1")!;
  const current = { ...request, options: { ...request.options, warehouseBus: "u-shaped" as const }, manualLayout: { ...manual,
    orientation: "free" as const, boundary: { rotation: 90 as const, assignments: [{ referenceNode, side: "left" as const }] } } };
  current.manualLayout.preparation = await prepareManualLayout(registry, current);
  expect(() => assertManualLayoutReady(registry, current)).not.toThrow();
  const network = createManualProductionNetwork(registry, current);
  configureManualFrame(registry, network, { width: 35, height: 35 }, 1);
  const placement = new PlannerPlacement(registry, 35, 1, 1, 1, 1);
  await prepareProductionDevices(registry, network, placement, 0, resolveSearchProfile(), { strategy: "compact" }, () => {});
  stabilizeManualNodes(registry, network, current.manualLayout.preparation);
  bindManualPositions(registry, network);
  expect(network.manualTransform!.rotation).toBe(90);
  expect(network.manualBoundaryRotation).toBe(180);
  expect(manualWarehouseMask(network)).toBe(11);
  const index = network.nodes.findIndex(node => node.manualBoundaryReference?.id === referenceNode.id);
  expect(network.nodes[index]!.manualPlacement).toBeUndefined();
  const boundary = new PlannerBoundary(registry, network, { width: 35, height: 35 });
  expect(boundary.allowedSides(index)).toBe(2);
  expect(boundary.proposals(index).every(pose => boundary.entries.find(entry => entry.index === index)!.geometry[pose.rotation / 90]!.edge === "EAST")).toBe(true);
  const seed = capturePlannerSeed(current, network, [], [], 35, 35);
  expect(restorePlannerSeed(registry, current, seed).network.nodes[index]!.manualBoundarySide).toBe(1);
  const forged = structuredClone(seed); forged.network.manualBoundaryRotation = 0;
  expect(() => restorePlannerSeed(registry, current, forged)).toThrow("方向");
  expect(() => validateManualLayout(registry, { ...current, manualLayout: { ...current.manualLayout,
    placements: [{ referenceNode, position: { x: 0, y: 0 }, rotation: 0 }] } })).toThrow();
  const narrowed = { ...current, options: { ...current.options, warehouseBus: "straight" as const } };
  const preparation = await prepareManualLayout(registry, narrowed);
  expect(preparation.placementIssues).toContainEqual({ kind: "boundary-side-unavailable", nodeIds: [referenceNode.id] });
  expect(() => assertManualLayoutReady(registry, { ...narrowed, manualLayout: { ...narrowed.manualLayout, preparation } })).toThrow("标红");
});
