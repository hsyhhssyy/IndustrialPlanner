// @vitest-environment node
import { expect, it } from "vitest";
import { PlannerCpuLayout, PlannerLayoutKernel } from "@/blueprint-planner/cpu-layout";
import { PLANNER_LAYOUT_GEOMETRY_STRIDE as G, type PlannerLayoutBatch } from "@/blueprint-planner/layout-backend";
import { plannerDrainEntities, plannerFixtureConflicts, plannerObstacleMask } from "@/blueprint-planner/fixtures";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import { createRegistryContract } from "@/registry";
import { createPlainNode } from "@/blueprint-planner/placement";
import { getPlannerPorts, plannerPortAcceptsItem } from "@/blueprint-planner/geometry";
import { PlannerSearchSessions } from "@/blueprint-planner/search-sessions";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import fixture from "./fixtures/yazhen-syringe.json";

function batch(steps: number): PlannerLayoutBatch {
  const geometry = new Int32Array(3 * 4 * G);
  for (let n = 0; n < 3; n++) for (let turn = 0; turn < 4; turn++) {
    const start = (n * 4 + turn) * G;
    geometry[start] = 2; geometry[start + 1] = 2; geometry[start + 2] = -1; geometry[start + 4] = 3;
    geometry[start + 40] = Number(n === 0);
  }
  return { chains: 4, parameters: new Int32Array([3, 0, 12, 12, steps, 12345, 8000, 1, 1, 0]),
    geometry, edges: new Int32Array(), overlaps: new Int32Array(9), poses: new Int32Array([3, 3, 0, 3, 3, 0, 5, 5, 0]) };
}

it("数值内核跨切片保留随机数、上坡移动与冷却年龄；结果与连续执行一致", async () => {
  const cpu = new PlannerCpuLayout(), whole = await cpu.search(batch(80)), first = await cpu.search(batch(40));
  const second = await cpu.search({ ...batch(40), states: first.states });
  expect(second.states).toEqual(whole.states);
  expect(first.evaluations + second.evaluations).toBe(whole.evaluations);
  const stride = 11;
  for (let chain = 0; chain < 4; chain++) {
    expect(second.states!.slice(chain * stride + 2, chain * stride + 5)).toEqual(new Int32Array([3, 3, 0]));
    expect(second.states![chain * stride + 1]).toBe(80);
  }
  expect(new Set(Array.from({ length: 4 }, (_, chain) => second.states!.slice(chain * stride + 2, (chain + 1) * stride).join(","))).size).toBeGreaterThan(1);
});

it("排空传送带允许管道穿越，收货夹具仍阻挡管道；碰撞规则使用真实 Registry", () => {
  const registry = createRegistryContract(), stash = createPlainNode(registry, "storager_1", "stash", "product");
  const output = getPlannerPorts(registry, stash.entity, stash.definition, "output")[0]!;
  const [drain, sink] = plannerDrainEntities(registry, output, "fixture");
  expect(plannerObstacleMask(registry, drain!.definitionId)).toBe(1);
  expect(plannerObstacleMask(registry, sink!.definitionId)).toBe(3);
  const pipe = createPlainNode(registry, registry.queries.resolveLogisticsDefinitionId("pipe", "straight"), "pipe", "logistics");
  pipe.entity.position = { ...drain!.position };
  expect(plannerFixtureConflicts(registry, [drain!], [pipe.entity])).toEqual([]);
  pipe.entity.position = { ...sink!.position };
  expect(plannerFixtureConflicts(registry, [sink!], [pipe.entity])).toEqual(["pipe"]);
  // AI-REMOVED 2026-10-10: getPlannerPorts 只枚举物理端口，不能用它断言配置启用数。
  // Trigger: 排空配置回归；Evidence: geometry.ts 的物理端口契约；Replacement: 有效过滤查询。
  // Risk: Low；Human Review: Required。
  // expect(getPlannerPorts(registry, sink!, registry.queries.findEntityDefinition(sink!.definitionId)!, "input")).toHaveLength(1);
  const definition = registry.queries.findEntityDefinition(sink!.definitionId)!;
  expect(getPlannerPorts(registry, sink!, definition, "input").filter(port =>
    plannerPortAcceptsItem(registry, sink!, definition, port, "item_carbon_enr"))).toHaveLength(1);
});

