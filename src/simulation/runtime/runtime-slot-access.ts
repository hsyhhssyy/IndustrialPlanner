import type {
  CompiledSimulationDevice,
  CompiledSimulationNode,
  CompiledSimulationRecipeChannel,
  CompiledSimulationRecipeDefinition,
  CompiledSimulationRecipeItem,
  CompiledSimulationRecipePlan,
  CompiledSimulationSlot,
  CompiledSimulationTopology,
  SimulationAcceptRule,
  SimulationItemDomain,
  SimulationItemDomainFilter,
} from "../types";
import type {
  RuntimeDeviceRecipeState,
  RuntimeRecipeItem,
  RuntimeReservedItem,
  RuntimeSlotState,
  SimulationMutableRuntimeState,
} from "./runtime-state";
import {
  canRecipeFinishAtCurrentPhase,
  resolveTransportRecipeTiming,
} from "./phase-gating";
import { isDeviceInRequiredGasDiffusion } from "./gas-diffusion";
import {
  WATER_PURIFIER_BYPRODUCT_CHANNEL_ID,
  WATER_PURIFIER_BYPRODUCT_RECIPE_ID,
  WATER_PURIFIER_COLLECT_RECIPE_ID,
  WATER_PURIFIER_INTAKE_CHANNEL_IDS,
  WATER_PURIFIER_NODE_ENTITY_ID,
} from "@/shared/water-purifier-node";

const WAREHOUSE_SINK_TAG = "WarehouseSink";

/**
 * 配方计划只依赖已编译拓扑中的设备、channel 与配方定义；运行时库存只决定该计划当前能否启动。
 * 用 WeakMap 将计划生命周期绑定到 topology，避免每次启动配方以及每个历史检查点重复创建同一静态对象。
 */
const recipePlanCacheByTopology = new WeakMap<
  CompiledSimulationTopology,
  Map<string, Map<string, Map<string, CompiledSimulationRecipePlan>>>
>();

export interface IngredientSlotContent {
  readonly slotId: string;
  readonly itemType: string;
  readonly availableAmount: number;
}

export function resolveStorageSlotId(
  state: SimulationMutableRuntimeState,
  slotId: string,
): string {
  const visited = new Set<string>();
  let current = slotId;

  while (true) {
    if (visited.has(current)) {
      return slotId;
    }
    visited.add(current);

    const next = state.persistent.shareAllTargetSlotIdBySourceSlotId[current];
    if (next === undefined || next === current) {
      return current;
    }

    current = next;
  }
}

/**
 * 沿 share-all 链向上查找 ignoreStock。
 * 若链上任意槽位 ignoreStock=true，则整个链条视为无限输出。
 * 对应《仿真运行原理》§7.2 share-all 写入代理模型 ——
 *   source 端读写全部代理到 target 端存储，ignoreStock 作为 slot 属性应沿链继承。
 * 订正（2026-05-15）：ignoreStock 不再仅是编译槽位局部属性，支持跨链 OR 语义。
 * AI-CORRECTION 2026-07-16: 无限库存同时适用于物流供给和配方原料，配方匹配、预定与消耗均不得受实际数量限制。
 */
export function resolveEffectiveIgnoreStock(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  slotId: string,
): boolean {
  const visited = new Set<string>();
  let current = slotId;

  while (true) {
    if (visited.has(current)) {
      // 防御性：避免因数据错误导致死循环
      return false;
    }
    visited.add(current);

    const slot = topology.slots[current];
    if (slot?.ignoreStock) {
      return true;
    }

    const next = state.persistent.shareAllTargetSlotIdBySourceSlotId[current];
    if (next === undefined || next === current) {
      return false;
    }

    current = next;
  }
}

export function getReservedAmount(
  state: SimulationMutableRuntimeState,
  storageSlotId: string,
): number {
  const perf = state.transient._perf;
  const lookupStartedAt = perf === undefined ? 0 : performance.now();
  if (perf !== undefined) {
    perf.getReservedCalls += 1;
    perf.reservedLookupCalls += 1;
  }

  if (state.transient.reservedAmountByStorageSlotId === null) {
    const buildStartedAt = perf === undefined ? 0 : performance.now();
    const index: Record<string, number> = {};
    for (const deviceState of Object.values(state.persistent.devices)) {
      for (const recipe of Object.values(deviceState.channelRecipes)) {
        if (recipe === null) continue;
        for (const reservation of recipe.reservations) {
          if (reservation.ignoreStock) continue;
          index[reservation.slotId] = (index[reservation.slotId] ?? 0) + reservation.amount;
        }
      }
    }
    state.transient.reservedAmountByStorageSlotId = index;
    if (perf !== undefined) {
      perf.reservedIndexBuilds += 1;
      perf.reservedIndexBuildMs += performance.now() - buildStartedAt;
    }
  }

  const result = state.transient.reservedAmountByStorageSlotId[storageSlotId] ?? 0;
  if (perf !== undefined) {
    perf.reservedLookupMs += performance.now() - lookupStartedAt;
  }
  return result;
}

