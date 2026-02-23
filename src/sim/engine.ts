import { DEVICE_TYPE_BY_ID, ITEMS, RECIPES } from '../domain/registry'
import { detectOverlaps, neighborsFromLinks, OPPOSITE_EDGE } from '../domain/geometry'
import { cycleTicksFromSeconds } from '../domain/shared/simulation'
import type {
  DeviceInstance,
  DeviceRuntime,
  ItemId,
  LayoutState,
  SimState,
  SlotData,
  StallReason,
} from '../domain/types'

const BASE_TICK_RATE = 20
const CONVEYOR_SECONDS_PER_CELL = 2
const PICKUP_BLOCK_WINDOW_SECONDS = CONVEYOR_SECONDS_PER_CELL
const STORAGE_SUBMIT_INTERVAL_SECONDS = 10
const DEFAULT_PROCESSOR_BUFFER_CAPACITY = 50
const DEFAULT_PROCESSOR_BUFFER_SLOTS = 1
const ITEM_IDS: ItemId[] = ITEMS.map((item) => item.id)
const INFINITE_WAREHOUSE_TAG = '矿石'
const INFINITE_WAREHOUSE_ITEMS = new Set<ItemId>(
  ITEMS.filter((item) => item.tags?.includes(INFINITE_WAREHOUSE_TAG)).map((item) => item.id),
)

function createItemNumberRecord(initialValue = 0): Record<ItemId, number> {
  return Object.fromEntries(ITEM_IDS.map((itemId) => [itemId, initialValue])) as Record<ItemId, number>
}

function conveyorSpeedPerTick(tickRateHz: number) {
  return 1 / Math.max(1, CONVEYOR_SECONDS_PER_CELL * tickRateHz)
}

type TransferPlan = {
  fromId: string
  fromPortId: string
  fromLane: 'slot' | 'ns' | 'we' | 'output'
  toId: string
  toPortId: string
  itemId: ItemId
  lane: 'slot' | 'ns' | 'we' | 'output'
}

type ProcessorBufferKind = 'input' | 'output'

type NeighborGraph = ReturnType<typeof neighborsFromLinks>

const layoutNeighborCache = new WeakMap<LayoutState, NeighborGraph>()
const layoutDeviceByIdCache = new WeakMap<LayoutState, Map<string, DeviceInstance>>()

function getNeighbors(layout: LayoutState) {
  const cached = layoutNeighborCache.get(layout)
  if (cached) return cached
  const built = neighborsFromLinks(layout)
  layoutNeighborCache.set(layout, built)
  return built
}

function getDeviceByIdMap(layout: LayoutState) {
  const cached = layoutDeviceByIdCache.get(layout)
  if (cached) return cached
  const built = new Map(layout.devices.map((device) => [device.instanceId, device]))
  layoutDeviceByIdCache.set(layout, built)
  return built
}

function baseRuntime(): Pick<DeviceRuntime, 'progress01' | 'stallReason' | 'isStalled'> {
  return { progress01: 0, stallReason: 'NONE', isStalled: false }
}

function runtimeForDevice(device: DeviceInstance): DeviceRuntime {
  const def = DEVICE_TYPE_BY_ID[device.typeId]
  if (def.runtimeKind === 'processor') {
    const inputSpec = processorBufferSpec(device.typeId, 'input')
    const outputSpec = processorBufferSpec(device.typeId, 'output')
    return {
      ...baseRuntime(),
      inputBuffer: {},
      outputBuffer: {},
      inputSlotItems: Array.from({ length: inputSpec.slots }, () => null),
      outputSlotItems: Array.from({ length: outputSpec.slots }, () => null),
      cycleProgressTicks: 0,
      producedItemsTotal: 0,
      lastCompletedCycleTicks: 0,
      lastCompletionTick: null,
      lastCompletionIntervalTicks: 0,
      activeRecipeId: undefined,
    }
  }
  if (def.runtimeKind === 'storage') {
    return {
      ...baseRuntime(),
      inventory: {},
      submitAccumulatorTicks: 0,
    }
  }
  if (def.runtimeKind === 'conveyor') {
    return {
      ...baseRuntime(),
      slot: null,
      transportTotalTicks: 0,
      transportSamples: 0,
    }
  }
  return {
    ...baseRuntime(),
    slot: null,
    nsSlot: null,
    weSlot: null,
    rrIndex: 0,
  }
}

function emptyWarehouse() {
  const warehouse = createItemNumberRecord(0)
  for (const itemId of INFINITE_WAREHOUSE_ITEMS) {
    warehouse[itemId] = Number.POSITIVE_INFINITY
  }
  return warehouse
}

function canPickupFromWarehouse(warehouse: Record<ItemId, number>, itemId: ItemId) {
  const stock = warehouse[itemId] ?? 0
  return Number.isFinite(stock) ? stock > 0 : stock > 0
}

function shouldIgnorePickupInventory(device: DeviceInstance) {
  if (device.typeId !== 'item_port_unloader_1') return false
  const pickupItemId = device.config.pickupItemId
  if (!pickupItemId) return false
  if (INFINITE_WAREHOUSE_ITEMS.has(pickupItemId)) return true
  return Boolean(device.config.pickupIgnoreInventory)
}

function emptyPerMinuteRecord(): Record<ItemId, number> {
  return createItemNumberRecord(0)
}

function createWindowDelta(delta: Partial<Record<ItemId, number>> = {}): Partial<Record<ItemId, number>> {
  return Object.fromEntries(ITEM_IDS.map((itemId) => [itemId, delta[itemId] ?? 0])) as Partial<Record<ItemId, number>>
}

function normalizeRuntimeState(runtime: DeviceRuntime, stallReason: StallReason) {
  runtime.stallReason = stallReason
  runtime.isStalled = stallReason !== 'NONE'
}

