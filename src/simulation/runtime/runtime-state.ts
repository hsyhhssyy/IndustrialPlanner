import type {
  CompiledSimulationRecipePlan,
  CompiledSimulationTopology,
  SimulationAcceptRule,
  SimulationRecipeType,
} from "@/domain/types/simulation";
import { getRuntimeLinkTopologyState } from "./cache-link-topology";

export type RuntimeShadowState = "uncertain" | "accept";

export interface SimulationMutableRuntimeState {
  tickNumber: number;
  persistent: SimulationPersistentRuntimeState;
  transient: SimulationTickTransientState;
}

export interface SimulationPersistentRuntimeState {
  slots: Record<string, RuntimeSlotState>;
  devices: Record<string, RuntimeDeviceState>;
  routingCursors: Record<string, number>;
  proxyTargetSlotIdBySourceSlotId: Record<string, string>;
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
  cacheGroupId: string;
  isDeleted: boolean;
  result: "uncertain" | "solved-run" | "solved-block";
  inputCapacities: RuntimeInputCapacityEntry[];
  outputSupplies: RuntimeOutputSupplyEntry[];
  acceptedInputEdgeIds: string[];
  acceptedOutputEdgeIds: string[];
  blockReason?: string;
}

export interface RuntimeInputCapacityEntry {
  slotId: string;
  acceptRule: SimulationAcceptRule;
  amount: number;
  shadowAmount: number;
}

export interface RuntimeOutputSupplyEntry {
  slotId: string;
  itemType: string;
  amount: number;
  shadowAmount: number;
}

export interface RuntimeTickEdgeState {
  edgeId: string;
  isDeleted: boolean;
  shadowPull: RuntimeShadowState;
  shadowPush: RuntimeShadowState;
  remainingCount: number;
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

  const linkTopologyState = getRuntimeLinkTopologyState(topology);
  const proxyTargetSlotIdBySourceSlotId = {
    ...linkTopologyState.shareAllTargetSlotIdBySourceSlotId,
  };
  for (const [sourceSlotId, targetSlotId] of Object.entries(proxyTargetSlotIdBySourceSlotId)) {
    const sourceSlot = slots[sourceSlotId];
    const targetSlot = slots[targetSlotId];
    if (sourceSlot === undefined || targetSlot === undefined) {
      continue;
    }
    if (sourceSlot.count > 0) {
      if (targetSlot.itemType === null) {
        targetSlot.itemType = sourceSlot.itemType;
      }
      if (sourceSlot.itemType === targetSlot.itemType || sourceSlot.itemType === null) {
        targetSlot.count += sourceSlot.count;
      }
    }
    sourceSlot.itemType = null;
    sourceSlot.count = 0;
  }

  const devices: Record<string, RuntimeDeviceState> = {};
  const routingCursors: Record<string, number> = {};
  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    if (device === undefined) {
      continue;
    }

    devices[deviceId] = {
      block: false,
      recipe: null,
    };

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
      proxyTargetSlotIdBySourceSlotId,
      sharedCapacitySlotIdsBySlotId: {
        ...linkTopologyState.sharedCapacitySlotIdsBySlotId,
      },
      sharedCapacityLimitBySlotId: {
        ...linkTopologyState.sharedCapacityLimitBySlotId,
      },
      nextRecipeRunIndex: 1,
    },
    transient: {
      nodes: {},
      edges: {},
      transfers: [],
      diagnostics: [],
    },
  };
}