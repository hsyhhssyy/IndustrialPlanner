import type {
  ProductionPlanningDisplayMode,
  ProductionPlanningIndex,
  ProductionPlanningItemNode,
  ProductionPlanningRecipeNode,
  ProductionPlanningResult,
} from "../production-planning-model";
import {
  formatProductionDeviceCount,
  formatProductionFlow,
  resolveProductionPlanningEntityIconSrc,
  resolveProductionPlanningItemIconSrc,
  resolveProductionPlanningItemName,
  resolveProductionPlanningRecipeName,
} from "../production-planning-model";
import type { SankeyInputLink, SankeyInputNode } from "./sankey-layout";

export type ProductionFlowNodeKind = "item" | "recipe";
export type ProductionFlowNodeTone = "normal" | "source" | "cycle" | "unresolved" | "byproduct";

export interface ProductionFlowNode extends SankeyInputNode {
  readonly kind: ProductionFlowNodeKind;
  readonly tone: ProductionFlowNodeTone;
  readonly title: string;
  readonly subtitle: string;
  readonly iconSrc: string;
  readonly itemId?: string;
  readonly recipeId?: string;
  readonly itemNode?: ProductionPlanningItemNode;
  readonly recipeNode?: ProductionPlanningRecipeNode;
}

export interface ProductionFlowLink extends SankeyInputLink {
  readonly itemId: string;
  readonly title: string;
  readonly label: string;
}

export interface ProductionFlowGraphInput {
  readonly nodes: ProductionFlowNode[];
  readonly links: ProductionFlowLink[];
}

interface BuildContext {
  readonly index: ProductionPlanningIndex;
  readonly translate: (key: string) => string;
  readonly nodes: Map<string, ProductionFlowNode>;
  readonly links: Map<string, ProductionFlowLink>;
}

export function buildProductionFlowGraph(
  plan: ProductionPlanningResult,
  index: ProductionPlanningIndex,
  translate: (key: string) => string,
  displayMode: ProductionPlanningDisplayMode,
): ProductionFlowGraphInput {
  const context: BuildContext = {
    index,
    translate,
    nodes: new Map(),
    links: new Map(),
  };

  for (const root of plan.roots) {
    visitItemNode(root, context, new Map());
  }

  const mixed: ProductionFlowGraphInput = {
    nodes: [...context.nodes.values()],
    links: [...context.links.values()],
  };

  return displayMode === "item" ? collapseRecipeNodes(mixed) : collapseItemNodes(mixed);
}

function visitItemNode(
  node: ProductionPlanningItemNode,
  context: BuildContext,
  ancestors: ReadonlyMap<string, string>,
): void {
  const itemNodeId = itemFlowNodeId(node);
  addItemNode(node, context);
  const nextAncestors = new Map(ancestors);
  if (!nextAncestors.has(node.itemId)) {
    nextAncestors.set(node.itemId, itemNodeId);
  }

  if (node.recipeNode === null) {
    return;
  }

  const recipeNodeId = recipeFlowNodeId(node.recipeNode);
  addRecipeNode(node.recipeNode, context);
  addLink({
    id: `${recipeNodeId}->${itemNodeId}:${node.itemId}`,
    source: recipeNodeId,
    target: itemNodeId,
    itemId: node.itemId,
    value: findOutputFlow(node.recipeNode, node.itemId) || node.producedPerMinute || node.demandPerMinute,
  }, context);

  for (const output of node.recipeNode.outputs) {
    if (output.itemId === node.itemId || output.perMinute <= 0) {
      continue;
    }

    const byproductId = `byproduct:${node.recipeNode.id}:${output.itemId}`;
    addByproductNode(byproductId, output.itemId, output.perMinute, context);
    addLink({
      id: `${recipeNodeId}->${byproductId}:${output.itemId}`,
      source: recipeNodeId,
      target: byproductId,
      itemId: output.itemId,
      value: output.perMinute,
    }, context);
  }

  for (const child of node.recipeNode.inputItems) {
    const ancestorNodeId = child.isCycleSource ? nextAncestors.get(child.itemId) : undefined;
    const childNodeId = ancestorNodeId ?? itemFlowNodeId(child);
    if (ancestorNodeId === undefined) {
      visitItemNode(child, context, nextAncestors);
    } else {
      upgradeNodeTone(ancestorNodeId, "cycle", context);
    }
    addLink({
      id: `${childNodeId}->${recipeNodeId}:${child.itemId}:${child.id}`,
      source: childNodeId,
      target: recipeNodeId,
      itemId: child.itemId,
      value: findInputFlow(node.recipeNode, child.itemId) || child.demandPerMinute,
    }, context);
  }
}