function isHardBlockedStall(stallReason: StallReason) {
  return stallReason === 'CONFIG_ERROR' || stallReason === 'OVERLAP' || stallReason === 'NO_POWER'
}

function mark(output: Partial<Record<ItemId, number>>, itemId: ItemId, delta: number) {
  output[itemId] = (output[itemId] ?? 0) + delta
}

function processorBufferSpec(deviceTypeId: DeviceInstance['typeId'], bufferKind: 'input' | 'output') {
  const def = DEVICE_TYPE_BY_ID[deviceTypeId]
  const slotCapsRaw =
    bufferKind === 'input' ? def.inputBufferSlotCapacities ?? [] : def.outputBufferSlotCapacities ?? []
  const normalizedSlotCaps = slotCapsRaw.map((value) => Math.max(1, Math.floor(value)))
  const capacityRaw = bufferKind === 'input' ? def.inputBufferCapacity : def.outputBufferCapacity
  const slotsRaw = bufferKind === 'input' ? def.inputBufferSlots : def.outputBufferSlots
  const fallbackCapacity = Math.max(1, Math.floor(capacityRaw ?? DEFAULT_PROCESSOR_BUFFER_CAPACITY))
  const slots = Math.max(1, Math.floor(slotsRaw ?? DEFAULT_PROCESSOR_BUFFER_SLOTS), normalizedSlotCaps.length)
  const slotCapacities = Array.from({ length: slots }, (_, index) => normalizedSlotCaps[index] ?? fallbackCapacity)
  return {
    slots,
    slotCapacities,
    totalCapacity: slotCapacities.reduce((sum, cap) => sum + cap, 0),
  }
}

function findSlotIndexByItem(slotItems: Array<ItemId | null>, itemId: ItemId) {
  return slotItems.findIndex((slotItemId) => slotItemId === itemId)
}

function findFirstEmptySlot(slotItems: Array<ItemId | null>) {
  return slotItems.findIndex((slotItemId) => slotItemId === null)
}

function clearSlotBindingIfEmpty(
  buffer: Partial<Record<ItemId, number>>,
  slotItems: Array<ItemId | null>,
  itemId: ItemId,
) {
  if ((buffer[itemId] ?? 0) > 0) return
  const slotIndex = findSlotIndexByItem(slotItems, itemId)
  if (slotIndex >= 0) {
    slotItems[slotIndex] = null
  }
}

function canAcceptProcessorBufferAmount(
  runtime: DeviceRuntime,
  deviceTypeId: DeviceInstance['typeId'],
  bufferKind: ProcessorBufferKind,
  itemId: ItemId,
  amount: number,
) {
  if (!('inputBuffer' in runtime) || !('outputBuffer' in runtime)) return false
  if (amount <= 0) return true

  const spec = processorBufferSpec(deviceTypeId, bufferKind)
  const buffer = bufferKind === 'input' ? runtime.inputBuffer : runtime.outputBuffer
  const slotItems = bufferKind === 'input' ? runtime.inputSlotItems : runtime.outputSlotItems
  const existingSlotIndex = findSlotIndexByItem(slotItems, itemId)
  const targetSlotIndex = existingSlotIndex >= 0 ? existingSlotIndex : findFirstEmptySlot(slotItems)
  if (targetSlotIndex < 0) return false

  const slotCapacity = spec.slotCapacities[targetSlotIndex] ?? DEFAULT_PROCESSOR_BUFFER_CAPACITY
  const nextAmount = (buffer[itemId] ?? 0) + amount
  return nextAmount <= slotCapacity
}

function tryAddProcessorBufferAmount(
  runtime: DeviceRuntime,
  deviceTypeId: DeviceInstance['typeId'],
  bufferKind: ProcessorBufferKind,
  itemId: ItemId,
  amount: number,
) {
  if (!('inputBuffer' in runtime) || !('outputBuffer' in runtime)) return false
  if (!canAcceptProcessorBufferAmount(runtime, deviceTypeId, bufferKind, itemId, amount)) return false
  const buffer = bufferKind === 'input' ? runtime.inputBuffer : runtime.outputBuffer
  const slotItems = bufferKind === 'input' ? runtime.inputSlotItems : runtime.outputSlotItems
  let slotIndex = findSlotIndexByItem(slotItems, itemId)
  if (slotIndex < 0) {
    slotIndex = findFirstEmptySlot(slotItems)
    if (slotIndex < 0) return false
    slotItems[slotIndex] = itemId
  }
  buffer[itemId] = (buffer[itemId] ?? 0) + amount
  return true
}

function tryAddProcessorInput(runtime: DeviceRuntime, deviceTypeId: DeviceInstance['typeId'], itemId: ItemId, amount: number) {
  return tryAddProcessorBufferAmount(runtime, deviceTypeId, 'input', itemId, amount)
}

function canAcceptProcessorInput(runtime: DeviceRuntime, deviceTypeId: DeviceInstance['typeId'], itemId: ItemId, amount: number) {
  return canAcceptProcessorBufferAmount(runtime, deviceTypeId, 'input', itemId, amount)
}

function canAcceptProcessorOutputBatch(
  runtime: DeviceRuntime,
  deviceTypeId: DeviceInstance['typeId'],
  outputs: Array<{ itemId: ItemId; amount: number }>,
) {
  if (!('outputBuffer' in runtime)) return false
  const shadowBuffer = { ...runtime.outputBuffer }
  const shadowSlotItems = [...runtime.outputSlotItems]
  for (const output of outputs) {
    const slotSpec = processorBufferSpec(deviceTypeId, 'output')
    const existingSlotIndex = findSlotIndexByItem(shadowSlotItems, output.itemId)
    const slotIndex = existingSlotIndex >= 0 ? existingSlotIndex : findFirstEmptySlot(shadowSlotItems)
    if (slotIndex < 0) return false
    const slotCapacity = slotSpec.slotCapacities[slotIndex] ?? DEFAULT_PROCESSOR_BUFFER_CAPACITY
    if ((shadowBuffer[output.itemId] ?? 0) + output.amount > slotCapacity) return false
    if (existingSlotIndex < 0) shadowSlotItems[slotIndex] = output.itemId
    shadowBuffer[output.itemId] = (shadowBuffer[output.itemId] ?? 0) + output.amount
  }
  return true
}

