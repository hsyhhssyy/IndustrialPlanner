import type {
  CompiledSimulationDevice,
  CompiledSimulationRecipeChannel,
  CompiledSimulationTopology,
} from "../types";
import type { RuntimeDeviceRecipeState, SimulationMutableRuntimeState } from "./runtime-state";
import { incrementFixedWindowCounterForCurrentWindow } from "./runtime-state";
import {
  adjustReservedAmounts,
  aggregateInputItems,
  consumeSelections,
  resolveDeviceRecipePlans,
  selectRecipeInputs,
} from "./runtime-slot-access";
import {
  computeActiveGasDiffusions,
  getGasDiffusionRecipeSourceDeviceIds,
  isDeviceInRequiredGasDiffusion,
} from "./gas-diffusion";
import { isMeteredConsumptionAuthorized } from "./metered-consumption";
import { completeRecipeIfPossible } from "./recipe-completion";
import { canDeviceTransferAtCurrentPhase } from "./phase-gating";
import type { Stage1AdvanceResult } from "./stage-1-advance-devices";

// AI-REMOVED 2026-07-23:
// Reason: Stage5 必须通过统一配方完成入口执行仓库提交等副作用，不能只完成槽位事务。
// Trigger: Stage5 新增溢出完成路径后，直接调用 finishRecipeIfPossible 会遗漏 r_warehouse_submit。
// Evidence: .docs/common/模拟器/仿真运行原理.md v5 §5.1、§10.1、§13。
// Replacement: completeRecipeIfPossible。
// Risk: Low
// Human Review: Required
//
// Original code:
// import { finishRecipeIfPossible } from "./runtime-slot-access";

/**
 * 对应《仿真运行原理》§5.5 Tick 阶段 5 二次结算，以及 §4 设备与配方状态。
 * 阶段职责：先让 waiting-output 的配方再次尝试落产物，然后为空闲设备按计划启动一轮配方。
 * AI-CORRECTION 2026-07-23: Stage5 会消费 Stage1 成功完成后交接的 overflowTicks，
 *   每次完成后重新选择配方；剩余不足一轮时启动最后一轮并写入非零进度。
 * instant 配方在结算阶段直接消耗输入并尝试输出；reserved-item 配方只预留输入，完成时再扣除。
 */
