import type {
  CompiledSimulationTopology,
  RuntimeTickSnapshot,
  WarehouseItemStats,
  WarehouseStats,
} from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import { readFixedWindowCounterForCurrentWindow } from "./runtime-state";
import {
  resolveEffectiveIgnoreStock,
  resolveStorageSlotId,
} from "@/simulation/runtime/runtime-slot-access";
import { BASE_BATTERY_CAPACITY_J } from "./runtime-state";

export function createTickSnapshot(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  isPowerOutage: boolean,
  currentPowerGeneration: number,
): RuntimeTickSnapshot {
  // 预计算 reservedBySlot：一次扫描所有设备/配方/预留，避免 createSlotSnapshots 逐槽重复扫描。
  const reservedBySlot = buildReservedBySlot(state);

  return {
    topologyId: topology.topologyId,
    documentHash: topology.documentHash,
    tickNumber: state.tickNumber,
    status: state.tickNumber === 0 ? "initial" : "running",
    totalPowerDemand: topology.totalPowerDemand,
    currentPowerGeneration,
    isPowerOutage,
    baseBatteryJoules: state.persistent.baseBatteryJoules,
    baseBatteryCapacity: BASE_BATTERY_CAPACITY_J,
    slots: createSlotSnapshots(topology, state, reservedBySlot),
    devices: createDeviceSnapshots(topology, state),
    nodes: createNodeSnapshots(state),
    transfers: state.transient.transfers.map((transfer) => ({ ...transfer })),
    routingCursors: { ...state.persistent.routingCursors },
    transportComponentDomain: { ...state.persistent.transportComponentDomain },
    diagnostics: state.transient.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    gasDiffusions: state.transient.activeGasDiffusions.map((diffusion) => ({
      ...diffusion,
      gridRect: { ...diffusion.gridRect },
    })),
    warehouseStats: buildWarehouseStats(topology, state),
  };
}

/**
 * 仅为实际展示的调试 tick 序列化完整内部帧。
 * 后台缓存快照始终不含 debugData，避免为每个预计算 tick 重复保存整份 topology。
 */
export function createTickDebugData(
  options: {
    readonly topology: CompiledSimulationTopology;
    readonly runtimeState: SimulationMutableRuntimeState;
    readonly snapshot: RuntimeTickSnapshot;
    readonly workerRuntime: Readonly<Record<string, unknown>>;
  },
): string {
  return JSON.stringify(
    {
      topology: options.topology,
      runtimeState: options.runtimeState,
      snapshot: options.snapshot,
      workerRuntime: options.workerRuntime,
    },
    (_key, value: unknown) => {
      if (value instanceof Set) {
        return [...value];
      }
      if (value instanceof Map) {
        return Object.fromEntries(
          [...value.entries()].map(([entryKey, entryValue]) => [String(entryKey), entryValue]),
        );
      }
      return value;
    },
  );
}

/**
 * 一次扫描所有设备/配方/预留，构建 storageSlotId → reservedAmount 映射。
 * 复杂度 O(Σ devices × Σ recipes × Σ reservations)，替代原逐槽 O(S × D × R)。
 */
function buildReservedBySlot(
  state: SimulationMutableRuntimeState,
): Record<string, number> {
  const reserved: Record<string, number> = {};
  for (const deviceState of Object.values(state.persistent.devices)) {
    for (const recipe of Object.values(deviceState.channelRecipes)) {
      if (recipe === null) continue;
      for (const reservation of recipe.reservations) {
        reserved[reservation.slotId] = (reserved[reservation.slotId] ?? 0) + reservation.amount;
      }
    }
  }
  return reserved;
}

function createSlotSnapshots(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  reservedBySlot: Record<string, number>,
): RuntimeTickSnapshot["slots"] {
  const slots: RuntimeTickSnapshot["slots"] = {};
  for (const slotId of topology.ordering.slotOrder) {
    const storageSlotId = resolveStorageSlotId(state, slotId);
    const slotState = state.persistent.slots[storageSlotId];
    slots[slotId] = {
      slotId,
      itemType: slotState?.itemType ?? null,
      count: slotState?.count ?? 0,
      reserved: reservedBySlot[storageSlotId] ?? 0,
      ignoreStock: resolveEffectiveIgnoreStock(topology, state, slotId),
    };
  }
  return slots;
}

function createDeviceSnapshots(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): RuntimeTickSnapshot["devices"] {
  const devices: RuntimeTickSnapshot["devices"] = {};
  for (const deviceId of topology.ordering.deviceOrder) {
    const runtimeDevice = state.persistent.devices[deviceId];
    if (runtimeDevice === undefined) {
      continue;
    }

    // AI-CORRECTION 2026-05-13: snapshot 投影遍历所有 channel，取第一个运行中的 recipe。
    const firstRecipe = Object.values(runtimeDevice.channelRecipes).find(r => r !== null) ?? null;

    // AI-CORRECTION 2026-05-29: 新增 channelRecipes 投影所有 channel 的运行时状态。
    const channelRecipes: Record<string, RuntimeTickSnapshot["devices"][string]["recipe"]> = {};
    for (const [chId, chRecipe] of Object.entries(runtimeDevice.channelRecipes)) {
      channelRecipes[chId] = chRecipe === null
        ? null
        : {
            runId: chRecipe.runId,
            recipeId: chRecipe.recipeId,
            recipeType: chRecipe.recipeType,
            progressTicks: chRecipe.progressTicks,
            durationTicks: chRecipe.durationTicks,
            state: chRecipe.state,
          };
    }

    devices[deviceId] = {
      deviceId,
      block: runtimeDevice.block,
      recipe: firstRecipe === null
        ? null
        : {
            runId: firstRecipe.runId,
            recipeId: firstRecipe.recipeId,
            recipeType: firstRecipe.recipeType,
            progressTicks: firstRecipe.progressTicks,
            durationTicks: firstRecipe.durationTicks,
            state: firstRecipe.state,
          },
      channelRecipes,
      admissionCounters: createAdmissionCounterSnapshots(topology, state, deviceId),
      // AI-REMOVED 2026-07-23:
      // Reason: RuntimeDeviceSnapshot 已删除分钟计量字段。
      // Trigger: 消耗状态改由真实槽位和频道配方表达。
      // Evidence: 同一 tick 快照已包含 slots 与上方 channelRecipes。
      // Replacement: RuntimeTickSnapshot.slots + channelRecipes。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // meteredConsumption: createMeteredConsumptionSnapshot(topology, state, deviceId),
    };
  }
  return devices;
}