export function adjustReservedAmounts(
  state: SimulationMutableRuntimeState,
  reservations: readonly RuntimeReservedItem[],
  direction: 1 | -1,
): void {
  const index = state.transient.reservedAmountByStorageSlotId;
  if (index === null || reservations.length === 0) return;
  const perf = state.transient._perf;
  if (perf !== undefined) perf.reservationAdjustCalls += 1;
  for (const reservation of reservations) {
    if (reservation.ignoreStock) continue;
    const next = (index[reservation.slotId] ?? 0) + reservation.amount * direction;
    if (next > 0) index[reservation.slotId] = next;
    else delete index[reservation.slotId];
  }
}

export function acceptsItem(
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
    case "gas":
      return getItemDomain(topology, itemType) === rule.base.kind;
    case "fluid": {
      const domain = getItemDomain(topology, itemType);
      return domain === "liquid" || domain === "gas";
    }
    case "item":
      return rule.base.itemId === itemType;
    case "none":
      return false;
  }
}

export function findInputSlotForItem(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  node: CompiledSimulationNode;
  itemType: string;
}): string | null {
  const perf = options.state.transient._perf;
  if (perf !== undefined) { perf.findInputSlotCalls += 1; }

  // 运输组件域锁检查：若该节点所属组件已锁定为其他物品类型，拒绝接受。
  const device = options.topology.devices[options.node.deviceId];
  const componentId = device?.transportComponentId ?? null;
  if (componentId !== null) {
    const domain = options.state.persistent.transportComponentDomain[componentId];
    if (domain !== null && domain !== options.itemType) {
      return null;
    }
  }

  const warehouseSinkSlotId = findWarehouseSinkTargetSlotForItem({
    topology: options.topology,
    state: options.state,
    node: options.node,
    itemType: options.itemType,
  });
  if (warehouseSinkSlotId !== null) {
    return warehouseSinkSlotId;
  }

  const nodeState = options.state.transient.nodes[options.node.id];
  const excluded = new Set(nodeState?.excludedItemTypes ?? []);

  for (const slotId of options.node.slotIds) {
    const slot = options.topology.slots[slotId];
    if (slot === undefined || !slotCanHold(options.topology, slot, options.itemType)) {
      continue;
    }

    const storageSlotId = resolveStorageSlotId(options.state, slotId);
    const slotState = options.state.persistent.slots[storageSlotId];
    if (slotState === undefined || getRemainingCapacity(options.topology, options.state, slotId) <= 0) {
      continue;
    }

    if (slotState.itemType === options.itemType) {
      return slotId;
    }
    if (slotState.count === 0 && slotState.itemType === null && !excluded.has(options.itemType)) {
      return slotId;
    }
  }

  return null;
}

function findWarehouseSinkTargetSlotForItem(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  node: CompiledSimulationNode;
  itemType: string;
}): string | null {
  if (!isWarehouseSinkInputNode(options.topology, options.node)) {
    return null;
  }

  const warehouseSlotId = findWarehouseSlotId(options.topology, options.itemType);
  if (warehouseSlotId === null) {
    return null;
  }

  const slot = options.topology.slots[warehouseSlotId];
  if (slot === undefined || !slotCanHold(options.topology, slot, options.itemType)) {
    return null;
  }

  return getRemainingCapacity(options.topology, options.state, warehouseSlotId) > 0
    ? warehouseSlotId
    : null;
}

function isWarehouseSinkInputNode(
  topology: CompiledSimulationTopology,
  node: CompiledSimulationNode,
): boolean {
  if (node.viewRole !== "input-view") {
    return false;
  }

  const device = topology.devices[node.deviceId];
  return device?.tags.includes(WAREHOUSE_SINK_TAG) === true;
}

function findWarehouseSlotId(
  topology: CompiledSimulationTopology,
  itemType: string,
): string | null {
  const warehouseDevice = Object.values(topology.devices).find((device) => device.definitionId === "warehouse");
  if (warehouseDevice === undefined) {
    return null;
  }

  const warehouseSlotId = `${warehouseDevice.id}/node:warehouse/slot:${itemType}`;
  return topology.slots[warehouseSlotId] === undefined ? null : warehouseSlotId;
}

export function findOutputSlotForItem(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  node: CompiledSimulationNode;
  itemType: string;
}): string | null {
  for (const slotId of options.node.slotIds) {
    const slot = options.topology.slots[slotId];
    const storageSlotId = resolveStorageSlotId(options.state, slotId);
    const slotState = options.state.persistent.slots[storageSlotId];
    const itemType = slotState?.itemType ?? slot?.lock ?? null;
    if (slot === undefined || slotState === undefined || itemType !== options.itemType) {
      continue;
    }

    if (resolveEffectiveIgnoreStock(options.topology, options.state, slotId) || slotState.count - getReservedAmount(options.state, storageSlotId) > 0) {
      return slotId;
    }
  }

  return null;
}

