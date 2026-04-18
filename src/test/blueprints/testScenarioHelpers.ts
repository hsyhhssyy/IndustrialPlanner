import { getRotatedPorts, neighborsFromLinks, OPPOSITE_EDGE } from '../../domain/geometry.ts'
import type {
  DeviceConfig,
  DeviceInstance,
  DeviceTypeId,
  Edge,
  ItemId,
  LayoutState,
  Rotation,
  SimState,
} from '../../domain/types.ts'
import { createInitialSimState, startSimulation, tickSimulation } from '../../sim/engine.ts'
import {
  loadStandaloneBlueprintLayout,
  resolvePlacedBlueprintDevice,
  type BlueprintDeviceRef,
  type BlueprintSnapshot,
  type FixedBlueprintLayout,
  type RegisteredBlueprintCase,
} from './harness.ts'

export const TEST_BASE_ID = 'wuling_tianwangping_aid'
export const ORE_ITEM_ID = 'item_originium_ore'
export const ALT_ITEM_ID = 'item_plant_grass_2'
export const WATER_ITEM_ID = 'item_liquid_water'
export const ROTATIONS: Rotation[] = [0, 90, 180, 270]

const EDGE_DELTA: Record<Edge, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 },
}

let instanceCounter = 0

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

export function resetInstanceCounter() {
  instanceCounter = 0
}

export function createDevice(
  typeId: DeviceTypeId,
  rotation: Rotation,
  origin: { x: number; y: number },
  config: DeviceConfig = {},
  instanceId?: string,
): DeviceInstance {
  return {
    instanceId: instanceId ?? `${typeId}_${instanceCounter++}`,
    typeId,
    rotation,
    origin,
    config,
  }
}

function probeDevice(typeId: DeviceTypeId, rotation: Rotation) {
  return createDevice(typeId, rotation, { x: 0, y: 0 }, {}, `probe_${typeId}_${rotation}`)
}

export function loadScenarioBlueprint(testCase: RegisteredBlueprintCase): FixedBlueprintLayout {
  return loadStandaloneBlueprintLayout(testCase.blueprintPath)
}

export function getPort(device: DeviceInstance, portId: string) {
  const port = getRotatedPorts(device).find((entry) => entry.portId === portId)
  assert(port, `未找到端口 ${device.instanceId}:${portId}`)
  return port
}

export function rotationForPortEdge(typeId: DeviceTypeId, portId: string, desiredEdge: Edge) {
  const rotation = ROTATIONS.find((candidateRotation) => getPort(probeDevice(typeId, candidateRotation), portId).edge === desiredEdge)
  assert(rotation !== undefined, `找不到 ${typeId}:${portId} 朝向 ${desiredEdge} 的旋转`)
  return rotation
}

export function placeTargetAfter(
  sourceDevice: DeviceInstance,
  sourcePortId: string,
  targetTypeId: DeviceTypeId,
  targetPortId: string,
  targetConfig: DeviceConfig = {},
  instanceId?: string,
) {
  const sourcePort = getPort(sourceDevice, sourcePortId)
  const desiredTargetEdge = OPPOSITE_EDGE[sourcePort.edge]
  const targetRotation = rotationForPortEdge(targetTypeId, targetPortId, desiredTargetEdge)
  const targetProbe = probeDevice(targetTypeId, targetRotation)
  const targetPort = getPort(targetProbe, targetPortId)
  const delta = EDGE_DELTA[sourcePort.edge]
  return createDevice(
    targetTypeId,
    targetRotation,
    {
      x: sourcePort.x + delta.x - targetPort.x,
      y: sourcePort.y + delta.y - targetPort.y,
    },
    targetConfig,
    instanceId,
  )
}

export function placeSourceBefore(
  targetDevice: DeviceInstance,
  targetPortId: string,
  sourceTypeId: DeviceTypeId,
  sourcePortId: string,
  sourceConfig: DeviceConfig = {},
  instanceId?: string,
) {
  const targetPort = getPort(targetDevice, targetPortId)
  const desiredSourceEdge = OPPOSITE_EDGE[targetPort.edge]
  const sourceRotation = rotationForPortEdge(sourceTypeId, sourcePortId, desiredSourceEdge)
  const sourceProbe = probeDevice(sourceTypeId, sourceRotation)
  const sourcePort = getPort(sourceProbe, sourcePortId)
  const delta = EDGE_DELTA[targetPort.edge]
  return createDevice(
    sourceTypeId,
    sourceRotation,
    {
      x: targetPort.x + delta.x - sourcePort.x,
      y: targetPort.y + delta.y - sourcePort.y,
    },
    sourceConfig,
    instanceId,
  )
}

export function buildSourceStorage(
  itemId: ItemId,
  amount: number,
  origin = { x: 0, y: 0 },
  desiredEdge: Edge = 'E',
  instanceId?: string,
) {
  const rotation = rotationForPortEdge('item_port_storager_1', 'out_n_1', desiredEdge)
  return createDevice(
    'item_port_storager_1',
    rotation,
    origin,
    {
      submitToWarehouse: false,
      storagePreloadInputs: [{ slotIndex: 0, itemId, amount }],
    },
    instanceId,
  )
}

export function buildSinkStorageAgainst(sourceDevice: DeviceInstance, sourcePortId: string, instanceId?: string, submitToWarehouse = false) {
  return placeTargetAfter(sourceDevice, sourcePortId, 'item_port_storager_1', 'in_s_1', { submitToWarehouse }, instanceId)
}

