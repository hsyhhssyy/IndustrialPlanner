import type { ProductionPlanningItemNode, ProductionPlanningIndex, ProductionPlanningResult } from "../production-planning-model";
import {
  isRecipeExcludedFromProductionPlanningAuto,
  resolveProductionPlanningItemIconSrc,
  resolveProductionPlanningItemName,
} from "../production-planning-model";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import type { ProcessGraph, ProcessLink, ProcessNode, ProcessBuildIndex } from "./process-graph-model";

interface MutableProcessNode {
  itemId: string;
  col: number;
  row: number;
  type: ProcessNode["type"];
  iconSrc: string;
  name: string;
  recipeId?: string;
  amount?: number;
  expandedRecipeId: string | null;
}

interface MutableProcessLink {
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
  boundaryCol: number;
}

interface BuildState {
  readonly plan: ProductionPlanningResult;
  readonly index: ProductionPlanningIndex;
  readonly recipeChoices: ReadonlyMap<string, string>;
  readonly expandedItemIds: ReadonlySet<string>;
  readonly recipeById: ReadonlyMap<string, RecipeDefinition>;
  readonly naturalResourceItemIds: ReadonlySet<string>;
  readonly translate: (key: string) => string;
  readonly itemNodes: ReadonlyMap<string, ProductionPlanningItemNode>;
  nodes: MutableProcessNode[];
  links: MutableProcessLink[];
  /** Track recipe IDs to detect cycles */
  recipeStack: Set<string>;
}

export function buildProcessGraph(
  plan: ProductionPlanningResult,
  index: ProductionPlanningIndex,
  recipeChoices: ReadonlyMap<string, string>,
  expandedItemIds: ReadonlySet<string>,
  translate: (key: string) => string,
): ProcessGraph {
  const itemById = new Map(plan.itemTotals.map((t) => [t.itemId, t]));
  // Also collect from roots and recipe nodes
  const itemNodes = new Map<string, ProductionPlanningItemNode>();
  const collectItemNodes = (node: ProductionPlanningItemNode) => {
    itemNodes.set(node.itemId, node);
    if (node.recipeNode !== null) {
      for (const input of node.recipeNode.inputItems) {
        collectItemNodes(input);
      }
    }
  };
  for (const root of plan.roots) {
    collectItemNodes(root);
  }

  const buildIndex: ProcessBuildIndex = {
    resolveItemIconSrc: (itemId: string) => resolveProductionPlanningItemIconSrc(itemId, index),
    resolveItemName: (itemId: string) => resolveProductionPlanningItemName(itemId, index, (k) => k),
  };

  const state: BuildState = {
    plan,
    index,
    recipeChoices,
    expandedItemIds,
    recipeById: index.recipeById,
    naturalResourceItemIds: index.naturalResourceItemIds,
    translate,
    itemNodes,
    nodes: [],
    links: [],
    recipeStack: new Set(),
  };

  let nextRow = 0;
  for (const root of plan.roots) {
    const targetItemId = findTargetItemId(root);
    if (targetItemId === null) continue;

    const name = resolveProductionPlanningItemName(targetItemId, index, translate);
    const iconSrc = resolveProductionPlanningItemIconSrc(targetItemId, index);

    // Place the target node at col 0
    const targetNode: MutableProcessNode = {
      itemId: targetItemId,
      col: 0,
      row: nextRow,
      type: "target",
      iconSrc,
      name,
      expandedRecipeId: null,
    };
    state.nodes.push(targetNode);
    const targetRow = nextRow;
    nextRow++;

    // Expand main chain for each root, starting at the same row as target
    const mainEndRow = expandMainChain(targetItemId, 0, targetRow, state, []);
    // Main chain may insert additional rows; ensure nextRow moves past all inserted content
    nextRow = Math.max(nextRow, mainEndRow);
  }

  // Deduplicate and sort
  const nodeMap = new Map<string, MutableProcessNode>();
  for (const n of state.nodes) {
    const key = `${n.col}:${n.row}`;
    nodeMap.set(key, n);
  }
  let nodes = [...nodeMap.values()].sort((a, b) => a.row - b.row || a.col - b.col);

  // Shift col values to be positive (0 = leftmost, max = target column)
  const minCol = nodes.reduce((m, n) => Math.min(m, n.col), 0);
  if (minCol < 0) {
    const shift = -minCol;
    for (const n of nodes) {
      n.col += shift;
    }
    for (const l of state.links) {
      l.fromCol += shift;
      l.toCol += shift;
      l.boundaryCol += shift;
    }
  }

  const maxCol = nodes.reduce((m, n) => Math.max(m, n.col), 0);
  const maxRow = nodes.reduce((m, n) => Math.max(m, n.row), 0);

  return {
    nodes: nodes.map((n) => ({ ...n })),
    links: [...state.links],
    maxCol,
    maxRow,
  };
}

