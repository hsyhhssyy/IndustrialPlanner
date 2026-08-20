import { pinyin } from "pinyin-pro";

import type { RegistryContract } from "@/domain/registry/registry-contract";
import type {
  ModuleBalancingCanvas,
  ModuleBalancingCustomModule,
  ModuleBalancingIOPort,
  ModuleBalancingModule,
  ModuleBalancingRecommendedModule,
  ModuleBalancingStage,
  ModuleBalancingState,
  ModuleBalancingSystemRecipeModule,
} from "@/app/toolbox-types";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { migrateBlueprintDeviceReference } from "@/shared/blueprint-device-id-migration";
import { createEntityIconAssetUrl, createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import { lookupText } from "@/shared/i18n";
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
  recommendedModuleById: Map<string, ModuleBalancingRecommendedModule>;
  systemModules: ModuleBalancingSystemRecipeModule[];
  allItems: ItemDefinition[];
  allEntities: EntityDefinition[];
}

interface ModuleBalancingIndexOptions {
  includeInactiveActivityContent?: boolean;
  activeActivityIds?: readonly string[];
  recommendedModules?: readonly ModuleBalancingRecommendedModule[];
}

interface MutableItemBalance {
  itemId: string;
  totalInput: number;
  totalOutput: number;
}

const MODULE_PINYIN_SEARCH_CACHE = new Map<string, { full: string; initial: string }>();

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
  const recommendedModuleById = new Map(
    (options.recommendedModules ?? [])
      .filter((module) => !customModuleById.has(module.id) && !recipeById.has(module.id))
      .map((module) => [module.id, module]),
  );
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
    recommendedModuleById,
    systemModules,
    allItems: [...itemDefinitions].sort((left, right) => left.nameKey.localeCompare(right.nameKey)),
    allEntities: registry.entityDefinitions
      .filter((entity) => entity.uiGroup !== "hidden" && entity.uiGroup !== "cheat")
      .sort((left, right) => left.nameKey.localeCompare(right.nameKey)),
  };
}

