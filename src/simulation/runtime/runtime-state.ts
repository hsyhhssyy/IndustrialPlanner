import type {
  CompiledSimulationRecipePlan,
  CompiledSimulationTopology,
  SimulationRecipeType,
} from "../types";

export type RuntimeShadowState = "uncertain" | "accept" | "moved";

export interface SimulationMutableRuntimeState {
  tickNumber: number;
  persistent: SimulationPersistentRuntimeState;
  transient: SimulationTickTransientState;
}

export interface SimulationPersistentRuntimeState {
  slots: Record<string, RuntimeSlotState>;
  devices: Record<string, RuntimeDeviceState>;
  routingCursors: Record<string, number>;
  shareAllTargetSlotIdBySourceSlotId: Record<string, string>;
  sharedCapacitySlotIdsBySlotId: Record<string, readonly string[]>;
  sharedCapacityLimitBySlotId: Record<string, number>;
  nextRecipeRunIndex: number;
}

export interface RuntimeSlotState {
  itemType: string | null;
  count: number;
}

export interface RuntimeDeviceState {
  block: boolean;
  recipe: RuntimeDeviceRecipeState | null;
}

export interface RuntimeDeviceRecipeState {
  runId: string;
  recipeId: string;
  recipeType: SimulationRecipeType;
  progressTicks: number;
  durationTicks: number;
  state: "running" | "waiting-output";
  plan: CompiledSimulationRecipePlan;
  reservations: RuntimeReservedItem[];
  inputItems: RuntimeRecipeItem[];
}

export interface RuntimeRecipeItem {
  itemType: string;
  amount: number;
}

export interface RuntimeReservedItem {
  slotId: string;
  itemType: string;
  amount: number;
}

export interface SimulationTickTransientState {
  nodes: Record<string, RuntimeTickNodeState>;
  edges: Record<string, RuntimeTickEdgeState>;
  transfers: RuntimeTransferRecord[];
  diagnostics: RuntimeTickDiagnosticRecord[];
}

export interface RuntimeTickNodeState {
  nodeId: string;
  result: "uncertain" | "solved-run" | "solved-block";
  visited: boolean;
  excludedItemTypes: readonly string[];
  acceptedInputEdgeIds: string[];
  acceptedOutputEdgeIds: string[];
  blockReason?: string;
}

export interface RuntimeTickEdgeState {
  edgeId: string;
  shadowPull: RuntimeShadowState;
  shadowPush: RuntimeShadowState;
  currentThroughCount: number;
  sourceSlotId: string | null;
  targetSlotId: string | null;
  itemType: string | null;
  amount: number;
}

export interface RuntimeTransferRecord {
  edgeId: string;
  sourceSlotId: string;
  targetSlotId: string;
  itemType: string;
  amount: number;
}

export interface RuntimeTickDiagnosticRecord {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
}

export function createSimulationMutableRuntimeState(
  topology: CompiledSimulationTopology,
): SimulationMutableRuntimeState {
  const slots: Record<string, RuntimeSlotState> = {};
  for (const slotId of topology.ordering.slotOrder) {
    const slot = topology.slots[slotId];
    if (slot === undefined) {
      continue;
    }

    slots[slotId] = {
      itemType: slot.initialItemType ?? slot.lock,
      count: Math.max(0, slot.initialCount),
    };
  }

  const linkState = buildRuntimeLinkState(topology);
  normalizeShareAllSources(slots, linkState.shareAllTargetSlotIdBySourceSlotId);

  const devices: Record<string, RuntimeDeviceState> = {};
  const routingCursors: Record<string, number> = {};
  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    if (device === undefined) {
      continue;
    }

    devices[deviceId] = { block: false, recipe: null };
    for (const [portRef, entry] of Object.entries(device.routing)) {
      routingCursors[`${deviceId}:${portRef}`] = entry.roundRobinSeed;
    }
  }

  return {
    tickNumber: 0,
    persistent: {
      slots,
      devices,
      routingCursors,
      ...linkState,
      nextRecipeRunIndex: 1,
    },
    transient: createEmptyTransientState(),
  };
}

export function createEmptyTransientState(): SimulationTickTransientState {
  return {
    nodes: {},
    edges: {},
    transfers: [],
    diagnostics: [],
  };
}

function buildRuntimeLinkState(topology: CompiledSimulationTopology): Pick<
  SimulationPersistentRuntimeState,
  "shareAllTargetSlotIdBySourceSlotId" | "sharedCapacitySlotIdsBySlotId" | "sharedCapacityLimitBySlotId"
> {
  const shareAllTargetSlotIdBySourceSlotId: Record<string, string> = {};
  const sharedCapacitySlotIdsBySlotId: Record<string, readonly string[]> = {};
  const sharedCapacityLimitBySlotId: Record<string, number> = {};

  for (const link of Object.values(topology.links)) {
    if (link.linkType === "share-all") {
      Object.assign(shareAllTargetSlotIdBySourceSlotId, link.targetSlotIdBySourceSlotId);
      continue;
    }

    const componentSlotIds = [...new Set([...link.sourceSlotIds, ...link.targetSlotIds])].sort();
    const capacityLimit = Math.max(
      0,
      ...componentSlotIds.map((slotId) => topology.slots[slotId]?.capacity ?? 0),
    );
    for (const slotId of componentSlotIds) {
      sharedCapacitySlotIdsBySlotId[slotId] = componentSlotIds;
      sharedCapacityLimitBySlotId[slotId] = capacityLimit;
    }
  }

  return {
    shareAllTargetSlotIdBySourceSlotId,
    sharedCapacitySlotIdsBySlotId,
    sharedCapacityLimitBySlotId,
  };
}

function normalizeShareAllSources(
  slots: Record<string, RuntimeSlotState>,
  targetSlotIdBySourceSlotId: Readonly<Record<string, string>>,
): void {
  for (const [sourceSlotId, targetSlotId] of Object.entries(targetSlotIdBySourceSlotId)) {
    const source = slots[sourceSlotId];
    const target = slots[targetSlotId];
    if (source === undefined || target === undefined) {
      continue;
    }

    if (target.itemType === null && source.itemType !== null) {
      target.itemType = source.itemType;
    }
    target.count += source.count;
    source.itemType = null;
    source.count = 0;
  }
}
