import type {
  CompiledSimulationDevice,
  CompiledSimulationTopology,
  RuntimeGasDiffusionSnapshot,
} from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import {
  areGridRectsIntersecting,
} from "@/shared/geometry/power-range";
import {
  getGridFootprintCenterCells,
  getRotatedGridFootprint,
} from "@/shared/geometry/grid";
import {
  isDeviceElectricallyPowered,
  isMeteredConsumptionAuthorized,
} from "./metered-consumption";

export function computeActiveGasDiffusions(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): readonly RuntimeGasDiffusionSnapshot[] {
  const result: RuntimeGasDiffusionSnapshot[] = [];

  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    const deviceState = state.persistent.devices[deviceId];
    if (device === undefined || deviceState === undefined) {
      continue;
    }
    if (!isDeviceElectricallyPowered(device, state)) {
      continue;
    }

    const metered = device.meteredConsumption;
    const meteredState = state.persistent.meteredConsumptions[device.id];
    if (
      metered !== undefined
      && metered !== null
      && metered.gasDiffusionRange !== null
      && meteredState?.activeEffectItemId !== null
      && meteredState?.activeEffectItemId !== undefined
      && isMeteredConsumptionAuthorized(device, state)
    ) {
      const gridRect = resolveDeviceCenteredRangeRect(device, metered.gasDiffusionRange);
      if (gridRect !== null) {
        result.push({
          sourceDeviceId: device.id,
          gasItemId: meteredState.activeEffectItemId,
          gridRect,
        });
      }
    }

    if (!isMeteredConsumptionAuthorized(device, state)) {
      continue;
    }

    for (const recipe of Object.values(deviceState.channelRecipes)) {
      const output = recipe?.plan.gasDiffusionOutput ?? null;
      if (output === null) {
        continue;
      }

      const gridRect = resolveDeviceCenteredRangeRect(device, output.range);
      if (gridRect === null) {
        continue;
      }

      result.push({
        sourceDeviceId: device.id,
        gasItemId: output.gasItemId,
        gridRect,
      });
    }
  }

  return result;
}

export function isDeviceInRequiredGasDiffusion(options: {
  readonly device: CompiledSimulationDevice;
  readonly requiredGasDiffusion: string | null;
  readonly activeGasDiffusions: readonly RuntimeGasDiffusionSnapshot[];
}): boolean {
  if (options.requiredGasDiffusion === null) {
    return true;
  }

  const deviceGridRect = resolveDeviceGridRect(options.device);
  if (deviceGridRect === null) {
    return false;
  }

  return options.activeGasDiffusions.some((diffusion) =>
    diffusion.gasItemId === options.requiredGasDiffusion
    && areGridRectsIntersecting(deviceGridRect, diffusion.gridRect),
  );
}

function resolveDeviceGridRect(device: CompiledSimulationDevice): RuntimeGasDiffusionSnapshot["gridRect"] | null {
  if (device.position === null || device.rotation === null || device.footprint === null) {
    return null;
  }

  const rotatedFootprint = getRotatedGridFootprint(device.footprint, device.rotation);
  return {
    x: device.position.x,
    y: device.position.y,
    width: rotatedFootprint.width,
    height: rotatedFootprint.height,
  };
}

function resolveDeviceCenteredRangeRect(
  device: CompiledSimulationDevice,
  range: number,
): RuntimeGasDiffusionSnapshot["gridRect"] | null {
  if (device.position === null || device.rotation === null || device.footprint === null) {
    return null;
  }

  const rotatedFootprint = getRotatedGridFootprint(device.footprint, device.rotation);
  const center = getGridFootprintCenterCells(device.position, rotatedFootprint);
  const halfRange = range / 2;

  return {
    x: center.x - halfRange,
    y: center.y - halfRange,
    width: range,
    height: range,
  };
}
