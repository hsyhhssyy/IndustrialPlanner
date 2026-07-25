import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { createDeviceIconAssetUrl, createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import {
  isItemAvailableByActivity,
  isRecipeAvailableByActivity,
} from "@/shared/registry/activity-availability";
import { isRecipeVisibleInToolbox } from "@/shared/registry/recipe-visibility";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import {
  WATER_PURIFIER_BYPRODUCT_RECIPE_ID,
  WATER_PURIFIER_BYPRODUCT_SEWAGE_PER_OUTPUT,
  WATER_PURIFIER_COLLECT_RECIPE_ID,
  WATER_PURIFIER_INPUT_DERIVED_OUTPUT_PER_MINUTE,
  WATER_PURIFIER_OUTPUT_ITEM_ID,
} from "@/shared/water-purifier-node";

// AI-CORRECTION 2026-05-20: SPECIAL_INFINITE_ITEM_IDS retained for backward compat in tests;
// panel no longer uses it. New logic uses ProductionPlanningSourceConfig.
export const PRODUCTION_PLANNING_SPECIAL_INFINITE_ITEM_IDS = [
  "item_liquid_sewage",
  "item_liquid_acid",
] as const;

export const PRODUCTION_PLANNING_BYPRODUCT_ITEM_IDS = new Set([
  "item_liquid_water",
  "item_liquid_acid",
]);

export type ProductionPlanningByproductPolicy = "use-byproduct" | "dump-byproduct";
export type ProductionPlanningSewagePolicy = "external-supply" | "self-produce";
export type ProductionPlanningWaterPurifierPolicy = "disabled" | "use-when-available";

export interface ProductionPlanningSourceConfig {
  waterPolicy: ProductionPlanningByproductPolicy;
  acidPolicy: ProductionPlanningByproductPolicy;
  sewagePolicy: ProductionPlanningSewagePolicy;
  waterPurifierPolicy: ProductionPlanningWaterPurifierPolicy;
  includeDeviceMinimumConsumption: boolean;
}

export type ProductionPlanningDisplayMode = "item" | "device";
export type ProductionPlanningViewMode = "tree" | "flow" | "process";

export interface ProductionPlanningPort {
  id: string;
  itemId: string;
  perMinute: number;
  isInfinite?: boolean;
}

export interface ProductionPlanningIndex {
  itemById: Map<string, ItemDefinition>;
  entityById: Map<string, EntityDefinition>;
  recipeById: Map<string, RecipeDefinition>;
  consumptionRecipesByMachine: Map<string, RecipeDefinition[]>;
  recipesByOutputItem: Map<string, RecipeDefinition[]>;
  allItems: ItemDefinition[];
  naturalResourceItemIds: Set<string>;
}

interface ProductionPlanningIndexOptions {
  includeInactiveActivityContent?: boolean;
  activeActivityIds?: readonly string[];
}

export interface ProductionPlanningSupplyBreakdown {
  manual: number;
  surplus: number;
  infinite: number;
  cycle: number;
}

export interface ProductionPlanningItemNode {
  id: string;
  kind: "item";
  itemId: string;
  demandPerMinute: number;
  suppliedPerMinute: number;
  producedPerMinute: number;
  unresolvedPerMinute: number;
  supply: ProductionPlanningSupplyBreakdown;
  recipeNode: ProductionPlanningRecipeNode | null;
  isInfiniteSource: boolean;
  isCycleSource: boolean;
  blockedByCycle: boolean;
}

export interface ProductionPlanningRecipeNode {
  id: string;
  kind: "recipe";
  recipeId: string;
  targetItemId: string;
  durationSeconds: number;
  cyclesPerMinute: number;
  deviceCount: number;
  inputs: ProductionPlanningPort[];
  deviceMinimumConsumptionInputs: ProductionPlanningPort[];
  outputs: ProductionPlanningPort[];
  inputItems: ProductionPlanningItemNode[];
  deviceMinimumConsumptionItems: ProductionPlanningItemNode[];
}

export interface ProductionPlanningItemTotal {
  itemId: string;
  demandPerMinute: number;
  suppliedPerMinute: number;
  producedPerMinute: number;
  unresolvedPerMinute: number;
  isByproduct: boolean;
}

export interface ProductionPlanningRecipeTotal {
  recipeId: string;
  durationSeconds: number;
  cyclesPerMinute: number;
  deviceCount: number;
  inputs: ProductionPlanningPort[];
  deviceMinimumConsumptionInputs: ProductionPlanningPort[];
  outputs: ProductionPlanningPort[];
}

export interface ProductionPlanningResult {
  roots: ProductionPlanningItemNode[];
  itemTotals: ProductionPlanningItemTotal[];
  recipeTotals: ProductionPlanningRecipeTotal[];
  unresolvedPerMinute: number;
  byproductItemIds: ReadonlySet<string>;
}

interface ProductionPlanningRequest {
  targets: readonly ProductionPlanningPort[];
  supplies: readonly ProductionPlanningPort[];
  infiniteItemIds: ReadonlySet<string>;
  recipeChoices: ReadonlyMap<string, string>;
  sourceConfig: ProductionPlanningSourceConfig;
}

interface SolverContext {
  index: ProductionPlanningIndex;
  manualSupplyRemaining: Map<string, number>;
  surplusSupplyRemaining: Map<string, number>;
  infiniteItemIds: ReadonlySet<string>;
  recipeChoices: ReadonlyMap<string, string>;
  sourceConfig: ProductionPlanningSourceConfig;
  dumperAmounts: Map<string, number>;
  wasteTreatmentAmounts: Map<string, number>;
  nextNodeIndex: number;
}

const EPSILON = 0.0001;
const MAX_RECURSION_DEPTH = 48;

export function buildProductionPlanningIndex(
  registry: RegistryContract,
  options: ProductionPlanningIndexOptions = {},
): ProductionPlanningIndex {
  const includeInactiveActivityContent = options.includeInactiveActivityContent ?? true;
  const activeActivityIds = options.activeActivityIds ?? [];
  const itemDefinitions = includeInactiveActivityContent
    ? registry.itemDefinitions
    : registry.itemDefinitions.filter((item) => isItemAvailableByActivity(item, activeActivityIds));
  const itemById = new Map(itemDefinitions.map((item) => [item.id, item]));
  const entityById = new Map(registry.entityDefinitions.map((entity) => [entity.id, entity]));
  const visibleRecipes = registry.recipeDefinitions
    .filter(isRecipeVisibleInToolbox)
    .filter((recipe) =>
      includeInactiveActivityContent
      || isRecipeAvailableByActivity(recipe, activeActivityIds),
    );
  const recipeById = new Map(visibleRecipes.map((recipe) => [recipe.id, recipe]));
  const consumptionRecipesByMachine = new Map<string, RecipeDefinition[]>();
  for (const recipe of registry.recipeDefinitions) {
    if (!recipe.tags.includes(CONSUMPTION_RECIPE_TAG)) {
      continue;
    }
    const recipes = consumptionRecipesByMachine.get(recipe.machineId);
    if (recipes === undefined) {
      consumptionRecipesByMachine.set(recipe.machineId, [recipe]);
    } else {
      recipes.push(recipe);
    }
  }
  const recipesByOutputItem = new Map<string, RecipeDefinition[]>();

  for (const recipe of visibleRecipes) {
    for (const output of recipe.outputs) {
      const recipes = recipesByOutputItem.get(output.itemId);
      if (recipes === undefined) {
        recipesByOutputItem.set(output.itemId, [recipe]);
      } else {
        recipes.push(recipe);
      }
    }
  }

  const naturalResourceItemIds = new Set<string>();
  for (const item of itemDefinitions) {
    if (isNaturalResourceItem(item)) {
      naturalResourceItemIds.add(item.id);
    }
  }

  return {
    itemById,
    entityById,
    recipeById,
    consumptionRecipesByMachine,
    recipesByOutputItem,
    allItems: [...itemDefinitions].sort((left, right) => left.nameKey.localeCompare(right.nameKey)),
    naturalResourceItemIds,
  };
}

export function computeProductionPlan(
  request: ProductionPlanningRequest,
  index: ProductionPlanningIndex,
): ProductionPlanningResult {
  const baseline = computeProductionPlanPass(request, index, 0);
  if (request.sourceConfig.waterPurifierPolicy !== "use-when-available") {
    return baseline;
  }

  const replaceableOutputPerMinute = resolveReplaceableWaterPurifierOutputPerMinute(baseline);
  const surplusSewagePerMinute = resolveWasteTreatmentInputPerMinute(baseline, "item_liquid_sewage");
  let requestedOutputPerMinute = roundFlow(Math.min(
    replaceableOutputPerMinute,
    surplusSewagePerMinute / WATER_PURIFIER_BYPRODUCT_SEWAGE_PER_OUTPUT,
    WATER_PURIFIER_INPUT_DERIVED_OUTPUT_PER_MINUTE,
  ));

  if (requestedOutputPerMinute <= EPSILON) {
    return baseline;
  }

  for (let pass = 0; pass < 12; pass += 1) {
    const candidate = computeProductionPlanPass(request, index, requestedOutputPerMinute);
    const actualOutputPerMinute = resolveRecipeOutputPerMinute(
      candidate,
      WATER_PURIFIER_BYPRODUCT_RECIPE_ID,
      WATER_PURIFIER_OUTPUT_ITEM_ID,
    );
    if (actualOutputPerMinute <= EPSILON) {
      return baseline;
    }

    const additionalOutputPerMinute = Math.min(
      resolveReplaceableWaterPurifierOutputPerMinute(candidate),
      resolveWasteTreatmentInputPerMinute(candidate, "item_liquid_sewage")
        / WATER_PURIFIER_BYPRODUCT_SEWAGE_PER_OUTPUT,
      Math.max(0, WATER_PURIFIER_INPUT_DERIVED_OUTPUT_PER_MINUTE - actualOutputPerMinute),
    );
    const nextOutputPerMinute = roundFlow(actualOutputPerMinute + additionalOutputPerMinute);
    if (Math.abs(nextOutputPerMinute - requestedOutputPerMinute) <= EPSILON) {
      return candidate;
    }
    requestedOutputPerMinute = nextOutputPerMinute;
  }

  return computeProductionPlanPass(request, index, requestedOutputPerMinute);
}

function computeProductionPlanPass(
  request: ProductionPlanningRequest,
  index: ProductionPlanningIndex,
  waterPurifierOutputPerMinute: number,
): ProductionPlanningResult {
  const context: SolverContext = {
    index,
    manualSupplyRemaining: buildSupplyMap(request.supplies),
    surplusSupplyRemaining: waterPurifierOutputPerMinute > EPSILON
      ? new Map([[WATER_PURIFIER_OUTPUT_ITEM_ID, waterPurifierOutputPerMinute]])
      : new Map(),
    infiniteItemIds: buildInfiniteItemIds(request.infiniteItemIds, request.supplies, index),
    recipeChoices: request.recipeChoices,
    sourceConfig: request.sourceConfig,
    dumperAmounts: new Map(),
    wasteTreatmentAmounts: new Map(),
    nextNodeIndex: 0,
  };

  const roots = request.targets
    .filter((target) => target.itemId.length > 0 && target.perMinute > EPSILON)
    .map((target) => resolveDemand(target.itemId, target.perMinute, context, []));
  const recipeNodes = flattenProductionPlanningRecipeNodes(roots);

  // "use byproduct" 模式: 未被消费的副产物剩余量 → 送去倾倒
  for (const itemId of PRODUCTION_PLANNING_BYPRODUCT_ITEM_IDS) {
    if (isByproductItemDumpMode(itemId, context.sourceConfig)) {
      continue;
    }
    const remaining = context.surplusSupplyRemaining.get(itemId) ?? 0;
    if (remaining > EPSILON) {
      addSupply(context.dumperAmounts, itemId, remaining);
    }
  }

  const dumperRecipeNodes = buildDumperRecipeNodes(context);
  const waterPurifierRecipeNodes = buildWaterPurifierRecipeNodes(context, waterPurifierOutputPerMinute);
  const wasteTreatmentRecipeNodes = buildWasteTreatmentRecipeNodes(context);
  const allRecipeNodes = [
    ...recipeNodes,
    ...dumperRecipeNodes,
    ...waterPurifierRecipeNodes,
    ...wasteTreatmentRecipeNodes,
  ];

  const itemTotals = aggregateItemTotals(roots, allRecipeNodes, index);
  const recipeTotals = aggregateRecipeTotals(allRecipeNodes, index);

  // AI-REMOVED 2026-05-22:
  // Reason: 副产物身份不能用 demandPerMinute <= 0 判断；同一物品部分被生产性使用、部分剩余处置时也应保留副产物身份。
  // Trigger: 用户指出树表副产物标记和“部分使用/部分剩余”逻辑错误，并补充给水器/废水处理机是处置性使用。
  // Evidence: 赫铜装备原件链路中壤晶废液被生产性使用，而同配方另一个输出惰性壤晶废液剩余；旧判定还会漏掉有需求但仍有剩余的物品。
  // Replacement: collectProductionPlanningByproductItemIds
  // Risk: Low；只改变 byproductItemIds 与 itemTotals.isByproduct，求解数量不变。
  // Human Review: Required
  //
  // Original code:
  // // 副产物：求解结束后仍有剩余 surplus 且无下游需求（demandPerMinute <= 0）的物品
  // const byproductItemIds: Set<string> = new Set();
  // for (const [itemId] of context.surplusSupplyRemaining) {
  //   const total = itemTotals.find((t) => t.itemId === itemId);
  //   if (total !== undefined && total.demandPerMinute <= EPSILON) {
  //     byproductItemIds.add(itemId);
  //   }
  // }
  const byproductItemIds = collectProductionPlanningByproductItemIds(context);
  for (const total of itemTotals) {
    total.isByproduct = byproductItemIds.has(total.itemId);
  }

  return {
    roots,
    itemTotals,
    recipeTotals,
    unresolvedPerMinute: roundFlow(itemTotals.reduce((sum, item) => sum + item.unresolvedPerMinute, 0)),
    byproductItemIds,
  };
}

export function flattenProductionPlanningItemNodes(
  nodes: readonly ProductionPlanningItemNode[],
): ProductionPlanningItemNode[] {
  const result: ProductionPlanningItemNode[] = [];

  for (const node of nodes) {
    result.push(node);
    if (node.recipeNode !== null) {
      result.push(...flattenProductionPlanningItemNodes(node.recipeNode.inputItems));
      result.push(...flattenProductionPlanningItemNodes(node.recipeNode.deviceMinimumConsumptionItems));
    }
  }

  return result;
}

export function flattenProductionPlanningRecipeNodes(
  nodes: readonly ProductionPlanningItemNode[],
): ProductionPlanningRecipeNode[] {
  const result: ProductionPlanningRecipeNode[] = [];

  for (const node of nodes) {
    if (node.recipeNode === null) {
      continue;
    }

    result.push(node.recipeNode);
    result.push(...flattenProductionPlanningRecipeNodes(node.recipeNode.inputItems));
    result.push(...flattenProductionPlanningRecipeNodes(node.recipeNode.deviceMinimumConsumptionItems));
  }

  return result;
}

export function resolveProductionPlanningItemName(
  itemId: string,
  index: ProductionPlanningIndex,
  translate: (key: string) => string,
): string {
  const item = index.itemById.get(itemId);
  return item === undefined ? itemId : translate(item.nameKey);
}

export function resolveProductionPlanningRecipeName(
  recipe: RecipeDefinition,
  index: ProductionPlanningIndex,
  translate: (key: string) => string,
): string {
  const outputNames = recipe.outputs.map((output) => resolveProductionPlanningItemName(output.itemId, index, translate));
  const machine = index.entityById.get(recipe.machineId);
  const machineName = machine === undefined ? recipe.machineId : translate(machine.nameKey);
  return outputNames.length === 0 ? machineName : `${machineName} · ${outputNames.join(" + ")}`;
}

export function resolveProductionPlanningItemIconSrc(itemId: string, index: ProductionPlanningIndex): string {
  const item = index.itemById.get(itemId);
  return createItemIconAssetUrl(item?.iconId ?? itemId);
}

export function resolveProductionPlanningEntityIconSrc(
  entityId: string,
  index: ProductionPlanningIndex,
): string {
  return createDeviceIconAssetUrl(index.entityById.get(entityId)?.spriteId ?? entityId);
}

export function formatProductionFlow(value: number): string {
  if (Math.abs(value) < 0.005) {
    return value > 0 ? "<0.01" : "0";
  }

  const rounded = roundFlow(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatProductionDeviceCount(value: number): string {
  if (Math.abs(value) < 0.005) {
    return value > 0 ? "<0.01" : "0";
  }

  if (value < 0.1) {
    return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  }

  return formatProductionFlow(value);
}

export function isRecipeExcludedFromProductionPlanningAuto(recipe: RecipeDefinition): boolean {
  return !isRecipeVisibleInToolbox(recipe)
    || isWaterPurifierNodeRecipe(recipe)
    || recipe.tags.includes("liquid_bottle_dismantle")
    || (
      recipe.inputs.some((input) => input.itemId === "item_iron_enr_powder")
      && recipe.outputs.some((output) => output.itemId === "item_iron_enr")
    );
}

export function isWaterPurifierNodeRecipe(recipe: RecipeDefinition): boolean {
  return recipe.id === WATER_PURIFIER_COLLECT_RECIPE_ID
    || recipe.id === WATER_PURIFIER_BYPRODUCT_RECIPE_ID;
}

export function createProductionPlanningId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 计算物品的默认吞吐率：单个设备满速运行一分钟的产出。
 * 若无可用配方则回退到 60。
 */
export function computeItemDefaultPerMinute(
  itemId: string,
  index: ProductionPlanningIndex,
): number {
  const recipes = index.recipesByOutputItem.get(itemId);
  if (!recipes || recipes.length === 0) return 60;

  const candidate = recipes.find((r) => !isRecipeExcludedFromProductionPlanningAuto(r))
    ?? recipes[0];
  if (!candidate) return 60;

  const output = candidate.outputs.find((o) => o.itemId === itemId);
  if (!output || candidate.durationSeconds <= 0) return 60;

  return (output.amount / candidate.durationSeconds) * 60;
}

function resolveDemand(
  itemId: string,
  demandPerMinute: number,
  context: SolverContext,
  stack: readonly string[],
): ProductionPlanningItemNode {
  const demand = roundFlow(Math.max(0, demandPerMinute));
  const supply = consumeAvailableSupply(itemId, demand, context);
  const suppliedByStoredItems = roundFlow(supply.manual + supply.surplus);
  let remaining = roundFlow(demand - suppliedByStoredItems);

  if (remaining > EPSILON && context.infiniteItemIds.has(itemId)) {
    supply.infinite = remaining;
    remaining = 0;
  }

  const supplyAfterInfinite = roundFlow(supply.manual + supply.surplus + supply.infinite);
  if (remaining <= EPSILON) {
    return createItemNode({
      itemId,
      demandPerMinute: demand,
      suppliedPerMinute: supplyAfterInfinite,
      producedPerMinute: 0,
      unresolvedPerMinute: 0,
      supply,
      recipeNode: null,
      isInfiniteSource: supply.infinite > EPSILON,
      isCycleSource: false,
      blockedByCycle: false,
    }, context);
  }

  if (stack.includes(itemId)) {
    if (isAllowedProductivePlantCycle(itemId, stack)) {
      supply.cycle = remaining;
      return createItemNode({
        itemId,
        demandPerMinute: demand,
        suppliedPerMinute: roundFlow(supplyAfterInfinite + supply.cycle),
        producedPerMinute: 0,
        unresolvedPerMinute: 0,
        supply,
        recipeNode: null,
        isInfiniteSource: false,
        isCycleSource: true,
        blockedByCycle: false,
      }, context);
    }

    return createItemNode({
      itemId,
      demandPerMinute: demand,
      suppliedPerMinute: supplyAfterInfinite,
      producedPerMinute: 0,
      unresolvedPerMinute: remaining,
      supply,
      recipeNode: null,
      isInfiniteSource: false,
      isCycleSource: false,
      blockedByCycle: true,
    }, context);
  }

  if (stack.length >= MAX_RECURSION_DEPTH) {
    return createItemNode({
      itemId,
      demandPerMinute: demand,
      suppliedPerMinute: supplyAfterInfinite,
      producedPerMinute: 0,
      unresolvedPerMinute: remaining,
      supply,
      recipeNode: null,
      isInfiniteSource: false,
      isCycleSource: false,
      blockedByCycle: true,
    }, context);
  }

  const recipe = resolveRecipeForItem(itemId, context);
  const output = recipe?.outputs.find((candidate) => candidate.itemId === itemId);

  if (recipe === undefined || output === undefined || output.amount <= EPSILON || recipe.durationSeconds <= 0) {
    return createItemNode({
      itemId,
      demandPerMinute: demand,
      suppliedPerMinute: supplyAfterInfinite,
      producedPerMinute: 0,
      unresolvedPerMinute: remaining,
      supply,
      recipeNode: null,
      isInfiniteSource: false,
      isCycleSource: false,
      blockedByCycle: false,
    }, context);
  }

  const deviceConsumptionAmounts = resolveDeviceMinimumConsumptionAmountsPerCycle(recipe, context);
  const targetDeviceConsumptionAmount = deviceConsumptionAmounts.get(itemId) ?? 0;
  const netOutputAmount = roundFlow(output.amount - targetDeviceConsumptionAmount);

  if (netOutputAmount <= EPSILON) {
    return createItemNode({
      itemId,
      demandPerMinute: demand,
      suppliedPerMinute: supplyAfterInfinite,
      producedPerMinute: 0,
      unresolvedPerMinute: remaining,
      supply,
      recipeNode: null,
      isInfiniteSource: false,
      isCycleSource: false,
      blockedByCycle: false,
    }, context);
  }

  const cyclesPerMinute = roundFlow(remaining / netOutputAmount);
  const recipeInputPorts = recipe.inputs.map((input) => ({
    id: `${recipe.id}-in-${input.itemId}`,
    itemId: input.itemId,
    perMinute: roundFlow(input.amount * cyclesPerMinute),
  }));
  const deviceConsumptionPorts = Array.from(deviceConsumptionAmounts, ([consumedItemId, amount]) => ({
    id: `${recipe.id}-device-consumption-${consumedItemId}`,
    itemId: consumedItemId,
    perMinute: roundFlow(amount * cyclesPerMinute),
  }));
  const inputPorts = mergePorts(recipeInputPorts, deviceConsumptionPorts);
  const outputPorts = recipe.outputs.map((recipeOutput) => ({
    id: `${recipe.id}-out-${recipeOutput.itemId}`,
    itemId: recipeOutput.itemId,
    perMinute: roundFlow(recipeOutput.amount * cyclesPerMinute),
  }));

  for (const outputPort of outputPorts) {
    if (outputPort.itemId !== itemId && outputPort.perMinute > EPSILON) {
      if (isByproductItemDumpMode(outputPort.itemId, context.sourceConfig)) {
        addSupply(context.dumperAmounts, outputPort.itemId, outputPort.perMinute);
      } else {
        addSupply(context.surplusSupplyRemaining, outputPort.itemId, outputPort.perMinute);
      }
    }
  }

  const inputItems = recipeInputPorts.map((input) => (
    resolveDemand(input.itemId, input.perMinute, context, [...stack, itemId])
  ));
  const deviceMinimumConsumptionItems = deviceConsumptionPorts.map((input) => (
    input.itemId === itemId
      ? createProductionPlanningCycleSupplyItemNode(input.itemId, input.perMinute, context)
      : resolveDemand(input.itemId, input.perMinute, context, [...stack, itemId])
  ));
  const recipeNode: ProductionPlanningRecipeNode = {
    id: createNodeId("recipe", context),
    kind: "recipe",
    recipeId: recipe.id,
    targetItemId: itemId,
    durationSeconds: recipe.durationSeconds,
    cyclesPerMinute,
    deviceCount: roundFlow(cyclesPerMinute / (60 / recipe.durationSeconds)),
    inputs: inputPorts,
    deviceMinimumConsumptionInputs: deviceConsumptionPorts,
    outputs: outputPorts,
    inputItems,
    deviceMinimumConsumptionItems,
  };

  return createItemNode({
    itemId,
    demandPerMinute: demand,
    suppliedPerMinute: supplyAfterInfinite,
    producedPerMinute: remaining,
    unresolvedPerMinute: 0,
    supply,
    recipeNode,
    isInfiniteSource: false,
    isCycleSource: false,
    blockedByCycle: false,
  }, context);
}

function resolveDeviceMinimumConsumptionAmountsPerCycle(
  recipe: RecipeDefinition,
  context: SolverContext,
): ReadonlyMap<string, number> {
  if (!context.sourceConfig.includeDeviceMinimumConsumption) {
    return new Map();
  }

  const consumptionRecipes = context.index.consumptionRecipesByMachine.get(recipe.machineId) ?? [];
  if (consumptionRecipes.length === 0) {
    return new Map();
  }

  const consumptionRecipe = consumptionRecipes.find((candidate) =>
    candidate.inputs.some((consumptionInput) =>
      recipe.inputs.some((input) => input.itemId === consumptionInput.itemId),
    ),
  ) ?? consumptionRecipes[0];
  const consumptionInput = consumptionRecipe?.inputs[0];
  if (
    consumptionRecipe === undefined
    || consumptionInput === undefined
    || consumptionRecipe.durationSeconds <= EPSILON
  ) {
    return new Map();
  }

  return new Map([[
    consumptionInput.itemId,
    roundFlow(
      consumptionInput.amount * recipe.durationSeconds / consumptionRecipe.durationSeconds,
    ),
  ]]);
}

function createProductionPlanningCycleSupplyItemNode(
  itemId: string,
  perMinute: number,
  context: SolverContext,
): ProductionPlanningItemNode {
  return createItemNode({
    itemId,
    demandPerMinute: perMinute,
    suppliedPerMinute: perMinute,
    producedPerMinute: 0,
    unresolvedPerMinute: 0,
    supply: {
      manual: 0,
      surplus: 0,
      infinite: 0,
      cycle: perMinute,
    },
    recipeNode: null,
    isInfiniteSource: false,
    isCycleSource: true,
    blockedByCycle: false,
  }, context);
}

function createItemNode(
  node: Omit<ProductionPlanningItemNode, "id" | "kind">,
  context: SolverContext,
): ProductionPlanningItemNode {
  return {
    id: createNodeId("item", context),
    kind: "item",
    ...node,
    suppliedPerMinute: roundFlow(node.suppliedPerMinute),
    producedPerMinute: roundFlow(node.producedPerMinute),
    unresolvedPerMinute: roundFlow(node.unresolvedPerMinute),
  };
}

function resolveRecipeForItem(itemId: string, context: SolverContext): RecipeDefinition | undefined {
  const selectedRecipeId = context.recipeChoices.get(itemId);
  const recipes = context.index.recipesByOutputItem.get(itemId) ?? [];

  if (selectedRecipeId !== undefined) {
    const selected = context.index.recipeById.get(selectedRecipeId);
    if (
      selected !== undefined
      && !isWaterPurifierNodeRecipe(selected)
      && selected.outputs.some((output) => output.itemId === itemId)
    ) {
      return selected;
    }
  }

  const candidates = recipes.filter((recipe) => !isRecipeExcludedFromProductionPlanningAuto(recipe));

  // AI-CORRECTION 2026-05-22:
  // 自然资源（矿石、清水、沉积酸）在 auto 模式下优先选择 null 配方（inputs 为空），
  // 避免命中净化器等其他生产同一物品的非 null 配方。
  if (context.index.naturalResourceItemIds.has(itemId)) {
    const nullRecipe = candidates.find((recipe) => recipe.inputs.length === 0);
    if (nullRecipe !== undefined) {
      return nullRecipe;
    }
  }

  return candidates[0];
}

function consumeAvailableSupply(
  itemId: string,
  demand: number,
  context: SolverContext,
): ProductionPlanningSupplyBreakdown {
  const surplus = consumeSupply(context.surplusSupplyRemaining, itemId, demand);
  const manual = consumeSupply(context.manualSupplyRemaining, itemId, roundFlow(demand - surplus));

  return {
    manual,
    surplus,
    infinite: 0,
    cycle: 0,
  };
}

function consumeSupply(source: Map<string, number>, itemId: string, demand: number): number {
  if (demand <= EPSILON) {
    return 0;
  }

  const available = source.get(itemId) ?? 0;
  const used = Math.min(available, demand);
  if (used <= EPSILON) {
    return 0;
  }

  const remaining = roundFlow(available - used);
  if (remaining <= EPSILON) {
    source.delete(itemId);
  } else {
    source.set(itemId, remaining);
  }

  return roundFlow(used);
}

function buildSupplyMap(supplies: readonly ProductionPlanningPort[]): Map<string, number> {
  const result = new Map<string, number>();

  for (const supply of supplies) {
    if (supply.itemId.length > 0 && supply.perMinute > EPSILON && supply.isInfinite !== true) {
      addSupply(result, supply.itemId, supply.perMinute);
    }
  }

  return result;
}

function buildInfiniteItemIds(
  baseItemIds: ReadonlySet<string>,
  supplies: readonly ProductionPlanningPort[],
  index: ProductionPlanningIndex,
): ReadonlySet<string> {
  const result = new Set(baseItemIds);

  for (const supply of supplies) {
    if (supply.itemId.length > 0 && supply.isInfinite === true && !index.naturalResourceItemIds.has(supply.itemId)) {
      result.add(supply.itemId);
    }
  }

  return result;
}

function addSupply(source: Map<string, number>, itemId: string, amount: number) {
  source.set(itemId, roundFlow((source.get(itemId) ?? 0) + amount));
}

function aggregateItemTotals(
  roots: readonly ProductionPlanningItemNode[],
  recipeNodes: readonly ProductionPlanningRecipeNode[],
  index: ProductionPlanningIndex,
): ProductionPlanningItemTotal[] {
  const totals = new Map<string, ProductionPlanningItemTotal>();
  for (const node of flattenProductionPlanningItemNodes(roots)) {
    const total = ensureItemTotal(totals, node.itemId);
    total.demandPerMinute = roundFlow(total.demandPerMinute + node.demandPerMinute);
    total.suppliedPerMinute = roundFlow(total.suppliedPerMinute + node.suppliedPerMinute);
    total.unresolvedPerMinute = roundFlow(total.unresolvedPerMinute + node.unresolvedPerMinute);
  }

  for (const recipe of recipeNodes) {
    for (const output of recipe.outputs) {
      const total = ensureItemTotal(totals, output.itemId);
      total.producedPerMinute = roundFlow(total.producedPerMinute + output.perMinute);
    }
  }

  return sortItemTotals(Array.from(totals.values()), index);
}

function aggregateRecipeTotals(
  recipeNodes: readonly ProductionPlanningRecipeNode[],
  index: ProductionPlanningIndex,
): ProductionPlanningRecipeTotal[] {
  const totals = new Map<string, ProductionPlanningRecipeTotal>();

  for (const node of recipeNodes) {
    const total = totals.get(node.recipeId);
    if (total === undefined) {
      totals.set(node.recipeId, {
        recipeId: node.recipeId,
        durationSeconds: node.durationSeconds,
        cyclesPerMinute: node.cyclesPerMinute,
        deviceCount: node.deviceCount,
        inputs: node.inputs.map(clonePort),
        deviceMinimumConsumptionInputs: node.deviceMinimumConsumptionInputs.map(clonePort),
        outputs: node.outputs.map(clonePort),
      });
      continue;
    }

    total.cyclesPerMinute = roundFlow(total.cyclesPerMinute + node.cyclesPerMinute);
    total.deviceCount = roundFlow(total.deviceCount + node.deviceCount);
    total.inputs = mergePorts(total.inputs, node.inputs);
    total.deviceMinimumConsumptionInputs = mergePorts(
      total.deviceMinimumConsumptionInputs,
      node.deviceMinimumConsumptionInputs,
    );
    total.outputs = mergePorts(total.outputs, node.outputs);
  }

  return Array.from(totals.values()).sort((left, right) => {
    const leftRecipe = index.recipeById.get(left.recipeId);
    const rightRecipe = index.recipeById.get(right.recipeId);
    const leftMachine = leftRecipe?.machineId ?? left.recipeId;
    const rightMachine = rightRecipe?.machineId ?? right.recipeId;
    return leftMachine.localeCompare(rightMachine) || left.recipeId.localeCompare(right.recipeId);
  });
}

function ensureItemTotal(
  totals: Map<string, ProductionPlanningItemTotal>,
  itemId: string,
): ProductionPlanningItemTotal {
  const existing = totals.get(itemId);
  if (existing !== undefined) {
    return existing;
  }

  const total = {
    itemId,
    demandPerMinute: 0,
    suppliedPerMinute: 0,
    producedPerMinute: 0,
    unresolvedPerMinute: 0,
    isByproduct: false,
  };
  totals.set(itemId, total);
  return total;
}

function mergePorts(
  left: readonly ProductionPlanningPort[],
  right: readonly ProductionPlanningPort[],
): ProductionPlanningPort[] {
  const totals = new Map<string, number>();

  for (const port of [...left, ...right]) {
    totals.set(port.itemId, roundFlow((totals.get(port.itemId) ?? 0) + port.perMinute));
  }

  return Array.from(totals.entries()).map(([itemId, perMinute]) => ({
    id: itemId,
    itemId,
    perMinute,
  }));
}

function sortItemTotals(
  totals: ProductionPlanningItemTotal[],
  index: ProductionPlanningIndex,
): ProductionPlanningItemTotal[] {
  return totals.sort((left, right) => {
    const missingCompare = right.unresolvedPerMinute - left.unresolvedPerMinute;
    if (Math.abs(missingCompare) > EPSILON) {
      return missingCompare;
    }

    const demandCompare = right.demandPerMinute - left.demandPerMinute;
    if (Math.abs(demandCompare) > EPSILON) {
      return demandCompare;
    }

    const leftName = index.itemById.get(left.itemId)?.nameKey ?? left.itemId;
    const rightName = index.itemById.get(right.itemId)?.nameKey ?? right.itemId;
    return leftName.localeCompare(rightName);
  });
}

function clonePort(port: ProductionPlanningPort): ProductionPlanningPort {
  return {
    id: port.id,
    itemId: port.itemId,
    perMinute: port.perMinute,
    ...(port.isInfinite === true ? { isInfinite: true } : {}),
  };
}

function collectProductionPlanningByproductItemIds(context: SolverContext): Set<string> {
  const result = new Set<string>();

  for (const [itemId, perMinute] of context.surplusSupplyRemaining) {
    if (perMinute > EPSILON) {
      result.add(itemId);
    }
  }

  for (const [itemId, perMinute] of context.dumperAmounts) {
    if (perMinute > EPSILON) {
      result.add(itemId);
    }
  }

  return result;
}

function isNaturalResourceItem(item: ItemDefinition): boolean {
  return item.tags.includes("自然资源");
}

function isByproductItemDumpMode(
  itemId: string,
  config: ProductionPlanningSourceConfig,
): boolean {
  if (itemId === "item_liquid_water") {
    return config.waterPolicy === "dump-byproduct";
  }
  if (itemId === "item_liquid_acid") {
    return config.acidPolicy === "dump-byproduct";
  }
  return false;
}

const DUMPER_RECIPE_MAP: Record<string, { recipeId: string; durationSeconds: number; inputAmount: number }> = {
  "item_liquid_water": { recipeId: "r_dumper_void_liquid_water_basic", durationSeconds: 0.5, inputAmount: 1 },
  "item_liquid_acid": { recipeId: "r_dumper_void_liquid_acid_basic", durationSeconds: 0.5, inputAmount: 1 },
};

const WASTE_TREATMENT_RECIPE_MAP: Record<string, { recipeId: string; durationSeconds: number; inputAmount: number }> = {
  "item_liquid_sewage": { recipeId: "r_chrono_wastewater_treatment_void_wastewater_basic", durationSeconds: 2, inputAmount: 1 },
  "item_liquid_xiranite_poly": { recipeId: "r_chrono_wastewater_treatment_void_xiranite_waste_liquid_basic", durationSeconds: 2, inputAmount: 1 },
  "item_liquid_xiranite_lowpoly": { recipeId: "r_chrono_wastewater_treatment_void_inert_xiranite_waste_liquid_basic", durationSeconds: 2, inputAmount: 1 },
};

function buildDumperRecipeNodes(context: SolverContext): ProductionPlanningRecipeNode[] {
  const nodes: ProductionPlanningRecipeNode[] = [];

  for (const [itemId, perMinute] of context.dumperAmounts) {
    if (perMinute <= EPSILON) {
      continue;
    }

    const dumperDef = DUMPER_RECIPE_MAP[itemId];
    if (dumperDef === undefined) {
      continue;
    }

    const recipe = context.index.recipeById.get(dumperDef.recipeId);
    if (recipe === undefined) {
      continue;
    }

    const cyclesPerMinute = roundFlow(perMinute / dumperDef.inputAmount);
    const deviceCount = roundFlow(cyclesPerMinute / (60 / dumperDef.durationSeconds));

    nodes.push({
      id: createNodeId("recipe", context),
      kind: "recipe",
      recipeId: dumperDef.recipeId,
      targetItemId: itemId,
      durationSeconds: dumperDef.durationSeconds,
      cyclesPerMinute,
      deviceCount,
      inputs: [{ id: `${dumperDef.recipeId}-in-${itemId}`, itemId, perMinute }],
      deviceMinimumConsumptionInputs: [],
      outputs: [],
      inputItems: [],
      deviceMinimumConsumptionItems: [],
    });
  }

  return nodes;
}

function buildWasteTreatmentRecipeNodes(context: SolverContext): ProductionPlanningRecipeNode[] {
  const nodes: ProductionPlanningRecipeNode[] = [];

  for (const [itemId, perMinute] of context.surplusSupplyRemaining) {
    if (perMinute <= EPSILON) {
      continue;
    }

    const treatmentDef = WASTE_TREATMENT_RECIPE_MAP[itemId];
    if (treatmentDef === undefined) {
      continue;
    }

    const recipe = context.index.recipeById.get(treatmentDef.recipeId);
    if (recipe === undefined) {
      continue;
    }

    const cyclesPerMinute = roundFlow(perMinute / treatmentDef.inputAmount);
    const deviceCount = roundFlow(cyclesPerMinute / (60 / treatmentDef.durationSeconds));

    nodes.push({
      id: createNodeId("waste-treatment", context),
      kind: "recipe",
      recipeId: treatmentDef.recipeId,
      targetItemId: itemId,
      durationSeconds: treatmentDef.durationSeconds,
      cyclesPerMinute,
      deviceCount,
      inputs: [{ id: `${treatmentDef.recipeId}-in-${itemId}`, itemId, perMinute }],
      deviceMinimumConsumptionInputs: [],
      outputs: [],
      inputItems: [],
      deviceMinimumConsumptionItems: [],
    });
  }

  return nodes;
}

function buildWaterPurifierRecipeNodes(
  context: SolverContext,
  requestedOutputPerMinute: number,
): ProductionPlanningRecipeNode[] {
  if (requestedOutputPerMinute <= EPSILON) {
    return [];
  }

  const recipe = context.index.recipeById.get(WATER_PURIFIER_BYPRODUCT_RECIPE_ID);
  if (recipe === undefined) {
    return [];
  }

  const requestedSewagePerMinute = roundFlow(
    requestedOutputPerMinute * WATER_PURIFIER_BYPRODUCT_SEWAGE_PER_OUTPUT,
  );
  // 壤晶废液按四位精度求解后再乘 30 会留下低于一个输出精度单位的伪污水；
  // 仅在未触及 360/min 上限时闭合这部分量化余量，真实的超限污水仍进入废水处理。
  const availableSewagePerMinute = context.surplusSupplyRemaining.get("item_liquid_sewage") ?? 0;
  const remainingSewagePerMinute = roundFlow(availableSewagePerMinute - requestedSewagePerMinute);
  const maximumSewagePerMinute = WATER_PURIFIER_INPUT_DERIVED_OUTPUT_PER_MINUTE
    * WATER_PURIFIER_BYPRODUCT_SEWAGE_PER_OUTPUT;
  const sewageQuantizationTolerance = WATER_PURIFIER_BYPRODUCT_SEWAGE_PER_OUTPUT * EPSILON;
  const sewageDemandPerMinute = availableSewagePerMinute <= maximumSewagePerMinute
    && remainingSewagePerMinute > EPSILON
    && remainingSewagePerMinute < sewageQuantizationTolerance
    ? availableSewagePerMinute
    : requestedSewagePerMinute;
  const sewagePerMinute = consumeSupply(
    context.surplusSupplyRemaining,
    "item_liquid_sewage",
    sewageDemandPerMinute,
  );
  const outputPerMinute = roundFlow(sewagePerMinute / WATER_PURIFIER_BYPRODUCT_SEWAGE_PER_OUTPUT);
  if (outputPerMinute <= EPSILON) {
    return [];
  }

  const recipeOutputAmount = recipe.outputs.find(
    (output) => output.itemId === WATER_PURIFIER_OUTPUT_ITEM_ID,
  )?.amount ?? 1;
  const cyclesPerMinute = roundFlow(outputPerMinute / recipeOutputAmount);

  return [{
    id: createNodeId("water-purifier", context),
    kind: "recipe",
    recipeId: recipe.id,
    targetItemId: WATER_PURIFIER_OUTPUT_ITEM_ID,
    durationSeconds: recipe.durationSeconds,
    cyclesPerMinute,
    deviceCount: roundFlow(outputPerMinute / WATER_PURIFIER_INPUT_DERIVED_OUTPUT_PER_MINUTE),
    inputs: [{
      id: `${recipe.id}-in-item_liquid_sewage`,
      itemId: "item_liquid_sewage",
      perMinute: sewagePerMinute,
    }],
    deviceMinimumConsumptionInputs: [],
    outputs: [{
      id: `${recipe.id}-out-${WATER_PURIFIER_OUTPUT_ITEM_ID}`,
      itemId: WATER_PURIFIER_OUTPUT_ITEM_ID,
      perMinute: outputPerMinute,
    }],
    inputItems: [],
    deviceMinimumConsumptionItems: [],
  }];
}

function resolveReplaceableWaterPurifierOutputPerMinute(
  result: ProductionPlanningResult,
): number {
  return roundFlow(flattenProductionPlanningItemNodes(result.roots)
    .filter((node) => node.itemId === WATER_PURIFIER_OUTPUT_ITEM_ID)
    .reduce((sum, node) => sum + node.producedPerMinute + node.unresolvedPerMinute, 0));
}

function resolveWasteTreatmentInputPerMinute(
  result: ProductionPlanningResult,
  itemId: string,
): number {
  const treatmentRecipeId = WASTE_TREATMENT_RECIPE_MAP[itemId]?.recipeId;
  if (treatmentRecipeId === undefined) {
    return 0;
  }

  const treatment = result.recipeTotals.find((total) => total.recipeId === treatmentRecipeId);
  return treatment?.inputs.find((input) => input.itemId === itemId)?.perMinute ?? 0;
}

function resolveRecipeOutputPerMinute(
  result: ProductionPlanningResult,
  recipeId: string,
  itemId: string,
): number {
  const recipe = result.recipeTotals.find((total) => total.recipeId === recipeId);
  return recipe?.outputs.find((output) => output.itemId === itemId)?.perMinute ?? 0;
}

function isAllowedProductivePlantCycle(itemId: string, stack: readonly string[]): boolean {
  if (!isPlantItem(itemId)) {
    return false;
  }

  const repeatIndex = stack.lastIndexOf(itemId);
  if (repeatIndex < 0) {
    return false;
  }

  const cycleItems = stack.slice(repeatIndex);
  return cycleItems.length > 0
    && cycleItems.every(isPlantItem)
    && cycleItems.some(isPlantSeedItem)
    && cycleItems.some((candidate) => isPlantItem(candidate) && !isPlantSeedItem(candidate));
}

function isPlantItem(itemId: string): boolean {
  return itemId.startsWith("item_plant_");
}

function isPlantSeedItem(itemId: string): boolean {
  return itemId.includes("_seed");
}

function createNodeId(prefix: string, context: SolverContext): string {
  context.nextNodeIndex += 1;
  return `${prefix}-${context.nextNodeIndex}`;
}

function roundFlow(value: number): number {
  if (Math.abs(value) < EPSILON) {
    return 0;
  }

  return Math.round(value * 10000) / 10000;
}
