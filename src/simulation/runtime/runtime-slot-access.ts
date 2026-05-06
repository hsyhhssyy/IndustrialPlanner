import type {
  CompiledSimulationNode,
  CompiledSimulationRecipeItem,
  CompiledSimulationRecipePlan,
  CompiledSimulationSlot,
  CompiledSimulationTopology,
  SimulationAcceptRule,
  SimulationItemDomain,
} from "../types";
import type {
  RuntimeDeviceRecipeState,
  RuntimeRecipeItem,
  RuntimeReservedItem,
  RuntimeSlotState,
  SimulationMutableRuntimeState,
} from "./runtime-state";

/**
 * 对应《仿真运行原理》§3.3、§3.4、§4 与 §5。
 * 五个阶段都会读写 slot、Link、reservation 与 recipe output；这些公共操作集中在这里，
 * 避免阶段文件各自重新实现 share-all/share-cap、组内互斥、库存预留和产物落位规则。
 */

export function resolveStorageSlotId(
  state: SimulationMutableRuntimeState,
  slotId: string,
): string {
  return state.persistent.shareAllTargetSlotIdBySourceSlotId[slotId] ?? slotId;
}

export function getReservedAmount(
  state: SimulationMutableRuntimeState,
  storageSlotId: string,
): number {
  let reservedAmount = 0;
  for (const deviceState of Object.values(state.persistent.devices)) {
    const recipe = deviceState.recipe;
    if (recipe === null) {
      continue;
    }
    for (const reservation of recipe.reservations) {
      if (reservation.slotId === storageSlotId) {
        reservedAmount += reservation.amount;
      }
    }
  }
  return reservedAmount;
}

export function acceptsItem(
  topology: CompiledSimulationTopology,
  rule: SimulationAcceptRule,
  itemType: string,
): boolean {
  if (rule.exclude.includes(itemType)) {
    return false;
  }

  switch (rule.base.kind) {
    case "any":
      return true;
    case "solid":
    case "liquid":
      return getItemDomain(topology, itemType) === rule.base.kind;
    case "item":
      return rule.base.itemId === itemType;
  }
}

export function findInputSlotForItem(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  node: CompiledSimulationNode;
  itemType: string;
}): string | null {
  const nodeState = options.state.transient.nodes[options.node.id];
  const excluded = new Set(nodeState?.excludedItemTypes ?? []);

  for (const slotId of options.node.slotIds) {
    const slot = options.topology.slots[slotId];
    if (slot === undefined || !slotCanHold(options.topology, slot, options.itemType)) {
      continue;
    }

    const storageSlotId = resolveStorageSlotId(options.state, slotId);
    const slotState = options.state.persistent.slots[storageSlotId];
    if (slotState === undefined || getRemainingCapacity(options.topology, options.state, slotId) <= 0) {
      continue;
    }

    if (slotState.itemType === options.itemType) {
      return slotId;
    }
    if (slotState.count === 0 && slotState.itemType === null && !excluded.has(options.itemType)) {
      return slotId;
    }
  }

  return null;
}

export function findOutputSlotForItem(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  node: CompiledSimulationNode;
  itemType: string;
}): string | null {
  for (const slotId of options.node.slotIds) {
    for (const candidateSlotId of getReadableComponentSlotIds(options.state, slotId)) {
      const slot = options.topology.slots[candidateSlotId] ?? options.topology.slots[slotId];
      const storageSlotId = resolveStorageSlotId(options.state, candidateSlotId);
      const slotState = options.state.persistent.slots[storageSlotId];
      const itemType = slotState?.itemType ?? slot?.lock ?? null;
      if (slot === undefined || slotState === undefined || itemType !== options.itemType) {
        continue;
      }

      if (slot.ignoreStock || slotState.count - getReservedAmount(options.state, storageSlotId) > 0) {
        return candidateSlotId;
      }
    }
  }

  return null;
}

