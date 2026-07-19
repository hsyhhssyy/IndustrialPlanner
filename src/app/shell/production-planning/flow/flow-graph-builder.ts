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
import {
  buildProductionPlanningLedgerRows,
  isProductionPlanningDisposalRecipeId,
  isProductionPlanningExternalSupplyRecipeId,
  type ProductionPlanningLedgerRow,
} from "../production-planning-ledger";
import { createDeviceIconAssetUrl, createPublicAssetUrl } from "@/shared/browser/public-asset-url";
import type { SankeyInputLink, SankeyInputNode } from "./sankey-layout";

export type ProductionFlowNodeKind = "item" | "recipe";
export type ProductionFlowNodeTone = "normal" | "source" | "cycle" | "unresolved" | "byproduct";
export type ProductionFlowLinkNodeSide = "left" | "right";

export interface ProductionFlowNode extends SankeyInputNode {
  readonly kind: ProductionFlowNodeKind;
  readonly tone: ProductionFlowNodeTone;
  readonly title: string;
  readonly subtitle: string;
  readonly iconSrc: string;
  readonly itemId?: string;
  readonly recipeId?: string;
  readonly isTransient?: boolean;
  readonly itemNode?: ProductionPlanningItemNode;
  readonly ledgerRow?: ProductionPlanningLedgerRow;
  readonly recipeNode?: ProductionPlanningRecipeNode;
}

