import type {
  CompiledSimulationTopology,
} from "../types";
import type {
  SimulationCurrentTickDeviceReadModel,
  SimulationCurrentTickNodeReadModel,
  SimulationCurrentTickReadModel,
  SimulationCurrentTickSlotReadModel,
  SimulationReservedItemReadModel,
} from "@/domain/query/simulation-read-model";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import { resolveStorageSlotId } from "./runtime-slot-access";

/**
 * 对应《仿真运行原理》§6.7 状态快照输出。
 * Worker 内部保留可变运行态；每个 tick 输出不可变 DTO，供 UI 和历史查询消费。
 * 订正（2026-05-05）：当前输出已改为 read model，不再作为 snapshot DTO 对外暴露。
 */
export function createTickReadModel(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): SimulationCurrentTickReadModel {
  const slots = createSlotReadModels(topology, state);
  const devices: Record<string, SimulationCurrentTickDeviceReadModel> = {};
  const warehouse: Record<string, number> = {};

  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    const runtimeDevice = state.persistent.devices[deviceId];
    if (device === undefined || runtimeDevice === undefined) {
      continue;
    }

    devices[deviceId] = {
      deviceId,
      block: runtimeDevice.block,
      recipe: runtimeDevice.recipe === null
        ? null
        : {
            runId: runtimeDevice.recipe.runId,
            recipeId: runtimeDevice.recipe.recipeId,
            recipeType: runtimeDevice.recipe.recipeType,
            progressTicks: runtimeDevice.recipe.progressTicks,
            durationTicks: runtimeDevice.recipe.durationTicks,
            state: runtimeDevice.recipe.state,
          },
    };

    if (device.definitionId === "warehouse") {
      for (const nodeId of device.nodeIds) {
        const node = topology.nodes[nodeId];
        if (node === undefined) {
          continue;
        }
        for (const slotId of node.slotIds) {
          const slot = slots[slotId];
          if (slot?.itemType !== null && slot?.itemType !== undefined) {
            warehouse[slot.itemType] = (warehouse[slot.itemType] ?? 0) + slot.count;
          }
        }
      }
    }
  }

  return {
    topologyId: topology.topologyId,
    documentHash: topology.documentHash,
    tickNumber: state.tickNumber,
    status: state.tickNumber === 0 ? "initial" : "running",
    slots,
    devices,
    nodes: createNodeSnapshots(state),
    transfers: state.transient.transfers.map((transfer) => ({ ...transfer })),
    routingCursors: { ...state.persistent.routingCursors },
    warehouse,
    diagnostics: state.transient.diagnostics.map((diagnostic) => ({ ...diagnostic })),
  };
}

function createSlotReadModels(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): Record<string, SimulationCurrentTickSlotReadModel> {
  const slots: Record<string, SimulationCurrentTickSlotReadModel> = {};
  for (const slotId of topology.ordering.slotOrder) {
    const storageSlotId = resolveStorageSlotId(state, slotId);
    const slotState = state.persistent.slots[storageSlotId];
    slots[slotId] = {
      slotId,
      itemType: slotState?.itemType ?? null,
      count: slotState?.count ?? 0,
      reserved: createReservationReadModels(state, storageSlotId),
    };
  }
  return slots;
}

function createNodeSnapshots(state: SimulationMutableRuntimeState): Record<string, SimulationCurrentTickNodeReadModel> {
  return Object.fromEntries(Object.entries(state.transient.nodes).map(([nodeId, node]) => [
    nodeId,
    {
      cacheGroupId: nodeId,
      nodeId,
      result: node.result,
      acceptedInputEdgeIds: [...node.acceptedInputEdgeIds],
      acceptedOutputEdgeIds: [...node.acceptedOutputEdgeIds],
      blockReason: node.blockReason,
    },
  ]));
}

function createReservationReadModels(
  state: SimulationMutableRuntimeState,
  storageSlotId: string,
): SimulationReservedItemReadModel[] {
  const readModels: SimulationReservedItemReadModel[] = [];
  for (const deviceState of Object.values(state.persistent.devices)) {
    const recipe = deviceState.recipe;
    if (recipe === null) {
      continue;
    }
    for (const reservation of recipe.reservations) {
      if (reservation.slotId === storageSlotId) {
        readModels.push({
          recipeRunId: recipe.runId,
          itemType: reservation.itemType,
          amount: reservation.amount,
        });
      }
    }
  }
  return readModels;
}