function commitProcessorOutputBatch(
  runtime: DeviceRuntime,
  deviceTypeId: DeviceInstance['typeId'],
  outputs: Array<{ itemId: ItemId; amount: number }>,
) {
  if (!('outputBuffer' in runtime)) return 0
  let producedCount = 0
  for (const output of outputs) {
    if (tryAddProcessorBufferAmount(runtime, deviceTypeId, 'output', output.itemId, output.amount)) {
      producedCount += output.amount
    }
  }
  return producedCount
}

function addToStorage(runtime: DeviceRuntime, itemId: ItemId, amount: number) {
  if ('inventory' in runtime) {
    runtime.inventory[itemId] = (runtime.inventory[itemId] ?? 0) + amount
    return true
  }
  return false
}

function getSlotRef(runtime: DeviceRuntime, lane: 'slot' | 'ns' | 'we'): SlotData | null {
  if (lane === 'slot' && 'slot' in runtime) return runtime.slot
  if (lane === 'ns' && 'nsSlot' in runtime) return runtime.nsSlot
  if (lane === 'we' && 'weSlot' in runtime) return runtime.weSlot
  return null
}

function setSlotRef(runtime: DeviceRuntime, lane: 'slot' | 'ns' | 'we', value: SlotData | null) {
  if (lane === 'slot' && 'slot' in runtime) runtime.slot = value
  if (lane === 'ns' && 'nsSlot' in runtime) runtime.nsSlot = value
  if (lane === 'we' && 'weSlot' in runtime) runtime.weSlot = value
}

function canReceiveOnPort(device: DeviceInstance, runtime: DeviceRuntime, toPortId: string) {
  if (device.typeId === 'item_log_connector') {
    if (toPortId.endsWith('_n') || toPortId.endsWith('_s')) return 'ns'
    return 'we'
  }
  if ('slot' in runtime) return 'slot'
  return 'output'
}

type ReceiveLane = 'slot' | 'ns' | 'we' | 'output'
type ReceiveState = { lane: ReceiveLane | null; canTry: boolean; canAccept: boolean }

function canReceiveOnPortWithPlan(
  device: DeviceInstance,
  runtime: DeviceRuntime,
  toPortId: string,
  reservedReceivers: Set<string>,
  lanesClearingThisTick: Set<string>,
): ReceiveState {
  const lane = canReceiveOnPort(device, runtime, toPortId)
  if (!lane) return { lane: null, canTry: false, canAccept: false }

  const reserveKey = `${device.instanceId}:${lane}`
  if (reservedReceivers.has(reserveKey)) return { lane, canTry: false, canAccept: false }

  if (lane === 'output') return { lane, canTry: true, canAccept: true }
  const slot = getSlotRef(runtime, lane)
  if (!slot) return { lane, canTry: true, canAccept: true }

  if (slot.progress01 >= 1 && lanesClearingThisTick.has(reserveKey)) {
    return { lane, canTry: true, canAccept: true }
  }

  if (slot.progress01 > 0.5 && slot.progress01 < 1) {
    return { lane, canTry: true, canAccept: false }
  }

  return { lane, canTry: false, canAccept: false }
}

function canAcceptIntoLane(device: DeviceInstance, runtime: DeviceRuntime, lane: ReceiveLane, itemId: ItemId) {
  if (lane !== 'output') return true
  if ('inputBuffer' in runtime) return canAcceptProcessorInput(runtime, device.typeId, itemId, 1)
  return true
}

function tryReceiveToLane(
  device: DeviceInstance,
  runtime: DeviceRuntime,
  lane: ReceiveLane,
  toPortId: string,
  itemId: ItemId,
  tick: number,
) {
  if (lane === 'output') {
    if ('inputBuffer' in runtime) return tryAddProcessorInput(runtime, device.typeId, itemId, 1)
    return addToStorage(runtime, itemId, 1)
  }
  const incomingEdge = toPortId.slice(-1).toUpperCase() as keyof typeof OPPOSITE_EDGE
  setSlotRef(runtime, lane, {
    itemId,
    progress01: 0,
    enteredFrom: OPPOSITE_EDGE[incomingEdge],
    enteredTick: tick,
  })
  return true
}

function sourceSlotLane(device: DeviceInstance, runtime: DeviceRuntime, fromPortId: string): 'slot' | 'ns' | 'we' | 'output' {
  if (device.typeId === 'item_log_connector') {
    if (fromPortId.endsWith('_n') || fromPortId.endsWith('_s')) return 'ns'
    return 'we'
  }
  if ('slot' in runtime) return 'slot'
  return 'output'
}

function peekOutputItem(device: DeviceInstance, runtime: DeviceRuntime, warehouse: Record<ItemId, number>): ItemId | null {
  if (device.typeId === 'item_port_unloader_1') {
    const pickupItemId = device.config.pickupItemId
    if (!pickupItemId) return null
    return shouldIgnorePickupInventory(device) || canPickupFromWarehouse(warehouse, pickupItemId) ? pickupItemId : null
  }

  if ('outputBuffer' in runtime) {
    for (const itemId of ITEM_IDS) {
      if ((runtime.outputBuffer[itemId] ?? 0) > 0) return itemId
    }
    return null
  }

  if ('inventory' in runtime) {
    for (const itemId of ITEM_IDS) {
      if ((runtime.inventory[itemId] ?? 0) > 0) return itemId
    }
    return null
  }

  return null
}

