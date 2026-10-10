// @vitest-environment node
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { createPlainNode } from "@/blueprint-planner/placement";
import { getPlannerPorts } from "@/blueprint-planner/geometry";
import { restrictPort } from "@/blueprint-planner/wiring";
import { reduceBlueprintNetwork } from "@/blueprint-planner/blueprint-candidate";
import type { PlannerNetwork, PlannerWire } from "@/blueprint-planner/model";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import fixture from "./fixtures/yazhen-syringe.json";

it("减量重接能让出通用端口给受限物品，不把贪心失败当作无解", () => {
  const registry = createRegistryContract(), items = ["item_carbon_enr", "item_carbon_powder"];
  const sources = ["removed-a", "removed-b", "flexible", "only-a"].map(id => createPlainNode(registry, "unloader_1", id, "supply"));
  for (const [index, source] of sources.entries()) source.outputs.push(...(index === 1 ? [items[1]!] : index === 2 ? items : [items[0]!])
    .map(itemId => ({ itemId, perMinute: 30 })));
  for (const source of sources) for (const port of getPlannerPorts(registry, source.entity, source.definition, "output"))
    restrictPort(registry, source, port, source.outputs.map(flow => flow.itemId));
  const targets = ["target-a", "target-b"].map(id => createPlainNode(registry, "belt_straight_1x1", id, "production"));
  const wires: PlannerWire[] = targets.map((target, index) => ({ source: getPlannerPorts(registry, sources[index]!.entity, sources[index]!.definition, "output")[0]!,
    target: getPlannerPorts(registry, target.entity, target.definition, "input")[0]!, itemIds: [items[index]!], perMinute: 30 }));
  const network: PlannerNetwork = { request: fixture.request as BlueprintPlannerRequest, nodes: [...sources, ...targets], initialSlots: [], slotLinks: [], preferredGasCount: 0 };
  const result = reduceBlueprintNetwork(registry, network, wires, new Set(["removed-a", "removed-b"]), 0);
  expect(result.map(wire => wire.source.entityId)).toEqual(["only-a", "flexible"]);
  expect(network.nodes.map(node => node.entity.id)).not.toContain("removed-a");
});