export function moveOneItem(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  sourceSlotId: string;
  targetSlotId: string;
  itemType: string;
}): boolean {
  const sourceSlot = options.topology.slots[options.sourceSlotId];
  const sourceStorageSlotId = resolveStorageSlotId(options.state, options.sourceSlotId);
  const targetStorageSlotId = resolveStorageSlotId(options.state, options.targetSlotId);
  const sourceState = options.state.persistent.slots[sourceStorageSlotId];
  const targetState = options.state.persistent.slots[targetStorageSlotId];
  if (sourceSlot === undefined || sourceState === undefined || targetState === undefined) {
    return false;
  }

  if (!sourceSlot.ignoreStock) {
    sourceState.count = Math.max(0, sourceState.count - 1);
    if (sourceState.count === 0) {
      sourceState.itemType = null;
    }
  }

  targetState.itemType = targetState.itemType ?? options.itemType;
  targetState.count += 1;
  return true;
}

export function placeRecipeOutputs(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  plan: CompiledSimulationRecipePlan,
  inputItems: readonly RuntimeRecipeItem[],
): boolean {
  const simulatedSlots = cloneSlotStates(state.persistent.slots);
  const simulatedState: SimulationMutableRuntimeState = {
    ...state,
    persistent: {
      ...state.persistent,
      slots: simulatedSlots,
    },
  };

  for (const output of resolveRecipeOutputItems(plan.outputs, inputItems)) {
    for (let amount = 0; amount < output.amount; amount += 1) {
      const targetSlotId = findRecipeOutputSlot(topology, simulatedState, plan, output.itemType);
      if (targetSlotId === null) {
        return false;
      }
      const storageSlotId = resolveStorageSlotId(simulatedState, targetSlotId);
      const slotState = simulatedSlots[storageSlotId];
      if (slotState === undefined) {
        return false;
      }
      slotState.itemType = slotState.itemType ?? output.itemType;
      slotState.count += 1;
    }
  }

  state.persistent.slots = simulatedSlots;
  return true;
}

export function selectRecipeInputs(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  plan: CompiledSimulationRecipePlan;
}): RuntimeReservedItem[] | null {
  const selections: RuntimeReservedItem[] = [];
  const localTakenBySlot: Record<string, number> = {};

  for (const input of options.plan.inputs) {
    let remainingAmount = input.amount;
    while (remainingAmount > 0) {
      const selection = findRecipeInputSelection(options.topology, options.state, options.plan, input, localTakenBySlot);
      if (selection === null) {
        return null;
      }
      const amount = Math.min(selection.availableAmount, remainingAmount);
      selections.push({ slotId: selection.slotId, itemType: selection.itemType, amount });
      localTakenBySlot[selection.slotId] = (localTakenBySlot[selection.slotId] ?? 0) + amount;
      remainingAmount -= amount;
    }
  }

  return selections;
}

export function consumeSelections(
  slots: Record<string, RuntimeSlotState>,
  selections: readonly RuntimeReservedItem[],
): void {
  for (const selection of selections) {
    const slotState = slots[selection.slotId];
    if (slotState === undefined) {
      continue;
    }
    slotState.count = Math.max(0, slotState.count - selection.amount);
    if (slotState.count === 0) {
      slotState.itemType = null;
    }
  }
}

export function aggregateInputItems(selections: readonly RuntimeReservedItem[]): RuntimeRecipeItem[] {
  const amountByItemType = new Map<string, number>();
  for (const selection of selections) {
    amountByItemType.set(selection.itemType, (amountByItemType.get(selection.itemType) ?? 0) + selection.amount);
  }
  return [...amountByItemType.entries()].map(([itemType, amount]) => ({ itemType, amount }));
}

export function getItemDomain(topology: CompiledSimulationTopology, itemType: string): SimulationItemDomain {
  return topology.itemCatalog[itemType]?.domain
    ?? (itemType.includes("_liquid") || itemType.startsWith("liquid_") ? "liquid" : "solid");
}

function getRemainingCapacity(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  slotId: string,
): number {
  const slot = topology.slots[slotId];
  if (slot === undefined) {
    return 0;
  }
  const sharedSlotIds = state.persistent.sharedCapacitySlotIdsBySlotId[slotId];
  if (sharedSlotIds === undefined) {
    const storageSlotId = resolveStorageSlotId(state, slotId);
    return Math.max(0, slot.capacity - (state.persistent.slots[storageSlotId]?.count ?? 0));
  }

  const visitedStorageSlotIds = new Set<string>();
  let occupiedCount = 0;
  for (const sharedSlotId of sharedSlotIds) {
    const storageSlotId = resolveStorageSlotId(state, sharedSlotId);
    if (visitedStorageSlotIds.has(storageSlotId)) {
      continue;
    }
    visitedStorageSlotIds.add(storageSlotId);
    occupiedCount += state.persistent.slots[storageSlotId]?.count ?? 0;
  }

  return Math.max(0, (state.persistent.sharedCapacityLimitBySlotId[slotId] ?? slot.capacity) - occupiedCount);
}

