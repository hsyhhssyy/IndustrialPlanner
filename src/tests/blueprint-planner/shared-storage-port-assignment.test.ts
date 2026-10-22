// @vitest-environment node
// 2026-10-21：同库存的跨组等价出口必须进入普通 EDA 搜索空间，独立库存和物流类型仍隔离。
// 依据：.docs/common/eda/算法探索/算法探索20261021-针剂与软饮系统蓝图搜索空间.md
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { restorePlannerSeed, type PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import { plannerPortAssignmentGroups, plannerPortKey, proposePlannerPortKeys } from "@/blueprint-planner/port-assignment";
import { getPlannerPorts } from "@/blueprint-planner/geometry";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { resolveSearchProfile } from "@/blueprint-planner/search-profile";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import fixture from "./fixtures/system-softdrink-shared-port-seed.json";

const registry = createRegistryContract(), seed = fixture.seed as PlannerSearchSeed;
const setup = () => restorePlannerSeed(registry, JSON.parse(seed.requestKey), seed);

it("同库存的两个跨组流体出口可互换，固体出口不混入", () => {
  const { network, wires } = setup();
  const nodeIndex = network.nodes.findIndex(node => node.definition.id === "mix_pool_1");
  const groups = plannerPortAssignmentGroups(registry, network, wires, true);
  const group = groups.find(entry => entry.node === nodeIndex && entry.source && entry.ports[0]!.kind === "pipe")!;
  expect(group.keys).toEqual(["2/0/output", "3/0/output"]);
  expect(group.edges).toHaveLength(1);
  const current = group.edges.map(at => plannerPortKey(wires[at]!.source));
  expect(proposePlannerPortKeys(current, group.keys, () => 0)).toEqual(["2/0/output"]);
  expect(current).toEqual(["3/0/output"]);
  expect(plannerPortAssignmentGroups(registry, network, wires, false).some(entry => entry.node === nodeIndex)).toBe(false);
  expect(plannerPortAssignmentGroups(registry, network, wires, true, new Set([network.nodes[nodeIndex]!.entity.id]))
    .some(entry => entry.node === nodeIndex)).toBe(false);
});

it("每条连接只属于一个同侧候选池，所有普通候选口保持物料、物流类型和完整库存绑定", () => {
  const { network, wires } = setup(), seen = new Set<string>();
  const groups = plannerPortAssignmentGroups(registry, network, wires, true);
  for (const group of groups) {
    const node = network.nodes[group.node]!, direction = group.source ? "output" : "input";
    const bindings = (index: number) => node.definition.portStorageBindings
      .filter(binding => binding.portGroupId === node.definition.portGroups[index]!.id)
      .map(binding => binding.storageSlotGroupId).sort();
    for (const at of group.edges) {
      const key = `${group.source}/${at}`;
      expect(seen.has(key)).toBe(false); seen.add(key);
      const original = group.source ? wires[at]!.source : wires[at]!.target;
      for (const port of group.ports) {
        expect(port.kind).toBe(original.kind);
        expect(port.direction).toBe(direction);
        for (const item of wires[at]!.itemIds) expect(getPlannerPorts(registry, node.entity, node.definition, direction, item)
          .map(plannerPortKey)).toContain(plannerPortKey(port));
        if (registry.queries.resolveLogisticsRole(node.definition.id) !== "splitter"
          && registry.queries.resolveLogisticsRole(node.definition.id) !== "converger") {
          expect(bindings(port.groupIndex)).toEqual(bindings(original.groupIndex));
          if (!bindings(original.groupIndex).length) expect(port.groupIndex).toBe(original.groupIndex);
        }
      }
    }
  }
});

it("零提案保留完整参照的跨组分配，正式几何裁判不改写端口", async () => {
  const { network, wires } = setup();
  const original = wires.map(wire => [plannerPortKey(wire.source), plannerPortKey(wire.target)]);
  const stats: PlannerSearchStatistics = { seed: 1, evaluationLimit: 1, evaluations: 0, acceptedMoves: 0, routingAttempts: 0,
    initialWireLength: 0, finalWireLength: 0, outline: { width: seed.width, height: seed.height }, strategy: "compact" };
  const layout = new CompactLayoutSearch(registry, network, wires, stats, resolveSearchProfile({ initialClearance: 0 }));
  expect(await layout.advance(0, () => {})).toBe(true);
  layout.applyBest();
  expect(wires.map(wire => [plannerPortKey(wire.source), plannerPortKey(wire.target)])).toEqual(original);
  expect(stats.remainingConflicts).toEqual({ geometry: 0, power: 0, boundary: 0, connections: 0 });
});
