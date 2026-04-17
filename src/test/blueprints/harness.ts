import fs from 'node:fs'
import path from 'node:path'

import { sanitizeLayoutLinks } from '../../domain/deviceLinks.ts'
import { detectOverlaps, getRotatedPorts, OPPOSITE_EDGE } from '../../domain/geometry.ts'
import { validatePlacementConstraints } from '../../domain/placement.ts'
import { BASE_BY_ID } from '../../domain/registry.ts'
import { isDeviceWithinAllowedPlacementArea } from '../../domain/shared/placementArea.ts'
import type {
  BaseId,
  DeviceInstance,
  DeviceLink,
  DeviceTypeId,
  Edge,
  ItemId,
  LayoutState,
  PowerMode,
  Rotation,
  SimState,
} from '../../domain/types.ts'
import { createInitialSimState, initialStorageConfig, startSimulation, tickSimulation } from '../../sim/engine.ts'

export type BlueprintDeviceSnapshot = {
  blueprintInstanceId?: string
  typeId: DeviceTypeId
  rotation: Rotation
  origin: { x: number; y: number }
  config?: DeviceInstance['config']
}

type BlueprintDeviceLink = {
  kind: 'dark_pipe'
  sourceBlueprintInstanceId: string
  targetBlueprintInstanceId: string
}

type BlueprintSnapshot = {
  name: string
  baseId: BaseId
  devices: BlueprintDeviceSnapshot[]
  links?: BlueprintDeviceLink[]
}

export type BlueprintDeviceRef = {
  blueprintInstanceId?: string
  typeId?: DeviceTypeId
  rotation?: Rotation
  origin?: { x: number; y: number }
}

export type BlueprintExtensionDevice = {
  id: string
  typeId: DeviceTypeId
  config?: DeviceInstance['config']
  placement:
    | {
        mode: 'absolute'
        origin: { x: number; y: number }
        rotation: Rotation
      }
    | {
        mode: 'source_before'
        target: BlueprintDeviceRef
        targetPortId: string
        sourcePortId: string
      }
    | {
        mode: 'target_after'
        source: BlueprintDeviceRef
        sourcePortId: string
        targetPortId: string
      }
}

export type BlueprintCase = {
  id: string
  blueprintPath: string
  simulation?: {
    powerMode?: PowerMode
    initialBatteryPercent?: number
    powerDemandOverrideKw?: number | null
  }
  throughput?: {
    targetItemId: ItemId
    requiredPerMinute: number
    warmupSeconds: number
    stabilitySeconds: number
  }
  overflowBehavior?: {
    sampleIntervalSeconds?: number
    durationSeconds: number
    upperStorage: {
      device: BlueprintDeviceRef
      itemId: ItemId
    }
    lowerStorage: {
      device: BlueprintDeviceRef
      itemId: ItemId
    }
  }
  powerObservation?: {
    anchor?: 'sim_start' | 'first_battery_drop'
    durationSeconds: number
    averagingWindowSeconds: number
    expectedDemandKw?: number
    triggerTimeoutSeconds?: number
  }
  extensionDevices?: BlueprintExtensionDevice[]
  expectedExtensionCount?: number
}

export type RegisteredBlueprintCase = BlueprintCase & {
  sourceName: string
  sourcePath: string
}

type ThroughputSample = {
  second: number
  producedPerMinute: number
  everProduced: number
}

type OverflowSample = {
  second: number
  upperAmount: number
  lowerAmount: number
}

type WindowSummary = {
  sampleCount: number
  minProducedPerMinute: number
  maxProducedPerMinute: number
  producedDelta: number
  averagePerMinute: number
  firstSecond: number
  lastSecond: number
}

type PlacementResult = {
  layout: LayoutState
  blueprintDevices: DeviceInstance[]
  offsetX: number
  offsetY: number
  extensionDeviceIds: string[]
}

type PowerWindowSummary = {
  index: number
  elapsedSinceFirstDropSeconds: number
  totalSimSeconds: number
  zeroBatteryRatio: number
  zeroBatterySeconds: number
  fullBatteryRatio: number
  fullBatterySeconds: number
  averageSupplyKw: number
  averageDemandKw: number
}

