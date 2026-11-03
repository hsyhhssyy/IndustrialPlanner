import { describe, expect, it } from "vitest";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { SimulationHost } from "@/simulation/simulation-host";
import { BELT_TRANSPORT_DURATION_SECONDS } from "@/domain/registry";
import { createRegistryContract } from "@/registry";
import { createRegistryQuery } from "@/registry/registry-query";
import { createSimulationHost } from "@/simulation/simulation-host";
import { createWorldDocumentFromBlueprint, loadBlueprintFromFile } from "./blueprint-test-helpers";
import { createHeadlessWorkspace } from "./blueprint-runner";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

const FIXTURE_RECIPE_ID = "fixture:req046:belt-copper-mutation";
const ORE = "item_copper_ore";
const NUGGET = "item_copper_nugget";
const GAS = "item_gas_xiranite";
const INPUT_COUNT = 20;

/** 虚构配方只进入新 Registry 实例的数组，不触碰产品定义或默认物流分类。 */
function createMutationRegistry(inject: boolean): RegistryContract {
  const registry = createRegistryContract();
  if (!inject) return registry;
  const mutation: RecipeDefinition = {
    id: FIXTURE_RECIPE_ID, nameKey: FIXTURE_RECIPE_ID,
    machineId: "belt_straight_1x1", recipeType: "reserved-item",
    durationSeconds: BELT_TRANSPORT_DURATION_SECONDS,
    inputs: [{ itemId: ORE, amount: 1 }], outputs: [{ itemId: NUGGET, amount: 1 }],
    tags: [], requiredEnvironmentAnyOf: [GAS], probability: 0.5,
  };
  const recipeDefinitions = [...registry.recipeDefinitions, mutation];
  return { ...registry, recipeDefinitions, queries: createRegistryQuery({
    entityDefinitions: registry.entityDefinitions, itemDefinitions: registry.itemDefinitions, recipeDefinitions,
  }) };
}

/** 同一物理槽的 input/output 两种投影只计一次；reserved 数量仍包含在 count 中。 */
function inventory(host: SimulationHost, entityId: string): { ore: number; nugget: number } {
  const status = host.queries.getDeviceRuntimeStatus(entityId);
  expect(status, `缺少 ${entityId} 的真实运行投影`).not.toBeNull();
  const slots = new Map(status!.slotItems.map(slot => [`${slot.storageGroupId}:${slot.slotId}`, slot]));
  let ore = 0; let nugget = 0;
  for (const slot of slots.values()) {
    if (slot.itemType === ORE) ore += slot.count;
    if (slot.itemType === NUGGET) nugget += slot.count;
  }
  return { ore, nugget };
}

it("虚构概率配方不泄露到新的产品 Registry", () => {
  const injected = createMutationRegistry(true);
  expect(injected.queries.findRecipeDefinition(FIXTURE_RECIPE_ID)?.probability).toBe(0.5);
  expect(createRegistryContract().queries.findRecipeDefinition(FIXTURE_RECIPE_ID)).toBeNull();
});

describe.each(SIMULATION_ENGINE_MATRIX)("ST2-RQ-046 传送带概率变异真实产线 [%s]", engineKind => {
  it.each([
    { name: "有息壤气与注入：产生赤铜块并保留赤铜矿", environment: true, inject: true, mutation: true },
    { name: "无息壤气与注入：全部保持赤铜矿", environment: false, inject: true, mutation: false },
    { name: "有息壤气无注入：默认物流保持赤铜矿", environment: true, inject: false, mutation: false },
  ])("$name", async ({ environment, inject, mutation }) => {
    const registry = createMutationRegistry(inject);
    const blueprint = loadBlueprintFromFile(`src/tests/fixtures/blueprints/simulation/belt-probabilistic-mutation/${environment ? "with-environment" : "without-environment"}.schema7.json`);
    const document = createWorldDocumentFromBlueprint(blueprint);
    expect(document.entities.belt!.config).toEqual({});
    const host = createSimulationHost(createHeadlessWorkspace(document, registry), { engineKind, workerMode: "runtime" });
    try {
      const started = await host.internalActions.refreshFromCurrentDocument();
      expect(started.status).toBe("started");
      const topology = host.topology.getSnapshot()!;
      expect(topology.diagnostics.filter(entry => entry.severity === "error")).toEqual([]);
      const belt = Object.values(topology.devices).find(device => device.sourceEntityId === "belt")!;
      expect(belt.transportClass).toBe("strict-belt");
      expect(belt.recipeChannels.every(channel => !channel.manualRecipeOnly && channel.defaultRecipeId === null)).toBe(true);
      const rate = topology.standardTickRate;
      expect((await host.internalActions.syncToTick(1)).status).toBe("ready");
      const gasRanges = host.queries.getActiveEnvironmentRanges().filter(range => range.itemId === GAS);
      const target = document.entities.belt!.position;
      const covered = gasRanges.some(({ gridRect }) => gridRect.x <= target.x && gridRect.y <= target.y
        && gridRect.x + gridRect.width >= target.x + 1 && gridRect.y + gridRect.height >= target.y + 1);
      expect(covered, "必须先证明真实息壤气环境覆盖目标传送带").toBe(environment);
      const diffuser = host.queries.getDeviceRuntimeStatus("gas-diffuser")!;
      expect(Object.values(diffuser.channelRecipes).some(recipe => recipe?.recipeId === "r_gas_diffuser_xiranite_gas_environment_basic")).toBe(environment);
      expect(diffuser.slotItems.some(slot => slot.itemType === GAS && slot.ignoreStock)).toBe(environment);
      expect(host.queries.getDeviceRuntimeStatus("source-storage")!.slotItems.every(slot => !slot.ignoreStock)).toBe(true);
      for (let second = 1; second <= 60; second++) {
        expect((await host.internalActions.syncToTick(second * rate + 1)).status).toBe("ready");
        const currentlyCovered = host.queries.getActiveEnvironmentRanges().some(({ itemId, gridRect }) => itemId === GAS
          && gridRect.x <= target.x && gridRect.y <= target.y
          && gridRect.x + gridRect.width >= target.x + 1 && gridRect.y + gridRect.height >= target.y + 1);
        expect(currentlyCovered, `${second}s：气环境须持续覆盖完整产线测试窗口`).toBe(environment);
      }
      const source = inventory(host, "source-storage");
      const inTransit = inventory(host, "belt");
      const sink = inventory(host, "sink-storage");
      console.log(JSON.stringify({ engineKind, environment, inject, gasCovered: covered, source, inTransit, sink }));
      expect(source).toEqual({ ore: 0, nugget: 0 });
      expect(inTransit).toEqual({ ore: 0, nugget: 0 });
      expect(source.ore + source.nugget + inTransit.ore + inTransit.nugget + sink.ore + sink.nugget).toBe(INPUT_COUNT);
      expect(sink.ore).toBeGreaterThan(0);
      if (mutation) expect(sink.nugget, "有环境时虚构概率配方必须真实产出赤铜块到下游").toBeGreaterThan(0);
      else expect(sink).toEqual({ ore: INPUT_COUNT, nugget: 0 });
      expect(createRegistryContract().queries.findRecipeDefinition(FIXTURE_RECIPE_ID)).toBeNull();
    } finally { host.dispose(); }
  });
});
