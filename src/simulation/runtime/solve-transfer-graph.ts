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
import {
  refreshEdgeDeletionState,
  refreshNodeInputCapacities,
} from "./build-solve-graph";

export function solveTransferGraph(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  const edgeQueue = [...topology.ordering.edgeOrder];
  const queuedEdgeIds = new Set(edgeQueue);

  for (let edgeIndex = 0; edgeIndex < edgeQueue.length; edgeIndex += 1) {
    const edgeId = edgeQueue[edgeIndex];
    if (edgeId === undefined) {
      continue;
    }

    queuedEdgeIds.delete(edgeId);

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

    const retryEdgeIds = commitAcceptedTransfer(
      topology,
      state,
      edgeId,
      sourceEntry.slotId,
      targetEntry.slotId,
      sourceEntry.itemType,
      amount,
    );
    enqueueRetryEdges(edgeQueue, queuedEdgeIds, retryEdgeIds);
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

function commitAcceptedTransfer(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  edgeId: string,
  sourceSlotId: string,
  targetSlotId: string,
  itemType: string,
  amount: number,
): string[] {
  const sourceSlot = topology.slots[sourceSlotId];
  const sourceStorageSlotId = resolveStorageSlotId(state, sourceSlotId);
  const targetStorageSlotId = resolveStorageSlotId(state, targetSlotId);
  const sourceSlotState = state.persistent.slots[sourceStorageSlotId];
  const targetSlotState = state.persistent.slots[targetStorageSlotId];
  if (sourceSlot === undefined || sourceSlotState === undefined || targetSlotState === undefined) {
    return [];
  }

  if (!sourceSlot.ignoreStock) {
    sourceSlotState.count = Math.max(0, sourceSlotState.count - amount);
  }
  if (targetSlotState.itemType === null) {
    targetSlotState.itemType = itemType;
  }
  targetSlotState.count += amount;

  state.transient.transfers.push({
    edgeId,
    sourceSlotId,
    targetSlotId,
    itemType,
    amount,
  });

  return refreshAffectedGraph(
    topology,
    state,
    new Set([sourceStorageSlotId, targetStorageSlotId]),
  );
}

function refreshAffectedGraph(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  storageSlotIds: ReadonlySet<string>,
): string[] {
  const affectedStorageSlotIds = expandSharedCapacitySlotIds(state, storageSlotIds);
  const affectedCacheGroupIds = findAffectedCacheGroupIds(topology, state, affectedStorageSlotIds);
  const retryEdgeIds: string[] = [];

  for (const cacheGroupId of affectedCacheGroupIds) {
    refreshNodeInputCapacities(topology, state, cacheGroupId);
  }

  for (const edgeId of topology.ordering.edgeOrder) {
    const edge = topology.transferEdges[edgeId];
    if (
      edge === undefined
      || (!affectedCacheGroupIds.has(edge.sourceCacheGroupId)
        && !affectedCacheGroupIds.has(edge.targetCacheGroupId))
    ) {
      continue;
    }

    refreshEdgeDeletionState(topology, state, edgeId);

    const edgeState = state.transient.edges[edgeId];
    if (
      affectedCacheGroupIds.has(edge.targetCacheGroupId)
      && edgeState?.isDeleted === false
      && edgeState.shadowPull === "uncertain"
      && edgeState.shadowPush === "uncertain"
      && edgeState.remainingCount > 0
    ) {
      retryEdgeIds.push(edgeId);
    }
  }

  return retryEdgeIds;
}

function expandSharedCapacitySlotIds(
  state: SimulationMutableRuntimeState,
  storageSlotIds: ReadonlySet<string>,
): Set<string> {
  const expandedStorageSlotIds = new Set(storageSlotIds);

  for (const storageSlotId of storageSlotIds) {
    const sharedCapacitySlotIds = state.persistent.sharedCapacitySlotIdsBySlotId[storageSlotId];
    if (sharedCapacitySlotIds === undefined) {
      continue;
    }

    for (const sharedCapacitySlotId of sharedCapacitySlotIds) {
      expandedStorageSlotIds.add(sharedCapacitySlotId);
    }
  }

  return expandedStorageSlotIds;
}

function enqueueRetryEdges(
  edgeQueue: string[],
  queuedEdgeIds: Set<string>,
  edgeIds: readonly string[],
): void {
  for (const edgeId of edgeIds) {
    if (queuedEdgeIds.has(edgeId)) {
      continue;
    }

    edgeQueue.push(edgeId);
    queuedEdgeIds.add(edgeId);
  }
}

function findAffectedCacheGroupIds(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  storageSlotIds: ReadonlySet<string>,
): Set<string> {
  const affectedCacheGroupIds = new Set<string>();

  for (const cacheGroupId of topology.ordering.cacheGroupOrder) {
    const cacheGroup = topology.cacheGroups[cacheGroupId];
    if (cacheGroup === undefined) {
      continue;
    }

    for (const slotId of cacheGroup.slotIds) {
      if (storageSlotIds.has(resolveStorageSlotId(state, slotId))) {
        affectedCacheGroupIds.add(cacheGroupId);
        break;
      }
    }
  }

  return affectedCacheGroupIds;
}

function resolveStorageSlotId(
  state: SimulationMutableRuntimeState,
  slotId: string,
): string {
  return state.persistent.proxyTargetSlotIdBySourceSlotId[slotId] ?? slotId;
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