import type {
  CompiledSimulationDevice,
  CompiledSimulationRecipeChannel,
  CompiledSimulationTopology,
} from "../types";
import type { RuntimeDeviceRecipeState, SimulationMutableRuntimeState } from "./runtime-state";
import {
  aggregateInputItems,
  consumeSelections,
  finishRecipeIfPossible,
  resolveDeviceRecipePlans,
  selectRecipeInputs,
} from "./runtime-slot-access";

/**
 * 对应《仿真运行原理》§5.5 Tick 阶段 5 二次结算，以及 §4 设备与配方状态。
 * 阶段职责：先让 waiting-output 的配方再次尝试落产物，然后为空闲设备按计划启动一轮配方。
 * instant 配方在结算阶段直接消耗输入并尝试输出；reserved-item 配方只预留输入，完成时再扣除。
 */
/** AI-CORRECTION 2026-05-12: immediate-consume 与 reserved-item 都会在启动后进入 running，并按 durationTicks 累积进度；前者只是在启动时立即扣除输入，不会在同一 tick 直接完成。 */
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
    if (deviceState === undefined) {
      continue;
    }

    for (const [chId, recipe] of Object.entries(deviceState.channelRecipes)) {
      if (recipe === null || recipe.state !== "waiting-output") {
        continue;
      }

      if (finishRecipeIfPossible(topology, state, recipe)) {
        deviceState.channelRecipes[chId] = null;
        deviceState.block = false;
      }
    }
  }
}

// AI-CORRECTION 2026-05-13: 空闲设备启动遍历每个 channel。
function startIdleDevices(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    const deviceState = state.persistent.devices[deviceId];
    if (device === undefined || deviceState === undefined) {
      continue;
    }
    if (device.powerStatus === "out-of-power-range") {
      continue;
    }

    for (const channel of (device.recipeChannels ?? [])) {
      // Skip channels already running a recipe
      if (deviceState.channelRecipes[channel.id] !== undefined && deviceState.channelRecipes[channel.id] !== null) {
        continue;
      }

      const recipe = selectStartableRecipe(topology, state, device, channel);
      if (recipe === null) {
        continue;
      }

      if (recipe.recipeType === "immediate-consume") {
        consumeSelections(state.persistent.slots, recipe.reservations);
        recipe.reservations = [];
      }

      deviceState.channelRecipes[channel.id] = recipe;
    }
    
    // Block if any channel is stuck
    const hasRunning = Object.values(deviceState.channelRecipes).some(r => r !== null);
    deviceState.block = !hasRunning;
  }
}

// AI-CORRECTION 2026-05-13: selectStartableRecipe 现在接受 channel 参数。
function selectStartableRecipe(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  device: CompiledSimulationDevice,
  channel: CompiledSimulationRecipeChannel,
): RuntimeDeviceRecipeState | null {
  for (const plan of resolveDeviceRecipePlans({
    topology,
    state,
    device,
    channel,
  })) {
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
      state: "running",
      plan,
      reservations,
      inputItems: aggregateInputItems(reservations),
    };
  }

  return null;
}

// AI-REMOVED 2026-05-12:
// Reason: immediate-consume 配方不应在启动 tick 直接完成，而应在启动时扣料后进入正常 running 生命周期。
// Trigger: 仿真中生产配方瞬间完成，忽略了 durationTicks；设计文档已明确两类配方都必须逐 tick 推进。
// Evidence: stage-5 旧逻辑对 immediate-consume 直接调用 finishInstantRecipe，绕过了 stage-1 的 progressTicks 累积。
// Replacement: /home/coder/IndustrialPlanner/src/simulation/runtime/stage-5-settle-recipes.ts 中的 startIdleDevices immediate-consume 启动分支
// Risk: Low
// Human Review: Required
//
// Original code:
// function finishInstantRecipe(
//   topology: CompiledSimulationTopology,
//   state: SimulationMutableRuntimeState,
//   recipe: RuntimeDeviceRecipeState,
// ): boolean {
//   const syntheticRecipe: RuntimeDeviceRecipeState = {
//     ...recipe,
//     runId: recipe.runId,
//     recipeId: recipe.plan.recipeId,
//     recipeType: "immediate-consume",
//     progressTicks: recipe.plan.durationTicks,
//     durationTicks: recipe.plan.durationTicks,
//     state: "waiting-output",
//     inputItems: aggregateInputItems(recipe.reservations),
//   };
//   return finishRecipeIfPossible(topology, state, syntheticRecipe);
// }
