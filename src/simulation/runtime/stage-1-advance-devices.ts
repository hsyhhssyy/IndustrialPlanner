import type {
  CompiledSimulationDevice,
  CompiledSimulationTopology,
  RegionalWarehouseWriteContext,
} from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import type {
  RuntimeDeviceRecipeState,
  RuntimeDeviceState,
} from "./runtime-state";
import { completeRecipeIfPossible } from "./recipe-completion";
import { isDeviceInRequiredGasDiffusion } from "./gas-diffusion";
import { isDeviceConsumptionAuthorizedForFrame } from "./consumption-channel";
import type { RegistryContract } from "@/domain/registry/registry-contract";

// AI-REMOVED 2026-07-23:
// Reason: Stage1 只推进并完成旧配方，不再选择、启动或预定下一配方。
// Trigger: 用户要求所有新配方统一在 Stage5 基于 Stage3 后库存选择，并由 Stage5 处理粗步长溢出。
// Evidence: .docs/common/模拟器/仿真运行原理.md v5 §5.1、§5.2、§10.1。
// Replacement: completeRecipeIfPossible；新配方启动与预定见 stage-5-settle-recipes.ts。
// Risk: Medium - Stage1 必须把成功完成后的 overflowTicks 显式交给 Stage5。
// Human Review: Required
//
// Original code:
// import type { CompiledSimulationRecipeChannel } from "../types";
// import {
//   adjustReservedAmounts,
//   consumeSelections,
//   createStartableRecipeForChannel,
//   finishRecipeIfPossible,
// } from "./runtime-slot-access";
// import { submitSlotsToWarehouse } from "./warehouse-submit";

export interface Stage1AdvanceResult {
  readonly overflowTicksByDeviceChannel: Readonly<
    Record<string, Readonly<Record<string, number>>>
  >;
}

interface AdvanceChannelRecipeResult {
  readonly recipe: RuntimeDeviceRecipeState | null;
  readonly overflowTicks: number;
}
/**
 * 对应《仿真运行原理》§5.1 Tick 阶段 1：推进设备内部状态。
 * 该阶段只处理已经启动的配方：累计进度，完成后尝试把产物写入输出缓存；
 * 输出缓存不足时保持 waiting-output，等待本 tick 后续输送或二次结算释放空间。
 */
// AI-CORRECTION 2026-05-13: 推进阶段遍历每个设备的所有 channel recipe。
export function advanceDevices(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  standardStepTicks = 1,
  powerMode: "real" | "infinite" = "infinite",
  currentPowerGeneration = Infinity,
  effectiveTotalPowerDemand = topology.totalPowerDemand,
  regionalWarehouse?: RegionalWarehouseWriteContext,
): Stage1AdvanceResult {
  const progressTicks = Math.max(1, Math.trunc(standardStepTicks));
  const powerInsufficient = powerMode === "real"
    && currentPowerGeneration < effectiveTotalPowerDemand;
  const overflowTicksByDeviceChannel: Record<string, Record<string, number>> = {};

  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    const deviceState = state.persistent.devices[deviceId];
    if (device === undefined || deviceState === undefined) {
      continue;
    }
    const hasDevicePower = device.powerStatus !== "out-of-power-range"
      && !(powerInsufficient && device.requiresPower);
    const consumptionAuthorized = isDeviceConsumptionAuthorizedForFrame(device, state);

    for (const channel of device.recipeChannels) {
      const chId = channel.id;
      const recipe = deviceState.channelRecipes[chId] ?? null;
      if (recipe === null) {
        continue;
      }

      if (recipe.state === "running" && channel.type !== "consumption-channel") {
        if (!hasDevicePower || !consumptionAuthorized) {
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
      }

      const result = advanceChannelRecipe({
        registry,
        topology,
        state,
        device,
        deviceState,
        recipe,
        progressTicks,
        regionalWarehouse,
      });
      deviceState.channelRecipes[chId] = result.recipe;
      if (result.overflowTicks > 0) {
        const deviceOverflow = overflowTicksByDeviceChannel[deviceId] ?? {};
        deviceOverflow[chId] = result.overflowTicks;
        overflowTicksByDeviceChannel[deviceId] = deviceOverflow;
      }
    }
  }

  return { overflowTicksByDeviceChannel };
}

