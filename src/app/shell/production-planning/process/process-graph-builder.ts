import type { ProductionPlanningItemNode, ProductionPlanningIndex, ProductionPlanningResult } from "../production-planning-model";
import {
  isRecipeExcludedFromProductionPlanningAuto,
  resolveProductionPlanningEntityIconSrc,
  resolveProductionPlanningItemIconSrc,
  resolveProductionPlanningItemName,
} from "../production-planning-model";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import type { ProcessGraph, ProcessLink, ProcessNode, ProcessBuildIndex } from "./process-graph-model";
import type { ProductionPlanningDisplayMode } from "../production-planning-model";

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
  displayMode: ProductionPlanningDisplayMode = "item",
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
    const targetRecipe = index.recipeById.get(
      Array.from(index.recipesByOutputItem.get(targetItemId) ?? [])
        .filter((r) => !isRecipeExcludedFromProductionPlanningAuto(r))
        .find((r) => index.naturalResourceItemIds.has(targetItemId) ? r.inputs.length === 0 : true)
        ?.id ?? "",
    ) ?? undefined;
    const targetNode: MutableProcessNode = {
      itemId: targetItemId,
      col: 0,
      row: nextRow,
      type: "target",
      iconSrc,
      name,
      recipeId: targetRecipe?.id,
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

  // 设备视图：为每个有配方的物品节点插入前置设备节点
  if (displayMode === "device") {
    return applyDeviceView({ nodes, links: state.links, maxCol, maxRow }, index, translate);
  }

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

interface RawProcessGraph {
  nodes: MutableProcessNode[];
  links: MutableProcessLink[];
  maxCol: number;
  maxRow: number;
}

/**
 * 设备视图转换：为每个有配方的物品节点插入前置设备节点，并重定向连线。
 *
 * 物品视图：  [原料A] ──→ [物品B(配方P)]
 * 设备视图：  [原料A] ──→ [设备X] ──→ [物品B]
 */
function applyDeviceView(raw: RawProcessGraph, index: ProductionPlanningIndex, translate: (key: string) => string): ProcessGraph {
  // Step 1: 将所有 col 值乘以 2，为设备节点腾出位置
  for (const n of raw.nodes) {
    n.col *= 2;
  }
  for (const l of raw.links) {
    l.fromCol *= 2;
    l.toCol *= 2;
    l.boundaryCol *= 2;
  }

  // Step 2: 为每个有配方的物品节点创建设备节点
  const deviceNodes: MutableProcessNode[] = [];
  const nodeKeyToDeviceKey = new Map<string, string>(); // "col:row" → deviceKey

  for (const n of raw.nodes) {
    const recipeId = n.recipeId ?? (n.expandedRecipeId ?? undefined);
    if (recipeId === undefined) continue;

    const recipe = index.recipeById.get(recipeId);
    if (recipe === undefined) continue;

    const machineEntity = index.entityById.get(recipe.machineId);
    const deviceKey = `${n.col - 1}:${n.row}`;
    nodeKeyToDeviceKey.set(`${n.col}:${n.row}`, deviceKey);

    deviceNodes.push({
      itemId: recipe.machineId,
      col: n.col - 1,
      row: n.row,
      type: "device",
      iconSrc: resolveProductionPlanningEntityIconSrc(recipe.machineId, index),
      name: machineEntity !== undefined ? translate(machineEntity.nameKey) : recipe.machineId,
      recipeId: undefined,
      amount: undefined,
      expandedRecipeId: null,
    });
  }

  // Step 3: 重定向连线
  //   - 所有指向物品节点的连线 → 改为指向设备节点
  //   - 新增设备节点 → 物品节点的连线
  const newLinks: MutableProcessLink[] = [];

  for (const l of raw.links) {
    const toKey = `${l.toCol}:${l.toRow}`;
    const deviceKey = nodeKeyToDeviceKey.get(toKey);

    if (deviceKey !== undefined) {
      // 有设备节点：连线从原来源指向设备节点
      const deviceCol = l.toCol - 1;
      newLinks.push({
        fromCol: l.fromCol,
        fromRow: l.fromRow,
        toCol: deviceCol,
        toRow: l.toRow,
        boundaryCol: l.boundaryCol, // boundary 保持不变，在 device 和原 to 之间
      });
    } else {
      // 无设备节点（自然/循环/展开符号节点）：保留原连线
      newLinks.push({ ...l });
    }
  }

  // Step 4: 添加设备节点 → 物品节点的连线
  for (const n of raw.nodes) {
    const nodeKey = `${n.col}:${n.row}`;
    const deviceKey = nodeKeyToDeviceKey.get(nodeKey);
    if (deviceKey === undefined) continue;

    newLinks.push({
      fromCol: n.col - 1,
      fromRow: n.row,
      toCol: n.col,
      toRow: n.row,
      boundaryCol: n.col - 1,
    });
  }

  // Step 5: 合并节点和连线，重新计算 maxCol
  const allNodes = [...raw.nodes, ...deviceNodes];
  allNodes.sort((a, b) => a.row - b.row || a.col - b.col);

  const finalMaxCol = Math.max(
    ...allNodes.map((n) => n.col),
    ...newLinks.map((l) => Math.max(l.fromCol, l.toCol, l.boundaryCol)),
  );
  const finalMaxRow = Math.max(
    ...allNodes.map((n) => n.row),
  );

  return {
    nodes: allNodes.map((n) => ({ ...n })),
    links: newLinks,
    maxCol: finalMaxCol,
    maxRow: finalMaxRow,
  };
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
  const isMainNatural = state.naturalResourceItemIds.has(mainInput.itemId);

  // Place main ingredient node at col-1, same row
  const mainName = resolveProductionPlanningItemName(mainInput.itemId, state.index, state.translate);
  const mainIconSrc = resolveProductionPlanningItemIconSrc(mainInput.itemId, state.index);
  const mainNodeType = isMainNatural ? "natural" : "main";
  state.nodes.push({
    itemId: mainInput.itemId,
    col: mainCol,
    row: startRow,
    type: mainNodeType,
    iconSrc: mainIconSrc,
    name: mainName,
    amount: mainInput.amount,
    recipeId: isMainNatural ? mainRecipe?.id : undefined,
    expandedRecipeId: isMainNatural ? null : (mainRecipe?.id ?? null),
  });
  state.links.push({ fromCol: mainCol, fromRow: startRow, toCol: col, toRow: startRow, boundaryCol: mainCol });

  // Recurse main chain (skip for natural resource — already terminal)
  let currentRow = startRow;
  const nextPath = [...path, itemId];
  if (isMainNatural) {
    currentRow = startRow + 1;
  } else {
    const mainEndRow = expandMainChain(mainInput.itemId, mainCol, currentRow, state, nextPath);
    currentRow = mainEndRow;
  }

  // Secondary ingredients: inputs[1:]
  for (let si = 1; si < inputs.length; si++) {
    const secInput = inputs[si]!;
    const secName = resolveProductionPlanningItemName(secInput.itemId, state.index, state.translate);
    const secIconSrc = resolveProductionPlanningItemIconSrc(secInput.itemId, state.index);
    const isNatural = state.naturalResourceItemIds.has(secInput.itemId);

    if (isNatural) {
      // Natural resource → terminal leaf
      const secRecipe = resolveRecipe(secInput.itemId, state);
      state.nodes.push({
        itemId: secInput.itemId,
        col: mainCol,
        row: currentRow,
        type: "natural",
        iconSrc: secIconSrc,
        name: secName,
        amount: secInput.amount,
        recipeId: secRecipe?.id,
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
