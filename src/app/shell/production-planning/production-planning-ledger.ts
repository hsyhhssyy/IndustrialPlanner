import type {
  ProductionPlanningItemNode,
  ProductionPlanningPort,
  ProductionPlanningRecipeNode,
  ProductionPlanningResult,
} from "./production-planning-model";

export interface ProductionPlanningLedgerRow {
  readonly id: string;
  readonly recipeId: string;
  readonly targetItemId: string;
  readonly recipeNode: ProductionPlanningRecipeNode;
  readonly recipeNodes: readonly ProductionPlanningRecipeNode[];
  readonly total: ProductionPlanningResult["recipeTotals"][number] | null;
  readonly inputItemIds: readonly string[];
  readonly outputItemIds: readonly string[];
  readonly isByproduct: boolean;
}

interface MutableProductionPlanningLedgerRow {
  id: string;
  order: number;
  recipeId: string;
  targetItemId: string;
  recipeNode: ProductionPlanningRecipeNode;
  recipeNodes: ProductionPlanningRecipeNode[];
  total: ProductionPlanningResult["recipeTotals"][number] | null;
  inputItemIds: Set<string>;
  outputItemIds: Set<string>;
  isByproduct: boolean;
}

const PRODUCTION_PLANNING_EPSILON = 0.0001;
const EXTERNAL_SUPPLY_RECIPE_ID_PREFIX = "external-supply:";
const DEVICE_MINIMUM_CONSUMPTION_RECIPE_ID_PREFIX = "device-minimum-consumption:";