function findTargetItemId(node: ProductionPlanningItemNode): string | null {
  if (node.itemId.length > 0) return node.itemId;
  if (node.recipeNode !== null && node.recipeNode.targetItemId.length > 0) {
    return node.recipeNode.targetItemId;
  }
  return null;
}

/**
 * Expand the main ingredient chain starting from itemId.
 * Returns the row after all expanded content.
 * col = current column (0 = rightmost).
 * startRow = row to place the main chain content.
 */
function expandMainChain(
  itemId: string,
  col: number,
  startRow: number,
  state: BuildState,
  path: string[],
): number {
  // Prevent infinite recursion
  if (path.length > 50 || path.includes(itemId)) {
    return startRow;
  }

  const recipe = resolveRecipe(itemId, state);
  if (recipe === null) {
    // No recipe → natural resource or external. Place a terminal node.
    if (state.naturalResourceItemIds.has(itemId)) {
      const name = resolveProductionPlanningItemName(itemId, state.index, state.translate);
      const iconSrc = resolveProductionPlanningItemIconSrc(itemId, state.index);
      state.nodes.push({
        itemId,
        col: col - 1,
        row: startRow,
        type: "natural",
        iconSrc,
        name,
        expandedRecipeId: null,
      });
      // Link from col-1 to col
      state.links.push({ fromCol: col - 1, fromRow: startRow, toCol: col, toRow: startRow, boundaryCol: col - 1 });
    }
    return startRow + 1;
  }

  if (state.recipeStack.has(recipe.id)) {
    // Cycle detected
    const name = resolveProductionPlanningItemName(itemId, state.index, state.translate);
    const iconSrc = resolveProductionPlanningItemIconSrc(itemId, state.index);
    state.nodes.push({
      itemId,
      col: col - 1,
      row: startRow,
      type: "cycle",
      iconSrc,
      name,
      recipeId: recipe.id,
      expandedRecipeId: null,
    });
    return startRow + 1;
  }

  state.recipeStack.add(recipe.id);

  // Place dangling outputs (outputs not in path)
  const danglingOutputs = recipe.outputs.filter(
    (o) => !path.includes(o.itemId) && o.itemId !== itemId,
  );

  const inputs = recipe.inputs;
  if (inputs.length === 0) {
    // Natural resource recipe (e.g., miner, pump)
    state.recipeStack.delete(recipe.id);
    // 目标是自然资源时，目标节点已存在，不再额外创建 natural 节点
    if (path.length === 0) {
      return startRow + 1;
    }
    const name = resolveProductionPlanningItemName(itemId, state.index, state.translate);
    const iconSrc = resolveProductionPlanningItemIconSrc(itemId, state.index);
    state.nodes.push({
      itemId,
      col: col - 1,
      row: startRow,
      type: "natural",
      iconSrc,
      name,
      recipeId: recipe.id,
      expandedRecipeId: null,
    });
    state.links.push({ fromCol: col - 1, fromRow: startRow, toCol: col, toRow: startRow, boundaryCol: col - 1 });
    return startRow + 1;
  }

  // Main ingredient: inputs[0]
  const mainInput = inputs[0]!;
  const mainCol = col - 1;
  const mainRecipe = resolveRecipe(mainInput.itemId, state);

  // 自然资源作为主配料时直接放终端节点，避免先放 main 节点再递归展开出重复的 natural 节点
  if (state.naturalResourceItemIds.has(mainInput.itemId)) {
    const mainName = resolveProductionPlanningItemName(mainInput.itemId, state.index, state.translate);
    const mainIconSrc = resolveProductionPlanningItemIconSrc(mainInput.itemId, state.index);
    state.nodes.push({
      itemId: mainInput.itemId,
      col: mainCol,
      row: startRow,
      type: "natural",
      iconSrc: mainIconSrc,
      name: mainName,
      amount: mainInput.amount,
      recipeId: mainRecipe?.id,
      expandedRecipeId: null,
    });
    state.links.push({ fromCol: mainCol, fromRow: startRow, toCol: col, toRow: startRow, boundaryCol: mainCol });
    return startRow + 1;
  }

  // Place main ingredient node at col-1, same row
  const mainName = resolveProductionPlanningItemName(mainInput.itemId, state.index, state.translate);
  const mainIconSrc = resolveProductionPlanningItemIconSrc(mainInput.itemId, state.index);
  state.nodes.push({
    itemId: mainInput.itemId,
    col: mainCol,
    row: startRow,
    type: "main",
    iconSrc: mainIconSrc,
    name: mainName,
    amount: mainInput.amount,
    expandedRecipeId: mainRecipe?.id ?? null,
  });
  state.links.push({ fromCol: mainCol, fromRow: startRow, toCol: col, toRow: startRow, boundaryCol: mainCol });

  // Recurse main chain
  let currentRow = startRow;
  const nextPath = [...path, itemId];
  const mainEndRow = expandMainChain(mainInput.itemId, mainCol, currentRow, state, nextPath);
  currentRow = mainEndRow;

  // Secondary ingredients: inputs[1:]
  for (let si = 1; si < inputs.length; si++) {
    const secInput = inputs[si]!;
    const secName = resolveProductionPlanningItemName(secInput.itemId, state.index, state.translate);
    const secIconSrc = resolveProductionPlanningItemIconSrc(secInput.itemId, state.index);
    const isNatural = state.naturalResourceItemIds.has(secInput.itemId);

    if (isNatural) {
      // Natural resource → terminal leaf
      state.nodes.push({
        itemId: secInput.itemId,
        col: mainCol,
        row: currentRow,
        type: "natural",
        iconSrc: secIconSrc,
        name: secName,
        amount: secInput.amount,
        expandedRecipeId: null,
      });
      state.links.push({ fromCol: mainCol, fromRow: currentRow, toCol: col, toRow: startRow, boundaryCol: mainCol });
      currentRow++;
    } else if (state.expandedItemIds.has(secInput.itemId)) {
      // Already expanded → expand further (show as expanded with the recipe)
      const secRecipe = resolveRecipe(secInput.itemId, state);
      state.nodes.push({
        itemId: secInput.itemId,
        col: mainCol,
        row: currentRow,
        type: "main",
        iconSrc: secIconSrc,
        name: secName,
        amount: secInput.amount,
        expandedRecipeId: secRecipe?.id ?? null,
      });
      state.links.push({ fromCol: mainCol, fromRow: currentRow, toCol: col, toRow: startRow, boundaryCol: mainCol });
      // Expand this secondary's main chain starting at currentRow
      const secEndRow = expandMainChain(secInput.itemId, mainCol, currentRow, state, nextPath);
      currentRow = secEndRow;
    } else {
      // Not expanded → show expand symbol
      state.nodes.push({
        itemId: secInput.itemId,
        col: mainCol,
        row: currentRow,
        type: "secondary",
        iconSrc: secIconSrc,
        name: secName,
        amount: secInput.amount,
        expandedRecipeId: null,
      });
      state.links.push({ fromCol: mainCol, fromRow: currentRow, toCol: col, toRow: startRow, boundaryCol: mainCol });
      currentRow++;
    }
  }

  // Dangling outputs
  for (const dOutput of danglingOutputs) {
    const dName = resolveProductionPlanningItemName(dOutput.itemId, state.index, state.translate);
    const dIconSrc = resolveProductionPlanningItemIconSrc(dOutput.itemId, state.index);
    state.nodes.push({
      itemId: dOutput.itemId,
      col: mainCol + 1,
      row: currentRow,
      type: "dangling",
      iconSrc: dIconSrc,
      name: dName,
      amount: dOutput.amount,
      expandedRecipeId: null,
    });
    currentRow++;
  }

  state.recipeStack.delete(recipe.id);
  return currentRow;
}

function resolveRecipe(
  itemId: string,
  state: BuildState,
): RecipeDefinition | null {
  // If user chose a specific recipe
  const chosenRecipeId = state.recipeChoices.get(itemId);
  if (chosenRecipeId !== undefined) {
    const recipe = state.recipeById.get(chosenRecipeId);
    if (recipe !== undefined && recipe.outputs.some((o) => o.itemId === itemId)) {
      return recipe;
    }
  }

  // AUTO fallback: first non-excluded recipe from recipesByOutputItem
  const recipes = state.index.recipesByOutputItem.get(itemId);
  if (recipes === undefined || recipes.length === 0) {
    return null;
  }

  const candidates = recipes.filter(
    (r) => !isRecipeExcludedFromProductionPlanningAuto(r),
  );

  if (candidates.length === 0) {
    return null;
  }

  // Natural resources prefer null-input recipe
  if (state.naturalResourceItemIds.has(itemId)) {
    const nullRecipe = candidates.find((r) => r.inputs.length === 0);
    if (nullRecipe !== undefined) {
      return nullRecipe;
    }
  }

  return candidates[0]!;
}
