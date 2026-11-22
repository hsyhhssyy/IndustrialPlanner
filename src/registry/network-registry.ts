import type { RegistryContract } from "@/domain/registry";
import type { CustomEntityDefinitionInput, RegistrySnapshot } from "@/domain/registry/types/custom-registry";
import type { EntityDefinition, PortGroupDefinition } from "@/domain/registry/types/entity-definition";
import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";
import { PLACEMENT_BEHAVIOR_TYPE } from "@/domain/registry/types/entity-placement-behavior";
import type { EntityRangeDefinition } from "@/domain/registry/types/entity-range";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import type { PeriodicRangeConversionProgram } from "@/domain/registry/types/periodic-range-conversion";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import { CUSTOM_REGISTRY_ASSET_ID, CUSTOM_REGISTRY_DEVICE_ASSET_PATH } from "@/shared/browser/custom-registry-assets";
import {
  CONSUMPTION_CHANNEL_IDS,
  CONSUMPTION_RECIPE_CHANNEL_TYPE,
  CONSUMPTION_RECIPE_TAG,
  CONSUMPTION_SLOT_ID,
  CONSUMPTION_STORAGE_GROUP_ID,
  NORMAL_RECIPE_CHANNEL_TYPE,
} from "@/shared/consumption-channel";
import { CUSTOM_PERIODIC_PHASE_CHANNEL_ID } from "@/shared/registry/recipe-channel-eligibility";
import { TOOLBOX_HIDDEN_RECIPE_TAG } from "@/shared/registry/recipe-visibility";
import { invalid, readNetworkRegistryLibrary } from "./network-registry-input";

const CONSUMPTION_SECONDS = 10;
const PHASE_ITEM_DOMAIN = {
  solid: ItemDomainFlag.Solid,
  liquid: ItemDomainFlag.Liquid,
  gas: ItemDomainFlag.Gas,
} as const;

function declaredById<T extends { id: string }>(entries: readonly T[], path: string): Map<string, T> {
  const result = new Map<string, T>();
  entries.forEach((entry, index) => {
    if (result.has(entry.id)) invalid(`${path}[${index}].id`, "定义 ID 重复");
    result.set(entry.id, entry);
  });
  return result;
}

function requireEntry<T>(entries: ReadonlyMap<string, T>, id: string, path: string): T {
  return entries.get(id) ?? invalid(path, `未注册的引用 ${id}`);
}

function mergeProtected<T extends { id: string }>(
  custom: readonly T[], protectedEntries: readonly T[], path: string,
  equivalent?: (left: T, right: T) => boolean,
): T[] {
  const result = declaredById(custom, path);
  for (const entry of protectedEntries) {
    const supplied = result.get(entry.id);
    if (supplied !== undefined && !equivalent?.(supplied, entry)) {
      invalid(path, `受保护的定义 ${entry.id} 由原版继承`);
    }
    result.set(entry.id, entry);
  }
  return [...result.values()];
}

function sameRange(left: EntityRangeDefinition, right: EntityRangeDefinition): boolean {
  return left.interactionKind === right.interactionKind
    && left.coverage === right.coverage
    && left.visualId === right.visualId
    && left.localRect.x === right.localRect.x && left.localRect.y === right.localRect.y
    && left.localRect.width === right.localRect.width && left.localRect.height === right.localRect.height
    && left.placementRule?.overlap === right.placementRule?.overlap
    && left.placementRule?.groupId === right.placementRule?.groupId
    && JSON.stringify(left.placementRule?.allowedSegments) === JSON.stringify(right.placementRule?.allowedSegments);
}

