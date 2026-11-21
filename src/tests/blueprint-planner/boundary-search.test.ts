// @vitest-environment node
import type { GridRotation } from "@/domain/shared/grid";
import { rotateLocalGridRect } from "@/shared/geometry/grid";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { EDGES, opposite, getPlannerPorts } from "@/blueprint-planner/geometry";
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { PlannerBoundary } from "@/blueprint-planner/boundary";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { createPlainNode } from "@/blueprint-planner/placement";
import { plannerBusConflictCount, PLANNER_LAYOUT_GEOMETRY_STRIDE as G } from "@/blueprint-planner/layout-backend";
import { PlannerLayoutKernel } from "@/blueprint-planner/cpu-layout";
import type { PlannerNetwork } from "@/blueprint-planner/model";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import fixture from "./fixtures/separator-core.json";

it.each([0, 1, 2, 3])("草稿第 %s 边等价对准底边时，整组初排补齐缺口并保留固定姿态", side => {
  const registry = createRegistryContract();
  const nodes = Array.from({ length: 6 }, (_, i) => createPlainNode(registry, "unloader_1", `gap-${i}`, "supply"));
  const input = structuredClone(fixture.request) as BlueprintPlannerRequest;
  const network: PlannerNetwork = { request: { ...input, options: { ...input.options, warehousePortPlacement: "continuous", warehouseBus: "straight" } },
    nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 };
  const frame = { width: 36, height: 36 }, boundary = new PlannerBoundary(registry, network, { ...frame, warehouseSide: 2 });
  const sourceRotation = (((side - 2 + 4) % 4) * 90) as GridRotation;
  const targetRotation = ((360 - sourceRotation) % 360) as GridRotation;
  const poses = nodes.map((node, index) => {
    const canonical = boundary.proposals(index).find(pose => pose.x === 8 + index * 3)!;
    const canonicalEntity = { ...node.entity, position: { x: canonical.x, y: canonical.y }, rotation: canonical.rotation };
    const draftRect = rotateLocalGridRect(resolveEntityGridRect({ entity: canonicalEntity, definition: node.definition }), frame, sourceRotation);
    const draft = { ...canonicalEntity, position: { x: draftRect.x, y: draftRect.y }, rotation: ((canonical.rotation + sourceRotation) % 360) as GridRotation };
    expect(EDGES.indexOf(opposite(getPlannerPorts(registry, draft, node.definition, "output")[0]!.edge))).toBe(side);
    const final = rotateLocalGridRect(resolveEntityGridRect({ entity: draft, definition: node.definition }), frame, targetRotation);
    return { x: final.x, y: final.y, rotation: ((draft.rotation + targetRotation) % 360) as GridRotation };
  });
  const before = structuredClone(poses);
  const repaired = boundary.arrange(0, { poses, movable: new Set([1, 2, 3]) });
  expect(boundary.resolve(repaired).violations).toBe(0);
  for (const index of [0, 4, 5]) expect(repaired[index]).toEqual(before[index]);
  expect(repaired.map(pose => pose.x).sort((a, b) => a - b)).toEqual([8, 11, 14, 17, 20, 23]);
  expect(poses).toEqual(before);
});

it("六个入口可整组从短边迁到长边，提案不修改网表且不移动固定节点", () => {
  const registry = createRegistryContract(), nodes = Array.from({ length: 6 }, (_, i) => createPlainNode(registry, "unloader_1", `dock-${i}`, "supply"));
  const network: PlannerNetwork = { request: fixture.request as BlueprintPlannerRequest, nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 };
  const boundary = new PlannerBoundary(registry, network, { width: 54, height: 11 });
  // AI-CORRECTION 2026-11-21：非法初态直接按真实占地造样，不能要求合法proposal返回西边。
  // Original code: const poses = nodes.map((_, i) => boundary.proposals(i).find(pose => boundary.entries[i]!.geometry[pose.rotation / 90]!.edge === (i === 5 ? "SOUTH" : "WEST"))!);
  const poses = nodes.map((_, i) => i === 5 ? boundary.proposals(i).find(pose => boundary.entries[i]!.geometry[pose.rotation / 90]!.edge === "SOUTH")!
    : { x: 0, y: 0, rotation: 270 as GridRotation });
  const before = structuredClone(nodes.map(node => node.entity));
  const arranged = boundary.arrange(0, { poses, movable: new Set([0, 1, 2, 3, 4]) });
  expect(arranged[5]).toEqual(poses[5]);
  expect(boundary.resolve(arranged)).toEqual({ busMask: 4, violations: 0 });
  expect(new Set(arranged.map(pose => `${pose.x}/${pose.y}`)).size).toBe(6);
  expect(nodes.map(node => node.entity)).toEqual(before);
});

