import type {
  CompiledSimulationDevice,
  CompiledSimulationRecipePlan,
  RuntimeGasDiffusionSnapshot,
  CompiledSimulationSlot,
  CompiledSimulationTopology,
  SimulationRecipeType,
} from "../types";

/** 基地电池满容量（焦耳）= 100MJ。940kW 负载约 106 秒耗尽。 */
export const BASE_BATTERY_CAPACITY_J = 100_000_000;

export type RuntimeShadowState = "uncertain" | "accept" | "moved";

export interface SimulationMutableRuntimeState {
  tickNumber: number;
  lastAdvancedTickNumber: number;
  persistent: SimulationPersistentRuntimeState;
  transient: SimulationTickTransientState;
}

export interface SimulationPersistentRuntimeState {
  slots: Record<string, RuntimeSlotState>;
  devices: Record<string, RuntimeDeviceState>;
  /** 准入口跨 tick 计数。key 为 compiled port id。 */
  admissionCounters: Record<string, number>;
  /** 准入口每仿真分钟窗口计数。key 为 compiled port id。 */
  admissionMinuteCounters: Record<string, RuntimeAdmissionMinuteCounterState>;
  routingCursors: Record<string, number>;
  shareAllTargetSlotIdBySourceSlotId: Record<string, string>;
  sharedCapacitySlotIdsBySlotId: Record<string, readonly string[]>;
  sharedCapacityLimitBySlotId: Record<string, number>;
  nextRecipeRunIndex: number;
  /** 运输组件的当前域锁：组件内所有槽位只能存在该物品类型。null 表示组件为空，无限制。 */
  transportComponentDomain: Record<string, string | null>;
  /** 基地电池当前电量（焦耳），进入仿真时满电。 */
  baseBatteryJoules: number;
  /** 配方产出/消耗统计状态（1 分钟滑动窗口） */
  recipeStats: RecipeStatsState;
}

/** 单 tick 配方统计增量 */
export interface RecipeStatsDelta {
  /** 该 tick 内各物品产出数量 */
  produced: Record<string, number>;
  /** 该 tick 内各物品消耗数量 */
  consumed: Record<string, number>;
}

export interface RecipeStatsBucket extends RecipeStatsDelta {
  /** 该 bucket 覆盖的标准 tick 数。 */
  standardTicks: number;
}

/** 配方统计滑动窗口状态 */
export interface RecipeStatsState {
  // AI-CORRECTION 2026-07-03: 统计窗口改为 phase-safe bucket；旧 tick 环形字段仅保留为兼容诊断字段，当前有效窗口见 windowBuckets/activeBucket。
  /** 环形缓冲：最近 N 个 tick 的 delta */
  windowDeltas: RecipeStatsDelta[];
  /** 当前写入游标 */
  windowCursor: number;
  /** 窗口中有效条目数 */
  windowCount: number;
  /** 窗口容量（= standardTickRate × 60） */
  windowCapacity: number;
  /** 当前聚合值：key 为 itemType */
  aggregated: Record<string, { producedPerMinute: number; consumedPerMinute: number }>;
  /** 各物品最后一次发生变化的 tick */
  lastChangedTick: Record<string, number>;
  /** 已封桶的 phase-safe 统计窗口。 */
  windowBuckets: RecipeStatsBucket[];
  /** 正在累积、尚未到 phase-safe 边界的 bucket。 */
  activeBucket: RecipeStatsBucket;
  /** 已封桶窗口当前覆盖的标准 tick 数。 */
  coveredStandardTicks: number;
  /** 已封桶窗口内各物品产出总量。 */
  windowProducedTotals: Record<string, number>;
  /** 已封桶窗口内各物品消耗总量。 */
  windowConsumedTotals: Record<string, number>;
}

export interface RuntimeSlotState {
  itemType: string | null;
  count: number;
}

