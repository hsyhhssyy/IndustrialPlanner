import type { CompiledSimulationTopology } from "@/domain/types/simulation";

import type { SimulationMutableRuntimeState } from "./runtime-state";

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
      deviceState.recipe.state = "waiting-output";
    }
  }
}