function compileEntity(
  input: CustomEntityDefinitionInput, id: string, nameKey: string, path: string,
  builtin: EntityDefinition | null, builtinRecipes: readonly RecipeDefinition[],
): EntityDefinition {
  const protectedRanges = new Set(builtinRecipes.flatMap(recipe => [
    ...(recipe.environmentOutput ? [recipe.environmentOutput.rangeId] : []),
    ...(recipe.periodicRangeConversion?.rangeIds ?? []),
  ]));
  const protectedChannels = builtin?.recipeChannels.filter(channel =>
    channel.startPolicy === "state" || channel.startPolicy === "environment-demand"
    || channel.id === builtin.stateMachine?.channelId || channel.id === "warehouse_submit"
    || (channel.type === CONSUMPTION_RECIPE_CHANNEL_TYPE && input.consumption === undefined),
  ) ?? [];
  const protectedGroupIds = new Set(protectedChannels.flatMap(channel => [
    ...channel.ingredientStorageGroupIds, ...channel.productStorageGroupIds,
  ]));
  for (const behavior of builtin?.simulationBehaviors ?? []) {
    behavior.storageSlotGroupIds.forEach(id => protectedGroupIds.add(id));
  }
  for (const inspector of builtin?.inspectors ?? []) {
    if ("slotGroupIds" in inspector && inspector.type !== INSPECTOR_TYPE.slotConfig) {
      inspector.slotGroupIds.forEach(id => protectedGroupIds.add(id));
    }
  }
  const protectedBindings = builtin?.portStorageBindings.filter(binding => protectedGroupIds.has(binding.storageSlotGroupId)) ?? [];
  const protectedPortIds = new Set(protectedBindings.map(binding => binding.portGroupId));
  const storageSlotGroups = mergeProtected(input.storageSlotGroups,
    builtin?.storageSlotGroups.filter(group => protectedGroupIds.has(group.id)) ?? [], `${path}.storageSlotGroups`);
  const recipeChannels = mergeProtected(input.recipeChannels, protectedChannels, `${path}.recipeChannels`);
  const portStorageBindings = mergeProtected(input.portStorageBindings, protectedBindings, `${path}.portStorageBindings`);
  const portGroups = mergeProtected(input.portGroups,
    builtin?.portGroups.filter(group => protectedPortIds.has(group.id)) ?? [], `${path}.portGroups`);
  const ranges = mergeProtected(input.ranges, builtin?.ranges?.filter(range =>
    protectedRanges.has(range.id) || range.interactionKind === "power") ?? [], `${path}.ranges`, sameRange);
  if (ranges.filter(range => range.interactionKind === "power").length > 1) invalid(`${path}.ranges`, "最多可有一个供电范围");
  const normalChannels = () => recipeChannels.filter(channel => channel.type !== CONSUMPTION_RECIPE_CHANNEL_TYPE);
  const slotGroupIds = input.storageSlotGroups.map(group => group.id);
  const inspectors = [
    ...(builtin?.inspectors.filter(inspector => inspector.type !== INSPECTOR_TYPE.recipeStatus
      && inspector.type !== INSPECTOR_TYPE.slotConfig) ?? []),
    ...(slotGroupIds.length > 0 ? [{ type: INSPECTOR_TYPE.slotConfig, slotGroupIds }] : []),
    ...(input.consumption && !builtin?.inspectors.some(inspector => inspector.type === INSPECTOR_TYPE.meteredConsumption)
      ? [{ type: INSPECTOR_TYPE.meteredConsumption }] : []),
    ...(input.periodicRangeConversion
      ? [{ type: INSPECTOR_TYPE.recipeStatus, channelIds: [...normalChannels().map(channel => channel.id), CUSTOM_PERIODIC_PHASE_CHANNEL_ID] }]
      : normalChannels().length > 0 ? [{ type: INSPECTOR_TYPE.recipeStatus, channelIds: normalChannels().map(channel => channel.id) }] : []),
  ] satisfies EntityDefinition["inspectors"];

  if (input.allowDuplicateRecipesAcrossChannels && input.recipeChannels.length < 2) {
    invalid(`${path}.allowDuplicateRecipesAcrossChannels`, "至少需要两个普通配方通道");
  }

  return {
    ...builtin,
    id,
    nameKey,
    spriteId: CUSTOM_REGISTRY_ASSET_ID,
    iconPath: CUSTOM_REGISTRY_DEVICE_ASSET_PATH,
    spriteAnimation: undefined,
    spriteOffset: undefined,
    uiGroup: builtin?.uiGroup ?? "custom",
    displayOrder: builtin?.displayOrder ?? 0,
    tags: builtin?.tags ?? ["Producer"],
    footprint: input.footprint,
    requiresPower: input.powerDemand > 0,
    powerDemand: input.powerDemand,
    inspectors,
    placementBehaviors: builtin?.placementBehaviors ?? [{ type: PLACEMENT_BEHAVIOR_TYPE.defaultPlacement }],
    recipeChannelBehavior: {
      ...builtin?.recipeChannelBehavior,
      allowDuplicateRecipesAcrossChannels: input.allowDuplicateRecipesAcrossChannels,
    },
    portGroups,
    storageSlotGroups,
    recipeChannels,
    portStorageBindings,
    ranges,
  };
}