function advanceChannelRecipe(options: {
  readonly registry: RegistryContract;
  readonly topology: CompiledSimulationTopology;
  readonly state: SimulationMutableRuntimeState;
  readonly device: CompiledSimulationDevice;
  readonly deviceState: RuntimeDeviceState;
  readonly recipe: RuntimeDeviceRecipeState;
  readonly progressTicks: number;
  readonly regionalWarehouse?: RegionalWarehouseWriteContext;
}): AdvanceChannelRecipeResult {
  const recipe = options.recipe;

  if (recipe.state === "running") {
    recipe.progressTicks += options.progressTicks;
    if (recipe.progressTicks < recipe.durationTicks) {
      return { recipe, overflowTicks: 0 };
    }
    recipe.state = "waiting-output";
  }

  const overflowTicks = Math.max(0, recipe.progressTicks - recipe.durationTicks);
  if (!completeRecipeIfPossible({
    registry: options.registry,
    topology: options.topology,
    state: options.state,
    deviceId: options.device.id,
    recipe,
    regionalWarehouse: options.regionalWarehouse,
  })) {
    recipe.progressTicks = recipe.durationTicks;
    recipe.state = "waiting-output";
    options.deviceState.block = true;
    return { recipe, overflowTicks: 0 };
  }

  options.deviceState.block = false;
  return { recipe: null, overflowTicks };
}

// AI-REMOVED 2026-07-23:
// Reason: Stage1 链式启动会在 Stage3 前抢占或消耗原料，使 Stage5 看不到物流结算后的完整候选集，并可能让低产量配方永久抢占高产量配方。
// Trigger: 用户要求 Stage1 只保存溢出进度，所有新配方延后到 Stage5 统一选择。
// Evidence: 旧 advanceChannelRecipe 在完成旧 run 后立即调用 createStartableRecipeForChannel，并把 overflowTicks 直接写入 nextRecipe。
// Replacement: advanceChannelRecipe 返回 overflowTicks；stage-5-settle-recipes.ts 消费该交接结果。
// Risk: Medium - 动态粗步长仍是单次 Stage3 的吞吐近似，文档 v5 §5.2 已明确。
// Human Review: Required
//
// Original code:
// while (recipe.progressTicks >= recipe.durationTicks) {
//   const finished = finishRecipeIfPossible(options.topology, options.state, recipe);
//   if (!finished) {
//     recipe.progressTicks = recipe.durationTicks;
//     recipe.state = "waiting-output";
//     options.deviceState.block = true;
//     return recipe;
//   }
//
//   if (recipe.plan.recipeId === "r_warehouse_submit") {
//     submitSlotsToWarehouse(options.topology, options.state, options.device.id);
//   }
//
//   const overflowTicks = recipe.progressTicks - recipe.durationTicks;
//   options.deviceState.block = false;
//
//   if (options.channel === null) {
//     return null;
//   }
//
//   const nextRecipe = createStartableRecipeForChannel({
//     topology: options.topology,
//     state: options.state,
//     device: options.device,
//     channel: options.channel,
//   });
//   if (nextRecipe === null) {
//     return null;
//   }
//
//   if (nextRecipe.recipeType === "immediate-consume") {
//     consumeSelections(options.state.persistent.slots, nextRecipe.reservations);
//     if (options.device.isProducer) {
//       const delta = options.state.transient.recipeStatsDelta;
//       for (const input of nextRecipe.inputItems) {
//         delta.consumed[input.itemType] = (delta.consumed[input.itemType] ?? 0) + input.amount;
//       }
//     }
//     nextRecipe.reservations = [];
//   } else {
//     adjustReservedAmounts(options.state, nextRecipe.reservations, 1);
//   }
//
//   nextRecipe.progressTicks = overflowTicks;
//   recipe = nextRecipe;
//   if (recipe.progressTicks < recipe.durationTicks) {
//     return recipe;
//   }
//   recipe.state = "waiting-output";
// }