it("代理评分包含原图供电、环境覆盖和固定设备约束", () => {
  const input = batch(1), geometry = input.geometry;
  for (let turn = 0; turn < 4; turn++) {
    geometry[(1 * 4 + turn) * G + 43] = 1;
    geometry[turn * G + 44] = -1; geometry[turn * G + 45] = -1;
    geometry[turn * G + 46] = 4; geometry[turn * G + 47] = 4;
  }
  const kernel = new PlannerLayoutKernel(input);
  kernel.poses.set([8, 8, 0], 3);
  const unpowered = kernel.score();
  for (let turn = 0; turn < 4; turn++) { geometry[turn * G + 46] = 12; geometry[turn * G + 47] = 12; }
  expect(kernel.score()).toBeLessThan(unpowered);
  for (let turn = 0; turn < 4; turn++) geometry[(1 * 4 + turn) * G + 49] = 1;
  expect(kernel.score()).toBeGreaterThanOrEqual(unpowered);
});

it("两种执行入口使用相同数值快照，跨切片复用链状态，最终仍做完整检查", async () => {
  const registry = createRegistryContract(), cpu = new PlannerCpuLayout();
  const run = async (accelerated: boolean) => {
    const nodes = [createPlainNode(registry, "belt_straight_1x1", "moving", "logistics")];
    nodes[0]!.entity.position = { x: -2, y: -2 };
    const statistics: PlannerSearchStatistics = { seed: 17, evaluationLimit: 200, evaluations: 0, acceptedMoves: 0,
      routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: { width: 6, height: 6 } };
    const search = new CompactLayoutSearch(registry, { request: fixture.request as BlueprintPlannerRequest,
      nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 }, [], statistics, undefined, accelerated ? cpu : undefined);
    await search.advance(96, () => {}); search.applyBest();
    return { position: nodes[0]!.entity.position, conflicts: statistics.remainingConflicts, evaluations: statistics.evaluations };
  };
  expect(await run(false)).toEqual(await run(true));
});

it("Worker 会话续接保留搜索链，切片计数从零开始；尺寸指纹改变立即失效", async () => {
  const registry = createRegistryContract(), cpu = new PlannerCpuLayout(), batches: PlannerLayoutBatch[] = [];
  const network = { request: fixture.request as BlueprintPlannerRequest,
    nodes: [createPlainNode(registry, "storager_1", "large", "logistics")], slotLinks: [], initialSlots: [], preferredGasCount: 0 };
  const statistics: PlannerSearchStatistics = { seed: 7, evaluationLimit: 64, evaluations: 0, acceptedMoves: 0,
    routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: { width: 1, height: 1 } };
  const search = new CompactLayoutSearch(registry, network, [], statistics, undefined, { search: async input => { batches.push(input); return cpu.search(input); } });
  expect(await search.advance(64, () => {})).toBe(false);
  search.beginSlice({ ...statistics, evaluations: 0, acceptedMoves: 0, routingAttempts: 0 });
  expect(statistics.evaluations).toBe(0);
  expect(statistics.searchResumed).toBe(true);
  expect(await search.advance(64, () => {})).toBe(false);
  expect(statistics.evaluations).toBe(64);
  expect(batches[1]!.states).toBeDefined();
  expect(batches[1]!.states![1]).toBeGreaterThan(0);
  const sessions = new PlannerSearchSessions();
  const saved = { fingerprint: "1x1", network, wires: [], search };
  sessions.set("worker-session", saved);
  expect(sessions.get("worker-session", "1x1")).toBe(saved);
  expect(sessions.get("worker-session", "2x2")).toBeUndefined();
  expect(sessions.get("worker-session", "1x1")).toBeUndefined();
});

it("原图完整布局检查拒绝失去供电覆盖，生成模式仍允许布线后补电", async () => {
  const registry = createRegistryContract();
  const machine = registry.entityDefinitions.find(definition => definition.requiresPower && !definition.powerRange)!;
  const node = createPlainNode(registry, machine.id, "requires-power", "production");
  node.entity.position = { x: 10, y: 10 };
  const request = fixture.request as BlueprintPlannerRequest;
  const statistics = (): PlannerSearchStatistics => ({ seed: 0, evaluationLimit: 1, evaluations: 0, acceptedMoves: 0,
    routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: { width: 50, height: 50 } });
  const network = { request, nodes: [node], slotLinks: [], initialSlots: [], preferredGasCount: 0 };
  expect(await new CompactLayoutSearch(registry, network, [], statistics()).advance(0, () => {})).toBe(true);
  const imported = { ...request, blueprintSource: { blueprint: createBlueprintDocument({ name: "power", baseId: request.plan.sourceBaseId, initialGridPoint: { x: 0, y: 0 }, entities: {}, entityOrder: [], slotLinks: [] }),
    activeActivityIds: [], boundaries: [] } };
  const stats = statistics();
  expect(await new CompactLayoutSearch(registry, { ...network, request: imported }, [], stats).advance(0, () => {})).toBe(false);
  expect(stats.remainingConflicts?.power).toBeGreaterThan(0);
});