export function canOutputSlotProvideItem(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  sourceSlotId: string;
  itemType: string;
}): boolean {
  const perf = options.state.transient._perf;
  if (perf !== undefined) { perf.canOutputProvideCalls += 1; }

  const slot = options.topology.slots[options.sourceSlotId];
  const storageSlotId = resolveStorageSlotId(options.state, options.sourceSlotId);
  const slotState = options.state.persistent.slots[storageSlotId];
  const itemType = slotState?.itemType ?? slot?.lock ?? null;
  if (slot === undefined || slotState === undefined || itemType !== options.itemType) {
    return false;
  }

  return resolveEffectiveIgnoreStock(options.topology, options.state, options.sourceSlotId) || slotState.count - getReservedAmount(options.state, storageSlotId) > 0;
}

export function moveOneItem(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  sourceSlotId: string;
  targetSlotId: string;
  itemType: string;
  /** true 时目标是销毁型虚拟入口：来源扣除后不写入目标库存。 */
  consumeAtTarget?: boolean;
}): boolean {
  const sourceSlot = options.topology.slots[options.sourceSlotId];
  const targetSlot = options.topology.slots[options.targetSlotId];
  const sourceStorageSlotId = resolveStorageSlotId(options.state, options.sourceSlotId);
  const targetStorageSlotId = resolveStorageSlotId(options.state, options.targetSlotId);
  const sourceState = options.state.persistent.slots[sourceStorageSlotId];
  const targetState = options.state.persistent.slots[targetStorageSlotId];
  if (
    sourceSlot === undefined
    || targetSlot === undefined
    || sourceState === undefined
    || targetState === undefined
  ) {
    return false;
  }

  if (!canOutputSlotProvideItem({
    topology: options.topology,
    state: options.state,
    sourceSlotId: options.sourceSlotId,
    itemType: options.itemType,
  })) {
    return false;
  }

  if (!slotCanHold(options.topology, targetSlot, options.itemType)) {
    return false;
  }

  if (targetState.itemType !== null && targetState.itemType !== options.itemType) {
    return false;
  }

  if (getRemainingCapacity(options.topology, options.state, options.targetSlotId) <= 0) {
    return false;
  }

  if (!resolveEffectiveIgnoreStock(options.topology, options.state, options.sourceSlotId)) {
    sourceState.count = Math.max(0, sourceState.count - 1);
    if (sourceState.count === 0) {
      sourceState.itemType = null;
    }
  }

  if (options.consumeAtTarget === true) {
    return true;
  }

  targetState.itemType = targetState.itemType ?? options.itemType;
  targetState.count += 1;
  return true;
}

export function createStartableRecipeForChannel(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  device: CompiledSimulationDevice;
  channel: CompiledSimulationRecipeChannel;
}): RuntimeDeviceRecipeState | null {
  for (const plan of resolveDeviceRecipePlans({
    topology: options.topology,
    state: options.state,
    device: options.device,
    channel: options.channel,
  })) {
    const reservations = selectRecipeInputs({
      topology: options.topology,
      state: options.state,
      plan,
    });
    if (reservations === null) {
      continue;
    }

    const runId = `recipe-run:${options.state.persistent.nextRecipeRunIndex}`;
    options.state.persistent.nextRecipeRunIndex += 1;
    return {
      runId,
      recipeId: plan.recipeId,
      recipeType: plan.recipeType,
      progressTicks: 0,
      durationTicks: plan.durationTicks,
      state: "running",
      plan,
      reservations,
      inputItems: aggregateInputItems(reservations),
    };
  }

  return null;
}

// AI-CORRECTION 2026-05-13: resolveDeviceRecipePlans 现在接受 channel 级参数。
// ingredientNodeIds / productNodeIds 从 channel 获取而非从 device 全局获取。
// AI-CORRECTION 2026-05-14: 签名重构为 device + channel 对象，消除字段散落导致的传参遗漏 bug。
export function resolveDeviceRecipePlans(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  device: CompiledSimulationDevice;
  channel: CompiledSimulationRecipeChannel;
}): readonly CompiledSimulationRecipePlan[] {
  const ingredientSlotContents = readIngredientSlotContents({
    topology: options.topology,
    state: options.state,
    ingredientNodeIds: options.channel.ingredientNodeIds,
  });

  return resolveRecipes({
    topology: options.topology,
    state: options.state,
    device: options.device,
    channel: options.channel,
    ingredientSlotContents,
  });
}

export function placeRecipeOutputs(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  plan: CompiledSimulationRecipePlan,
  inputItems: readonly RuntimeRecipeItem[],
): boolean {
  const overlayState = createSlotOverlayState(state);
  if (!placeRecipeOutputsIntoOverlay(topology, overlayState, plan, inputItems)) {
    return false;
  }
  commitSlotOverlay(state.persistent.slots, overlayState.persistent.slots);
  return true;
}

function placeRecipeOutputsIntoOverlay(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  plan: CompiledSimulationRecipePlan,
  inputItems: readonly RuntimeRecipeItem[],
): boolean {
  for (const output of resolveRecipeOutputItems(plan.outputs, inputItems)) {
    for (let amount = 0; amount < output.amount; amount += 1) {
      const targetSlotId = findRecipeOutputSlot(topology, state, plan, output.itemType);
      if (targetSlotId === null) return false;
      const storageSlotId = resolveStorageSlotId(state, targetSlotId);
      const slotState = cloneSlotIntoOverlay(state.persistent.slots, storageSlotId);
      if (slotState === null) return false;
      slotState.itemType = slotState.itemType ?? output.itemType;
      slotState.count += 1;
    }
  }
  return true;
}