function readyItemForLane(
  device: DeviceInstance,
  runtime: DeviceRuntime,
  lane: 'slot' | 'ns' | 'we' | 'output',
  conveyorSpeed: number,
  warehouse: Record<ItemId, number>,
) {
  if (lane === 'output') return peekOutputItem(device, runtime, warehouse)
  const slot = getSlotRef(runtime, lane)
  if (!slot) return null
  if (slot.progress01 < 0.5) return null
  slot.progress01 = Math.min(1, slot.progress01 + conveyorSpeed)
  runtime.progress01 = slot.progress01
  if (slot.progress01 >= 1) return slot.itemId
  return null
}

function peekReadyItemForLane(
  device: DeviceInstance,
  runtime: DeviceRuntime,
  lane: 'slot' | 'ns' | 'we' | 'output',
  warehouse: Record<ItemId, number>,
) {
  if (lane === 'output') return peekOutputItem(device, runtime, warehouse)
  const slot = getSlotRef(runtime, lane)
  if (!slot || slot.progress01 < 1) return null
  return slot.itemId
}

function hasReadyOutput(device: DeviceInstance, runtime: DeviceRuntime, warehouse: Record<ItemId, number>) {
  if (device.typeId === 'item_port_unloader_1') {
    const pickupItemId = device.config.pickupItemId
    return Boolean(pickupItemId && (shouldIgnorePickupInventory(device) || canPickupFromWarehouse(warehouse, pickupItemId)))
  }
  if ('outputBuffer' in runtime) return ITEM_IDS.some((itemId) => (runtime.outputBuffer[itemId] ?? 0) > 0)
  if ('inventory' in runtime) return ITEM_IDS.some((itemId) => (runtime.inventory[itemId] ?? 0) > 0)
  if ('nsSlot' in runtime && 'weSlot' in runtime) {
    const slotReady = Boolean(runtime.slot && runtime.slot.progress01 >= 1)
    const nsReady = Boolean(runtime.nsSlot && runtime.nsSlot.progress01 >= 1)
    const weReady = Boolean(runtime.weSlot && runtime.weSlot.progress01 >= 1)
    return slotReady || nsReady || weReady
  }
  if ('slot' in runtime) return Boolean(runtime.slot && runtime.slot.progress01 >= 1)
  return false
}

function hasInternalBuffer(runtime: DeviceRuntime) {
  return 'outputBuffer' in runtime || 'inventory' in runtime
}

function shouldMarkDownstreamBlockedNoBuffer(
  device: DeviceInstance,
  runtime: DeviceRuntime,
  lanesAdvancedThisTick: ReadonlySet<string>,
) {
  const laneStates: Array<{ lane: 'slot' | 'ns' | 'we'; slot: SlotData | null }> = []
  if ('slot' in runtime) laneStates.push({ lane: 'slot', slot: runtime.slot })
  if ('nsSlot' in runtime) laneStates.push({ lane: 'ns', slot: runtime.nsSlot })
  if ('weSlot' in runtime) laneStates.push({ lane: 'we', slot: runtime.weSlot })

  for (const laneState of laneStates) {
    const slot = laneState.slot
    if (!slot) continue
    if (slot.progress01 < 0.5) continue

    if (slot.progress01 >= 1) {
      return true
    }

    const laneKey = `${device.instanceId}:${laneState.lane}`
    if (!lanesAdvancedThisTick.has(laneKey)) {
      return true
    }
  }

  return false
}

function orderedOutLinks(device: DeviceInstance, runtime: DeviceRuntime, outLinks: ReturnType<typeof neighborsFromLinks>['links']) {
  if ((device.typeId !== 'item_log_splitter' && device.typeId !== 'item_log_converger') || outLinks.length <= 1) return outLinks
  if (!('rrIndex' in runtime)) return outLinks
  const offset = runtime.rrIndex % outLinks.length
  return [...outLinks.slice(offset), ...outLinks.slice(0, offset)]
}

function inPowerRange(target: DeviceInstance, poles: DeviceInstance[]) {
  const targetCells = [] as Array<{ x: number; y: number }>
  const type = DEVICE_TYPE_BY_ID[target.typeId]
  for (let y = 0; y < type.size.height; y += 1) {
    for (let x = 0; x < type.size.width; x += 1) {
      targetCells.push({ x: target.origin.x + x, y: target.origin.y + y })
    }
  }

  return poles.some((pole) =>
    targetCells.some(
      (cell) =>
        cell.x >= pole.origin.x - 5 && cell.x <= pole.origin.x + 6 && cell.y >= pole.origin.y - 5 && cell.y <= pole.origin.y + 6,
    ),
  )
}

function pickupHasConfig(device: DeviceInstance) {
  return device.typeId !== 'item_port_unloader_1' || Boolean(device.config.pickupItemId)
}

function resetRuntimeByLayout(layout: LayoutState) {
  const runtimeById: Record<string, DeviceRuntime> = {}
  for (const device of layout.devices) {
    runtimeById[device.instanceId] = runtimeForDevice(device)
  }
  return runtimeById
}

function preloadEntriesForDevice(device: DeviceInstance) {
  if (Array.isArray(device.config.preloadInputs) && device.config.preloadInputs.length > 0) {
    return [...device.config.preloadInputs].sort((left, right) => left.slotIndex - right.slotIndex)
  }
  if (device.config.preloadInputItemId) {
    return [
      {
        slotIndex: 0,
        itemId: device.config.preloadInputItemId,
        amount: device.config.preloadInputAmount ?? 0,
      },
    ]
  }
  return []
}

