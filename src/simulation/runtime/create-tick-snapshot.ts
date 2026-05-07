import type {
  CompiledSimulationTopology,
  RuntimeTickSnapshot,
} from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import {
  getReservedAmount,
  resolveStorageSlotId,
} from "@/simulation/runtime/runtime-slot-access";

export function createTickSnapshot(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): RuntimeTickSnapshot {
  return {
    topologyId: topology.topologyId,
    documentHash: topology.documentHash,
    tickNumber: state.tickNumber,
    status: state.tickNumber === 0 ? "initial" : "running",
    slots: createSlotSnapshots(topology, state),
    devices: createDeviceSnapshots(topology, state),
    nodes: createNodeSnapshots(state),
    transfers: state.transient.transfers.map((transfer) => ({ ...transfer })),
    routingCursors: { ...state.persistent.routingCursors },
    diagnostics: state.transient.diagnostics.map((diagnostic) => ({ ...diagnostic })),
  };
}

function createSlotSnapshots(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): RuntimeTickSnapshot["slots"] {
  const slots: RuntimeTickSnapshot["slots"] = {};
  for (const slotId of topology.ordering.slotOrder) {
    const storageSlotId = resolveStorageSlotId(state, slotId);
    const slotState = state.persistent.slots[storageSlotId];
    slots[slotId] = {
      slotId,
      itemType: slotState?.itemType ?? null,
      count: slotState?.count ?? 0,
      reserved: getReservedAmount(state, storageSlotId),
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
      acceptedInputEdgeIds: [...node.acceptedInputEdgeIds],
      acceptedOutputEdgeIds: [...node.acceptedOutputEdgeIds],
      blockReason: node.blockReason,
    },
  ]));
}