export function buildProductionPlanningLedgerRows(
  plan: ProductionPlanningResult,
): ProductionPlanningLedgerRow[] {
  const recipeTotals = new Map(plan.recipeTotals.map((total) => [
    total.recipeId ?? total.candidateId,
    total,
  ]));
  const rowById = new Map<string, MutableProductionPlanningLedgerRow>();
  const byproductRowIds = new Set<string>();
  let nextOrder = 0;

  const ensureRecipeRow = (
    recipeId: string,
    targetItemId: string,
    recipeNode: ProductionPlanningRecipeNode | null,
  ): MutableProductionPlanningLedgerRow => {
    const rowId = buildProductionPlanningLedgerRowId(recipeId, targetItemId);
    const existing = rowById.get(rowId);
    const total = recipeTotals.get(recipeId) ?? null;
    const targetRecipeNode = recipeNode === null
      ? createProductionPlanningLedgerSyntheticRecipeNode(recipeId, total, null, targetItemId)
      : createProductionPlanningLedgerTargetedRecipeNode(recipeNode, targetItemId);

    if (existing !== undefined) {
      existing.total = total;
      if (recipeNode === null && existing.recipeNodes.length > 0) {
        if (targetItemId.length > 0) {
          existing.outputItemIds.add(targetItemId);
        }
        return existing;
      }
      if (!existing.recipeNodes.some((candidate) => candidate.id === targetRecipeNode.id)) {
        existing.recipeNodes.push(targetRecipeNode);
        existing.recipeNode = mergeProductionPlanningLedgerRecipeNodes(existing.recipeNode, targetRecipeNode);
      }
      if (targetItemId.length > 0) {
        existing.outputItemIds.add(targetItemId);
      }
      for (const input of resolveProductionPlanningRecipeInputPorts(targetRecipeNode)) {
        existing.inputItemIds.add(input.itemId);
      }
      return existing;
    }

    const row: MutableProductionPlanningLedgerRow = {
      id: rowId,
      order: nextOrder,
      recipeId,
      targetItemId,
      recipeNode: targetRecipeNode,
      recipeNodes: [targetRecipeNode],
      total,
      inputItemIds: new Set(resolveProductionPlanningRecipeInputPorts(targetRecipeNode).map((input) => input.itemId)),
      outputItemIds: targetItemId.length > 0 ? new Set([targetItemId]) : new Set(),
      isByproduct: false,
    };
    nextOrder += 1;
    rowById.set(rowId, row);
    return row;
  };

  const ensureExternalSupplyRow = (node: ProductionPlanningItemNode): MutableProductionPlanningLedgerRow | null => {
    const perMinute = resolveProductionPlanningExternalSupplyPerMinute(node);
    if (perMinute <= PRODUCTION_PLANNING_EPSILON) {
      return null;
    }

    const recipeNode = createProductionPlanningExternalSupplyRecipeNode(node, perMinute);
    return ensureRecipeRow(recipeNode.recipeId ?? recipeNode.candidateId, recipeNode.targetItemId, recipeNode);
  };

  const registerRecipeOutputs = (recipeNode: ProductionPlanningRecipeNode) => {
    for (const output of recipeNode.outputs) {
      if (output.perMinute <= PRODUCTION_PLANNING_EPSILON) {
        continue;
      }

      const row = ensureRecipeRow(recipeNode.recipeId ?? recipeNode.candidateId, output.itemId, recipeNode);
      if (
        !isProductionPlanningDisposalRecipeId(row.recipeId)
        && !isProductionPlanningExternalSupplyRecipeId(row.recipeId)
        && output.itemId !== recipeNode.targetItemId
        && plan.byproductItemIds.has(output.itemId)
      ) {
        byproductRowIds.add(row.id);
      }
    }
  };

  const registerDeviceMinimumConsumptionInputs = (recipeNode: ProductionPlanningRecipeNode) => {
    for (const input of recipeNode.deviceMinimumConsumptionInputs) {
      if (input.perMinute <= PRODUCTION_PLANNING_EPSILON) {
        continue;
      }

      const consumptionNode = createProductionPlanningDeviceMinimumConsumptionRecipeNode(recipeNode, input);
      ensureRecipeRow(consumptionNode.recipeId ?? consumptionNode.candidateId, input.itemId, consumptionNode);
    }
  };

  const collectRowsFromItemNode = (node: ProductionPlanningItemNode): void => {
    ensureExternalSupplyRow(node);

    if (node.recipeNode === null) {
      return;
    }

    registerRecipeOutputs(node.recipeNode);
    registerDeviceMinimumConsumptionInputs(node.recipeNode);
    for (const child of node.recipeNode.inputItems) {
      collectRowsFromItemNode(child);
    }
    for (const child of node.recipeNode.deviceMinimumConsumptionItems) {
      collectRowsFromItemNode(child);
    }
  };

  for (const root of plan.roots) {
    collectRowsFromItemNode(root);
  }

  for (const total of plan.recipeTotals) {
    const targetItemIds = total.outputs.length > 0
      ? total.outputs.map((output) => output.itemId)
      : total.inputs.slice(0, 1).map((input) => input.itemId);

    for (const targetItemId of targetItemIds) {
      const row = ensureRecipeRow(total.recipeId ?? total.candidateId, targetItemId, null);
      for (const input of total.inputs) {
        row.inputItemIds.add(input.itemId);
      }
      row.outputItemIds.add(targetItemId);
    }
  }

  markLedgerByproductRows(rowById, byproductRowIds);

  return Array.from(rowById.values())
    .sort((left, right) => left.order - right.order)
    .map(finalizeProductionPlanningLedgerRow);
}

export function buildProductionPlanningLedgerRowId(recipeId: string, targetItemId: string): string {
  return `recipe:${recipeId}:target:${targetItemId}`;
}

export function isProductionPlanningExternalSupplyRecipeId(recipeId: string): boolean {
  return recipeId.startsWith(EXTERNAL_SUPPLY_RECIPE_ID_PREFIX);
}

export function isProductionPlanningDeviceMinimumConsumptionRecipeId(recipeId: string): boolean {
  return recipeId.startsWith(DEVICE_MINIMUM_CONSUMPTION_RECIPE_ID_PREFIX);
}

export function buildProductionPlanningDeviceMinimumConsumptionRecipeId(hostRecipeId: string): string {
  return `${DEVICE_MINIMUM_CONSUMPTION_RECIPE_ID_PREFIX}${hostRecipeId}`;
}

export function resolveProductionPlanningDeviceMinimumConsumptionHostRecipeId(recipeId: string): string | null {
  return isProductionPlanningDeviceMinimumConsumptionRecipeId(recipeId)
    ? recipeId.slice(DEVICE_MINIMUM_CONSUMPTION_RECIPE_ID_PREFIX.length)
    : null;
}