export interface ProductionFlowLink extends SankeyInputLink {
  readonly itemId: string;
  readonly title: string;
  readonly label: string;
  readonly sourceSide?: ProductionFlowLinkNodeSide;
  readonly targetSide?: ProductionFlowLinkNodeSide;
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

interface LedgerBuildContext {
  readonly displayMode: ProductionPlanningDisplayMode;
  readonly index: ProductionPlanningIndex;
  readonly plan: ProductionPlanningResult;
  readonly translate: (key: string) => string;
  readonly nodes: Map<string, ProductionFlowNode>;
  readonly links: Map<string, ProductionFlowLink>;
}

interface ItemFlowEndpoint {
  readonly itemId: string;
  readonly nodeId: string;
  readonly row: ProductionPlanningLedgerRow;
  readonly value: number;
}

const FLOW_EPSILON = 0.0001;
const EXTERNAL_SUPPLY_ENTITY_ICON_SRC = createPublicAssetUrl("3d-top-view/sprites/item_port_sp_hub_1.webp");
const PLANTER_MACHINE_IDS = new Set(["planter_1", "hydro_planter_1"]);
const SEED_COLLECTOR_MACHINE_IDS = new Set(["seedcol_1"]);

export function buildProductionFlowGraph(
  plan: ProductionPlanningResult,
  index: ProductionPlanningIndex,
  translate: (key: string) => string,
  displayMode: ProductionPlanningDisplayMode,
): ProductionFlowGraphInput {
  const context: LedgerBuildContext = {
    displayMode,
    index,
    plan,
    translate,
    nodes: new Map(),
    links: new Map(),
  };
  const rows = buildProductionPlanningLedgerRows(plan);
  const producersByItemId = new Map<string, ItemFlowEndpoint[]>();
  const consumersByItemId = new Map<string, ItemFlowEndpoint[]>();

  for (const row of rows) {
    addLedgerRowNode(row, context);
    const producedPerMinute = findOutputFlow(row.recipeNode, row.targetItemId);
    if (row.targetItemId.length > 0 && producedPerMinute > FLOW_EPSILON) {
      appendEndpoint(producersByItemId, row.targetItemId, {
        itemId: row.targetItemId,
        nodeId: row.id,
        row,
        value: producedPerMinute,
      });
    }

    for (const input of resolveLedgerRowConsumerPorts(row)) {
      if (input.perMinute <= FLOW_EPSILON) {
        continue;
      }
      appendEndpoint(consumersByItemId, input.itemId, {
        itemId: input.itemId,
        nodeId: row.id,
        row,
        value: input.perMinute,
      });
    }
  }

  const itemIds = new Set([...producersByItemId.keys(), ...consumersByItemId.keys()]);
  for (const itemId of itemIds) {
    connectItemFlow(itemId, producersByItemId.get(itemId) ?? [], consumersByItemId.get(itemId) ?? [], context);
  }

  return {
    nodes: [...context.nodes.values()],
    links: [...context.links.values()],
  };
}

function addLedgerRowNode(row: ProductionPlanningLedgerRow, context: LedgerBuildContext): void {
  if (context.nodes.has(row.id)) {
    return;
  }

  const isExternal = isProductionPlanningExternalSupplyRecipeId(row.recipeId);
  const targetName = resolveProductionPlanningItemName(row.targetItemId, context.index, context.translate);
  const machineName = resolveLedgerRowMachineName(row, context.index, context.translate);
  const producedPerMinute = findOutputFlow(row.recipeNode, row.targetItemId);
  const consumedPerMinute = sumPorts(resolveLedgerRowConsumerPorts(row));
  const flowPerMinute = Math.max(producedPerMinute, consumedPerMinute);
  const kind: ProductionFlowNodeKind = context.displayMode === "item" ? "item" : "recipe";
  const title = context.displayMode === "item" ? targetName : machineName;
  const subtitle = context.displayMode === "item"
    ? `${machineName} · ${formatProductionFlow(flowPerMinute)}/min`
    : isExternal
      ? `${targetName} · ${formatProductionFlow(flowPerMinute)}/min`
      : `${targetName} · ${formatProductionDeviceCount(row.recipeNode.deviceCount)} ${context.translate("productionPlanning.devices")} · ${formatProductionFlow(flowPerMinute)}/min`;
  const iconSrc = context.displayMode === "item"
    ? resolveProductionPlanningItemIconSrc(row.targetItemId, context.index)
    : resolveLedgerRowMachineIconSrc(row, context.index);

  context.nodes.set(row.id, {
    id: row.id,
    kind,
    tone: resolveLedgerRowTone(row),
    title,
    subtitle,
    iconSrc,
    value: Math.max(flowPerMinute, 1),
    itemId: row.targetItemId,
    recipeId: row.recipeId,
    ledgerRow: row,
    recipeNode: row.recipeNode,
  });
}

function resolveLedgerRowTone(row: ProductionPlanningLedgerRow): ProductionFlowNodeTone {
  if (isProductionPlanningExternalSupplyRecipeId(row.recipeId)) {
    return "source";
  }
  if (row.isByproduct) {
    return "byproduct";
  }
  if (row.recipeNodes.some((recipeNode) => recipeNode.inputItems.some((itemNode) => itemNode.isCycleSource))) {
    return "cycle";
  }
  return "normal";
}

function resolveLedgerRowMachineName(
  row: ProductionPlanningLedgerRow,
  index: ProductionPlanningIndex,
  translate: (key: string) => string,
): string {
  if (isProductionPlanningExternalSupplyRecipeId(row.recipeId)) {
    return translate("productionPlanning.externalSupply");
  }

  const recipe = index.recipeById.get(row.recipeId);
  const machine = recipe === undefined ? undefined : index.entityById.get(recipe.machineId);
  if (machine !== undefined) {
    return translate(machine.nameKey);
  }
  return recipe?.machineId ?? row.recipeId;
}

function resolveLedgerRowMachineId(row: ProductionPlanningLedgerRow, index: ProductionPlanningIndex): string | null {
  return index.recipeById.get(row.recipeId)?.machineId ?? null;
}

function resolveLedgerRowMachineIconSrc(row: ProductionPlanningLedgerRow, index: ProductionPlanningIndex): string {
  if (isProductionPlanningExternalSupplyRecipeId(row.recipeId)) {
    return EXTERNAL_SUPPLY_ENTITY_ICON_SRC;
  }

  const recipe = index.recipeById.get(row.recipeId);
  return recipe === undefined
    ? createDeviceIconAssetUrl("item_port_grinder_1")
    : resolveProductionPlanningEntityIconSrc(recipe.machineId, index);
}

function resolveLedgerRowConsumerPorts(row: ProductionPlanningLedgerRow): ProductionPlanningRecipeNode["inputs"] {
  if (isProductionPlanningExternalSupplyRecipeId(row.recipeId)) {
    return [];
  }

  const ports = new Map<string, ProductionPlanningRecipeNode["inputs"][number]>();
  for (const recipeNode of row.recipeNodes) {
    if (!shouldLedgerRecipeNodeConsumeInputs(row, recipeNode)) {
      continue;
    }

    for (const input of recipeNode.inputs) {
      const existing = ports.get(input.itemId);
      if (existing === undefined) {
        ports.set(input.itemId, { ...input });
      } else {
        ports.set(input.itemId, {
          ...existing,
          perMinute: existing.perMinute + input.perMinute,
        });
      }
    }
  }
  return [...ports.values()];
}

function shouldLedgerRecipeNodeConsumeInputs(
  row: ProductionPlanningLedgerRow,
  recipeNode: ProductionPlanningRecipeNode,
): boolean {
  if (isProductionPlanningDisposalRecipeId(row.recipeId)) {
    return true;
  }
  if (recipeNode.outputs.length === 0) {
    return true;
  }
  return !recipeNode.id.includes(":target:");
}

function appendEndpoint(
  endpointsByItemId: Map<string, ItemFlowEndpoint[]>,
  itemId: string,
  endpoint: ItemFlowEndpoint,
): void {
  const endpoints = endpointsByItemId.get(itemId);
  if (endpoints === undefined) {
    endpointsByItemId.set(itemId, [endpoint]);
  } else {
    endpoints.push(endpoint);
  }
}

function connectItemFlow(
  itemId: string,
  producers: readonly ItemFlowEndpoint[],
  consumers: readonly ItemFlowEndpoint[],
  context: LedgerBuildContext,
): void {
  if (producers.length === 0 || consumers.length === 0) {
    return;
  }

  if (producers.length > 1 && consumers.length > 1) {
    const junctionId = transientItemFlowNodeId(itemId);
    const producerValue = producers.reduce((sum, endpoint) => sum + endpoint.value, 0);
    const consumerValue = consumers.reduce((sum, endpoint) => sum + endpoint.value, 0);
    addTransientItemNode(itemId, Math.max(producerValue, consumerValue), context);
    for (const producer of producers) {
      addLedgerLink(producer.nodeId, junctionId, itemId, producer.value, context);
    }
    for (const consumer of consumers) {
      addLedgerLink(
        junctionId,
        consumer.nodeId,
        itemId,
        consumer.value,
        context,
        resolveConsumerLinkOptions(itemId, producers, consumer, context),
      );
    }
    return;
  }

  if (producers.length === 1) {
    const producer = producers[0];
    if (producer === undefined) {
      return;
    }
    for (const consumer of consumers) {
      addLedgerLink(
        producer.nodeId,
        consumer.nodeId,
        itemId,
        consumer.value,
        context,
        resolveConsumerLinkOptions(itemId, [producer], consumer, context),
      );
    }
    return;
  }

  if (consumers.length === 1) {
    const consumer = consumers[0];
    if (consumer === undefined) {
      return;
    }
    for (const producer of producers) {
      addLedgerLink(
        producer.nodeId,
        consumer.nodeId,
        itemId,
        producer.value,
        context,
        resolveConsumerLinkOptions(itemId, [producer], consumer, context),
      );
    }
  }
}

function resolveConsumerLinkOptions(
  itemId: string,
  producers: readonly ItemFlowEndpoint[],
  consumer: ItemFlowEndpoint,
  context: LedgerBuildContext,
): Pick<ProductionFlowLink, "preferredFeedback" | "sourceSide" | "targetSide"> {
  if (shouldEnterConsumerFromRight(itemId, producers, consumer, context)) {
    return {
      preferredFeedback: true,
      targetSide: "right",
    };
  }

  return shouldExitProducerFromLeft(itemId, producers, consumer, context)
    ? { sourceSide: "left" }
    : {};
}

function shouldEnterConsumerFromRight(
  itemId: string,
  producers: readonly ItemFlowEndpoint[],
  consumer: ItemFlowEndpoint,
  context: LedgerBuildContext,
): boolean {
  return isPlantBodyItemId(itemId)
    && isSeedCollectorLedgerRow(consumer.row, context.index)
    && producers.some((producer) => isPlanterLedgerRow(producer.row, context.index));
}

function shouldExitProducerFromLeft(
  itemId: string,
  producers: readonly ItemFlowEndpoint[],
  consumer: ItemFlowEndpoint,
  context: LedgerBuildContext,
): boolean {
  return isPlantSeedItemId(itemId)
    && isPlanterLedgerRow(consumer.row, context.index)
    && producers.some((producer) => isSeedCollectorLedgerRow(producer.row, context.index));
}

function isPlantBodyItemId(itemId: string): boolean {
  return itemId.startsWith("item_plant_")
    && !itemId.includes("_seed")
    && !itemId.includes("_powder");
}

function isPlantSeedItemId(itemId: string): boolean {
  return itemId.startsWith("item_plant_") && itemId.includes("_seed");
}

function isPlanterLedgerRow(row: ProductionPlanningLedgerRow, index: ProductionPlanningIndex): boolean {
  const machineId = resolveLedgerRowMachineId(row, index);
  return machineId !== null && PLANTER_MACHINE_IDS.has(machineId);
}

function isSeedCollectorLedgerRow(row: ProductionPlanningLedgerRow, index: ProductionPlanningIndex): boolean {
  const machineId = resolveLedgerRowMachineId(row, index);
  return machineId !== null && SEED_COLLECTOR_MACHINE_IDS.has(machineId);
}

function addTransientItemNode(itemId: string, value: number, context: LedgerBuildContext): void {
  const id = transientItemFlowNodeId(itemId);
  if (context.nodes.has(id)) {
    return;
  }

  context.nodes.set(id, {
    id,
    kind: "item",
    tone: context.plan.byproductItemIds.has(itemId) ? "byproduct" : "normal",
    title: resolveProductionPlanningItemName(itemId, context.index, context.translate),
    subtitle: `${formatProductionFlow(value)}/min`,
    iconSrc: resolveProductionPlanningItemIconSrc(itemId, context.index),
    value: Math.max(value, 1),
    itemId,
    isTransient: true,
  });
}

function addLedgerLink(
  source: string,
  target: string,
  itemId: string,
  value: number,
  context: LedgerBuildContext,
  options: Pick<ProductionFlowLink, "preferredFeedback" | "sourceSide" | "targetSide"> = {},
): void {
  if (value <= FLOW_EPSILON) {
    return;
  }

  const id = `flow:${source}->${target}:${itemId}`;
  const existing = context.links.get(id);
  const nextValue = (existing?.value ?? 0) + value;
  context.links.set(id, {
    id,
    source,
    target,
    itemId,
    value: nextValue,
    title: resolveProductionPlanningItemName(itemId, context.index, context.translate),
    label: `${formatProductionFlow(nextValue)}/min`,
    ...options,
  });
}

function transientItemFlowNodeId(itemId: string): string {
  return `item:${itemId}`;
}

// AI-CORRECTION 2026-05-24: 流程图有效入口已改为 ledger 行驱动；旧递归实例遍历仅作为历史实现保留，避免再被新逻辑调用。
function _archivedVisitItemNode(
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
      _archivedVisitItemNode(child, context, nextAncestors);
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
  const machineId = recipe?.machineId ?? "grinder_1";
  context.nodes.set(id, {
    id,
    kind: "recipe",
    tone: "normal",
    title,
    subtitle: `${formatProductionDeviceCount(node.deviceCount)} devices · ${formatProductionFlow(node.cyclesPerMinute)}/min`,
    iconSrc: resolveProductionPlanningEntityIconSrc(machineId, context.index),
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
function _archivedCollapseRecipeNodes(input: ProductionFlowGraphInput): ProductionFlowGraphInput {
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
function _archivedCollapseItemNodes(input: ProductionFlowGraphInput): ProductionFlowGraphInput {
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
