import { DEVICE_TYPE_BY_ID, RECIPES } from '../domain/registry'
import { detectOverlaps, neighborsFromLinks, OPPOSITE_EDGE } from '../domain/geometry'
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

function cycleTicksFromSeconds(cycleSeconds: number, tickRateHz: number) {
  return Math.max(1, Math.round(cycleSeconds * tickRateHz))
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

function baseRuntime(): Pick<DeviceRuntime, 'progress01' | 'stallReason' | 'isStalled'> {
  return { progress01: 0, stallReason: 'NONE', isStalled: false }
}

function runtimeForDevice(device: DeviceInstance): DeviceRuntime {
  const def = DEVICE_TYPE_BY_ID[device.typeId]
  if (def.runtimeKind === 'processor') {
    return {
      ...baseRuntime(),
      inputBuffer: {},
      outputBuffer: {},
      cycleProgressTicks: 0,
      producedItemsTotal: 0,
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
  return {
    originium_ore: Number.POSITIVE_INFINITY,
    originium_powder: 0,
  }
}

function normalizeRuntimeState(runtime: DeviceRuntime, stallReason: StallReason) {
  runtime.stallReason = stallReason
  runtime.isStalled = stallReason !== 'NONE'
}

function mark(output: Partial<Record<ItemId, number>>, itemId: ItemId, delta: number) {
  output[itemId] = (output[itemId] ?? 0) + delta
}

function addToStorage(runtime: DeviceRuntime, itemId: ItemId, amount: number) {
  if ('inventory' in runtime) {
    runtime.inventory[itemId] = (runtime.inventory[itemId] ?? 0) + amount
  }
  if ('inputBuffer' in runtime) {
    runtime.inputBuffer[itemId] = (runtime.inputBuffer[itemId] ?? 0) + amount
  }
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
  if (device.typeId === 'bridge_1x1') {
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

function sourceSlotLane(device: DeviceInstance, runtime: DeviceRuntime, fromPortId: string): 'slot' | 'ns' | 'we' | 'output' {
  if (device.typeId === 'bridge_1x1') {
    if (fromPortId.endsWith('_n') || fromPortId.endsWith('_s')) return 'ns'
    return 'we'
  }
  if ('slot' in runtime) return 'slot'
  return 'output'
}

function peekOutputItem(device: DeviceInstance, runtime: DeviceRuntime): ItemId | null {
  if (device.typeId === 'pickup_port_3x1') return device.config.pickupItemId ?? null

  if ('outputBuffer' in runtime) {
    if ((runtime.outputBuffer.originium_powder ?? 0) > 0) return 'originium_powder'
    return null
  }

  if ('inventory' in runtime) {
    if ((runtime.inventory.originium_ore ?? 0) > 0) return 'originium_ore'
    if ((runtime.inventory.originium_powder ?? 0) > 0) return 'originium_powder'
    return null
  }

  return null
}

function readyItemForLane(
  device: DeviceInstance,
  runtime: DeviceRuntime,
  lane: 'slot' | 'ns' | 'we' | 'output',
  conveyorSpeed: number,
) {
  if (lane === 'output') return peekOutputItem(device, runtime)
  const slot = getSlotRef(runtime, lane)
  if (!slot) return null
  if (slot.progress01 < 0.5) return null
  slot.progress01 = Math.min(1, slot.progress01 + conveyorSpeed)
  runtime.progress01 = slot.progress01
  if (slot.progress01 >= 1) return slot.itemId
  return null
}

function peekReadyItemForLane(device: DeviceInstance, runtime: DeviceRuntime, lane: 'slot' | 'ns' | 'we' | 'output') {
  if (lane === 'output') return peekOutputItem(device, runtime)
  const slot = getSlotRef(runtime, lane)
  if (!slot || slot.progress01 < 1) return null
  return slot.itemId
}

function hasReadyOutput(device: DeviceInstance, runtime: DeviceRuntime) {
  if (device.typeId === 'pickup_port_3x1') return Boolean(device.config.pickupItemId)
  if ('outputBuffer' in runtime) return (runtime.outputBuffer.originium_powder ?? 0) > 0
  if ('inventory' in runtime) return (runtime.inventory.originium_ore ?? 0) > 0 || (runtime.inventory.originium_powder ?? 0) > 0
  if ('nsSlot' in runtime && 'weSlot' in runtime) {
    const slotReady = Boolean(runtime.slot && runtime.slot.progress01 >= 1)
    const nsReady = Boolean(runtime.nsSlot && runtime.nsSlot.progress01 >= 1)
    const weReady = Boolean(runtime.weSlot && runtime.weSlot.progress01 >= 1)
    return slotReady || nsReady || weReady
  }
  if ('slot' in runtime) return Boolean(runtime.slot && runtime.slot.progress01 >= 1)
  return false
}

function orderedOutLinks(device: DeviceInstance, runtime: DeviceRuntime, outLinks: ReturnType<typeof neighborsFromLinks>['links']) {
  if ((device.typeId !== 'splitter_1x1' && device.typeId !== 'merger_1x1') || outLinks.length <= 1) return outLinks
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
  return device.typeId !== 'pickup_port_3x1' || Boolean(device.config.pickupItemId)
}

function resetRuntimeByLayout(layout: LayoutState) {
  const runtimeById: Record<string, DeviceRuntime> = {}
  for (const device of layout.devices) {
    runtimeById[device.instanceId] = runtimeForDevice(device)
  }
  return runtimeById
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
  return {
    isRunning: false,
    speed: 1,
    tick: 0,
    tickRateHz: BASE_TICK_RATE,
    runtimeById: {},
    warehouse: emptyWarehouse(),
    stats: {
      simSeconds: 0,
      producedPerMinute: { originium_ore: 0, originium_powder: 0 },
      consumedPerMinute: { originium_ore: 0, originium_powder: 0 },
    },
    minuteWindowDeltas: [],
  }
}

export function startSimulation(layout: LayoutState, sim: SimState): SimState {
  const runtimeById = resetRuntimeByLayout(layout)
  const overlaps = detectOverlaps(layout)
  const poles = layout.devices.filter((device) => device.typeId === 'power_pole_2x2')

  for (const device of layout.devices) {
    const runtime = runtimeById[device.instanceId]
    let stall: StallReason = 'NONE'
    if (overlaps.has(device.instanceId)) stall = 'OVERLAP'
    else if (!pickupHasConfig(device)) stall = 'CONFIG_ERROR'
    else if (device.typeId === 'crusher_3x3' && !inPowerRange(device, poles)) stall = 'NO_POWER'
    normalizeRuntimeState(runtime, stall)
  }

  return {
    ...sim,
    isRunning: true,
    tick: 0,
    runtimeById,
    warehouse: emptyWarehouse(),
    stats: {
      simSeconds: 0,
      producedPerMinute: { originium_ore: 0, originium_powder: 0 },
      consumedPerMinute: { originium_ore: 0, originium_powder: 0 },
    },
    minuteWindowDeltas: [],
  }
}

export function stopSimulation(sim: SimState): SimState {
  return {
    ...sim,
    isRunning: false,
    tick: 0,
    runtimeById: {},
    warehouse: { originium_ore: 0, originium_powder: 0 },
    stats: {
      simSeconds: 0,
      producedPerMinute: { originium_ore: 0, originium_powder: 0 },
      consumedPerMinute: { originium_ore: 0, originium_powder: 0 },
    },
    minuteWindowDeltas: [],
  }
}

function tryConsumeCrusherInput(runtime: DeviceRuntime) {
  if (!('inputBuffer' in runtime)) return false
  const ore = runtime.inputBuffer.originium_ore ?? 0
  if (ore <= 0) return false
  runtime.inputBuffer.originium_ore = ore - 1
  return true
}

function withSlidingWindowPerMinute(windowDeltas: Array<Partial<Record<ItemId, number>>>) {
  const producedPerMinute: Record<ItemId, number> = { originium_ore: 0, originium_powder: 0 }
  const consumedPerMinute: Record<ItemId, number> = { originium_ore: 0, originium_powder: 0 }

  for (const itemId of ['originium_ore', 'originium_powder'] as const) {
    let produced = 0
    let consumed = 0
    for (const deltaByTick of windowDeltas) {
      const delta = deltaByTick[itemId] ?? 0
      if (delta > 0) produced += delta
      else if (delta < 0) consumed += Math.abs(delta)
    }
    producedPerMinute[itemId] = produced
    consumedPerMinute[itemId] = consumed
  }

  return {
    producedPerMinute,
    consumedPerMinute,
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
  const links = neighborsFromLinks(layout)
  const transferPlans: TransferPlan[] = []
  const reservedReceivers = new Set<string>()
  const lanesClearingThisTick = new Set<string>()
  const lanesAdvancedThisTick = new Set<string>()

  const warehouse = { ...sim.warehouse }
  const totalDelta: Partial<Record<ItemId, number>> = {}

  for (const device of layout.devices) {
    const runtime = runtimeById[device.instanceId]
    if (!runtime) continue

    if (runtime.stallReason === 'CONFIG_ERROR' || runtime.stallReason === 'OVERLAP' || runtime.stallReason === 'NO_POWER') {
      continue
    }

    normalizeRuntimeState(runtime, 'NONE')

    if (device.typeId === 'crusher_3x3' && 'outputBuffer' in runtime && 'inputBuffer' in runtime) {
      const recipe = RECIPES[0]
      const recipeCycleTicks = cycleTicksFromSeconds(recipe.cycleSeconds, sim.tickRateHz)
      if (runtime.cycleProgressTicks <= 0 && !tryConsumeCrusherInput(runtime)) {
        normalizeRuntimeState(runtime, 'NO_INPUT')
      } else {
        runtime.cycleProgressTicks += 1
        runtime.progress01 = runtime.cycleProgressTicks / recipeCycleTicks
        if (runtime.cycleProgressTicks >= recipeCycleTicks) {
          runtime.cycleProgressTicks = 0
          runtime.progress01 = 0
          let producedThisCycle = 0
          for (const output of recipe.outputs) {
            mark(runtime.outputBuffer, output.itemId, output.amount)
            producedThisCycle += output.amount
          }
          runtime.producedItemsTotal += producedThisCycle
        }
      }
    }

    if (device.typeId === 'storage_box_3x3' && 'inventory' in runtime) {
      runtime.submitAccumulatorTicks += 1
      const enabled = device.config.submitToWarehouse ?? true
      if (enabled && runtime.submitAccumulatorTicks >= storageSubmitTicks) {
        runtime.submitAccumulatorTicks = 0
        for (const itemId of ['originium_ore', 'originium_powder'] as const) {
          const amount = runtime.inventory[itemId] ?? 0
          if (amount <= 0) continue
          runtime.inventory[itemId] = 0
          if (Number.isFinite(warehouse[itemId])) warehouse[itemId] += amount
          mark(totalDelta, itemId, amount)
        }
      }
    }

    if ('slot' in runtime && runtime.slot) {
      const slot = runtime.slot
      if (slot.progress01 < 0.5) {
        slot.progress01 = Math.min(0.5, slot.progress01 + conveyorSpeed)
        runtime.progress01 = slot.progress01
      }
    }

    if ('nsSlot' in runtime && runtime.nsSlot && runtime.nsSlot.progress01 < 0.5) {
      runtime.nsSlot.progress01 = Math.min(0.5, runtime.nsSlot.progress01 + conveyorSpeed)
      runtime.progress01 = runtime.nsSlot.progress01
    }
    if ('weSlot' in runtime && runtime.weSlot && runtime.weSlot.progress01 < 0.5) {
      runtime.weSlot.progress01 = Math.min(0.5, runtime.weSlot.progress01 + conveyorSpeed)
      runtime.progress01 = runtime.weSlot.progress01
    }
  }

  const plannedSenders = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const device of layout.devices) {
      const runtime = runtimeById[device.instanceId]
      if (!runtime || runtime.isStalled || plannedSenders.has(device.instanceId)) continue
      const rawOutLinks = links.outMap.get(device.instanceId) ?? []
      const outLinks = orderedOutLinks(device, runtime, rawOutLinks)

      for (const link of outLinks) {
        const toRuntime = runtimeById[link.to.instanceId]
        const toDevice = layout.devices.find((d) => d.instanceId === link.to.instanceId)
        if (!toRuntime || !toDevice) continue

        const recvState = canReceiveOnPortWithPlan(toDevice, toRuntime, link.to.portId, reservedReceivers, lanesClearingThisTick)
        if (!recvState.lane || !recvState.canTry) continue

        const fromLane = sourceSlotLane(device, runtime, link.from.portId)
        const laneAdvanceKey = `${device.instanceId}:${fromLane}`
        if (!lanesAdvancedThisTick.has(laneAdvanceKey)) {
          const beforeSlot = fromLane === 'output' ? null : getSlotRef(runtime, fromLane)
          const beforeProgress = beforeSlot?.progress01 ?? null
          readyItemForLane(device, runtime, fromLane, conveyorSpeed)
          lanesAdvancedThisTick.add(laneAdvanceKey)
          const afterSlot = fromLane === 'output' ? null : getSlotRef(runtime, fromLane)
          const afterProgress = afterSlot?.progress01 ?? null
          if (beforeProgress !== null && afterProgress !== null && afterProgress > beforeProgress) {
            changed = true
          }
        }

        const itemId = peekReadyItemForLane(device, runtime, fromLane)
        if (!itemId) continue
        if (!recvState.canAccept) continue

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

        if ((device.typeId === 'splitter_1x1' || device.typeId === 'merger_1x1') && 'rrIndex' in runtime && outLinks.length > 0) {
          runtime.rrIndex = (runtime.rrIndex + 1) % outLinks.length
        }

        changed = true
        break
      }
    }
  }

  for (const device of layout.devices) {
    const runtime = runtimeById[device.instanceId]
    if (!runtime || runtime.isStalled) continue
    const outLinks = links.outMap.get(device.instanceId) ?? []

    if (device.typeId === 'pickup_port_3x1' && 'submitAccumulatorTicks' in runtime) {
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
        normalizeRuntimeState(runtime, 'OUTPUT_BLOCKED')
      }
      continue
    }

    if (outLinks.length > 0 && !plannedSenders.has(device.instanceId) && hasReadyOutput(device, runtime)) {
      normalizeRuntimeState(runtime, 'OUTPUT_BLOCKED')
    }
  }

  for (const plan of transferPlans) {
    const fromRuntime = runtimeById[plan.fromId]
    const toRuntime = runtimeById[plan.toId]
    const fromDevice = layout.devices.find((d) => d.instanceId === plan.fromId)
    if (!fromRuntime || !toRuntime || !fromDevice) continue

    if (fromDevice.typeId === 'pickup_port_3x1') {
      if (plan.itemId === 'originium_ore' && Number.isFinite(warehouse.originium_ore)) {
        warehouse.originium_ore = Math.max(0, warehouse.originium_ore - 1)
        mark(totalDelta, 'originium_ore', -1)
      }
    } else {
      if (plan.fromLane === 'output') {
        if ('outputBuffer' in fromRuntime) {
          fromRuntime.outputBuffer[plan.itemId] = Math.max(0, (fromRuntime.outputBuffer[plan.itemId] ?? 0) - 1)
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

    if (plan.lane === 'output') {
      addToStorage(toRuntime, plan.itemId, 1)
    } else {
      const incomingEdge = plan.toPortId.slice(-1).toUpperCase() as keyof typeof OPPOSITE_EDGE
      setSlotRef(toRuntime, plan.lane, {
        itemId: plan.itemId,
        progress01: 0,
        enteredFrom: OPPOSITE_EDGE[incomingEdge],
        enteredTick: sim.tick,
      })
    }
  }

  const nextTick = sim.tick + 1
  const simSeconds = nextTick / sim.tickRateHz
  const minuteWindowDeltas = [...sim.minuteWindowDeltas, { ...totalDelta }]
  if (minuteWindowDeltas.length > perMinuteWindowTicks) {
    minuteWindowDeltas.splice(0, minuteWindowDeltas.length - perMinuteWindowTicks)
  }

  const nextStats = {
    simSeconds,
    ...withSlidingWindowPerMinute(minuteWindowDeltas),
  }

  return {
    ...sim,
    tick: nextTick,
    runtimeById,
    warehouse,
    stats: nextStats,
    minuteWindowDeltas,
  }
}

export function initialStorageConfig(deviceTypeId: string) {
  if (deviceTypeId === 'storage_box_3x3') return { submitToWarehouse: true }
  return {}
}

export function runtimeLabel(runtime: DeviceRuntime | undefined) {
  if (!runtime) return 'idle'
  if (runtime.stallReason === 'NO_INPUT') return 'starved'
  if (runtime.stallReason === 'NONE') return 'running'
  return runtime.stallReason.toLowerCase()
}

export function getInventory(runtime: DeviceRuntime | undefined) {
  const empty = { originium_ore: 0, originium_powder: 0 }
  if (!runtime) return empty
  if ('inventory' in runtime) {
    return {
      originium_ore: runtime.inventory.originium_ore ?? 0,
      originium_powder: runtime.inventory.originium_powder ?? 0,
    }
  }
  if ('inputBuffer' in runtime && 'outputBuffer' in runtime) {
    return {
      originium_ore: runtime.inputBuffer.originium_ore ?? 0,
      originium_powder: runtime.outputBuffer.originium_powder ?? 0,
    }
  }
  return empty
}
