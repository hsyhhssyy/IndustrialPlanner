import type {
  CompiledSimulationDevice,
  CompiledSimulationRecipeChannel,
  CompiledSimulationTopology,
} from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import type {
  RuntimeDeviceRecipeState,
  RuntimeDeviceState,
} from "./runtime-state";
import {
  adjustReservedAmounts,
  consumeSelections,
  createStartableRecipeForChannel,
  finishRecipeIfPossible,
} from "./runtime-slot-access";
import { isDeviceInRequiredGasDiffusion } from "./gas-diffusion";
import { submitSlotsToWarehouse } from "./warehouse-submit";
import { isMeteredConsumptionAuthorized } from "./metered-consumption";
/**
 * 对应《仿真运行原理》§5.1 Tick 阶段 1：推进设备内部状态。
 * 该阶段只处理已经启动的配方：累计进度，完成后尝试把产物写入输出缓存；
 * 输出缓存不足时保持 waiting-output，等待本 tick 后续输送或二次结算释放空间。
 */
// AI-CORRECTION 2026-05-13: 推进阶段遍历每个设备的所有 channel recipe。
export function advanceDevices(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  standardStepTicks = 1,
  powerMode: "real" | "infinite" = "infinite",
  currentPowerGeneration = Infinity,
  effectiveTotalPowerDemand = topology.totalPowerDemand,
): void {
  const progressTicks = Math.max(1, Math.trunc(standardStepTicks));
  const powerInsufficient = powerMode === "real"
    && currentPowerGeneration < effectiveTotalPowerDemand;

  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    const deviceState = state.persistent.devices[deviceId];
    if (device === undefined || deviceState === undefined) {
      continue;
    }
    if (device.powerStatus === "out-of-power-range") {
      continue;
    }
    // 真实电力模式下发电不足 → 所有 requiresPower 设备冻结
    if (powerInsufficient && device.requiresPower) {
      continue;
    }
    if (!isMeteredConsumptionAuthorized(device, state)) {
      continue;
    }

    for (const [chId, recipe] of Object.entries(deviceState.channelRecipes)) {
      if (recipe === null) {
        continue;
      }
      if (!isDeviceInRequiredGasDiffusion({
        topology,
        state,
        device,
        requiredGasDiffusion: recipe.plan.requiredGasDiffusion,
      })) {
        continue;
      }

      const channel = device.recipeChannels.find((candidate) => candidate.id === chId) ?? null;
      deviceState.channelRecipes[chId] = advanceChannelRecipe({
        topology,
        state,
        device,
        deviceState,
        channel,
        recipe,
        progressTicks,
      });
    }
  }
}

function advanceChannelRecipe(options: {
  readonly topology: CompiledSimulationTopology;
  readonly state: SimulationMutableRuntimeState;
  readonly device: CompiledSimulationDevice;
  readonly deviceState: RuntimeDeviceState;
  readonly channel: CompiledSimulationRecipeChannel | null;
  readonly recipe: RuntimeDeviceRecipeState;
  readonly progressTicks: number;
}): RuntimeDeviceRecipeState | null {
  let recipe = options.recipe;

  if (recipe.state === "running") {
    recipe.progressTicks += options.progressTicks;
    if (recipe.progressTicks < recipe.durationTicks) {
      return recipe;
    }
    recipe.state = "waiting-output";
  }

  while (recipe.progressTicks >= recipe.durationTicks) {
    const finished = finishRecipeIfPossible(options.topology, options.state, recipe);
    if (!finished) {
      recipe.progressTicks = recipe.durationTicks;
      recipe.state = "waiting-output";
      options.deviceState.block = true;
      return recipe;
    }

    // 仓库提交配方完成 → 将本地物品提交到仓库
    if (recipe.plan.recipeId === "r_warehouse_submit") {
      submitSlotsToWarehouse(options.topology, options.state, options.device.id);
    }

    const overflowTicks = recipe.progressTicks - recipe.durationTicks;
    options.deviceState.block = false;

    if (options.channel === null) {
      return null;
    }

    const nextRecipe = createStartableRecipeForChannel({
      topology: options.topology,
      state: options.state,
      device: options.device,
      channel: options.channel,
    });
    if (nextRecipe === null) {
      return null;
    }

    if (nextRecipe.recipeType === "immediate-consume") {
      consumeSelections(options.state.persistent.slots, nextRecipe.reservations);
      nextRecipe.reservations = [];
    } else {
      adjustReservedAmounts(options.state, nextRecipe.reservations, 1);
    }

    nextRecipe.progressTicks = overflowTicks;
    recipe = nextRecipe;
    if (recipe.progressTicks < recipe.durationTicks) {
      return recipe;
    }
    recipe.state = "waiting-output";
  }

  return recipe;
}