it.each(["compact", "baseline"] as const)("%s：两个固定入口面冲突时仍允许其他设备修复重叠，但不能交付违规布局", async strategy => {
  const registry = createRegistryContract();
  const nodes = [createPlainNode(registry, "unloader_1", "north", "supply"), createPlainNode(registry, "unloader_1", "south", "supply"),
    createPlainNode(registry, "storager_1", "moving", "logistics")];
  const network: PlannerNetwork = { request: fixture.request as BlueprintPlannerRequest, nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 };
  const outline = { width: 20, height: 20 }, boundary = new PlannerBoundary(registry, network, outline);
  for (const [i, edge] of ["NORTH", "SOUTH"].entries()) {
    // 非法的固定北口仍是完整真实实体，用于验证不能修复的面冲突，而非合法proposal。
    const pose = edge === "NORTH" ? { x: 0, y: 0, rotation: 0 as GridRotation } : { x: 0, y: 19, rotation: 180 as GridRotation };
    Object.assign(nodes[i]!.entity, { position: { x: pose.x, y: pose.y }, rotation: pose.rotation });
  }
  nodes[2]!.entity.position = { ...nodes[0]!.entity.position };
  const fixed = structuredClone(nodes.slice(0, 2).map(node => node.entity));
  const statistics: PlannerSearchStatistics = { seed: 11, strategy, experiments: ["constraint-repair"], evaluationLimit: 256,
    evaluations: 0, acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline };
  const search = new CompactLayoutSearch(registry, network, [], statistics, undefined, undefined, new Set(["north", "south"]));
  expect(await search.advance(256, () => {})).toBe(false);
  expect(statistics.evaluations).toBe(256);
  expect(statistics.acceptedMoves).toBeGreaterThan(0);
  expect(statistics.layoutBestCost).toBeLessThan(statistics.layoutInitialCost!);
  search.applyBest();
  expect(nodes.slice(0, 2).map(node => node.entity)).toEqual(fixed);
  expect(boundary.resolve(nodes.map(node => ({ ...node.entity.position, rotation: node.entity.rotation }))).violations).toBeGreaterThan(0);
});

it("逐口面冲突有下降梯度，数值执行器与完整边界使用同一距离", () => {
  expect(plannerBusConflictCount(1, [3, 0, 3, 0], [0, 0, 0, 0])).toBe(3);
  expect(plannerBusConflictCount(1, [4, 0, 2, 0], [0, 0, 0, 0])).toBe(2);
  expect(plannerBusConflictCount(2, [1, 0, 1, 0], [0, 0, 0, 0])).toBe(1);
  expect(plannerBusConflictCount(3, [1, 0, 1, 0], [0, 0, 0, 0])).toBe(0);
  const geometry = new Int32Array(6 * 4 * G);
  for (let i = 0; i < 6; i++) for (let turn = 0; turn < 4; turn++) {
    const at = (i * 4 + turn) * G;
    geometry[at] = 1; geometry[at + 1] = 1; geometry[at + 2] = turn; geometry[at + 3] = 1;
  }
  const kernel = new PlannerLayoutKernel({ chains: 1, geometry, edges: new Int32Array(), overlaps: new Int32Array(36),
    parameters: new Int32Array([6, 0, 20, 20, 1, 123, 8000, 1, 0, 0]),
    poses: new Int32Array(Array.from({ length: 6 }, (_, i) => [i * 2, 5, i < 3 ? 0 : 2]).flat()) });
  expect(kernel.score()).toBe(30000);
  kernel.poses[3 * 3 + 2] = 0;
  expect(kernel.score()).toBe(20000);
});

