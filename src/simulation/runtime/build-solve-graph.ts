import type {
  CompiledSimulationSlotTemplate,
  CompiledSimulationTopology,
  SimulationAcceptRule,
} from "@/domain/types/simulation";

import type {
  RuntimeInputCapacityEntry,
  RuntimeOutputSupplyEntry,
  SimulationMutableRuntimeState,
} from "./runtime-state";

export function buildSolveGraph(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  for (const cacheGroupId of topology.ordering.cacheGroupOrder) {
    refreshNodeState(topology, state, cacheGroupId);
  }

  for (const edgeId of topology.ordering.edgeOrder) {
    refreshEdgeDeletionState(topology, state, edgeId);
  }
}

export function refreshNodeState(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  cacheGroupId: string,
): void {
  const cacheGroup = topology.cacheGroups[cacheGroupId];
  const nodeState = state.transient.nodes[cacheGroupId];
  if (cacheGroup === undefined || nodeState === undefined) {
    return;
  }

  const inputCapacities = buildInputCapacities(topology, state, cacheGroup);
  const outputSupplies = buildOutputSupplies(topology, state, cacheGroup);

  nodeState.inputCapacities = inputCapacities;
  nodeState.outputSupplies = outputSupplies;
  nodeState.isDeleted = inputCapacities.length === 0 && outputSupplies.length === 0;
}

export function refreshNodeInputCapacities(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  cacheGroupId: string,
): void {
  const cacheGroup = topology.cacheGroups[cacheGroupId];
  const nodeState = state.transient.nodes[cacheGroupId];
  if (cacheGroup === undefined || nodeState === undefined) {
    return;
  }

  const inputCapacities = buildInputCapacities(topology, state, cacheGroup);
  nodeState.inputCapacities = inputCapacities;
  nodeState.isDeleted = inputCapacities.length === 0 && nodeState.outputSupplies.length === 0;
}

export function refreshEdgeDeletionState(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  edgeId: string,
): void {
  const edge = topology.transferEdges[edgeId];
  const edgeState = state.transient.edges[edgeId];
  if (edge === undefined || edgeState === undefined) {
    return;
  }

  if (edgeState.shadowPull === "accept" || edgeState.shadowPush === "accept" || edgeState.amount > 0) {
    edgeState.isDeleted = false;
    return;
  }

  const sourceNode = state.transient.nodes[edge.sourceCacheGroupId];
  const targetNode = state.transient.nodes[edge.targetCacheGroupId];
  edgeState.isDeleted = sourceNode?.isDeleted !== false || targetNode?.isDeleted !== false;
}

function buildInputCapacities(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  cacheGroup: CompiledSimulationTopology["cacheGroups"][string],
): RuntimeInputCapacityEntry[] {
  const inputCapacities: RuntimeInputCapacityEntry[] = [];
  if (cacheGroup.inputPortIds.length === 0) {
    return inputCapacities;
  }

  for (const slotId of cacheGroup.slotIds) {
    const slot = topology.slots[slotId];
    const slotState = state.persistent.slots[slotId];
    if (slot === undefined || slotState === undefined) {
      continue;
    }

    const inputEntry = createInputCapacityEntry(topology, state, slot);
    if (inputEntry !== null) {
      inputCapacities.push(inputEntry);
    }
  }

  const occupiedItemIds = inputCapacities
    .map((entry) => entry.acceptRule.base.kind === "item" ? entry.acceptRule.base.itemId : null)
    .filter((itemId): itemId is string => itemId !== null);
  for (const entry of inputCapacities) {
    if (entry.acceptRule.base.kind !== "any" && entry.acceptRule.base.kind !== "solid" && entry.acceptRule.base.kind !== "liquid") {
      continue;
    }
    entry.acceptRule = {
      base: entry.acceptRule.base,
      exclude: [...new Set([...entry.acceptRule.exclude, ...occupiedItemIds])].sort(),
    };
  }

  return inputCapacities;
}

function buildOutputSupplies(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  cacheGroup: CompiledSimulationTopology["cacheGroups"][string],
): RuntimeOutputSupplyEntry[] {
  const outputSupplies: RuntimeOutputSupplyEntry[] = [];
  if (cacheGroup.outputPortIds.length === 0) {
    return outputSupplies;
  }

  for (const slotId of cacheGroup.slotIds) {
    const slot = topology.slots[slotId];
    const slotState = state.persistent.slots[slotId];
    if (slot === undefined || slotState === undefined) {
      continue;
    }

    const outputEntry = createOutputSupplyEntry(topology, state, slot);
    if (outputEntry !== null) {
      outputSupplies.push(outputEntry);
    }
  }

  return outputSupplies;
}

