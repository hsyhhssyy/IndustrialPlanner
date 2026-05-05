import type {
  CompiledSimulationDevice,
  CompiledSimulationRecipeItem,
  CompiledSimulationRecipePlan,
  CompiledSimulationTopology,
} from "@/domain/types/simulation";

import type {
  RuntimeDeviceRecipeState,
  RuntimeRecipeItem,
  RuntimeReservedItem,
  RuntimeSlotState,
  SimulationMutableRuntimeState,
} from "./runtime-state";
import { placeRecipeOutputs } from "./place-recipe-outputs";

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

  if (!placeRecipeOutputs(topology, simulatedSlots, recipe.plan, recipe.inputItems)) {
    return false;
  }

  if (recipe.recipeType === "reserved-item") {
    consumeSelections(state, recipe.reservations);
  }
  placeRecipeOutputs(topology, state.persistent.slots, recipe.plan, recipe.inputItems);
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

    return {
      plan,
      selections,
      inputItems: aggregateInputItems(selections),
    };
  }

  return null;
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

function resolveStorageSlotId(
  state: SimulationMutableRuntimeState,
  slotId: string,
): string {
  return state.persistent.proxyTargetSlotIdBySourceSlotId[slotId] ?? slotId;
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