function getReadableComponentSlotIds(state: SimulationMutableRuntimeState, slotId: string): readonly string[] {
  return state.persistent.sharedCapacitySlotIdsBySlotId[slotId] ?? [slotId];
}

function slotCanHold(topology: CompiledSimulationTopology, slot: CompiledSimulationSlot, itemType: string): boolean {
  if (slot.lock !== null && slot.lock !== itemType) {
    return false;
  }
  return slot.domain === "any" || getItemDomain(topology, itemType) === slot.domain;
}

function findRecipeOutputSlot(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  plan: CompiledSimulationRecipePlan,
  itemType: string,
): string | null {
  for (const nodeId of plan.productCacheGroupIds) {
    const node = topology.nodes[nodeId] ?? topology.cacheGroups[nodeId];
    if (node === undefined) {
      continue;
    }
    const targetSlotId = findInputSlotForItem({ topology, state, node, itemType });
    if (targetSlotId !== null) {
      return targetSlotId;
    }
  }
  return null;
}

function resolveRecipeOutputItems(
  outputs: readonly CompiledSimulationRecipeItem[],
  inputItems: readonly RuntimeRecipeItem[],
): Array<{ readonly itemType: string; readonly amount: number }> {
  const firstInputItemType = inputItems[0]?.itemType ?? null;
  return outputs.flatMap((output) => {
    if (output.itemId === "same-as-input") {
      return firstInputItemType === null ? [] : [{ itemType: firstInputItemType, amount: output.amount }];
    }
    if (output.itemId === "any") {
      return firstInputItemType === null ? [] : [{ itemType: firstInputItemType, amount: output.amount }];
    }
    return [{ itemType: output.itemId, amount: output.amount }];
  });
}

function findRecipeInputSelection(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  plan: CompiledSimulationRecipePlan,
  input: CompiledSimulationRecipeItem,
  localTakenBySlot: Record<string, number>,
): { readonly slotId: string; readonly itemType: string; readonly availableAmount: number } | null {
  for (const nodeId of plan.ingredientCacheGroupIds) {
    const node = topology.nodes[nodeId] ?? topology.cacheGroups[nodeId];
    if (node === undefined) {
      continue;
    }
    for (const slotId of node.slotIds) {
      const storageSlotId = resolveStorageSlotId(state, slotId);
      const slotState = state.persistent.slots[storageSlotId];
      if (slotState === undefined || slotState.itemType === null || !recipeInputMatches(input, slotState.itemType)) {
        continue;
      }
      const itemType = slotState.itemType;
      const availableAmount = slotState.count
        - getReservedAmount(state, storageSlotId)
        - (localTakenBySlot[storageSlotId] ?? 0);
      if (availableAmount > 0) {
        return { slotId: storageSlotId, itemType, availableAmount };
      }
    }
  }
  return null;
}

function recipeInputMatches(input: CompiledSimulationRecipeItem, itemType: string): boolean {
  return input.itemId === "any" || input.itemId === itemType;
}

function cloneSlotStates(slots: Record<string, RuntimeSlotState>): Record<string, RuntimeSlotState> {
  return Object.fromEntries(Object.entries(slots).map(([slotId, slot]) => [slotId, { ...slot }]));
}

export function finishRecipeIfPossible(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  recipe: RuntimeDeviceRecipeState,
): boolean {
  const simulatedSlots = cloneSlotStates(state.persistent.slots);
  if (recipe.reservations.length > 0) {
    consumeSelections(simulatedSlots, recipe.reservations);
  }

  const simulatedState: SimulationMutableRuntimeState = {
    ...state,
    persistent: {
      ...state.persistent,
      slots: simulatedSlots,
    },
  };
  if (!placeRecipeOutputs(topology, simulatedState, recipe.plan, recipe.inputItems)) {
    return false;
  }

  state.persistent.slots = simulatedState.persistent.slots;
  return true;
}