export function resolveProductionPlanningRecipeInputPorts(
  recipeNode: ProductionPlanningRecipeNode,
): ProductionPlanningPort[] {
  if (recipeNode.deviceMinimumConsumptionInputs.length === 0) {
    return recipeNode.inputs.map(clonePort);
  }

  const deviceConsumptionByItemId = new Map<string, number>();
  for (const input of recipeNode.deviceMinimumConsumptionInputs) {
    deviceConsumptionByItemId.set(
      input.itemId,
      (deviceConsumptionByItemId.get(input.itemId) ?? 0) + input.perMinute,
    );
  }

  return recipeNode.inputs.flatMap((input) => {
    const perMinute = input.perMinute - (deviceConsumptionByItemId.get(input.itemId) ?? 0);
    return perMinute > PRODUCTION_PLANNING_EPSILON
      ? [{ ...clonePort(input), perMinute }]
      : [];
  });
}

export function isProductionPlanningDisposalRecipeId(recipeId: string): boolean {
  return recipeId.startsWith("r_dumper_void_") || recipeId.startsWith("r_chrono_wastewater_treatment");
}

function finalizeProductionPlanningLedgerRow(
  row: MutableProductionPlanningLedgerRow,
): ProductionPlanningLedgerRow {
  return {
    id: row.id,
    recipeId: row.recipeId,
    targetItemId: row.targetItemId,
    recipeNode: row.recipeNode,
    recipeNodes: row.recipeNodes,
    total: row.total,
    inputItemIds: Array.from(row.inputItemIds).sort((left, right) => left.localeCompare(right)),
    outputItemIds: Array.from(row.outputItemIds).sort((left, right) => left.localeCompare(right)),
    isByproduct: row.isByproduct,
  };
}

function createProductionPlanningLedgerTargetedRecipeNode(
  recipeNode: ProductionPlanningRecipeNode,
  targetItemId: string,
): ProductionPlanningRecipeNode {
  if (recipeNode.targetItemId === targetItemId) {
    return recipeNode;
  }

  return {
    ...recipeNode,
    id: `${recipeNode.id}:target:${targetItemId}`,
    targetItemId,
  };
}

function markLedgerByproductRows(
  rowById: ReadonlyMap<string, MutableProductionPlanningLedgerRow>,
  byproductRowIds: ReadonlySet<string>,
): void {
  for (const row of rowById.values()) {
    row.isByproduct = byproductRowIds.has(row.id) || isProductionPlanningDisposalRecipeId(row.recipeId);
  }
}

function createProductionPlanningLedgerSyntheticRecipeNode(
  recipeId: string,
  total: ProductionPlanningResult["recipeTotals"][number] | null,
  fallback: ProductionPlanningRecipeNode | null,
  targetItemId: string = fallback?.targetItemId ?? total?.outputs[0]?.itemId ?? total?.inputs[0]?.itemId ?? "",
): ProductionPlanningRecipeNode {
  if (total === null) {
    return fallback ?? {
      id: `total:${recipeId}`,
      kind: "recipe",
      candidateId: recipeId,
      candidateSourceType: "system-recipe",
      module: null,
      recipeId,
      targetItemId,
      durationSeconds: 0,
      cyclesPerMinute: 0,
      deviceCount: 0,
      inputs: [],
      deviceMinimumConsumptionInputs: [],
      outputs: [],
      inputItems: [],
      deviceMinimumConsumptionItems: [],
    };
  }

  return {
    id: fallback?.id ?? `total:${recipeId}`,
    kind: "recipe",
    candidateId: total.candidateId,
    candidateSourceType: total.candidateSourceType,
    module: total.module,
    recipeId: total.recipeId,
    targetItemId,
    durationSeconds: total.durationSeconds,
    cyclesPerMinute: total.cyclesPerMinute,
    deviceCount: total.deviceCount,
    inputs: total.inputs.map(clonePort),
    deviceMinimumConsumptionInputs: total.deviceMinimumConsumptionInputs.map(clonePort),
    outputs: total.outputs.map(clonePort),
    inputItems: fallback?.inputItems ?? [],
    deviceMinimumConsumptionItems: fallback?.deviceMinimumConsumptionItems ?? [],
  };
}

