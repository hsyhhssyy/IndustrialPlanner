import type { CompiledSimulationTopology } from "@/domain/types/simulation";

import type {
  RuntimeReservedItem,
  RuntimeSlotState,
  SimulationMutableRuntimeState,
} from "./runtime-state";
import { placeRecipeOutputs } from "./place-recipe-outputs";

export function advanceDevices(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  for (const deviceId of topology.ordering.deviceOrder) {
    const deviceState = state.persistent.devices[deviceId];
    if (deviceState?.recipe === undefined || deviceState.recipe === null) {
      continue;
    }

    if (deviceState.recipe.state !== "running") {
      continue;
    }

    deviceState.recipe.progressTicks = Math.min(
      deviceState.recipe.durationTicks,
      deviceState.recipe.progressTicks + 1,
    );
    if (deviceState.recipe.progressTicks >= deviceState.recipe.durationTicks) {
      const completedRecipe = deviceState.recipe;
      const placedOutputs = placeRecipeOutputs(
        topology,
        state.persistent.slots,
        completedRecipe.plan,
        completedRecipe.inputItems,
      );

      if (completedRecipe.recipeType === "immediate-consume" && placedOutputs) {
        deviceState.recipe = null;
        deviceState.block = false;
        continue;
      }

      if (completedRecipe.recipeType === "reserved-item" && placedOutputs) {
        consumeReservedItems(state.persistent.slots, completedRecipe.reservations);
        deviceState.recipe = null;
        deviceState.block = false;
        continue;
      }

      deviceState.recipe.state = "waiting-output";
    }
  }
}

function consumeReservedItems(
  slots: Record<string, RuntimeSlotState>,
  reservations: readonly RuntimeReservedItem[],
): void {
  for (const reservation of reservations) {
    const slotState = slots[reservation.slotId];
    if (slotState === undefined) {
      continue;
    }

    slotState.count = Math.max(0, slotState.count - reservation.amount);
    if (slotState.itemType === null) {
      slotState.itemType = reservation.itemType;
    }
  }
}