function addItemNode(node: ProductionPlanningItemNode, context: BuildContext): void {
  const id = itemFlowNodeId(node);
  if (context.nodes.has(id)) {
    return;
  }

  const tone: ProductionFlowNodeTone = node.unresolvedPerMinute > 0
    ? "unresolved"
    : node.isCycleSource
      ? "cycle"
      : node.isInfiniteSource || (node.suppliedPerMinute > 0 && node.recipeNode === null)
        ? "source"
        : "normal";
  const rate = Math.max(node.demandPerMinute, node.suppliedPerMinute, node.producedPerMinute, node.unresolvedPerMinute, 1);

  context.nodes.set(id, {
    id,
    kind: "item",
    tone,
    title: resolveProductionPlanningItemName(node.itemId, context.index, context.translate),
    subtitle: `${formatProductionFlow(node.demandPerMinute)}/min`,
    iconSrc: resolveProductionPlanningItemIconSrc(node.itemId, context.index),
    value: rate,
    itemId: node.itemId,
    itemNode: node,
  });
}

function upgradeNodeTone(id: string, tone: ProductionFlowNodeTone, context: BuildContext): void {
  const node = context.nodes.get(id);
  if (node === undefined || node.tone !== "normal") {
    return;
  }

  context.nodes.set(id, { ...node, tone });
}

function addByproductNode(
  id: string,
  itemId: string,
  perMinute: number,
  context: BuildContext,
): void {
  if (context.nodes.has(id)) {
    return;
  }

  context.nodes.set(id, {
    id,
    kind: "item",
    tone: "byproduct",
    title: resolveProductionPlanningItemName(itemId, context.index, context.translate),
    subtitle: `${formatProductionFlow(perMinute)}/min`,
    iconSrc: resolveProductionPlanningItemIconSrc(itemId, context.index),
    value: Math.max(perMinute, 1),
    itemId,
  });
}

function addRecipeNode(node: ProductionPlanningRecipeNode, context: BuildContext): void {
  const id = recipeFlowNodeId(node);
  if (context.nodes.has(id)) {
    return;
  }

  const recipe = context.index.recipeById.get(node.recipeId);
  const title = recipe === undefined ? node.recipeId : resolveProductionPlanningRecipeName(recipe, context.index, context.translate);
  const machineId = recipe?.machineId ?? "item_port_grinder_1";
  context.nodes.set(id, {
    id,
    kind: "recipe",
    tone: "normal",
    title,
    subtitle: `${formatProductionDeviceCount(node.deviceCount)} devices · ${formatProductionFlow(node.cyclesPerMinute)}/min`,
    iconSrc: resolveProductionPlanningEntityIconSrc(machineId),
    value: Math.max(sumPorts(node.inputs), sumPorts(node.outputs), 1),
    recipeId: node.recipeId,
    recipeNode: node,
  });
}

function addLink(
  link: Pick<ProductionFlowLink, "id" | "source" | "target" | "itemId" | "value">,
  context: BuildContext,
): void {
  if (context.links.has(link.id) || link.value <= 0) {
    return;
  }

  context.links.set(link.id, {
    ...link,
    title: resolveProductionPlanningItemName(link.itemId, context.index, context.translate),
    label: `${formatProductionFlow(link.value)}/min`,
  });
}

function itemFlowNodeId(node: ProductionPlanningItemNode): string {
  return `item:${node.id}`;
}

function recipeFlowNodeId(node: ProductionPlanningRecipeNode): string {
  return `recipe:${node.id}`;
}

function findInputFlow(node: ProductionPlanningRecipeNode, itemId: string): number {
  return node.inputs.find((input) => input.itemId === itemId)?.perMinute ?? 0;
}

function findOutputFlow(node: ProductionPlanningRecipeNode, itemId: string): number {
  return node.outputs.find((output) => output.itemId === itemId)?.perMinute ?? 0;
}

function sumPorts(ports: readonly { readonly perMinute: number }[]): number {
  return ports.reduce((sum, port) => sum + port.perMinute, 0);
}

// --- Graph collapse for display modes ---

/**
 * Item mode: remove recipe nodes and connect items directly.
 * For each recipe R with inputs {A,B} and outputs {X,Y}:
 *   Create edges A→X, A→Y, B→X, B→Y.
 * Flow rate on each new edge = input flow rate for that item.
 * Edge label includes the recipe name.
 */
function collapseRecipeNodes(input: ProductionFlowGraphInput): ProductionFlowGraphInput {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const nodes = new Map(input.nodes.filter((node) => node.kind === "item").map((node) => [node.id, node]));
  const links: ProductionFlowLink[] = [];

  // group links by recipe node
  const recipeInputs = new Map<string, ProductionFlowLink[]>();  // recipeId → incoming links
  const recipeOutputs = new Map<string, ProductionFlowLink[]>(); // recipeId → outgoing links

  for (const link of input.links) {
    const target = nodeById.get(link.target);
    if (target !== undefined && target.kind === "recipe") {
      const list = recipeInputs.get(link.target) ?? [];
      list.push(link);
      recipeInputs.set(link.target, list);
    } else {
      // Non-recipe target — could be a source node directly connected to recipe
      // In our graph, edges always go item→recipe or recipe→item, so this shouldn't happen
    }

    const source = nodeById.get(link.source);
    if (source !== undefined && source.kind === "recipe") {
      const list = recipeOutputs.get(link.source) ?? [];
      list.push(link);
      recipeOutputs.set(link.source, list);
    }
  }

  let edgeIndex = 0;
  for (const recipeId of new Set([...recipeInputs.keys(), ...recipeOutputs.keys()])) {
    const srcLinks = recipeInputs.get(recipeId) ?? [];
    const dstLinks = recipeOutputs.get(recipeId) ?? [];
    const recipeNode = nodeById.get(recipeId);

    for (const inLink of srcLinks) {
      for (const outLink of dstLinks) {
        const value = Math.min(inLink.value, outLink.value);
        const label = recipeNode === undefined
          ? `${formatProductionFlow(value)}/min`
          : `${recipeNode.title} · ${formatProductionFlow(value)}/min`;
        links.push({
          id: `collapsed:${edgeIndex}`,
          source: inLink.source,
          target: outLink.target,
          itemId: outLink.itemId,
          value,
          title: recipeNode?.title ?? outLink.title,
          label,
        });
        edgeIndex += 1;
      }
    }
  }

  return {
    nodes: [...nodes.values()],
    links,
  };
}

