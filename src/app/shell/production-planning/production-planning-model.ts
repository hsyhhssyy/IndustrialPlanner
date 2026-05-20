import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";

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

export interface ProductionPlanningSourceConfig {
  waterPolicy: ProductionPlanningByproductPolicy;
  acidPolicy: ProductionPlanningByproductPolicy;
  sewagePolicy: ProductionPlanningSewagePolicy;
}

export type ProductionPlanningDisplayMode = "item" | "device";
export type ProductionPlanningViewMode = "tree" | "flow";

export interface ProductionPlanningPort {
  id: string;
  itemId: string;
  perMinute: number;
}

export interface ProductionPlanningIndex {
  itemById: Map<string, ItemDefinition>;
  entityById: Map<string, EntityDefinition>;
  recipeById: Map<string, RecipeDefinition>;
  recipesByOutputItem: Map<string, RecipeDefinition[]>;
  allItems: ItemDefinition[];
  naturalResourceItemIds: Set<string>;
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
  outputs: ProductionPlanningPort[];
  inputItems: ProductionPlanningItemNode[];
}

export interface ProductionPlanningItemTotal {
  itemId: string;
  demandPerMinute: number;
  suppliedPerMinute: number;
  producedPerMinute: number;
  unresolvedPerMinute: number;
}

export interface ProductionPlanningRecipeTotal {
  recipeId: string;
  durationSeconds: number;
  cyclesPerMinute: number;
  deviceCount: number;
  inputs: ProductionPlanningPort[];
  outputs: ProductionPlanningPort[];
}

export interface ProductionPlanningResult {
  roots: ProductionPlanningItemNode[];
  itemTotals: ProductionPlanningItemTotal[];
  recipeTotals: ProductionPlanningRecipeTotal[];
  unresolvedPerMinute: number;
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
  nextNodeIndex: number;
}

const EPSILON = 0.0001;
const MAX_RECURSION_DEPTH = 48;

export function buildProductionPlanningIndex(registry: RegistryContract): ProductionPlanningIndex {
  const itemById = new Map(registry.itemDefinitions.map((item) => [item.id, item]));
  const entityById = new Map(registry.entityDefinitions.map((entity) => [entity.id, entity]));
  const recipeById = new Map(registry.recipeDefinitions.map((recipe) => [recipe.id, recipe]));
  const recipesByOutputItem = new Map<string, RecipeDefinition[]>();

  for (const recipe of registry.recipeDefinitions) {
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
  for (const item of registry.itemDefinitions) {
    if (isNaturalResourceItem(item)) {
      naturalResourceItemIds.add(item.id);
    }
  }

  return {
    itemById,
    entityById,
    recipeById,
    recipesByOutputItem,
    allItems: [...registry.itemDefinitions].sort((left, right) => left.nameKey.localeCompare(right.nameKey)),
    naturalResourceItemIds,
  };
}

export function computeProductionPlan(
  request: ProductionPlanningRequest,
  index: ProductionPlanningIndex,
): ProductionPlanningResult {
  const context: SolverContext = {
    index,
    manualSupplyRemaining: buildSupplyMap(request.supplies),
    surplusSupplyRemaining: new Map(),
    infiniteItemIds: request.infiniteItemIds,
    recipeChoices: request.recipeChoices,
    sourceConfig: request.sourceConfig,
    dumperAmounts: new Map(),
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
  const allRecipeNodes = [...recipeNodes, ...dumperRecipeNodes];
  const itemTotals = aggregateItemTotals(roots, allRecipeNodes, index);
  const recipeTotals = aggregateRecipeTotals(allRecipeNodes, index);

  return {
    roots,
    itemTotals,
    recipeTotals,
    unresolvedPerMinute: roundFlow(itemTotals.reduce((sum, item) => sum + item.unresolvedPerMinute, 0)),
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
  return `/item-icons/${item?.iconId ?? itemId}.webp`;
}

export function resolveProductionPlanningEntityIconSrc(entityId: string): string {
  return `/device-icons/${entityId}.webp`;
}

export function formatProductionFlow(value: number): string {
  if (Math.abs(value) < 0.005) {
    return "0";
  }

  const rounded = roundFlow(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatProductionDeviceCount(value: number): string {
  if (Math.abs(value) < 0.005) {
    return "0";
  }

  if (value < 0.1) {
    return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  }

  return formatProductionFlow(value);
}

export function isRecipeExcludedFromProductionPlanningAuto(recipe: RecipeDefinition): boolean {
  return recipe.tags.includes("liquid_bottle_dismantle")
    || (
      recipe.inputs.some((input) => input.itemId === "item_iron_enr_powder")
      && recipe.outputs.some((output) => output.itemId === "item_iron_enr")
    );
}

export function createProductionPlanningId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

  const cyclesPerMinute = roundFlow(remaining / output.amount);
  const inputPorts = recipe.inputs.map((input) => ({
    id: `${recipe.id}-in-${input.itemId}`,
    itemId: input.itemId,
    perMinute: roundFlow(input.amount * cyclesPerMinute),
  }));
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

  const inputItems = inputPorts.map((input) => resolveDemand(input.itemId, input.perMinute, context, [...stack, itemId]));
  const recipeNode: ProductionPlanningRecipeNode = {
    id: createNodeId("recipe", context),
    kind: "recipe",
    recipeId: recipe.id,
    targetItemId: itemId,
    durationSeconds: recipe.durationSeconds,
    cyclesPerMinute,
    deviceCount: roundFlow(cyclesPerMinute / (60 / recipe.durationSeconds)),
    inputs: inputPorts,
    outputs: outputPorts,
    inputItems,
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
    if (selected?.outputs.some((output) => output.itemId === itemId)) {
      return selected;
    }
  }

  return recipes.find((recipe) => !isRecipeExcludedFromProductionPlanningAuto(recipe));
}

function consumeAvailableSupply(
  itemId: string,
  demand: number,
  context: SolverContext,
): ProductionPlanningSupplyBreakdown {
  const manual = consumeSupply(context.manualSupplyRemaining, itemId, demand);
  const surplus = consumeSupply(context.surplusSupplyRemaining, itemId, roundFlow(demand - manual));

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
    if (supply.itemId.length > 0 && supply.perMinute > EPSILON) {
      addSupply(result, supply.itemId, supply.perMinute);
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
        outputs: node.outputs.map(clonePort),
      });
      continue;
    }

    total.cyclesPerMinute = roundFlow(total.cyclesPerMinute + node.cyclesPerMinute);
    total.deviceCount = roundFlow(total.deviceCount + node.deviceCount);
    total.inputs = mergePorts(total.inputs, node.inputs);
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
  };
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
      outputs: [],
      inputItems: [],
    });
  }

  return nodes;
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
