import type { CompiledSimulationTopology } from "@/domain/types/simulation";

export interface RuntimeLinkTopologyState {
  readonly shareAllTargetSlotIdBySourceSlotId: Readonly<Record<string, string>>;
  readonly sharedCapacitySlotIdsBySlotId: Readonly<Record<string, readonly string[]>>;
  readonly sharedCapacityLimitBySlotId: Readonly<Record<string, number>>;
}

const runtimeLinkTopologyStateCache = new WeakMap<CompiledSimulationTopology, RuntimeLinkTopologyState>();

export function getRuntimeLinkTopologyState(
  topology: CompiledSimulationTopology,
): RuntimeLinkTopologyState {
  const cached = runtimeLinkTopologyStateCache.get(topology);
  if (cached !== undefined) {
    return cached;
  }

  const created = buildRuntimeLinkTopologyState(topology);
  runtimeLinkTopologyStateCache.set(topology, created);
  return created;
}

function buildRuntimeLinkTopologyState(
  topology: CompiledSimulationTopology,
): RuntimeLinkTopologyState {
  const shareAllTargetSlotIdBySourceSlotId: Record<string, string> = {};
  const shareCapAdjacencyBySlotId = new Map<string, Set<string>>();

  for (const link of Object.values(topology.links)) {
    for (const [sourceSlotId, targetSlotId] of Object.entries(link.targetSlotIdBySourceSlotId)) {
      if (link.linkType === "share-all") {
        shareAllTargetSlotIdBySourceSlotId[sourceSlotId] = targetSlotId;
        continue;
      }

      connectShareCapSlots(shareCapAdjacencyBySlotId, sourceSlotId, targetSlotId);
    }
  }

  const sharedCapacitySlotIdsBySlotId: Record<string, readonly string[]> = {};
  const sharedCapacityLimitBySlotId: Record<string, number> = {};
  const visitedSlotIds = new Set<string>();

  for (const slotId of shareCapAdjacencyBySlotId.keys()) {
    if (visitedSlotIds.has(slotId)) {
      continue;
    }

    const componentSlotIds = collectShareCapComponent(slotId, shareCapAdjacencyBySlotId, visitedSlotIds).sort();
    const capacities = componentSlotIds
      .map((componentSlotId) => topology.slots[componentSlotId]?.capacity)
      .filter((capacity): capacity is number => capacity !== undefined);
    if (capacities.length === 0) {
      continue;
    }

    const sharedCapacityLimit = Math.min(...capacities);
    for (const componentSlotId of componentSlotIds) {
      sharedCapacitySlotIdsBySlotId[componentSlotId] = componentSlotIds;
      sharedCapacityLimitBySlotId[componentSlotId] = sharedCapacityLimit;
    }
  }

  return {
    shareAllTargetSlotIdBySourceSlotId,
    sharedCapacitySlotIdsBySlotId,
    sharedCapacityLimitBySlotId,
  };
}

function connectShareCapSlots(
  adjacencyBySlotId: Map<string, Set<string>>,
  sourceSlotId: string,
  targetSlotId: string,
): void {
  const sourceNeighbors = adjacencyBySlotId.get(sourceSlotId) ?? new Set<string>();
  sourceNeighbors.add(targetSlotId);
  adjacencyBySlotId.set(sourceSlotId, sourceNeighbors);

  const targetNeighbors = adjacencyBySlotId.get(targetSlotId) ?? new Set<string>();
  targetNeighbors.add(sourceSlotId);
  adjacencyBySlotId.set(targetSlotId, targetNeighbors);
}

function collectShareCapComponent(
  slotId: string,
  adjacencyBySlotId: ReadonlyMap<string, ReadonlySet<string>>,
  visitedSlotIds: Set<string>,
): string[] {
  const componentSlotIds: string[] = [];
  const pendingSlotIds = [slotId];

  while (pendingSlotIds.length > 0) {
    const currentSlotId = pendingSlotIds.pop();
    if (currentSlotId === undefined || visitedSlotIds.has(currentSlotId)) {
      continue;
    }

    visitedSlotIds.add(currentSlotId);
    componentSlotIds.push(currentSlotId);

    for (const neighborSlotId of adjacencyBySlotId.get(currentSlotId) ?? []) {
      if (!visitedSlotIds.has(neighborSlotId)) {
        pendingSlotIds.push(neighborSlotId);
      }
    }
  }

  return componentSlotIds;
}