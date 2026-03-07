import { BASE_BY_ID, DEVICE_TYPE_BY_ID, ITEM_BY_ID, ITEMS, RECIPES } from '../domain/registry'
import { detectOverlaps, getFootprintCells, getRotatedPorts, isBelt, isPipeLike, neighborsFromLinks, OPPOSITE_EDGE } from '../domain/geometry'
import { cycleTicksFromSeconds } from '../domain/shared/simulation'
import {
  isReactorPoolType,
  reactorAcceptInputFromPort,
  reactorCanAcceptRecipeOutputsInSharedSlotPool,
  reactorCommitRecipeOutputsToSharedSlotPool,
  reactorConsumeItemFromSharedSlotPool,
  reactorPeekOutputForPort,
  reactorSelectedRecipeIds,
} from './reactorPool'
import { solvePullTransferMatches } from './flow/plan'
import { commitTransferMatches } from './flow/commit'
import type { PortLink as FlowPortLink, TransferMatch } from './flow/types'
import type {
  BufferGroupRuntime,
  BufferSlotRuntime,
  BeltRuntime,
  DeviceInstance,
  DeviceRuntime,
  ItemId,
  LayoutState,
  PowerMode,
  ProcessorRuntime,
  RecipeDef,
  SimState,
  SlotData,
  StorageSlotConfigEntry,
  StallReason,
} from '../domain/types'

const BASE_TICK_RATE = 20
const BELT_SECONDS_PER_CELL = 2
const PIPE_SECONDS_PER_CELL = 0.5
const PICKUP_BLOCK_WINDOW_SECONDS = BELT_SECONDS_PER_CELL
const STORAGE_SUBMIT_INTERVAL_SECONDS = 10
const DEFAULT_WATER_PUMP_ITEM_ID: ItemId = 'item_liquid_water'
const WATER_PUMP_SELECTABLE_ITEM_IDS: ItemId[] = [
  'item_liquid_water',
  'item_liquid_plant_grass_1',
  'item_liquid_plant_grass_2',
  'item_liquid_xiranite',
]
const WATER_PUMP_SELECTABLE_ITEM_SET = new Set<ItemId>(WATER_PUMP_SELECTABLE_ITEM_IDS)
const DEFAULT_PROCESSOR_BUFFER_CAPACITY = 50
const DEFAULT_PROCESSOR_BUFFER_SLOTS = 1
const ITEM_IDS: ItemId[] = ITEMS.map((item) => item.id)
const INFINITE_WAREHOUSE_TAG = '矿石'
const INFINITE_WAREHOUSE_ITEMS = new Set<ItemId>(
  ITEMS.filter((item) => item.tags?.includes(INFINITE_WAREHOUSE_TAG)).map((item) => item.id),
)
const BUS_SOURCE_TYPE_ID: DeviceInstance['typeId'] = 'item_port_log_hongs_bus_source'
const BUS_SEGMENT_TYPE_ID: DeviceInstance['typeId'] = 'item_port_log_hongs_bus'
const PICKUP_TYPE_ID: DeviceInstance['typeId'] = 'item_port_unloader_1'
const PROTOCOL_HUB_TYPE_ID: DeviceInstance['typeId'] = 'item_port_sp_hub_1'
const STORAGE_BOX_TYPE_ID: DeviceInstance['typeId'] = 'item_port_storager_1'
const PROTOCOL_HUB_STORAGE_GROUP_ID = 'protocol-hub-storage-group-1'
const STORAGE_BOX_GROUP_ID = 'storage-box-group-1'
const REACTOR_SOLID_GROUP_ID = 'reactor-solid-group-1'
const REACTOR_LIQUID_GROUP_ID = 'reactor-liquid-group-1'
const STORAGE_SLOT_COUNT = 6
const STORAGE_SLOT_CAPACITY = 50
const LOADER_TYPE_ID: DeviceInstance['typeId'] = 'item_port_loader_1'
const THERMAL_POOL_TYPE_ID: DeviceInstance['typeId'] = 'item_port_power_sta_1'
const PROTOCOL_HUB_SUPPLY_KW = 200
const GLOBAL_BATTERY_CAPACITY_J = 100_000_000
const PICKUP_OUTPUT_PORT_ID = 'p_out_mid'
const PROTOCOL_HUB_OUTPUT_PORT_IDS = ['out_w_2', 'out_w_5', 'out_w_8', 'out_e_2', 'out_e_5', 'out_e_8'] as const
const PROTOCOL_HUB_WAREHOUSE_INPUT_PORT_IDS = new Set([
  'in_n_2',
  'in_n_3',
  'in_n_4',
  'in_n_5',
  'in_n_6',
  'in_n_7',
  'in_n_8',
  'in_s_2',
  'in_s_3',
  'in_s_4',
  'in_s_5',
  'in_s_6',
  'in_s_7',
  'in_s_8',
])

const THERMAL_POOL_FUEL_RULES: Array<{ itemId: ItemId; burnSeconds: number; powerKw: number }> = [
  { itemId: 'item_originium_ore', burnSeconds: 8, powerKw: 50 },
  { itemId: 'item_proc_battery_1', burnSeconds: 40, powerKw: 220 },
  { itemId: 'item_proc_battery_2', burnSeconds: 40, powerKw: 420 },
  { itemId: 'item_proc_battery_3', burnSeconds: 40, powerKw: 1100 },
  { itemId: 'item_proc_battery_4', burnSeconds: 40, powerKw: 1600 },
]

const THERMAL_POOL_VIRTUAL_RECIPES: RecipeDef[] = THERMAL_POOL_FUEL_RULES.map((rule) => ({
  id: `virtual_thermal_pool_${rule.itemId}`,
  machineType: THERMAL_POOL_TYPE_ID,
  cycleSeconds: rule.burnSeconds,
  inputs: [{ itemId: rule.itemId, amount: 1 }],
  outputs: [],
}))

const THERMAL_POOL_POWER_BY_RECIPE_ID = new Map(
  THERMAL_POOL_VIRTUAL_RECIPES.map((recipe, index) => [recipe.id, THERMAL_POOL_FUEL_RULES[index].powerKw]),
)

function createItemNumberRecord(initialValue = 0): Record<ItemId, number> {
  return Object.fromEntries(ITEM_IDS.map((itemId) => [itemId, initialValue])) as Record<ItemId, number>
}

function isPipeTransportType(typeId: DeviceInstance['typeId']) {
  return isPipeLike(typeId)
}