function tryAddProcessorInputAtSlot(
  runtime: DeviceRuntime,
  deviceTypeId: DeviceInstance['typeId'],
  slotIndex: number,
  itemId: ItemId,
  amount: number,
) {
  if (!('inputBuffer' in runtime)) return false
  const spec = processorBufferSpec(deviceTypeId, 'input')
  if (slotIndex < 0 || slotIndex >= spec.slots) return false
  if (amount <= 0) return true

  const existingSlotIndex = findSlotIndexByItem(runtime.inputSlotItems, itemId)
  if (existingSlotIndex >= 0 && existingSlotIndex !== slotIndex) return false
  const boundItem = runtime.inputSlotItems[slotIndex]
  if (boundItem && boundItem !== itemId) return false

  const slotCapacity = spec.slotCapacities[slotIndex] ?? DEFAULT_PROCESSOR_BUFFER_CAPACITY
  const nextAmount = (runtime.inputBuffer[itemId] ?? 0) + amount
  if (nextAmount > slotCapacity) return false

  runtime.inputSlotItems[slotIndex] = itemId
  runtime.inputBuffer[itemId] = nextAmount
  return true
}

function cloneSlot(slot: SlotData | null): SlotData | null {
  if (!slot) return null
  return { ...slot }
}

function cloneRuntime(runtime: DeviceRuntime): DeviceRuntime {
  if ('inputBuffer' in runtime && 'outputBuffer' in runtime) {
    return {
      ...runtime,
      inputBuffer: { ...runtime.inputBuffer },
      outputBuffer: { ...runtime.outputBuffer },
      inputSlotItems: [...runtime.inputSlotItems],
      outputSlotItems: [...runtime.outputSlotItems],
    }
  }

  if ('inventory' in runtime) {
    return {
      ...runtime,
      inventory: { ...runtime.inventory },
    }
  }

  if ('nsSlot' in runtime && 'weSlot' in runtime) {
    return {
      ...runtime,
      slot: cloneSlot(runtime.slot),
      nsSlot: cloneSlot(runtime.nsSlot),
      weSlot: cloneSlot(runtime.weSlot),
    }
  }

  return {
    ...runtime,
    slot: cloneSlot(runtime.slot),
  }
}

export function createInitialSimState(): SimState {
  const initialWindowCapacity = cycleTicksFromSeconds(60, BASE_TICK_RATE)
  return {
    isRunning: false,
    speed: 1,
    tick: 0,
    tickRateHz: BASE_TICK_RATE,
    runtimeById: {},
    warehouse: emptyWarehouse(),
    stats: {
      simSeconds: 0,
      producedPerMinute: emptyPerMinuteRecord(),
      consumedPerMinute: emptyPerMinuteRecord(),
      everProduced: emptyPerMinuteRecord(),
      everConsumed: emptyPerMinuteRecord(),
      everStockPositive: emptyPerMinuteRecord(),
    },
    minuteWindowDeltas: Array.from({ length: initialWindowCapacity }, () => createWindowDelta()),
    minuteWindowCursor: 0,
    minuteWindowCount: 0,
    minuteWindowCapacity: initialWindowCapacity,
  }
}

export function startSimulation(layout: LayoutState, sim: SimState): SimState {
  const tickRateHz = BASE_TICK_RATE
  const minuteWindowCapacity = cycleTicksFromSeconds(60, tickRateHz)
  const runtimeById = resetRuntimeByLayout(layout)
  const overlaps = detectOverlaps(layout)
  const poles = layout.devices.filter((device) => device.typeId === 'item_port_power_diffuser_1')

  for (const device of layout.devices) {
    const runtime = runtimeById[device.instanceId]
    const deviceDef = DEVICE_TYPE_BY_ID[device.typeId]
    if ('inputBuffer' in runtime) {
      const inputSpec = processorBufferSpec(device.typeId, 'input')
      for (const preload of preloadEntriesForDevice(device)) {
        const preloadAmount = Math.max(0, Math.floor(preload.amount ?? 0))
        if (!preload.itemId || preloadAmount <= 0) continue
        const slotCapacity = inputSpec.slotCapacities[preload.slotIndex] ?? DEFAULT_PROCESSOR_BUFFER_CAPACITY
        tryAddProcessorInputAtSlot(runtime, device.typeId, preload.slotIndex, preload.itemId, Math.min(preloadAmount, slotCapacity))
      }
    }
    let stall: StallReason = 'NONE'
    if (overlaps.has(device.instanceId)) stall = 'OVERLAP'
    else if (!pickupHasConfig(device)) stall = 'CONFIG_ERROR'
    else if (deviceDef.requiresPower && !inPowerRange(device, poles)) stall = 'NO_POWER'
    normalizeRuntimeState(runtime, stall)
  }

  return {
    ...sim,
    isRunning: true,
    tick: 0,
    tickRateHz,
    runtimeById,
    warehouse: emptyWarehouse(),
    stats: {
      simSeconds: 0,
      producedPerMinute: emptyPerMinuteRecord(),
      consumedPerMinute: emptyPerMinuteRecord(),
      everProduced: emptyPerMinuteRecord(),
      everConsumed: emptyPerMinuteRecord(),
      everStockPositive: emptyPerMinuteRecord(),
    },
    minuteWindowDeltas: Array.from({ length: minuteWindowCapacity }, () => createWindowDelta()),
    minuteWindowCursor: 0,
    minuteWindowCount: 0,
    minuteWindowCapacity,
  }
}

export function stopSimulation(sim: SimState): SimState {
  const tickRateHz = BASE_TICK_RATE
  const minuteWindowCapacity = cycleTicksFromSeconds(60, tickRateHz)
  return {
    ...sim,
    isRunning: false,
    tick: 0,
    tickRateHz,
    runtimeById: {},
    warehouse: createItemNumberRecord(0),
    stats: {
      simSeconds: 0,
      producedPerMinute: emptyPerMinuteRecord(),
      consumedPerMinute: emptyPerMinuteRecord(),
      everProduced: emptyPerMinuteRecord(),
      everConsumed: emptyPerMinuteRecord(),
      everStockPositive: emptyPerMinuteRecord(),
    },
    minuteWindowDeltas: Array.from({ length: minuteWindowCapacity }, () => createWindowDelta()),
    minuteWindowCursor: 0,
    minuteWindowCount: 0,
    minuteWindowCapacity,
  }
}