function mergeProductionPlanningLedgerRecipeNodes(
  left: ProductionPlanningRecipeNode,
  right: ProductionPlanningRecipeNode,
): ProductionPlanningRecipeNode {
  return {
    id: left.id,
    kind: "recipe",
    candidateId: left.candidateId,
    candidateSourceType: left.candidateSourceType,
    module: left.module,
    recipeId: left.recipeId,
    targetItemId: left.targetItemId,
    durationSeconds: left.durationSeconds || right.durationSeconds,
    cyclesPerMinute: left.cyclesPerMinute + right.cyclesPerMinute,
    deviceCount: left.deviceCount + right.deviceCount,
    inputs: mergePorts(left.inputs, right.inputs),
    deviceMinimumConsumptionInputs: mergePorts(
      left.deviceMinimumConsumptionInputs,
      right.deviceMinimumConsumptionInputs,
    ),
    outputs: mergePorts(left.outputs, right.outputs),
    inputItems: left.inputItems,
    deviceMinimumConsumptionItems: left.deviceMinimumConsumptionItems,
  };
}

function mergePorts(
  left: readonly ProductionPlanningPort[],
  right: readonly ProductionPlanningPort[],
): ProductionPlanningPort[] {
  const result = new Map<string, ProductionPlanningPort>();
  for (const port of [...left, ...right]) {
    const existing = result.get(port.itemId);
    if (existing === undefined) {
      result.set(port.itemId, clonePort(port));
      continue;
    }

    result.set(port.itemId, {
      ...existing,
      perMinute: existing.perMinute + port.perMinute,
    });
  }
  return Array.from(result.values());
}

function clonePort(port: ProductionPlanningPort): ProductionPlanningPort {
  return {
    id: port.id,
    itemId: port.itemId,
    perMinute: port.perMinute,
    ...(port.isInfinite === true ? { isInfinite: true } : {}),
  };
}

function resolveProductionPlanningExternalSupplyPerMinute(node: ProductionPlanningItemNode): number {
  return node.supply.manual + node.supply.infinite;
}

function buildProductionPlanningExternalSupplyRecipeId(itemId: string): string {
  return `${EXTERNAL_SUPPLY_RECIPE_ID_PREFIX}${itemId}`;
}

function createProductionPlanningExternalSupplyRecipeNode(
  node: ProductionPlanningItemNode,
  perMinute: number,
): ProductionPlanningRecipeNode {
  return {
    id: `${EXTERNAL_SUPPLY_RECIPE_ID_PREFIX}${node.id}`,
    kind: "recipe",
    candidateId: buildProductionPlanningExternalSupplyRecipeId(node.itemId),
    candidateSourceType: "system-recipe",
    module: null,
    recipeId: buildProductionPlanningExternalSupplyRecipeId(node.itemId),
    targetItemId: node.itemId,
    durationSeconds: 0,
    cyclesPerMinute: 0,
    deviceCount: 0,
    inputs: [],
    deviceMinimumConsumptionInputs: [],
    outputs: [{ id: `${node.id}-external-supply-out-${node.itemId}`, itemId: node.itemId, perMinute }],
    inputItems: [],
    deviceMinimumConsumptionItems: [],
  };
}

function createProductionPlanningDeviceMinimumConsumptionRecipeNode(
  hostRecipeNode: ProductionPlanningRecipeNode,
  input: ProductionPlanningPort,
): ProductionPlanningRecipeNode {
  const recipeId = buildProductionPlanningDeviceMinimumConsumptionRecipeId(
    hostRecipeNode.recipeId ?? hostRecipeNode.candidateId,
  );
  return {
    id: `${recipeId}:${hostRecipeNode.id}:${input.itemId}`,
    kind: "recipe",
    candidateId: recipeId,
    candidateSourceType: "system-recipe",
    module: null,
    recipeId,
    targetItemId: input.itemId,
    durationSeconds: 0,
    cyclesPerMinute: 0,
    deviceCount: 0,
    inputs: [clonePort(input)],
    deviceMinimumConsumptionInputs: [],
    outputs: [],
    inputItems: [],
    deviceMinimumConsumptionItems: [],
  };
}
