import type {
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

  return {
    nodes: [...context.nodes.values()],
    links: [...context.links.values()],
  };
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