function createSlotOverlayState(
  state: SimulationMutableRuntimeState,
): SimulationMutableRuntimeState {
  return {
    ...state,
    persistent: {
      ...state.persistent,
      slots: Object.create(state.persistent.slots) as Record<string, RuntimeSlotState>,
    },
  };
}

function cloneSlotIntoOverlay(
  slots: Record<string, RuntimeSlotState>,
  slotId: string,
): RuntimeSlotState | null {
  if (Object.prototype.hasOwnProperty.call(slots, slotId)) {
    return slots[slotId] ?? null;
  }
  const source = slots[slotId];
  if (source === undefined) return null;
  const clone = { ...source };
  slots[slotId] = clone;
  return clone;
}

function commitSlotOverlay(
  targetSlots: Record<string, RuntimeSlotState>,
  overlaySlots: Record<string, RuntimeSlotState>,
): void {
  for (const [slotId, slotState] of Object.entries(overlaySlots)) {
    targetSlots[slotId] = slotState;
  }
}

export function selectRecipeInputs(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  plan: CompiledSimulationRecipePlan;
}): RuntimeReservedItem[] | null {
  const selections: RuntimeReservedItem[] = [];
  const localTakenBySlot: Record<string, number> = {};

  for (const input of options.plan.inputs) {
    let remainingAmount = input.amount;
    while (remainingAmount > 0) {
      const selection = findRecipeInputSelection(options.topology, options.state, options.plan, input, localTakenBySlot);
      if (selection === null) {
        return null;
      }
      const amount = Math.min(selection.availableAmount, remainingAmount);
      selections.push({
        slotId: selection.slotId,
        itemType: selection.itemType,
        amount,
        ignoreStock: selection.ignoreStock,
      });
      localTakenBySlot[selection.slotId] = (localTakenBySlot[selection.slotId] ?? 0) + amount;
      remainingAmount -= amount;
    }
  }

  return selections;
}

export function consumeSelections(
  slots: Record<string, RuntimeSlotState>,
  selections: readonly RuntimeReservedItem[],
): void {
  for (const selection of selections) {
    if (selection.ignoreStock) {
      continue;
    }
    const slotState = slots[selection.slotId];
    if (slotState === undefined) {
      continue;
    }
    slotState.count = Math.max(0, slotState.count - selection.amount);
    if (slotState.count === 0) {
      slotState.itemType = null;
    }
  }
}

export function aggregateInputItems(selections: readonly RuntimeReservedItem[]): RuntimeRecipeItem[] {
  const amountByItemType = new Map<string, number>();
  for (const selection of selections) {
    amountByItemType.set(selection.itemType, (amountByItemType.get(selection.itemType) ?? 0) + selection.amount);
  }
  return [...amountByItemType.entries()].map(([itemType, amount]) => ({ itemType, amount }));
}

export function getItemDomain(
  topology: CompiledSimulationTopology,
  itemType: string,
): SimulationItemDomain {
  return topology.itemCatalog[itemType]?.domain
    ?? (
      itemType.includes("_gas") || itemType.startsWith("gas_")
        ? "gas"
        : itemType.includes("_liquid") || itemType.startsWith("liquid_")
          ? "liquid"
          : "solid"
    );
}

export function finishRecipeIfPossible(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  recipe: RuntimeDeviceRecipeState,
): boolean {
  const perf = state.transient._perf;
  const preflightStartedAt = perf === undefined ? 0 : performance.now();
  if (perf !== undefined) perf.recipeFinishCalls += 1;
  if (!canRecipeFinishAtCurrentPhase(topology, state, recipe)) {
    if (perf !== undefined) {
      perf.recipeFinishFailures += 1;
      perf.recipeFinishPreflightMs += performance.now() - preflightStartedAt;
    }
    return false;
  }

  const overlayState = createSlotOverlayState(state);
  const hadReservations = recipe.reservations.length > 0;
  if (hadReservations) {
    for (const reservation of recipe.reservations) {
      if (cloneSlotIntoOverlay(overlayState.persistent.slots, reservation.slotId) === null) {
        if (perf !== undefined) {
          perf.recipeFinishFailures += 1;
          perf.recipeFinishPreflightMs += performance.now() - preflightStartedAt;
        }
        return false;
      }
    }
    consumeSelections(overlayState.persistent.slots, recipe.reservations);
  }

  if (!placeRecipeOutputsIntoOverlay(topology, overlayState, recipe.plan, recipe.inputItems)) {
    if (perf !== undefined) {
      perf.recipeFinishFailures += 1;
      perf.recipeFinishPreflightMs += performance.now() - preflightStartedAt;
    }
    return false;
  }
  if (perf !== undefined) {
    perf.recipeFinishPreflightMs += performance.now() - preflightStartedAt;
  }

  const commitStartedAt = perf === undefined ? 0 : performance.now();
  const changedSlotCount = Object.keys(overlayState.persistent.slots).length;
  commitSlotOverlay(state.persistent.slots, overlayState.persistent.slots);
  if (hadReservations) adjustReservedAmounts(state, recipe.reservations, -1);
  if (perf !== undefined) {
    perf.recipeFinishSuccesses += 1;
    perf.recipeFinishChangedSlots += changedSlotCount;
    perf.recipeFinishCommitMs += performance.now() - commitStartedAt;
  }

  // 只统计生产设备的配方（编译期 isProducer 缓存，零开销判断）
  const producerDevice = resolveRecipeProducerDevice(topology, recipe.plan);
  if (producerDevice?.isProducer) {
    const delta = state.transient.recipeStatsDelta;
    if (hadReservations) {
      for (const input of recipe.inputItems) {
        delta.consumed[input.itemType] = (delta.consumed[input.itemType] ?? 0) + input.amount;
      }
    }
    for (const output of resolveRecipeOutputItems(recipe.plan.outputs, recipe.inputItems)) {
      delta.produced[output.itemType] = (delta.produced[output.itemType] ?? 0) + output.amount;
    }
  }

  return true;
}