export function buildLiquidSource(
  itemId: ItemId,
  amount: number,
  origin = { x: 0, y: 0 },
  desiredEdge: Edge = 'E',
  instanceId?: string,
) {
  const rotation = rotationForPortEdge('item_port_liquid_storager_1', 'out_e_1', desiredEdge)
  return createDevice(
    'item_port_liquid_storager_1',
    rotation,
    origin,
    {
      storagePreloadInputs: [{ slotIndex: 0, itemId, amount }],
    },
    instanceId,
  )
}

export function buildLiquidSinkAgainst(sourceDevice: DeviceInstance, sourcePortId: string, instanceId?: string) {
  return placeTargetAfter(sourceDevice, sourcePortId, 'item_port_liquid_storager_1', 'in_w_1', {}, instanceId)
}

export function snapshotFromDevices(name: string, devices: DeviceInstance[]): BlueprintSnapshot {
  return {
    name,
    baseId: TEST_BASE_ID,
    devices: devices.map((device) => ({
      blueprintInstanceId: device.instanceId,
      typeId: device.typeId,
      rotation: device.rotation,
      origin: device.origin,
      config: device.config,
    })),
  }
}

export function resolveScenarioDevice(
  loaded: FixedBlueprintLayout,
  ref: BlueprintDeviceRef,
) {
  return resolvePlacedBlueprintDevice(loaded.snapshot, loaded.blueprintDevices, ref)
}

export function simulate(layout: LayoutState, ticks: number) {
  let sim = startSimulation(layout, createInitialSimState(), 'infinite')
  for (let index = 0; index < ticks; index += 1) {
    sim = tickSimulation(layout, sim)
  }
  return sim
}

export function simulateReal(layout: LayoutState, ticks: number, initialBatteryPercent = 0) {
  let sim = startSimulation(layout, createInitialSimState(), 'real', initialBatteryPercent)
  for (let index = 0; index < ticks; index += 1) {
    sim = tickSimulation(layout, sim)
  }
  return sim
}

export function storageAmount(sim: SimState, deviceId: string, itemId: ItemId) {
  const runtime = sim.runtimeById[deviceId]
  if (!runtime || !('inventory' in runtime)) return 0
  const amount = runtime.inventory[itemId] ?? 0
  return Number.isFinite(amount) ? amount : Number.MAX_SAFE_INTEGER
}

export function transportSlotItem(sim: SimState, deviceId: string) {
  const runtime = sim.runtimeById[deviceId]
  if (!runtime || !('slot' in runtime)) return null
  return runtime.slot?.itemId ?? null
}

export function bridgeLaneState(sim: SimState, deviceId: string) {
  const runtime = sim.runtimeById[deviceId]
  if (!runtime || !('nsSlot' in runtime) || !('weSlot' in runtime)) return 'missing'
  return JSON.stringify({
    ns: runtime.nsSlot ? { itemId: runtime.nsSlot.itemId, progress01: runtime.nsSlot.progress01, enteredFrom: runtime.nsSlot.enteredFrom } : null,
    we: runtime.weSlot ? { itemId: runtime.weSlot.itemId, progress01: runtime.weSlot.progress01, enteredFrom: runtime.weSlot.enteredFrom } : null,
  })
}

export function firstArrivalTick(layout: LayoutState, deviceId: string, itemId: ItemId, maxTicks: number) {
  let sim = startSimulation(layout, createInitialSimState(), 'infinite')
  let previousAmount = storageAmount(sim, deviceId, itemId)

  for (let index = 0; index < maxTicks; index += 1) {
    sim = tickSimulation(layout, sim)
    const nextAmount = storageAmount(sim, deviceId, itemId)
    if (nextAmount > previousAmount) {
      return sim.tick
    }
    previousAmount = nextAmount
  }

  return null
}

export function arrivalTicks(layout: LayoutState, deviceId: string, itemId: ItemId, maxTicks: number, expectedCount: number) {
  let sim = startSimulation(layout, createInitialSimState(), 'infinite')
  let previousAmount = storageAmount(sim, deviceId, itemId)
  const ticks: number[] = []

  for (let index = 0; index < maxTicks && ticks.length < expectedCount; index += 1) {
    sim = tickSimulation(layout, sim)
    const nextAmount = storageAmount(sim, deviceId, itemId)
    const delta = nextAmount - previousAmount
    if (delta > 0) {
      const arrivalsThisTick = Math.min(delta, expectedCount - ticks.length)
      for (let arrivalIndex = 0; arrivalIndex < arrivalsThisTick; arrivalIndex += 1) {
        ticks.push(sim.tick)
      }
    }
    previousAmount = nextAmount
  }

  return ticks
}

export function ensureConnected(layout: LayoutState, minLinks: number, name: string) {
  const linkCount = neighborsFromLinks(layout).links.length
  assert(linkCount >= minLinks, `${name} 连线数量不足，当前 ${linkCount}`)
  return linkCount
}

export function deviceLinkSummary(layout: LayoutState, deviceId: string) {
  return neighborsFromLinks(layout).links
    .filter((link) => link.from.instanceId === deviceId || link.to.instanceId === deviceId)
    .map((link) => `${link.from.instanceId}:${link.from.portId}->${link.to.instanceId}:${link.to.portId}`)
    .sort()
    .join('|')
}

export function ensureNoHardBlock(sim: SimState, deviceIds: string[], name: string) {
  for (const deviceId of deviceIds) {
    const runtime = sim.runtimeById[deviceId]
    assert(runtime, `${name} 缺少 runtime: ${deviceId}`)
    assert(runtime.stallReason !== 'OVERLAP', `${name} 出现重叠: ${deviceId}`)
    assert(runtime.stallReason !== 'CONFIG_ERROR', `${name} 出现配置错误: ${deviceId}`)
  }
}