import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import { CUSTOM_PERIODIC_PHASE_CHANNEL_ID } from "@/shared/registry/recipe-channel-eligibility";
import {
  createNetworkRegistryContract,
  createRegistryContract,
  readNetworkRegistryEntityMigrations,
  snapshotRegistry,
} from "@/registry";

const deviceUuid = "11111111-1111-4111-8111-111111111111";
const feedUuid = "22222222-2222-4222-8222-222222222222";
const outputUuid = "33333333-3333-4333-8333-333333333333";
const recipeUuid = "44444444-4444-4444-8444-444444444444";
const deviceId = `custom:entity:${deviceUuid}:2x1`;
const feedId = `custom:item:${feedUuid}`;
const outputId = `custom:item:${outputUuid}`;
const recipeId = `custom:recipe:${recipeUuid}`;

function createLibrary() {
  return {
    formatVersion: 1,
    items: [
      { uuid: feedUuid, name: "虚构原料", phase: "solid" },
      { uuid: outputUuid, name: "虚构产物", phase: "solid" },
    ],
    entities: [{
      uuid: deviceUuid,
      name: "虚构设备",
      footprint: { width: 2, height: 1 },
      powerDemand: 6,
      portGroups: [{
        id: "feed_port",
        kind: ItemDomainFlag.Solid,
        direction: "input",
        isPipe: false,
        ports: [{
          id: "north",
          localCellX: 0,
          localCellY: 0,
          edge: "NORTH",
          priorityGroup: 5,
          roundRobinSeed: 0,
          acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Solid }, exclude: [] },
        }],
      }],
      storageSlotGroups: [],
      recipeChannels: [{
        id: "ordinary",
        type: "normal-channel",
        ingredientStorageGroupIds: [],
        productStorageGroupIds: [],
      }],
      portStorageBindings: [],
      ranges: [{
        id: "first",
        localRect: { x: 2, y: 0, width: 2, height: 2 },
        coverage: "contains",
        visualId: "power",
        placementRule: { groupId: "demo", overlap: "disjoint-or-equal", allowedSegments: ["pipe"] },
      }],
      allowDuplicateRecipesAcrossChannels: false,
      consumption: { itemIds: [feedId, outputId], portGroupIds: ["feed_port"] },
      periodicRangeConversion: {
        programId: "demo-program",
        rangeIds: ["first"],
        phases: [
          { side: 0, uuid: "55555555-5555-4555-8555-555555555555", name: "明" },
          { side: 1, uuid: "66666666-6666-4666-8666-666666666666", name: "晦" },
        ],
      },
    }],
    recipes: [{
      uuid: recipeUuid,
      name: "虚构配方",
      machineId: deviceId,
      recipeType: "reserved-item",
      durationSeconds: 2,
      inputs: [],
      outputs: [],
      probability: 0.25,
    }],
    periodicRangeConversionPrograms: [{
      id: "demo-program",
      periodSeconds: 2.5,
      effects: [
        { probabilityByLayer: [0.35], outputItemByInputId: { [feedId]: outputId } },
        { probabilityByLayer: [0.7, 1], outputItemByInputId: { [outputId]: feedId } },
        { probabilityByLayer: [0, 1], outputItemByInputId: { [feedId]: outputId } },
      ],
    }],
    entityMigrations: { [deviceId]: "later_builtin_device" },
  };
}