function createInputCapacityEntry(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  slot: CompiledSimulationSlotTemplate,
): RuntimeInputCapacityEntry | null {
  const inventorySlotId = resolveInventorySlotId(state, slot.id);
  const inventorySlot = topology.slots[inventorySlotId] ?? slot;
  const inventorySlotState = state.persistent.slots[inventorySlotId];
  if (inventorySlotState === undefined) {
    return null;
  }

  const { capacityLimit, occupiedCount } = resolveSharedCapacityState(
    state,
    slot.id,
    inventorySlotId,
    inventorySlot.capacity,
  );
  const amount = Math.max(0, capacityLimit - occupiedCount);
  if (amount <= 0) {
    return null;
  }

  const acceptRule = createSlotAcceptRule(
    inventorySlot,
    inventorySlotState.itemType,
    inventorySlotState.count,
  );
  return {
    slotId: slot.id,
    acceptRule,
    amount,
    shadowAmount: amount,
  };
}

function createOutputSupplyEntry(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  slot: CompiledSimulationSlotTemplate,
): RuntimeOutputSupplyEntry | null {
  const inventorySlotId = resolveInventorySlotId(state, slot.id);
  const inventorySlot = topology.slots[inventorySlotId] ?? slot;
  const inventorySlotState = state.persistent.slots[inventorySlotId];
  const itemType = inventorySlotState?.itemType ?? inventorySlot.lock;
  if (inventorySlotState === undefined || itemType === null) {
    return null;
  }

  const reservedAmount = getReservedAmount(state, inventorySlotId);
  const amount = inventorySlot.ignoreStock
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0, inventorySlotState.count - reservedAmount);
  if (amount <= 0) {
    return null;
  }

  return {
    slotId: slot.id,
    itemType,
    amount,
    shadowAmount: amount,
  };
}

function resolveInventorySlotId(
  state: SimulationMutableRuntimeState,
  slotId: string,
): string {
  return state.persistent.proxyTargetSlotIdBySourceSlotId[slotId] ?? slotId;
}

function resolveSharedCapacityState(
  state: SimulationMutableRuntimeState,
  slotId: string,
  inventorySlotId: string,
  fallbackCapacity: number,
): {
  readonly capacityLimit: number;
  readonly occupiedCount: number;
} {
  const sharedCapacitySlotIds = state.persistent.sharedCapacitySlotIdsBySlotId[slotId];
  if (sharedCapacitySlotIds === undefined) {
    return {
      capacityLimit: fallbackCapacity,
      occupiedCount: state.persistent.slots[inventorySlotId]?.count ?? 0,
    };
  }

  const visitedInventorySlotIds = new Set<string>();
  let occupiedCount = 0;
  for (const sharedCapacitySlotId of sharedCapacitySlotIds) {
    const sharedInventorySlotId = resolveInventorySlotId(state, sharedCapacitySlotId);
    if (visitedInventorySlotIds.has(sharedInventorySlotId)) {
      continue;
    }

    visitedInventorySlotIds.add(sharedInventorySlotId);
    occupiedCount += state.persistent.slots[sharedInventorySlotId]?.count ?? 0;
  }

  return {
    capacityLimit: state.persistent.sharedCapacityLimitBySlotId[slotId] ?? fallbackCapacity,
    occupiedCount,
  };
}

function createSlotAcceptRule(
  slot: CompiledSimulationSlotTemplate,
  itemType: string | null,
  count: number,
): SimulationAcceptRule {
  if (count > 0 && itemType !== null) {
    return {
      base: { kind: "item", itemId: itemType },
      exclude: [],
    };
  }

  if (slot.lock !== null) {
    return {
      base: { kind: "item", itemId: slot.lock },
      exclude: [],
    };
  }

  if (slot.domain === "solid" || slot.domain === "liquid") {
    return {
      base: { kind: slot.domain },
      exclude: [],
    };
  }

  return {
    base: { kind: "any" },
    exclude: [],
  };
}

function getReservedAmount(
  state: SimulationMutableRuntimeState,
  slotId: string,
): number {
  let reservedAmount = 0;
  for (const deviceState of Object.values(state.persistent.devices)) {
    const recipe = deviceState.recipe;
    if (recipe === null) {
      continue;
    }

    for (const reservation of recipe.reservations) {
      if (reservation.slotId === slotId) {
        reservedAmount += reservation.amount;
      }
    }
  }
  return reservedAmount;
}