function recipeById(recipeId: string | undefined) {
  if (!recipeId) return undefined
  return RECIPES.find((recipe) => recipe.id === recipeId)
}

function consumeRecipeInputs(runtime: DeviceRuntime, recipe: (typeof RECIPES)[number]) {
  if (!('inputBuffer' in runtime)) return false
  for (const input of recipe.inputs) {
    if ((runtime.inputBuffer[input.itemId] ?? 0) < input.amount) return false
  }
  for (const input of recipe.inputs) {
    runtime.inputBuffer[input.itemId] = Math.max(0, (runtime.inputBuffer[input.itemId] ?? 0) - input.amount)
    clearSlotBindingIfEmpty(runtime.inputBuffer, runtime.inputSlotItems, input.itemId)
  }
  return true
}

function pickRunnableRecipe(deviceTypeId: DeviceInstance['typeId'], runtime: DeviceRuntime) {
  const recipes = RECIPES.filter((recipe) => recipe.machineType === deviceTypeId)
  for (const recipe of recipes) {
    if (consumeRecipeInputs(runtime, recipe)) return recipe
  }
  return null
}

function ensureMinuteWindow(sim: SimState, capacity: number) {
  if (sim.minuteWindowCapacity === capacity && sim.minuteWindowDeltas.length === capacity) {
    return {
      buffer: sim.minuteWindowDeltas,
      cursor: sim.minuteWindowCursor,
      count: sim.minuteWindowCount,
      producedPerMinute: { ...sim.stats.producedPerMinute },
      consumedPerMinute: { ...sim.stats.consumedPerMinute },
    }
  }

  return {
    buffer: Array.from({ length: capacity }, () => createWindowDelta()),
    cursor: 0,
    count: 0,
    producedPerMinute: emptyPerMinuteRecord(),
    consumedPerMinute: emptyPerMinuteRecord(),
  }
}

