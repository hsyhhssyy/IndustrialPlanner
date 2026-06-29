import type { RegistryContract } from "@/domain/registry/registry-contract";
import type {
  ModuleBalancingCanvas,
  ModuleBalancingCustomModule,
  ModuleBalancingIOPort,
  ModuleBalancingModule,
  ModuleBalancingStage,
  ModuleBalancingState,
  ModuleBalancingSystemRecipeModule,
} from "@/app/toolbox-types";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { createDeviceIconAssetUrl, createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import {
  isItemAvailableByActivity,
  isRecipeAvailableByActivity,
  resolveActivityIdsFromTags,
} from "@/shared/registry/activity-availability";
import { isRecipeVisibleInToolbox } from "@/shared/registry/recipe-visibility";

export interface ModuleBalancingItemBalance {
  itemId: string;
  totalInput: number;
  totalOutput: number;
  netDelta: number;
}

export interface ModuleBalancingStageBalance {
  stageId: string;
  balances: ModuleBalancingItemBalance[];
}

export interface ModuleBalancingWarehouseForecast {
  itemId: string;
  netDeltaPerMin: number;
  timeToFillMinutes: number | null;
  timeToEmptyMinutes: number | null;
}

export interface ModuleBalancingDispatchTicketSummary {
  itemId: string;
  value: number;
  region: string | null;
  netDelta: number;
  dispatchPerMin: number;
}

export interface ModuleBalancingComputation {
  stageBalances: ModuleBalancingStageBalance[];
  summaryBalances: ModuleBalancingItemBalance[];
  warehouseForecasts: ModuleBalancingWarehouseForecast[];
  dispatchTicketSummaries: ModuleBalancingDispatchTicketSummary[];
}

export interface ModuleBalancingIndex {
  itemById: Map<string, ItemDefinition>;
  entityById: Map<string, EntityDefinition>;
  recipeById: Map<string, RecipeDefinition>;
  allRecipeById: Map<string, RecipeDefinition>;
  customModuleById: Map<string, ModuleBalancingCustomModule>;
  systemModules: ModuleBalancingSystemRecipeModule[];
  allItems: ItemDefinition[];
  allEntities: EntityDefinition[];
}

interface ModuleBalancingIndexOptions {
  includeInactiveActivityContent?: boolean;
  activeActivityIds?: readonly string[];
}

interface MutableItemBalance {
  itemId: string;
  totalInput: number;
  totalOutput: number;
}

export function buildModuleBalancingIndex(
  registry: RegistryContract,
  state: ModuleBalancingState,
  options: ModuleBalancingIndexOptions = {},
): ModuleBalancingIndex {
  const includeInactiveActivityContent = options.includeInactiveActivityContent ?? true;
  const activeActivityIds = options.activeActivityIds ?? [];
  const itemById = new Map(registry.itemDefinitions.map((item) => [item.id, item]));
  const entityById = new Map(registry.entityDefinitions.map((entity) => [entity.id, entity]));
  const itemDefinitions = includeInactiveActivityContent
    ? registry.itemDefinitions
    : registry.itemDefinitions.filter((item) => isItemAvailableByActivity(item, activeActivityIds));
  const visibleRecipes = registry.recipeDefinitions.filter(isRecipeVisibleInToolbox);
  const availableRecipes = visibleRecipes.filter((recipe) =>
    includeInactiveActivityContent
    || isRecipeAvailableByActivity(recipe, activeActivityIds),
  );
  const allRecipeById = new Map(visibleRecipes.map((recipe) => [recipe.id, recipe]));
  const recipeById = new Map(availableRecipes.map((recipe) => [recipe.id, recipe]));
  const customModuleById = new Map(state.customModules.map((module) => [module.id, module]));
  const systemModules = availableRecipes.map((recipe) => ({
    id: recipe.id,
    recipeId: recipe.id,
    sourceType: "system-recipe" as const,
  }));

  return {
    itemById,
    entityById,
    recipeById,
    allRecipeById,
    customModuleById,
    systemModules,
    allItems: [...itemDefinitions].sort((left, right) => left.nameKey.localeCompare(right.nameKey)),
    allEntities: registry.entityDefinitions
      .filter((entity) => entity.uiGroup !== "hidden")
      .sort((left, right) => left.nameKey.localeCompare(right.nameKey)),
  };
}

export function computeModuleBalancing(
  canvas: ModuleBalancingCanvas,
  index: ModuleBalancingIndex,
): ModuleBalancingComputation {
  const cumulativeBalances = new Map<string, MutableItemBalance>();
  const summaryBalances = new Map<string, MutableItemBalance>();

  for (const input of canvas.globalInputs) {
    addOutput(cumulativeBalances, input.itemId, input.perMinute);
    addOutput(summaryBalances, input.itemId, input.perMinute);
  }

  const stageBalances: ModuleBalancingStageBalance[] = [];
  for (const stage of canvas.stages) {
    const stageTotals = computeStageModuleTotals(stage, index);
    mergeBalances(summaryBalances, stageTotals);
    mergeBalances(cumulativeBalances, stageTotals);
    stageBalances.push({
      stageId: stage.id,
      balances: sortItemBalances(finalizeBalances(cumulativeBalances), index),
    });
  }

  const finalizedSummary = sortItemBalances(finalizeBalances(summaryBalances), index);
  return {
    stageBalances,
    summaryBalances: finalizedSummary,
    warehouseForecasts: computeWarehouseForecasts(finalizedSummary, canvas.warehouseCapacity),
    dispatchTicketSummaries: computeDispatchTicketSummaries(finalizedSummary, index),
  };
}

export function computeStageModuleTotals(
  stage: ModuleBalancingStage,
  index: ModuleBalancingIndex,
): ModuleBalancingItemBalance[] {
  const balances = new Map<string, MutableItemBalance>();
  for (const entry of stage.entries) {
    const ports = resolveModulePorts(entry.moduleId, index);
    if (ports === null) {
      continue;
    }

    for (const input of ports.inputs) {
      addInput(balances, input.itemId, input.perMinute * entry.quantity);
    }
    for (const output of ports.outputs) {
      addOutput(balances, output.itemId, output.perMinute * entry.quantity);
    }
  }

  return sortItemBalances(finalizeBalances(balances), index);
}

export function computeWarehouseForecasts(
  balances: readonly ModuleBalancingItemBalance[],
  warehouseCapacity: number | null,
): ModuleBalancingWarehouseForecast[] {
  if (warehouseCapacity === null || warehouseCapacity <= 0) {
    return [];
  }

  return balances.map((balance) => ({
    itemId: balance.itemId,
    netDeltaPerMin: balance.netDelta,
    timeToFillMinutes: balance.netDelta > 0 ? warehouseCapacity / balance.netDelta : null,
    timeToEmptyMinutes: balance.netDelta < 0 ? warehouseCapacity / Math.abs(balance.netDelta) : null,
  }));
}

export function resolveModule(moduleId: string, index: ModuleBalancingIndex): ModuleBalancingModule | null {
  const customModule = index.customModuleById.get(moduleId);
  if (customModule !== undefined) {
    return customModule;
  }

  if (!index.recipeById.has(moduleId)) {
    return null;
  }

  return {
    id: moduleId,
    recipeId: moduleId,
    sourceType: "system-recipe",
  };
}

export function resolveModulePorts(
  moduleId: string,
  index: ModuleBalancingIndex,
): { inputs: ModuleBalancingIOPort[]; outputs: ModuleBalancingIOPort[] } | null {
  const customModule = index.customModuleById.get(moduleId);
  if (customModule !== undefined) {
    return {
      inputs: customModule.inputs.map(clonePort),
      outputs: customModule.outputs.map(clonePort),
    };
  }

  const recipe = index.recipeById.get(moduleId);
  if (recipe === undefined || recipe.durationSeconds <= 0) {
    return null;
  }

  const multiplier = 60 / recipe.durationSeconds;
  return {
    inputs: recipe.inputs.map((input) => ({
      itemId: input.itemId,
      perMinute: roundFlow(input.amount * multiplier),
    })),
    outputs: recipe.outputs.map((output) => ({
      itemId: output.itemId,
      perMinute: roundFlow(output.amount * multiplier),
    })),
  };
}

export function resolveModuleOutputs(
  module: ModuleBalancingModule,
  index: ModuleBalancingIndex,
): ModuleBalancingIOPort[] {
  if (module.sourceType === "custom") {
    return module.outputs.map(clonePort);
  }

  return resolveModulePorts(module.recipeId, index)?.outputs ?? [];
}

export function resolveModuleActivityIds(
  module: ModuleBalancingModule,
  index: ModuleBalancingIndex,
): string[] {
  if (module.sourceType === "custom") {
    return resolveActivityIdsFromItemIds(
      [...module.inputs, ...module.outputs].map((port) => port.itemId),
      index,
    );
  }

  const recipe = index.allRecipeById.get(module.recipeId) ?? index.recipeById.get(module.recipeId);
  if (recipe === undefined) {
    return [];
  }

  return dedupeActivityIds([
    ...resolveActivityIdsFromTags(recipe.tags),
    ...resolveActivityIdsFromItemIds(
      [...recipe.inputs, ...recipe.outputs].map((port) => port.itemId),
      index,
    ),
  ]);
}

export function moduleContainsInactiveActivityContent(
  module: ModuleBalancingModule,
  index: ModuleBalancingIndex,
  activeActivityIds: readonly string[],
): boolean {
  const activeActivityIdSet = new Set(activeActivityIds);
  return resolveModuleActivityIds(module, index).some((activityId) => !activeActivityIdSet.has(activityId));
}

export function resolveCanvasActivityIds(
  canvas: ModuleBalancingCanvas,
  index: ModuleBalancingIndex,
): string[] {
  const activityIds: string[] = [
    ...resolveActivityIdsFromItemIds(canvas.globalInputs.map((port) => port.itemId), index),
  ];

  for (const stage of canvas.stages) {
    for (const entry of stage.entries) {
      const module = resolveModuleForActivityLookup(entry.moduleId, index);
      if (module !== null) {
        activityIds.push(...resolveModuleActivityIds(module, index));
      }
    }
  }

  return dedupeActivityIds(activityIds);
}

export function canvasContainsInactiveActivityContent(
  canvas: ModuleBalancingCanvas,
  index: ModuleBalancingIndex,
  activeActivityIds: readonly string[],
): boolean {
  const activeActivityIdSet = new Set(activeActivityIds);
  return resolveCanvasActivityIds(canvas, index).some((activityId) => !activeActivityIdSet.has(activityId));
}

export function resolveModuleInputs(
  module: ModuleBalancingModule,
  index: ModuleBalancingIndex,
): ModuleBalancingIOPort[] {
  if (module.sourceType === "custom") {
    return module.inputs.map(clonePort);
  }

  return resolveModulePorts(module.recipeId, index)?.inputs ?? [];
}

export function resolveItemName(
  itemId: string,
  index: ModuleBalancingIndex,
  translate: (key: string) => string,
): string {
  const item = index.itemById.get(itemId);
  return item === undefined ? itemId : translate(item.nameKey);
}

export function resolveItemIconSrc(itemId: string, index: ModuleBalancingIndex): string {
  const item = index.itemById.get(itemId);
  return createItemIconAssetUrl(item?.iconId ?? itemId);
}

export function resolveEntityIconSrc(entityId: string): string {
  return createDeviceIconAssetUrl(entityId);
}

export function resolveModuleIconSrc(
  module: ModuleBalancingModule,
  index: ModuleBalancingIndex,
): string {
  if (module.sourceType === "custom") {
    return resolveAnyIconSrc(module.iconId, index);
  }

  const recipe = index.recipeById.get(module.recipeId);
  if (recipe === undefined) {
    return createDeviceIconAssetUrl("item_port_grinder_1");
  }

  // 优先用第 1 个主要产物图标，其次用第 1 个产出图标，最后 fallback 到设备图标
  const primaryId = recipe.primaryOutputs?.[0] ?? recipe.outputs[0]?.itemId;
  if (primaryId !== undefined) {
    return resolveItemIconSrc(primaryId, index);
  }

  return resolveEntityIconSrc(recipe.machineId);
}

export function resolveAnyIconSrc(iconId: string, index: ModuleBalancingIndex): string {
  if (index.itemById.has(iconId)) {
    return resolveItemIconSrc(iconId, index);
  }

  if (index.entityById.has(iconId)) {
    return resolveEntityIconSrc(iconId);
  }

  return createItemIconAssetUrl(iconId);
}

export function formatFlow(value: number): string {
  if (Math.abs(value) < 0.005) {
    return "0";
  }

  const rounded = roundFlow(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatSignedFlow(value: number): string {
  const formatted = formatFlow(value);
  return value > 0 ? `+${formatted}` : formatted;
}

export function formatDurationMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) {
    return "-";
  }

  if (minutes < 60) {
    return `${Math.ceil(minutes)}m`;
  }

  const totalMinutes = Math.round(minutes);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const remainingMinutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${remainingMinutes}m`;
  }

  return `${hours}h ${remainingMinutes}m`;
}

export function createModuleBalancingId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveModuleForActivityLookup(
  moduleId: string,
  index: ModuleBalancingIndex,
): ModuleBalancingModule | null {
  const customModule = index.customModuleById.get(moduleId);
  if (customModule !== undefined) {
    return customModule;
  }

  if (!index.allRecipeById.has(moduleId) && !index.recipeById.has(moduleId)) {
    return null;
  }

  return {
    id: moduleId,
    recipeId: moduleId,
    sourceType: "system-recipe",
  };
}

function resolveActivityIdsFromItemIds(
  itemIds: readonly string[],
  index: ModuleBalancingIndex,
): string[] {
  return dedupeActivityIds(itemIds.flatMap((itemId) =>
    resolveActivityIdsFromTags(index.itemById.get(itemId)?.tags ?? []),
  ));
}

function dedupeActivityIds(activityIds: readonly string[]): string[] {
  const deduped: string[] = [];
  for (const activityId of activityIds) {
    if (!deduped.includes(activityId)) {
      deduped.push(activityId);
    }
  }
  return deduped;
}

function mergeBalances(
  target: Map<string, MutableItemBalance>,
  source: readonly ModuleBalancingItemBalance[],
) {
  for (const balance of source) {
    addInput(target, balance.itemId, balance.totalInput);
    addOutput(target, balance.itemId, balance.totalOutput);
  }
}

function addInput(target: Map<string, MutableItemBalance>, itemId: string, amount: number) {
  const balance = ensureBalance(target, itemId);
  balance.totalInput = roundFlow(balance.totalInput + amount);
}

function addOutput(target: Map<string, MutableItemBalance>, itemId: string, amount: number) {
  const balance = ensureBalance(target, itemId);
  balance.totalOutput = roundFlow(balance.totalOutput + amount);
}

function ensureBalance(target: Map<string, MutableItemBalance>, itemId: string): MutableItemBalance {
  const existing = target.get(itemId);
  if (existing !== undefined) {
    return existing;
  }

  const next = { itemId, totalInput: 0, totalOutput: 0 };
  target.set(itemId, next);
  return next;
}

function finalizeBalances(source: Map<string, MutableItemBalance>): ModuleBalancingItemBalance[] {
  return Array.from(source.values())
    .map((balance) => ({
      itemId: balance.itemId,
      totalInput: roundFlow(balance.totalInput),
      totalOutput: roundFlow(balance.totalOutput),
      netDelta: roundFlow(balance.totalOutput - balance.totalInput),
    }))
    .filter((balance) => balance.totalInput > 0 || balance.totalOutput > 0);
}

function sortItemBalances(
  balances: ModuleBalancingItemBalance[],
  index: ModuleBalancingIndex,
): ModuleBalancingItemBalance[] {
  return [...balances].sort((left, right) => {
    const netCompare = Math.abs(right.netDelta) - Math.abs(left.netDelta);
    if (netCompare !== 0) {
      return netCompare;
    }

    const leftName = index.itemById.get(left.itemId)?.nameKey ?? left.itemId;
    const rightName = index.itemById.get(right.itemId)?.nameKey ?? right.itemId;
    return leftName.localeCompare(rightName);
  });
}

function clonePort(port: ModuleBalancingIOPort): ModuleBalancingIOPort {
  return {
    itemId: port.itemId,
    perMinute: port.perMinute,
  };
}

function roundFlow(value: number): number {
  return Math.round(value * 100) / 100;
}

const DISPATCH_TICKET_VALUE_TAG_PREFIX = "调度券价值:";
const DISPATCH_TICKET_REGION_TAG_PREFIX = "调度券地区:";

export function resolveDispatchTicketValue(tags: readonly string[]): number {
  for (const tag of tags) {
    if (tag.startsWith(DISPATCH_TICKET_VALUE_TAG_PREFIX)) {
      const parsed = parseFloat(tag.slice(DISPATCH_TICKET_VALUE_TAG_PREFIX.length));
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return 0;
}

export function resolveDispatchTicketRegion(tags: readonly string[]): string | null {
  for (const tag of tags) {
    if (tag.startsWith(DISPATCH_TICKET_REGION_TAG_PREFIX)) {
      return tag.slice(DISPATCH_TICKET_REGION_TAG_PREFIX.length);
    }
  }
  return null;
}

export function computeDispatchTicketSummaries(
  balances: readonly ModuleBalancingItemBalance[],
  index: ModuleBalancingIndex,
): ModuleBalancingDispatchTicketSummary[] {
  const summaries: ModuleBalancingDispatchTicketSummary[] = [];

  for (const balance of balances) {
    const item = index.itemById.get(balance.itemId);
    if (item === undefined) continue;

    const value = resolveDispatchTicketValue(item.tags);
    if (value <= 0) continue;

    summaries.push({
      itemId: balance.itemId,
      value,
      region: resolveDispatchTicketRegion(item.tags),
      netDelta: balance.netDelta,
      dispatchPerMin: roundFlow(balance.netDelta * value),
    });
  }

  return summaries;
}
