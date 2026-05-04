import type {
  CompiledSimulationDevice,
  CompiledSimulationRecipeItem,
  CompiledSimulationRecipePlan,
  CompiledSimulationSlotTemplate,
  CompiledSimulationTopology,
  SimulationItemDomain,
} from "@/domain/types/simulation";

import type {
  RuntimeDeviceRecipeState,
  RuntimeRecipeItem,
  RuntimeReservedItem,
  RuntimeSlotState,
  SimulationMutableRuntimeState,
} from "./runtime-state";

export function settleRecipes(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    const deviceState = state.persistent.devices[deviceId];
    if (device === undefined || deviceState === undefined || device.recipePlans.length === 0) {
      continue;
    }

    if (deviceState.recipe?.state === "waiting-output") {
      if (finishRecipeIfPossible(topology, state, deviceState.recipe)) {
        deviceState.recipe = null;
        deviceState.block = false;
      } else {
        deviceState.block = true;
        continue;
      }
    }

    if (deviceState.recipe === null) {
      const start = findStartableRecipe(topology, state, device);
      if (start !== null) {
        if (start.plan.recipeType === "immediate-consume") {
          consumeSelections(state, start.selections);
        }

        deviceState.recipe = {
          runId: `recipe:${device.id}:${state.persistent.nextRecipeRunIndex}`,
          recipeId: start.plan.recipeId,
          recipeType: start.plan.recipeType,
          progressTicks: 0,
          durationTicks: start.plan.durationTicks,
          state: "running",
          plan: start.plan,
          reservations: start.plan.recipeType === "reserved-item" ? start.selections : [],
          inputItems: start.inputItems,
        };
        state.persistent.nextRecipeRunIndex += 1;
        deviceState.block = false;
      }
    }
  }
}

function finishRecipeIfPossible(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  recipe: RuntimeDeviceRecipeState,
): boolean {
  const simulatedSlots = cloneSlotStates(state.persistent.slots);
  if (recipe.recipeType === "reserved-item") {
    consumeSelectionsFromSlots(simulatedSlots, recipe.reservations);
  }

  if (!placeOutputs(topology, simulatedSlots, recipe.plan, recipe.inputItems)) {
    return false;
  }

  if (recipe.recipeType === "reserved-item") {
    consumeSelections(state, recipe.reservations);
  }
  placeOutputs(topology, state.persistent.slots, recipe.plan, recipe.inputItems);
  return true;
}

function findStartableRecipe(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  device: CompiledSimulationDevice,
): {
  readonly plan: CompiledSimulationRecipePlan;
  readonly selections: RuntimeReservedItem[];
  readonly inputItems: RuntimeRecipeItem[];
} | null {
  for (const plan of device.recipePlans) {
    const selections = selectInputs(topology, state, plan);
    if (selections === null) {
      continue;
    }
    if (shouldDeferReservedRecipeStart(topology, state, plan, selections)) {
      continue;
    }

    return {
      plan,
      selections,
      inputItems: aggregateInputItems(selections),
    };
  }

  return null;
}

function shouldDeferReservedRecipeStart(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  plan: CompiledSimulationRecipePlan,
  selections: readonly RuntimeReservedItem[],
): boolean {
  if (plan.recipeType !== "reserved-item") {
    return false;
  }

  const productStorageSlotIds = new Set<string>();
  for (const cacheGroupId of plan.productCacheGroupIds) {
    const cacheGroup = topology.cacheGroups[cacheGroupId];
    if (cacheGroup === undefined) {
      continue;
    }
    for (const slotId of cacheGroup.slotIds) {
      productStorageSlotIds.add(resolveStorageSlotId(state, slotId));
    }
  }

  for (const selection of selections) {
    if (
      productStorageSlotIds.has(selection.slotId)
      && !wasStorageSlotWrittenByTransferThisTick(state, selection.slotId)
    ) {
      return true;
    }
  }

  return false;
}

function wasStorageSlotWrittenByTransferThisTick(
  state: SimulationMutableRuntimeState,
  storageSlotId: string,
): boolean {
  return state.transient.transfers.some((transfer) => (
    resolveStorageSlotId(state, transfer.targetSlotId) === storageSlotId
  ));
}