export interface RuntimeDeviceState {
  block: boolean;
  // AI-CORRECTION 2026-05-13: recipe → channelRecipes.
  // 每个 channel 独立运行一个配方。key 为 channel id。
  channelRecipes: Record<string, RuntimeDeviceRecipeState | null>;
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

export interface RuntimeAdmissionMinuteCounterState {
  windowStartTick: number;
  count: number;
}

export interface SimulationTickTransientState {
  nodes: Record<string, RuntimeTickNodeState>;
  edges: Record<string, RuntimeTickEdgeState>;
  transfers: RuntimeTransferRecord[];
  diagnostics: RuntimeTickDiagnosticRecord[];
  /** Stage 3 增量优化：被阻塞的 input-view node ID 集合，避免 refreshBlockedInputNodesAfterMove 每次全量扫描 nodeOrder。 */
  blockedInputNodeIds: Set<string>;
  /** 当前 tick 的槽位预留量聚合索引；首次查询时构建，后续随配方生命周期增量维护。 */
  reservedAmountByStorageSlotId: Record<string, number> | null;
  /** 当前 tick 判定用气体扩散范围。 */
  activeGasDiffusions: readonly RuntimeGasDiffusionSnapshot[];
  /** Perf 埋点：当前 tick 的热点函数调用计数累积器。仅在 perfEnabled 时非空。 */
  _perf?: SimulationRuntimePerf;
  /** 当前 tick 的配方统计增量（产出/消耗），由各阶段累积，tick 结束时滚入滑动窗口后清空。 */
  recipeStatsDelta: RecipeStatsDelta;
}

export interface SimulationRuntimePerf {
  getReservedCalls: number;
  canOutputProvideCalls: number;
  findInputSlotCalls: number;
  getRemainingCapacityCalls: number;
  selectSourceCalls: number;
  solveOutputEdgeChecks: number;
  inputEdgeLookupCalls: number;
  inputEdgeLookupMs: number;
  outputEdgeLookupCalls: number;
  outputEdgeLookupMs: number;
  edgeIndexFallbackScans: number;
  reservedLookupCalls: number;
  reservedLookupMs: number;
  reservedIndexBuilds: number;
  reservedIndexBuildMs: number;
  reservationAdjustCalls: number;
  recipeFinishCalls: number;
  recipeFinishSuccesses: number;
  recipeFinishFailures: number;
  recipeFinishPreflightMs: number;
  recipeFinishCommitMs: number;
  recipeFinishChangedSlots: number;
}

export type RuntimeNodeResolveState = "unresolved" | "visited" | "blocked-resolved";

export interface RuntimeTickNodeState {
  nodeId: string;
  result: "uncertain" | "solved-run" | "solved-block";
  resolveState: RuntimeNodeResolveState;
  excludedItemTypes: readonly string[];
  acceptedInputEdgeIds: string[];
  acceptedOutputEdgeIds: string[];
  blockReason?: string;
}

export interface RuntimeTickEdgeState {
  edgeId: string;
  shadowPull: RuntimeShadowState;
  shadowPush: RuntimeShadowState;
  // AI-REMOVED 2026-06-12:
  // Reason: edge 的 currentThroughCount 是单 tick 临时计数，不符合准入口跨 tick 上限语义。
  // Trigger: 用户确认 per tick count 应删除。
  // Evidence: 新 admission counter 存放于 SimulationPersistentRuntimeState.admissionCounters。
  // Replacement: persistent.admissionCounters[targetPortId]。
  // Risk: Medium - stage-3 求解需改为查询 target port admissionRule。
  // Human Review: Required
  //
  // Original code:
  // currentThroughCount: number;
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
  const admissionCounters = createInitialAdmissionCounters(topology);
  const admissionMinuteCounters = createInitialAdmissionMinuteCounters(topology);
  const routingCursors: Record<string, number> = {};
  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    if (device === undefined) {
      continue;
    }

    devices[deviceId] = { block: false, channelRecipes: {} };
    for (const [portRef, entry] of Object.entries(device.routing)) {
      routingCursors[`${deviceId}:${portRef}`] = entry.roundRobinSeed;
    }
    for (const portId of device.portIds) {
      const port = topology.ports[portId];
      if (port !== undefined) {
        routingCursors[`${port.deviceId}:${port.portGroupId}:${port.direction}:priority-${port.priorityGroup}`] ??= 0;
      }
    }
  }

