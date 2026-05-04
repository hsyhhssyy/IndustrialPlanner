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
    const cacheGroup = topology.cacheGroups[cacheGroupId];
    const nodeState = state.transient.nodes[cacheGroupId];
    if (cacheGroup === undefined || nodeState === undefined) {
      continue;
    }

    const inputCapacities: RuntimeInputCapacityEntry[] = [];
    const outputSupplies: RuntimeOutputSupplyEntry[] = [];

    for (const slotId of cacheGroup.slotIds) {
      const slot = topology.slots[slotId];
      const slotState = state.persistent.slots[slotId];
      if (slot === undefined || slotState === undefined) {
        continue;
      }

      if (cacheGroup.inputPortIds.length > 0) {
        const inputEntry = createInputCapacityEntry(topology, state, slot);
        if (inputEntry !== null) {
          inputCapacities.push(inputEntry);
        }
      }

      if (cacheGroup.outputPortIds.length > 0) {
        const outputEntry = createOutputSupplyEntry(topology, state, slot);
        if (outputEntry !== null) {
          outputSupplies.push(outputEntry);
        }
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

    nodeState.inputCapacities = inputCapacities;
    nodeState.outputSupplies = outputSupplies;
    nodeState.isDeleted = inputCapacities.length === 0 && outputSupplies.length === 0;
  }

  for (const edgeId of topology.ordering.edgeOrder) {
    const edge = topology.transferEdges[edgeId];
    const edgeState = state.transient.edges[edgeId];
    if (edge === undefined || edgeState === undefined) {
      continue;
    }

    const sourceNode = state.transient.nodes[edge.sourceCacheGroupId];
    const targetNode = state.transient.nodes[edge.targetCacheGroupId];
    if (sourceNode?.isDeleted !== false || targetNode?.isDeleted !== false) {
      edgeState.isDeleted = true;
    }
  }
}

function createInputCapacityEntry(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  slot: CompiledSimulationSlotTemplate,
): RuntimeInputCapacityEntry | null {
  const storageSlotId = resolveStorageSlotId(state, slot.id);
  const storageSlot = topology.slots[storageSlotId] ?? slot;
  const slotState = state.persistent.slots[storageSlotId];
  if (slotState === undefined) {
    return null;
  }

  const amount = Math.max(0, storageSlot.capacity - slotState.count);
  if (amount <= 0) {
    return null;
  }

  const acceptRule = createSlotAcceptRule(storageSlot, slotState.itemType, slotState.count);
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
  const storageSlotId = resolveStorageSlotId(state, slot.id);
  const storageSlot = topology.slots[storageSlotId] ?? slot;
  const slotState = state.persistent.slots[storageSlotId];
  const itemType = slotState?.itemType ?? storageSlot.lock;
  if (slotState === undefined || itemType === null) {
    return null;
  }

  const reservedAmount = getReservedAmount(state, storageSlotId);
  const amount = storageSlot.ignoreStock
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0, slotState.count - reservedAmount);
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

function resolveStorageSlotId(
  state: SimulationMutableRuntimeState,
  slotId: string,
): string {
  return state.persistent.proxyTargetSlotIdBySourceSlotId[slotId] ?? slotId;
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
