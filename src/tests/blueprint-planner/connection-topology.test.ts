// @vitest-environment node
// 2026-10-21：通用供液端口与合流结构独立采样，保留原结构并扩展逐点合流。
// 依据：.docs/common/eda/算法探索/算法探索20261021-针剂与软饮系统蓝图搜索空间.md
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { prepareProductionDevices } from "@/blueprint-planner/production-preparation";
import { PlannerPlacement } from "@/blueprint-planner/placement";
import { resolveSearchProfile } from "@/blueprint-planner/search-profile";
import { plannerAttemptStrategy, plannerConnectionChoices } from "@/blueprint-planner/strategy-schedule";
import { wireProductionNetwork } from "@/blueprint-planner/wiring";
import { transportCapacity } from "@/blueprint-planner/geometry";
import fixture from "./fixtures/system-softdrink-shared-port-seed.json";

it("同请求的四种连接结构保留生产配方及运力，逐点合流不丢失流量", async () => {
  const registry = createRegistryContract(), samples = new Map<string, number>();
  for (let seed = 1; seed <= 1000 && samples.size < 4; seed++) samples.set(JSON.stringify(plannerConnectionChoices(seed)), seed);
  expect(samples.size).toBe(4);
  const observed: Array<{ spare: boolean; serial: boolean; sources: number[]; convergers: number }> = [];
  for (const matchingSeed of samples.values()) {
    const choice = plannerConnectionChoices(matchingSeed);
    const request = structuredClone(fixture.seed.network.request) as BlueprintPlannerRequest;
    const network = createProductionNetwork(registry, request), placement = new PlannerPlacement(registry, 30, 1, 1, 0, 1);
    placement.maximumX = 32;
    const strategy = { ...plannerAttemptStrategy(0), matchingSeed, conduitTopology: "local" as const };
    await prepareProductionDevices(registry, network, placement, 0, resolveSearchProfile({ initialClearance: 0, fluidGroupSize: 4 }),
      { strategy: "compact", conduitTopology: "local", stashPackingVariant: 0, attemptStrategy: strategy }, () => {});
    const wires = await wireProductionNetwork(registry, network, placement, () => {}, true, true, false, undefined, undefined, choice.serialConvergers);
    expect(network.nodes.filter(node => node.purpose === "production")).toHaveLength(13);
    const convergers = network.nodes.filter(node => registry.queries.resolveLogisticsRole(node.definition.id) === "converger");
    for (const node of convergers) {
      const inputs = wires.filter(wire => wire.target.entityId === node.entity.id), outputs = wires.filter(wire => wire.source.entityId === node.entity.id);
      expect(inputs.length).toBeLessThanOrEqual(choice.serialConvergers ? 2 : 3);
      expect(outputs).toHaveLength(1);
      for (const item of outputs[0]!.itemIds) expect(inputs.filter(wire => wire.itemIds.includes(item)).reduce((sum, wire) => sum + wire.perMinute, 0))
        .toBeCloseTo(outputs[0]!.perMinute, 8);
    }
    for (const wire of wires) expect(wire.perMinute).toBeLessThanOrEqual(transportCapacity(wire.source.kind) + 1e-6);
    observed.push({ spare: choice.spareSupplyPorts, serial: choice.serialConvergers, convergers: convergers.length,
      sources: network.nodes.filter(node => node.purpose === "supply" && node.definition.id.startsWith("udpipe_unloader_"))
        .map(node => node.definition.portGroups.filter(group => group.direction === "output").reduce((sum, group) => sum + group.ports.length, 0)) });
  }
  for (const row of observed) {
    expect(row.convergers).toBe(row.serial ? 3 : 2);
    expect(row.sources).toEqual(row.spare ? [2, 2] : [1, 1]);
  }
});