type PowerObservationSummary = {
  anchor: 'sim_start' | 'first_battery_drop'
  firstBatteryDropSecond: number | null
  triggerWaitSeconds: number | null
  observedDurationSeconds: number
  totalSimSeconds: number
  zeroBatteryOverallRatio: number
  zeroBatteryOverallSeconds: number
  fullBatteryOverallRatio: number
  fullBatteryOverallSeconds: number
  longestZeroBatteryStreakSeconds: number
  averageSupplyKw: number
  averageDemandKw: number
  minBatteryPercent: number
  maxBatteryPercent: number
  finalSupplyKw: number
  finalDemandKw: number
  finalBatteryPercent: number
  finalBatteryStoredJ: number
  windows: PowerWindowSummary[]
}

export type BlueprintRunProgress = {
  caseId: string
  simTick: number
  simSeconds: number
  targetEndTick: number
  targetEndSeconds: number
  firstBatteryDropTick: number | null
  phase: 'running' | 'waiting_first_battery_drop' | 'observing_power_window'
  batteryPercent: number
  totalSupplyKw: number
  totalDemandKw: number
  wallElapsedMs: number
}

type RunBlueprintCaseOptions = {
  onProgress?: (progress: BlueprintRunProgress) => void
}

const ROTATIONS: Rotation[] = [0, 90, 180, 270]
const BATTERY_CAPACITY_J = 100_000_000
const EDGE_DELTA: Record<Edge, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 },
}
const SAMPLE_INTERVAL_SECONDS = 10
const PROGRESS_REPORT_INTERVAL_MS = 5_000
export const BLUEPRINT_ROOT = path.resolve(process.cwd(), 'public/blueprints')

export function blueprintFile(fileName: string) {
  return path.join(BLUEPRINT_ROOT, fileName)
}

