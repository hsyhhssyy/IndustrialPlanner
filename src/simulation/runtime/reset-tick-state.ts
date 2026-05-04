import type { CompiledSimulationTopology } from "@/domain/types/simulation";

import type { SimulationMutableRuntimeState } from "./runtime-state";

export function resetTickState(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  state.transient.nodes = {};
  state.transient.edges = {};
  state.transient.transfers = [];
  state.transient.diagnostics = [];

  for (const cacheGroupId of topology.ordering.cacheGroupOrder) {
    state.transient.nodes[cacheGroupId] = {
      cacheGroupId,
      isDeleted: false,
      result: "uncertain",
      inputCapacities: [],
      outputSupplies: [],
      acceptedInputEdgeIds: [],
      acceptedOutputEdgeIds: [],
    };
  }

  for (const edgeId of topology.ordering.edgeOrder) {
    const edge = topology.transferEdges[edgeId];
    if (edge === undefined) {
      continue;
    }

    state.transient.edges[edgeId] = {
      edgeId,
      isDeleted: false,
      shadowPull: "uncertain",
      shadowPush: "uncertain",
      remainingCount: edge.count === "unlimited" ? Number.MAX_SAFE_INTEGER : Math.max(0, edge.count),
      sourceSlotId: null,
      targetSlotId: null,
      itemType: null,
      amount: 0,
    };
  }
}