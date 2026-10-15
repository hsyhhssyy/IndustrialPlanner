import type { DeviceStateDefinition } from "@/domain/registry/types/entity-definition";
import type {
  SimulationDeviceRuntimeChannelRecipeStatus,
  SimulationDeviceStateReadModel,
} from "@/domain/simulation/types/simulation-types";
import { resolvePresentedRecipeProgressSeconds } from "@/shared/simulation-recipe-progress";
import type { SimulationRecipePresentationClock } from "./use-simulation-recipe-presentation";

/** 与父层同次采样的时钟合成展示进度；不修改仿真状态，不越过下一真实 tick。 */
export function resolveDeviceStateProgressSeconds(
  state: DeviceStateDefinition,
  runtime: SimulationDeviceStateReadModel | undefined,
  channel: SimulationDeviceRuntimeChannelRecipeStatus | null,
  clock: SimulationRecipePresentationClock,
): number {
  if (runtime === undefined) return 0;
  if (runtime.timerStartedAtSeconds === null || runtime.endsAtSeconds === null) {
    return channel?.recipeId === state.enterRecipeId
      ? resolvePresentedRecipeProgressSeconds({ channelStatus: channel, ...clock }) ?? 0
      : 0;
  }
  const { documentStatus, simulationState } = clock;
  if (documentStatus?.tickNumber == null || documentStatus.standardTickRate <= 0) return 0;
  // tick 1 表示 t=0，状态 enteredAtSeconds / endsAtSeconds 使用同一时间原点。
  // AI-CORRECTION 2026-10-15: 分支状态继承 timerStartedAtSeconds；enteredAtSeconds 仅表示当前状态进入时间。
  const seconds = Math.max(0, documentStatus.tickNumber - 1) / documentStatus.standardTickRate;
  const delta = simulationState?.runningState === "start" && !simulationState.timeline.isSeeking
    && documentStatus.tickRate > 0
    ? Math.min(1 / documentStatus.tickRate, Math.max(0, clock.elapsedWallSeconds * simulationState.simulationSpeed))
    : 0;
  const duration = runtime.endsAtSeconds - runtime.timerStartedAtSeconds;
  return Math.min(Math.max(0, duration), Math.max(0, seconds + delta - runtime.timerStartedAtSeconds));
}