function acceptsItem(port: PortGroupDefinition["ports"][number], itemId: string, domain: number) {
  const { base, exclude } = port.acceptRule;
  return !exclude.includes(itemId)
    && (base.kind === "item" && base.itemId === itemId || base.kind === "domain" && (base.flags & domain) !== 0);
}

function validateEntityReferences(entity: EntityDefinition, domains: ReadonlyMap<string, number>, path: string) {
  const ports = declaredById(entity.portGroups, `${path}.portGroups`);
  const storage = declaredById(entity.storageSlotGroups, `${path}.storageSlotGroups`);
  const channels = declaredById(entity.recipeChannels, `${path}.recipeChannels`);
  const { width, height } = entity.footprint;
  entity.portGroups.forEach((group, groupIndex) => {
    const groupPath = `${path}.portGroups[${groupIndex}]`;
    declaredById(group.ports, `${groupPath}.ports`);
    group.ports.forEach((port, index) => {
      const portPath = `${groupPath}.ports[${index}]`;
      const { localCellX: x, localCellY: y, edge } = port;
      const onBoundary = { NORTH: y === 0, EAST: x === width - 1, SOUTH: y === height - 1, WEST: x === 0 };
      if (x < 0 || x >= width || y < 0 || y >= height || !onBoundary[edge]) {
        invalid(`${path}.footprint`, "足印与原版保留端口不兼容");
      }
      const { base, exclude } = port.acceptRule;
      if (base.kind === "item") {
        const domain = requireEntry(domains, base.itemId, `${portPath}.acceptRule.base.itemId`);
        if (!(domain & group.kind)) invalid(`${portPath}.acceptRule.base.itemId`, "物品与端口域不兼容");
      }
      exclude.forEach((itemId, index) => requireEntry(domains, itemId, `${portPath}.acceptRule.exclude[${index}]`));
    });
  });
  entity.storageSlotGroups.forEach((group, groupIndex) => {
    const groupPath = `${path}.storageSlotGroups[${groupIndex}]`;
    declaredById(group.slots, `${groupPath}.slots`);
    const stocked = new Set<string>();
    group.slots.forEach((slot, index) => {
      if (slot.initialItemType === null) return;
      const slotPath = `${groupPath}.slots[${index}].initialItemType`;
      const domain = requireEntry(domains, slot.initialItemType, slotPath);
      if ((domain & (slot.itemFilterType ?? group.kind)) === 0 || stocked.has(slot.initialItemType)) {
        invalid(slotPath, "初始物品的相态与槽位不匹配或组内已有该物品");
      }
      stocked.add(slot.initialItemType);
    });
  });
  entity.recipeChannels.forEach((channel, index) => {
    for (const key of ["ingredientStorageGroupIds", "productStorageGroupIds"] as const) {
      channel[key].forEach((id, storageIndex) => requireEntry(storage, id, `${path}.recipeChannels[${index}].${key}[${storageIndex}]`));
    }
  });
  declaredById(entity.portStorageBindings, `${path}.portStorageBindings`);
  entity.portStorageBindings.forEach((binding, index) => {
    const bindingPath = `${path}.portStorageBindings[${index}]`;
    const port = requireEntry(ports, binding.portGroupId, `${bindingPath}.portGroupId`);
    const group = requireEntry(storage, binding.storageSlotGroupId, `${bindingPath}.storageSlotGroupId`);
    if ((port.kind & group.kind) === 0) invalid(bindingPath, "端口与绑定的存储槽组没有共同物品域");
  });
  entity.blockageAutoClearance?.channelIds.forEach(id => requireEntry(channels, id, `${path}.recipeChannels`));
  for (const ref of entity.blockageAutoClearance?.slotRefs ?? []) {
    const storageGroup = requireEntry(storage, ref.storageSlotGroupId, `${path}.storageSlotGroups`);
    if (ref.slotId !== undefined && !storageGroup.slots.some(slot => slot.id === ref.slotId)) {
      invalid(`${path}.storageSlotGroups`, "缺少原版堵塞清理所需槽位");
    }
  }
}

