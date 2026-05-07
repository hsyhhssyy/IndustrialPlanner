import type {
  CompiledSimulationDevice,
  CompiledSimulationTopology,
} from "../types";
import type { RuntimeDeviceRecipeState, SimulationMutableRuntimeState } from "./runtime-state";
import {
  aggregateInputItems,
  finishRecipeIfPossible,
  resolveDeviceRecipePlans,
  selectRecipeInputs,
} from "./runtime-slot-access";

/**
 * 对应《仿真运行原理》§5.5 Tick 阶段 5 二次结算，以及 §4 设备与配方状态。
 * 阶段职责：先让 waiting-output 的配方再次尝试落产物，然后为空闲设备按计划启动一轮配方。
 * instant 配方在结算阶段直接消耗输入并尝试输出；reserved-item 配方只预留输入，完成时再扣除。
 */
export function settleRecipes(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  settleWaitingOutputs(topology, state);
  startIdleDevices(topology, state);
}

function settleWaitingOutputs(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  for (const deviceId of topology.ordering.deviceOrder) {
    const deviceState = state.persistent.devices[deviceId];
    const recipe = deviceState?.recipe;
    if (deviceState === undefined || recipe?.state !== "waiting-output") {
      continue;
    }

    if (finishRecipeIfPossible(topology, state, recipe)) {
      deviceState.recipe = null;
      deviceState.block = false;
    }
  }
}

function startIdleDevices(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    const deviceState = state.persistent.devices[deviceId];
    if (device === undefined || deviceState === undefined || deviceState.recipe !== null) {
      continue;
    }

    const recipe = selectStartableRecipe(topology, state, device);
    if (recipe === null) {
      deviceState.block = true;
      continue;
    }

    if (recipe.recipeType === "immediate-consume") {
      if (finishInstantRecipe(topology, state, recipe)) {
        deviceState.block = false;
      } else {
        deviceState.block = true;
      }
      continue;
    }

    deviceState.recipe = recipe;
    deviceState.block = false;
  }
}

function selectStartableRecipe(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  device: CompiledSimulationDevice,
): RuntimeDeviceRecipeState | null {
  for (const plan of resolveDeviceRecipePlans({ topology, state, device })) {
    const reservations = selectRecipeInputs({ topology, state, plan });
    if (reservations === null) {
      continue;
    }

    const runId = `recipe-run:${state.persistent.nextRecipeRunIndex}`;
    state.persistent.nextRecipeRunIndex += 1;
    return {
      runId,
      recipeId: plan.recipeId,
      recipeType: plan.recipeType,
      progressTicks: 0,
      durationTicks: plan.durationTicks,
      state: plan.recipeType === "immediate-consume" ? "waiting-output" : "running",
      plan,
      reservations,
      inputItems: aggregateInputItems(reservations),
    };
  }

  return null;
}

function finishInstantRecipe(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  recipe: RuntimeDeviceRecipeState,
): boolean {
  const syntheticRecipe: RuntimeDeviceRecipeState = {
    ...recipe,
    runId: recipe.runId,
    recipeId: recipe.plan.recipeId,
    recipeType: "immediate-consume",
    progressTicks: recipe.plan.durationTicks,
    durationTicks: recipe.plan.durationTicks,
    state: "waiting-output",
    inputItems: aggregateInputItems(recipe.reservations),
  };
  return finishRecipeIfPossible(topology, state, syntheticRecipe);
}
