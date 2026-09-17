// @vitest-environment node

import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { PlannerPlacement, placeProduction } from "@/blueprint-planner/placement";
import { addTerminals } from "@/blueprint-planner/terminals";
import { wireProductionNetwork } from "@/blueprint-planner/wiring";
import nugget from "./fixtures/pyrrolite-nugget.json";
import ore from "./fixtures/pyrrolite-ore.json";

it.each([{ input: nugget, sources: 4, separate: false }, { input: ore, sources: 5, separate: false },
  { input: nugget, sources: 5, separate: true }, { input: ore, sources: 6, separate: true }])("供料按容量共享，运行消耗全部经过准入口，非等量支路明确限速 ($sources 个来源，分组 $separate)", async ({ input, sources, separate }) => {
  const registry = createRegistryContract();
  const request = structuredClone(input.request) as BlueprintPlannerRequest;
  const before = JSON.stringify(request);
  const network = createProductionNetwork(registry, request);
  const placement = new PlannerPlacement(registry, 40, 7, 2, 1, 1);
  await placeProduction(registry, network, placement, 0);
  addTerminals(registry, network, placement, separate);
  const wires = await wireProductionNetwork(registry, network, placement);
  expect(network.nodes.filter(node => node.purpose === "supply" && node.definition.id.startsWith("udpipe_unloader_")).length).toBe(sources);
  let consumptionInputs = 0;
  for (const node of network.nodes) for (const demand of node.inputs) {
    if (!demand.storageGroupIds || !node.definition.recipeChannels.some(channel => channel.type === "consumption-channel"
      && channel.ingredientStorageGroupIds.some(group => demand.storageGroupIds!.includes(group)))) continue;
    consumptionInputs++;
    const incoming = wires.filter(wire => wire.target.entityId === node.entity.id && node.definition.portStorageBindings.some(binding =>
      binding.portGroupId === node.definition.portGroups[wire.target.groupIndex]!.id && demand.storageGroupIds!.includes(binding.storageSlotGroupId)));
    expect(incoming).toHaveLength(1);
    const limiter = network.nodes.find(entry => entry.entity.id === incoming[0]!.source.entityId)!;
    expect(limiter.definition.id).toBe("pipe_admission");
    expect(Object.values(limiter.entity.config)).toContainEqual({ itemId: demand.itemId, limit: null, perMinuteLimit: 6 });
  }
  expect(consumptionInputs).toBe(6);
  for (const wire of wires.filter(wire => (wire.minimumCells ?? 0) > 0)) {
    const node = network.nodes.find(entry => entry.entity.id === wire.target.entityId)!;
    const rule = Object.values(node.entity.config).find(value => value && typeof value === "object" && "perMinuteLimit" in value) as { perMinuteLimit: number };
    expect(wire.minimumCells).toBe(Math.ceil(rule.perMinuteLimit / 6));
  }
  expect(JSON.stringify(request)).toBe(before);
});