// AI-REMOVED 2026-07-23:
// Reason: tick 快照不再投影固定窗口计量状态。
// Trigger: 用户要求 Inspector 直接显示真实消耗槽数量 × 6。
// Evidence: createSlotSnapshots 与 channelRecipes 已提供库存、预留和运行状态。
// Replacement: RuntimeTickSnapshot.slots + devices.channelRecipes。
// Risk: Low
// Human Review: Required
//
// Original code:
// function createMeteredConsumptionSnapshot(...) { ... }

function createAdmissionCounterSnapshots(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  deviceId: string,
): RuntimeTickSnapshot["devices"][string]["admissionCounters"] {
  const result: RuntimeTickSnapshot["devices"][string]["admissionCounters"] = {};
  const device = topology.devices[deviceId];
  if (device === undefined) {
    return result;
  }

  for (const portId of device.portIds) {
    const port = topology.ports[portId];
    if (port === undefined || port.admissionRule === null) {
      continue;
    }
    const rateWindowCounter = readFixedWindowCounterForCurrentWindow(topology, state, portId);

    result[`${port.portGroupId}:${port.portDefinitionId}`] = {
      portId,
      portGroupId: port.portGroupId,
      portDefinitionId: port.portDefinitionId,
      itemId: port.admissionRule.itemId,
      limit: port.admissionRule.limit,
      count: state.persistent.admissionCounters[portId] ?? 0,
      perMinuteLimit: port.admissionRule.perMinuteLimit,
      rateWindowCount: rateWindowCounter.count,
      pastWindowCounts: rateWindowCounter.pastWindowCounts,
      moveTicks: rateWindowCounter.moveTicks,
    };
  }

  return result;
}

function createNodeSnapshots(
  state: SimulationMutableRuntimeState,
): RuntimeTickSnapshot["nodes"] {
  return Object.fromEntries(Object.entries(state.transient.nodes).map(([nodeId, node]) => [
    nodeId,
    {
      nodeId,
      result: node.result,
      resolveState: node.resolveState,
      acceptedInputEdgeIds: [...node.acceptedInputEdgeIds],
      acceptedOutputEdgeIds: [...node.acceptedOutputEdgeIds],
      blockReason: node.blockReason,
    },
  ]));
}

/**
 * 构建仓库统计快照：合并配方统计的 per-min 值与仓库槽位当前库存。
 */
function buildWarehouseStats(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): WarehouseStats | null {
  const recipeStats = state.persistent.recipeStats;
  const items: Record<string, WarehouseItemStats> = {};

  // 收集所有在配方统计中或仓库中有数据的物品
  const allItemTypes = new Set<string>();

  for (const itemType of Object.keys(recipeStats.aggregated)) {
    allItemTypes.add(itemType);
  }
  for (const itemType of Object.keys(recipeStats.lastChangedTick)) {
    allItemTypes.add(itemType);
  }

  // 遍历仓库槽位，汇总各类物品库存
  const warehouseDevice = Object.values(topology.devices).find(
    (device) => device.definitionId === "warehouse",
  );

  if (warehouseDevice !== undefined) {
    for (const nodeId of warehouseDevice.nodeIds) {
      const node = topology.nodes[nodeId];
      if (node === undefined) continue;
      for (const slotId of node.slotIds) {
        const storageSlotId = resolveStorageSlotId(state, slotId);
        const slotState = state.persistent.slots[storageSlotId];
        if (slotState === undefined || slotState.itemType === null || slotState.count <= 0) continue;
        allItemTypes.add(slotState.itemType);
      }
    }
  }

  for (const itemType of allItemTypes) {
    const aggregated = recipeStats.aggregated[itemType];
    let warehouseCount = 0;

    if (warehouseDevice !== undefined) {
      for (const nodeId of warehouseDevice.nodeIds) {
        const node = topology.nodes[nodeId];
        if (node === undefined) continue;
        const itemSlotId = `${nodeId}/slot:${itemType}`;
        const storageSlotId = resolveStorageSlotId(state, itemSlotId);
        const slotState = state.persistent.slots[storageSlotId];
        if (slotState !== undefined && slotState.itemType === itemType) {
          warehouseCount += slotState.count;
        }
      }
    }

    items[itemType] = {
      producedPerMinute: aggregated?.producedPerMinute ?? 0,
      consumedPerMinute: aggregated?.consumedPerMinute ?? 0,
      warehouseCount,
      lastChangedTick: recipeStats.lastChangedTick[itemType] ?? 0,
    };
  }

  return {
    items,
    statsWindowReady: recipeStats.coveredStandardTicks >= recipeStats.windowCapacity,
  };
}