function transportSpeedPerTick(typeId: DeviceInstance['typeId'], tickRateHz: number) {
  const secondsPerCell = isPipeTransportType(typeId) ? PIPE_SECONDS_PER_CELL : BELT_SECONDS_PER_CELL
  return 1 / Math.max(1, secondsPerCell * tickRateHz)
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
    const isReactor = isReactorPoolType(device.typeId)
    return {
      ...baseRuntime(),
      inputBuffer: {},
      outputBuffer: {},
      inputSlotItems: Array.from({ length: inputSpec.slots }, () => null),
      outputSlotItems: Array.from({ length: outputSpec.slots }, () => null),
      bufferGroups: isReactor ? createReactorBufferGroups() : undefined,
      cycleProgressTicks: 0,
      reactorCycleProgressTicks: isReactor ? [0, 0] : undefined,
      producedItemsTotal: 0,
      lastCompletedCycleTicks: 0,
      lastCompletionTick: null,
      lastCompletionIntervalTicks: 0,
      activeRecipeId: undefined,
      reactorActiveRecipeIds: isReactor ? [undefined, undefined] : undefined,
    }
  }
  if (def.runtimeKind === 'storage') {
    const bufferGroups =
      device.typeId === PROTOCOL_HUB_TYPE_ID
        ? [createProtocolStorageBufferGroup(device)]
        : device.typeId === STORAGE_BOX_TYPE_ID
          ? [createStorageBoxBufferGroup(device)]
          : undefined
    return {
      ...baseRuntime(),
      inventory: {},
      submitAccumulatorTicks: 0,
      bufferGroups,
    }
  }
  if (def.runtimeKind === 'conveyor') {
    if (isBelt(device.typeId)) {
      return {
        ...baseRuntime(),
        slot: null,
        transportTotalTicks: 0,
        transportSamples: 0,
        inputBuffer: {},
        outputBuffer: {},
        inputSlotItems: [null],
        outputSlotItems: [null],
        cycleProgressTicks: 0,
        producedItemsTotal: 0,
        lastCompletedCycleTicks: 0,
        lastCompletionTick: null,
        lastCompletionIntervalTicks: 0,
        activeRecipeId: undefined,
      }
    }
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

function configuredOutputEntry(device: DeviceInstance, fromPortId: string) {
  if (device.typeId === PICKUP_TYPE_ID) {
    if (fromPortId !== PICKUP_OUTPUT_PORT_ID) return undefined
    const fromPortConfig = (device.config.protocolHubOutputs ?? []).find((entry) => entry.portId === PICKUP_OUTPUT_PORT_ID)
    if (fromPortConfig) return fromPortConfig
    if (!device.config.pickupItemId) return undefined
    return {
      portId: PICKUP_OUTPUT_PORT_ID,
      itemId: device.config.pickupItemId,
      ignoreInventory: device.config.pickupIgnoreInventory,
    }
  }
  if (device.typeId === PROTOCOL_HUB_TYPE_ID) {
    return (device.config.protocolHubOutputs ?? []).find((entry) => entry.portId === fromPortId)
  }
  return undefined
}

function shouldIgnoreConfiguredOutputInventory(device: DeviceInstance, fromPortId: string, itemId: ItemId) {
  const entry = configuredOutputEntry(device, fromPortId)
  if (!entry || entry.itemId !== itemId) return false
  if (INFINITE_WAREHOUSE_ITEMS.has(itemId)) return true
  return Boolean(entry.ignoreInventory)
}

function configuredOutputItemForPort(device: DeviceInstance, warehouse: Record<ItemId, number>, fromPortId: string) {
  const entry = configuredOutputEntry(device, fromPortId)
  const itemId = entry?.itemId
  if (!itemId) return null
  if (shouldIgnoreConfiguredOutputInventory(device, fromPortId, itemId)) return itemId
  return canPickupFromWarehouse(warehouse, itemId) ? itemId : null
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
  return (
    stallReason === 'CONFIG_ERROR' ||
    stallReason === 'OVERLAP' ||
    stallReason === 'BUS_NOT_CONNECTED' ||
    stallReason === 'PICKUP_BUS_NOT_CONNECTED'
  )
}

function isWarehouseSubmitPort(device: DeviceInstance, toPortId: string) {
  if (device.typeId === LOADER_TYPE_ID) return true
  if (device.typeId === PROTOCOL_HUB_TYPE_ID) return PROTOCOL_HUB_WAREHOUSE_INPUT_PORT_IDS.has(toPortId)
  return false
}

function updateThermalPoolPowerAndGetSupplyKw(
  layout: LayoutState,
  runtimeById: Record<string, DeviceRuntime>,
  tickRateHz: number,
  processorDelta: Partial<Record<ItemId, number>>,
) {
  void processorDelta
  let totalSupplyKw = 0

  for (const device of layout.devices) {
    if (device.typeId === PROTOCOL_HUB_TYPE_ID) {
      totalSupplyKw += PROTOCOL_HUB_SUPPLY_KW
    }
  }

  for (const device of layout.devices) {
    if (device.typeId !== THERMAL_POOL_TYPE_ID) continue
    const runtime = runtimeById[device.instanceId]
    if (!runtime || !isRecipeProcessorRuntime(runtime)) continue

    if (runtime.cycleProgressTicks <= 0 || !runtime.activeRecipeId) {
      runtime.thermalPowerTicksRemaining = 0
      runtime.thermalPowerKw = 0
      continue
    }

    const activeRecipe = recipeById(runtime.activeRecipeId)
    if (!activeRecipe || activeRecipe.machineType !== THERMAL_POOL_TYPE_ID) {
      runtime.thermalPowerTicksRemaining = 0
      runtime.thermalPowerKw = 0
      continue
    }

    const activeKw = THERMAL_POOL_POWER_BY_RECIPE_ID.get(activeRecipe.id) ?? 0
    if (activeKw <= 0) {
      runtime.thermalPowerTicksRemaining = 0
      runtime.thermalPowerKw = 0
      continue
    }

    totalSupplyKw += activeKw
    runtime.thermalPowerKw = activeKw
    const cycleTicks = cycleTicksFromSeconds(activeRecipe.cycleSeconds, tickRateHz)
    runtime.thermalPowerTicksRemaining = Math.max(0, cycleTicks - runtime.cycleProgressTicks)
  }

  return totalSupplyKw
}

function buildPowerAvailabilityByDeviceId(
  layout: LayoutState,
  runtimeById: Record<string, DeviceRuntime>,
  poles: DeviceInstance[],
  tickRateHz: number,
  processorDelta: Partial<Record<ItemId, number>>,
  batteryStoredJ: number,
) {
  const unpoweredById = new Set<string>()
  const outOfRangeById = new Set<string>()
  const powerCandidates: Array<{ instanceId: string; demandKw: number }> = []

  const totalSupplyKw = updateThermalPoolPowerAndGetSupplyKw(layout, runtimeById, tickRateHz, processorDelta)

  for (const device of layout.devices) {
    const deviceDef = DEVICE_TYPE_BY_ID[device.typeId]
    if (!deviceDef.requiresPower) continue
    if (!inPowerRange(device, poles)) {
      outOfRangeById.add(device.instanceId)
      continue
    }

    const demandKw = Math.max(0, deviceDef.powerDemand ?? 0)
    if (demandKw <= 0) continue
    powerCandidates.push({ instanceId: device.instanceId, demandKw })
  }

  const totalDemandInRangeKw = powerCandidates.reduce((sum, candidate) => sum + candidate.demandKw, 0)
  const deficitKw = Math.max(0, totalDemandInRangeKw - totalSupplyKw)
  const requiredBatteryJ = (deficitKw * 1000) / tickRateHz
  const batteryUsedJ = Math.min(Math.max(0, batteryStoredJ), requiredBatteryJ)
  const batteryAssistKw = (batteryUsedJ * tickRateHz) / 1000
  const nextBatteryStoredJ = Math.max(0, batteryStoredJ - batteryUsedJ)

  let remainingSupplyKw = totalSupplyKw + batteryAssistKw
  for (const candidate of powerCandidates) {
    if (remainingSupplyKw >= candidate.demandKw) {
      remainingSupplyKw -= candidate.demandKw
      continue
    }
    unpoweredById.add(candidate.instanceId)
  }

  return { unpoweredById, outOfRangeById, totalSupplyKw, nextBatteryStoredJ }
}

function totalPowerDemandKw(layout: LayoutState) {
  return layout.devices.reduce((sum, device) => sum + Math.max(0, DEVICE_TYPE_BY_ID[device.typeId]?.powerDemand ?? 0), 0)
}

function neighborCellKeys(x: number, y: number) {
  return [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`]
}

function analyzeWarehouseBusConnectivity(layout: LayoutState) {
  const baseFoundationBusSegmentIds = new Set(
    (BASE_BY_ID[layout.baseId]?.foundationBuildings ?? [])
      .filter((building) => building.typeId === BUS_SEGMENT_TYPE_ID)
      .map((building) => building.instanceId),
  )

  const busDevices = layout.devices.filter(
    (device) => device.typeId === BUS_SOURCE_TYPE_ID || device.typeId === BUS_SEGMENT_TYPE_ID,
  )
  if (busDevices.length === 0) {
    return {
      disconnectedBusSegmentIds: new Set<string>(),
      busEdgePortBlockedByDisconnectedBusIds: new Set<string>(),
    }
  }

  const busDeviceById = new Map(busDevices.map((device) => [device.instanceId, device]))
  const busOccupancy = new Map<string, Set<string>>()
  for (const device of busDevices) {
    for (const cell of getFootprintCells(device)) {
      const key = `${cell.x},${cell.y}`
      const bucket = busOccupancy.get(key)
      if (bucket) bucket.add(device.instanceId)
      else busOccupancy.set(key, new Set([device.instanceId]))
    }
  }

  const adjacency = new Map<string, Set<string>>()
  for (const device of busDevices) {
    const neighbors = adjacency.get(device.instanceId) ?? new Set<string>()
    adjacency.set(device.instanceId, neighbors)

    for (const cell of getFootprintCells(device)) {
      for (const neighborKey of neighborCellKeys(cell.x, cell.y)) {
        const occupantIds = busOccupancy.get(neighborKey)
        if (!occupantIds) continue
        for (const neighborId of occupantIds) {
          if (neighborId === device.instanceId) continue
          neighbors.add(neighborId)
        }
      }
    }
  }

  const disconnectedBusSegmentIds = new Set<string>()
  const visited = new Set<string>()
  for (const device of busDevices) {
    if (visited.has(device.instanceId)) continue
    const queue = [device.instanceId]
    const component = new Set<string>()
    let hasSource = false
    let hasBaseFoundationBusSegment = false

    while (queue.length > 0) {
      const currentId = queue.shift()!
      if (visited.has(currentId)) continue
      visited.add(currentId)
      component.add(currentId)

      const currentDevice = busDeviceById.get(currentId)
      if (currentDevice?.typeId === BUS_SOURCE_TYPE_ID) hasSource = true
      if (baseFoundationBusSegmentIds.has(currentId)) hasBaseFoundationBusSegment = true

      const nextIds = adjacency.get(currentId)
      if (!nextIds) continue
      for (const nextId of nextIds) {
        if (!visited.has(nextId)) queue.push(nextId)
      }
    }

    if (!hasSource && !hasBaseFoundationBusSegment) {
      for (const id of component) {
        const d = busDeviceById.get(id)
        if (d?.typeId === BUS_SEGMENT_TYPE_ID) disconnectedBusSegmentIds.add(id)
      }
    }
  }

  const disconnectedBusOccupancy = new Set<string>()
  for (const segmentId of disconnectedBusSegmentIds) {
    const segment = busDeviceById.get(segmentId)
    if (!segment) continue
    for (const cell of getFootprintCells(segment)) {
      disconnectedBusOccupancy.add(`${cell.x},${cell.y}`)
    }
  }

  const busEdgePortBlockedByDisconnectedBusIds = new Set<string>()
  for (const edgePort of layout.devices) {
    if (edgePort.typeId !== PICKUP_TYPE_ID && edgePort.typeId !== LOADER_TYPE_ID) continue
    const edgePortCells = getFootprintCells(edgePort)
    let blocked = false
    for (const cell of edgePortCells) {
      for (const neighborKey of neighborCellKeys(cell.x, cell.y)) {
        if (disconnectedBusOccupancy.has(neighborKey)) {
          blocked = true
          break
        }
      }
      if (blocked) break
    }
    if (blocked) busEdgePortBlockedByDisconnectedBusIds.add(edgePort.instanceId)
  }

  return {
    disconnectedBusSegmentIds,
    busEdgePortBlockedByDisconnectedBusIds,
  }
}

function waterPumpOutputItemId(device: DeviceInstance): ItemId {
  const configured = device.config.pumpOutputItemId
  if (configured && WATER_PUMP_SELECTABLE_ITEM_SET.has(configured)) return configured
  return DEFAULT_WATER_PUMP_ITEM_ID
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

function preferredInputSlotIndex(deviceTypeId: DeviceInstance['typeId'], itemId: ItemId) {
  if (
    deviceTypeId !== 'item_port_xiranite_oven_1' &&
    deviceTypeId !== 'item_port_liquid_filling_pd_mc_1' &&
    deviceTypeId !== 'item_port_hydro_planter_1'
  )
    return null
  const itemType = ITEM_BY_ID[itemId]?.type
  if (itemType === 'liquid') return 1
  return 0
}

function findEvictableInputSlotIndex(runtime: DeviceRuntime, deviceTypeId: DeviceInstance['typeId'], incomingItemId: ItemId) {
  if (!('inputBuffer' in runtime) || !('outputBuffer' in runtime)) return -1
  if (runtime.cycleProgressTicks > 0 || runtime.activeRecipeId) return -1

  const recipes = RECIPES.filter((recipe) => recipe.machineType === deviceTypeId)
  if (recipes.length <= 1) return -1

  const incomingSupported = recipes.some((recipe) => recipe.inputs.some((input) => input.itemId === incomingItemId))
  if (!incomingSupported) return -1

  for (let slotIndex = 0; slotIndex < runtime.inputSlotItems.length; slotIndex += 1) {
    const boundItemId = runtime.inputSlotItems[slotIndex]
    if (!boundItemId || boundItemId === incomingItemId) continue
    const buffered = runtime.inputBuffer[boundItemId] ?? 0
    if (buffered <= 0) return slotIndex
  }

  return -1
}

function resolveProcessorTargetSlotIndex(
  runtime: ProcessorRuntime,
  deviceTypeId: DeviceInstance['typeId'],
  bufferKind: ProcessorBufferKind,
  itemId: ItemId,
) {
  const slotItems = bufferKind === 'input' ? runtime.inputSlotItems : runtime.outputSlotItems
  const existingSlotIndex = findSlotIndexByItem(slotItems, itemId)
  if (existingSlotIndex >= 0) {
    return {
      slotItems,
      existingSlotIndex,
      targetSlotIndex: existingSlotIndex,
      evictSlotIndex: -1,
    }
  }

  const preferredSlotIndex = bufferKind === 'input' ? preferredInputSlotIndex(deviceTypeId, itemId) : null
  if (
    preferredSlotIndex !== null &&
    preferredSlotIndex >= 0 &&
    preferredSlotIndex < slotItems.length &&
    !slotItems[preferredSlotIndex]
  ) {
    return {
      slotItems,
      existingSlotIndex,
      targetSlotIndex: preferredSlotIndex,
      evictSlotIndex: -1,
    }
  }

  const firstEmptySlotIndex = findFirstEmptySlot(slotItems)
  if (firstEmptySlotIndex >= 0) {
    return {
      slotItems,
      existingSlotIndex,
      targetSlotIndex: firstEmptySlotIndex,
      evictSlotIndex: -1,
    }
  }

  if (bufferKind === 'input') {
    const evictSlotIndex = findEvictableInputSlotIndex(runtime, deviceTypeId, itemId)
    if (evictSlotIndex >= 0) {
      return {
        slotItems,
        existingSlotIndex,
        targetSlotIndex: evictSlotIndex,
        evictSlotIndex,
      }
    }
  }

  return {
    slotItems,
    existingSlotIndex,
    targetSlotIndex: -1,
    evictSlotIndex: -1,
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
  const { slotItems, targetSlotIndex, evictSlotIndex } = resolveProcessorTargetSlotIndex(runtime as ProcessorRuntime, deviceTypeId, bufferKind, itemId)
  if (targetSlotIndex < 0) return false
  if (targetSlotIndex >= slotItems.length) return false
  if (slotItems[targetSlotIndex] && slotItems[targetSlotIndex] !== itemId && evictSlotIndex !== targetSlotIndex) return false

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
  const { slotItems, targetSlotIndex, evictSlotIndex } = resolveProcessorTargetSlotIndex(runtime as ProcessorRuntime, deviceTypeId, bufferKind, itemId)
  let slotIndex = findSlotIndexByItem(slotItems, itemId)
  if (slotIndex < 0) {
    slotIndex = targetSlotIndex
    if (slotIndex < 0) return false
    if (slotIndex >= slotItems.length) return false
    if (slotItems[slotIndex] && slotItems[slotIndex] !== itemId) {
      if (evictSlotIndex !== slotIndex || bufferKind !== 'input') return false
      const evictedItemId = slotItems[slotIndex]
      if (evictedItemId) {
        runtime.inputBuffer[evictedItemId] = 0
      }
      slotItems[slotIndex] = null
    }
    slotItems[slotIndex] = itemId
  }
  buffer[itemId] = (buffer[itemId] ?? 0) + amount
  return true
}

function tryAddProcessorInput(runtime: DeviceRuntime, deviceTypeId: DeviceInstance['typeId'], itemId: ItemId, amount: number) {
  return tryAddProcessorBufferAmount(runtime, deviceTypeId, 'input', itemId, amount)
}

function syncReactorGroupSlotsFromRuntime(runtime: ProcessorRuntime, group: BufferGroupRuntime) {
  for (const slot of group.slots) {
    const boundItemId = runtime.inputSlotItems[slot.slotIndex]
    const amount = boundItemId ? (runtime.inputBuffer[boundItemId] ?? 0) : 0
    slot.currentItemId = boundItemId ?? null
    slot.amount = Math.max(0, Math.min(slot.capacity, amount))
  }
}

function isReactorProcessorRuntime(runtime: DeviceRuntime): runtime is ProcessorRuntime {
  return 'inputBuffer' in runtime && 'outputBuffer' in runtime && Array.isArray(runtime.reactorCycleProgressTicks)
}

function reactorPortCanAcceptItem(toPortId: string, itemId: ItemId) {
  const itemType = ITEM_BY_ID[itemId]?.type
  if (toPortId === 'in_e_1' || toPortId === 'in_e_3') return itemType === 'liquid'
  if (toPortId === 'in_s_1' || toPortId === 'in_s_3') return itemType === 'solid'
  return false
}

function tryAddReactorInput(runtime: DeviceRuntime, toPortId: string, itemId: ItemId, amount: number) {
  if (!('inputBuffer' in runtime) || !('outputBuffer' in runtime)) return false
  if (!reactorPortCanAcceptItem(toPortId, itemId)) return false

  const processorRuntime = runtime as ProcessorRuntime
  const inputSpec = processorBufferSpec('item_port_mix_pool_1', 'input')
  const mappedGroup = getBufferGroupForInputPort(processorRuntime, toPortId)
  if (mappedGroup) {
    syncReactorGroupSlotsFromRuntime(processorRuntime, mappedGroup)
    const targetSlot = findStorageAcceptSlot(mappedGroup, itemId)
    if (!targetSlot) return false
    const slotCapacity = inputSpec.slotCapacities[targetSlot.slotIndex] ?? DEFAULT_PROCESSOR_BUFFER_CAPACITY
    if ((processorRuntime.inputBuffer[itemId] ?? 0) + amount > slotCapacity) return false
    return tryAddProcessorInputAtSlot(processorRuntime, 'item_port_mix_pool_1', targetSlot.slotIndex, itemId, amount)
  }

  return reactorAcceptInputFromPort(processorRuntime, toPortId, itemId, amount, inputSpec.slotCapacities)
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

function collectSolidInputPortIds(typeId: DeviceInstance['typeId']) {
  return DEVICE_TYPE_BY_ID[typeId].ports0
    .filter((port) => port.direction === 'Input' && allowsSolidInputType(port.allowedTypes))
    .map((port) => port.id)
}

function collectSolidOutputPortIds(typeId: DeviceInstance['typeId']) {
  return DEVICE_TYPE_BY_ID[typeId].ports0
    .filter((port) => port.direction === 'Output' && allowsSolidInputType(port.allowedTypes))
    .map((port) => port.id)
}

function createProtocolStorageBufferGroup(device: DeviceInstance): BufferGroupRuntime {
  const slots: BufferSlotRuntime[] = Array.from({ length: STORAGE_SLOT_COUNT }, (_, slotIndex) => ({
    slotIndex,
    mode: 'free',
    currentItemId: null,
    amount: 0,
    capacity: STORAGE_SLOT_CAPACITY,
  }))

  return {
    id: PROTOCOL_HUB_STORAGE_GROUP_ID,
    inPortIds: collectSolidInputPortIds(device.typeId),
    outPortIds: collectSolidOutputPortIds(device.typeId),
    inCursor: 0,
    outCursor: 0,
    slots,
  }
}

function createStorageBoxBufferGroup(device: DeviceInstance): BufferGroupRuntime {
  const slots: BufferSlotRuntime[] = Array.from({ length: STORAGE_SLOT_COUNT }, (_, slotIndex) => ({
    slotIndex,
    mode: 'free',
    currentItemId: null,
    amount: 0,
    capacity: STORAGE_SLOT_CAPACITY,
  }))

  return {
    id: STORAGE_BOX_GROUP_ID,
    inPortIds: collectSolidInputPortIds(device.typeId),
    outPortIds: collectSolidOutputPortIds(device.typeId),
    inCursor: 0,
    outCursor: 0,
    slots,
  }
}

function createReactorBufferGroups(): BufferGroupRuntime[] {
  const sharedSlotCapacities = processorBufferSpec('item_port_mix_pool_1', 'input').slotCapacities
  const createSlots = () =>
    Array.from({ length: sharedSlotCapacities.length }, (_, slotIndex) => ({
      slotIndex,
      mode: 'free' as const,
      currentItemId: null,
      amount: 0,
      capacity: sharedSlotCapacities[slotIndex] ?? STORAGE_SLOT_CAPACITY,
    }))

  return [
    {
      id: REACTOR_SOLID_GROUP_ID,
      inPortIds: ['in_s_1', 'in_s_3'],
      outPortIds: ['out_n_1', 'out_n_3'],
      inCursor: 0,
      outCursor: 0,
      slots: createSlots(),
    },
    {
      id: REACTOR_LIQUID_GROUP_ID,
      inPortIds: ['in_e_1', 'in_e_3'],
      outPortIds: ['out_w_1', 'out_w_3'],
      inCursor: 0,
      outCursor: 0,
      slots: createSlots(),
    },
  ]
}

function applyStorageSlotConfigToRuntime(runtime: DeviceRuntime, storageSlots: StorageSlotConfigEntry[] | undefined) {
  const groups = getBufferGroups(runtime)
  if (groups.length === 0 || !Array.isArray(storageSlots) || storageSlots.length === 0) return

  for (const group of groups) {
    const slotByIndex = new Map(group.slots.map((slot) => [slot.slotIndex, slot]))
    for (const configSlot of storageSlots) {
      const targetSlot = slotByIndex.get(configSlot.slotIndex)
      if (!targetSlot) continue
      targetSlot.mode = configSlot.mode === 'pinned' ? 'pinned' : 'free'
      targetSlot.pinnedItemId = targetSlot.mode === 'pinned' ? configSlot.pinnedItemId : undefined
    }
  }
}

function getPrimaryBufferGroup(runtime: DeviceRuntime): BufferGroupRuntime | null {
  if (!('bufferGroups' in runtime) || !Array.isArray(runtime.bufferGroups) || runtime.bufferGroups.length === 0) return null
  return runtime.bufferGroups[0] ?? null
}

function getBufferGroups(runtime: DeviceRuntime): BufferGroupRuntime[] {
  if (!('bufferGroups' in runtime) || !Array.isArray(runtime.bufferGroups) || runtime.bufferGroups.length === 0) return []
  return runtime.bufferGroups
}

function getBufferGroupForInputPort(runtime: DeviceRuntime, portId: string): BufferGroupRuntime | null {
  for (const group of getBufferGroups(runtime)) {
    if (group.inPortIds.includes(portId)) return group
  }
  return null
}

function getBufferGroupForOutputPort(runtime: DeviceRuntime, portId: string): BufferGroupRuntime | null {
  for (const group of getBufferGroups(runtime)) {
    if (group.outPortIds.includes(portId)) return group
  }
  return null
}

function rotatedPortOrder(portOrder: string[], cursor: number) {
  if (portOrder.length <= 1) return portOrder
  const offset = ((cursor % portOrder.length) + portOrder.length) % portOrder.length
  return [...portOrder.slice(offset), ...portOrder.slice(0, offset)]
}

function advanceBufferGroupInputCursor(runtime: DeviceRuntime, pickedPortId: string) {
  const group = getBufferGroupForInputPort(runtime, pickedPortId)
  if (!group || group.inPortIds.length <= 1) return false
  const index = group.inPortIds.findIndex((portId) => portId === pickedPortId)
  if (index < 0) return false
  group.inCursor = (index + 1) % group.inPortIds.length
  return true
}

function advanceBufferGroupOutputCursor(runtime: DeviceRuntime, pickedPortId: string) {
  const group = getBufferGroupForOutputPort(runtime, pickedPortId)
  if (!group || group.outPortIds.length <= 1) return false
  const index = group.outPortIds.findIndex((portId) => portId === pickedPortId)
  if (index < 0) return false
  group.outCursor = (index + 1) % group.outPortIds.length
  return true
}

function isStorageWithBufferGroups(runtime: DeviceRuntime) {
  if (getBufferGroups(runtime).length === 0) return false
  if ('inventory' in runtime) return true
  return isReactorProcessorRuntime(runtime)
}

function canStorageSlotAcceptItem(slot: BufferSlotRuntime, itemId: ItemId) {
  if (slot.amount >= slot.capacity) return false
  if (slot.mode === 'pinned') {
    if (!slot.pinnedItemId) return false
    if (itemId !== slot.pinnedItemId) return false
  }

  if (!slot.currentItemId) return true
  return slot.currentItemId === itemId
}

function findStorageAcceptSlot(group: BufferGroupRuntime, itemId: ItemId) {
  const ordered = [...group.slots].sort((left, right) => left.slotIndex - right.slotIndex)
  return ordered.find((slot) => canStorageSlotAcceptItem(slot, itemId)) ?? null
}

function rebuildStorageInventoryFromGroups(runtime: DeviceRuntime) {
  if (!('inventory' in runtime)) return
  const groups = getBufferGroups(runtime)
  if (groups.length === 0) return

  const nextInventory: Partial<Record<ItemId, number>> = {}
  for (const group of groups) {
    for (const slot of group.slots) {
      if (!slot.currentItemId || slot.amount <= 0) continue
      nextInventory[slot.currentItemId] = (nextInventory[slot.currentItemId] ?? 0) + slot.amount
    }
  }
  runtime.inventory = nextInventory
}

function canAddToStorage(runtime: DeviceRuntime, itemId: ItemId, amount: number, toPortId?: string) {
  if (!('inventory' in runtime)) return false
  if (amount <= 0) return true
  const groups = toPortId
    ? (() => {
        const mapped = getBufferGroupForInputPort(runtime, toPortId)
        return mapped ? [mapped] : []
      })()
    : getBufferGroups(runtime)
  if (groups.length === 0) return true

  const groupSnapshot = groups.map((group) => ({ ...group, slots: group.slots.map((slot) => ({ ...slot })) }))
  let remaining = amount
  while (remaining > 0) {
    const targetGroup = groupSnapshot.find((group) => findStorageAcceptSlot(group, itemId))
    if (!targetGroup) return false
    const targetSlot = findStorageAcceptSlot(targetGroup, itemId)
    if (!targetSlot) return false
    const writable = Math.min(remaining, targetSlot.capacity - targetSlot.amount)
    targetSlot.currentItemId = targetSlot.currentItemId ?? itemId
    targetSlot.amount += writable
    remaining -= writable
  }
  return true
}

function addToStorage(runtime: DeviceRuntime, itemId: ItemId, amount: number, toPortId?: string) {
  if (!('inventory' in runtime)) return false
  if (amount <= 0) return true

  const groups = toPortId
    ? (() => {
        const mapped = getBufferGroupForInputPort(runtime, toPortId)
        return mapped ? [mapped] : []
      })()
    : getBufferGroups(runtime)

  if (groups.length === 0) {
    runtime.inventory[itemId] = (runtime.inventory[itemId] ?? 0) + amount
    return true
  }

  let remaining = amount
  while (remaining > 0) {
    const targetGroup = groups.find((group) => findStorageAcceptSlot(group, itemId))
    if (!targetGroup) return false
    const targetSlot = findStorageAcceptSlot(targetGroup, itemId)
    if (!targetSlot) return false
    const writable = Math.min(remaining, targetSlot.capacity - targetSlot.amount)
    targetSlot.currentItemId = targetSlot.currentItemId ?? itemId
    targetSlot.amount += writable
    remaining -= writable
  }

  rebuildStorageInventoryFromGroups(runtime)
  return true
}

function addToStorageAtSlot(runtime: DeviceRuntime, slotIndex: number, itemId: ItemId, amount: number) {
  if (!('inventory' in runtime)) return false
  const group = getPrimaryBufferGroup(runtime)
  if (!group) return addToStorage(runtime, itemId, amount)
  const slot = group.slots.find((entry) => entry.slotIndex === slotIndex)
  if (!slot || amount <= 0) return false
  if (!canStorageSlotAcceptItem(slot, itemId)) return false
  const writable = Math.min(amount, slot.capacity - slot.amount)
  if (writable <= 0) return false
  slot.currentItemId = slot.currentItemId ?? itemId
  slot.amount += writable
  rebuildStorageInventoryFromGroups(runtime)
  return true
}

function consumeStorageFromSlot(runtime: DeviceRuntime, slotIndex: number | undefined, itemId: ItemId, amount: number) {
  if (!('inventory' in runtime)) return
  const group = getPrimaryBufferGroup(runtime)
  if (!group) {
    runtime.inventory[itemId] = Math.max(0, (runtime.inventory[itemId] ?? 0) - amount)
    return
  }

  const orderedSlots = [...group.slots].sort((left, right) => left.slotIndex - right.slotIndex)
  const target = typeof slotIndex === 'number'
    ? orderedSlots.find((slot) => slot.slotIndex === slotIndex)
    : orderedSlots.find((slot) => slot.currentItemId === itemId && slot.amount > 0)
  if (!target || !target.currentItemId) return

  target.amount = Math.max(0, target.amount - amount)
  if (target.amount <= 0) {
    target.amount = 0
    target.currentItemId = null
  }
  rebuildStorageInventoryFromGroups(runtime)
}

function orderedStorageSlotIndicesForOutput(runtime: DeviceRuntime, outPortId?: string) {
  const group = outPortId ? getBufferGroupForOutputPort(runtime, outPortId) : getPrimaryBufferGroup(runtime)
  if (!group) return []
  if (isReactorProcessorRuntime(runtime)) {
    syncReactorGroupSlotsFromRuntime(runtime, group)
  }
  return [...group.slots].sort((left, right) => left.slotIndex - right.slotIndex).map((slot) => slot.slotIndex)
}

function getStorageSlotItemId(runtime: DeviceRuntime, slotIndex: number, outPortId?: string): ItemId | null {
  const group = outPortId ? getBufferGroupForOutputPort(runtime, outPortId) : getPrimaryBufferGroup(runtime)
  if (!group) return null
  if (isReactorProcessorRuntime(runtime)) {
    syncReactorGroupSlotsFromRuntime(runtime, group)
  }
  const slot = group.slots.find((entry) => entry.slotIndex === slotIndex)
  if (!slot || slot.amount <= 0 || !slot.currentItemId) return null
  return slot.currentItemId
}

function canStorageSlotOutputToPort(device: DeviceInstance, runtime: DeviceRuntime, slotIndex: number, portId: string, itemId: ItemId) {
  const group = getBufferGroupForOutputPort(runtime, portId)
  if (!group) return false
  if (isReactorProcessorRuntime(runtime)) {
    syncReactorGroupSlotsFromRuntime(runtime, group)
  }
  const slot = group.slots.find((entry) => entry.slotIndex === slotIndex)
  if (!slot || slot.amount <= 0 || !slot.currentItemId) return false
  if (slot.currentItemId !== itemId) return false
  if (!(group.outPortIds.length === 0 || group.outPortIds.includes(portId))) return false

  if (isReactorProcessorRuntime(runtime) && device.typeId === 'item_port_mix_pool_1') {
    const configuredItemId = reactorPeekOutputForPort(runtime, device.config, portId)
    return configuredItemId === itemId
  }

  return true
}

function getSlotRef(runtime: DeviceRuntime, lane: 'slot' | 'ns' | 'we'): SlotData | null {
  if (lane === 'slot' && 'slot' in runtime) return runtime.slot
  if (lane === 'ns' && 'nsSlot' in runtime) return runtime.nsSlot
  if (lane === 'we' && 'weSlot' in runtime) return runtime.weSlot
  return null
}

function isBridgeConnectorType(typeId: DeviceInstance['typeId']) {
  return typeId === 'item_log_connector' || typeId === 'item_pipe_connector'
}

function isRoundRobinJunctionType(typeId: DeviceInstance['typeId']) {
  return (
    typeId === 'item_log_splitter' ||
    typeId === 'item_log_converger' ||
    typeId === 'item_pipe_splitter' ||
    typeId === 'item_pipe_converger'
  )
}

function isConvergerType(typeId: DeviceInstance['typeId']) {
  return typeId === 'item_log_converger' || typeId === 'item_pipe_converger'
}

function isSplitterType(typeId: DeviceInstance['typeId']) {
  return typeId === 'item_log_splitter' || typeId === 'item_pipe_splitter'
}

const CONVERGER_INPUT_PORT_ORDER = ['in_n', 'in_e', 'in_s'] as const

function indexInConvergerInputOrder(portId: string) {
  return CONVERGER_INPUT_PORT_ORDER.findIndex((entry) => entry === portId)
}

function isBufferedBeltRuntime(runtime: DeviceRuntime): runtime is BeltRuntime {
  return (
    'slot' in runtime &&
    'inputBuffer' in runtime &&
    'outputBuffer' in runtime &&
    'inputSlotItems' in runtime &&
    'outputSlotItems' in runtime &&
    'transportSamples' in runtime
  )
}

function isRecipeProcessorRuntime(runtime: DeviceRuntime): runtime is ProcessorRuntime {
  return 'inputBuffer' in runtime && 'outputBuffer' in runtime && !('transportSamples' in runtime)
}

function beltBufferedItemId(runtime: BeltRuntime, bufferKind: 'input' | 'output') {
  const slotItems = bufferKind === 'input' ? runtime.inputSlotItems : runtime.outputSlotItems
  const buffer = bufferKind === 'input' ? runtime.inputBuffer : runtime.outputBuffer
  for (const itemId of slotItems) {
    if (itemId && (buffer[itemId] ?? 0) > 0) return itemId
  }
  return null
}

function beltInputEdge(device: DeviceInstance) {
  return getRotatedPorts(device).find((port) => port.direction === 'Input')?.edge ?? 'W'
}

function canAcceptBeltInput(runtime: BeltRuntime) {
  const inputItemId = beltBufferedItemId(runtime, 'input')
  const outputItemId = beltBufferedItemId(runtime, 'output')
  const inTransit = Boolean(runtime.slot && runtime.slot.progress01 < 1)
  return !inputItemId && !outputItemId && !inTransit
}

function startBeltTransport(device: DeviceInstance, runtime: BeltRuntime, tick: number) {
  if (runtime.slot) return false
  if (beltBufferedItemId(runtime, 'output')) return false
  const itemId = beltBufferedItemId(runtime, 'input')
  if (!itemId) return false
  runtime.inputBuffer[itemId] = Math.max(0, (runtime.inputBuffer[itemId] ?? 0) - 1)
  clearSlotBindingIfEmpty(runtime.inputBuffer, runtime.inputSlotItems, itemId)
  runtime.slot = {
    itemId,
    progress01: 0,
    enteredFrom: beltInputEdge(device),
    enteredTick: tick,
  }
  runtime.cycleProgressTicks = 0
  runtime.progress01 = 0
  return true
}

function advanceBeltRuntimeOnTick(device: DeviceInstance, runtime: BeltRuntime, tickRateHz: number, tick: number) {
  if (!runtime.slot && !beltBufferedItemId(runtime, 'output')) {
    startBeltTransport(device, runtime, tick)
  }

  if (!runtime.slot) {
    runtime.cycleProgressTicks = 0
    runtime.progress01 = beltBufferedItemId(runtime, 'output') ? 1 : 0
    return
  }

  if (beltBufferedItemId(runtime, 'output')) {
    runtime.slot.progress01 = 1
    runtime.progress01 = 1
    return
  }

  const transportSpeed = transportSpeedPerTick(device.typeId, tickRateHz)
  runtime.slot.progress01 = Math.min(1, runtime.slot.progress01 + transportSpeed)
  runtime.cycleProgressTicks += 1
  runtime.progress01 = runtime.slot.progress01

  if (runtime.slot.progress01 >= 1) {
    tryAddProcessorBufferAmount(runtime, device.typeId, 'output', runtime.slot.itemId, 1)
    runtime.progress01 = 1
  }
}

function tryStartBeltTransportOnTick(device: DeviceInstance, runtime: BeltRuntime, tickRateHz: number, tick: number) {
  if (runtime.slot || beltBufferedItemId(runtime, 'output') || !beltBufferedItemId(runtime, 'input')) return
  advanceBeltRuntimeOnTick(device, runtime, tickRateHz, tick)
}

function allowsSolidInputType(allowedTypes: { mode: 'solid' | 'liquid' | 'whitelist'; whitelist: Array<'solid' | 'liquid'> }) {
  if (allowedTypes.mode === 'solid') return true
  if (allowedTypes.mode === 'liquid') return false
  return allowedTypes.whitelist.includes('solid')
}

function setSlotRef(runtime: DeviceRuntime, lane: 'slot' | 'ns' | 'we', value: SlotData | null) {
  if (lane === 'slot' && 'slot' in runtime) runtime.slot = value
  if (lane === 'ns' && 'nsSlot' in runtime) runtime.nsSlot = value
  if (lane === 'we' && 'weSlot' in runtime) runtime.weSlot = value
}

function canReceiveOnPort(device: DeviceInstance, runtime: DeviceRuntime, toPortId: string) {
  if (isBelt(device.typeId) && isBufferedBeltRuntime(runtime)) {
    return 'output'
  }
  if (isBridgeConnectorType(device.typeId)) {
    if (toPortId.endsWith('_n') || toPortId.endsWith('_s')) return 'ns'
    return 'we'
  }
  if ('slot' in runtime) return 'slot'
  return 'output'
}

type ReceiveLane = 'slot' | 'ns' | 'we' | 'output'

function canReceiveLaneForItem(
  device: DeviceInstance,
  runtime: DeviceRuntime,
  toPortId: string,
  lanesClearingThisTick: Set<string>,
  itemId: ItemId,
): ReceiveLane | null {
  const lane = canReceiveOnPort(device, runtime, toPortId)
  if (!lane) return null

  const reserveKey = `${device.instanceId}:${lane}`

  if (isBelt(device.typeId) && isBufferedBeltRuntime(runtime)) {
    const hasBufferedInput = Boolean(beltBufferedItemId(runtime, 'input'))
    const hasBufferedOutput = Boolean(beltBufferedItemId(runtime, 'output'))
    const hasInTransit = Boolean(runtime.slot && runtime.slot.progress01 < 1)
    if (!hasBufferedInput && !hasBufferedOutput && !hasInTransit) return lane

    return null
  }

  if (lane === 'output') {
    const canAccept = canAcceptIntoLane(device, runtime, lane, toPortId, itemId)
    return canAccept ? lane : null
  }
  const slot = getSlotRef(runtime, lane)
  if (!slot) return lane

  if (slot.progress01 >= 1 && lanesClearingThisTick.has(reserveKey)) {
    return lane
  }

  return null
}

function canAcceptIntoLane(device: DeviceInstance, runtime: DeviceRuntime, lane: ReceiveLane, toPortId: string, itemId: ItemId) {
  if (lane !== 'output') return true
  if (isBelt(device.typeId) && isBufferedBeltRuntime(runtime)) {
    return canAcceptBeltInput(runtime)
  }
  if ('inputBuffer' in runtime) {
    if (isReactorPoolType(device.typeId)) {
      return tryAddReactorInput(cloneRuntime(runtime), toPortId, itemId, 1)
    }
    return canAcceptProcessorInput(runtime, device.typeId, itemId, 1)
  }
  if ('inventory' in runtime) {
    return canAddToStorage(runtime, itemId, 1, toPortId)
  }
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
    if (isBelt(device.typeId) && isBufferedBeltRuntime(runtime)) {
      return tryAddProcessorInput(runtime, device.typeId, itemId, 1)
    }
    if ('inputBuffer' in runtime) {
      if (isReactorPoolType(device.typeId)) return tryAddReactorInput(runtime, toPortId, itemId, 1)
      return tryAddProcessorInput(runtime, device.typeId, itemId, 1)
    }
    return addToStorage(runtime, itemId, 1, toPortId)
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
  if (isBelt(device.typeId) && isBufferedBeltRuntime(runtime)) {
    return 'output'
  }
  if (isBridgeConnectorType(device.typeId)) {
    if (fromPortId.endsWith('_n') || fromPortId.endsWith('_s')) return 'ns'
    return 'we'
  }
  if ('slot' in runtime) return 'slot'
  return 'output'
}

function peekOutputItem(
  device: DeviceInstance,
  runtime: DeviceRuntime,
  warehouse: Record<ItemId, number>,
  fromPortId?: string,
): ItemId | null {
  if (device.typeId === PICKUP_TYPE_ID || device.typeId === PROTOCOL_HUB_TYPE_ID) {
    if (fromPortId) return configuredOutputItemForPort(device, warehouse, fromPortId)
    const probePorts = device.typeId === PICKUP_TYPE_ID ? [PICKUP_OUTPUT_PORT_ID] : PROTOCOL_HUB_OUTPUT_PORT_IDS
    for (const portId of probePorts) {
      const itemId = configuredOutputItemForPort(device, warehouse, portId)
      if (itemId) return itemId
    }
    return null
  }

  if ('outputBuffer' in runtime) {
    for (const itemId of ITEM_IDS) {
      if ((runtime.outputBuffer[itemId] ?? 0) > 0) return itemId
    }
    return null
  }

  if ('inventory' in runtime) {
    const slotIndices = orderedStorageSlotIndicesForOutput(runtime)
    if (slotIndices.length > 0) {
      for (const slotIndex of slotIndices) {
        const slotItemId = getStorageSlotItemId(runtime, slotIndex)
        if (slotItemId) return slotItemId
      }
      return null
    }

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
  fromPortId?: string,
) {
  if (lane === 'output') return peekOutputItem(device, runtime, warehouse, fromPortId)
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
  fromPortId?: string,
) {
  if (lane === 'output') return peekOutputItem(device, runtime, warehouse, fromPortId)
  const slot = getSlotRef(runtime, lane)
  if (!slot || slot.progress01 < 1) return null
  return slot.itemId
}

function prepareSourceLaneItem(
  device: DeviceInstance,
  runtime: DeviceRuntime,
  fromLane: 'slot' | 'ns' | 'we' | 'output',
  fromPortId: string,
  lanesReachedHalfThisTick: ReadonlySet<string>,
  lanesAdvancedThisTick: Set<string>,
  tickRateHz: number,
  warehouse: Record<ItemId, number>,
) {
  if (fromLane === 'output' && isReactorPoolType(device.typeId) && 'inputBuffer' in runtime && 'outputBuffer' in runtime) {
    const itemId = reactorPeekOutputForPort(runtime as ProcessorRuntime, device.config, fromPortId)
    return { itemId, laneProgressAdvanced: false }
  }

  const laneAdvanceKey = `${device.instanceId}:${fromLane}`
  if (lanesReachedHalfThisTick.has(laneAdvanceKey)) {
    return { itemId: null, laneProgressAdvanced: false }
  }

  let laneProgressAdvanced = false
  if (!lanesAdvancedThisTick.has(laneAdvanceKey)) {
    const transportSpeed = transportSpeedPerTick(device.typeId, tickRateHz)
    const beforeSlot = fromLane === 'output' ? null : getSlotRef(runtime, fromLane)
    const beforeProgress = beforeSlot?.progress01 ?? null
    readyItemForLane(device, runtime, fromLane, transportSpeed, warehouse, fromPortId)
    lanesAdvancedThisTick.add(laneAdvanceKey)
    const afterSlot = fromLane === 'output' ? null : getSlotRef(runtime, fromLane)
    const afterProgress = afterSlot?.progress01 ?? null
    laneProgressAdvanced = beforeProgress !== null && afterProgress !== null && afterProgress > beforeProgress
  }

  const itemId = peekReadyItemForLane(device, runtime, fromLane, warehouse, fromPortId)
  return { itemId, laneProgressAdvanced }
}

function consumeSourceByPlan(
  plan: TransferMatch,
  fromRuntime: DeviceRuntime,
  fromDevice: DeviceInstance,
  tick: number,
) {
  if (plan.fromLane === 'output') {
    if (isBelt(fromDevice.typeId) && isBufferedBeltRuntime(fromRuntime)) {
      fromRuntime.outputBuffer[plan.itemId] = Math.max(0, (fromRuntime.outputBuffer[plan.itemId] ?? 0) - 1)
      clearSlotBindingIfEmpty(fromRuntime.outputBuffer, fromRuntime.outputSlotItems, plan.itemId)
      if (fromRuntime.slot) {
        const transitTicks = Math.max(1, tick - fromRuntime.slot.enteredTick)
        fromRuntime.transportTotalTicks += transitTicks
        fromRuntime.transportSamples += 1
      }
      fromRuntime.slot = null
      fromRuntime.progress01 = 0
      fromRuntime.cycleProgressTicks = 0
      return
    }

    if (isReactorPoolType(fromDevice.typeId) && 'inputBuffer' in fromRuntime && 'outputBuffer' in fromRuntime) {
      reactorConsumeItemFromSharedSlotPool(fromRuntime as ProcessorRuntime, plan.itemId, 1)
    } else if ('outputBuffer' in fromRuntime) {
      fromRuntime.outputBuffer[plan.itemId] = Math.max(0, (fromRuntime.outputBuffer[plan.itemId] ?? 0) - 1)
      clearSlotBindingIfEmpty(fromRuntime.outputBuffer, fromRuntime.outputSlotItems, plan.itemId)
    } else if ('inventory' in fromRuntime) {
      consumeStorageFromSlot(fromRuntime, plan.fromOutputSlotIndex, plan.itemId, 1)
    }
    return
  }

  if (
    isBelt(fromDevice.typeId) &&
    plan.fromLane === 'slot' &&
    'slot' in fromRuntime &&
    fromRuntime.slot &&
    'transportTotalTicks' in fromRuntime &&
    'transportSamples' in fromRuntime
  ) {
    const transitTicks = Math.max(1, tick - fromRuntime.slot.enteredTick)
    fromRuntime.transportTotalTicks += transitTicks
    fromRuntime.transportSamples += 1
  }
  setSlotRef(fromRuntime, plan.fromLane, null)
}

function hasReadyOutput(device: DeviceInstance, runtime: DeviceRuntime, warehouse: Record<ItemId, number>) {
  if (device.typeId === PICKUP_TYPE_ID || device.typeId === PROTOCOL_HUB_TYPE_ID) {
    return Boolean(peekOutputItem(device, runtime, warehouse))
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
  let orderedLinks = outLinks

  if (isRoundRobinJunctionType(device.typeId) && outLinks.length > 1 && 'rrIndex' in runtime) {
    const offset = runtime.rrIndex % outLinks.length
    orderedLinks = [...outLinks.slice(offset), ...outLinks.slice(0, offset)]
  }

  const groups = getBufferGroups(runtime)
  if (groups.length > 0) {
    const groupIndexById = new Map(groups.map((group, index) => [group.id, index]))
    const priorityByPort = new Map<string, { groupIndex: number; portPriority: number }>()

    for (const group of groups) {
      const rotated = rotatedPortOrder(group.outPortIds, group.outCursor)
      for (let index = 0; index < rotated.length; index += 1) {
        priorityByPort.set(rotated[index], {
          groupIndex: groupIndexById.get(group.id) ?? Number.MAX_SAFE_INTEGER,
          portPriority: index,
        })
      }
    }

    orderedLinks = [...orderedLinks].sort((left, right) => {
      const leftPriority = priorityByPort.get(left.from.portId)
      const rightPriority = priorityByPort.get(right.from.portId)
      if (!leftPriority && !rightPriority) return 0
      if (!leftPriority) return 1
      if (!rightPriority) return -1
      if (leftPriority.groupIndex !== rightPriority.groupIndex) {
        return leftPriority.groupIndex - rightPriority.groupIndex
      }
      return leftPriority.portPriority - rightPriority.portPriority
    })
  }

  return orderedLinks
}

function peekReadyItemForSourceLink(
  fromDevice: DeviceInstance,
  fromRuntime: DeviceRuntime,
  fromPortId: string,
  warehouse: Record<ItemId, number>,
) {
  const fromLane = sourceSlotLane(fromDevice, fromRuntime, fromPortId)
  if (fromLane === 'output' && isReactorPoolType(fromDevice.typeId) && 'inputBuffer' in fromRuntime && 'outputBuffer' in fromRuntime) {
    return reactorPeekOutputForPort(fromRuntime as ProcessorRuntime, fromDevice.config, fromPortId)
  }
  return peekReadyItemForLane(fromDevice, fromRuntime, fromLane, warehouse, fromPortId)
}

function buildConvergerPullInputPortOrderMap(
  layout: LayoutState,
  runtimeById: Record<string, DeviceRuntime>,
  links: ReturnType<typeof neighborsFromLinks>,
  deviceById: Map<string, DeviceInstance>,
  warehouse: Record<ItemId, number>,
) {
  const preferredPortOrderByConvergerId = new Map<string, string[]>()

  for (const device of layout.devices) {
    if (!isConvergerType(device.typeId)) continue
    const runtime = runtimeById[device.instanceId]
    if (!runtime || !('rrIndex' in runtime)) continue

    const inLinks = links.inMap.get(device.instanceId) ?? []
    const splitterSourcePorts = new Set<string>()
    const nonSplitterSourcePorts = new Set<string>()

    for (const inLink of inLinks) {
      const sourceRuntime = runtimeById[inLink.from.instanceId]
      const sourceDevice = deviceById.get(inLink.from.instanceId)
      if (!sourceRuntime || !sourceDevice) continue
      if (isHardBlockedStall(sourceRuntime.stallReason)) continue
      const readyItem = peekReadyItemForSourceLink(sourceDevice, sourceRuntime, inLink.from.portId, warehouse)
      if (!readyItem) continue
      if (isSplitterType(sourceDevice.typeId)) {
        splitterSourcePorts.add(inLink.to.portId)
      } else {
        nonSplitterSourcePorts.add(inLink.to.portId)
      }
    }

    const preferredSourcePorts = splitterSourcePorts.size > 0 ? splitterSourcePorts : nonSplitterSourcePorts
    if (preferredSourcePorts.size === 0) continue

    const baseOffset = runtime.rrIndex % CONVERGER_INPUT_PORT_ORDER.length
    for (let step = 0; step < CONVERGER_INPUT_PORT_ORDER.length; step += 1) {
      const probeIndex = (baseOffset + step) % CONVERGER_INPUT_PORT_ORDER.length
      const probePort = CONVERGER_INPUT_PORT_ORDER[probeIndex]
      if (!preferredSourcePorts.has(probePort)) continue
      const orderedPorts: string[] = []
      for (let innerStep = 0; innerStep < CONVERGER_INPUT_PORT_ORDER.length; innerStep += 1) {
        const innerIndex = (probeIndex + innerStep) % CONVERGER_INPUT_PORT_ORDER.length
        const candidatePort = CONVERGER_INPUT_PORT_ORDER[innerIndex]
        if (!preferredSourcePorts.has(candidatePort)) continue
        orderedPorts.push(candidatePort)
      }
      preferredPortOrderByConvergerId.set(device.instanceId, orderedPorts)
      break
    }
  }

  return preferredPortOrderByConvergerId
}

function buildDevicePullInputPortOrderMap(
  layout: LayoutState,
  runtimeById: Record<string, DeviceRuntime>,
  links: ReturnType<typeof neighborsFromLinks>,
  deviceById: Map<string, DeviceInstance>,
  warehouse: Record<ItemId, number>,
) {
  const orderedPortsByDeviceId = new Map<string, string[]>()

  for (const device of layout.devices) {
    const runtime = runtimeById[device.instanceId]
    if (!runtime || (!('inputBuffer' in runtime) && !('inventory' in runtime))) continue

    const inLinks = links.inMap.get(device.instanceId) ?? []
    const groups = getBufferGroups(runtime)
    if (groups.length === 0) continue

    const orderedPorts: string[] = []

    for (const group of groups) {
      const inputPortOrder = group.inPortIds
      const availablePorts = new Set<string>()

      for (const inLink of inLinks) {
        if (!inputPortOrder.includes(inLink.to.portId)) continue
        const sourceRuntime = runtimeById[inLink.from.instanceId]
        const sourceDevice = deviceById.get(inLink.from.instanceId)
        if (!sourceRuntime || !sourceDevice) continue
        if (isHardBlockedStall(sourceRuntime.stallReason)) continue
        const readyItem = peekReadyItemForSourceLink(sourceDevice, sourceRuntime, inLink.from.portId, warehouse)
        if (!readyItem) continue
        if (ITEM_BY_ID[readyItem]?.type !== 'solid') continue
        if (!canAcceptIntoLane(device, runtime, 'output', inLink.to.portId, readyItem)) continue
        availablePorts.add(inLink.to.portId)
      }

      if (availablePorts.size === 0) continue

      const baseOffset = (((group.inCursor % inputPortOrder.length) + inputPortOrder.length) % inputPortOrder.length)
      for (let step = 0; step < inputPortOrder.length; step += 1) {
        const probeIndex = (baseOffset + step) % inputPortOrder.length
        const probePort = inputPortOrder[probeIndex]
        if (!availablePorts.has(probePort)) continue
        orderedPorts.push(probePort)
      }
    }

    if (orderedPorts.length > 0) {
      orderedPortsByDeviceId.set(device.instanceId, orderedPorts)
    }
  }

  return orderedPortsByDeviceId
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
  if (device.typeId === PICKUP_TYPE_ID) {
    return Boolean(configuredOutputEntry(device, PICKUP_OUTPUT_PORT_ID)?.itemId)
  }
  if (device.typeId === PROTOCOL_HUB_TYPE_ID) {
    return PROTOCOL_HUB_OUTPUT_PORT_IDS.some((portId) => Boolean(configuredOutputEntry(device, portId)?.itemId))
  }
  return true
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
    if ('transportSamples' in runtime) {
      return {
        ...runtime,
        inputBuffer: { ...runtime.inputBuffer },
        outputBuffer: { ...runtime.outputBuffer },
        inputSlotItems: [...runtime.inputSlotItems],
        outputSlotItems: [...runtime.outputSlotItems],
        slot: cloneSlot(runtime.slot),
      }
    }

    return {
      ...runtime,
      inputBuffer: { ...runtime.inputBuffer },
      outputBuffer: { ...runtime.outputBuffer },
      inputSlotItems: [...runtime.inputSlotItems],
      outputSlotItems: [...runtime.outputSlotItems],
      bufferGroups: runtime.bufferGroups
        ? runtime.bufferGroups.map((group) => ({
            ...group,
            inPortIds: [...group.inPortIds],
            outPortIds: [...group.outPortIds],
            slots: group.slots.map((slot) => ({ ...slot })),
          }))
        : undefined,
      reactorCycleProgressTicks: runtime.reactorCycleProgressTicks ? [...runtime.reactorCycleProgressTicks] as [number, number] : undefined,
      reactorActiveRecipeIds: runtime.reactorActiveRecipeIds ? [...runtime.reactorActiveRecipeIds] as [string | undefined, string | undefined] : undefined,
    }
  }

  if ('inventory' in runtime) {
    return {
      ...runtime,
      inventory: { ...runtime.inventory },
      bufferGroups: runtime.bufferGroups
        ? runtime.bufferGroups.map((group) => ({
            ...group,
            inPortIds: [...group.inPortIds],
            outPortIds: [...group.outPortIds],
            slots: group.slots.map((slot) => ({ ...slot })),
          }))
        : undefined,
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
    powerMode: 'infinite',
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
    powerStats: {
      totalSupplyKw: 0,
      totalDemandKw: 0,
      batteryPercent: 100,
      batteryStoredJ: GLOBAL_BATTERY_CAPACITY_J,
    },
  }
}

export function startSimulation(layout: LayoutState, sim: SimState, powerMode: PowerMode, initialBatteryPercent: number = 100): SimState {
  const tickRateHz = BASE_TICK_RATE
  const speed = sim.speed === 0 ? 1 : sim.speed
  const minuteWindowCapacity = cycleTicksFromSeconds(60, tickRateHz)
  const normalizedInitialBatteryPercent = Math.min(100, Math.max(0, Number.isFinite(initialBatteryPercent) ? initialBatteryPercent : 100))
  const initialBatteryStoredJ =
    powerMode === 'real'
      ? Math.round((GLOBAL_BATTERY_CAPACITY_J * normalizedInitialBatteryPercent) / 100)
      : GLOBAL_BATTERY_CAPACITY_J
  const runtimeById = resetRuntimeByLayout(layout)
  const overlaps = detectOverlaps(layout)
  const poles = layout.devices.filter((device) => device.typeId === 'item_port_power_diffuser_1')
  const { disconnectedBusSegmentIds, busEdgePortBlockedByDisconnectedBusIds } = analyzeWarehouseBusConnectivity(layout)

  for (const device of layout.devices) {
    const runtime = runtimeById[device.instanceId]
    const deviceDef = DEVICE_TYPE_BY_ID[device.typeId]
    if ('inputBuffer' in runtime) {
      if (isReactorPoolType(device.typeId) && getBufferGroups(runtime).length > 0) {
        applyStorageSlotConfigToRuntime(runtime, device.config.storageSlots)
      }

      const inputSpec = processorBufferSpec(device.typeId, 'input')
      for (const preload of preloadEntriesForDevice(device)) {
        const preloadAmount = Math.max(0, Math.floor(preload.amount ?? 0))
        if (!preload.itemId || preloadAmount <= 0) continue
        const slotCapacity = inputSpec.slotCapacities[preload.slotIndex] ?? DEFAULT_PROCESSOR_BUFFER_CAPACITY
        tryAddProcessorInputAtSlot(runtime, device.typeId, preload.slotIndex, preload.itemId, Math.min(preloadAmount, slotCapacity))
      }
    }
    if ('inventory' in runtime && isStorageWithBufferGroups(runtime)) {
      applyStorageSlotConfigToRuntime(runtime, device.config.storageSlots)

      const configuredStorageSlots = Array.isArray(device.config.storageSlots) ? device.config.storageSlots : []
      const hasStorageSlotConfig = configuredStorageSlots.length > 0
      const storagePreloads = hasStorageSlotConfig
        ? []
        : Array.isArray(device.config.storagePreloadInputs) && device.config.storagePreloadInputs.length > 0
          ? [...device.config.storagePreloadInputs]
          : Array.isArray(device.config.preloadInputs)
            ? [...device.config.preloadInputs]
            : []

      if (hasStorageSlotConfig) {
        for (const slot of configuredStorageSlots) {
          const preloadItemId = slot.preloadItemId
          const preloadAmount = Math.max(0, Math.floor(slot.preloadAmount ?? 0))
          if (!preloadItemId || preloadAmount <= 0) continue
          const targetSlotIndex = Math.max(0, Math.floor(slot.slotIndex ?? 0))
          addToStorageAtSlot(runtime, targetSlotIndex, preloadItemId, preloadAmount)
        }
      }

      const sortedPreloads = storagePreloads.sort((left, right) => left.slotIndex - right.slotIndex)
      for (const preload of sortedPreloads) {
        const amount = Math.max(0, Math.floor(preload.amount ?? 0))
        if (!preload.itemId || amount <= 0) continue
        addToStorageAtSlot(runtime, Math.max(0, Math.floor(preload.slotIndex ?? 0)), preload.itemId, amount)
      }
      rebuildStorageInventoryFromGroups(runtime)
    }
    let stall: StallReason = 'NONE'
    if (overlaps.has(device.instanceId)) stall = 'OVERLAP'
    else if (disconnectedBusSegmentIds.has(device.instanceId)) stall = 'BUS_NOT_CONNECTED'
    else if (busEdgePortBlockedByDisconnectedBusIds.has(device.instanceId)) stall = 'PICKUP_BUS_NOT_CONNECTED'
    else if (!pickupHasConfig(device)) stall = 'CONFIG_ERROR'
    else if (powerMode === 'real' && deviceDef.requiresPower && !inPowerRange(device, poles)) stall = 'OUT_OF_POWER_RANGE'
    normalizeRuntimeState(runtime, stall)
  }

  return {
    ...sim,
    isRunning: true,
    powerMode,
    speed,
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
    powerStats: {
      totalSupplyKw: powerMode === 'infinite' ? Number.POSITIVE_INFINITY : 0,
      totalDemandKw: totalPowerDemandKw(layout),
      batteryPercent: powerMode === 'real' ? normalizedInitialBatteryPercent : 100,
      batteryStoredJ: initialBatteryStoredJ,
    },
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
    powerStats: {
      totalSupplyKw: 0,
      totalDemandKw: 0,
      batteryPercent: 100,
      batteryStoredJ: GLOBAL_BATTERY_CAPACITY_J,
    },
  }
}

function recipeById(recipeId: string | undefined) {
  if (!recipeId) return undefined
  return RECIPES.find((recipe) => recipe.id === recipeId)
    ?? THERMAL_POOL_VIRTUAL_RECIPES.find((recipe) => recipe.id === recipeId)
}

function recipesForDevice(deviceTypeId: DeviceInstance['typeId']) {
  if (deviceTypeId === THERMAL_POOL_TYPE_ID) return THERMAL_POOL_VIRTUAL_RECIPES
  return RECIPES.filter((recipe) => recipe.machineType === deviceTypeId)
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

function pickRunnableRecipeForDevice(device: DeviceInstance, runtime: DeviceRuntime) {
  const recipes = recipesForDevice(device.typeId)
  const filteredRecipes = isReactorPoolType(device.typeId)
    ? (() => {
        const selectedIds = reactorSelectedRecipeIds(device.config)
        if (selectedIds.length === 0) return []
        const selectedSet = new Set(selectedIds)
        return recipes.filter((recipe) => selectedSet.has(recipe.id))
      })()
    : recipes

  for (const recipe of filteredRecipes) {
    if (consumeRecipeInputs(runtime, recipe)) return recipe
  }
  return null
}

function tryStartProcessorCycleOnTick(
  device: DeviceInstance,
  runtime: DeviceRuntime,
  tickRateHz: number,
  processorDelta: Partial<Record<ItemId, number>>,
) {
  if (!('outputBuffer' in runtime && 'inputBuffer' in runtime)) return
  if (isReactorPoolType(device.typeId)) return
  if (runtime.cycleProgressTicks > 0) return

  const selectedRecipe = pickRunnableRecipeForDevice(device, runtime)
  if (!selectedRecipe) return

  runtime.activeRecipeId = selectedRecipe.id
  runtime.cycleProgressTicks = 1
  for (const input of selectedRecipe.inputs) {
    mark(processorDelta, input.itemId, -input.amount)
  }
  const recipeCycleTicks = cycleTicksFromSeconds(selectedRecipe.cycleSeconds, tickRateHz)
  runtime.progress01 = runtime.cycleProgressTicks / recipeCycleTicks
  normalizeRuntimeState(runtime, 'NONE')
}

function tryStartReactorLanesOnTick(
  device: DeviceInstance,
  runtime: DeviceRuntime,
  tickRateHz: number,
  processorDelta: Partial<Record<ItemId, number>>,
) {
  if (!('outputBuffer' in runtime && 'inputBuffer' in runtime)) return
  if (!isReactorPoolType(device.typeId)) return

  const selectedRecipes = reactorSelectedRecipeIds(device.config)
    .map((recipeId) => recipeById(recipeId))
    .filter((recipe): recipe is NonNullable<typeof recipe> => Boolean(recipe))
    .slice(0, 2)

  const laneProgress: [number, number] = runtime.reactorCycleProgressTicks
    ? [...runtime.reactorCycleProgressTicks] as [number, number]
    : [0, 0]
  const laneRecipeIds: [string | undefined, string | undefined] = runtime.reactorActiveRecipeIds
    ? [...runtime.reactorActiveRecipeIds] as [string | undefined, string | undefined]
    : [undefined, undefined]

  let startedAnyLane = false
  let maxProgress01 = runtime.progress01

  for (let laneIndex = 0 as 0 | 1; laneIndex <= 1; laneIndex = (laneIndex + 1) as 0 | 1) {
    const laneRecipe = selectedRecipes[laneIndex]
    if (!laneRecipe) continue

    if (laneRecipeIds[laneIndex] !== laneRecipe.id && laneProgress[laneIndex] <= 0) {
      laneRecipeIds[laneIndex] = laneRecipe.id
    }

    if (laneProgress[laneIndex] > 0) {
      const cycleTicks = cycleTicksFromSeconds(laneRecipe.cycleSeconds, tickRateHz)
      maxProgress01 = Math.max(maxProgress01, Math.min(1, laneProgress[laneIndex] / cycleTicks))
      continue
    }

    const consumed = consumeRecipeInputs(runtime, laneRecipe)
    if (!consumed) continue

    laneProgress[laneIndex] = 1
    startedAnyLane = true
    for (const input of laneRecipe.inputs) {
      mark(processorDelta, input.itemId, -input.amount)
    }
    const cycleTicks = cycleTicksFromSeconds(laneRecipe.cycleSeconds, tickRateHz)
    maxProgress01 = Math.max(maxProgress01, Math.min(1, laneProgress[laneIndex] / cycleTicks))
  }

  runtime.reactorCycleProgressTicks = laneProgress
  runtime.reactorActiveRecipeIds = laneRecipeIds
  runtime.activeRecipeId = laneRecipeIds[0]
  runtime.cycleProgressTicks = laneProgress[0]
  runtime.progress01 = maxProgress01

  if (startedAnyLane) {
    normalizeRuntimeState(runtime, 'NONE')
  }
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

function applyMinuteWindowDelta(
  producedPerMinute: Record<ItemId, number>,
  consumedPerMinute: Record<ItemId, number>,
  deltaRecord: Partial<Record<ItemId, number>>,
  direction: 1 | -1,
) {
  for (const [itemIdRaw, deltaRaw] of Object.entries(deltaRecord)) {
    const itemId = itemIdRaw as ItemId
    const delta = Number(deltaRaw ?? 0)
    if (!Number.isFinite(delta) || delta === 0) continue

    if (delta > 0) {
      producedPerMinute[itemId] = Math.max(0, (producedPerMinute[itemId] ?? 0) + direction * delta)
    } else {
      const consumedDelta = Math.abs(delta)
      consumedPerMinute[itemId] = Math.max(0, (consumedPerMinute[itemId] ?? 0) + direction * consumedDelta)
    }
  }
}

function recomputePerMinuteTotalsFromWindow(
  minuteWindowDeltas: Array<Partial<Record<ItemId, number>>>,
  minuteWindowCount: number,
  minuteWindowCapacity: number,
) {
  const producedPerMinute = emptyPerMinuteRecord()
  const consumedPerMinute = emptyPerMinuteRecord()
  const slotsToScan = Math.min(Math.max(0, minuteWindowCount), minuteWindowCapacity)
  for (let index = 0; index < slotsToScan; index += 1) {
    const deltaRecord = minuteWindowDeltas[index] ?? {}
    applyMinuteWindowDelta(producedPerMinute, consumedPerMinute, deltaRecord, 1)
  }
  return { producedPerMinute, consumedPerMinute }
}

export function tickSimulation(layout: LayoutState, sim: SimState): SimState {
  if (!sim.isRunning) return sim

  const pickupBlockTicks = cycleTicksFromSeconds(PICKUP_BLOCK_WINDOW_SECONDS, sim.tickRateHz)
  const storageSubmitTicks = cycleTicksFromSeconds(STORAGE_SUBMIT_INTERVAL_SECONDS, sim.tickRateHz)
  const perMinuteWindowTicks = cycleTicksFromSeconds(60, sim.tickRateHz)

  const runtimeById: Record<string, DeviceRuntime> = {}
  for (const [instanceId, runtime] of Object.entries(sim.runtimeById)) {
    runtimeById[instanceId] = cloneRuntime(runtime)
  }
  const links = getNeighbors(layout)
  const deviceById = getDeviceByIdMap(layout)
  const lanesReachedHalfThisTick = new Set<string>()
  const completedCycleDeviceIdsThisTick = new Set<string>()

  const warehouse = { ...sim.warehouse }
  const processorDelta: Partial<Record<ItemId, number>> = {}
  const totalDemandKw = totalPowerDemandKw(layout)
  let totalSupplyKw = sim.powerMode === 'infinite' ? Number.POSITIVE_INFINITY : 0
  let batteryStoredJ = sim.powerMode === 'real'
    ? Math.min(Math.max(0, sim.powerStats.batteryStoredJ ?? GLOBAL_BATTERY_CAPACITY_J), GLOBAL_BATTERY_CAPACITY_J)
    : GLOBAL_BATTERY_CAPACITY_J
  let unpoweredById = new Set<string>()
  let outOfRangeById = new Set<string>()

  if (sim.powerMode === 'real') {
    const poles = layout.devices.filter((device) => device.typeId === 'item_port_power_diffuser_1')
    const powerAvailability = buildPowerAvailabilityByDeviceId(
      layout,
      runtimeById,
      poles,
      sim.tickRateHz,
      processorDelta,
      batteryStoredJ,
    )
    totalSupplyKw = powerAvailability.totalSupplyKw
    batteryStoredJ = powerAvailability.nextBatteryStoredJ
    unpoweredById = powerAvailability.unpoweredById
    outOfRangeById = powerAvailability.outOfRangeById
  }

  const batteryPercent = Math.round((Math.max(0, batteryStoredJ) / GLOBAL_BATTERY_CAPACITY_J) * 100)

  for (const device of layout.devices) {
    const runtime = runtimeById[device.instanceId]
    if (!runtime) continue

    if (outOfRangeById.has(device.instanceId)) {
      normalizeRuntimeState(runtime, 'OUT_OF_POWER_RANGE')
      continue
    }

    if (unpoweredById.has(device.instanceId)) {
      normalizeRuntimeState(runtime, 'LOW_POWER')
      continue
    }

    if (isHardBlockedStall(runtime.stallReason)) {
      continue
    }

    normalizeRuntimeState(runtime, 'NONE')

    if (isBelt(device.typeId) && isBufferedBeltRuntime(runtime)) {
      advanceBeltRuntimeOnTick(device, runtime, sim.tickRateHz, sim.tick)
      continue
    }

    if (isRecipeProcessorRuntime(runtime)) {
      if (isReactorPoolType(device.typeId)) {
        const selectedRecipes = reactorSelectedRecipeIds(device.config)
          .map((recipeId) => recipeById(recipeId))
          .filter((recipe): recipe is NonNullable<typeof recipe> => Boolean(recipe))
          .slice(0, 2)

        const laneProgress: [number, number] = runtime.reactorCycleProgressTicks
          ? [...runtime.reactorCycleProgressTicks] as [number, number]
          : [0, 0]
        const laneRecipeIds: [string | undefined, string | undefined] = runtime.reactorActiveRecipeIds
          ? [...runtime.reactorActiveRecipeIds] as [string | undefined, string | undefined]
          : [undefined, undefined]

        let hasRunnableOrRunningLane = false
        let hasOutputBlockedLane = false
        let maxProgress01 = 0

        for (let laneIndex = 0 as 0 | 1; laneIndex <= 1; laneIndex = (laneIndex + 1) as 0 | 1) {
          const laneRecipe = selectedRecipes[laneIndex]
          if (!laneRecipe) {
            laneProgress[laneIndex] = 0
            laneRecipeIds[laneIndex] = undefined
            continue
          }

          if (laneRecipeIds[laneIndex] !== laneRecipe.id) {
            laneRecipeIds[laneIndex] = laneRecipe.id
            laneProgress[laneIndex] = 0
          }

          const recipeCycleTicks = cycleTicksFromSeconds(laneRecipe.cycleSeconds, sim.tickRateHz)

          if (laneProgress[laneIndex] <= 0) {
            const consumed = consumeRecipeInputs(runtime, laneRecipe)
            if (!consumed) {
              continue
            }
            laneProgress[laneIndex] = 1
            for (const input of laneRecipe.inputs) {
              mark(processorDelta, input.itemId, -input.amount)
            }
          } else if (laneProgress[laneIndex] < recipeCycleTicks) {
            laneProgress[laneIndex] += 1
          }

          if (laneProgress[laneIndex] > 0) {
            hasRunnableOrRunningLane = true
            maxProgress01 = Math.max(maxProgress01, Math.min(1, laneProgress[laneIndex] / recipeCycleTicks))
          }

          if (laneProgress[laneIndex] >= recipeCycleTicks) {
            const outputBlocked = !reactorCanAcceptRecipeOutputsInSharedSlotPool(
              runtime as ProcessorRuntime,
              laneRecipe,
              processorBufferSpec(device.typeId, 'input').slotCapacities,
            )

            if (outputBlocked) {
              laneProgress[laneIndex] = recipeCycleTicks
              hasOutputBlockedLane = true
              continue
            }

            const producedThisCycle = reactorCommitRecipeOutputsToSharedSlotPool(
              runtime as ProcessorRuntime,
              laneRecipe,
              processorBufferSpec(device.typeId, 'input').slotCapacities,
            )
            runtime.producedItemsTotal += producedThisCycle
            runtime.lastCompletedCycleTicks = laneProgress[laneIndex]
            const completionTick = sim.tick + 1
            runtime.lastCompletionIntervalTicks =
              runtime.lastCompletionTick === null ? 0 : Math.max(1, completionTick - runtime.lastCompletionTick)
            runtime.lastCompletionTick = completionTick
            for (const output of laneRecipe.outputs) {
              mark(processorDelta, output.itemId, output.amount)
            }
            laneProgress[laneIndex] = 0
            completedCycleDeviceIdsThisTick.add(device.instanceId)
          }
        }

        runtime.reactorCycleProgressTicks = laneProgress
        runtime.reactorActiveRecipeIds = laneRecipeIds
        runtime.activeRecipeId = laneRecipeIds[0]
        runtime.cycleProgressTicks = laneProgress[0]
        runtime.progress01 = maxProgress01

        if (hasOutputBlockedLane) {
          normalizeRuntimeState(runtime, 'OUTPUT_BUFFER_FULL')
        } else if (!hasRunnableOrRunningLane) {
          normalizeRuntimeState(runtime, 'NO_INPUT')
        }
      } else {
        const activeRecipe = recipeById(runtime.activeRecipeId)

        if (runtime.cycleProgressTicks <= 0) {
          const selectedRecipe = pickRunnableRecipeForDevice(device, runtime)
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
            const outputBlocked = !canAcceptProcessorOutputBatch(runtime, device.typeId, activeRecipe.outputs)

            if (outputBlocked) {
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
              completedCycleDeviceIdsThisTick.add(device.instanceId)
            }
          }
        } else {
          runtime.cycleProgressTicks = 0
          runtime.progress01 = 0
        }
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

    if (device.typeId === 'item_port_water_pump_1' && 'inventory' in runtime) {
      const selectedItemId = waterPumpOutputItemId(device)
      for (const itemId of WATER_PUMP_SELECTABLE_ITEM_IDS) {
        runtime.inventory[itemId] = itemId === selectedItemId ? Number.POSITIVE_INFINITY : 0
      }
    }

    if ('slot' in runtime && runtime.slot) {
      const transportSpeed = transportSpeedPerTick(device.typeId, sim.tickRateHz)
      const slot = runtime.slot
      if (slot.progress01 < 0.5) {
        const beforeProgress = slot.progress01
        slot.progress01 = Math.min(0.5, slot.progress01 + transportSpeed)
        runtime.progress01 = slot.progress01
        if (beforeProgress < 0.5 && slot.progress01 >= 0.5) {
          lanesReachedHalfThisTick.add(`${device.instanceId}:slot`)
        }
      }
    }

    if ('nsSlot' in runtime && runtime.nsSlot && runtime.nsSlot.progress01 < 0.5) {
      const transportSpeed = transportSpeedPerTick(device.typeId, sim.tickRateHz)
      const beforeProgress = runtime.nsSlot.progress01
      runtime.nsSlot.progress01 = Math.min(0.5, runtime.nsSlot.progress01 + transportSpeed)
      runtime.progress01 = runtime.nsSlot.progress01
      if (beforeProgress < 0.5 && runtime.nsSlot.progress01 >= 0.5) {
        lanesReachedHalfThisTick.add(`${device.instanceId}:ns`)
      }
    }
    if ('weSlot' in runtime && runtime.weSlot && runtime.weSlot.progress01 < 0.5) {
      const transportSpeed = transportSpeedPerTick(device.typeId, sim.tickRateHz)
      const beforeProgress = runtime.weSlot.progress01
      runtime.weSlot.progress01 = Math.min(0.5, runtime.weSlot.progress01 + transportSpeed)
      runtime.progress01 = runtime.weSlot.progress01
      if (beforeProgress < 0.5 && runtime.weSlot.progress01 >= 0.5) {
        lanesReachedHalfThisTick.add(`${device.instanceId}:we`)
      }
    }
  }

  const committedSenders = new Set<string>()
  const lanesAdvancedThisTick = new Set<string>()
  const maxTransferRounds = Math.max(8, layout.devices.length)

  for (let transferRound = 0; transferRound < maxTransferRounds; transferRound += 1) {
    const planResult = solvePullTransferMatches({
      tick: sim.tick,
      layoutDevices: layout.devices,
      runtimeById,
      deviceById,
      inMap: links.inMap as Map<string, FlowPortLink[]>,
      outMap: links.outMap as Map<string, FlowPortLink[]>,
      lanesReachedHalfThisTick,
      helpers: {
        isHardBlockedStall,
        orderedOutLinks: (device, runtime, outLinks) => orderedOutLinks(device, runtime, outLinks as ReturnType<typeof neighborsFromLinks>['links']) as FlowPortLink[],
        buildConvergerPullInputPortOrderMap: () => buildConvergerPullInputPortOrderMap(layout, runtimeById, links, deviceById, warehouse),
        buildDevicePullInputPortOrderMap: () => buildDevicePullInputPortOrderMap(layout, runtimeById, links, deviceById, warehouse),
        isConvergerType,
        sourceSlotLane,
        prepareSourceLaneItem: (device, runtime, fromLane, fromPortId, reachedHalf, lanesAdvanced) =>
          prepareSourceLaneItem(device, runtime, fromLane, fromPortId, reachedHalf, lanesAdvanced, sim.tickRateHz, warehouse),
        canReceiveLaneForItem,
        isStorageWithBufferGroups,
        orderedStorageSlotIndicesForOutput,
        getStorageSlotItemId,
        canStorageSlotOutputToPort,
      },
    })

    for (const laneKey of planResult.lanesAdvancedThisTick) {
      lanesAdvancedThisTick.add(laneKey)
    }

    if (planResult.transferMatches.length === 0) break

    const commitResult = commitTransferMatches({
      tick: sim.tick,
      runtimeById,
      deviceById,
      outMap: links.outMap as Map<string, FlowPortLink[]>,
      warehouse,
      transferMatches: planResult.transferMatches,
      helpers: {
        tryReceiveToLane,
        isWarehouseSubmitPort,
        consumeSourceByPlan,
        shouldIgnoreConfiguredOutputInventory,
        isRoundRobinJunctionType,
        isSplitterType,
        isConvergerType,
        indexInConvergerInputOrder,
        advanceBufferGroupInputCursor,
        advanceBufferGroupOutputCursor,
      },
    })

    for (const senderId of commitResult.committedSenders) {
      committedSenders.add(senderId)
    }

    if (commitResult.committedCount === 0) break
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

      if (committedSenders.has(device.instanceId)) {
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
      !committedSenders.has(device.instanceId) &&
      hasInternalBuffer(runtime) &&
      hasReadyOutput(device, runtime, warehouse)
    ) {
      normalizeRuntimeState(runtime, 'DOWNSTREAM_BLOCKED')
      continue
    }

    if (
      outLinks.length > 0 &&
      !committedSenders.has(device.instanceId) &&
      !hasInternalBuffer(runtime) &&
      shouldMarkDownstreamBlockedNoBuffer(device, runtime, lanesAdvancedThisTick)
    ) {
      normalizeRuntimeState(runtime, 'DOWNSTREAM_BLOCKED')
    }
  }

  // NOTE: This end-of-tick start pass is intentional.
  // Reason:
  // - During the transfer phase above, downstream devices can receive new inputs within the same tick.
  // - Without this pass, those devices must wait one extra tick before starting a cycle, which lowers throughput
  //   and introduces avoidable 1-tick latency in stable lines.
  // Guardrail:
  // - Devices that already completed a cycle in this tick are excluded via
  //   `completedCycleDeviceIdsThisTick` to prevent same-tick restart cycle compression
  //   (e.g. a 40-tick recipe being effectively shortened and over-reporting /min).
  // Please do not remove this pass unless the tick lifecycle is redesigned and equivalent semantics are preserved.
  for (const device of layout.devices) {
    const runtime = runtimeById[device.instanceId]
    if (!runtime || isHardBlockedStall(runtime.stallReason)) continue
    if (completedCycleDeviceIdsThisTick.has(device.instanceId)) continue
    if (isBelt(device.typeId) && isBufferedBeltRuntime(runtime)) {
      tryStartBeltTransportOnTick(device, runtime, sim.tickRateHz, sim.tick)
      continue
    }
    tryStartReactorLanesOnTick(device, runtime, sim.tickRateHz, processorDelta)
    tryStartProcessorCycleOnTick(device, runtime, sim.tickRateHz, processorDelta)
  }

  const nextTick = sim.tick + 1
  const simSeconds = nextTick / sim.tickRateHz
  const minuteWindow = ensureMinuteWindow(sim, perMinuteWindowTicks)
  const minuteWindowDeltas = minuteWindow.buffer
  const writeIndex = minuteWindow.cursor

  const nextDelta = { ...processorDelta }
  minuteWindowDeltas[writeIndex] = nextDelta

  const nextMinuteWindowCursor = (writeIndex + 1) % perMinuteWindowTicks
  const nextMinuteWindowCount = Math.min(minuteWindow.count + 1, perMinuteWindowTicks)
  const { producedPerMinute, consumedPerMinute } = recomputePerMinuteTotalsFromWindow(
    minuteWindowDeltas,
    nextMinuteWindowCount,
    perMinuteWindowTicks,
  )

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
    powerStats: {
      totalSupplyKw,
      totalDemandKw,
      batteryPercent,
      batteryStoredJ,
    },
  }
}

export function initialStorageConfig(deviceTypeId: string) {
  if (deviceTypeId === 'item_port_storager_1') return { submitToWarehouse: true }
  if (deviceTypeId === 'item_port_water_pump_1') return { pumpOutputItemId: DEFAULT_WATER_PUMP_ITEM_ID }
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