function appendConsumption(
  entity: EntityDefinition, input: NonNullable<CustomEntityDefinitionInput["consumption"]>, path: string,
  domains: ReadonlyMap<string, number>, singleChannel: boolean,
): RecipeDefinition[] {
  const ports = input.portGroupIds.map((id, index) => {
    const portPath = `${path}.portGroupIds[${index}]`;
    const group = entity.portGroups.find(group => group.id === id);
    if (group?.direction !== "input" || group.ports.length === 0) invalid(portPath, "消耗端口组必须具有输入端口");
    if (entity.portStorageBindings.some(binding => binding.portGroupId === id)) invalid(portPath, "消耗输入端口组不能另绑普通存储");
    return group;
  });
  let domain = 0;
  input.itemIds.forEach((id, index) => {
    const itemPath = `${path}.itemIds[${index}]`;
    const itemDomain = requireEntry(domains, id, itemPath);
    if (!ports.some(group => (group.kind & itemDomain) !== 0
      && group.ports.some(port => acceptsItem(port, id, itemDomain)))) invalid(itemPath, "消耗物品无法从选中的端口组输入");
    domain |= itemDomain;
  });
  entity.storageSlotGroups.push({
    id: CONSUMPTION_STORAGE_GROUP_ID,
    kind: domain,
    slots: [{
      id: CONSUMPTION_SLOT_ID,
      capacity: 5,
      lock: null,
      initialItemType: null,
      initialCount: 0,
      ignoreStock: false,
      itemFilter: "whitelist",
      itemFilterIds: [...input.itemIds],
    }],
  });
  entity.recipeChannels.push(...(singleChannel ? CONSUMPTION_CHANNEL_IDS.slice(0, 1) : CONSUMPTION_CHANNEL_IDS).map(id => ({
    id,
    type: CONSUMPTION_RECIPE_CHANNEL_TYPE,
    ingredientStorageGroupIds: [CONSUMPTION_STORAGE_GROUP_ID],
    productStorageGroupIds: [],
  })));
  entity.portStorageBindings.push(...ports.map(group => ({
    id: `custom_consumption:${group.id}`, portGroupId: group.id, storageSlotGroupId: CONSUMPTION_STORAGE_GROUP_ID,
  })));
  return input.itemIds.map((itemId, index) => ({
    id: `custom:consumption:${entity.id}:${index}`,
    nameKey: "registry.recipe.internal_device_consumption.name",
    durationSeconds: CONSUMPTION_SECONDS,
    inputs: [{ itemId, amount: 1 }],
    outputs: [],
    machineId: entity.id,
    recipeType: "reserved-item",
    tags: [TOOLBOX_HIDDEN_RECIPE_TAG, CONSUMPTION_RECIPE_TAG],
  }));
}

