// @vitest-environment node
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

it("六个入口可整组从短边迁到长边，提案不修改网表且不移动固定节点", () => {
  const registry = createRegistryContract(), nodes = Array.from({ length: 6 }, (_, i) => createPlainNode(registry, "unloader_1", `dock-${i}`, "supply"));
  const network: PlannerNetwork = { request: fixture.request as BlueprintPlannerRequest, nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 };
  const boundary = new PlannerBoundary(registry, network, { width: 54, height: 11 });
  const poses = nodes.map((_, i) => boundary.proposals(i).find(pose => boundary.entries[i]!.geometry[pose.rotation / 90]!.edge === (i === 5 ? "SOUTH" : "WEST"))!);
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
    const pose = boundary.proposals(i).find(pose => boundary.entries[i]!.geometry[pose.rotation / 90]!.edge === edge)!;
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
    const pose = boundary.proposals(index).find(pose => boundary.entries[index]!.geometry[pose.rotation / 90]!.edge === (index === 5 ? "SOUTH" : "WEST"))!;
    node.entity.position = { x: pose.x, y: pose.y }; node.entity.rotation = pose.rotation;
  }
  const statistics: PlannerSearchStatistics = { seed: 11, strategy, evaluationLimit: 256,
    evaluations: 0, acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline };
  const search = new CompactLayoutSearch(registry, network, [], statistics);
  expect(await search.advance(256, () => {})).toBe(true);
  search.applyBest();
  const resolved = boundary.resolve(nodes.map(node => ({ ...node.entity.position, rotation: node.entity.rotation })));
  expect(resolved.violations).toBe(0);
  expect([1, 4]).toContain(resolved.busMask);
  expect(statistics.acceptedMoves).toBeGreaterThan(0);
  expect(statistics.evaluations).toBe(256);
});
