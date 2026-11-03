import { describe, expect, it } from "vitest";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { BELT_TRANSPORT_DURATION_SECONDS, PIPE_TRANSPORT_DURATION_SECONDS } from "@/domain/registry";
import { createRegistryContract } from "@/registry";
import { createRegistryQuery } from "@/registry/registry-query";
import { createDenseBlueprintEngine } from "@/simulation/dense";
import { createLegacyBlueprintEngine } from "@/simulation/legacy";
import { compileSimulationTopology } from "@/simulation/topology";
import { ACTIVITY_LIMITED_FORMULA_1_TAG } from "@/shared/registry/activity-availability";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import { createWorldDocumentFromBlueprint, loadBlueprintFromFile } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

const RECIPE_ID = "aaa:fixture:req046:logistics";
const families = [
  { fixture: "belt", definition: "belt_straight_1x1", item: "item_copper_ore", pipe: false },
  { fixture: "splitter", definition: "log_splitter", item: "item_copper_ore", pipe: false },
  { fixture: "pipe", definition: "pipe_straight_1x1", item: "item_liquid_water", pipe: true },
  { fixture: "pipe-splitter", definition: "pipe_splitter", item: "item_liquid_water", pipe: true },
] as const;

describe.each(SIMULATION_ENGINE_MATRIX)("ST2-RQ-046 物流候选组合 [%s]", engineKind => {
  function scenario(family: typeof families[number], options: { inject?: boolean; manual?: "selected" | "unselected"; extras?: Partial<RecipeDefinition> } = {}) {
    const base = createRegistryContract();
    const fixture = options.manual === undefined ? family.fixture : `manual-${options.manual}`;
    const document = createWorldDocumentFromBlueprint(loadBlueprintFromFile(`src/tests/fixtures/blueprints/simulation/logistics-recipe-candidates/${fixture}.schema7.json`));
    const recipe: RecipeDefinition = {
      id: RECIPE_ID, nameKey: RECIPE_ID, machineId: family.definition,
      recipeType: "reserved-item", durationSeconds: family.pipe ? PIPE_TRANSPORT_DURATION_SECONDS : BELT_TRANSPORT_DURATION_SECONDS,
      inputs: [{ itemId: family.item, amount: 1 }], outputs: [{ itemId: family.item, amount: 1 }], tags: [], ...options.extras,
    };
    const entityDefinitions = base.entityDefinitions.map((entity): EntityDefinition => entity.id !== family.definition || options.manual === undefined
      ? entity : { ...entity, recipeChannels: entity.recipeChannels.map(channel => ({ ...channel, manualRecipeOnly: true })) });
    const recipeDefinitions = options.inject === false ? base.recipeDefinitions : [...base.recipeDefinitions, recipe];
    const registry: RegistryContract = { ...base, entityDefinitions, recipeDefinitions,
      queries: createRegistryQuery({ entityDefinitions, recipeDefinitions, itemDefinitions: base.itemDefinitions }) };
    const topology = compileSimulationTopology({ document, registry, simulationMode: "single-base", standardTickRate: engineKind === "legacy" ? 20 : 4,
      poweredEntityIds: new Set(document.entityOrder), activeActivityIds: [] });
    expect(topology.diagnostics.filter(entry => entry.severity === "error")).toEqual([]);
    const engine = (engineKind === "legacy" ? createLegacyBlueprintEngine : createDenseBlueprintEngine)(registry, { topology, powerMode: "infinite", initialSlots: [] });
    const targetId = topology.ordering.deviceOrder.find(id => topology.devices[id]!.sourceEntityId === "target")!;
    return { engine, topology, targetId,
      read: () => engine.readDevices().find(device => device.deviceId === targetId)!,
    };
  }

  it.each(families)("$definition：普通自定义配方也进入统一优先级，不以配置概率为准入开关", family => {
    const test = scenario(family);
    try {
      test.engine.advance();
      expect(test.read().channelRecipes.default?.recipeId).toBe(RECIPE_ID);
    } finally { test.engine.dispose(); }
  });

  it.each(families)("$definition：未注入仍使用原有动态运输", family => {
    const test = scenario(family, { inject: false });
    try {
      test.engine.advance();
      expect(test.read().channelRecipes.default?.recipeId).toBe(`${family.definition}:dynamic-${family.pipe ? "pipe" : "belt"}-transfer`);
      expect(test.read().channelRecipes.default?.durationTicks).toBe((family.pipe ? PIPE_TRANSPORT_DURATION_SECONDS : BELT_TRANSPORT_DURATION_SECONDS) * test.topology.standardTickRate);
    } finally { test.engine.dispose(); }
  });

  it.each([
    { name: "未启用活动", extras: { tags: [ACTIVITY_LIMITED_FORMULA_1_TAG] } },
    { name: "消耗频道配方", extras: { tags: [CONSUMPTION_RECIPE_TAG] } },
    { name: "未满足气环境", extras: { requiredEnvironmentAnyOf: ["item_gas_xiranite"] } },
  ])("$name：不进入普通自动物流候选", ({ extras }) => {
    const test = scenario(families[0], { extras });
    try {
      test.engine.advance();
      expect(test.read().channelRecipes.default?.recipeId).toBe("belt_straight_1x1:dynamic-belt-transfer");
    } finally { test.engine.dispose(); }
  });

  it.each(["selected", "unselected"] as const)("手选频道 %s：动态运输不能绕过手选限制", manual => {
    const test = scenario(families[0], { manual });
    try {
      test.engine.advance();
      expect(test.read().channelRecipes.default?.recipeId ?? null).toBe(manual === "selected" ? RECIPE_ID : null);
    } finally { test.engine.dispose(); }
  });

  it("管道转化不得绕过既有流体域锁，不能混物或异常", () => {
    const test = scenario(families[2], { extras: { outputs: [{ itemId: "item_liquid_sewage", amount: 1 }] } });
    try {
      for (let tick = 0; tick <= test.topology.standardTickRate * 2; tick++) test.engine.advance();
      expect(test.read().channelRecipes.default).toMatchObject({ recipeId: RECIPE_ID, state: "waiting-output" });
      const targetSlots = test.engine.readSlots().filter(slot => test.topology.nodes[test.topology.slots[slot.slotId]!.nodeId]!.deviceId === test.targetId);
      expect(targetSlots.some(slot => slot.itemType === "item_liquid_sewage" && slot.count > 0)).toBe(false);
      expect(targetSlots.some(slot => slot.itemType === "item_liquid_water" && slot.count > 0)).toBe(true);
    } finally { test.engine.dispose(); }
  });
});
