// AI-REMOVED 2026-09-09:
// Reason: 按仿真引擎与状态所有权重组，原实现迁入明确的职责模块。
// Trigger: 用户授权抽离 dense / legacy 公共接口并重组 legacy。
// Evidence: 原入口混合引擎选择、查询、Worker bridge 与 legacy 控制状态。
// Replacement: src/simulation/legacy/consumption-channel.ts
// Risk: 异步生命周期与查询语义由双引擎回归验证。
// Human Review: Required
//
// Original code:
// import type {
//   CompiledSimulationDevice,
//   CompiledSimulationTopology,
// } from "../types";
// import type { SimulationMutableRuntimeState } from "./runtime-state";
//
// const consumptionDeviceIdsByTopology = new WeakMap<
//   CompiledSimulationTopology,
//   readonly string[]
// >();
//
// export function computeActiveConsumptionDeviceIds(
//   topology: CompiledSimulationTopology,
//   state: SimulationMutableRuntimeState,
// ): ReadonlySet<string> {
//   const activeDeviceIds = new Set<string>();
//   for (const deviceId of getConsumptionChannelDeviceIds(topology)) {
//     const device = topology.devices[deviceId];
//     const deviceState = state.persistent.devices[deviceId];
//     if (device === undefined || deviceState === undefined) {
//       continue;
//     }
//
//     const consumptionChannelCount = resolveConsumptionChannelCount(device);
//     for (let index = 0; index < consumptionChannelCount; index += 1) {
//       const channel = device.recipeChannels[index];
//       if (
//         channel !== undefined
//         && deviceState.channelRecipes[channel.id]?.state === "running"
//       ) {
//         activeDeviceIds.add(deviceId);
//         break;
//       }
//     }
//   }
//   return activeDeviceIds;
// }
//
// export function isDeviceConsumptionAuthorizedForFrame(
//   device: CompiledSimulationDevice,
//   state: SimulationMutableRuntimeState,
// ): boolean {
//   return resolveConsumptionChannelCount(device) === 0
//     || state.transient.activeConsumptionDeviceIds.has(device.id);
// }
//
// export function resolveConsumptionChannelCount(
//   device: CompiledSimulationDevice,
// ): number {
//   if (device.consumptionChannelCount !== undefined) {
//     return Math.max(
//       0,
//       Math.min(device.recipeChannels.length, device.consumptionChannelCount),
//     );
//   }
//
//   let count = 0;
//   for (const channel of device.recipeChannels) {
//     if (channel.type !== "consumption-channel") {
//       break;
//     }
//     count += 1;
//   }
//   return count;
// }
//
// /** 返回拓扑中带消耗频道的稀疏设备列表，供每帧判定和 Stage 5 启动共用。 */
// export function getConsumptionChannelDeviceIds(
//   topology: CompiledSimulationTopology,
// ): readonly string[] {
//   const cached = consumptionDeviceIdsByTopology.get(topology);
//   if (cached !== undefined) {
//     return cached;
//   }
//
//   const deviceIds: string[] = [];
//   for (const deviceId of topology.ordering.deviceOrder) {
//     const device = topology.devices[deviceId];
//     if (device !== undefined && resolveConsumptionChannelCount(device) > 0) {
//       deviceIds.push(deviceId);
//     }
//   }
//   consumptionDeviceIdsByTopology.set(topology, deviceIds);
//   return deviceIds;
// }
//