export function tickSimulation(layout: LayoutState, sim: SimState): SimState {
  if (!sim.isRunning) return sim

  const conveyorSpeed = conveyorSpeedPerTick(sim.tickRateHz)
  const pickupBlockTicks = cycleTicksFromSeconds(PICKUP_BLOCK_WINDOW_SECONDS, sim.tickRateHz)
  const storageSubmitTicks = cycleTicksFromSeconds(STORAGE_SUBMIT_INTERVAL_SECONDS, sim.tickRateHz)
  const perMinuteWindowTicks = cycleTicksFromSeconds(60, sim.tickRateHz)

  const runtimeById: Record<string, DeviceRuntime> = {}
  for (const [instanceId, runtime] of Object.entries(sim.runtimeById)) {
    runtimeById[instanceId] = cloneRuntime(runtime)
  }
  const links = getNeighbors(layout)
  const deviceById = getDeviceByIdMap(layout)
  const transferPlans: TransferPlan[] = []
  const reservedReceivers = new Set<string>()
  const lanesClearingThisTick = new Set<string>()
  const lanesAdvancedThisTick = new Set<string>()
  const lanesReachedHalfThisTick = new Set<string>()

  const warehouse = { ...sim.warehouse }
  const processorDelta: Partial<Record<ItemId, number>> = {}

  for (const device of layout.devices) {
    const runtime = runtimeById[device.instanceId]
    if (!runtime) continue

    if (isHardBlockedStall(runtime.stallReason)) {
      continue
    }

    normalizeRuntimeState(runtime, 'NONE')

    if ('outputBuffer' in runtime && 'inputBuffer' in runtime) {
      const activeRecipe = recipeById(runtime.activeRecipeId)

      if (runtime.cycleProgressTicks <= 0) {
        const selectedRecipe = pickRunnableRecipe(device.typeId, runtime)
        if (!selectedRecipe) {
          normalizeRuntimeState(runtime, 'NO_INPUT')
        } else {
          runtime.activeRecipeId = selectedRecipe.id
          runtime.cycleProgressTicks = 1
            for (const input of selectedRecipe.inputs) {
              mark(processorDelta, input.itemId, -input.amount)
            }
          const recipeCycleTicks = cycleTicksFromSeconds(selectedRecipe.cycleSeconds, sim.tickRateHz)
          runtime.progress01 = runtime.cycleProgressTicks / recipeCycleTicks
        }
      } else if (activeRecipe) {
        const recipeCycleTicks = cycleTicksFromSeconds(activeRecipe.cycleSeconds, sim.tickRateHz)
        if (runtime.cycleProgressTicks < recipeCycleTicks) {
          runtime.cycleProgressTicks += 1
        }
        runtime.progress01 = Math.min(1, runtime.cycleProgressTicks / recipeCycleTicks)

        if (runtime.cycleProgressTicks >= recipeCycleTicks) {
          if (!canAcceptProcessorOutputBatch(runtime, device.typeId, activeRecipe.outputs)) {
            runtime.cycleProgressTicks = recipeCycleTicks
            runtime.progress01 = 1
            normalizeRuntimeState(runtime, 'OUTPUT_BUFFER_FULL')
          } else {
            const producedThisCycle = commitProcessorOutputBatch(runtime, device.typeId, activeRecipe.outputs)
            runtime.producedItemsTotal += producedThisCycle
            runtime.lastCompletedCycleTicks = runtime.cycleProgressTicks
            const completionTick = sim.tick + 1
            runtime.lastCompletionIntervalTicks =
              runtime.lastCompletionTick === null ? 0 : Math.max(1, completionTick - runtime.lastCompletionTick)
            runtime.lastCompletionTick = completionTick
            for (const output of activeRecipe.outputs) {
              mark(processorDelta, output.itemId, output.amount)
            }
            runtime.cycleProgressTicks = 0
            runtime.progress01 = 0
            runtime.activeRecipeId = undefined
          }
        }
      } else {
        runtime.cycleProgressTicks = 0
        runtime.progress01 = 0
      }
    }

    if (device.typeId === 'item_port_storager_1' && 'inventory' in runtime) {
      runtime.submitAccumulatorTicks += 1
      const enabled = device.config.submitToWarehouse ?? true
      if (enabled && runtime.submitAccumulatorTicks >= storageSubmitTicks) {
        runtime.submitAccumulatorTicks = 0
        for (const itemId of ITEM_IDS) {
          const amount = runtime.inventory[itemId] ?? 0
          if (amount <= 0) continue
          runtime.inventory[itemId] = 0
          if (Number.isFinite(warehouse[itemId])) warehouse[itemId] += amount
        }
      }
    }

    if ('slot' in runtime && runtime.slot) {
      const slot = runtime.slot
      if (slot.progress01 < 0.5) {
        const beforeProgress = slot.progress01
        slot.progress01 = Math.min(0.5, slot.progress01 + conveyorSpeed)
        runtime.progress01 = slot.progress01
        if (beforeProgress < 0.5 && slot.progress01 >= 0.5) {
          lanesReachedHalfThisTick.add(`${device.instanceId}:slot`)
        }
      }
    }

    if ('nsSlot' in runtime && runtime.nsSlot && runtime.nsSlot.progress01 < 0.5) {
      const beforeProgress = runtime.nsSlot.progress01
      runtime.nsSlot.progress01 = Math.min(0.5, runtime.nsSlot.progress01 + conveyorSpeed)
      runtime.progress01 = runtime.nsSlot.progress01
      if (beforeProgress < 0.5 && runtime.nsSlot.progress01 >= 0.5) {
        lanesReachedHalfThisTick.add(`${device.instanceId}:ns`)
      }
    }
    if ('weSlot' in runtime && runtime.weSlot && runtime.weSlot.progress01 < 0.5) {
      const beforeProgress = runtime.weSlot.progress01
      runtime.weSlot.progress01 = Math.min(0.5, runtime.weSlot.progress01 + conveyorSpeed)
      runtime.progress01 = runtime.weSlot.progress01
      if (beforeProgress < 0.5 && runtime.weSlot.progress01 >= 0.5) {
        lanesReachedHalfThisTick.add(`${device.instanceId}:we`)
      }
    }
  }

  const plannedSenders = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const device of layout.devices) {
      const runtime = runtimeById[device.instanceId]
      if (!runtime || isHardBlockedStall(runtime.stallReason) || plannedSenders.has(device.instanceId)) continue
      const rawOutLinks = links.outMap.get(device.instanceId) ?? []
      const outLinks = orderedOutLinks(device, runtime, rawOutLinks)

      for (const link of outLinks) {
        const toRuntime = runtimeById[link.to.instanceId]
        const toDevice = deviceById.get(link.to.instanceId)
        if (!toRuntime || !toDevice) continue

        const recvState = canReceiveOnPortWithPlan(toDevice, toRuntime, link.to.portId, reservedReceivers, lanesClearingThisTick)
        if (!recvState.lane || !recvState.canTry) continue

        const fromLane = sourceSlotLane(device, runtime, link.from.portId)
        const laneAdvanceKey = `${device.instanceId}:${fromLane}`
        if (lanesReachedHalfThisTick.has(laneAdvanceKey)) continue
        if (!lanesAdvancedThisTick.has(laneAdvanceKey)) {
          const beforeSlot = fromLane === 'output' ? null : getSlotRef(runtime, fromLane)
          const beforeProgress = beforeSlot?.progress01 ?? null
          readyItemForLane(device, runtime, fromLane, conveyorSpeed, warehouse)
          lanesAdvancedThisTick.add(laneAdvanceKey)
          const afterSlot = fromLane === 'output' ? null : getSlotRef(runtime, fromLane)
          const afterProgress = afterSlot?.progress01 ?? null
          if (beforeProgress !== null && afterProgress !== null && afterProgress > beforeProgress) {
            changed = true
          }
        }

        const itemId = peekReadyItemForLane(device, runtime, fromLane, warehouse)
        if (!itemId) continue
        if (!recvState.canAccept) continue
        if (!canAcceptIntoLane(toDevice, toRuntime, recvState.lane, itemId)) continue

        transferPlans.push({
          fromId: device.instanceId,
          fromPortId: link.from.portId,
          fromLane,
          toId: toDevice.instanceId,
          toPortId: link.to.portId,
          itemId,
          lane: recvState.lane,
        })

        plannedSenders.add(device.instanceId)
        reservedReceivers.add(`${toDevice.instanceId}:${recvState.lane}`)
        lanesClearingThisTick.add(`${device.instanceId}:${fromLane}`)

        if ((device.typeId === 'item_log_splitter' || device.typeId === 'item_log_converger') && 'rrIndex' in runtime && outLinks.length > 0) {
          runtime.rrIndex = (runtime.rrIndex + 1) % outLinks.length
        }

        changed = true
        break
      }
    }
  }

  for (const device of layout.devices) {
    const runtime = runtimeById[device.instanceId]
    if (!runtime || isHardBlockedStall(runtime.stallReason)) continue
    const outLinks = links.outMap.get(device.instanceId) ?? []

    if (device.typeId === 'item_port_unloader_1' && 'submitAccumulatorTicks' in runtime) {
      if (!device.config.pickupItemId || outLinks.length === 0) {
        runtime.submitAccumulatorTicks = 0
        continue
      }

      if (plannedSenders.has(device.instanceId)) {
        runtime.submitAccumulatorTicks = 0
        continue
      }

      runtime.submitAccumulatorTicks += 1
      if (runtime.submitAccumulatorTicks >= pickupBlockTicks) {
        normalizeRuntimeState(runtime, 'DOWNSTREAM_BLOCKED')
      }
      continue
    }

    if (
      outLinks.length > 0 &&
      !plannedSenders.has(device.instanceId) &&
      hasInternalBuffer(runtime) &&
      hasReadyOutput(device, runtime, warehouse)
    ) {
      normalizeRuntimeState(runtime, 'DOWNSTREAM_BLOCKED')
      continue
    }

    if (
      outLinks.length > 0 &&
      !plannedSenders.has(device.instanceId) &&
      !hasInternalBuffer(runtime) &&
      shouldMarkDownstreamBlockedNoBuffer(device, runtime, lanesAdvancedThisTick)
    ) {
      normalizeRuntimeState(runtime, 'DOWNSTREAM_BLOCKED')
    }
  }

  for (const plan of transferPlans) {
    const fromRuntime = runtimeById[plan.fromId]
    const toRuntime = runtimeById[plan.toId]
    const fromDevice = deviceById.get(plan.fromId)
    if (!fromRuntime || !toRuntime || !fromDevice) continue

    const toDevice = deviceById.get(plan.toId)
    if (!toDevice) continue

    const received = tryReceiveToLane(toDevice, toRuntime, plan.lane, plan.toPortId, plan.itemId, sim.tick)
    if (!received) continue

    if (fromDevice.typeId === 'item_port_unloader_1') {
      if (!shouldIgnorePickupInventory(fromDevice) && Number.isFinite(warehouse[plan.itemId])) {
        warehouse[plan.itemId] = Math.max(0, warehouse[plan.itemId] - 1)
      }
    } else {
      if (plan.fromLane === 'output') {
        if ('outputBuffer' in fromRuntime) {
          fromRuntime.outputBuffer[plan.itemId] = Math.max(0, (fromRuntime.outputBuffer[plan.itemId] ?? 0) - 1)
          clearSlotBindingIfEmpty(fromRuntime.outputBuffer, fromRuntime.outputSlotItems, plan.itemId)
        } else if ('inventory' in fromRuntime) {
          fromRuntime.inventory[plan.itemId] = Math.max(0, (fromRuntime.inventory[plan.itemId] ?? 0) - 1)
        }
      } else {
        if (
          fromDevice.typeId.startsWith('belt_') &&
          plan.fromLane === 'slot' &&
          'slot' in fromRuntime &&
          fromRuntime.slot &&
          'transportTotalTicks' in fromRuntime &&
          'transportSamples' in fromRuntime
        ) {
          const transitTicks = Math.max(1, sim.tick - fromRuntime.slot.enteredTick)
          fromRuntime.transportTotalTicks += transitTicks
          fromRuntime.transportSamples += 1
        }
        setSlotRef(fromRuntime, plan.fromLane, null)
      }
    }
  }

  const nextTick = sim.tick + 1
  const simSeconds = nextTick / sim.tickRateHz
  const minuteWindow = ensureMinuteWindow(sim, perMinuteWindowTicks)
  const minuteWindowDeltas = minuteWindow.buffer
  const writeIndex = sim.tick % perMinuteWindowTicks

  const nextDelta = createWindowDelta(processorDelta)
  minuteWindowDeltas[writeIndex] = nextDelta

  const nextMinuteWindowCursor = nextTick % perMinuteWindowTicks
  const nextMinuteWindowCount = Math.min(sim.tick + 1, perMinuteWindowTicks)

  const producedPerMinute = emptyPerMinuteRecord()
  const consumedPerMinute = emptyPerMinuteRecord()
  const slotsToSum = nextMinuteWindowCount
  for (let index = 0; index < slotsToSum; index += 1) {
    const deltaRecord = minuteWindowDeltas[index] ?? createWindowDelta()
    for (const itemId of ITEM_IDS) {
      const delta = deltaRecord[itemId] ?? 0
      if (delta > 0) producedPerMinute[itemId] += delta
      else if (delta < 0) consumedPerMinute[itemId] += Math.abs(delta)
    }
  }

  const nextStats = {
    simSeconds,
    producedPerMinute,
    consumedPerMinute,
    everProduced: { ...sim.stats.everProduced },
    everConsumed: { ...sim.stats.everConsumed },
    everStockPositive: { ...sim.stats.everStockPositive },
  }

  for (const itemId of ITEM_IDS) {
    const delta = nextDelta[itemId] ?? 0
    if (delta > 0) {
      nextStats.everProduced[itemId] = (nextStats.everProduced[itemId] ?? 0) + delta
    } else if (delta < 0) {
      nextStats.everConsumed[itemId] = (nextStats.everConsumed[itemId] ?? 0) + Math.abs(delta)
    }

    const stock = warehouse[itemId] ?? 0
    if (Number.isFinite(stock) && stock > 0) {
      nextStats.everStockPositive[itemId] = 1
    }
  }

  return {
    ...sim,
    tick: nextTick,
    runtimeById,
    warehouse,
    stats: nextStats,
    minuteWindowDeltas,
    minuteWindowCursor: nextMinuteWindowCursor,
    minuteWindowCount: nextMinuteWindowCount,
    minuteWindowCapacity: perMinuteWindowTicks,
  }
}

export function initialStorageConfig(deviceTypeId: string) {
  if (deviceTypeId === 'item_port_storager_1') return { submitToWarehouse: true }
  return {}
}

export function getInventory(runtime: DeviceRuntime | undefined) {
  const empty = { item_originium_ore: 0, item_originium_powder: 0 }
  if (!runtime) return empty
  if ('inventory' in runtime) {
    return {
      item_originium_ore: runtime.inventory.item_originium_ore ?? 0,
      item_originium_powder: runtime.inventory.item_originium_powder ?? 0,
    }
  }
  if ('inputBuffer' in runtime && 'outputBuffer' in runtime) {
    return {
      item_originium_ore: runtime.inputBuffer.item_originium_ore ?? 0,
      item_originium_powder: runtime.outputBuffer.item_originium_powder ?? 0,
    }
  }
  return empty
}
