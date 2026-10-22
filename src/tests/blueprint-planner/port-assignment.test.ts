// @vitest-environment node
// 2026-10-21：端口分配属于搜索状态；普通生成评分不得覆盖已合法的全局分配。
// 依据：.docs/common/eda/算法探索/算法探索20261021-系统胶囊蓝图与生产网络搜索空间.md
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { restorePlannerSeed, type PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import { plannerPortKey, proposePlannerPortKeys } from "@/blueprint-planner/port-assignment";
import { PlannerRouter } from "@/blueprint-planner/router";
import { repairPlannerRoutes } from "@/blueprint-planner/route-repair";
import { resolveSearchProfile } from "@/blueprint-planner/search-profile";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import type { PlannerLayoutBackend } from "@/blueprint-planner/layout-backend";
import systemReference from "./fixtures/system-capsule-reserved-axes.json";

const registry = createRegistryContract(), seed = systemReference.seed as PlannerSearchSeed;
const profile = resolveSearchProfile({ initialClearance: 0 });
function setup(backend?: PlannerLayoutBackend, randomSeed = 12345) {
  const restored = restorePlannerSeed(registry, JSON.parse(seed.requestKey), seed);
  // 使用同一已验证网表，但进入普通生成模式；不固定节点，不跳过端口等价组。
  const network = { ...restored.network, request: { ...restored.network.request, blueprintSource: undefined } };
  const statistics: PlannerSearchStatistics = { seed: randomSeed, evaluationLimit: 10000, evaluations: 0, acceptedMoves: 0,
    routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: { width: seed.width, height: seed.height },
    strategy: "compact", coolingEvaluations: 10000 };
  const search = new CompactLayoutSearch(registry, network, restored.wires, statistics, profile, backend);
  return { network, wires: restored.wires, statistics, search };
}

type ObservedState = { poses: unknown[]; sourceKeys: string[]; targetKeys: string[] };
// 只观察状态与评分；不替换真实提案、评分器或随机流。
function observe(search: CompactLayoutSearch) {
  return search as unknown as { snapshot(): ObservedState; evaluate(): unknown; current: unknown; best: ObservedState };
}

it("普通生成模式保留系统参照的合法端口，完整缓存的修复入口同样保持 63 条线路", async () => {
  const { network, wires, statistics, search } = setup();
  const ports = wires.map(wire => [plannerPortKey(wire.source), plannerPortKey(wire.target)]);
  expect(await search.advance(0, () => {})).toBe(true);
  search.applyBest();
  expect(wires.map(wire => [plannerPortKey(wire.source), plannerPortKey(wire.target)])).toEqual(ports);
  expect(statistics.remainingConflicts).toEqual({ geometry: 0, power: 0, boundary: 0, connections: 0 });
  const router = new PlannerRouter(registry, network.nodes.map(node => node.entity), wires.flatMap(wire => [wire.source, wire.target]),
    { minimumX: 0, minimumY: 0, maximumX: seed.width - 1, maximumY: seed.height - 1, escapeLength: 0 });
  for (const wire of wires) {
    const path = systemReference.paths.find(entry => entry.source === `${wire.source.entityId}/${wire.source.groupIndex}/${wire.source.portIndex}`
      && entry.target === `${wire.target.entityId}/${wire.target.groupIndex}/${wire.target.portIndex}`);
    expect(path).toBeDefined();
    expect(router.reuse(wire.source, wire.target, path!.cells, wire.minimumCells)).toBe(true);
  }
  expect(await repairPlannerRoutes(registry, network, wires, router.routes, statistics, profile, 256, () => {})).toHaveLength(63);
  expect(statistics.evaluations).toBe(0);
  expect(wires.map(wire => [plannerPortKey(wire.source), plannerPortKey(wire.target)])).toEqual(ports);
});

it("端口提案允许交换已用口或选择空闲口，但不重复占口", () => {
  const current = ["a", "b"], keys = ["a", "b", "c"];
  expect(proposePlannerPortKeys(current, keys, () => 0)).toEqual(["b", "a"]);
  const sequence = [0, 0.75];
  expect(proposePlannerPortKeys(current, keys, () => sequence.shift()!)).toEqual(["c", "b"]);
  expect(current).toEqual(["a", "b"]);
  expect(proposePlannerPortKeys(["a"], ["a"], () => 0)).toBeNull();
});

it("缺一条线路的修复可以接受真实端口变更，并返回可重放的完整快照", async () => {
  const { network, wires, statistics } = setup(undefined, 7);
  const bounds = { minimumX: 0, minimumY: 0, maximumX: seed.width - 1, maximumY: seed.height - 1, escapeLength: 0 };
  const initial = new PlannerRouter(registry, network.nodes.map(node => node.entity), wires.flatMap(wire => [wire.source, wire.target]), bounds);
  for (const wire of wires) {
    const path = systemReference.paths.find(entry => entry.source === `${wire.source.entityId}/${wire.source.groupIndex}/${wire.source.portIndex}`
      && entry.target === `${wire.target.entityId}/${wire.target.groupIndex}/${wire.target.portIndex}`)!;
    expect(initial.reuse(wire.source, wire.target, path.cells, wire.minimumCells)).toBe(true);
  }
  const originalSourcePorts = wires.map(wire => plannerPortKey(wire.source));
  const routes = await repairPlannerRoutes(registry, network, wires, initial.routes.slice(0, -1), statistics, profile, 64, () => {});
  expect(routes).toHaveLength(63);
  expect(statistics.evaluations).toBeGreaterThan(0);
  expect(statistics.evaluations).toBeLessThanOrEqual(64);
  expect(wires.some((wire, index) => plannerPortKey(wire.source) !== originalSourcePorts[index])).toBe(true);
  const replay = new PlannerRouter(registry, network.nodes.map(node => node.entity), wires.flatMap(wire => [wire.source, wire.target]), bounds);
  for (const route of routes!) {
    const wire = wires.find(entry => `${entry.source.entityId}/${entry.source.groupIndex}/${entry.source.portIndex}` === route.sourcePort
      && `${entry.target.entityId}/${entry.target.groupIndex}/${entry.target.portIndex}` === route.targetPort)!;
    expect(replay.reuse(wire.source, wire.target, route.cells, wire.minimumCells)).toBe(true);
  }
  expect(replay.routes).toHaveLength(63);
  const local = { ...statistics, evaluations: 0 };
  const layout = new CompactLayoutSearch(registry, network, wires, local, profile);
  expect(await layout.advance(0, () => {})).toBe(true);
});

it("端口提案共用预算，拒绝时完整回退，分片执行与连续执行保持同一状态", async () => {
  const sliced = setup(), whole = setup(), observed = observe(sliced.search);
  let previous = observed.snapshot(), rejected = 0, portMoves = 0;
  for (let i = 0; i < 1024; i++) {
    const accepted = sliced.statistics.acceptedMoves;
    await sliced.search.advance(1, () => {});
    const current = observed.snapshot();
    expect(observed.current).toEqual(observed.evaluate());
    if (accepted === sliced.statistics.acceptedMoves) { expect(current).toEqual(previous); rejected++; }
    else if (JSON.stringify([current.sourceKeys, current.targetKeys]) !== JSON.stringify([previous.sourceKeys, previous.targetKeys])) portMoves++;
    if (i % 64 === 0) { sliced.search.snapshotBest(); expect(observed.snapshot()).toEqual(current); }
    previous = current;
  }
  await whole.search.advance(1024, () => {});
  expect(observe(whole.search).snapshot()).toEqual(observed.snapshot());
  expect(observe(whole.search).best).toEqual(observed.best);
  expect(sliced.statistics.evaluations).toBe(1024);
  expect(whole.statistics.evaluations).toBe(1024);
  expect(rejected).toBeGreaterThan(0);
  expect(portMoves).toBeGreaterThan(0);
  sliced.search.applyBest(); whole.search.applyBest();
  expect(sliced.wires).toEqual(whole.wires);
  expect(sliced.network.nodes.map(node => node.entity)).toEqual(whole.network.nodes.map(node => node.entity));
});

it("已评估的数值批次保存自己的端口分配，不跟随当前状态变化", async () => {
  // 此替身仅控制后端返回队列；实际 CPU / WebGPU 的算术与搜索由后端一致性测试覆盖。
  const { search, statistics } = setup({ search: async input => {
    const poses = Array.from({ length: input.parameters[0]! }, (_, index) => ({ x: input.poses[index * 3]!,
      y: input.poses[index * 3 + 1]!, rotation: input.poses[index * 3 + 2]! * 90 as 0 | 90 | 180 | 270 }));
    return { evaluations: input.chains * input.parameters[4]!, kernelMs: 0, poses: [poses, structuredClone(poses)] };
  } });
  const internal = search as unknown as { nextBatchEvaluation: number; edges: Array<{ sourceKey: string }> };
  internal.nextBatchEvaluation = 0;
  const original = observe(search).snapshot();
  await search.advance(512, () => {});
  expect(search.hasPendingLayouts).toBe(true);
  const charged = statistics.evaluations;
  // 故障注入仅模拟当前分配已改变；队列恢复必须在评分读取端口之前发生。
  internal.edges[0]!.sourceKey = "unavailable-current-port";
  expect(await search.advance(0, () => {})).toBe(true);
  expect(observe(search).snapshot()).toEqual(original);
  expect(statistics.evaluations).toBe(charged);
  expect(search.hasPendingLayouts).toBe(false);
});
