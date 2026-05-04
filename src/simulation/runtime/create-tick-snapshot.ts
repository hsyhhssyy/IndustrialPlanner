import type {
  CompiledSimulationTopology,
  SimulationTickSnapshot,
} from "@/domain/types/simulation";

import type { SimulationMutableRuntimeState } from "./runtime-state";

export function createTickSnapshot(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  tickNumber: number,
): SimulationTickSnapshot {
  return {
    schemaVersion: 1,
    topologyId: topology.topologyId,
    documentHash: topology.documentHash,
    tickNumber,
    status: tickNumber === 0 ? "initial" : "running",
    slots: Object.fromEntries(topology.ordering.slotOrder.map((slotId) => {
      const slotState = state.persistent.slots[slotId];
      return [slotId, {
        slotId,
        itemType: slotState?.itemType ?? null,
        count: slotState?.count ?? 0,
        reserved: Object.values(state.persistent.devices).flatMap((deviceState) => {
          const recipe = deviceState.recipe;
          if (recipe === null) {
            return [];
          }
          return recipe.reservations
            .filter((reservation) => reservation.slotId === slotId)
            .map((reservation) => ({
              recipeRunId: recipe.runId,
              itemType: reservation.itemType,
              amount: reservation.amount,
            }));
        }),
      }];
    })),
    devices: Object.fromEntries(topology.ordering.deviceOrder.map((deviceId) => {
      const deviceState = state.persistent.devices[deviceId];
      const recipe = deviceState?.recipe ?? null;
      return [deviceId, {
        deviceId,
        block: deviceState?.block ?? false,
        recipe: recipe === null ? null : {
          runId: recipe.runId,
          recipeId: recipe.recipeId,
          recipeType: recipe.recipeType,
          progressTicks: recipe.progressTicks,
          durationTicks: recipe.durationTicks,
          state: recipe.state === "waiting-output" ? "waiting-output" : "running",
        },
      }];
    })),
    nodes: Object.fromEntries(topology.ordering.cacheGroupOrder.map((cacheGroupId) => {
      const nodeState = state.transient.nodes[cacheGroupId];
      return [cacheGroupId, {
        cacheGroupId,
        result: nodeState?.result ?? "uncertain",
        acceptedInputEdgeIds: nodeState?.acceptedInputEdgeIds ?? [],
        acceptedOutputEdgeIds: nodeState?.acceptedOutputEdgeIds ?? [],
        blockReason: nodeState?.blockReason,
      }];
    })),
    transfers: state.transient.transfers.map((transfer) => ({ ...transfer })),
    routingCursors: { ...state.persistent.routingCursors },
    warehouse: Object.fromEntries(topology.ordering.slotOrder.flatMap((slotId) => {
      const slot = topology.slots[slotId];
      const cacheGroup = slot === undefined ? undefined : topology.cacheGroups[slot.cacheGroupId];
      const device = cacheGroup === undefined ? undefined : topology.devices[cacheGroup.deviceId];
      const slotState = state.persistent.slots[slotId];
      if (device?.definitionId !== "warehouse" || slot?.sourceSlotId === null || slot?.sourceSlotId === undefined) {
        return [];
      }
      return [[slot.sourceSlotId, slotState?.count ?? 0]];
    })),
    diagnostics: state.transient.diagnostics.map((diagnostic) => ({ ...diagnostic })),
  };
}