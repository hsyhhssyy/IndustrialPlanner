import type { CompiledSimulationDevice, CompiledSimulationTopology } from "../contracts";
import type { SimulationMutableRuntimeState } from "./runtime-state";

const consumptionDeviceIdsByTopology = new WeakMap<
  CompiledSimulationTopology,
  readonly string[]
>();

export function computeActiveConsumptionDeviceIds(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): ReadonlySet<string> {
  const activeDeviceIds = new Set<string>();
  for (const deviceId of getConsumptionChannelDeviceIds(topology)) {
    const device = topology.devices[deviceId];
    if (device !== undefined && isDeviceConsumptionAuthorizedNow(device, state)) activeDeviceIds.add(deviceId);
  }
  return activeDeviceIds;
}

/** 恢复与区域结算需要读取当前运行态，刷新后的阶段缓存可能仍未建立。 */
export function isDeviceConsumptionAuthorizedNow(
  device: CompiledSimulationDevice,
  state: SimulationMutableRuntimeState,
): boolean {
  const channelCount = resolveConsumptionChannelCount(device);
  if (channelCount === 0) return true;
  const recipeStates = state.persistent.devices[device.id]?.channelRecipes;
  for (let index = 0; index < channelCount; index += 1) {
    const channel = device.recipeChannels[index];
    if (channel !== undefined && recipeStates?.[channel.id]?.state === "running") return true;
  }
  return false;
}

export function isDeviceConsumptionAuthorizedForFrame(
  device: CompiledSimulationDevice,
  state: SimulationMutableRuntimeState,
): boolean {
  return resolveConsumptionChannelCount(device) === 0
    || state.transient.activeConsumptionDeviceIds.has(device.id);
}

export function resolveConsumptionChannelCount(
  device: CompiledSimulationDevice,
): number {
  if (device.consumptionChannelCount !== undefined) {
    return Math.max(
      0,
      Math.min(device.recipeChannels.length, device.consumptionChannelCount),
    );
  }

  let count = 0;
  for (const channel of device.recipeChannels) {
    if (channel.type !== "consumption-channel") {
      break;
    }
    count += 1;
  }
  return count;
}

/** 返回拓扑中带消耗频道的稀疏设备列表，供每帧判定和 Stage 5 启动共用。 */
export function getConsumptionChannelDeviceIds(
  topology: CompiledSimulationTopology,
): readonly string[] {
  const cached = consumptionDeviceIdsByTopology.get(topology);
  if (cached !== undefined) {
    return cached;
  }

  const deviceIds: string[] = [];
  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    if (device !== undefined && resolveConsumptionChannelCount(device) > 0) {
      deviceIds.push(deviceId);
    }
  }
  consumptionDeviceIdsByTopology.set(topology, deviceIds);
  return deviceIds;
}
