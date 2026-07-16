import type {
  CompiledSimulationDevice,
  CompiledSimulationTopology,
} from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import {
  incrementAdmissionMinuteCounterForCurrentWindow,
  readAdmissionMinuteCounterForCurrentWindow,
} from "./runtime-state";

/**
 * 销毁型计量消耗入口：物品进入设备后立即销毁，并按固定仿真时间窗口授予设备运行许可。
 * 该机制独立于配方，因此即使没有配方运行，只要设备有电也会持续接收并计数。
 */
export function isMeteredConsumptionInputPort(
  topology: CompiledSimulationTopology,
  portId: string,
): boolean {
  return resolveMeteredConsumptionDeviceForPort(topology, portId) !== null;
}

export function isDeviceElectricallyPowered(
  device: CompiledSimulationDevice,
  state: SimulationMutableRuntimeState,
): boolean {
  if (device.powerStatus === "out-of-power-range") {
    return false;
  }
  return !(state.transient.isPowerOutage && device.requiresPower);
}

export function isMeteredConsumptionAuthorized(
  device: CompiledSimulationDevice,
  state: SimulationMutableRuntimeState,
): boolean {
  if (device.meteredConsumption === undefined || device.meteredConsumption === null) {
    return true;
  }
  const runtime = state.persistent.meteredConsumptions[device.id];
  return runtime?.authorizedUntilTick !== null
    && runtime?.authorizedUntilTick !== undefined
    && state.tickNumber < runtime.authorizedUntilTick;
}

export function canAcceptMeteredConsumptionItem(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  portId: string,
  itemType: string,
): boolean {
  const device = resolveMeteredConsumptionDeviceForPort(topology, portId);
  const config = device?.meteredConsumption;
  if (device === null || config === undefined || config === null) {
    return true;
  }
  if (!isDeviceElectricallyPowered(device, state)) {
    return false;
  }
  if (!config.itemIds.includes(itemType)) {
    return false;
  }

  const runtime = state.persistent.meteredConsumptions[device.id];
  if (runtime === undefined) {
    return false;
  }
  if (runtime.currentItemId !== null && runtime.currentItemId !== itemType) {
    return false;
  }
  return readAdmissionMinuteCounterForCurrentWindow(topology, state, portId).count
    < config.acceptanceLimit;
}

/** 在 Stage 3 成功从来源扣除一件物品后提交销毁计数。 */
export function recordMeteredConsumptionItem(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  portId: string,
  itemType: string,
): boolean {
  const device = resolveMeteredConsumptionDeviceForPort(topology, portId);
  const config = device?.meteredConsumption;
  if (device === null || config === undefined || config === null) {
    return false;
  }

  const runtime = state.persistent.meteredConsumptions[device.id];
  if (runtime === undefined) {
    return false;
  }

  const counter = readAdmissionMinuteCounterForCurrentWindow(topology, state, portId);
  runtime.currentItemId = runtime.currentItemId ?? itemType;
  incrementAdmissionMinuteCounterForCurrentWindow(topology, state, portId);

  const delta = state.transient.recipeStatsDelta;
  delta.consumed[itemType] = (delta.consumed[itemType] ?? 0) + 1;

  if (
    counter.count >= config.startThreshold
    && (runtime.authorizedUntilTick === null || state.tickNumber >= runtime.authorizedUntilTick)
  ) {
    runtime.authorizedUntilTick = counter.windowStartTick + config.windowTicks;
    runtime.activeEffectItemId = runtime.currentItemId;
  }
  return true;
}

function resolveMeteredConsumptionDeviceForPort(
  topology: CompiledSimulationTopology,
  portId: string,
): CompiledSimulationDevice | null {
  const port = topology.ports[portId];
  const device = port === undefined ? undefined : topology.devices[port.deviceId];
  return device?.meteredConsumption?.inputPortId === portId ? device : null;
}
