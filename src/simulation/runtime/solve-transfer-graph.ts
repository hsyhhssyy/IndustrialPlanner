import type {
  CompiledSimulationTopology,
  SimulationAcceptRule,
  SimulationItemDomain,
} from "@/domain/types/simulation";

import type {
  RuntimeInputCapacityEntry,
  RuntimeOutputSupplyEntry,
  SimulationMutableRuntimeState,
} from "./runtime-state";

export function solveTransferGraph(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  for (const edgeId of topology.ordering.edgeOrder) {
    const edge = topology.transferEdges[edgeId];
    const edgeState = state.transient.edges[edgeId];
    if (edge === undefined || edgeState?.isDeleted !== false || edgeState.remainingCount <= 0) {
      continue;
    }

    const sourceNode = state.transient.nodes[edge.sourceCacheGroupId];
    const targetNode = state.transient.nodes[edge.targetCacheGroupId];
    if (sourceNode?.isDeleted !== false || targetNode?.isDeleted !== false) {
      continue;
    }

    const sourceEntry = findOutputEntry(topology, sourceNode.outputSupplies, edge.acceptRule);
    if (sourceEntry === null) {
      continue;
    }

    const targetEntry = findInputEntry(topology, targetNode.inputCapacities, sourceEntry.itemType);
    if (targetEntry === null) {
      continue;
    }

    const amount = Math.min(
      sourceEntry.shadowAmount,
      targetEntry.shadowAmount,
      edgeState.remainingCount,
    );
    if (amount <= 0) {
      continue;
    }

    sourceEntry.shadowAmount -= amount;
    targetEntry.shadowAmount -= amount;
    edgeState.remainingCount -= amount;
    edgeState.shadowPull = "accept";
    edgeState.shadowPush = "accept";
    edgeState.sourceSlotId = sourceEntry.slotId;
    edgeState.targetSlotId = targetEntry.slotId;
    edgeState.itemType = sourceEntry.itemType;
    edgeState.amount = amount;

    sourceNode.result = "solved-run";
    targetNode.result = "solved-run";
    sourceNode.acceptedOutputEdgeIds.push(edgeId);
    targetNode.acceptedInputEdgeIds.push(edgeId);
  }

  for (const cacheGroupId of topology.ordering.cacheGroupOrder) {
    const nodeState = state.transient.nodes[cacheGroupId];
    if (nodeState === undefined || nodeState.isDeleted || nodeState.result !== "uncertain") {
      continue;
    }

    nodeState.result = "solved-block";
    if (nodeState.inputCapacities.length === 0 && nodeState.outputSupplies.length === 0) {
      nodeState.blockReason = "empty-node";
    }
  }
}

function findOutputEntry(
  topology: CompiledSimulationTopology,
  entries: RuntimeOutputSupplyEntry[],
  edgeAcceptRule: SimulationAcceptRule,
): RuntimeOutputSupplyEntry | null {
  for (const entry of entries) {
    if (entry.shadowAmount > 0 && acceptsItem(topology, edgeAcceptRule, entry.itemType)) {
      return entry;
    }
  }
  return null;
}

function findInputEntry(
  topology: CompiledSimulationTopology,
  entries: RuntimeInputCapacityEntry[],
  itemType: string,
): RuntimeInputCapacityEntry | null {
  for (const entry of entries) {
    if (entry.shadowAmount > 0 && acceptsItem(topology, entry.acceptRule, itemType)) {
      return entry;
    }
  }
  return null;
}

function acceptsItem(
  topology: CompiledSimulationTopology,
  rule: SimulationAcceptRule,
  itemType: string,
): boolean {
  if (rule.exclude.includes(itemType)) {
    return false;
  }

  switch (rule.base.kind) {
    case "any":
      return true;
    case "solid":
    case "liquid":
      return getItemDomain(topology, itemType) === rule.base.kind;
    case "item":
      return rule.base.itemId === itemType;
  }
}

function getItemDomain(
  topology: CompiledSimulationTopology,
  itemType: string,
): SimulationItemDomain {
  const item = topology.itemCatalog[itemType];
  if (item !== undefined) {
    return item.domain;
  }

  return itemType.includes("_liquid") || itemType.startsWith("liquid_")
    ? "liquid"
    : "solid";
}