export function computeModuleBalancing(
  canvas: ModuleBalancingCanvas,
  index: ModuleBalancingIndex,
): ModuleBalancingComputation {
  const cumulativeBalances = new Map<string, MutableItemBalance>();
  const summaryBalances = new Map<string, MutableItemBalance>();
  const infiniteInputItemIds = resolveInfiniteSystemInputItemIds(canvas);

  for (const input of canvas.globalInputs) {
    if (input.infinite === true) {
      continue;
    }
    addOutput(cumulativeBalances, input.itemId, input.perMinute);
    addOutput(summaryBalances, input.itemId, input.perMinute);
  }

  const stageBalances: ModuleBalancingStageBalance[] = [];
  for (const stage of canvas.stages) {
    const stageTotals = computeStageModuleTotals(stage, index, infiniteInputItemIds);
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
  excludedItemIds: ReadonlySet<string> = new Set(),
): ModuleBalancingItemBalance[] {
  const balances = new Map<string, MutableItemBalance>();
  for (const entry of stage.entries) {
    const ports = resolveModulePorts(entry.moduleId, index);
    if (ports === null) {
      continue;
    }

    for (const input of ports.inputs) {
      if (excludedItemIds.has(input.itemId)) {
        continue;
      }
      addInput(balances, input.itemId, input.perMinute * entry.quantity);
    }
    for (const output of ports.outputs) {
      if (excludedItemIds.has(output.itemId)) {
        continue;
      }
      addOutput(balances, output.itemId, output.perMinute * entry.quantity);
    }
  }

  return sortItemBalances(finalizeBalances(balances), index);
}

export function resolveInfiniteSystemInputItemIds(
  canvas: ModuleBalancingCanvas,
): ReadonlySet<string> {
  return new Set(
    canvas.globalInputs
      .filter((input) => input.infinite === true)
      .map((input) => input.itemId),
  );
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

  const recommendedModule = index.recommendedModuleById.get(moduleId);
  if (recommendedModule !== undefined) {
    return recommendedModule;
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

  const recommendedModule = index.recommendedModuleById.get(moduleId);
  if (recommendedModule !== undefined) {
    return {
      inputs: recommendedModule.inputs.map(clonePort),
      outputs: recommendedModule.outputs.map(clonePort),
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
  if (module.sourceType !== "system-recipe") {
    return module.outputs.map(clonePort);
  }

  return resolveModulePorts(module.recipeId, index)?.outputs ?? [];
}

export function resolveModuleActivityIds(
  module: ModuleBalancingModule,
  index: ModuleBalancingIndex,
): string[] {
  if (module.sourceType !== "system-recipe") {
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
  if (module.sourceType !== "system-recipe") {
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

export function resolveEntityIconSrc(entityId: string, index: ModuleBalancingIndex): string {
  return createEntityIconAssetUrl(index.entityById.get(entityId)?.iconPath);
}

export function resolveModuleDisplayTitle(
  module: ModuleBalancingModule,
  index: ModuleBalancingIndex,
  translate: (key: string) => string,
): string {
  if (module.sourceType !== "system-recipe") {
    return module.name;
  }

  const recipe = index.recipeById.get(module.recipeId);
  if (recipe === undefined) {
    return module.recipeId;
  }

  const outputNames = recipe.outputs.map((output) => resolveItemName(output.itemId, index, translate));
  const fallbackNames = outputNames.length > 0
    ? outputNames
    : recipe.inputs.map((input) => resolveItemName(input.itemId, index, translate));
  const machine = index.entityById.get(recipe.machineId);
  const machineName = machine === undefined ? recipe.machineId : translate(machine.nameKey);
  return [...fallbackNames, machineName].join(" · ");
}

export function matchesModuleSearchQuery(
  module: ModuleBalancingModule,
  query: string,
  index: ModuleBalancingIndex,
  translate: (key: string) => string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return true;
  }

  const terms = collectModuleSearchTerms(module, index, translate);
  const searchableText = terms.join(" ").toLowerCase();
  if (searchableText.includes(normalizedQuery)) {
    return true;
  }

  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  const pinyinSearch = resolveModulePinyinSearch(terms);
  return pinyinSearch.full.includes(compactQuery) || pinyinSearch.initial.includes(compactQuery);
}

export function resolveModuleIconSrc(
  module: ModuleBalancingModule,
  index: ModuleBalancingIndex,
): string {
  if (module.sourceType !== "system-recipe") {
    return resolveAnyIconSrc(module.iconId, index);
  }

  const recipe = index.recipeById.get(module.recipeId);
  if (recipe === undefined) {
    return createEntityIconAssetUrl(undefined);
  }

  // 优先用第 1 个主要产物图标，其次用第 1 个产出图标，最后 fallback 到设备图标
  // AI-CORRECTION 2026-07-27: 上述规则已不再适用于系统配方卡；本次需求统一以生产设备图标作为系统配方头图。
  // AI-REMOVED 2026-07-27:
  // Reason: 系统配方卡必须显示生产设备图标，产物图标不再代表卡片头图。
  // Trigger: 用户要求系统配方模块头部改为设备图标。
  // Evidence: recipe.machineId 可稳定解析实际生产设备，且与新标题末尾设备名称一致。
  // Replacement: 下方 resolveEntityIconSrc(recipe.machineId, index)
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const primaryId = recipe.primaryOutputs?.[0] ?? recipe.outputs[0]?.itemId;
  // if (primaryId !== undefined) {
  //   return resolveItemIconSrc(primaryId, index);
  // }
  return resolveEntityIconSrc(recipe.machineId, index);
}

export function resolveAnyIconSrc(iconId: string, index: ModuleBalancingIndex): string {
  if (index.itemById.has(iconId)) {
    return resolveItemIconSrc(iconId, index);
  }

  const migratedDeviceId = migrateBlueprintDeviceReference(iconId)?.deviceId ?? iconId;
  if (index.entityById.has(migratedDeviceId)) {
    return resolveEntityIconSrc(migratedDeviceId, index);
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

import { createUuid } from "@/domain/shared/uuid";

/** UUID v4 正则，用于判断 id 是否已迁移为 UUID。 */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 旧格式 ID 模式：prefix-时间戳36进制-6~8位随机字符，如 canvas-lrv7abc-a1b2c3。 */
const LEGACY_ID_RE = /^[a-z][a-z-]*-[0-9a-z]+-[0-9a-z]{6,8}$/i;

export function createModuleBalancingId(): string {
  return createUuid();
}

/** 检测 id 是否为旧格式（非 UUID 且匹配旧格式模式）。 */
export function isLegacyModuleBalancingId(id: string): boolean {
  return !UUID_V4_RE.test(id) && LEGACY_ID_RE.test(id);
}

/** 判断 id 是否为合法的 UUID v4。 */
export function isModuleBalancingUuid(id: string): boolean {
  return UUID_V4_RE.test(id);
}

function resolveModuleForActivityLookup(
  moduleId: string,
  index: ModuleBalancingIndex,
): ModuleBalancingModule | null {
  const customModule = index.customModuleById.get(moduleId);
  if (customModule !== undefined) {
    return customModule;
  }

  const recommendedModule = index.recommendedModuleById.get(moduleId);
  if (recommendedModule !== undefined) {
    return recommendedModule;
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

function collectModuleSearchTerms(
  module: ModuleBalancingModule,
  index: ModuleBalancingIndex,
  translate: (key: string) => string,
): string[] {
  const terms = [
    module.id,
    resolveModuleDisplayTitle(module, index, translate),
  ];

  if (module.sourceType !== "system-recipe") {
    terms.push(module.name, module.notes);
    for (const port of [...module.inputs, ...module.outputs]) {
      appendRegistryNameTerms(terms, index.itemById.get(port.itemId)?.nameKey, translate);
      terms.push(port.itemId);
    }
    return terms;
  }

  const recipe = index.recipeById.get(module.recipeId);
  if (recipe === undefined) {
    return terms;
  }

  terms.push(recipe.id, ...recipe.tags);
  appendRegistryNameTerms(terms, recipe.nameKey, translate);
  const machine = index.entityById.get(recipe.machineId);
  terms.push(recipe.machineId);
  appendRegistryNameTerms(terms, machine?.nameKey, translate);

  for (const port of [...recipe.inputs, ...recipe.outputs]) {
    terms.push(port.itemId);
    appendRegistryNameTerms(terms, index.itemById.get(port.itemId)?.nameKey, translate);
  }

  return terms;
}

function appendRegistryNameTerms(
  terms: string[],
  nameKey: string | undefined,
  translate: (key: string) => string,
): void {
  if (nameKey === undefined) {
    return;
  }

  terms.push(translate(nameKey));
  const zhName = lookupText("zh-CN", nameKey);
  if (zhName !== undefined) {
    terms.push(zhName);
  }
}

function resolveModulePinyinSearch(
  terms: readonly string[],
): { full: string; initial: string } {
  const source = terms
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 0)
    .join(" ");
  const cached = MODULE_PINYIN_SEARCH_CACHE.get(source);
  if (cached !== undefined) {
    return cached;
  }

  const result = {
    full: pinyin(source, { toneType: "none", separator: "" }).replace(/\s+/g, "").toLowerCase(),
    initial: pinyin(source, {
      pattern: "first",
      toneType: "none",
      separator: "",
    }).replace(/\s+/g, "").toLowerCase(),
  };
  MODULE_PINYIN_SEARCH_CACHE.set(source, result);
  return result;
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
    ...(port.infinite === true ? { infinite: true } : {}),
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
