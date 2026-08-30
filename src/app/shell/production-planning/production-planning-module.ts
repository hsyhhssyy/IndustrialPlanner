import type { ModuleBalancingIOPort } from "@/app/toolbox-types";

import {
  createProductionPlanningId,
  formatProductionFlow,
  resolveProductionPlanningItemName,
  type ProductionPlanningIndex,
  type ProductionPlanningItemNode,
  type ProductionPlanningPort,
  type ProductionPlanningRecipeNode,
  type ProductionPlanningResult,
} from "./production-planning-model";

const PRODUCTION_PLANNING_MODULE_COLOR = "#4f8cff";
const PRODUCTION_PLANNING_MODULE_FALLBACK_ICON_ID = "grinder_1";
const NATURAL_RESOURCE_GATHERING_RECIPE_TAG = "自然资源采集";
const FLOW_EPSILON = 0.0001;

interface CreateProductionPlanningModuleOptions {
  readonly index: ProductionPlanningIndex;
  readonly plan: ProductionPlanningResult;
  readonly targets: readonly ProductionPlanningPort[];
  readonly translate: (key: string) => string;
}

export function createProductionPlanningModule(
  options: CreateProductionPlanningModuleOptions,
) {
  const inputs = collectExternalRecipeInputs(options.plan.roots, options.index);
  const outputs = collectModuleOutputs(options.plan);
  const targetDescription = options.targets
    .filter((target) => target.itemId.length > 0 && target.perMinute > FLOW_EPSILON)
    .map((target) => (
      `${resolveProductionPlanningItemName(target.itemId, options.index, options.translate)}`
      + ` x${formatProductionFlow(target.perMinute)}/min`
    ))
    .join(", ");

  return {
    id: createProductionPlanningId("custom-module"),
    name: options.translate("moduleBalancing.modulePlaceholder"),
    color: PRODUCTION_PLANNING_MODULE_COLOR,
    iconId: outputs[0]?.itemId
      ?? inputs[0]?.itemId
      ?? PRODUCTION_PLANNING_MODULE_FALLBACK_ICON_ID,
    notes: options.translate("productionPlanning.generatedModuleNotes")
      .replace("{targets}", targetDescription),
    folderId: null,
    inputs,
    outputs,
    sourceType: "custom" as const,
  };
}

function collectExternalRecipeInputs(
  roots: readonly ProductionPlanningItemNode[],
  index: ProductionPlanningIndex,
): ModuleBalancingIOPort[] {
  const totals = new Map<string, number>();

  const visitInput = (node: ProductionPlanningItemNode) => {
    addFlow(totals, node.itemId, node.supply.manual + node.supply.infinite);
    if (isNaturalResourceGatheringNode(node, index)) {
      addFlow(totals, node.itemId, node.producedPerMinute);
      return;
    }
    if (node.recipeNode !== null) {
      visitRecipe(node.recipeNode);
    }
  };

  const visitRecipe = (recipe: ProductionPlanningRecipeNode) => {
    recipe.inputItems.forEach(visitInput);
    recipe.deviceMinimumConsumptionItems.forEach(visitInput);
  };

  for (const root of roots) {
    if (isNaturalResourceGatheringNode(root, index)) {
      visitInput(root);
    } else if (root.recipeNode !== null) {
      visitRecipe(root.recipeNode);
    }
  }

  return toModulePorts(totals);
}

function isNaturalResourceGatheringNode(
  node: ProductionPlanningItemNode,
  index: ProductionPlanningIndex,
): boolean {
  if (!index.naturalResourceItemIds.has(node.itemId) || node.recipeNode === null) {
    return false;
  }

  const recipeId = node.recipeNode.recipeId;
  if (recipeId === null) {
    return false;
  }

  return index.recipeById.get(recipeId)
    ?.tags.includes(NATURAL_RESOURCE_GATHERING_RECIPE_TAG) === true;
}

function collectModuleOutputs(
  plan: ProductionPlanningResult,
): ModuleBalancingIOPort[] {
  const totals = new Map<string, number>();

  for (const root of plan.roots) {
    addFlow(
      totals,
      root.itemId,
      Math.max(0, root.demandPerMinute - root.unresolvedPerMinute),
    );
  }
  for (const overflow of plan.overflowItems) {
    addFlow(totals, overflow.itemId, overflow.perMinute);
  }

  return toModulePorts(totals);
}

function addFlow(totals: Map<string, number>, itemId: string, perMinute: number) {
  if (itemId.length === 0 || perMinute <= FLOW_EPSILON) {
    return;
  }
  totals.set(itemId, (totals.get(itemId) ?? 0) + perMinute);
}

function toModulePorts(totals: ReadonlyMap<string, number>): ModuleBalancingIOPort[] {
  return Array.from(totals, ([itemId, perMinute]) => ({
    itemId,
    perMinute: Math.round(perMinute * 10_000) / 10_000,
  }));
}
