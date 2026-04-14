import fs from 'node:fs'

import { sanitizeLayoutLinks } from '../src/domain/deviceLinks.ts'
import { detectOverlaps, getRotatedPorts, neighborsFromLinks, OPPOSITE_EDGE } from '../src/domain/geometry.ts'
import { validatePlacementConstraints } from '../src/domain/placement.ts'
import { BASE_BY_ID } from '../src/domain/registry.ts'
import { isDeviceWithinAllowedPlacementArea } from '../src/domain/shared/placementArea.ts'
import type {
  BaseId,
  DeviceInstance,
  DeviceLink,
  DeviceRuntime,
  DeviceTypeId,
  Edge,
  LayoutState,
  Rotation,
  SimState,
} from '../src/domain/types.ts'
import {
  createInitialSimState,
  debugSolveFlowPlanForCurrentTick,
  initialStorageConfig,
  startSimulation,
  tickSimulation,
} from '../src/sim/engine.ts'
import dualOvenXiraniteCase from '../src/test/blueprints/cases/dual-oven-xiranite.ts'
import type {
  BlueprintCase,
  BlueprintDeviceRef,
  BlueprintDeviceSnapshot,
  BlueprintExtensionDevice,
} from '../src/test/blueprints/harness.ts'

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

type PlacementResult = {
  layout: LayoutState
  blueprintDevices: DeviceInstance[]
}

type SamplePoint = {
  second: number
  producedPerMinute: number
  ovenWindowCounts: Record<string, number>
}

type ReceiverArrivalSummary = {
  receiverDevice: ReturnType<typeof formatDevice>
  arrivalCount: number
  intervalSummary: IntervalSummary
}

type IntervalSummary = {
  count: number
  min: number | null
  max: number | null
  unique: number[]
  preview: number[]
}

const ROTATIONS: Rotation[] = [0, 90, 180, 270]
const EDGE_DELTA: Record<Edge, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 },
}
const TARGET_DEVICE_TYPE_ID = 'item_port_xiranite_oven_1'
const FOCUSED_DEBUG_WINDOW_SECONDS = 30

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
      }
    }
  }

  throw new Error(`没有找到可合法放置蓝图的位置: ${snapshot.name}`)
}

function getWindowCount(ticks: number[], startInclusive: number, endInclusive: number) {
  let count = 0
  for (const tick of ticks) {
    if (tick < startInclusive) continue
    if (tick > endInclusive) break
    count += 1
  }
  return count
}

function summarizeIntervals(ticks: number[]): IntervalSummary {
  const intervals = ticks.slice(1).map((tick, index) => tick - ticks[index])
  if (intervals.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      unique: [],
      preview: [],
    }
  }
  const unique = [...new Set(intervals)].sort((left, right) => left - right)
  return {
    count: intervals.length,
    min: Math.min(...intervals),
    max: Math.max(...intervals),
    unique,
    preview: intervals.slice(0, 24),
  }
}

function formatDevice(device: DeviceInstance | undefined) {
  if (!device) return null
  return {
    instanceId: device.instanceId,
    typeId: device.typeId,
    origin: device.origin,
    rotation: device.rotation,
  }
}

function isProcessorRuntime(runtime: DeviceRuntime): runtime is Extract<DeviceRuntime, { lastCompletionTick: number | null }> {
  return 'lastCompletionTick' in runtime
}