/** AI-CORRECTION 2026-05-12: immediate-consume 与 reserved-item 都会在启动后进入 running，并按 durationTicks 累积进度；前者只是在启动时立即扣除输入，不会在同一 tick 直接完成。 */
export function settleRecipes(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  powerMode: "real" | "infinite" = "infinite",
  currentPowerGeneration = Infinity,
  effectiveTotalPowerDemand = topology.totalPowerDemand,
  stage1AdvanceResult?: Stage1AdvanceResult,
): void {
  const remainingOverflowTicksByDeviceChannel = cloneOverflowTicks(
    stage1AdvanceResult?.overflowTicksByDeviceChannel,
  );
  state.transient.activeGasDiffusions = computeActiveGasDiffusions(topology, state);
  settleWaitingOutputs(topology, state);
  startIdleDevices(
    topology,
    state,
    powerMode,
    currentPowerGeneration,
    effectiveTotalPowerDemand,
    remainingOverflowTicksByDeviceChannel,
  );
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
      const device = topology.devices[deviceId];
      if (
        device !== undefined
        && !isDeviceInRequiredGasDiffusion({
          topology,
          state,
          device,
          requiredGasDiffusion: recipe.plan.requiredGasDiffusion,
        })
      ) {
        continue;
      }

      if (completeRecipeIfPossible({
        topology,
        state,
        deviceId,
        recipe,
      })) {
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
  powerMode: "real" | "infinite" = "infinite",
  currentPowerGeneration = Infinity,
  effectiveTotalPowerDemand = topology.totalPowerDemand,
  remainingOverflowTicksByDeviceChannel: Record<string, Record<string, number>> = {},
): void {
  const gasDiffusionRecipeSourceDeviceIds = getGasDiffusionRecipeSourceDeviceIds(topology);
  if (gasDiffusionRecipeSourceDeviceIds.length > 0) {
    startIdleDeviceChannels({
      topology,
      state,
      powerMode,
      currentPowerGeneration,
      effectiveTotalPowerDemand,
      deviceIds: gasDiffusionRecipeSourceDeviceIds,
      shouldStartPlan: (plan) => plan.gasDiffusionOutput !== null,
      remainingOverflowTicksByDeviceChannel,
      discardOverflowWhenNoRecipe: false,
    });
    state.transient.activeGasDiffusions = computeActiveGasDiffusions(topology, state);
  }
  startIdleDeviceChannels({
    topology,
    state,
    powerMode,
    currentPowerGeneration,
    effectiveTotalPowerDemand,
    shouldStartPlan: () => true,
    remainingOverflowTicksByDeviceChannel,
    discardOverflowWhenNoRecipe: true,
  });
}

function startIdleDeviceChannels(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  powerMode: "real" | "infinite";
  currentPowerGeneration: number;
  effectiveTotalPowerDemand: number;
  deviceIds?: readonly string[];
  shouldStartPlan: (plan: RuntimeDeviceRecipeState["plan"]) => boolean;
  remainingOverflowTicksByDeviceChannel: Record<string, Record<string, number>>;
  discardOverflowWhenNoRecipe: boolean;
}): void {
  const powerInsufficient = options.powerMode === "real"
    && options.currentPowerGeneration < options.effectiveTotalPowerDemand;

  for (const deviceId of options.deviceIds ?? options.topology.ordering.deviceOrder) {
    const device = options.topology.devices[deviceId];
    const deviceState = options.state.persistent.devices[deviceId];
    if (device === undefined || deviceState === undefined) {
      continue;
    }
    if (device.powerStatus === "out-of-power-range") {
      continue;
    }
    // 真实电力模式下发电不足 → 所有 requiresPower 设备不启动新配方
    if (powerInsufficient && device.requiresPower) {
      continue;
    }
    if (!isMeteredConsumptionAuthorized(device, options.state)) {
      continue;
    }
    if (!canDeviceTransferAtCurrentPhase(options.topology, options.state, device)) {
      continue;
    }

    for (const channel of (device.recipeChannels ?? [])) {
      // Skip channels already running a recipe
      if (deviceState.channelRecipes[channel.id] !== undefined && deviceState.channelRecipes[channel.id] !== null) {
        continue;
      }

      let remainingOverflowTicks =
        options.remainingOverflowTicksByDeviceChannel[deviceId]?.[channel.id] ?? 0;

      while (deviceState.channelRecipes[channel.id] === undefined
        || deviceState.channelRecipes[channel.id] === null) {
        const recipe = selectStartableRecipe(
          options.topology,
          options.state,
          device,
          channel,
          options.shouldStartPlan,
        );
        if (recipe === null) {
          if (options.discardOverflowWhenNoRecipe) {
            remainingOverflowTicks = 0;
          }
          break;
        }

        commitStartedRecipe(options.topology, options.state, device, recipe);
        deviceState.channelRecipes[channel.id] = recipe;

        if (remainingOverflowTicks < recipe.durationTicks) {
          recipe.progressTicks = remainingOverflowTicks;
          remainingOverflowTicks = 0;
          break;
        }

        recipe.progressTicks = recipe.durationTicks;
        recipe.state = "waiting-output";
        if (!completeRecipeIfPossible({
          topology: options.topology,
          state: options.state,
          deviceId,
          recipe,
        })) {
          remainingOverflowTicks = 0;
          deviceState.block = true;
          break;
        }

        remainingOverflowTicks -= recipe.durationTicks;
        deviceState.channelRecipes[channel.id] = null;
        deviceState.block = false;
      }

      const deviceOverflow = options.remainingOverflowTicksByDeviceChannel[deviceId];
      if (deviceOverflow !== undefined) {
        deviceOverflow[channel.id] = remainingOverflowTicks;
      }
    }
    
    // Block if any channel is stuck
    const hasWaitingOutput = Object.values(deviceState.channelRecipes)
      .some((recipe) => recipe?.state === "waiting-output");
    const hasRunningRecipe = Object.values(deviceState.channelRecipes)
      .some((recipe) => recipe?.state === "running");
    deviceState.block = hasWaitingOutput || !hasRunningRecipe;
  }
}

// AI-CORRECTION 2026-07-23: topology 参数因准入口速率额度需要在配方启动事务中提交而恢复使用。
function commitStartedRecipe(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  device: CompiledSimulationDevice,
  recipe: RuntimeDeviceRecipeState,
): void {
  if (recipe.recipeType === "immediate-consume") {
    consumeSelections(state.persistent.slots, recipe.reservations);
    // 记录 immediate-consume 配方的消耗统计（仅生产设备）
    if (device.isProducer) {
      const delta = state.transient.recipeStatsDelta;
      for (const input of recipe.inputItems) {
        delta.consumed[input.itemType] = (delta.consumed[input.itemType] ?? 0) + input.amount;
      }
    }
    recipe.reservations = [];
    return;
  }

  adjustReservedAmounts(state, recipe.reservations, 1);
  const admissionPortId = device.portIds.find((portId) =>
    topology.ports[portId]?.admissionRule?.perMinuteLimit !== null
    && topology.ports[portId]?.admissionRule?.perMinuteLimit !== undefined
  );
  if (admissionPortId !== undefined) {
    incrementFixedWindowCounterForCurrentWindow(
      topology,
      state,
      admissionPortId,
      recipe.inputItems.reduce((total, item) => total + item.amount, 0),
    );
  }
}