  return {
    tickNumber: 0,
    lastAdvancedTickNumber: 0,
    persistent: {
      slots,
      devices,
      admissionCounters,
      admissionMinuteCounters,
      routingCursors,
      ...linkState,
      nextRecipeRunIndex: 1,
      transportComponentDomain: Object.fromEntries(
        Object.keys(topology.transportComponents).map((id) => [id, null]),
      ),
      baseBatteryJoules: BASE_BATTERY_CAPACITY_J,
      recipeStats: createRecipeStatsState(topology.standardTickRate),
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
  state.lastAdvancedTickNumber = options.previousState.tickNumber;
  state.persistent.nextRecipeRunIndex = options.previousState.persistent.nextRecipeRunIndex;
  state.persistent.baseBatteryJoules = options.previousState.persistent.baseBatteryJoules;

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
    for (const portId of nextDevice.portIds) {
      const previousPort = options.previousTopology.ports[portId];
      const nextPort = options.topology.ports[portId];
      if (
        previousPort?.admissionRule !== undefined
        && previousPort.admissionRule !== null
        && nextPort?.admissionRule !== undefined
        && nextPort.admissionRule !== null
        && previousPort.admissionRule.itemId === nextPort.admissionRule.itemId
      ) {
        state.persistent.admissionCounters[portId] =
          options.previousState.persistent.admissionCounters[portId] ?? 0;
        const previousMinuteCounter = options.previousState.persistent.admissionMinuteCounters[portId];
        if (previousMinuteCounter !== undefined) {
          state.persistent.admissionMinuteCounters[portId] =
            cloneAdmissionMinuteCounterState(previousMinuteCounter);
        }
      }
    }
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
    lastAdvancedTickNumber: state.lastAdvancedTickNumber,
    persistent: {
      slots: Object.fromEntries(Object.entries(state.persistent.slots).map(([slotId, slot]) => [
        slotId,
        cloneRuntimeSlotState(slot),
      ])),
      devices: Object.fromEntries(Object.entries(state.persistent.devices).map(([deviceId, device]) => [
        deviceId,
        cloneRuntimeDeviceState(device),
      ])),
      admissionCounters: { ...state.persistent.admissionCounters },
      admissionMinuteCounters: Object.fromEntries(
        Object.entries(state.persistent.admissionMinuteCounters).map(([portId, counter]) => [
          portId,
          cloneAdmissionMinuteCounterState(counter),
        ]),
      ),
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
      baseBatteryJoules: state.persistent.baseBatteryJoules,
      recipeStats: cloneRecipeStatsState(state.persistent.recipeStats),
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
    blockedInputNodeIds: new Set(),
    reservedAmountByStorageSlotId: null,
    activeGasDiffusions: [],
    recipeStatsDelta: createRecipeStatsDelta(),
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

function createInitialAdmissionCounters(
  topology: CompiledSimulationTopology,
): Record<string, number> {
  const counters: Record<string, number> = {};
  for (const portId of topology.ordering.portOrder) {
    const port = topology.ports[portId];
    if (port?.admissionRule !== null && port?.admissionRule !== undefined) {
      counters[portId] = 0;
    }
  }
  return counters;
}

function createInitialAdmissionMinuteCounters(
  topology: CompiledSimulationTopology,
): Record<string, RuntimeAdmissionMinuteCounterState> {
  const counters: Record<string, RuntimeAdmissionMinuteCounterState> = {};
  for (const portId of topology.ordering.portOrder) {
    const port = topology.ports[portId];
    if (port?.admissionRule !== null && port?.admissionRule !== undefined) {
      counters[portId] = { windowStartTick: 0, count: 0 };
    }
  }
  return counters;
}

export function normalizeAdmissionMinuteCountersForCurrentWindow(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  for (const portId of topology.ordering.portOrder) {
    const port = topology.ports[portId];
    if (port?.admissionRule !== null && port?.admissionRule !== undefined) {
      ensureAdmissionMinuteCounterForCurrentWindow(topology, state, portId);
    }
  }
}

export function readAdmissionMinuteCounterForCurrentWindow(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  portId: string,
): RuntimeAdmissionMinuteCounterState {
  return ensureAdmissionMinuteCounterForCurrentWindow(topology, state, portId);
}

export function incrementAdmissionMinuteCounterForCurrentWindow(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  portId: string,
): void {
  const counter = ensureAdmissionMinuteCounterForCurrentWindow(topology, state, portId);
  counter.count += 1;
}

export function resetAdmissionMinuteCounterForCurrentWindow(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  portId: string,
): void {
  state.persistent.admissionMinuteCounters[portId] = {
    windowStartTick: resolveAdmissionMinuteWindowStartTick(state.tickNumber, topology.standardTickRate),
    count: 0,
  };
}

function ensureAdmissionMinuteCounterForCurrentWindow(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  portId: string,
): RuntimeAdmissionMinuteCounterState {
  const windowStartTick = resolveAdmissionMinuteWindowStartTick(state.tickNumber, topology.standardTickRate);
  const counter = state.persistent.admissionMinuteCounters[portId];
  if (counter === undefined || counter.windowStartTick !== windowStartTick) {
    const nextCounter = { windowStartTick, count: 0 };
    state.persistent.admissionMinuteCounters[portId] = nextCounter;
    return nextCounter;
  }
  return counter;
}

function resolveAdmissionMinuteWindowStartTick(
  tickNumber: number,
  standardTickRate: number,
): number {
  const normalizedTickRate = Number.isFinite(standardTickRate) && standardTickRate > 0
    ? Math.floor(standardTickRate)
    : 1;
  const minuteWindowTicks = Math.max(1, normalizedTickRate * 60);
  const currentTick = Math.max(0, Math.trunc(tickNumber));
  return Math.floor(currentTick / minuteWindowTicks) * minuteWindowTicks;
}

function cloneRuntimeSlotState(slot: RuntimeSlotState): RuntimeSlotState {
  return {
    itemType: slot.itemType,
    count: slot.count,
  };
}

function cloneAdmissionMinuteCounterState(
  counter: RuntimeAdmissionMinuteCounterState,
): RuntimeAdmissionMinuteCounterState {
  return {
    windowStartTick: counter.windowStartTick,
    count: counter.count,
  };
}

function cloneRuntimeDeviceState(device: RuntimeDeviceState): RuntimeDeviceState {
  return {
    block: device.block,
    channelRecipes: Object.fromEntries(
      Object.entries(device.channelRecipes).map(([chId, recipe]) => [
        chId,
        recipe === null ? null : {
          ...recipe,
          plan: cloneRecipePlan(recipe.plan),
          reservations: recipe.reservations.map((reservation) => ({ ...reservation })),
          inputItems: recipe.inputItems.map((item) => ({ ...item })),
        },
      ]),
    ),
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
    requiredGasDiffusion: plan.requiredGasDiffusion,
    gasDiffusionOutput: plan.gasDiffusionOutput === null
      ? null
      : { ...plan.gasDiffusionOutput },
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
    blockedInputNodeIds: new Set(transient.blockedInputNodeIds),
    reservedAmountByStorageSlotId: transient.reservedAmountByStorageSlotId === null
      ? null
      : { ...transient.reservedAmountByStorageSlotId },
    activeGasDiffusions: transient.activeGasDiffusions.map((diffusion) => ({
      ...diffusion,
      gridRect: { ...diffusion.gridRect },
    })),
    _perf: transient._perf === undefined ? undefined : { ...transient._perf },
    recipeStatsDelta: {
      produced: { ...transient.recipeStatsDelta.produced },
      consumed: { ...transient.recipeStatsDelta.consumed },
    },
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
        deviceState.channelRecipes = {};
      }
    }
    state.persistent.transportComponentDomain[componentId] = null;
  }
}

// ============================================================
// Recipe stats (1-minute sliding window)
// ============================================================

export function createRecipeStatsDelta(): RecipeStatsDelta {
  return { produced: {}, consumed: {} };
}

export function createRecipeStatsBucket(): RecipeStatsBucket {
  return { standardTicks: 0, produced: {}, consumed: {} };
}

export function createRecipeStatsState(standardTickRate: number): RecipeStatsState {
  const windowCapacity = Math.max(1, standardTickRate * 60); // 1 min simulation time
  return {
    windowDeltas: [],
    windowCursor: 0,
    windowCount: 0,
    windowCapacity,
    aggregated: {},
    lastChangedTick: {},
    windowBuckets: [],
    activeBucket: createRecipeStatsBucket(),
    coveredStandardTicks: 0,
    windowProducedTotals: {},
    windowConsumedTotals: {},
  };
}

export function cloneRecipeStatsState(state: RecipeStatsState): RecipeStatsState {
  return {
    windowDeltas: state.windowDeltas.map((delta) => ({
      produced: { ...delta.produced },
      consumed: { ...delta.consumed },
    })),
    windowCursor: state.windowCursor,
    windowCount: state.windowCount,
    windowCapacity: state.windowCapacity,
    aggregated: Object.fromEntries(
      Object.entries(state.aggregated).map(([itemType, stats]) => [
        itemType,
        { ...stats },
      ]),
    ),
    lastChangedTick: { ...state.lastChangedTick },
    windowBuckets: state.windowBuckets.map(cloneRecipeStatsBucket),
    activeBucket: cloneRecipeStatsBucket(state.activeBucket),
    coveredStandardTicks: state.coveredStandardTicks,
    windowProducedTotals: { ...state.windowProducedTotals },
    windowConsumedTotals: { ...state.windowConsumedTotals },
  };
}

/**
 * 将 tick 的配方统计增量累加到 delta 中。
 */
export function accumulateRecipeStatsDelta(accum: RecipeStatsDelta, inc: RecipeStatsDelta): void {
  for (const [itemType, amount] of Object.entries(inc.produced)) {
    accum.produced[itemType] = (accum.produced[itemType] ?? 0) + amount;
  }
  for (const [itemType, amount] of Object.entries(inc.consumed)) {
    accum.consumed[itemType] = (accum.consumed[itemType] ?? 0) + amount;
  }
}

/**
 * 将当前 tick 的 delta 写入环形缓冲，并重新计算聚合值。
 * 返回聚合后的 per-min 值。
 * AI-CORRECTION 2026-07-03: 当前实现只在 phase-safe 边界封桶；per-min 按已封桶窗口覆盖的标准 tick 数归一。
 */
// AI-REMOVED 2026-07-03:
// Reason: 旧实现把每次 runtime step 当成一个标准 tick 窗口格；动态 tick rate 降频后，1200 格会覆盖超过 60 秒仿真时间。
// Trigger: 用户反馈二倍速下基地仓库统计产出/消耗也被放大，要求统计窗口只能在动态帧率切换点截断。
// Evidence: worker-runtime 在 dynamicTickRate=10 时每 2 个标准 tick 才运行一次，旧 rollRecipeStatsWindow 仍按运行步数填满 1200 格。
// Replacement: 下方 rollRecipeStatsWindow + phase-safe bucket 状态字段。
// Risk: Low - 仓库统计启动前 60 秒可能显示 0，用户确认可接受。
// Human Review: Required
//
// Original code:
// export function rollRecipeStatsWindow(
//   stats: RecipeStatsState,
//   tickDelta: RecipeStatsDelta,
//   tickNumber: number,
// ): void {
//   const capacity = stats.windowCapacity;
//   // 淘汰旧条目
//   if (stats.windowCount >= capacity) {
//     const oldDelta = stats.windowDeltas[stats.windowCursor];
//     if (oldDelta !== undefined) {
//       for (const itemType of Object.keys(oldDelta.produced)) {
//         const entry = stats.aggregated[itemType];
//         if (entry !== undefined) {
//           entry.producedPerMinute -= oldDelta.produced[itemType] ?? 0;
//           if (entry.producedPerMinute < 0) entry.producedPerMinute = 0;
//         }
//       }
//       for (const itemType of Object.keys(oldDelta.consumed)) {
//         const entry = stats.aggregated[itemType];
//         if (entry !== undefined) {
//           entry.consumedPerMinute -= oldDelta.consumed[itemType] ?? 0;
//           if (entry.consumedPerMinute < 0) entry.consumedPerMinute = 0;
//         }
//       }
//     }
//   }
//
//   // 写入新条目
//   stats.windowDeltas[stats.windowCursor] = {
//     produced: { ...tickDelta.produced },
//     consumed: { ...tickDelta.consumed },
//   };
//   stats.windowCursor = (stats.windowCursor + 1) % capacity;
//   stats.windowCount = Math.min(stats.windowCount + 1, capacity);
//
//   // 聚合新条目
//   for (const itemType of Object.keys(tickDelta.produced)) {
//     const entry = stats.aggregated[itemType] ??= { producedPerMinute: 0, consumedPerMinute: 0 };
//     entry.producedPerMinute += tickDelta.produced[itemType] ?? 0;
//     stats.lastChangedTick[itemType] = tickNumber;
//   }
//   for (const itemType of Object.keys(tickDelta.consumed)) {
//     const entry = stats.aggregated[itemType] ??= { producedPerMinute: 0, consumedPerMinute: 0 };
//     entry.consumedPerMinute += tickDelta.consumed[itemType] ?? 0;
//     stats.lastChangedTick[itemType] = tickNumber;
//   }
//
//   // 清理归零的条目
//   for (const itemType of Object.keys(stats.aggregated)) {
//     const entry = stats.aggregated[itemType]!;
//     if (entry.producedPerMinute <= 0 && entry.consumedPerMinute <= 0) {
//       delete stats.aggregated[itemType];
//     }
//   }
// }
export function rollRecipeStatsWindow(
  stats: RecipeStatsState,
  tickDelta: RecipeStatsDelta,
  tickNumber: number,
  elapsedStandardTicks = 1,
  shouldSealBucket = true,
): void {
  const standardTicks = Math.max(1, Math.trunc(elapsedStandardTicks));
  stats.activeBucket.standardTicks += standardTicks;
  accumulateRecipeStatsDelta(stats.activeBucket, tickDelta);

  for (const itemType of Object.keys(tickDelta.produced)) {
    stats.lastChangedTick[itemType] = tickNumber;
  }
  for (const itemType of Object.keys(tickDelta.consumed)) {
    stats.lastChangedTick[itemType] = tickNumber;
  }

  if (!shouldSealBucket) {
    return;
  }

  sealRecipeStatsBucket(stats);
}

function sealRecipeStatsBucket(stats: RecipeStatsState): void {
  const bucket = stats.activeBucket;
  if (bucket.standardTicks <= 0) {
    return;
  }

  const sealedBucket = cloneRecipeStatsBucket(bucket);
  stats.windowBuckets.push(sealedBucket);
  stats.coveredStandardTicks += sealedBucket.standardTicks;
  addRecipeStatsTotals(stats.windowProducedTotals, sealedBucket.produced);
  addRecipeStatsTotals(stats.windowConsumedTotals, sealedBucket.consumed);
  stats.activeBucket = createRecipeStatsBucket();

  trimRecipeStatsWindow(stats);
  refreshRecipeStatsAggregated(stats);
}

function trimRecipeStatsWindow(stats: RecipeStatsState): void {
  while (
    stats.windowBuckets.length > 1
    && stats.coveredStandardTicks - stats.windowBuckets[0]!.standardTicks >= stats.windowCapacity
  ) {
    const removed = stats.windowBuckets.shift()!;
    stats.coveredStandardTicks -= removed.standardTicks;
    subtractRecipeStatsTotals(stats.windowProducedTotals, removed.produced);
    subtractRecipeStatsTotals(stats.windowConsumedTotals, removed.consumed);
  }
  stats.windowCount = stats.windowBuckets.length;
}

function refreshRecipeStatsAggregated(stats: RecipeStatsState): void {
  stats.aggregated = {};
  if (stats.coveredStandardTicks < stats.windowCapacity) {
    return;
  }

  const normalization = stats.windowCapacity / stats.coveredStandardTicks;
  const itemTypes = new Set([
    ...Object.keys(stats.windowProducedTotals),
    ...Object.keys(stats.windowConsumedTotals),
  ]);
  for (const itemType of itemTypes) {
    const producedPerMinute = (stats.windowProducedTotals[itemType] ?? 0) * normalization;
    const consumedPerMinute = (stats.windowConsumedTotals[itemType] ?? 0) * normalization;
    if (producedPerMinute <= 0 && consumedPerMinute <= 0) {
      continue;
    }
    stats.aggregated[itemType] = { producedPerMinute, consumedPerMinute };
  }
}

function addRecipeStatsTotals(
  target: Record<string, number>,
  source: Record<string, number>,
): void {
  for (const [itemType, amount] of Object.entries(source)) {
    target[itemType] = (target[itemType] ?? 0) + amount;
  }
}

function subtractRecipeStatsTotals(
  target: Record<string, number>,
  source: Record<string, number>,
): void {
  for (const [itemType, amount] of Object.entries(source)) {
    const next = (target[itemType] ?? 0) - amount;
    if (next > 0) target[itemType] = next;
    else delete target[itemType];
  }
}

function cloneRecipeStatsBucket(bucket: RecipeStatsBucket): RecipeStatsBucket {
  return {
    standardTicks: bucket.standardTicks,
    produced: { ...bucket.produced },
    consumed: { ...bucket.consumed },
  };
}