/**
 * Device mode: remove intermediate item nodes and connect recipes directly.
 * Intermediate items = items that both consume from and produce to recipes.
 * Source items (no incoming recipe link) and sink items (no outgoing recipe link) are kept.
 */
function collapseItemNodes(input: ProductionFlowGraphInput): ProductionFlowGraphInput {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));

  // classify item nodes
  const itemIncomingRecipe = new Set<string>();   // itemId — has recipe→item edge
  const itemOutgoingRecipe = new Set<string>();   // itemId — has item→recipe edge

  for (const link of input.links) {
    const sourceNode = nodeById.get(link.source);
    const targetNode = nodeById.get(link.target);
    if (sourceNode?.kind === "recipe" && targetNode?.kind === "item") {
      itemIncomingRecipe.add(link.target);
    }
    if (sourceNode?.kind === "item" && targetNode?.kind === "recipe") {
      itemOutgoingRecipe.add(link.source);
    }
  }

  // intermediate items = items that sit BETWEEN recipes
  // Exclude cycle items — they form feedback loops and should be preserved in all modes
  const collapsedItemIds = new Set<string>();
  for (const itemId of new Set([...itemIncomingRecipe, ...itemOutgoingRecipe])) {
    const hasRecipeInput = itemIncomingRecipe.has(itemId);
    const hasRecipeOutput = itemOutgoingRecipe.has(itemId);
    const itemNode = nodeById.get(itemId);
    if (hasRecipeInput && hasRecipeOutput && itemNode?.tone !== "cycle") {
      collapsedItemIds.add(itemId);
    }
  }

  // Build new links: recipe → recipe through collapsed items
  // Group by intermediate item
  const itemToRecipeOutputs = new Map<string, ProductionFlowLink[]>(); // itemId → R→item links
  const itemToRecipeInputs = new Map<string, ProductionFlowLink[]>();  // itemId → item→R links

  for (const link of input.links) {
    const sourceNode = nodeById.get(link.source);
    const targetNode = nodeById.get(link.target);

    if (sourceNode?.kind === "recipe" && targetNode?.kind === "item" && collapsedItemIds.has(link.target)) {
      const list = itemToRecipeOutputs.get(link.target) ?? [];
      list.push(link);
      itemToRecipeOutputs.set(link.target, list);
    }
    if (sourceNode?.kind === "item" && targetNode?.kind === "recipe" && collapsedItemIds.has(link.source)) {
      const list = itemToRecipeInputs.get(link.source) ?? [];
      list.push(link);
      itemToRecipeInputs.set(link.source, list);
    }
  }

  const newLinks: ProductionFlowLink[] = [];
  let edgeIndex = 0;

  for (const itemId of collapsedItemIds) {
    const inLinks = itemToRecipeOutputs.get(itemId) ?? []; // recipe→item
    const outLinks = itemToRecipeInputs.get(itemId) ?? []; // item→recipe
    const itemNode = nodeById.get(itemId);

    for (const inLink of inLinks) {
      for (const outLink of outLinks) {
        const value = Math.min(inLink.value, outLink.value);
        const label = `${itemNode?.title ?? itemId} · ${formatProductionFlow(value)}/min`;
        newLinks.push({
          id: `collapsed:${edgeIndex}`,
          source: inLink.source,
          target: outLink.target,
          itemId: itemId,
          value,
          title: itemNode?.title ?? itemId,
          label,
        });
        edgeIndex += 1;
      }
    }
  }

  // Keep non-collapsed links (edges that don't involve intermediate items)
  const keptLinks = input.links.filter((link) => {
    const sourceNode = nodeById.get(link.source);
    const targetNode = nodeById.get(link.target);
    const involvesCollapsedItem = (
      (sourceNode?.kind === "item" && collapsedItemIds.has(link.source)) ||
      (targetNode?.kind === "item" && collapsedItemIds.has(link.target))
    );
    return !involvesCollapsedItem;
  });

  // Keep non-collapsed nodes (recipes + source/sink items)
  const keptNodes = input.nodes.filter((node) => {
    if (node.kind === "recipe") {
      return true;
    }

    return !collapsedItemIds.has(node.id);
  });

  return {
    nodes: keptNodes,
    links: [...keptLinks, ...newLinks],
  };
}
