import type {
  CompiledSimulationDevice,
  CompiledSimulationNode,
  CompiledSimulationRecipeDefinition,
  CompiledSimulationRecipeItem,
  CompiledSimulationRecipePlan,
  CompiledSimulationSlot,
  CompiledSimulationTopology,
  SimulationAcceptRule,
  SimulationItemDomain,
} from "../types";
import type {
  RuntimeDeviceRecipeState,
  RuntimeRecipeItem,
  RuntimeReservedItem,
  RuntimeSlotState,
  SimulationMutableRuntimeState,
} from "./runtime-state";

export interface IngredientSlotContent {
  readonly slotId: string;
  readonly itemType: string;
  readonly availableAmount: number;
}

export function resolveStorageSlotId(
  state: SimulationMutableRuntimeState,
  slotId: string,
): string {
  return state.persistent.shareAllTargetSlotIdBySourceSlotId[slotId] ?? slotId;
}

export function getReservedAmount(
  state: SimulationMutableRuntimeState,
  storageSlotId: string,
): number {
  let reservedAmount = 0;
  for (const deviceState of Object.values(state.persistent.devices)) {
    for (const recipe of Object.values(deviceState.channelRecipes)) {
      if (recipe === null) {
        continue;
      }
      for (const reservation of recipe.reservations) {
        if (reservation.slotId === storageSlotId) {
          reservedAmount += reservation.amount;
        }
      }
    }
  }
  return reservedAmount;
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
      return getItemDomain(topology, itemType) === rule.base.kind;
    case "item":
      return rule.base.itemId === itemType;
  }
}

export function findInputSlotForItem(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  node: CompiledSimulationNode;
  itemType: string;
}): string | null {
  // 运输组件域锁检查：若该节点所属组件已锁定为其他物品类型，拒绝接受。
  const device = options.topology.devices[options.node.deviceId];
  const componentId = device?.transportComponentId ?? null;
  if (componentId !== null) {
    const domain = options.state.persistent.transportComponentDomain[componentId];
    if (domain !== null && domain !== options.itemType) {
      return null;
    }
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

    if (slot.ignoreStock || slotState.count - getReservedAmount(options.state, storageSlotId) > 0) {
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
  const slot = options.topology.slots[options.sourceSlotId];
  const storageSlotId = resolveStorageSlotId(options.state, options.sourceSlotId);
  const slotState = options.state.persistent.slots[storageSlotId];
  const itemType = slotState?.itemType ?? slot?.lock ?? null;
  if (slot === undefined || slotState === undefined || itemType !== options.itemType) {
    return false;
  }

  return slot.ignoreStock || slotState.count - getReservedAmount(options.state, storageSlotId) > 0;
}

export function moveOneItem(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  sourceSlotId: string;
  targetSlotId: string;
  itemType: string;
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

  if (!sourceSlot.ignoreStock) {
    sourceState.count = Math.max(0, sourceState.count - 1);
    if (sourceState.count === 0) {
      sourceState.itemType = null;
    }
  }

  targetState.itemType = targetState.itemType ?? options.itemType;
  targetState.count += 1;
  return true;
}

// AI-CORRECTION 2026-05-13: resolveDeviceRecipePlans 现在接受 channel 级参数。
// ingredientNodeIds / productNodeIds 从 channel 获取而非从 device 全局获取。
export function resolveDeviceRecipePlans(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  definitionId: string;
  tags: readonly string[];
  transportClass: SimulationTransportClass;
  ingredientNodeIds: readonly string[];
  productNodeIds: readonly string[];
}): readonly CompiledSimulationRecipePlan[] {
  const ingredientSlotContents = readIngredientSlotContents({
    topology: options.topology,
    state: options.state,
    ingredientNodeIds: options.ingredientNodeIds,
  });

  return resolveRecipes({
    topology: options.topology,
    device: options.device,
    ingredientSlotContents,
  });
}

export function placeRecipeOutputs(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  plan: CompiledSimulationRecipePlan,
  inputItems: readonly RuntimeRecipeItem[],
): boolean {
  const simulatedSlots = cloneSlotStates(state.persistent.slots);
  const simulatedState: SimulationMutableRuntimeState = {
    ...state,
    persistent: {
      ...state.persistent,
      slots: simulatedSlots,
    },
  };

  for (const output of resolveRecipeOutputItems(plan.outputs, inputItems)) {
    for (let amount = 0; amount < output.amount; amount += 1) {
      const targetSlotId = findRecipeOutputSlot(topology, simulatedState, plan, output.itemType);
      if (targetSlotId === null) {
        return false;
      }
      const storageSlotId = resolveStorageSlotId(simulatedState, targetSlotId);
      const slotState = simulatedSlots[storageSlotId];
      if (slotState === undefined) {
        return false;
      }
      slotState.itemType = slotState.itemType ?? output.itemType;
      slotState.count += 1;
    }
  }

  state.persistent.slots = simulatedSlots;
  return true;
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
      selections.push({ slotId: selection.slotId, itemType: selection.itemType, amount });
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
    ?? (itemType.includes("_liquid") || itemType.startsWith("liquid_") ? "liquid" : "solid");
}

export function finishRecipeIfPossible(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  recipe: RuntimeDeviceRecipeState,
): boolean {
  const simulatedSlots = cloneSlotStates(state.persistent.slots);
  if (recipe.reservations.length > 0) {
    consumeSelections(simulatedSlots, recipe.reservations);
  }

  const simulatedState: SimulationMutableRuntimeState = {
    ...state,
    persistent: {
      ...state.persistent,
      slots: simulatedSlots,
    },
  };
  if (!placeRecipeOutputs(topology, simulatedState, recipe.plan, recipe.inputItems)) {
    return false;
  }

  state.persistent.slots = simulatedState.persistent.slots;
  return true;
}

function resolveRecipes(options: {
  topology: CompiledSimulationTopology;
  definitionId: string;
  tags: readonly string[];
  transportClass: SimulationTransportClass;
  ingredientNodeIds: readonly string[];
  productNodeIds: readonly string[];
  ingredientSlotContents: readonly IngredientSlotContent[];
}): readonly CompiledSimulationRecipePlan[] {
  if (options.transportClass === "strict-belt" || options.transportClass === "strict-pipe") {
    if (options.ingredientSlotContents.length === 0) {
      return [];
    }

    const durationSeconds = options.transportClass === "strict-belt" ? 2 : 0.5;
    const recipeIdSuffix = options.transportClass === "strict-belt"
      ? "dynamic-belt-transfer"
      : "dynamic-pipe-transfer";

    return [{
      recipeId: `${options.definitionId}:${recipeIdSuffix}`,
      recipeType: "reserved-item",
      durationTicks: Math.max(1, Math.round(durationSeconds * options.topology.standardTickRate)),
      inputs: [{ itemId: "any", amount: 1 }],
      outputs: [{ itemId: "same-as-input", amount: 1 }],
      ingredientNodeIds: options.ingredientNodeIds,
      productNodeIds: options.productNodeIds,
    }];
  }

  // AI-CORRECTION 2026-05-13:
  // General logistics devices (splitter, converger, admission — anchor transportClass)
  // also use reserved-item transport recipes, matching §6.1.2–§6.1.5 of 仿真运行原理.
  // Detect via BeltFamily/PipeFamily tags to cover all logistics devices uniformly.
  // Strict devices are already handled above and won't re-enter here.
  const isGeneralBelt = options.tags.includes("BeltFamily");
  const isGeneralPipe = options.tags.includes("PipeFamily");
  if ((isGeneralBelt || isGeneralPipe) && options.ingredientSlotContents.length > 0) {
    const durationSeconds = isGeneralBelt ? 2 : 0.5;
    const recipeIdSuffix = isGeneralBelt ? "dynamic-belt-transfer" : "dynamic-pipe-transfer";
    return [{
      recipeId: `${options.definitionId}:${recipeIdSuffix}`,
      recipeType: "reserved-item",
      durationTicks: Math.max(1, Math.round(durationSeconds * options.topology.standardTickRate)),
      inputs: [{ itemId: "any", amount: 1 }],
      outputs: [{ itemId: "same-as-input", amount: 1 }],
      ingredientNodeIds: options.ingredientNodeIds,
      productNodeIds: options.productNodeIds,
    }];
  }

  return Object.values(options.topology.recipeCatalog)
    .filter((recipe) => recipe.machineId === options.definitionId)
    .filter((recipe) => recipeCanMatchContents(recipe, options.ingredientSlotContents))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((recipe) => ({
      recipeId: recipe.id,
      recipeType: recipe.recipeType,
      durationTicks: recipe.durationTicks,
      inputs: recipe.inputs,
      outputs: recipe.outputs,
      ingredientNodeIds: options.ingredientNodeIds,
      productNodeIds: options.productNodeIds,
    }));
}

function readIngredientSlotContents(options: {
  topology: CompiledSimulationTopology;
  state: SimulationMutableRuntimeState;
  device: CompiledSimulationDevice;
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

      const availableAmount = Math.max(0, slotState.count - getReservedAmount(options.state, storageSlotId));
      if (availableAmount > 0) {
        contents.push({ slotId: storageSlotId, itemType, availableAmount });
      }
    }
  }
  return contents;
}