/**
 * 从配方计划中反查所属设备。
 * 通过 productNodeIds 或 ingredientNodeIds 找到 node，再找到 device。
 */
function resolveRecipeProducerDevice(
  topology: CompiledSimulationTopology,
  plan: CompiledSimulationRecipePlan,
): CompiledSimulationDevice | undefined {
  const nodeId = plan.productNodeIds[0] ?? plan.ingredientNodeIds[0];
  if (nodeId === undefined) return undefined;
  const node = topology.nodes[nodeId];
  if (node === undefined) return undefined;
  return topology.devices[node.deviceId];
}

// AI-CORRECTION 2026-05-14: definitionId/tags 已从签名中移除。
// 函数体内本身就从 options.device 读取 definitionId 和 tags，签名中的冗余参数从未被使用。
function resolveRecipes(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  device: CompiledSimulationDevice;
  channel: CompiledSimulationRecipeChannel;
  ingredientSlotContents: readonly IngredientSlotContent[];
}): readonly CompiledSimulationRecipePlan[] {
  if (options.device.transportClass === "strict-belt" || options.device.transportClass === "strict-pipe") {
    if (options.ingredientSlotContents.length === 0) {
      return [];
    }

    const timing = resolveTransportRecipeTiming(options.topology, options.device);
    if (timing === null) {
      return [];
    }

    const recipeId = `${options.device.definitionId}:${timing.recipeIdSuffix}`;
    return [getOrCreateRecipePlan(options, recipeId, () => ({
      recipeId,
      recipeType: "reserved-item",
      durationTicks: timing.durationTicks,
      inputs: [{ itemId: "any", amount: 1 }],
      outputs: [{ itemId: "same-as-input", amount: 1 }],
      ingredientNodeIds: options.channel.ingredientNodeIds,
      productNodeIds: options.channel.productNodeIds,
      requiredGasDiffusion: null,
      gasDiffusionOutput: null,
    }))];
  }

  if (options.device.definitionId === WATER_PURIFIER_NODE_ENTITY_ID) {
    const allowedRecipeId = resolveWaterPurifierAllowedRecipeId(options.channel.id);
    if (allowedRecipeId === null) {
      return [];
    }
    if (
      options.device.waterPurifierNode?.outputMode === "manual-rate"
      && allowedRecipeId === WATER_PURIFIER_BYPRODUCT_RECIPE_ID
    ) {
      return [];
    }
    const recipe = options.topology.recipeCatalog[allowedRecipeId];
    if (
      recipe === undefined
      || !recipeCanMatchContents(options.topology, recipe, options.ingredientSlotContents)
      || !isDeviceInRequiredGasDiffusion({
        topology: options.topology,
        state: options.state,
        device: options.device,
        requiredGasDiffusion: recipe.requiredGasDiffusion,
      })
    ) {
      return [];
    }

    return [getOrCreateRecipePlan(options, recipe.id, () => ({
      recipeId: recipe.id,
      recipeType: recipe.recipeType,
      durationTicks: recipe.durationTicks,
      inputs: recipe.inputs,
      outputs: recipe.outputs,
      ingredientNodeIds: options.channel.ingredientNodeIds,
      productNodeIds: options.channel.productNodeIds,
      requiredGasDiffusion: recipe.requiredGasDiffusion,
      gasDiffusionOutput: recipe.gasDiffusionOutput,
    }))];
  }

  // 手选配方设备：不自动根据原料匹配配方，必须由用户手动指定配方后设备才运行
  if (options.channel.manualRecipeOnly) {
    if (options.channel.defaultRecipeId === null) {
      return [];
    }
    const selectedRecipe = options.topology.recipeCatalog[options.channel.defaultRecipeId];
    if (selectedRecipe === undefined) {
      return [];
    }
    if (!isDeviceInRequiredGasDiffusion({
      topology: options.topology,
      state: options.state,
      device: options.device,
      requiredGasDiffusion: selectedRecipe.requiredGasDiffusion,
    })) {
      return [];
    }
    return [getOrCreateRecipePlan(options, selectedRecipe.id, () => ({
      recipeId: selectedRecipe.id,
      recipeType: selectedRecipe.recipeType,
      durationTicks: selectedRecipe.durationTicks,
      inputs: selectedRecipe.inputs,
      outputs: selectedRecipe.outputs,
      ingredientNodeIds: options.channel.ingredientNodeIds,
      productNodeIds: options.channel.productNodeIds,
      requiredGasDiffusion: selectedRecipe.requiredGasDiffusion,
      gasDiffusionOutput: selectedRecipe.gasDiffusionOutput,
    }))];
  }


  // AI-CORRECTION 2026-05-13:
  // General logistics devices (splitter, converger, admission — anchor transportClass)
  // also use reserved-item transport recipes, matching §6.1.2–§6.1.5 of 仿真运行原理.
  // Detect via BeltFamily/PipeFamily tags to cover all logistics devices uniformly.
  // Strict devices are already handled above and won't re-enter here.
  const isGeneralBelt = (options.device.tags ?? []).includes("BeltFamily");
  const isGeneralPipe = (options.device.tags ?? []).includes("PipeFamily");
  if ((isGeneralBelt || isGeneralPipe) && options.ingredientSlotContents.length > 0) {
    const timing = resolveTransportRecipeTiming(options.topology, options.device);
    if (timing === null) {
      return [];
    }

    const recipeId = `${options.device.definitionId}:${timing.recipeIdSuffix}`;
    return [getOrCreateRecipePlan(options, recipeId, () => ({
      recipeId,
      recipeType: "reserved-item",
      durationTicks: timing.durationTicks,
      inputs: [{ itemId: "any", amount: 1 }],
      outputs: [{ itemId: "same-as-input", amount: 1 }],
      ingredientNodeIds: options.channel.ingredientNodeIds,
      productNodeIds: options.channel.productNodeIds,
      requiredGasDiffusion: null,
      gasDiffusionOutput: null,
    }))];
  }

  return Object.values(options.topology.recipeCatalog)
    .filter((recipe) => recipe.machineId === options.device.definitionId)
    .filter((recipe) => recipeCanMatchContents(options.topology, recipe, options.ingredientSlotContents))
    .filter((recipe) => isDeviceInRequiredGasDiffusion({
      topology: options.topology,
      state: options.state,
      device: options.device,
      requiredGasDiffusion: recipe.requiredGasDiffusion,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((recipe) => getOrCreateRecipePlan(options, recipe.id, () => ({
        recipeId: recipe.id,
        recipeType: recipe.recipeType,
        durationTicks: recipe.durationTicks,
        inputs: recipe.inputs,
        outputs: recipe.outputs,
        ingredientNodeIds: options.channel.ingredientNodeIds,
        productNodeIds: options.channel.productNodeIds,
        requiredGasDiffusion: recipe.requiredGasDiffusion,
        gasDiffusionOutput: recipe.gasDiffusionOutput,
      })));
}

function getOrCreateRecipePlan(
  options: {
    topology: CompiledSimulationTopology;
    device: CompiledSimulationDevice;
    channel: CompiledSimulationRecipeChannel;
  },
  recipeId: string,
  createPlan: () => CompiledSimulationRecipePlan,
): CompiledSimulationRecipePlan {
  let devicePlans = recipePlanCacheByTopology.get(options.topology);
  if (devicePlans === undefined) {
    devicePlans = new Map();
    recipePlanCacheByTopology.set(options.topology, devicePlans);
  }

  let channelPlans = devicePlans.get(options.device.id);
  if (channelPlans === undefined) {
    channelPlans = new Map();
    devicePlans.set(options.device.id, channelPlans);
  }

  let recipePlans = channelPlans.get(options.channel.id);
  if (recipePlans === undefined) {
    recipePlans = new Map();
    channelPlans.set(options.channel.id, recipePlans);
  }

  const cachedPlan = recipePlans.get(recipeId);
  if (cachedPlan !== undefined) {
    return cachedPlan;
  }

  const plan = createPlan();
  recipePlans.set(recipeId, plan);
  return plan;
}

function resolveWaterPurifierAllowedRecipeId(channelId: string): string | null {
  if ((WATER_PURIFIER_INTAKE_CHANNEL_IDS as readonly string[]).includes(channelId)) {
    return WATER_PURIFIER_COLLECT_RECIPE_ID;
  }
  if (channelId === WATER_PURIFIER_BYPRODUCT_CHANNEL_ID) {
    return WATER_PURIFIER_BYPRODUCT_RECIPE_ID;
  }
  return null;
}

function readIngredientSlotContents(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  ingredientNodeIds: readonly string[];
}): readonly IngredientSlotContent[] {
  const contents: IngredientSlotContent[] = [];
  for (const nodeId of options.ingredientNodeIds) {
    const node = options.topology.nodes[nodeId];
    if (node === undefined) {
      continue;
    }

    for (const slotId of node.slotIds) {
      const storageSlotId = resolveStorageSlotId(options.state, slotId);
      const slotState = options.state.persistent.slots[storageSlotId];
      const itemType = slotState?.itemType ?? options.topology.slots[slotId]?.lock ?? null;
      if (slotState === undefined || itemType === null) {
        continue;
      }

      const availableAmount = resolveEffectiveIgnoreStock(options.topology, options.state, slotId)
        ? Number.POSITIVE_INFINITY
        : Math.max(0, slotState.count - getReservedAmount(options.state, storageSlotId));
      if (availableAmount > 0) {
        contents.push({ slotId: storageSlotId, itemType, availableAmount });
      }
    }
  }
  return contents;
}

function recipeCanMatchContents(
  topology: CompiledSimulationTopology,
  recipe: CompiledSimulationRecipeDefinition,
  contents: readonly IngredientSlotContent[],
): boolean {
  if (recipe.inputs.length === 0) {
    return true;
  }

  const availableByItemType = new Map<string, number>();
  let totalAvailable = 0;
  let domainSolid = 0;
  let domainLiquid = 0;
  let domainGas = 0;
  for (const content of contents) {
    availableByItemType.set(content.itemType, (availableByItemType.get(content.itemType) ?? 0) + content.availableAmount);
    totalAvailable += content.availableAmount;
    const domain = getItemDomain(topology, content.itemType);
    if (domain === "solid") {
      domainSolid += content.availableAmount;
    } else if (domain === "liquid") {
      domainLiquid += content.availableAmount;
    } else {
      domainGas += content.availableAmount;
    }
  }

  for (const input of recipe.inputs) {
    if (input.itemId === "any") {
      if (totalAvailable < input.amount) {
        return false;
      }
      totalAvailable -= input.amount;
      continue;
    }

    // AI-CORRECTION 2026-07-18: 支持域占位符 "fluid"/"liquid"/"gas"/"solid" 作为配方输入。
    // 原逻辑仅处理 "any" 和精确物品 ID，无法匹配使用域占位符的隐藏销毁配方（如暗管 fluid void）。
    if (input.itemId === "solid") {
      if (domainSolid < input.amount) return false;
      domainSolid -= input.amount;
      totalAvailable -= input.amount;
      continue;
    }
    if (input.itemId === "liquid") {
      if (domainLiquid < input.amount) return false;
      domainLiquid -= input.amount;
      totalAvailable -= input.amount;
      continue;
    }
    if (input.itemId === "gas") {
      if (domainGas < input.amount) return false;
      domainGas -= input.amount;
      totalAvailable -= input.amount;
      continue;
    }
    if (input.itemId === "fluid") {
      const fluidTotal = domainLiquid + domainGas;
      if (fluidTotal < input.amount) return false;
      const deductLiquid = Math.min(domainLiquid, input.amount);
      domainLiquid -= deductLiquid;
      domainGas -= (input.amount - deductLiquid);
      totalAvailable -= input.amount;
      continue;
    }

    const available = availableByItemType.get(input.itemId) ?? 0;
    if (available < input.amount) {
      return false;
    }
    availableByItemType.set(input.itemId, available - input.amount);
    totalAvailable -= input.amount;
  }

  return true;
}

function getRemainingCapacity(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  slotId: string,
): number {
  const perf = state.transient._perf;
  if (perf !== undefined) { perf.getRemainingCapacityCalls += 1; }

  const slot = topology.slots[slotId];
  if (slot === undefined) {
    return 0;
  }
  const sharedSlotIds = state.persistent.sharedCapacitySlotIdsBySlotId[slotId];
  if (sharedSlotIds === undefined) {
    const storageSlotId = resolveStorageSlotId(state, slotId);
    return Math.max(0, slot.capacity - (state.persistent.slots[storageSlotId]?.count ?? 0));
  }

  const visitedStorageSlotIds = new Set<string>();
  let occupiedCount = 0;
  for (const sharedSlotId of sharedSlotIds) {
    const storageSlotId = resolveStorageSlotId(state, sharedSlotId);
    if (visitedStorageSlotIds.has(storageSlotId)) {
      continue;
    }
    visitedStorageSlotIds.add(storageSlotId);
    occupiedCount += state.persistent.slots[storageSlotId]?.count ?? 0;
  }

  return Math.max(0, (state.persistent.sharedCapacityLimitBySlotId[slotId] ?? slot.capacity) - occupiedCount);
}

function slotCanHold(
  topology: CompiledSimulationTopology,
  slot: CompiledSimulationSlot,
  itemType: string,
): boolean {
  if (slot.lock !== null && slot.lock !== itemType) {
    return false;
  }
  return doesDomainFilterAcceptItemDomain(slot.domain, getItemDomain(topology, itemType));
}

function doesDomainFilterAcceptItemDomain(
  filter: SimulationItemDomainFilter | "any",
  domain: SimulationItemDomain,
): boolean {
  if (filter === "any") {
    return true;
  }
  if (filter === "fluid") {
    return domain === "liquid" || domain === "gas";
  }
  return domain === filter;
}

function findRecipeOutputSlot(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  plan: CompiledSimulationRecipePlan,
  itemType: string,
): string | null {
  for (const nodeId of plan.productNodeIds) {
    const node = topology.nodes[nodeId];
    if (node === undefined) {
      continue;
    }
    const targetSlotId = findInputSlotForItem({ topology, state, node, itemType });
    if (targetSlotId !== null) {
      return targetSlotId;
    }
  }
  return null;
}

function resolveRecipeOutputItems(
  outputs: readonly CompiledSimulationRecipeItem[],
  inputItems: readonly RuntimeRecipeItem[],
): Array<{ readonly itemType: string; readonly amount: number }> {
  const firstInputItemType = inputItems[0]?.itemType ?? null;
  return outputs.flatMap((output) => {
    if (output.itemId === "same-as-input" || output.itemId === "any") {
      return firstInputItemType === null ? [] : [{ itemType: firstInputItemType, amount: output.amount }];
    }
    return [{ itemType: output.itemId, amount: output.amount }];
  });
}

function findRecipeInputSelection(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  plan: CompiledSimulationRecipePlan,
  input: CompiledSimulationRecipeItem,
  localTakenBySlot: Record<string, number>,
): {
  readonly slotId: string;
  readonly itemType: string;
  readonly availableAmount: number;
  readonly ignoreStock: boolean;
} | null {
  for (const nodeId of plan.ingredientNodeIds) {
    const node = topology.nodes[nodeId];
    if (node === undefined) {
      continue;
    }
    for (const slotId of node.slotIds) {
      const storageSlotId = resolveStorageSlotId(state, slotId);
      const slotState = state.persistent.slots[storageSlotId];
      if (slotState === undefined || slotState.itemType === null || !recipeInputMatches(topology, input, slotState.itemType)) {
        continue;
      }
      const itemType = slotState.itemType;
      const ignoreStock = resolveEffectiveIgnoreStock(topology, state, slotId);
      const availableAmount = ignoreStock
        ? Number.POSITIVE_INFINITY
        : slotState.count
          - getReservedAmount(state, storageSlotId)
          - (localTakenBySlot[storageSlotId] ?? 0);
      if (availableAmount > 0) {
        return { slotId: storageSlotId, itemType, availableAmount, ignoreStock };
      }
    }
  }
  return null;
}

// AI-CORRECTION 2026-07-18: 支持域占位符 "fluid"/"liquid"/"gas"/"solid" 作为配方输入匹配。
// 原逻辑仅处理 "any" 和精确物品 ID，无法匹配暗管等使用域占位符的隐藏配方。
function recipeInputMatches(
  topology: CompiledSimulationTopology,
  input: CompiledSimulationRecipeItem,
  itemType: string,
): boolean {
  if (input.itemId === "any" || input.itemId === itemType) {
    return true;
  }
  const domain = getItemDomain(topology, itemType);
  if (input.itemId === "fluid") {
    return domain === "liquid" || domain === "gas";
  }
  if (input.itemId === "liquid") {
    return domain === "liquid";
  }
  if (input.itemId === "gas") {
    return domain === "gas";
  }
  if (input.itemId === "solid") {
    return domain === "solid";
  }
  return false;
}

// AI-REMOVED 2026-06-20:
// Reason: 配方完成只涉及少量输入/输出槽位，全量复制所有运行时槽位造成主要仿真瓶颈。
// Trigger: 用户要求优化 advanceDevices 的全槽位双重克隆。
// Evidence: finishRecipeIfPossible 与 placeRecipeOutputs 原先连续调用该函数；性能日志显示 advanceDevices 平均 26.12ms。
// Replacement: createSlotOverlayState + cloneSlotIntoOverlay + commitSlotOverlay。
// Risk: Medium - 局部事务必须保持失败时零写入，已由 dynamic-tick-rate.test.ts 回归覆盖。
// Human Review: Required
//
// Original code:
// function cloneSlotStates(slots: Record<string, RuntimeSlotState>): Record<string, RuntimeSlotState> {
//   return Object.fromEntries(Object.entries(slots).map(([slotId, slot]) => [slotId, { ...slot }]));
// }

/**
 * 在每个 tick 结束后维护运输组件的域锁：
 * - 若组件内任一槽位有物品，将域锁设置为该物品类型；
 * - 若组件内所有槽位均已排空，清除域锁（设为 null），允许新类型物品进入。
 *
 * 订正（2026-05-07）：引入运输组件域锁机制，替代合并设备的方案。
 */
export function maintainTransportComponentDomains(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  for (const [componentId, component] of Object.entries(topology.transportComponents)) {
    const domain = state.persistent.transportComponentDomain[componentId];
    // 若组件已锁定，确认锁定的物品类型是否仍在组件内。
    if (domain !== null) {
      const domainStillPresent = component.slotIds.some((slotId) => {
        const storageSlotId = resolveStorageSlotId(state, slotId);
        return state.persistent.slots[storageSlotId]?.itemType === domain;
      });
      if (!domainStillPresent) {
        state.persistent.transportComponentDomain[componentId] = null;
      }
      continue;
    }

    // 组件未锁定：扫描槽位，将域锁设为第一个非空槽位的物品类型。
    for (const slotId of component.slotIds) {
      const storageSlotId = resolveStorageSlotId(state, slotId);
      const slotState = state.persistent.slots[storageSlotId];
      if (slotState !== undefined && slotState.count > 0 && slotState.itemType !== null) {
        state.persistent.transportComponentDomain[componentId] = slotState.itemType;
        break;
      }
    }
  }
}
