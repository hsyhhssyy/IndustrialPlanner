// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createPlainNode } from "@/blueprint-planner/placement";
import { createRecipeNode } from "@/blueprint-planner/production-network";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { PlannerCpuLayout } from "@/blueprint-planner/cpu-layout";
import { PLANNER_LAYOUT_GEOMETRY_STRIDE as G, type PlannerLayoutBatch } from "@/blueprint-planner/layout-backend";
import type { PlannerNetwork, PlannerNode } from "@/blueprint-planner/model";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import fixture from "./fixtures/yazhen-syringe.json";

it("单消费者数组归属进入共同移动，环境根带上局部暗管；多消费者供料保留独立移动", async () => {
  const registry = createRegistryContract(), recipe = registry.queries.findRecipeDefinition("xiranite_oven_xiranite_powder_2")!;
  const gas = registry.recipeDefinitions.find(entry => entry.environmentOutput?.itemId === recipe.requiredEnvironmentAnyOf![0])!;
  const environment = createRecipeNode(registry, gas, "environment", 60 / gas.durationSeconds, "environment");
  const consumer = createRecipeNode(registry, recipe, "consumer", 60 / recipe.durationSeconds, "production");
  environment.entity.position = { x: 6, y: 6 }; consumer.entity.position = { x: 1, y: 1 };
  const terminal: PlannerNode = { ...createPlainNode(registry, "udpipe_unloader_1", "local-supply", "supply"), supplyTargets: [{ entityId: consumer.entity.id }] };
  terminal.entity.position = { x: 1, y: 8 };
  const shared: PlannerNode = { ...createPlainNode(registry, "udpipe_unloader_2", "shared-supply", "supply"),
    supplyTargets: [{ entityId: consumer.entity.id }, { entityId: environment.entity.id }] };
  shared.entity.position = { x: 18, y: 8 };
  const network: PlannerNetwork = { request: fixture.request as BlueprintPlannerRequest, nodes: [environment, consumer, terminal, shared],
    slotLinks: [], initialSlots: [], preferredGasCount: 0 };
  const statistics: PlannerSearchStatistics = { seed: 17, evaluationLimit: 32, evaluations: 0, acceptedMoves: 0, routingAttempts: 0,
    initialWireLength: 0, finalWireLength: 0, outline: { width: 30, height: 30 } };
  const batches: PlannerLayoutBatch[] = [], cpu = new PlannerCpuLayout();
  const search = new CompactLayoutSearch(registry, network, [], statistics, undefined,
    { search: async input => { batches.push(input); return cpu.search(input); } });
  await search.advance(32, () => {});
  expect(statistics.evaluations).toBe(32);
  expect(batches).toHaveLength(1);
  for (let rotation = 0; rotation < 4; rotation++) {
    const parent = (node: number) => batches[0]!.geometry[(node * 4 + rotation) * G + 6];
    expect(parent(0)).toBe(0);
    expect(parent(1)).toBe(1);
    expect(parent(2)).toBe(1);
    expect(parent(3)).toBe(0);
  }
});