export function compileNetworkRegistry(input: unknown, base: RegistryContract): RegistrySnapshot {
  const library = readNetworkRegistryLibrary(input);
  const customEntityUuids: Record<string, string> = Object.create(null);
  const overrideEntityUuids: Record<string, string> = Object.create(null);
  const itemUuids: Record<string, string> = Object.create(null);
  const recipeUuids: Record<string, string> = Object.create(null);
  const names: Record<string, string> = Object.create(null);
  const itemsById = declaredById(base.itemDefinitions, "$.items");
  const domains = new Map(base.itemDefinitions.map(item => [item.id, base.queries.resolveItemDomain(item.id)!]));
  const entitiesById = declaredById(base.entityDefinitions, "$.entities");
  const recipesById = declaredById(base.recipeDefinitions, "$.recipes");
  const registerName = (id: string, name: string) => {
    const key = `registry.network.${id}.name`;
    names[key] = name;
    return key;
  };
  library.items.forEach((item, index) => {
    const id = `custom:item:${item.uuid}`;
    if (itemsById.has(id)) invalid(`$.items[${index}].uuid`, "物品 UUID 重复");
    const fluidColors = item.phase === "gas"
      ? itemsById.get("item_gas_water")!.fluidColors
      : item.phase === "liquid" ? itemsById.get("item_liquid_xiranite_poly")!.fluidColors : undefined;
    const definition: ItemDefinition = {
      id,
      nameKey: registerName(id, item.name),
      iconId: CUSTOM_REGISTRY_ASSET_ID,
      displayOrder: Number.MAX_SAFE_INTEGER,
      tags: item.phase === "solid" ? [] : [item.phase],
      ...(fluidColors && { fluidColors }),
    };
    itemsById.set(id, definition);
    domains.set(id, PHASE_ITEM_DOMAIN[item.phase]);
    itemUuids[id] = item.uuid;
  });
  const programs: Map<string, PeriodicRangeConversionProgram> = declaredById(library.periodicRangeConversionPrograms ?? [], "$.periodicRangeConversionPrograms");
  const programSignatures = new Map<string, PeriodicRangeConversionProgram>();
  for (const recipe of base.recipeDefinitions) {
    const program = recipe.periodicRangeConversion?.program;
    if (program) programSignatures.set(program.id, program);
  }
  const signature = (program: PeriodicRangeConversionProgram) => JSON.stringify([
    program.periodSeconds,
    program.effects.map(effect => [effect.probabilityByLayer, Object.entries(effect.outputItemByInputId).sort()]),
  ]);
  [...programs.values()].forEach((program, index) => {
    const path = `$.periodicRangeConversionPrograms[${index}]`;
    program.effects.forEach((effect, effectIndex) => {
      for (const [source, output] of Object.entries(effect.outputItemByInputId)) {
        if (domains.get(source) !== ItemDomainFlag.Solid || domains.get(output) !== ItemDomainFlag.Solid) {
          invalid(`${path}.effects[${effectIndex}].outputItemByInputId.${source}`, "转化映射必须使用已注册的固体物品");
        }
      }
    });
    const builtin = programSignatures.get(program.id);
    if (builtin !== undefined && signature(builtin) !== signature(program)) invalid(`${path}.id`, "与原版转化程序冲突");
    if (builtin !== undefined) programs.set(program.id, builtin);
  });

  const entityUuids = new Set<string>();
  const removedConsumptionMachines = new Set<string>();
  const addRecipe = (recipe: RecipeDefinition, uuid: string, path: string) => {
    if (recipesById.has(recipe.id)) invalid(path, "配方 ID 或 UUID 重复");
    recipesById.set(recipe.id, recipe);
    recipeUuids[recipe.id] = uuid;
  };

  library.entities.forEach((input, index) => {
    const path = `$.entities[${index}]`;
    if (entityUuids.has(input.uuid)) invalid(`${path}.uuid`, "设备 UUID 重复");
    entityUuids.add(input.uuid);
    const overrideId = input.overrideDefinitionId;
    const id = overrideId ?? `custom:entity:${input.uuid}:${input.footprint.width}x${input.footprint.height}`;
    const builtin = overrideId ? base.queries.findEntityDefinition(overrideId) : null;
    if (overrideId) {
      if (builtin === null || base.queries.isBeltFamily(id) || base.queries.isPipeFamily(id)
        || base.queries.isProtocolCore(id) || Object.hasOwn(overrideEntityUuids, id)) {
        invalid(`${path}.overrideDefinitionId`, "覆盖目标不存在、禁止覆盖或重复");
      }
      overrideEntityUuids[id] = input.uuid;
    } else {
      if (entitiesById.has(id)) invalid(`${path}.uuid`, "设备定义 ID 重复");
      customEntityUuids[id] = input.uuid;
    }
    const builtinRecipes = base.queries.findRecipeDefinitionsByMachine(id);
    const entity = compileEntity(input, id, registerName(id, input.name), path, builtin, builtinRecipes);
    if (input.consumption) {
      if (builtinRecipes.some(recipe => recipe.tags.includes(CONSUMPTION_RECIPE_TAG) && recipe.environmentOutput)) {
        invalid(`${path}.consumption`, "不能替换原版提供环境的消耗配方");
      }
      for (const recipe of appendConsumption(entity, input.consumption, `${path}.consumption`, domains, input.periodicRangeConversion !== undefined)) {
        addRecipe(recipe, input.uuid, `${path}.consumption`);
      }
      removedConsumptionMachines.add(entity.id);
    }
    if (input.periodicRangeConversion) {
      const periodicPath = `${path}.periodicRangeConversion`;
      const conversion = input.periodicRangeConversion;
      if (!input.consumption) invalid(`${path}.consumption`, "周期手选相位必须声明消耗输入");
      if (conversion.phases[0]!.side === conversion.phases[1]!.side) invalid(`${periodicPath}.phases`, "两相位必须分别对应两侧");
      const program = requireEntry(programs, conversion.programId, `${periodicPath}.programId`);
      const ranges = declaredById(entity.ranges ?? [], `${path}.ranges`);
      conversion.rangeIds.forEach((rangeId, index) => requireEntry(ranges, rangeId, `${periodicPath}.rangeIds[${index}]`));
      entity.recipeChannels.push({
        id: CUSTOM_PERIODIC_PHASE_CHANNEL_ID,
        type: NORMAL_RECIPE_CHANNEL_TYPE,
        ingredientStorageGroupIds: [],
        productStorageGroupIds: [],
        manualRecipeOnly: true,
      });
      conversion.phases.forEach((phase, index) => {
        const id = `custom:recipe:${phase.uuid}`;
        addRecipe({
          id,
          nameKey: registerName(id, phase.name),
          durationSeconds: CONSUMPTION_SECONDS,
          inputs: [],
          outputs: [],
          machineId: entity.id,
          recipeType: "reserved-item",
          tags: [],
          periodicRangeConversion: { rangeIds: conversion.rangeIds, side: phase.side, program },
        }, phase.uuid, `${periodicPath}.phases[${index}].uuid`);
      });
    }
    validateEntityReferences(entity, domains, path);
    entitiesById.set(id, entity);
  });

  library.recipes.forEach((recipe, index) => {
    const path = `$.recipes[${index}]`;
    const id = `custom:recipe:${recipe.uuid}`;
    const machine = requireEntry(entitiesById, recipe.machineId, `${path}.machineId`);
    for (const key of ["inputs", "outputs"] as const) {
      const seen = new Set<string>();
      recipe[key].forEach(({ itemId }, index) => {
        const itemPath = `${path}.${key}[${index}].itemId`;
        requireEntry(domains, itemId, itemPath);
        if (seen.has(itemId)) invalid(itemPath, "配方同侧物品重复");
        seen.add(itemId);
      });
    }
    const environmentDomain = (id: string, path: string) => {
      const domain = requireEntry(domains, id, path);
      if (domain === ItemDomainFlag.Solid) invalid(path, "环境物品必须为液体或气体");
      return domain;
    };
    recipe.requiredEnvironmentAnyOf?.forEach((itemId, index) =>
      environmentDomain(itemId, `${path}.requiredEnvironmentAnyOf[${index}]`));
    if (recipe.environmentOutput) {
      const domain = environmentDomain(recipe.environmentOutput.itemId, `${path}.environmentOutput.itemId`);
      const range = machine.ranges?.find(range => range.id === recipe.environmentOutput!.rangeId);
      if (range?.interactionKind !== (domain === ItemDomainFlag.Gas ? "gas" : "irrigation")) {
        invalid(`${path}.environmentOutput.rangeId`, "环境物品与作用范围类型不匹配");
      }
    }
    const { machineId, durationSeconds, inputs, outputs, recipeType, probability, requiredEnvironmentAnyOf, environmentOutput } = recipe;
    addRecipe({
      id,
      nameKey: registerName(id, recipe.name),
      machineId, durationSeconds, inputs, outputs, recipeType, probability, requiredEnvironmentAnyOf, environmentOutput,
      primaryOutputs: outputs.slice(0, 1).map(output => output.itemId),
      tags: [],
    }, recipe.uuid, `${path}.uuid`);
  });

  return {
    baseDefinitions: base.baseDefinitions,
    entityVariantDefinitions: base.entityVariantDefinitions,
    entityDefinitions: [...entitiesById.values()],
    itemDefinitions: [...itemsById.values()],
    recipeDefinitions: [...recipesById.values()].filter(recipe =>
      !removedConsumptionMachines.has(recipe.machineId)
      || !recipe.tags.includes(CONSUMPTION_RECIPE_TAG)
      || Object.hasOwn(recipeUuids, recipe.id)),
    customContent: { customEntityUuids, overrideEntityUuids, itemUuids, recipeUuids, names },
  };
}