function selectInputs(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  plan: CompiledSimulationRecipePlan,
): RuntimeReservedItem[] | null {
  const selections: RuntimeReservedItem[] = [];
  const localTakenBySlot: Record<string, number> = {};

  for (const input of plan.inputs) {
    let remainingAmount = input.amount;
    while (remainingAmount > 0) {
      const selection = findInputSelection(topology, state, plan, input, localTakenBySlot);
      if (selection === null) {
        return null;
      }

      const amount = Math.min(selection.availableAmount, remainingAmount);
      selections.push({
        slotId: selection.slotId,
        itemType: selection.itemType,
        amount,
      });
      localTakenBySlot[selection.slotId] = (localTakenBySlot[selection.slotId] ?? 0) + amount;
      remainingAmount -= amount;
    }
  }

  return selections;
}

function findInputSelection(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  plan: CompiledSimulationRecipePlan,
  input: CompiledSimulationRecipeItem,
  localTakenBySlot: Record<string, number>,
): {
  readonly slotId: string;
  readonly itemType: string;
  readonly availableAmount: number;
} | null {
  for (const cacheGroupId of plan.ingredientCacheGroupIds) {
    const cacheGroup = topology.cacheGroups[cacheGroupId];
    if (cacheGroup === undefined) {
      continue;
    }

    for (const slotId of cacheGroup.slotIds) {
      const storageSlotId = resolveStorageSlotId(state, slotId);
      const slotState = state.persistent.slots[storageSlotId];
      const itemType = slotState?.itemType;
      if (slotState === undefined || itemType == null || !recipeInputMatches(input, itemType)) {
        continue;
      }

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

function recipeInputMatches(
  input: CompiledSimulationRecipeItem,
  itemType: string,
): boolean {
  return input.itemId === "any" || input.itemId === itemType;
}

function consumeSelections(
  state: SimulationMutableRuntimeState,
  selections: readonly RuntimeReservedItem[],
): void {
  consumeSelectionsFromSlots(state.persistent.slots, selections);
}

function consumeSelectionsFromSlots(
  slots: Record<string, RuntimeSlotState>,
  selections: readonly RuntimeReservedItem[],
): void {
  for (const selection of selections) {
    const slotState = slots[selection.slotId];
    if (slotState === undefined) {
      continue;
    }
    slotState.count = Math.max(0, slotState.count - selection.amount);
    if (slotState.itemType === null) {
      slotState.itemType = selection.itemType;
    }
  }
}

function placeOutputs(
  topology: CompiledSimulationTopology,
  slots: Record<string, RuntimeSlotState>,
  plan: CompiledSimulationRecipePlan,
  inputItems: readonly RuntimeRecipeItem[],
): boolean {
  const outputItems = resolveOutputItems(plan, inputItems);
  for (const outputItem of outputItems) {
    let remainingAmount = outputItem.amount;
    while (remainingAmount > 0) {
      const target = findOutputTarget(topology, slots, plan, outputItem.itemType);
      if (target === null) {
        return false;
      }

      const amount = Math.min(target.availableAmount, remainingAmount);
      const targetSlot = slots[target.slotId];
      if (targetSlot === undefined) {
        return false;
      }
      targetSlot.itemType = outputItem.itemType;
      targetSlot.count += amount;
      remainingAmount -= amount;
    }
  }

  return true;
}

function resolveOutputItems(
  plan: CompiledSimulationRecipePlan,
  inputItems: readonly RuntimeRecipeItem[],
): RuntimeRecipeItem[] {
  const outputItems: RuntimeRecipeItem[] = [];
  for (const output of plan.outputs) {
    const itemType = output.itemId === "same-as-input"
      ? inputItems[0]?.itemType ?? null
      : output.itemId;
    if (itemType === null || itemType === "any") {
      continue;
    }
    outputItems.push({
      itemType,
      amount: output.amount,
    });
  }
  return outputItems;
}

function findOutputTarget(
  topology: CompiledSimulationTopology,
  slots: Record<string, RuntimeSlotState>,
  plan: CompiledSimulationRecipePlan,
  itemType: string,
): {
  readonly slotId: string;
  readonly availableAmount: number;
} | null {
  const sameItemTarget = findOutputTargetByMode(topology, slots, plan, itemType, "same-item");
  if (sameItemTarget !== null) {
    return sameItemTarget;
  }
  return findOutputTargetByMode(topology, slots, plan, itemType, "empty");
}

function findOutputTargetByMode(
  topology: CompiledSimulationTopology,
  slots: Record<string, RuntimeSlotState>,
  plan: CompiledSimulationRecipePlan,
  itemType: string,
  mode: "same-item" | "empty",
): {
  readonly slotId: string;
  readonly availableAmount: number;
} | null {
  for (const cacheGroupId of plan.productCacheGroupIds) {
    const cacheGroup = topology.cacheGroups[cacheGroupId];
    if (cacheGroup === undefined) {
      continue;
    }

    for (const slotId of cacheGroup.slotIds) {
      const storageSlotId = resolveStorageSlotIdFromSlots(topology, slotId);
      const slot = topology.slots[storageSlotId] ?? topology.slots[slotId];
      const slotState = slots[storageSlotId];
      if (slot === undefined || slotState === undefined || !slotCanHold(topology, slot, itemType)) {
        continue;
      }

      if (mode === "same-item" && slotState.itemType !== itemType) {
        continue;
      }
      if (mode === "empty" && slotState.count > 0) {
        continue;
      }
      if (mode === "empty" && slot.lock !== null && slot.lock !== itemType) {
        continue;
      }

      const availableAmount = Math.max(0, slot.capacity - slotState.count);
      if (availableAmount > 0) {
        return { slotId: storageSlotId, availableAmount };
      }
    }
  }

  return null;
}

function resolveStorageSlotId(
  state: SimulationMutableRuntimeState,
  slotId: string,
): string {
  return state.persistent.proxyTargetSlotIdBySourceSlotId[slotId] ?? slotId;
}

function resolveStorageSlotIdFromSlots(
  topology: CompiledSimulationTopology,
  slotId: string,
): string {
  for (const link of Object.values(topology.links)) {
    const targetSlotId = link.targetSlotIdBySourceSlotId[slotId];
    if (targetSlotId !== undefined) {
      return targetSlotId;
    }
  }
  return slotId;
}

function slotCanHold(
  topology: CompiledSimulationTopology,
  slot: CompiledSimulationSlotTemplate,
  itemType: string,
): boolean {
  if (slot.lock !== null && slot.lock !== itemType) {
    return false;
  }
  if (slot.domain === "any") {
    return true;
  }
  return getItemDomain(topology, itemType) === slot.domain;
}

function aggregateInputItems(
  selections: readonly RuntimeReservedItem[],
): RuntimeRecipeItem[] {
  const amountByItemType = new Map<string, number>();
  for (const selection of selections) {
    amountByItemType.set(
      selection.itemType,
      (amountByItemType.get(selection.itemType) ?? 0) + selection.amount,
    );
  }
  return [...amountByItemType.entries()].map(([itemType, amount]) => ({ itemType, amount }));
}

function getReservedAmount(
  state: SimulationMutableRuntimeState,
  slotId: string,
): number {
  let reservedAmount = 0;
  for (const deviceState of Object.values(state.persistent.devices)) {
    const recipe = deviceState.recipe;
    if (recipe === null) {
      continue;
    }
    for (const reservation of recipe.reservations) {
      if (reservation.slotId === slotId) {
        reservedAmount += reservation.amount;
      }
    }
  }
  return reservedAmount;
}

function cloneSlotStates(
  slots: Record<string, RuntimeSlotState>,
): Record<string, RuntimeSlotState> {
  const clonedSlots: Record<string, RuntimeSlotState> = {};
  for (const [slotId, slot] of Object.entries(slots)) {
    clonedSlots[slotId] = {
      itemType: slot.itemType,
      count: slot.count,
    };
  }
  return clonedSlots;
}

function getItemDomain(
  topology: CompiledSimulationTopology,
  itemType: string,
): SimulationItemDomain {
  const item = topology.itemCatalog[itemType];
  if (item !== undefined) {
    return item.domain;
  }
  return itemType.includes("_liquid") || itemType.startsWith("liquid_")
    ? "liquid"
    : "solid";
}