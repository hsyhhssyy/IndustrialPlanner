import type { CompiledSimulationTopology } from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import { finishRecipeIfPossible } from "./runtime-slot-access";

/**
 * 对应《仿真运行原理》§5.1 Tick 阶段 1：推进设备内部状态。
 * 该阶段只处理已经启动的配方：累计进度，完成后尝试把产物写入输出缓存；
 * 输出缓存不足时保持 waiting-output，等待本 tick 后续输送或二次结算释放空间。
 */
// AI-CORRECTION 2026-05-13: 推进阶段遍历每个设备的所有 channel recipe。
export function advanceDevices(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  for (const deviceId of topology.ordering.deviceOrder) {
    const deviceState = state.persistent.devices[deviceId];
    if (deviceState === undefined) {
      continue;
    }

    for (const [chId, recipe] of Object.entries(deviceState.channelRecipes)) {
      if (recipe === null) {
        continue;
      }

      if (recipe.state === "running") {
        recipe.progressTicks += 1;
        if (recipe.progressTicks < recipe.durationTicks) {
          continue;
        }
        recipe.state = "waiting-output";
      }

      if (recipe.state === "waiting-output") {
        const finished = finishRecipeIfPossible(topology, state, recipe);
        if (finished) {
          deviceState.channelRecipes[chId] = null;
          deviceState.block = false;
        } else {
          deviceState.block = true;
        }
      }
    }
  }
}
