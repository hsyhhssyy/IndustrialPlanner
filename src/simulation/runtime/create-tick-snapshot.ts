import type {
  CompiledSimulationTopology,
  RuntimeTickSnapshot,
} from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import {
  resolveEffectiveIgnoreStock,
  resolveStorageSlotId,
} from "@/simulation/runtime/runtime-slot-access";

export function createTickSnapshot(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): RuntimeTickSnapshot {
  // 预计算 reservedBySlot：一次扫描所有设备/配方/预留，避免 createSlotSnapshots 逐槽重复扫描。
  const reservedBySlot = buildReservedBySlot(state);

  return {
    topologyId: topology.topologyId,
    documentHash: topology.documentHash,
    tickNumber: state.tickNumber,
    status: state.tickNumber === 0 ? "initial" : "running",
    totalPowerDemand: topology.totalPowerDemand,
    currentPowerGeneration: state.transient.currentPowerGeneration ?? 0,
    slots: createSlotSnapshots(topology, state, reservedBySlot),
    devices: createDeviceSnapshots(topology, state),
    nodes: createNodeSnapshots(state),
    transfers: state.transient.transfers.map((transfer) => ({ ...transfer })),
    routingCursors: { ...state.persistent.routingCursors },
    transportComponentDomain: { ...state.persistent.transportComponentDomain },
    diagnostics: state.transient.diagnostics.map((diagnostic) => ({ ...diagnostic })),
  };
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
    };
  }
  return devices;
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
