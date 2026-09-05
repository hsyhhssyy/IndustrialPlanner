import type {
  SimulationDeviceRuntimeChannelRecipeStatus,
  SimulationDocumentRuntimeReadModel,
  SimulationState,
} from "@/domain/simulation/types/simulation-types";

export interface SimulationRecipeProgressPresentationInput {
  readonly channelStatus: SimulationDeviceRuntimeChannelRecipeStatus | null;
  readonly documentStatus: SimulationDocumentRuntimeReadModel | null;
  readonly simulationState: SimulationState | null;
  readonly elapsedWallSeconds: number;
}

export function resolvePresentedRecipeProgressSeconds(
  input: SimulationRecipeProgressPresentationInput,
): number | null {
  const { channelStatus, documentStatus, simulationState } = input;
  if (
    channelStatus === null
    || channelStatus.progressSeconds === null
    || channelStatus.desiredSeconds === null
  ) {
    return null;
  }

  const authorityProgress = Math.min(
    Math.max(0, channelStatus.progressSeconds),
    Math.max(0, channelStatus.desiredSeconds),
  );
  if (
    !channelStatus.isProgressing
    || documentStatus === null
    || simulationState === null
    || simulationState.runningState !== "start"
    || simulationState.timeline.isSeeking
    || !Number.isFinite(documentStatus.tickRate)
    || documentStatus.tickRate <= 0
  ) {
    return authorityProgress;
  }

  const phase = Math.min(
    1,
    Math.max(
      0,
      input.elapsedWallSeconds
        * simulationState.simulationSpeed
        * documentStatus.tickRate,
    ),
  );
  return Math.min(
    authorityProgress + phase / documentStatus.tickRate,
    channelStatus.desiredSeconds,
  );
}
