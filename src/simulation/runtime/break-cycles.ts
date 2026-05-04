import type { CompiledSimulationTopology } from "@/domain/types/simulation";

import type { SimulationMutableRuntimeState } from "./runtime-state";

export function breakCycles(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  let cycleEdgeIds = findCycleEdgeIds(topology, state);
  if (cycleEdgeIds.size === 0) {
    return;
  }

  for (const cacheGroupId of topology.ordering.cacheGroupOrder) {
    const outgoingEdgeIds = topology.ordering.edgeOrder.filter((edgeId) => {
      const edge = topology.transferEdges[edgeId];
      const edgeState = state.transient.edges[edgeId];
      return edge?.sourceCacheGroupId === cacheGroupId && edgeState?.isDeleted === false;
    });
    const hasCycleEdge = outgoingEdgeIds.some((edgeId) => cycleEdgeIds.has(edgeId));
    const hasNonCycleEdge = outgoingEdgeIds.some((edgeId) => !cycleEdgeIds.has(edgeId));
    if (!hasCycleEdge || !hasNonCycleEdge) {
      continue;
    }

    for (const edgeId of outgoingEdgeIds) {
      if (cycleEdgeIds.has(edgeId)) {
        const edgeState = state.transient.edges[edgeId];
        if (edgeState !== undefined) {
          edgeState.isDeleted = true;
        }
      }
    }
  }

  cycleEdgeIds = findCycleEdgeIds(topology, state);
  for (const edgeId of cycleEdgeIds) {
    const edgeState = state.transient.edges[edgeId];
    if (edgeState !== undefined) {
      edgeState.isDeleted = true;
    }
  }
}

function findCycleEdgeIds(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): Set<string> {
  const cycleEdgeIds = new Set<string>();
  const visitedNodeIds = new Set<string>();
  const visitingNodeIds = new Set<string>();
  const pathNodeIds: string[] = [];
  const pathEdgeIds: string[] = [];

  for (const cacheGroupId of topology.ordering.cacheGroupOrder) {
    visitNode(cacheGroupId, topology, state, visitedNodeIds, visitingNodeIds, pathNodeIds, pathEdgeIds, cycleEdgeIds);
  }

  return cycleEdgeIds;
}

function visitNode(
  cacheGroupId: string,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  visitedNodeIds: Set<string>,
  visitingNodeIds: Set<string>,
  pathNodeIds: string[],
  pathEdgeIds: string[],
  cycleEdgeIds: Set<string>,
): void {
  const nodeState = state.transient.nodes[cacheGroupId];
  if (nodeState?.isDeleted !== false || visitedNodeIds.has(cacheGroupId)) {
    return;
  }

  visitingNodeIds.add(cacheGroupId);
  pathNodeIds.push(cacheGroupId);
  for (const edgeId of topology.ordering.edgeOrder) {
    const edge = topology.transferEdges[edgeId];
    const edgeState = state.transient.edges[edgeId];
    if (edge === undefined || edgeState?.isDeleted !== false || edge.sourceCacheGroupId !== cacheGroupId) {
      continue;
    }

    const targetNodeId = edge.targetCacheGroupId;
    const targetNodeState = state.transient.nodes[targetNodeId];
    if (targetNodeState?.isDeleted !== false) {
      continue;
    }

    pathEdgeIds.push(edgeId);
    if (visitingNodeIds.has(targetNodeId)) {
      const cycleStartIndex = pathNodeIds.indexOf(targetNodeId);
      for (const pathEdgeId of pathEdgeIds.slice(Math.max(0, cycleStartIndex))) {
        cycleEdgeIds.add(pathEdgeId);
      }
    } else {
      visitNode(targetNodeId, topology, state, visitedNodeIds, visitingNodeIds, pathNodeIds, pathEdgeIds, cycleEdgeIds);
    }
    pathEdgeIds.pop();
  }

  visitingNodeIds.delete(cacheGroupId);
  pathNodeIds.pop();
  visitedNodeIds.add(cacheGroupId);
}