it.each(["compact", "baseline"] as const)("%s：默认搜索无需实验开关即可将短边拥挤入口迁到长边", async strategy => {
  const registry = createRegistryContract();
  const nodes = Array.from({ length: 6 }, (_, index) => createPlainNode(registry, "unloader_1", `dock-${index}`, "supply"));
  const network: PlannerNetwork = { request: fixture.request as BlueprintPlannerRequest, nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 };
  const outline = { width: 54, height: 11 }, boundary = new PlannerBoundary(registry, network, outline);
  for (const [index, node] of nodes.entries()) {
    // AI-CORRECTION 2026-11-21：不合法西侧拥挤初态用真实unloader占地造样，合法提案只返回南边。
    // Original code: const pose = boundary.proposals(index).find(pose => boundary.entries[index]!.geometry[pose.rotation / 90]!.edge === (index === 5 ? "SOUTH" : "WEST"))!;
    const pose = index === 5 ? boundary.proposals(index).find(pose => boundary.entries[index]!.geometry[pose.rotation / 90]!.edge === "SOUTH")!
      : { x: 0, y: 0, rotation: 270 as GridRotation };
    node.entity.position = { x: pose.x, y: pose.y }; node.entity.rotation = pose.rotation;
  }
  const statistics: PlannerSearchStatistics = { seed: 11, strategy, evaluationLimit: 256,
    evaluations: 0, acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline };
  const search = new CompactLayoutSearch(registry, network, [], statistics);
  expect(await search.advance(256, () => {})).toBe(true);
  search.applyBest();
  const resolved = boundary.resolve(nodes.map(node => ({ ...node.entity.position, rotation: node.entity.rotation })));
  expect(resolved.violations).toBe(0);
  // AI-CORRECTION 2026-11-21：最终只能交付南侧底边，保留默认修复成功断言。
  // Original assertion: expect([1, 4]).toContain(resolved.busMask);
  expect(resolved.busMask).toBe(4);
  expect(statistics.acceptedMoves).toBeGreaterThan(0);
  expect(statistics.evaluations).toBe(256);
});

// AI-REMOVED 2026-11-21:
// Reason: 生产不能以北/东/西为最终底边；四向草稿先用真实矩形刚体等价投影到南边，保留全部固定/缺口/输入不变断言。
// Trigger: 固定生产布局南向。Evidence: normal首轮边向拒绝。
// Replacement: 上方等价几何用例。Risk: Low。Human Review: Required
// Original code:
// it.each([0, 1, 2, 3])("第 %s 边的固定存取口之间缺少多个入口时，整组初排补齐空缺且保留固定姿态", side => {
//   const registry = createRegistryContract();
//   const nodes = Array.from({ length: 6 }, (_, i) => createPlainNode(registry, "unloader_1", `gap-${i}`, "supply"));
//   const input = structuredClone(fixture.request) as BlueprintPlannerRequest;
//   const network: PlannerNetwork = { request: { ...input, options: { ...input.options, warehousePortPlacement: "continuous", warehouseBus: "straight" } },
//     nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 };
//   const boundary = new PlannerBoundary(registry, network, { width: 36, height: 36, warehouseSide: side });
//   const horizontal = side % 2 === 0;
//   const poses = nodes.map((_, index) => boundary.proposals(index).find(pose => (horizontal ? pose.x : pose.y) === 8 + index * 3)!);
//   const before = structuredClone(poses);
//   const repaired = boundary.arrange(0, { poses, movable: new Set([1, 2, 3]) });
//   expect(boundary.resolve(repaired).violations).toBe(0);
//   for (const index of [0, 4, 5]) expect(repaired[index]).toEqual(before[index]);
//   expect(repaired.map(pose => horizontal ? pose.x : pose.y).sort((a, b) => a - b)).toEqual([8, 11, 14, 17, 20, 23]);
//   expect(poses).toEqual(before);
// });

// AI-REMOVED 2026-11-21:
// Reason: 合法proposal不再提供北边；冲突负例仍保留真实北/南两固定口和不能交付的强断言。
// Trigger: 固定生产布局南向。Evidence: normal首轮边向拒绝。
// Replacement: 上方等价几何用例。Risk: Low。Human Review: Required
// Original code:
//     const pose = boundary.proposals(i).find(pose => boundary.entries[i]!.geometry[pose.rotation / 90]!.edge === edge)!;
//     Object.assign(nodes[i]!.entity, { position: { x: pose.x, y: pose.y }, rotation: pose.rotation });