function main() {
  const testCase = dualOvenXiraniteCase
  const throughput = testCase.throughput
  assert(throughput, 'dual-oven-xiranite 缺少 throughput 配置')

  const snapshot = readBlueprint(testCase.blueprintPath)
  const placement = findPlacement(snapshot, testCase)
  const layout = placement.layout
  const deviceById = new Map(layout.devices.map((device) => [device.instanceId, device]))
  const neighbors = neighborsFromLinks(layout)
  const tickRateHz = createInitialSimState().tickRateHz
  const analysisStartTick = (throughput.warmupSeconds - 60) * tickRateHz
  const warmupTicks = throughput.warmupSeconds * tickRateHz
  const totalTicks = (throughput.warmupSeconds + throughput.stabilitySeconds) * tickRateHz
  const sampleIntervalTicks = 10 * tickRateHz
  const perMinuteWindowTicks = 60 * tickRateHz
  const focusedDebugStartTick = totalTicks - FOCUSED_DEBUG_WINDOW_SECONDS * tickRateHz

  let sim = startSimulation(layout, createInitialSimState(), testCase.simulation?.powerMode ?? 'infinite')

  const ovenDevices = layout.devices
    .filter((device) => device.typeId === TARGET_DEVICE_TYPE_ID)
    .sort((left, right) => left.origin.y - right.origin.y || left.origin.x - right.origin.x)

  const ovenNames = new Map(ovenDevices.map((device, index) => [device.instanceId, index === 0 ? 'upper-oven' : 'lower-oven']))
  const firstReceiverIdsByOven = new Map(
    ovenDevices.map((device) => [
      device.instanceId,
      [...new Set((neighbors.outMap.get(device.instanceId) ?? []).map((link) => link.to.instanceId))],
    ]),
  )
  const completionTicksByOven = new Map(ovenDevices.map((device) => [device.instanceId, [] as number[]]))
  const stallCountsByOven = new Map(ovenDevices.map((device) => [device.instanceId, new Map<string, number>()]))
  const firstReceiverTransferTicksByOven = new Map(
    ovenDevices.map((device) => [
      device.instanceId,
      new Map((firstReceiverIdsByOven.get(device.instanceId) ?? []).map((receiverId) => [receiverId, [] as number[]])),
    ]),
  )
  const samplePoints: SamplePoint[] = []

  for (let step = 0; step < totalTicks; step += 1) {
    if (sim.tick >= focusedDebugStartTick) {
      const debug = debugSolveFlowPlanForCurrentTick(layout, sim)
      assert(debug, 'debugSolveFlowPlanForCurrentTick 返回空')
      for (const match of debug.planResult.transferMatches) {
        if (match.itemId !== throughput.targetItemId) continue
        if (!firstReceiverIdsByOven.get(match.fromId)?.includes(match.toId)) continue
        firstReceiverTransferTicksByOven.get(match.fromId)?.get(match.toId)?.push(sim.tick + 1)
      }
    }

    sim = tickSimulation(layout, sim)

    for (const ovenDevice of ovenDevices) {
      const runtime = sim.runtimeById[ovenDevice.instanceId]
      if (!runtime || !isProcessorRuntime(runtime)) continue

      if (runtime.lastCompletionTick === sim.tick && sim.tick >= analysisStartTick) {
        completionTicksByOven.get(ovenDevice.instanceId)?.push(sim.tick)
      }

      if (sim.tick >= warmupTicks) {
        const stallCounts = stallCountsByOven.get(ovenDevice.instanceId)
        if (stallCounts) {
          const key = runtime.isStalled ? runtime.stallReason : 'NONE'
          stallCounts.set(key, (stallCounts.get(key) ?? 0) + 1)
        }
      }
    }

    if (sim.tick >= warmupTicks && sim.tick % sampleIntervalTicks === 0) {
      const ovenWindowCounts = Object.fromEntries(
        ovenDevices.map((device) => {
          const ticks = completionTicksByOven.get(device.instanceId) ?? []
          const count = getWindowCount(ticks, sim.tick - perMinuteWindowTicks + 1, sim.tick)
          return [ovenNames.get(device.instanceId) ?? device.instanceId, count]
        }),
      )
      samplePoints.push({
        second: sim.stats.simSeconds,
        producedPerMinute: sim.stats.producedPerMinute[throughput.targetItemId] ?? 0,
        ovenWindowCounts,
      })
    }
  }

  const lowSamples = samplePoints.filter((sample) => sample.producedPerMinute < throughput.requiredPerMinute)
  const ovenSummaries = ovenDevices.map((device) => {
    const completionTicks = (completionTicksByOven.get(device.instanceId) ?? []).filter((tick) => tick >= warmupTicks)
    const receiverArrivals: ReceiverArrivalSummary[] = [...(firstReceiverTransferTicksByOven.get(device.instanceId)?.entries() ?? [])]
      .map(([receiverId, ticks]) => {
        const focusedTicks = ticks.filter((tick) => tick >= focusedDebugStartTick)
        return {
          receiverDevice: formatDevice(deviceById.get(receiverId)),
          arrivalCount: focusedTicks.length,
          intervalSummary: summarizeIntervals(focusedTicks),
        }
      })
    const stallCounts = Object.fromEntries(
      [...(stallCountsByOven.get(device.instanceId) ?? new Map<string, number>()).entries()].sort((left, right) => right[1] - left[1]),
    )
    return {
      oven: ovenNames.get(device.instanceId) ?? device.instanceId,
      device: formatDevice(device),
      completion: {
        count: completionTicks.length,
        intervalSummary: summarizeIntervals(completionTicks),
      },
      ovenToFirstBelt: {
        receivers: receiverArrivals,
      },
      steadyStateStallCounts: stallCounts,
    }
  })

  const result = {
    caseId: testCase.id,
    tickRateHz,
    throughputTarget: throughput.targetItemId,
    requiredPerMinute: throughput.requiredPerMinute,
    samplePoints,
    lowSamples,
    ovenSummaries,
  }

  console.log(JSON.stringify(result, null, 2))
}

main()