function cloneOverflowTicks(
  overflowTicksByDeviceChannel:
    | Stage1AdvanceResult["overflowTicksByDeviceChannel"]
    | undefined,
): Record<string, Record<string, number>> {
  if (overflowTicksByDeviceChannel === undefined) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(overflowTicksByDeviceChannel).map(([deviceId, channelOverflow]) => [
      deviceId,
      { ...channelOverflow },
    ]),
  );
}

// AI-REMOVED 2026-07-23:
// Reason: 旧实现只启动一轮 progress=0 配方，无法消费 Stage1 延迟交接的粗步长 overflowTicks。
// Trigger: 用户要求 Stage1 保存溢出，Stage5 基于 Stage3 后库存选择配方并循环处理溢出。
// Evidence: .docs/common/模拟器/仿真运行原理.md v5 §5.2、§10.1。
// Replacement: startIdleDeviceChannels 中的 remainingOverflowTicks while 循环与 commitStartedRecipe。
// Risk: Medium - 粗步长仍只执行一次 Stage3，属于文档明确接受的吞吐近似。
// Human Review: Required
//
// Original code:
// const recipe = selectStartableRecipe(
//   options.topology,
//   options.state,
//   device,
//   channel,
//   options.shouldStartPlan,
// );
// if (recipe === null) {
//   continue;
// }
//
// if (recipe.recipeType === "immediate-consume") {
//   consumeSelections(options.state.persistent.slots, recipe.reservations);
//   if (device.isProducer) {
//     const delta = options.state.transient.recipeStatsDelta;
//     for (const input of recipe.inputItems) {
//       delta.consumed[input.itemType] = (delta.consumed[input.itemType] ?? 0) + input.amount;
//     }
//   }
//   recipe.reservations = [];
// } else {
//   adjustReservedAmounts(options.state, recipe.reservations, 1);
// }
//
// deviceState.channelRecipes[channel.id] = recipe;

// AI-REMOVED 2026-07-23:
// Reason: block 应表示仍有 waiting-output 配方，而不是“当前没有任意运行配方”。
// Trigger: Stage5 溢出可让 running 配方带非零进度，设备是否阻塞必须直接读取 recipe.state。
// Evidence: .docs/common/模拟器/仿真运行原理.md v5 §10.2。
// Replacement: hasWaitingOutput。
// Risk: Low - 空闲且无原料的生产设备不再被误标记为 block。
// Human Review: Required
//
// Original code:
// const hasRunning = Object.values(deviceState.channelRecipes).some(r => r !== null);
// deviceState.block = !hasRunning;
// AI-CORRECTION 2026-07-23: 新逻辑同时保留“无运行配方即阻塞”的既有语义，并确保 waiting-output 不会被误判为正常运行。

// AI-REMOVED 2026-07-23:
// Reason: commitStartedRecipe 不读取 topology，保留该参数会触发未使用参数检查。
// Trigger: 抽取 Stage5 配方启动事务后复核函数签名。
// Evidence: 函数只操作 state、device 与 recipe。
// Replacement: commitStartedRecipe(state, device, recipe)。
// Risk: None
// Human Review: Required
//
// Original code:
// commitStartedRecipe(options.topology, options.state, device, recipe);
// function commitStartedRecipe(
//   topology: CompiledSimulationTopology,
//   state: SimulationMutableRuntimeState,
//   device: CompiledSimulationDevice,
//   recipe: RuntimeDeviceRecipeState,
// ): void {

// AI-CORRECTION 2026-05-13: selectStartableRecipe 现在接受 channel 参数。
function selectStartableRecipe(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  device: CompiledSimulationDevice,
  channel: CompiledSimulationRecipeChannel,
  shouldStartPlan: (plan: RuntimeDeviceRecipeState["plan"]) => boolean = () => true,
): RuntimeDeviceRecipeState | null {
  for (const plan of resolveDeviceRecipePlans({
    topology,
    state,
    device,
    channel,
  })) {
    if (!shouldStartPlan(plan)) {
      continue;
    }
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