export function registerBlueprintCase(sourceName: string, testCase: BlueprintCase): RegisteredBlueprintCase {
  return {
    ...testCase,
    sourceName,
    sourcePath: path.posix.join('src/test/blueprints/cases', sourceName),
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function createDevice(
  typeId: DeviceTypeId,
  rotation: Rotation,
  origin: { x: number; y: number },
  config: DeviceInstance['config'] = {},
  instanceId?: string,
): DeviceInstance {
  return {
    instanceId: instanceId ?? `${typeId}-${origin.x}-${origin.y}`,
    typeId,
    rotation,
    origin,
    config,
  }
}

function getPort(device: DeviceInstance, portId: string) {
  const port = getRotatedPorts(device).find((entry) => entry.portId === portId)
  assert(port, `未找到端口 ${device.instanceId}:${portId}`)
  return port
}

function rotationForPortEdge(typeId: DeviceTypeId, portId: string, desiredEdge: Edge) {
  const rotation = ROTATIONS.find((candidateRotation) => {
    const probe = createDevice(typeId, candidateRotation, { x: 0, y: 0 }, {}, `probe-${typeId}-${candidateRotation}`)
    return getPort(probe, portId).edge === desiredEdge
  })
  assert(rotation !== undefined, `找不到 ${typeId}:${portId} 朝向 ${desiredEdge} 的旋转`)
  return rotation
}

function placeSourceBefore(
  targetDevice: DeviceInstance,
  targetPortId: string,
  sourceTypeId: DeviceTypeId,
  sourcePortId: string,
  sourceConfig: DeviceInstance['config'] = {},
  instanceId?: string,
) {
  const targetPort = getPort(targetDevice, targetPortId)
  const desiredSourceEdge = OPPOSITE_EDGE[targetPort.edge]
  const sourceRotation = rotationForPortEdge(sourceTypeId, sourcePortId, desiredSourceEdge)
  const sourceProbe = createDevice(sourceTypeId, sourceRotation, { x: 0, y: 0 }, sourceConfig, `probe-${sourceTypeId}-${sourceRotation}`)
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

function placeTargetAfter(
  sourceDevice: DeviceInstance,
  sourcePortId: string,
  targetTypeId: DeviceTypeId,
  targetPortId: string,
  targetConfig: DeviceInstance['config'] = {},
  instanceId?: string,
) {
  const sourcePort = getPort(sourceDevice, sourcePortId)
  const desiredTargetEdge = OPPOSITE_EDGE[sourcePort.edge]
  const targetRotation = rotationForPortEdge(targetTypeId, targetPortId, desiredTargetEdge)
  const targetProbe = createDevice(targetTypeId, targetRotation, { x: 0, y: 0 }, targetConfig, `probe-${targetTypeId}-${targetRotation}`)
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

function readBlueprint(filePath: string): BlueprintSnapshot {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as BlueprintSnapshot
  assert(raw && typeof raw === 'object', '蓝图文件不是有效对象')
  assert(typeof raw.baseId === 'string' && raw.baseId in BASE_BY_ID, `未知基地: ${String(raw.baseId)}`)
  assert(Array.isArray(raw.devices) && raw.devices.length > 0, '蓝图没有设备')
  return raw
}

function buildFoundationDevices(baseId: BaseId) {
  const base = BASE_BY_ID[baseId]
  return base.foundationBuildings.map((building) => ({
    ...building,
    config: building.config ?? initialStorageConfig(building.typeId),
  }))
}

function buildPlacedBlueprintDevices(snapshot: BlueprintSnapshot, offsetX: number, offsetY: number) {
  return snapshot.devices.map((device, index) => ({
    instanceId: device.blueprintInstanceId ?? `bp-device-${index}`,
    typeId: device.typeId,
    rotation: device.rotation,
    origin: {
      x: device.origin.x + offsetX,
      y: device.origin.y + offsetY,
    },
    config: device.config ?? {},
  }))
}

function matchesBlueprintDeviceRef(device: BlueprintDeviceSnapshot, ref: BlueprintDeviceRef) {
  if (ref.blueprintInstanceId && device.blueprintInstanceId !== ref.blueprintInstanceId) return false
  if (ref.typeId && device.typeId !== ref.typeId) return false
  if (typeof ref.rotation === 'number' && device.rotation !== ref.rotation) return false
  if (ref.origin && (device.origin.x !== ref.origin.x || device.origin.y !== ref.origin.y)) return false
  return true
}

function resolvePlacedBlueprintDevice(
  snapshot: BlueprintSnapshot,
  placedBlueprintDevices: DeviceInstance[],
  ref: BlueprintDeviceRef,
) {
  const matches = snapshot.devices.flatMap((device, index) =>
    matchesBlueprintDeviceRef(device, ref) ? [placedBlueprintDevices[index]] : [],
  )
  assert(matches.length === 1, `扩展设备锚点匹配失败，expected=1 actual=${matches.length}`)
  return matches[0]
}

function buildPlacedExtensionDevices(
  snapshot: BlueprintSnapshot,
  placedBlueprintDevices: DeviceInstance[],
  offsetX: number,
  offsetY: number,
  extensionDevices: BlueprintExtensionDevice[] = [],
) {
  return extensionDevices.map((extension) => {
    const instanceId = `bp-ext-${extension.id}`
    if (extension.placement.mode === 'absolute') {
      return createDevice(
        extension.typeId,
        extension.placement.rotation,
        {
          x: extension.placement.origin.x + offsetX,
          y: extension.placement.origin.y + offsetY,
        },
        extension.config ?? {},
        instanceId,
      )
    }

    if (extension.placement.mode === 'source_before') {
      const targetDevice = resolvePlacedBlueprintDevice(snapshot, placedBlueprintDevices, extension.placement.target)
      return placeSourceBefore(
        targetDevice,
        extension.placement.targetPortId,
        extension.typeId,
        extension.placement.sourcePortId,
        extension.config ?? {},
        instanceId,
      )
    }

    const sourceDevice = resolvePlacedBlueprintDevice(snapshot, placedBlueprintDevices, extension.placement.source)
    return placeTargetAfter(
      sourceDevice,
      extension.placement.sourcePortId,
      extension.typeId,
      extension.placement.targetPortId,
      extension.config ?? {},
      instanceId,
    )
  })
}

function buildLinks(snapshot: BlueprintSnapshot, blueprintDevices: DeviceInstance[], allDevices: DeviceInstance[]): DeviceLink[] {
  const deviceIdMap = new Map(
    snapshot.devices.map((device, index) => [device.blueprintInstanceId ?? `bp-device-${index}`, blueprintDevices[index].instanceId]),
  )
  const rawLinks = (snapshot.links ?? []).map((link, index) => ({
    linkId: `bp-link-${index}`,
    kind: link.kind,
    sourceInstanceId: deviceIdMap.get(link.sourceBlueprintInstanceId) ?? '',
    targetInstanceId: deviceIdMap.get(link.targetBlueprintInstanceId) ?? '',
  }))
  return sanitizeLayoutLinks(rawLinks, allDevices)
}

function isValidPlacement(
  baseId: BaseId,
  lotSize: number,
  foundationDevices: DeviceInstance[],
  blueprintDevices: DeviceInstance[],
  links: DeviceLink[],
) {
  const base = BASE_BY_ID[baseId]
  const devices = [...foundationDevices, ...blueprintDevices]
  const layout: LayoutState = {
    baseId,
    lotSize,
    devices,
    links,
  }

  if (detectOverlaps(layout).size > 0) return false

  for (const device of blueprintDevices) {
    if (!isDeviceWithinAllowedPlacementArea(device, lotSize, base.outerRing)) return false
    if (!validatePlacementConstraints(layout, device).isValid) return false
  }

  return true
}

function findPlacement(snapshot: BlueprintSnapshot, testCase: BlueprintCase): PlacementResult {
  const base = BASE_BY_ID[snapshot.baseId]
  const foundationDevices = buildFoundationDevices(snapshot.baseId)

  for (let offsetY = -base.outerRing.top; offsetY < base.placeableSize + base.outerRing.bottom; offsetY += 1) {
    for (let offsetX = -base.outerRing.left; offsetX < base.placeableSize + base.outerRing.right; offsetX += 1) {
      const placedBlueprintDevices = buildPlacedBlueprintDevices(snapshot, offsetX, offsetY)
      const extensionDevices = buildPlacedExtensionDevices(
        snapshot,
        placedBlueprintDevices,
        offsetX,
        offsetY,
        testCase.extensionDevices,
      )
      const scenarioDevices = [...placedBlueprintDevices, ...extensionDevices]
      const mergedDevices = [...foundationDevices, ...scenarioDevices]
      const links = buildLinks(snapshot, placedBlueprintDevices, mergedDevices)
      if (!isValidPlacement(snapshot.baseId, base.placeableSize, foundationDevices, scenarioDevices, links)) continue

      return {
        layout: {
          baseId: snapshot.baseId,
          lotSize: base.placeableSize,
          devices: mergedDevices,
          links,
        },
        blueprintDevices: placedBlueprintDevices,
        offsetX,
        offsetY,
        extensionDeviceIds: extensionDevices.map((device) => device.instanceId),
      }
    }
  }

  throw new Error(`没有找到可合法放置蓝图的位置: ${snapshot.name}`)
}

function targetEverProduced(sim: SimState, targetItemId: ItemId) {
  return sim.stats.everProduced[targetItemId] ?? 0
}

function targetProducedPerMinute(sim: SimState, targetItemId: ItemId) {
  return sim.stats.producedPerMinute[targetItemId] ?? 0
}

function storageAmount(sim: SimState, instanceId: string, itemId: ItemId) {
  const runtime = sim.runtimeById[instanceId]
  assert(runtime, `未找到设备运行时: ${instanceId}`)
  assert('inventory' in runtime, `设备不是仓储类型，无法读取库存: ${instanceId}`)
  return runtime.inventory[itemId] ?? 0
}

function summarizeWindow(samples: ThroughputSample[], startSecond: number, endSecond: number): WindowSummary {
  const windowSamples = samples.filter((sample) => sample.second >= startSecond && sample.second <= endSecond)
  assert(windowSamples.length > 0, `窗口 ${startSecond}-${endSecond}s 没有采样结果`)
  const minProducedPerMinute = Math.min(...windowSamples.map((sample) => sample.producedPerMinute))
  const maxProducedPerMinute = Math.max(...windowSamples.map((sample) => sample.producedPerMinute))
  const first = windowSamples[0]
  const last = windowSamples[windowSamples.length - 1]
  const elapsedMinutes = (last.second - first.second) / 60
  const producedDelta = last.everProduced - first.everProduced
  const averagePerMinute = elapsedMinutes > 0 ? producedDelta / elapsedMinutes : 0
  return {
    sampleCount: windowSamples.length,
    minProducedPerMinute,
    maxProducedPerMinute,
    producedDelta,
    averagePerMinute,
    firstSecond: first.second,
    lastSecond: last.second,
  }
}

function validateThroughputExpectation(testCase: BlueprintCase, samples: ThroughputSample[]) {
  const expectation = testCase.throughput
  assert(expectation, `${testCase.id} 缺少吞吐断言配置`)
  const totalSeconds = expectation.warmupSeconds + expectation.stabilitySeconds
  const stableWindow = summarizeWindow(samples, expectation.warmupSeconds, totalSeconds)
  const stableEnough =
    stableWindow.minProducedPerMinute >= expectation.requiredPerMinute &&
    stableWindow.maxProducedPerMinute === stableWindow.minProducedPerMinute &&
    stableWindow.averagePerMinute >= expectation.requiredPerMinute

  assert(
    stableEnough,
    `${testCase.id} 稳态吞吐不达标，required=${expectation.requiredPerMinute}, min=${stableWindow.minProducedPerMinute}, max=${stableWindow.maxProducedPerMinute}, avg=${stableWindow.averagePerMinute}`,
  )

  const lastSample = samples[samples.length - 1]
  assert(lastSample, `${testCase.id} 没有吞吐采样数据`)

  return {
    targetItemId: expectation.targetItemId,
    stableWindow,
    endState: {
      simSeconds: lastSample.second,
      producedPerMinute: lastSample.producedPerMinute,
      everProduced: lastSample.everProduced,
    },
  }
}

function validateOverflowBehavior(testCase: BlueprintCase, samples: OverflowSample[]) {
  const expectation = testCase.overflowBehavior
  assert(expectation, `${testCase.id} 缺少溢流断言配置`)
  assert(samples.length > 0, `${testCase.id} 没有溢流采样数据`)

  const firstUpperPositiveIndex = samples.findIndex((sample) => sample.upperAmount > 0)
  const firstLowerPositiveIndex = samples.findIndex((sample) => sample.lowerAmount > 0)
  const maxUpperAmount = Math.max(...samples.map((sample) => sample.upperAmount))

  assert(firstUpperPositiveIndex >= 0, `${testCase.id} 上方储液罐在观察窗口内从未收到液体`)
  assert(firstLowerPositiveIndex >= 0, `${testCase.id} 下方储液罐在观察窗口内从未收到液体`)
  assert(firstLowerPositiveIndex > firstUpperPositiveIndex, `${testCase.id} 下方储液罐进液早于上方储液罐蓄满过程`)

  for (let index = 0; index < firstLowerPositiveIndex; index += 1) {
    assert(samples[index].lowerAmount === 0, `${testCase.id} 下方储液罐在上方未满前提前进液，second=${samples[index].second}, lower=${samples[index].lowerAmount}`)
  }

  for (let index = firstUpperPositiveIndex + 1; index <= firstLowerPositiveIndex; index += 1) {
    const previous = samples[index - 1]
    const current = samples[index]
    assert(
      current.upperAmount >= previous.upperAmount,
      `${testCase.id} 上方储液罐在溢流前不应回落，second=${current.second}, prev=${previous.upperAmount}, current=${current.upperAmount}`,
    )
  }

  const overflowSample = samples[firstLowerPositiveIndex]
  const preOverflowUpperAmount = firstLowerPositiveIndex > 0
    ? samples[firstLowerPositiveIndex - 1].upperAmount
    : overflowSample.upperAmount

  assert(
    overflowSample.upperAmount === maxUpperAmount || preOverflowUpperAmount === maxUpperAmount,
    `${testCase.id} 下方储液罐开始进液时上方储液罐尚未满，upperBefore=${preOverflowUpperAmount}, upperAt=${overflowSample.upperAmount}, upperMax=${maxUpperAmount}, lowerAt=${overflowSample.lowerAmount}, second=${overflowSample.second}`,
  )

  const lastSample = samples[samples.length - 1]
  assert(lastSample.lowerAmount > 0, `${testCase.id} 下方储液罐最终仍然为空`)

  return {
    firstUpperPositiveSecond: samples[firstUpperPositiveIndex].second,
    firstLowerPositiveSecond: overflowSample.second,
    upperAmountAtOverflow: overflowSample.upperAmount,
    upperCapacityObserved: maxUpperAmount,
    lowerAmountAtOverflow: overflowSample.lowerAmount,
    finalUpperAmount: lastSample.upperAmount,
    finalLowerAmount: lastSample.lowerAmount,
  }
}

function validatePowerObservation(summary: PowerObservationSummary) {
  assert(Number.isFinite(summary.averageSupplyKw), '平均供电结果不是有限值')
  assert(Number.isFinite(summary.averageDemandKw), '平均耗电结果不是有限值')
  return summary
}

function buildPowerObservationSummary(
  testCase: BlueprintCase,
  observationStartTick: number,
  observationEndTickExclusive: number,
  firstBatteryDropTick: number | null,
  totalObservedTicks: number,
  totalZeroBatteryTicks: number,
  totalFullBatteryTicks: number,
  longestZeroBatteryStreakTicks: number,
  totalObservedSupplyKw: number,
  totalObservedDemandKw: number,
  minBatteryPercent: number,
  maxBatteryPercent: number,
  finalSim: SimState,
  windowTickCount: number,
  powerWindowAccumulators: Array<{
    tickCount: number
    zeroBatteryTickCount: number
    fullBatteryTickCount: number
    supplyKwSum: number
    demandKwSum: number
  }>,
): PowerObservationSummary {
  const observation = testCase.powerObservation
  assert(observation, `${testCase.id} 缺少电力观测配置`)
  assert(totalObservedTicks > 0, `${testCase.id} 没有电力观测数据`)

  const tickRateHz = finalSim.tickRateHz
  const windows = powerWindowAccumulators.flatMap((window, index) => {
    if (window.tickCount <= 0) return []
    return [{
      index: index + 1,
      elapsedSinceFirstDropSeconds: ((index + 1) * windowTickCount) / tickRateHz,
      totalSimSeconds: (observationStartTick + (index + 1) * windowTickCount) / tickRateHz,
      zeroBatteryRatio: window.zeroBatteryTickCount / window.tickCount,
      zeroBatterySeconds: window.zeroBatteryTickCount / tickRateHz,
      fullBatteryRatio: window.fullBatteryTickCount / window.tickCount,
      fullBatterySeconds: window.fullBatteryTickCount / tickRateHz,
      averageSupplyKw: window.supplyKwSum / window.tickCount,
      averageDemandKw: window.demandKwSum / window.tickCount,
    } satisfies PowerWindowSummary]
  })

  return {
    anchor: observation.anchor ?? 'sim_start',
    firstBatteryDropSecond: firstBatteryDropTick === null ? null : firstBatteryDropTick / tickRateHz,
    triggerWaitSeconds: firstBatteryDropTick === null ? null : (firstBatteryDropTick - 1) / tickRateHz,
    observedDurationSeconds: (observationEndTickExclusive - observationStartTick) / tickRateHz,
    totalSimSeconds: finalSim.stats.simSeconds,
    zeroBatteryOverallRatio: totalZeroBatteryTicks / totalObservedTicks,
    zeroBatteryOverallSeconds: totalZeroBatteryTicks / tickRateHz,
    fullBatteryOverallRatio: totalFullBatteryTicks / totalObservedTicks,
    fullBatteryOverallSeconds: totalFullBatteryTicks / tickRateHz,
    longestZeroBatteryStreakSeconds: longestZeroBatteryStreakTicks / tickRateHz,
    averageSupplyKw: totalObservedSupplyKw / totalObservedTicks,
    averageDemandKw: totalObservedDemandKw / totalObservedTicks,
    minBatteryPercent,
    maxBatteryPercent,
    finalSupplyKw: finalSim.powerStats.totalSupplyKw,
    finalDemandKw: finalSim.powerStats.totalDemandKw,
    finalBatteryPercent: finalSim.powerStats.batteryPercent,
    finalBatteryStoredJ: finalSim.powerStats.batteryStoredJ,
    windows,
  }
}

export function runBlueprintCase(testCase: BlueprintCase, options: RunBlueprintCaseOptions = {}) {
  const snapshot = readBlueprint(testCase.blueprintPath)
  const placement = findPlacement(snapshot, testCase)

  if (typeof testCase.expectedExtensionCount === 'number') {
    assert(
      placement.extensionDeviceIds.length === testCase.expectedExtensionCount,
      `${testCase.id} 扩展设备数量不正确，expected=${testCase.expectedExtensionCount} actual=${placement.extensionDeviceIds.length}`,
    )
  }

  const throughputDurationSeconds = testCase.throughput
    ? testCase.throughput.warmupSeconds + testCase.throughput.stabilitySeconds
    : 0
  const overflowDurationSeconds = testCase.overflowBehavior?.durationSeconds ?? 0
  const powerObservation = testCase.powerObservation
  const tickRateHz = createInitialSimState().tickRateHz
  const throughputTotalTicks = throughputDurationSeconds * tickRateHz
  const overflowTotalTicks = overflowDurationSeconds * tickRateHz
  const powerDurationTicks = (powerObservation?.durationSeconds ?? 0) * tickRateHz
  const powerWindowTicks = (powerObservation?.averagingWindowSeconds ?? 0) * tickRateHz
  const powerTriggerTimeoutTicks = (powerObservation?.triggerTimeoutSeconds ?? powerObservation?.durationSeconds ?? 0) * tickRateHz
  let targetEndTick = Math.max(throughputTotalTicks, overflowTotalTicks)
  if (powerObservation && (powerObservation.anchor ?? 'sim_start') === 'sim_start') {
    targetEndTick = Math.max(targetEndTick, powerDurationTicks)
  }
  if (powerObservation && (powerObservation.anchor ?? 'sim_start') === 'first_battery_drop') {
    targetEndTick = Math.max(targetEndTick, powerTriggerTimeoutTicks)
  }
  assert(targetEndTick > 0 || powerObservation, `${testCase.id} 至少需要一种断言配置`)

  const powerMode = testCase.simulation?.powerMode ?? 'infinite'
  const initialBatteryPercent = testCase.simulation?.initialBatteryPercent ?? 100
  const powerDemandOverrideKw = testCase.simulation?.powerDemandOverrideKw ?? null
  let sim = startSimulation(placement.layout, createInitialSimState(), powerMode, initialBatteryPercent, powerDemandOverrideKw)
  const throughputSampleIntervalTicks = SAMPLE_INTERVAL_SECONDS * sim.tickRateHz
  const overflowSampleIntervalTicks = (testCase.overflowBehavior?.sampleIntervalSeconds ?? 1) * sim.tickRateHz
  const throughputSamples: ThroughputSample[] = []

  const upperStorageDeviceId = testCase.overflowBehavior
    ? resolvePlacedBlueprintDevice(snapshot, placement.blueprintDevices, testCase.overflowBehavior.upperStorage.device).instanceId
    : null
  const lowerStorageDeviceId = testCase.overflowBehavior
    ? resolvePlacedBlueprintDevice(snapshot, placement.blueprintDevices, testCase.overflowBehavior.lowerStorage.device).instanceId
    : null
  const overflowSamples: OverflowSample[] = []
  const powerObservationAnchor = powerObservation?.anchor ?? 'sim_start'
  let powerObservationStartTick = powerObservationAnchor === 'sim_start' && powerObservation ? 1 : null
  let powerObservationEndTickExclusive = powerObservationAnchor === 'sim_start' && powerObservation
    ? 1 + powerDurationTicks
    : null
  let firstBatteryDropTick: number | null = null
  let totalObservedPowerTicks = 0
  let totalZeroBatteryTicks = 0
  let totalFullBatteryTicks = 0
  let currentZeroBatteryStreakTicks = 0
  let longestZeroBatteryStreakTicks = 0
  let totalObservedSupplyKw = 0
  let totalObservedDemandKw = 0
  let minObservedBatteryPercent = Number.POSITIVE_INFINITY
  let maxObservedBatteryPercent = Number.NEGATIVE_INFINITY
  const powerWindowAccumulators = powerObservation && powerWindowTicks > 0
    ? Array.from({ length: Math.ceil(powerDurationTicks / powerWindowTicks) }, () => ({
        tickCount: 0,
        zeroBatteryTickCount: 0,
        fullBatteryTickCount: 0,
        supplyKwSum: 0,
        demandKwSum: 0,
      }))
    : []
  const runStartedAtMs = Date.now()
  let lastProgressReportAtMs = runStartedAtMs

  while (sim.tick < targetEndTick) {
    const previousBatteryStoredJ = sim.powerStats.batteryStoredJ
    sim = tickSimulation(placement.layout, sim)

    if (testCase.throughput && sim.tick % throughputSampleIntervalTicks === 0) {
      throughputSamples.push({
        second: sim.stats.simSeconds,
        producedPerMinute: targetProducedPerMinute(sim, testCase.throughput.targetItemId),
        everProduced: targetEverProduced(sim, testCase.throughput.targetItemId),
      })
    }

    if (testCase.overflowBehavior && sim.tick % overflowSampleIntervalTicks === 0) {
      assert(upperStorageDeviceId && lowerStorageDeviceId, `${testCase.id} 溢流监测设备未解析成功`)
      overflowSamples.push({
        second: sim.stats.simSeconds,
        upperAmount: storageAmount(sim, upperStorageDeviceId, testCase.overflowBehavior.upperStorage.itemId),
        lowerAmount: storageAmount(sim, lowerStorageDeviceId, testCase.overflowBehavior.lowerStorage.itemId),
      })
    }

    if (
      powerObservation &&
      powerObservationAnchor === 'first_battery_drop' &&
      powerObservationStartTick === null &&
      sim.powerStats.batteryStoredJ < previousBatteryStoredJ
    ) {
      firstBatteryDropTick = sim.tick
      powerObservationStartTick = sim.tick
      powerObservationEndTickExclusive = sim.tick + powerDurationTicks
      targetEndTick = Math.max(targetEndTick, powerObservationEndTickExclusive)
    }

    const now = Date.now()
    if (options.onProgress && now - lastProgressReportAtMs >= PROGRESS_REPORT_INTERVAL_MS) {
      const phase: BlueprintRunProgress['phase'] =
        powerObservation && powerObservationAnchor === 'first_battery_drop' && firstBatteryDropTick === null
          ? 'waiting_first_battery_drop'
          : powerObservation && powerObservationStartTick !== null && powerObservationEndTickExclusive !== null && sim.tick < powerObservationEndTickExclusive
            ? 'observing_power_window'
            : 'running'
      options.onProgress({
        caseId: testCase.id,
        simTick: sim.tick,
        simSeconds: sim.stats.simSeconds,
        targetEndTick,
        targetEndSeconds: targetEndTick / sim.tickRateHz,
        firstBatteryDropTick,
        phase,
        batteryPercent: sim.powerStats.batteryPercent,
        totalSupplyKw: sim.powerStats.totalSupplyKw,
        totalDemandKw: sim.powerStats.totalDemandKw,
        wallElapsedMs: now - runStartedAtMs,
      })
      lastProgressReportAtMs = now
    }

    if (
      powerObservation &&
      powerObservationStartTick !== null &&
      powerObservationEndTickExclusive !== null &&
      sim.tick >= powerObservationStartTick &&
      sim.tick < powerObservationEndTickExclusive
    ) {
      if (typeof powerObservation.expectedDemandKw === 'number') {
        assert(
          sim.powerStats.totalDemandKw === powerObservation.expectedDemandKw,
          `${testCase.id} 观测窗口内负载不是期望值，second=${sim.stats.simSeconds}, expected=${powerObservation.expectedDemandKw}, actual=${sim.powerStats.totalDemandKw}`,
        )
      }

      const batteryIsEmpty = sim.powerStats.batteryStoredJ <= 0
      const batteryIsFull = sim.powerStats.batteryStoredJ >= BATTERY_CAPACITY_J
      totalObservedPowerTicks += 1
      totalObservedSupplyKw += sim.powerStats.totalSupplyKw
      totalObservedDemandKw += sim.powerStats.totalDemandKw
      minObservedBatteryPercent = Math.min(minObservedBatteryPercent, sim.powerStats.batteryPercent)
      maxObservedBatteryPercent = Math.max(maxObservedBatteryPercent, sim.powerStats.batteryPercent)

      if (batteryIsEmpty) {
        totalZeroBatteryTicks += 1
        currentZeroBatteryStreakTicks += 1
        longestZeroBatteryStreakTicks = Math.max(longestZeroBatteryStreakTicks, currentZeroBatteryStreakTicks)
      } else {
        currentZeroBatteryStreakTicks = 0
      }

      if (batteryIsFull) {
        totalFullBatteryTicks += 1
      }

      if (powerWindowTicks > 0) {
        const relativeTick = sim.tick - powerObservationStartTick
        const windowIndex = Math.floor(relativeTick / powerWindowTicks)
        const window = powerWindowAccumulators[windowIndex]
        if (window) {
          window.tickCount += 1
          if (batteryIsEmpty) window.zeroBatteryTickCount += 1
          if (batteryIsFull) window.fullBatteryTickCount += 1
          window.supplyKwSum += sim.powerStats.totalSupplyKw
          window.demandKwSum += sim.powerStats.totalDemandKw
        }
      }
    }
  }

  if (powerObservation && powerObservationAnchor === 'first_battery_drop') {
    assert(firstBatteryDropTick !== null, `${testCase.id} 在等待窗口内没有出现首次掉电`) 
  }

  const summary: Record<string, unknown> = {
    blueprint: snapshot.name,
    placement: {
      offsetX: placement.offsetX,
      offsetY: placement.offsetY,
      deviceCount: placement.layout.devices.length,
      linkCount: placement.layout.links.length,
      extensionDeviceIds: placement.extensionDeviceIds,
    },
  }

  if (testCase.throughput) {
    Object.assign(summary, validateThroughputExpectation(testCase, throughputSamples))
  }

  if (testCase.overflowBehavior) {
    summary.overflow = validateOverflowBehavior(testCase, overflowSamples)
  }

  if (powerObservation) {
    assert(powerObservationStartTick !== null && powerObservationEndTickExclusive !== null, `${testCase.id} 电力观测窗口未初始化成功`)
    summary.power = validatePowerObservation(
      buildPowerObservationSummary(
        testCase,
        powerObservationStartTick,
        powerObservationEndTickExclusive,
        firstBatteryDropTick,
        totalObservedPowerTicks,
        totalZeroBatteryTicks,
        totalFullBatteryTicks,
        longestZeroBatteryStreakTicks,
        totalObservedSupplyKw,
        totalObservedDemandKw,
        minObservedBatteryPercent,
        maxObservedBatteryPercent,
        sim,
        powerWindowTicks,
        powerWindowAccumulators,
      ),
    )
  }

  return summary
}