import type {
  CompiledSimulationDevice,
  CompiledSimulationTopology,
} from "../types";
import type {
  RuntimeDeviceRecipeState,
  SimulationMutableRuntimeState,
} from "./runtime-state";

export interface TransportRecipeTiming {
  readonly durationTicks: number;
  readonly recipeIdSuffix: "dynamic-belt-transfer" | "dynamic-pipe-transfer";
}

export function isDedicatedLogisticsDevice(
  device: CompiledSimulationDevice,
): boolean {
  return device.transportClass === "strict-belt" || device.transportClass === "strict-pipe";
}

export function resolveTransportRecipeTiming(
  topology: CompiledSimulationTopology,
  device: CompiledSimulationDevice,
): TransportRecipeTiming | null {
  const isBelt = device.transportClass === "strict-belt" || (device.tags ?? []).includes("BeltFamily");
  const isPipe = device.transportClass === "strict-pipe" || (device.tags ?? []).includes("PipeFamily");

  if (!isBelt && !isPipe) {
    return null;
  }

  const durationSeconds = isBelt ? 2 : 0.5;
  return {
    durationTicks: Math.max(1, Math.round(durationSeconds * topology.standardTickRate)),
    recipeIdSuffix: isBelt ? "dynamic-belt-transfer" : "dynamic-pipe-transfer",
  };
}

export function resolveDedicatedLogisticsTransferUnitTicks(
  topology: CompiledSimulationTopology,
  device: CompiledSimulationDevice,
): number | null {
  if (!isDedicatedLogisticsDevice(device)) {
    return null;
  }

  const timing = resolveTransportRecipeTiming(topology, device);
  if (timing === null) {
    return null;
  }

  return Math.min(timing.durationTicks, topology.standardTickRate);
}

export function canDedicatedLogisticsTransferAtTick(options: {
  readonly topology: CompiledSimulationTopology;
  readonly device: CompiledSimulationDevice;
  readonly standardTick: number;
}): boolean {
  const transferUnitTicks = resolveDedicatedLogisticsTransferUnitTicks(options.topology, options.device);
  if (transferUnitTicks === null) {
    return true;
  }

  return options.standardTick % transferUnitTicks === 0;
}

export function canDeviceTransferAtCurrentPhase(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  device: CompiledSimulationDevice,
): boolean {
  return canDedicatedLogisticsTransferAtTick({
    topology,
    device,
    standardTick: state.tickNumber,
  });
}

export function canRecipeFinishAtCurrentPhase(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  recipe: RuntimeDeviceRecipeState,
): boolean {
  const device = resolveRecipeDevice(topology, recipe);
  if (device === null) {
    return true;
  }

  return canDeviceTransferAtCurrentPhase(topology, state, device);
}

function resolveRecipeDevice(
  topology: CompiledSimulationTopology,
  recipe: RuntimeDeviceRecipeState,
): CompiledSimulationDevice | null {
  for (const nodeId of [...recipe.plan.ingredientNodeIds, ...recipe.plan.productNodeIds]) {
    const deviceId = topology.nodes[nodeId]?.deviceId;
    const device = deviceId === undefined ? undefined : topology.devices[deviceId];
    if (device !== undefined) {
      return device;
    }
  }

  return null;
}