function recipeCanMatchContents(
  recipe: CompiledSimulationRecipeDefinition,
  contents: readonly IngredientSlotContent[],
): boolean {
  if (recipe.inputs.length === 0) {
    return true;
  }

  const availableByItemType = new Map<string, number>();
  let totalAvailable = 0;
  for (const content of contents) {
    availableByItemType.set(content.itemType, (availableByItemType.get(content.itemType) ?? 0) + content.availableAmount);
    totalAvailable += content.availableAmount;
  }

  for (const input of recipe.inputs) {
    if (input.itemId === "any") {
      if (totalAvailable < input.amount) {
        return false;
      }
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
  return slot.domain === "any" || getItemDomain(topology, itemType) === slot.domain;
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
): { readonly slotId: string; readonly itemType: string; readonly availableAmount: number } | null {
  for (const nodeId of plan.ingredientNodeIds) {
    const node = topology.nodes[nodeId];
    if (node === undefined) {
      continue;
    }
    for (const slotId of node.slotIds) {
      const storageSlotId = resolveStorageSlotId(state, slotId);
      const slotState = state.persistent.slots[storageSlotId];
      if (slotState === undefined || slotState.itemType === null || !recipeInputMatches(input, slotState.itemType)) {
        continue;
      }
      const itemType = slotState.itemType;
      const availableAmount = slotState.count
        - getReservedAmount(state, storageSlotId)
        - (localTakenBySlot[storageSlotId] ?? 0);
      if (availableAmount > 0) {
        return { slotId: storageSlotId, itemType, availableAmount };
      }
    }
  }
  return null;
}

function recipeInputMatches(input: CompiledSimulationRecipeItem, itemType: string): boolean {
  return input.itemId === "any" || input.itemId === itemType;
}

function cloneSlotStates(slots: Record<string, RuntimeSlotState>): Record<string, RuntimeSlotState> {
  return Object.fromEntries(Object.entries(slots).map(([slotId, slot]) => [slotId, { ...slot }]));
}

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
