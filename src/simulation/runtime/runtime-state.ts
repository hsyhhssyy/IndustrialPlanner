import type {
  CompiledSimulationDevice,
  CompiledSimulationRecipePlan,
  CompiledSimulationSlot,
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
  /** 运输组件的当前域锁：组件内所有槽位只能存在该物品类型。null 表示组件为空，无限制。 */
  transportComponentDomain: Record<string, string | null>;
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

    slots[slotId] = createInitialSlotState(slot);
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
      transportComponentDomain: Object.fromEntries(
        Object.keys(topology.transportComponents).map((id) => [id, null]),
      ),
    },
    transient: createEmptyTransientState(),
  };
}

export interface SimulationRuntimeStateMigrationOptions {
  readonly previousTopology: CompiledSimulationTopology;
  readonly previousState: SimulationMutableRuntimeState;
  readonly topology: CompiledSimulationTopology;
  readonly resetDeviceIds: readonly string[];
}

export function createMigratedSimulationMutableRuntimeState(
  options: SimulationRuntimeStateMigrationOptions,
): SimulationMutableRuntimeState {
  const state = createSimulationMutableRuntimeState(options.topology);
  const resetDeviceIds = new Set(options.resetDeviceIds);

  state.tickNumber = options.previousState.tickNumber;
  state.persistent.nextRecipeRunIndex = options.previousState.persistent.nextRecipeRunIndex;

  for (const deviceId of options.topology.ordering.deviceOrder) {
    if (resetDeviceIds.has(deviceId)) {
      continue;
    }

    const previousDevice = options.previousTopology.devices[deviceId];
    const nextDevice = options.topology.devices[deviceId];
    const previousDeviceState = options.previousState.persistent.devices[deviceId];
    if (previousDevice === undefined || nextDevice === undefined || previousDeviceState === undefined) {
      continue;
    }

    for (const slotId of listDeviceSlotIds(options.topology, nextDevice)) {
      const previousSlotState = options.previousState.persistent.slots[slotId];
      if (previousSlotState !== undefined) {
        state.persistent.slots[slotId] = cloneRuntimeSlotState(previousSlotState);
      }
    }

    state.persistent.devices[deviceId] = cloneRuntimeDeviceState(previousDeviceState);
    for (const cursorKey of Object.keys(state.persistent.routingCursors)) {
      if (!cursorKey.startsWith(`${deviceId}:`)) {
        continue;
      }
      const previousCursor = options.previousState.persistent.routingCursors[cursorKey];
      if (previousCursor !== undefined) {
        state.persistent.routingCursors[cursorKey] = previousCursor;
      }
    }
  }

  normalizeShareAllSources(state.persistent.slots, state.persistent.shareAllTargetSlotIdBySourceSlotId);
  resetConflictingTransportComponents(options.topology, state);
  return state;
}

export function cloneSimulationMutableRuntimeState(
  state: SimulationMutableRuntimeState,
): SimulationMutableRuntimeState {
  return {
    tickNumber: state.tickNumber,
    persistent: {
      slots: Object.fromEntries(Object.entries(state.persistent.slots).map(([slotId, slot]) => [
        slotId,
        cloneRuntimeSlotState(slot),
      ])),
      devices: Object.fromEntries(Object.entries(state.persistent.devices).map(([deviceId, device]) => [
        deviceId,
        cloneRuntimeDeviceState(device),
      ])),
      routingCursors: { ...state.persistent.routingCursors },
      shareAllTargetSlotIdBySourceSlotId: { ...state.persistent.shareAllTargetSlotIdBySourceSlotId },
      sharedCapacitySlotIdsBySlotId: Object.fromEntries(
        Object.entries(state.persistent.sharedCapacitySlotIdsBySlotId).map(([slotId, slotIds]) => [
          slotId,
          [...slotIds],
        ]),
      ),
      sharedCapacityLimitBySlotId: { ...state.persistent.sharedCapacityLimitBySlotId },
      nextRecipeRunIndex: state.persistent.nextRecipeRunIndex,
      transportComponentDomain: { ...state.persistent.transportComponentDomain },
    },
    transient: cloneTransientState(state.transient),
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

function createInitialSlotState(slot: CompiledSimulationSlot): RuntimeSlotState {
  return {
    itemType: slot.initialItemType ?? slot.lock,
    count: Math.max(0, slot.initialCount),
  };
}

function cloneRuntimeSlotState(slot: RuntimeSlotState): RuntimeSlotState {
  return {
    itemType: slot.itemType,
    count: slot.count,
  };
}

function cloneRuntimeDeviceState(device: RuntimeDeviceState): RuntimeDeviceState {
  return {
    block: device.block,
    recipe: device.recipe === null
      ? null
      : {
          ...device.recipe,
          plan: cloneRecipePlan(device.recipe.plan),
          reservations: device.recipe.reservations.map((reservation) => ({ ...reservation })),
          inputItems: device.recipe.inputItems.map((item) => ({ ...item })),
        },
  };
}

function cloneRecipePlan(plan: CompiledSimulationRecipePlan): CompiledSimulationRecipePlan {
  return {
    recipeId: plan.recipeId,
    recipeType: plan.recipeType,
    durationTicks: plan.durationTicks,
    inputs: plan.inputs.map((input) => ({ ...input })),
    outputs: plan.outputs.map((output) => ({ ...output })),
    ingredientNodeIds: [...plan.ingredientNodeIds],
    productNodeIds: [...plan.productNodeIds],
  };
}

function cloneTransientState(transient: SimulationTickTransientState): SimulationTickTransientState {
  return {
    nodes: Object.fromEntries(Object.entries(transient.nodes).map(([nodeId, node]) => [
      nodeId,
      {
        ...node,
        excludedItemTypes: [...node.excludedItemTypes],
        acceptedInputEdgeIds: [...node.acceptedInputEdgeIds],
        acceptedOutputEdgeIds: [...node.acceptedOutputEdgeIds],
      },
    ])),
    edges: Object.fromEntries(Object.entries(transient.edges).map(([edgeId, edge]) => [
      edgeId,
      { ...edge },
    ])),
    transfers: transient.transfers.map((transfer) => ({ ...transfer })),
    diagnostics: transient.diagnostics.map((diagnostic) => ({ ...diagnostic })),
  };
}

function listDeviceSlotIds(
  topology: CompiledSimulationTopology,
  device: CompiledSimulationDevice,
): readonly string[] {
  return device.nodeIds.flatMap((nodeId) => topology.nodes[nodeId]?.slotIds ?? []);
}

function resetConflictingTransportComponents(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  for (const [componentId, component] of Object.entries(topology.transportComponents)) {
    const itemTypes = new Set<string>();
    for (const slotId of component.slotIds) {
      const slotState = state.persistent.slots[slotId];
      if (slotState !== undefined && slotState.count > 0 && slotState.itemType !== null) {
        itemTypes.add(slotState.itemType);
      }
    }

    if (itemTypes.size <= 1) {
      state.persistent.transportComponentDomain[componentId] = [...itemTypes][0] ?? null;
      continue;
    }

    for (const slotId of component.slotIds) {
      const slot = topology.slots[slotId];
      if (slot !== undefined) {
        state.persistent.slots[slotId] = createInitialSlotState(slot);
      }
    }
    for (const deviceId of component.deviceIds) {
      const deviceState = state.persistent.devices[deviceId];
      if (deviceState !== undefined) {
        deviceState.block = false;
        deviceState.recipe = null;
      }
    }
    state.persistent.transportComponentDomain[componentId] = null;
  }
}
