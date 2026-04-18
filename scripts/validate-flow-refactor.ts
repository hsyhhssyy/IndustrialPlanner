import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getRotatedPorts, neighborsFromLinks, OPPOSITE_EDGE } from '../src/domain/geometry.ts'
import type { DeviceConfig, DeviceInstance, DeviceTypeId, Edge, ItemId, LayoutState, Rotation, SimState } from '../src/domain/types.ts'
import { createInitialSimState, startSimulation, tickSimulation } from '../src/sim/engine.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ROTATIONS: Rotation[] = [0, 90, 180, 270]
const EDGE_DELTA: Record<Edge, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 },
}

const BASE_ID = 'wuling_tianwangping_aid'
const ORE_ITEM_ID = 'item_originium_ore'
const ALT_ITEM_ID = 'item_plant_grass_2'
const WATER_ITEM_ID = 'item_liquid_water'

let instanceCounter = 0

type ScenarioResult = {
  name: string
  summary: Record<string, number | string>
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function resetInstanceCounter() {
  instanceCounter = 0
}

function createDevice(
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

function getPort(device: DeviceInstance, portId: string) {
  const port = getRotatedPorts(device).find((entry) => entry.portId === portId)
  assert(port, `未找到端口 ${device.instanceId}:${portId}`)
  return port
}

function rotationForPortEdge(typeId: DeviceTypeId, portId: string, desiredEdge: Edge) {
  const rotation = ROTATIONS.find((candidateRotation) => getPort(probeDevice(typeId, candidateRotation), portId).edge === desiredEdge)
  assert(rotation !== undefined, `找不到 ${typeId}:${portId} 朝向 ${desiredEdge} 的旋转`)
  return rotation
}

function placeTargetAfter(
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

function placeSourceBefore(
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

function buildSourceStorage(itemId: ItemId, amount: number, origin = { x: 0, y: 0 }, desiredEdge: Edge = 'E') {
  const rotation = rotationForPortEdge('item_port_storager_1', 'out_n_1', desiredEdge)
  return createDevice(
    'item_port_storager_1',
    rotation,
    origin,
    {
      submitToWarehouse: false,
      storagePreloadInputs: [{ slotIndex: 0, itemId, amount }],
    },
  )
}

function buildSinkStorageAgainst(sourceDevice: DeviceInstance, sourcePortId: string) {
  return placeTargetAfter(sourceDevice, sourcePortId, 'item_port_storager_1', 'in_s_1', { submitToWarehouse: false })
}

function buildLayout(devices: DeviceInstance[]): LayoutState {
  return {
    baseId: BASE_ID,
    lotSize: 128,
    devices,
    links: [],
  }
}

function simulate(layout: LayoutState, ticks: number) {
  let sim = startSimulation(layout, createInitialSimState(), 'infinite')
  for (let index = 0; index < ticks; index += 1) {
    sim = tickSimulation(layout, sim)
  }
  return sim
}

function simulateReal(layout: LayoutState, ticks: number, initialBatteryPercent = 0) {
  let sim = startSimulation(layout, createInitialSimState(), 'real', initialBatteryPercent)
  for (let index = 0; index < ticks; index += 1) {
    sim = tickSimulation(layout, sim)
  }
  return sim
}

function firstArrivalTick(layout: LayoutState, deviceId: string, itemId: ItemId, maxTicks: number) {
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

function arrivalTicks(layout: LayoutState, deviceId: string, itemId: ItemId, maxTicks: number, expectedCount: number) {
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

function storageAmount(sim: SimState, deviceId: string, itemId: ItemId) {
  const runtime = sim.runtimeById[deviceId]
  if (!runtime || !('inventory' in runtime)) return 0
  const amount = runtime.inventory[itemId] ?? 0
  return Number.isFinite(amount) ? amount : Number.MAX_SAFE_INTEGER
}

function transportSlotItem(sim: SimState, deviceId: string) {
  const runtime = sim.runtimeById[deviceId]
  if (!runtime || !('slot' in runtime)) return null
  return runtime.slot?.itemId ?? null
}

function bridgeLaneState(sim: SimState, deviceId: string) {
  const runtime = sim.runtimeById[deviceId]
  if (!runtime || !('nsSlot' in runtime) || !('weSlot' in runtime)) return 'missing'
  return JSON.stringify({
    ns: runtime.nsSlot ? { itemId: runtime.nsSlot.itemId, progress01: runtime.nsSlot.progress01, enteredFrom: runtime.nsSlot.enteredFrom } : null,
    we: runtime.weSlot ? { itemId: runtime.weSlot.itemId, progress01: runtime.weSlot.progress01, enteredFrom: runtime.weSlot.enteredFrom } : null,
  })
}

function ensureConnected(layout: LayoutState, minLinks: number, name: string) {
  const linkCount = neighborsFromLinks(layout).links.length
  assert(linkCount >= minLinks, `${name} 连线数量不足，当前 ${linkCount}`)
  return linkCount
}

function deviceLinkSummary(layout: LayoutState, deviceId: string) {
  return neighborsFromLinks(layout).links
    .filter((link) => link.from.instanceId === deviceId || link.to.instanceId === deviceId)
    .map((link) => `${link.from.instanceId}:${link.from.portId}->${link.to.instanceId}:${link.to.portId}`)
    .sort()
    .join('|')
}

function ensureNoHardBlock(sim: SimState, deviceIds: string[], name: string) {
  for (const deviceId of deviceIds) {
    const runtime = sim.runtimeById[deviceId]
    assert(runtime, `${name} 缺少 runtime: ${deviceId}`)
    assert(runtime.stallReason !== 'OVERLAP', `${name} 出现重叠: ${deviceId}`)
    assert(runtime.stallReason !== 'CONFIG_ERROR', `${name} 出现配置错误: ${deviceId}`)
  }
}

function runDirectScenario(): ScenarioResult {
  resetInstanceCounter()
  const source = buildSourceStorage(ORE_ITEM_ID, 6)
  const belt = placeTargetAfter(source, 'out_n_1', 'belt_straight_1x1', 'in_w')
  const sink = buildSinkStorageAgainst(belt, 'out_e')
  const layout = buildLayout([source, belt, sink])
  const links = ensureConnected(layout, 2, 'direct')
  const observedArrivalTicks = arrivalTicks(layout, sink.instanceId, ORE_ITEM_ID, 200, 4)
  const firstTick = observedArrivalTicks[0] ?? null
  const intervals = observedArrivalTicks.slice(1).map((tick, index) => tick - observedArrivalTicks[index])
  const sim = simulate(layout, 240)
  ensureNoHardBlock(sim, layout.devices.map((device) => device.instanceId), 'direct')
  const sinkOre = storageAmount(sim, sink.instanceId, ORE_ITEM_ID)
  assert(firstTick === 41, `direct 首包到达 tick 异常，expected=41 actual=${String(firstTick)}`)
  assert(observedArrivalTicks.length === 4, `direct 到货样本不足，expected=4 actual=${observedArrivalTicks.length}`)
  assert(intervals.every((interval) => interval === 40), `direct 稳态到货间隔异常，expected=40 actual=${intervals.join(',')}`)
  assert(sinkOre > 0, 'direct 场景没有把物品送到终点存储')
  return {
    name: 'direct',
    summary: {
      links,
      firstTick: firstTick ?? 'missing',
      arrivalTicks: observedArrivalTicks.join(','),
      intervals: intervals.join(','),
      sinkOre,
    },
  }
}

function runJunctionScenario(): ScenarioResult {
  resetInstanceCounter()
  const source = buildSourceStorage(ORE_ITEM_ID, 12)
  const entryBelt = placeTargetAfter(source, 'out_n_1', 'belt_straight_1x1', 'in_w')
  const splitter = placeTargetAfter(entryBelt, 'out_e', 'item_log_splitter', 'in_e')
  const northBelt = placeTargetAfter(splitter, 'out_n', 'belt_straight_1x1', 'in_w')
  const southBelt = placeTargetAfter(splitter, 'out_s', 'belt_straight_1x1', 'in_w')
  const northSink = buildSinkStorageAgainst(northBelt, 'out_e')
  const southSink = buildSinkStorageAgainst(southBelt, 'out_e')
  const layout = buildLayout([source, entryBelt, splitter, northBelt, southBelt, northSink, southSink])
  const links = ensureConnected(layout, 6, 'junction')
  const sim = simulate(layout, 520)
  ensureNoHardBlock(sim, layout.devices.map((device) => device.instanceId), 'junction')
  const northOre = storageAmount(sim, northSink.instanceId, ORE_ITEM_ID)
  const southOre = storageAmount(sim, southSink.instanceId, ORE_ITEM_ID)
  assert(northOre > 0, `junction 北分支没有收到物品，north=${northOre}, south=${southOre}`)
  assert(southOre > 0, `junction 南分支没有收到物品，north=${northOre}, south=${southOre}`)
  return {
    name: 'junction',
    summary: {
      links,
      northOre,
      southOre,
    },
  }
}

function runBridgeScenario(): ScenarioResult {
  const summaries = ROTATIONS.map((rotation) => {
    resetInstanceCounter()
    const bridge = createDevice('item_log_connector', rotation, { x: 20, y: 20 })

    const leftBelt = placeSourceBefore(bridge, 'in_w', 'belt_straight_1x1', 'out_e')
    const leftSource = placeSourceBefore(leftBelt, 'in_w', 'item_port_storager_1', 'out_n_1', {
      submitToWarehouse: false,
      storagePreloadInputs: [{ slotIndex: 0, itemId: ORE_ITEM_ID, amount: 10 }],
    })
    const rightBelt = placeTargetAfter(bridge, 'out_e', 'belt_straight_1x1', 'in_w')
    const rightSink = buildSinkStorageAgainst(rightBelt, 'out_e')

    const topBelt = placeSourceBefore(bridge, 'in_n', 'belt_straight_1x1', 'out_e')
    const topSource = placeSourceBefore(topBelt, 'in_w', 'item_port_storager_1', 'out_n_1', {
      submitToWarehouse: false,
      storagePreloadInputs: [{ slotIndex: 0, itemId: ALT_ITEM_ID, amount: 10 }],
    })
    const bottomBelt = placeTargetAfter(bridge, 'out_s', 'belt_straight_1x1', 'in_w')
    const bottomSink = buildSinkStorageAgainst(bottomBelt, 'out_e')

    const layout = buildLayout([leftSource, leftBelt, bridge, rightBelt, rightSink, topSource, topBelt, bottomBelt, bottomSink])
    const links = ensureConnected(layout, 8, `bridge-${rotation}`)
    const bridgeLinks = deviceLinkSummary(layout, bridge.instanceId)
    const firstRightTick = firstArrivalTick(layout, rightSink.instanceId, ORE_ITEM_ID, 160)
    const firstBottomTick = firstArrivalTick(layout, bottomSink.instanceId, ALT_ITEM_ID, 160)
    const sim = simulate(layout, 520)
    ensureNoHardBlock(sim, layout.devices.map((device) => device.instanceId), `bridge-${rotation}`)
    const rightOre = storageAmount(sim, rightSink.instanceId, ORE_ITEM_ID)
    const bottomAlt = storageAmount(sim, bottomSink.instanceId, ALT_ITEM_ID)
    const bridgeState = bridgeLaneState(sim, bridge.instanceId)
    assert(firstRightTick === 121, `bridge rotation=${rotation} 水平首包到达 tick 异常，expected=121 actual=${String(firstRightTick)}, bridge=${bridgeState}, links=${bridgeLinks}`)
    assert(firstBottomTick === 121, `bridge rotation=${rotation} 垂直首包到达 tick 异常，expected=121 actual=${String(firstBottomTick)}, bridge=${bridgeState}, links=${bridgeLinks}`)
    assert(rightOre > 0, `bridge rotation=${rotation} 水平通道没有到货，right=${rightOre}, bottom=${bottomAlt}, bridge=${bridgeState}, links=${bridgeLinks}`)
    assert(bottomAlt > 0, `bridge rotation=${rotation} 垂直通道没有到货，right=${rightOre}, bottom=${bottomAlt}, bridge=${bridgeState}, links=${bridgeLinks}`)
    return { rotation, links, firstRightTick, firstBottomTick, rightOre, bottomAlt }
  })

  return {
    name: 'bridge',
    summary: {
      rotations: JSON.stringify(summaries),
    },
  }
}

function runStorageScenario(): ScenarioResult {
  resetInstanceCounter()
  const source = buildSourceStorage(ORE_ITEM_ID, 10)
  const beltIn = placeTargetAfter(source, 'out_n_1', 'belt_straight_1x1', 'in_w')
  const middle = placeTargetAfter(beltIn, 'out_e', 'item_port_storager_1', 'in_s_1', { submitToWarehouse: false })
  const beltOut = placeTargetAfter(middle, 'out_n_1', 'belt_straight_1x1', 'in_w')
  const sink = buildSinkStorageAgainst(beltOut, 'out_e')
  const layout = buildLayout([source, beltIn, middle, beltOut, sink])
  const links = ensureConnected(layout, 4, 'storage')
  const middleFirstTick = firstArrivalTick(layout, middle.instanceId, ORE_ITEM_ID, 120)
  const sinkFirstTick = firstArrivalTick(layout, sink.instanceId, ORE_ITEM_ID, 200)
  const finalSim = simulate(layout, 520)
  ensureNoHardBlock(finalSim, layout.devices.map((device) => device.instanceId), 'storage-final')
  const sinkOre = storageAmount(finalSim, sink.instanceId, ORE_ITEM_ID)
  assert(middleFirstTick === 41, `storage 场景中间存储首包到达 tick 异常，expected=41 actual=${String(middleFirstTick)}`)
  assert(sinkFirstTick === 82, `storage 场景终点存储首包到达 tick 异常，expected=82 actual=${String(sinkFirstTick)}`)
  assert(sinkOre > 0, 'storage 场景中间存储没有成功继续出货')
  return {
    name: 'storage',
    summary: {
      links,
      middleFirstTick: middleFirstTick ?? 'missing',
      sinkFirstTick: sinkFirstTick ?? 'missing',
      sinkOre,
    },
  }
}

function runStorageWarehouseSubmitScenario(): ScenarioResult {
  resetInstanceCounter()
  const source = buildSourceStorage(ALT_ITEM_ID, 5)
  const belt = placeTargetAfter(source, 'out_n_1', 'belt_straight_1x1', 'in_w')
  const receiver = placeTargetAfter(belt, 'out_e', 'item_port_storager_1', 'in_s_1', { submitToWarehouse: true })
  const pole = createDevice('item_port_power_diffuser_1', 0, { x: receiver.origin.x + 6, y: receiver.origin.y })
  const layout = buildLayout([source, belt, receiver, pole])
  const links = ensureConnected(layout, 2, 'storage-warehouse-submit')
  const sim = simulate(layout, 601)
  ensureNoHardBlock(sim, layout.devices.map((device) => device.instanceId), 'storage-warehouse-submit')
  const warehouseAmount = sim.warehouse[ALT_ITEM_ID] ?? 0
  const receiverRuntime = sim.runtimeById[receiver.instanceId]
  const receiverAmount = receiverRuntime && 'inventory' in receiverRuntime ? (receiverRuntime.inventory[ALT_ITEM_ID] ?? 0) : -1
  const sourceAmount = storageAmount(sim, source.instanceId, ALT_ITEM_ID)
  assert(warehouseAmount === 5, `storage-warehouse-submit 仓库计数异常，expected=5 actual=${warehouseAmount}`)
  assert(receiverAmount === 0, `storage-warehouse-submit 提交后协议存储箱未清空，actual=${receiverAmount}`)
  assert(sourceAmount === 0, `storage-warehouse-submit 源存储箱未正常出货，actual=${sourceAmount}`)
  return {
    name: 'storage-warehouse-submit',
    summary: {
      links,
      warehouseAmount,
      receiverAmount,
      sourceAmount,
    },
  }
}

function buildAdmissionChain(itemId: ItemId) {
  resetInstanceCounter()
  const source = buildSourceStorage(itemId, 6)
  const beltIn = placeTargetAfter(source, 'out_n_1', 'belt_straight_1x1', 'in_w')
  const admission = placeTargetAfter(beltIn, 'out_e', 'item_log_admission', 'in_w', {
    admissionItemId: ORE_ITEM_ID,
    admissionAmount: 6,
  })
  const beltOut = placeTargetAfter(admission, 'out_e', 'belt_straight_1x1', 'in_w')
  const sink = buildSinkStorageAgainst(beltOut, 'out_e')
  return {
    layout: buildLayout([source, beltIn, admission, beltOut, sink]),
    sinkId: sink.instanceId,
  }
}

function runAdmissionScenario(): ScenarioResult {
  const positive = buildAdmissionChain(ORE_ITEM_ID)
  const positiveLinks = ensureConnected(positive.layout, 4, 'admission-positive')
  const positiveSim = simulate(positive.layout, 260)
  const positiveAmount = storageAmount(positiveSim, positive.sinkId, ORE_ITEM_ID)
  assert(positiveAmount > 0, 'admission 正向链路没有放行目标物品')

  const negative = buildAdmissionChain(ALT_ITEM_ID)
  ensureConnected(negative.layout, 4, 'admission-negative')
  const negativeSim = simulate(negative.layout, 260)
  const negativeAmount = storageAmount(negativeSim, negative.sinkId, ALT_ITEM_ID)
  assert(negativeAmount === 0, 'admission 错误放行了非目标物品')

  return {
    name: 'admission',
    summary: {
      positiveLinks,
      positiveAmount,
      negativeAmount,
    },
  }
}

function runBeltChainScenario(): ScenarioResult {
  resetInstanceCounter()
  const converger = createDevice(
    'item_log_converger',
    rotationForPortEdge('item_log_converger', 'out_w', 'E'),
    { x: 40, y: 20 },
  )
  const chainBelt = placeTargetAfter(converger, 'out_w', 'belt_straight_1x1', 'in_w')
  const splitter = placeTargetAfter(chainBelt, 'out_e', 'item_log_splitter', 'in_e')
  const northBelt = placeTargetAfter(splitter, 'out_n', 'belt_straight_1x1', 'in_w')
  const northBeltTail = placeTargetAfter(northBelt, 'out_e', 'belt_straight_1x1', 'in_w')
  const northBeltTail2 = placeTargetAfter(northBeltTail, 'out_e', 'belt_straight_1x1', 'in_w')
  const northBeltTail3 = placeTargetAfter(northBeltTail2, 'out_e', 'belt_straight_1x1', 'in_w')
  const southBelt = placeTargetAfter(splitter, 'out_s', 'belt_straight_1x1', 'in_w')
  const southBeltTail = placeTargetAfter(southBelt, 'out_e', 'belt_straight_1x1', 'in_w')
  const southBeltTail2 = placeTargetAfter(southBeltTail, 'out_e', 'belt_straight_1x1', 'in_w')
  const southBeltTail3 = placeTargetAfter(southBeltTail2, 'out_e', 'belt_straight_1x1', 'in_w')
  const northSink = buildSinkStorageAgainst(northBeltTail3, 'out_e')
  const southSink = buildSinkStorageAgainst(southBeltTail3, 'out_e')

  const northFeedBelt = placeSourceBefore(converger, 'in_n', 'belt_straight_1x1', 'out_e')
  const northSource = placeSourceBefore(northFeedBelt, 'in_w', 'item_port_storager_1', 'out_n_1', {
    submitToWarehouse: false,
    storagePreloadInputs: [{ slotIndex: 0, itemId: ORE_ITEM_ID, amount: 12 }],
  })
  const southFeedBelt = placeSourceBefore(converger, 'in_s', 'belt_straight_1x1', 'out_e')
  const southSource = placeSourceBefore(southFeedBelt, 'in_w', 'item_port_storager_1', 'out_n_1', {
    submitToWarehouse: false,
    storagePreloadInputs: [{ slotIndex: 0, itemId: ORE_ITEM_ID, amount: 12 }],
  })

  const layout = buildLayout([
    northSource,
    northFeedBelt,
    southSource,
    southFeedBelt,
    converger,
    chainBelt,
    splitter,
    northBelt,
    northBeltTail,
    northBeltTail2,
    northBeltTail3,
    southBelt,
    southBeltTail,
    southBeltTail2,
    southBeltTail3,
    northSink,
    southSink,
  ])
  const links = ensureConnected(layout, 10, 'belt-chain')
  const sim = simulate(layout, 700)
  ensureNoHardBlock(sim, layout.devices.map((device) => device.instanceId), 'belt-chain')
  const northOre = storageAmount(sim, northSink.instanceId, ORE_ITEM_ID)
  const southOre = storageAmount(sim, southSink.instanceId, ORE_ITEM_ID)
  assert(northOre > 0, `belt-chain 北支路没有收到物品，north=${northOre}, south=${southOre}`)
  assert(southOre > 0, `belt-chain 南支路没有收到物品，north=${northOre}, south=${southOre}`)
  return {
    name: 'belt-chain',
    summary: {
      links,
      northOre,
      southOre,
      deviceCount: layout.devices.length,
    },
  }
}

function buildLiquidSource(itemId: ItemId, amount: number, origin = { x: 0, y: 0 }, desiredEdge: Edge = 'E') {
  const rotation = rotationForPortEdge('item_port_liquid_storager_1', 'out_e_1', desiredEdge)
  return createDevice(
    'item_port_liquid_storager_1',
    rotation,
    origin,
    {
      storagePreloadInputs: [{ slotIndex: 0, itemId, amount }],
    },
  )
}

function buildLiquidSinkAgainst(sourceDevice: DeviceInstance, sourcePortId: string) {
  return placeTargetAfter(sourceDevice, sourcePortId, 'item_port_liquid_storager_1', 'in_w_1', {})
}

function runPipeRoundRobinScenario(): ScenarioResult {
  resetInstanceCounter()
  const converger = createDevice('item_pipe_converger', 0, { x: 20, y: 20 })
  const northPipe = placeSourceBefore(converger, 'in_n', 'pipe_straight_1x1', 'out_e')
  const northSource = placeSourceBefore(northPipe, 'in_w', 'item_port_liquid_storager_1', 'out_e_1', {
    storagePreloadInputs: [{ slotIndex: 0, itemId: WATER_ITEM_ID, amount: 20 }],
  })
  const eastPipe = placeSourceBefore(converger, 'in_e', 'pipe_straight_1x1', 'out_e')
  const eastSource = placeSourceBefore(eastPipe, 'in_w', 'item_port_liquid_storager_1', 'out_e_1', {
    storagePreloadInputs: [{ slotIndex: 0, itemId: WATER_ITEM_ID, amount: 20 }],
  })
  const outPipe = placeTargetAfter(converger, 'out_w', 'pipe_straight_1x1', 'in_w')
  const sink = buildLiquidSinkAgainst(outPipe, 'out_e')
  const layout = buildLayout([northSource, northPipe, eastSource, eastPipe, converger, outPipe, sink])
  const links = ensureConnected(layout, 6, 'pipe-round-robin')
  const sim = simulate(layout, 78)
  const northRemaining = storageAmount(sim, northSource.instanceId, WATER_ITEM_ID)
  const eastRemaining = storageAmount(sim, eastSource.instanceId, WATER_ITEM_ID)
  const sinkWater = storageAmount(sim, sink.instanceId, WATER_ITEM_ID)
  assert(sinkWater > 0, `pipe-round-robin 终点没有收到液体，north=${northRemaining}, east=${eastRemaining}, sink=${sinkWater}`)
  assert(Math.abs(northRemaining - eastRemaining) <= 1, `pipe-round-robin 同组轮询失效，north=${northRemaining}, east=${eastRemaining}, sink=${sinkWater}`)
  return {
    name: 'pipe-round-robin',
    summary: {
      links,
      northRemaining,
      eastRemaining,
      sinkWater,
    },
  }
}

function runReactorOutputMappingScenario(): ScenarioResult {
  resetInstanceCounter()
  const reactor = createDevice('item_port_mix_pool_1', 0, { x: 20, y: 20 }, {
    preloadInputs: [
      { slotIndex: 0, itemId: ORE_ITEM_ID, amount: 2 },
      { slotIndex: 1, itemId: WATER_ITEM_ID, amount: 2 },
    ],
    reactorPool: {
      solidOutputItemId: ORE_ITEM_ID,
      liquidOutputItemIdA: WATER_ITEM_ID,
      liquidOutputItemIdB: WATER_ITEM_ID,
    },
  })

  const solidTurnA = placeTargetAfter(reactor, 'out_n_1', 'belt_turn_cw_1x1', 'in_n')
  const solidTurnB = placeTargetAfter(reactor, 'out_n_3', 'belt_turn_ccw_1x1', 'in_n')
  const liquidTurnA = placeTargetAfter(reactor, 'out_w_1', 'pipe_turn_ccw_1x1', 'in_n')
  const liquidTurnB = placeTargetAfter(reactor, 'out_w_3', 'pipe_turn_cw_1x1', 'in_n')

  const layout = buildLayout([reactor, solidTurnA, solidTurnB, liquidTurnA, liquidTurnB])
  const links = ensureConnected(layout, 4, 'reactor-output-mapping')
  const sim = simulate(layout, 1)
  ensureNoHardBlock(sim, layout.devices.map((device) => device.instanceId), 'reactor-output-mapping')

  const solidAmountA = transportSlotItem(sim, solidTurnA.instanceId)
  const solidAmountB = transportSlotItem(sim, solidTurnB.instanceId)
  const liquidAmountA = transportSlotItem(sim, liquidTurnA.instanceId)
  const liquidAmountB = transportSlotItem(sim, liquidTurnB.instanceId)
  const reactorRuntime = sim.runtimeById[reactor.instanceId]
  const remainingOre = reactorRuntime && 'inputBuffer' in reactorRuntime ? (reactorRuntime.inputBuffer[ORE_ITEM_ID] ?? 0) : -1
  const remainingWater = reactorRuntime && 'inputBuffer' in reactorRuntime ? (reactorRuntime.inputBuffer[WATER_ITEM_ID] ?? 0) : -1

  assert(solidAmountA === ORE_ITEM_ID, `reactor-output-mapping 固体端口 A 没有收到目标物品，a=${String(solidAmountA)}, b=${String(solidAmountB)}`)
  assert(solidAmountB === ORE_ITEM_ID, `reactor-output-mapping 固体端口 B 没有收到目标物品，a=${String(solidAmountA)}, b=${String(solidAmountB)}`)
  assert(liquidAmountA === WATER_ITEM_ID, `reactor-output-mapping 液体端口 A 没有收到目标物品，a=${String(liquidAmountA)}, b=${String(liquidAmountB)}`)
  assert(liquidAmountB === WATER_ITEM_ID, `reactor-output-mapping 液体端口 B 没有收到目标物品，a=${String(liquidAmountA)}, b=${String(liquidAmountB)}`)
  assert(remainingOre === 0, `reactor-output-mapping 固体没有按两路同时扣减，remainingOre=${remainingOre}`)
  assert(remainingWater === 0, `reactor-output-mapping 液体没有按两路同时扣减，remainingWater=${remainingWater}`)

  return {
    name: 'reactor-output-mapping',
    summary: {
      links,
      solidAmountA,
      solidAmountB,
      liquidAmountA,
      liquidAmountB,
      remainingOre,
      remainingWater,
    },
  }
}

function runLiquidPurifierOutputMappingScenario(): ScenarioResult {
  const runCase = (
    caseName: string,
    inputItemId: ItemId,
    expectedLeftItemId: ItemId,
    expectedRightItemId: ItemId,
  ) => {
    return ROTATIONS.map((rotation) => {
      resetInstanceCounter()
      const purifier = createDevice('item_port_liquid_purifier_1', rotation, { x: 20, y: 20 }, {
        preloadInputs: [{ slotIndex: 0, itemId: inputItemId, amount: 4 }],
      })
      const pole = createDevice('item_port_power_diffuser_1', 0, { x: 21, y: 26 })

      const leftTurn = placeTargetAfter(purifier, 'out_n_1', 'pipe_turn_cw_1x1', 'in_n')
      const rightTurn = placeTargetAfter(purifier, 'out_n_3', 'pipe_turn_ccw_1x1', 'in_n')
      const leftPipe = placeTargetAfter(leftTurn, 'out_e', 'pipe_straight_1x1', 'in_w')
      const rightPipe = placeTargetAfter(rightTurn, 'out_w', 'pipe_straight_1x1', 'in_w')
      const leftSink = buildLiquidSinkAgainst(leftPipe, 'out_e')
      const rightSink = buildLiquidSinkAgainst(rightPipe, 'out_e')

      const layout = buildLayout([purifier, pole, leftTurn, rightTurn, leftPipe, rightPipe, leftSink, rightSink])
      const links = ensureConnected(layout, 6, `liquid-purifier-${caseName}-rot${rotation}`)
      const sim = simulate(layout, 200)
      ensureNoHardBlock(sim, layout.devices.map((device) => device.instanceId), `liquid-purifier-${caseName}-rot${rotation}`)

      const leftExpectedAmount = storageAmount(sim, leftSink.instanceId, expectedLeftItemId)
      const rightExpectedAmount = storageAmount(sim, rightSink.instanceId, expectedRightItemId)
      const leftUnexpectedAmount = storageAmount(sim, leftSink.instanceId, expectedRightItemId)
      const rightUnexpectedAmount = storageAmount(sim, rightSink.instanceId, expectedLeftItemId)
      const purifierRuntime = sim.runtimeById[purifier.instanceId]
      const remainingInput = purifierRuntime && 'inputBuffer' in purifierRuntime ? (purifierRuntime.inputBuffer[inputItemId] ?? 0) : -1

      assert(leftExpectedAmount === 1, `liquid-purifier-${caseName}-rot${rotation} 左侧储液罐没有收到液体A，actual=${leftExpectedAmount}`)
      assert(rightExpectedAmount === 1, `liquid-purifier-${caseName}-rot${rotation} 右侧储液罐没有收到液体B，actual=${rightExpectedAmount}`)
      assert(leftUnexpectedAmount === 0, `liquid-purifier-${caseName}-rot${rotation} 左侧储液罐错误收到了液体B，actual=${leftUnexpectedAmount}`)
      assert(rightUnexpectedAmount === 0, `liquid-purifier-${caseName}-rot${rotation} 右侧储液罐错误收到了液体A，actual=${rightUnexpectedAmount}`)
      assert(remainingInput === 0, `liquid-purifier-${caseName}-rot${rotation} 输入液体没有按配方正确消耗，remaining=${remainingInput}`)

      return {
        rotation,
        links,
        leftExpectedAmount,
        rightExpectedAmount,
        leftUnexpectedAmount,
        rightUnexpectedAmount,
        remainingInput,
      }
    })
  }

  return {
    name: 'liquid-purifier-output-mapping',
    summary: {
      lowpoly: JSON.stringify(
        runCase(
          'lowpoly',
          'item_liquid_xiranite_lowpoly',
          'item_liquid_water',
          'item_liquid_xiranite_poly',
        ),
      ),
      copper: JSON.stringify(
        runCase(
          'copper',
          'item_liquid_copper',
          'item_liquid_acid',
          'item_liquid_copper_enr',
        ),
      ),
    },
  }
}

function runPowerAllStopScenario(): ScenarioResult {
  resetInstanceCounter()
  const heatPool = createDevice('item_port_power_sta_1', 0, { x: 24, y: 20 }, {
    preloadInputItemId: ORE_ITEM_ID,
    preloadInputAmount: 1,
  })
  const pole = createDevice('item_port_power_diffuser_1', 0, { x: 20, y: 16 })
  const topMachine = createDevice('item_port_thickener_1', 0, { x: 16, y: 12 })
  const bottomMachine = createDevice('item_port_thickener_1', 0, { x: 16, y: 18 })
  const layout = buildLayout([heatPool, pole, topMachine, bottomMachine])
  const sim = simulateReal(layout, 5, 0)
  const topRuntime = sim.runtimeById[topMachine.instanceId]
  const bottomRuntime = sim.runtimeById[bottomMachine.instanceId]
  const heatRuntime = sim.runtimeById[heatPool.instanceId]
  assert(topRuntime, 'power-all-stop 缺少 top runtime')
  assert(bottomRuntime, 'power-all-stop 缺少 bottom runtime')
  assert(heatRuntime && 'activeRecipeId' in heatRuntime, 'power-all-stop 缺少 heat runtime')
  assert(sim.powerStats.totalSupplyKw === 50, `power-all-stop 供电异常，expected=50 actual=${sim.powerStats.totalSupplyKw}`)
  assert(sim.powerStats.totalDemandKw === 100, `power-all-stop 耗电异常，expected=100 actual=${sim.powerStats.totalDemandKw}`)
  assert(sim.powerStats.batteryStoredJ === 0, `power-all-stop 电池不应有余量，actual=${sim.powerStats.batteryStoredJ}`)
  assert(topRuntime.stallReason === 'LOW_POWER', `power-all-stop 顶部设备未统一停机，actual=${topRuntime.stallReason}`)
  assert(bottomRuntime.stallReason === 'LOW_POWER', `power-all-stop 底部设备未统一停机，actual=${bottomRuntime.stallReason}`)
  assert(heatRuntime.activeRecipeId, 'power-all-stop 发电站没有启动燃料配方')
  return {
    name: 'power-all-stop',
    summary: {
      totalSupplyKw: sim.powerStats.totalSupplyKw,
      totalDemandKw: sim.powerStats.totalDemandKw,
      batteryStoredJ: sim.powerStats.batteryStoredJ,
      topStall: topRuntime.stallReason,
      bottomStall: bottomRuntime.stallReason,
    },
  }
}

function main() {
  const scenarioFilter = process.argv[2] ?? 'all'
  const scenarioEntries: Array<[string, () => ScenarioResult]> = [
    ['direct', runDirectScenario],
    ['junction', runJunctionScenario],
    ['bridge', runBridgeScenario],
    ['storage', runStorageScenario],
    ['storage-warehouse-submit', runStorageWarehouseSubmitScenario],
    ['admission', runAdmissionScenario],
    ['belt-chain', runBeltChainScenario],
    ['pipe-round-robin', runPipeRoundRobinScenario],
    ['reactor-output-mapping', runReactorOutputMappingScenario],
    ['liquid-purifier-output-mapping', runLiquidPurifierOutputMappingScenario],
    ['power-all-stop', runPowerAllStopScenario],
  ]

  const results = scenarioEntries
    .filter(([name]) => scenarioFilter === 'all' || scenarioFilter === name)
    .map(([, runner]) => runner())

  for (const result of results) {
    console.log(`${result.name}: ${JSON.stringify(result.summary)}`)
  }
}

main()