describe("network Registry compilation", () => {
  it("compiles both manual phases with a shared program and one OR consumption channel", () => {
    const packageInput = createLibrary();
    const registry = createNetworkRegistryContract(packageInput);
    const device = registry.queries.findEntityDefinition(deviceId)!;
    const recipes = registry.queries.findRecipeDefinitionsByMachine(deviceId);
    const consumptionRecipes = recipes.filter(recipe => recipe.tags.includes(CONSUMPTION_RECIPE_TAG));
    const phases = recipes.filter(recipe => recipe.periodicRangeConversion !== undefined);
    expect(device).toMatchObject({ uiGroup: "custom", requiresPower: true, footprint: { width: 2, height: 1 } });
    expect(device.recipeChannels.filter(channel => channel.type === "consumption-channel")).toHaveLength(1);
    expect(device.recipeChannels.find(channel => channel.id === CUSTOM_PERIODIC_PHASE_CHANNEL_ID)?.manualRecipeOnly).toBe(true);
    expect(consumptionRecipes.map(recipe => recipe.inputs)).toEqual([[{ itemId: feedId, amount: 1 }], [{ itemId: outputId, amount: 1 }]]);
    expect(phases.map(recipe => recipe.periodicRangeConversion?.side)).toEqual([0, 1]);
    expect(phases[0]!.periodicRangeConversion!.programId).toBe(phases[1]!.periodicRangeConversion!.programId);
    expect(phases[0]!.periodicRangeConversion!.rangeIds).toEqual(["first"]);
    expect(registry.queries.findRecipeDefinition(recipeId)?.probability).toBe(0.25);
    expect(registry.customContent.names[device.nameKey]).toBe("虚构设备");
    expect(registry.customContent.recipeUuids[consumptionRecipes[0]!.id]).toBe(deviceUuid);
    expect(readNetworkRegistryEntityMigrations(packageInput)).toEqual({ [deviceId]: "later_builtin_device" });
    const restored = createRegistryContract(structuredClone(snapshotRegistry(registry)));
    expect(restored.queries.findEntityDefinition(deviceId)).toEqual(device);
    expect(restored.recipeDefinitions).toEqual(registry.recipeDefinitions);
    expect(existsSync(`public/${device.iconPath}`)).toBe(true);
  });

  it("旧快照将逐配方比例折叠到阵型，冲突指出两条来源及层数", () => {
    const library = createLibrary();
    const original = createNetworkRegistryContract(library);
    const family = original.formationDefinitions.find(group => group.id === "demo-program")!;
    const secondId = "custom:recipe:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const materials = createNetworkRegistryContract({
      ...library, recipes: [...library.recipes, { uuid: secondId.slice("custom:recipe:".length), name: "第三种原料",
        machineId: family.effects.ming.machineId, inputs: [{ itemId: "item_copper_ore", amount: 1 }],
        outputs: [{ itemId: outputId, amount: 1 }] }],
    });
    const legacy = structuredClone(snapshotRegistry(materials));
    for (const group of legacy.formationDefinitions) {
      const machines = Object.fromEntries(Object.entries(group.effects).map(([key, effect]) => [key, effect.machineId]));
      Reflect.deleteProperty(group, "effects");
      Object.assign(group, { machines });
    }
    for (const recipe of legacy.recipeDefinitions) {
      const effect = materials.queries.findFormationRecipeEffect(recipe);
      if (effect) Object.assign(recipe, { behavior: { behaviorId: "formation-transfer", params: { chanceByLayer: [...effect.selectionRatioByLayer] } } });
    }
    const restored = createRegistryContract(legacy);
    expect(snapshotRegistry(restored)).toEqual(snapshotRegistry(materials));
    const second = legacy.recipeDefinitions.find(recipe => recipe.id === secondId)!;
    Object.assign(second, { behavior: { behaviorId: "formation-transfer", params: { chanceByLayer: [.35, .5] } } });
    const firstId = materials.queries.findRecipeDefinitionsByMachine(family.effects.ming.machineId)[0]!.id;
    expect(() => createRegistryContract(legacy)).toThrow(firstId + " / " + secondId + " 第 2 层");
  });

  it("derives protected fluid colors and retains the original override category", () => {
    const library = createLibrary();
    library.items[0]!.phase = "gas";
    library.items[1]!.phase = "liquid";
    const base = createRegistryContract();
    const target = base.entityDefinitions.find(definition =>
      definition.uiGroup === "basicProduction" && definition.placementWhitelist === undefined)!;
    const registry = createNetworkRegistryContract({
      ...library,
      entities: [{ ...library.entities[0], overrideDefinitionId: target.id, consumption: undefined, periodicRangeConversion: undefined }],
      recipes: [],
      periodicRangeConversionPrograms: [],
    });
    const entity = registry.queries.findEntityDefinition(target.id)!;
    expect(entity.uiGroup).toBe(target.uiGroup);
    expect(entity.spriteId).toBe("custom_registry_unknown");
    expect(registry.customContent.overrideEntityUuids[target.id]).toBe(deviceUuid);
    expect(base.queries.findEntityDefinition(target.id)).toBe(target);
    expect(registry.queries.findItemDefinition(feedId)?.fluidColors).toEqual(base.queries.findItemDefinition("item_gas_water")?.fluidColors);
    expect(registry.queries.findItemDefinition(outputId)?.fluidColors).toEqual(base.queries.findItemDefinition("item_liquid_xiranite_poly")?.fluidColors);
  });

  it("uses the override's two per-port exclusion rules without modifying the built-in device", () => {
    const library = createLibrary();
    const thirdUuid = "77777777-7777-4777-8777-777777777777";
    const thirdId = `custom:item:${thirdUuid}`;
    const base = createRegistryContract();
    const target = base.entityDefinitions.find(definition =>
      definition.uiGroup === "basicProduction" && definition.placementWhitelist === undefined)!;
    const originalPorts = structuredClone(target.portGroups);
    const originalSlots = structuredClone(target.storageSlotGroups);
    const template = library.entities[0]!;
    const port = template.portGroups[0]!.ports[0]!;
    const registry = createNetworkRegistryContract({
      ...library,
      items: [...library.items, { uuid: thirdUuid, phase: "solid", name: "虚构第三种物品" }],
      entities: [{
        ...template,
        overrideDefinitionId: target.id,
        consumption: undefined,
        periodicRangeConversion: undefined,
        portGroups: [{
          id: "sorted_output",
          kind: ItemDomainFlag.Solid,
          isPipe: false,
          direction: "output",
          ports: [
            { ...port, id: "left", acceptRule: { ...port.acceptRule, exclude: [feedId] } },
            { ...port, id: "right", localCellX: 1, acceptRule: { ...port.acceptRule, exclude: [outputId] } },
          ],
        }],
      }],
      recipes: [],
      periodicRangeConversionPrograms: [],
    });
    const overridden = registry.queries.findEntityDefinition(target.id)!;
    const exclusions = overridden.portGroups[0]!.ports.map(port => port.acceptRule.exclude);
    expect(exclusions).toEqual([[feedId], [outputId]]);
    expect(exclusions.every(exclude => !exclude.includes(thirdId))).toBe(true);
    const restored = createRegistryContract().queries.findEntityDefinition(target.id)!;
    expect(restored.portGroups).toEqual(originalPorts);
    expect(restored.storageSlotGroups).toEqual(originalSlots);
  });

  it("两个设备引用同一 v1 程序只展开一次，另一条转化配方可直接登记", () => {
    const library = createLibrary();
    const first = library.entities[0]!;
    const second = { ...first, uuid: "77777777-7777-4777-8777-777777777777",
      periodicRangeConversion: { ...first.periodicRangeConversion, phases: first.periodicRangeConversion.phases.map((phase, index) =>
        ({ ...phase, uuid: index ? "88888888-8888-4888-8888-888888888888" : "99999999-9999-4999-8999-999999999999" })) } };
    const registry = createNetworkRegistryContract({ ...library, entities: [first, second] });
    const family = registry.formationDefinitions.find(definition => definition.id === "demo-program")!;
    expect(registry.queries.findEntityDefinition(family.effects.ming.machineId)?.derivedFromDeviceIds).toHaveLength(2);
    expect(registry.queries.findRecipeDefinitionsByMachine(family.effects.ming.machineId)).toHaveLength(1);
    const material = { uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "新物料路线", machineId: family.effects.ming.machineId,
      inputs: [{ itemId: "item_copper_ore", amount: 1 }], outputs: [{ itemId: outputId, amount: 1 }],
    };
    const oldBehavior = { behaviorId: "formation-transfer", params: { chanceByLayer: family.effects.ming.selectionRatioByLayer } };
    const withRecipe = (r: unknown) => createNetworkRegistryContract({ ...library, recipes: [...library.recipes, r] });
    expect(withRecipe(material).queries.findRecipeDefinition("custom:recipe:" + material.uuid)?.durationSeconds).toBe(family.periodSeconds);
    expect(withRecipe({ ...material, behavior: oldBehavior }).queries.findRecipeDefinition("custom:recipe:" + material.uuid)).not.toHaveProperty("behavior");
    expect(() => withRecipe({ ...material, behavior: { ...oldBehavior, params: { chanceByLayer: [.35, .5] } } })).toThrow("层选格比例冲突");
    expect(() => withRecipe({ ...material, inputs: [{ itemId: feedId, amount: 1 }] })).toThrow("$.recipes[1].inputs");
    expect(() => withRecipe({ ...material, behavior: { ...oldBehavior, behaviorId: "unknown" } })).toThrow("$.recipes[1].behavior.behaviorId");
    expect(() => withRecipe({ ...material, behavior: { ...oldBehavior, params: { chanceByLayer: [1.01] } } })).toThrow("$.recipes[1].behavior.params.chanceByLayer");
  });

  it("rejects duplicate identities, unsupported fields and invalid references atomically", () => {
    const library = createLibrary();
    expect(() => createNetworkRegistryContract({ ...library, items: [...library.items, library.items[0]] })).toThrow("$.items[2].uuid");
    expect(() => createNetworkRegistryContract({
      ...library, recipes: [{ ...library.recipes[0], outputTarget: "warehouse" }],
    })).toThrow("$.recipes[0].outputTarget");
    library.entities[0]!.portGroups[0]!.ports[0]!.localCellX = 2;
    expect(() => createNetworkRegistryContract(library)).toThrow("$.entities[0].portGroups[0].ports[0]");
    expect(createRegistryContract().queries.findEntityDefinition(deviceId)).toBeNull();
  });

  it("rejects geometry that would exhaust grid indexing", () => {
    const library = createLibrary();
    library.entities[0]!.footprint.width = Number.MAX_SAFE_INTEGER;
    expect(() => createNetworkRegistryContract(library)).toThrow("$.entities[0].footprint.width");
    library.entities[0]!.footprint.width = 2;
    library.entities[0]!.ranges[0]!.localRect.x = Number.MAX_SAFE_INTEGER;
    expect(() => createNetworkRegistryContract(library)).toThrow("$.entities[0].ranges[0].localRect.x");
    library.entities[0]!.ranges[0]!.localRect.x = 2;
    library.entities[0]!.ranges[0]!.localRect.height = Number.MAX_SAFE_INTEGER;
    expect(() => createNetworkRegistryContract(library)).toThrow("$.entities[0].ranges[0].localRect.height");
  });

  it("rejects unknown ranges, unrepresentable periods and non-solid conversion mappings", () => {
    const library = createLibrary();
    library.entities[0]!.periodicRangeConversion.rangeIds = ["missing"];
    expect(() => createNetworkRegistryContract(library)).toThrow("$.entities[0].periodicRangeConversion.rangeIds[0]");
    library.entities[0]!.periodicRangeConversion.rangeIds = ["first"];
    library.periodicRangeConversionPrograms[0]!.periodSeconds = 0.25;
    expect(() => createNetworkRegistryContract(library)).toThrow("$.periodicRangeConversionPrograms[0].periodSeconds");
    library.periodicRangeConversionPrograms[0]!.periodSeconds = 2.5;
    library.items[0]!.phase = "gas";
    expect(() => createNetworkRegistryContract(library)).toThrow("$.periodicRangeConversionPrograms[0].effects[0].outputItemByInputId");
  });
});

// AI-REMOVED 2026-11-26:
// Reason: ST3-RQ-002 测试夹具及断言改为读取配方行为、独立投影口和真实工序维度。
// Trigger: 阵列四层必成、双口独立和跨读者单一配方来源的已确认需求。
// Evidence: 此文件的原有声明或消费者引用已迁入下述实现，回归清单见 ST3-RQ-002 执行日志。
// Replacement: 本文件中对应测试及 src/tests/simulation/formation-projections.test.ts
// Risk: 恢复历史逻辑会同时启用两条业务路径。
// Human Review: Required
//
// Original code:
//     expect(phases[0]!.periodicRangeConversion!.program).toBe(phases[1]!.periodicRangeConversion!.program);
