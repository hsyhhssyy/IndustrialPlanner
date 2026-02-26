import {
  EDGE_ANGLE,
  OPPOSITE_EDGE,
  buildOccupancyMap,
  cellToDeviceId,
  directionFromEdges,
  edgeFromDelta,
  getDeviceById,
  getRotatedPorts,
  inferPortDirection,
  isBeltLike,
  isPipeLike,
  linksFromLayout,
} from './geometry'
import { BASE_BY_ID } from './registry'
import { isDeviceWithinAllowedPlacementArea } from './shared/placementArea'
import type { DeviceInstance, Edge, LayoutState, Rotation } from './types'

let idCounter = 1

export type LogisticsFamily = 'belt' | 'pipe'

function isDeviceInstance(value: DeviceInstance | null): value is DeviceInstance {
  return value !== null
}

export function nextId(prefix: string) {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`
}

export function pathFromDrag(start: { x: number; y: number }, end: { x: number; y: number }) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (dx !== 0 && dy !== 0) return null
  const distance = Math.abs(dx) + Math.abs(dy)
  if (distance < 1) return null

  const points: Array<{ x: number; y: number }> = []
  if (dx !== 0) {
    const step = dx > 0 ? 1 : -1
    for (let i = 0; i <= Math.abs(dx); i += 1) points.push({ x: start.x + i * step, y: start.y })
  } else {
    const step = dy > 0 ? 1 : -1
    for (let i = 0; i <= Math.abs(dy); i += 1) points.push({ x: start.x, y: start.y + i * step })
  }
  return points
}

function axisExpand(from: { x: number; y: number }, to: { x: number; y: number }) {
  const points: Array<{ x: number; y: number }> = []
  const dx = to.x - from.x
  const dy = to.y - from.y

  if (dx === 0 && dy === 0) return points

  if (dx !== 0) {
    const step = dx > 0 ? 1 : -1
    for (let x = from.x + step; x !== to.x + step; x += step) {
      points.push({ x, y: from.y })
    }
  }

  if (dy !== 0) {
    const step = dy > 0 ? 1 : -1
    for (let y = from.y + step; y !== to.y + step; y += step) {
      points.push({ x: to.x, y })
    }
  }

  return points
}

function dedupeBacktrack(path: Array<{ x: number; y: number }>) {
  const result: Array<{ x: number; y: number }> = []
  for (const point of path) {
    const last = result[result.length - 1]
    if (!last) {
      result.push(point)
      continue
    }
    if (last.x === point.x && last.y === point.y) continue

    const prev = result[result.length - 2]
    if (prev && prev.x === point.x && prev.y === point.y) {
      result.pop()
      continue
    }
    result.push(point)
  }
  return result
}

export function pathFromTrace(trace: Array<{ x: number; y: number }>) {
  if (trace.length === 0) return null
  const expanded: Array<{ x: number; y: number }> = [trace[0]]
  for (let i = 1; i < trace.length; i += 1) {
    expanded.push(...axisExpand(expanded[expanded.length - 1], trace[i]))
  }
  const path = dedupeBacktrack(expanded)
  if (path.length < 1) return null
  return path
}

function createJunctionAt(
  typeId:
    | 'item_log_splitter'
    | 'item_log_converger'
    | 'item_log_connector'
    | 'item_pipe_splitter'
    | 'item_pipe_converger'
    | 'item_pipe_connector',
  x: number,
  y: number,
  rotation: Rotation,
): DeviceInstance {
  return {
    instanceId: nextId(typeId),
    typeId,
    origin: { x, y },
    rotation,
    config: {},
  }
}

function isTrackLikeByFamily(typeId: string, family: LogisticsFamily) {
  return family === 'belt' ? isBeltLike(typeId) : isPipeLike(typeId)
}

function splitJunctionTypeByFamily(family: LogisticsFamily) {
  return family === 'belt' ? 'item_log_splitter' : 'item_pipe_splitter'
}

function convergerJunctionTypeByFamily(family: LogisticsFamily) {
  return family === 'belt' ? 'item_log_converger' : 'item_pipe_converger'
}

function connectorJunctionTypeByFamily(family: LogisticsFamily) {
  return family === 'belt' ? 'item_log_connector' : 'item_pipe_connector'
}

function isBeltFamilyJunction(typeId: string) {
  return typeId === 'item_log_splitter' || typeId === 'item_log_converger' || typeId === 'item_log_connector'
}

function isPipeFamilyJunction(typeId: string) {
  return typeId === 'item_pipe_splitter' || typeId === 'item_pipe_converger' || typeId === 'item_pipe_connector'
}

function isLogisticsLikeByFamily(typeId: string, family: LogisticsFamily) {
  return family === 'belt'
    ? isBeltLike(typeId) || isBeltFamilyJunction(typeId)
    : isPipeLike(typeId) || isPipeFamilyJunction(typeId)
}

function isCrossFamilyLogistics(typeId: string, family: LogisticsFamily) {
  return family === 'belt'
    ? isPipeLike(typeId) || isPipeFamilyJunction(typeId)
    : isBeltLike(typeId) || isBeltFamilyJunction(typeId)
}

function createTrackAt(
  family: LogisticsFamily,
  x: number,
  y: number,
  inEdge: 'N' | 'S' | 'E' | 'W',
  outEdge: 'N' | 'S' | 'E' | 'W',
): DeviceInstance {
  const result = directionFromEdges(inEdge, outEdge)
  const typeId =
    family === 'belt'
      ? (result.typeId as DeviceInstance['typeId'])
      : (result.typeId.replace('belt_', 'pipe_') as DeviceInstance['typeId'])

  return {
    instanceId: nextId(typeId),
    typeId,
    origin: { x, y },
    rotation: result.rotation,
    config: {},
  }
}

export function deleteConnectedBelts(layout: LayoutState, x: number, y: number): LayoutState {
  const cellMap = cellToDeviceId(layout)
  const startId = cellMap.get(`${x},${y}`)
  if (!startId) return layout
  const start = getDeviceById(layout, startId)
  if (!start) return layout

  const family: LogisticsFamily | null = isBeltLike(start.typeId) ? 'belt' : isPipeLike(start.typeId) ? 'pipe' : null
  if (!family) return layout

  const isFamilyTrack = (typeId: string) => isTrackLikeByFamily(typeId, family)

  const beltAdjacency = new Map<string, Set<string>>()
  for (const link of linksFromLayout(layout)) {
    const fromDevice = getDeviceById(layout, link.from.instanceId)
    const toDevice = getDeviceById(layout, link.to.instanceId)
    if (!fromDevice || !toDevice) continue
    if (!isFamilyTrack(fromDevice.typeId) || !isFamilyTrack(toDevice.typeId)) continue
    const fromBucket = beltAdjacency.get(fromDevice.instanceId) ?? new Set<string>()
    fromBucket.add(toDevice.instanceId)
    beltAdjacency.set(fromDevice.instanceId, fromBucket)

    const toBucket = beltAdjacency.get(toDevice.instanceId) ?? new Set<string>()
    toBucket.add(fromDevice.instanceId)
    beltAdjacency.set(toDevice.instanceId, toBucket)
  }

  const queue: string[] = [startId]
  const seen = new Set<string>()
  const toDelete = new Set<string>()

  while (queue.length > 0) {
    const currentId = queue.shift()
    if (!currentId) break
    if (seen.has(currentId)) continue
    seen.add(currentId)

    const device = getDeviceById(layout, currentId)
    if (!device) continue
    if (!isFamilyTrack(device.typeId)) continue
    toDelete.add(device.instanceId)

    const neighbors = beltAdjacency.get(currentId)
    if (!neighbors) continue
    for (const neighborId of neighbors) {
      if (!seen.has(neighborId)) queue.push(neighborId)
    }
  }

  return {
    ...layout,
    devices: layout.devices.filter((device) => !toDelete.has(device.instanceId)),
  }
}

function canCrossStraight(existingType: string) {
  return existingType === 'belt_straight_1x1' || existingType === 'pipe_straight_1x1'
}

function rotationFromEdge(baseEdge: Edge, targetEdge: Edge): Rotation {
  const delta = (EDGE_ANGLE[targetEdge] - EDGE_ANGLE[baseEdge] + 360) % 360
  return delta as Rotation
}

function beltInOutEdge(device: DeviceInstance): { inEdge: Edge; outEdge: Edge } | null {
  if (!isBeltLike(device.typeId) && !isPipeLike(device.typeId)) return null
  const ports = getRotatedPorts(device)
  const inPort = ports.find((port) => inferPortDirection(port.portId) === 'Input')
  const outPort = ports.find((port) => inferPortDirection(port.portId) === 'Output')
  if (!inPort || !outPort) return null
  return { inEdge: inPort.edge, outEdge: outPort.edge }
}

function hasBeltOutputLink(layout: LayoutState, instanceId: string, edge: Edge) {
  const links = linksFromLayout(layout)
  return links.some((link) => link.from.instanceId === instanceId && link.from.edge === edge)
}

function hasBeltInputLink(layout: LayoutState, instanceId: string, edge: Edge) {
  const links = linksFromLayout(layout)
  return links.some((link) => link.to.instanceId === instanceId && link.to.edge === edge)
}

function canRewriteBeltFlow(inEdge: Edge, outEdge: Edge) {
  return inEdge !== outEdge
}

function hasMatchingPortAtCell(
  device: DeviceInstance,
  cell: { x: number; y: number },
  requiredDirection: 'Input' | 'Output',
  requiredEdge: Edge,
) {
  return getRotatedPorts(device).some(
    (port) =>
      port.x === cell.x &&
      port.y === cell.y &&
      port.edge === requiredEdge &&
      inferPortDirection(port.portId) === requiredDirection,
  )
}

function endpointAllowed(
  layout: LayoutState,
  occupancyMap: Map<string, Array<{ x: number; y: number; instanceId: string }>>,
  family: LogisticsFamily,
  cell: { x: number; y: number },
  requiredDirection: 'Input' | 'Output',
  requiredEdge: Edge,
) {
  const entries = occupancyMap.get(`${cell.x},${cell.y}`)
  if (!entries || entries.length === 0) return true

  let hasPassThroughOverlay = false
  let hasBlockingEntity = false

  for (const entry of entries) {
    const device = getDeviceById(layout, entry.instanceId)
    if (!device) {
      hasBlockingEntity = true
      continue
    }

    if (isTrackLikeByFamily(device.typeId, family)) {
      hasPassThroughOverlay = true
      continue
    }

    if (isLogisticsLikeByFamily(device.typeId, family)) {
      if (hasMatchingPortAtCell(device, cell, requiredDirection, requiredEdge)) return true
      hasBlockingEntity = true
      continue
    }

    if (isCrossFamilyLogistics(device.typeId, family)) {
      hasPassThroughOverlay = true
      continue
    }

    if (hasMatchingPortAtCell(device, cell, requiredDirection, requiredEdge)) return true
    hasBlockingEntity = true
  }

  return hasPassThroughOverlay && !hasBlockingEntity
}

function endpointAnchoredByExistingDevice(
  layout: LayoutState,
  occupancyMap: Map<string, Array<{ x: number; y: number; instanceId: string }>>,
  family: LogisticsFamily,
  cell: { x: number; y: number },
  requiredDirection: 'Input' | 'Output',
  requiredEdge: Edge,
) {
  const entries = occupancyMap.get(`${cell.x},${cell.y}`)
  if (!entries || entries.length === 0) return false

  for (const entry of entries) {
    const device = getDeviceById(layout, entry.instanceId)
    if (!device) continue

    if (isTrackLikeByFamily(device.typeId, family)) continue

    if (isLogisticsLikeByFamily(device.typeId, family)) {
      if (hasMatchingPortAtCell(device, cell, requiredDirection, requiredEdge)) return true
      continue
    }

    if (isCrossFamilyLogistics(device.typeId, family)) continue

    if (hasMatchingPortAtCell(device, cell, requiredDirection, requiredEdge)) return true
  }

  return false
}

function validAxisPath(path: Array<{ x: number; y: number }>) {
  for (let i = 1; i < path.length; i += 1) {
    const dx = Math.abs(path[i].x - path[i - 1].x)
    const dy = Math.abs(path[i].y - path[i - 1].y)
    if (dx + dy !== 1) return false
  }
  return true
}

function segmentKey(a: { x: number; y: number }, b: { x: number; y: number }) {
  const left = `${a.x},${a.y}`
  const right = `${b.x},${b.y}`
  return left < right ? `${left}|${right}` : `${right}|${left}`
}

function hasRepeatedSegment(path: Array<{ x: number; y: number }>) {
  const seen = new Set<string>()
  for (let i = 1; i < path.length; i += 1) {
    const key = segmentKey(path[i - 1], path[i])
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

function countPathCells(path: Array<{ x: number; y: number }>) {
  const counts = new Map<string, number>()
  for (const cell of path) {
    const key = `${cell.x},${cell.y}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function edgeSetByCell(path: Array<{ x: number; y: number }>) {
  const edgesByCell = new Map<string, Set<Edge>>()
  const append = (cell: { x: number; y: number }, edge: Edge) => {
    const key = `${cell.x},${cell.y}`
    const set = edgesByCell.get(key) ?? new Set<Edge>()
    set.add(edge)
    edgesByCell.set(key, set)
  }

  for (let i = 1; i < path.length; i += 1) {
    const prev = path[i - 1]
    const current = path[i]
    const out = edgeFromDelta(current.x - prev.x, current.y - prev.y)
    append(prev, out)
    append(current, OPPOSITE_EDGE[out])
  }

  return edgesByCell
}

function selfCrossCells(path: Array<{ x: number; y: number }>) {
  const counts = countPathCells(path)
  const edgesByCell = edgeSetByCell(path)
  const result = new Set<string>()

  for (const [key, count] of counts.entries()) {
    if (count < 2) continue
    const edges = edgesByCell.get(key)
    if (!edges) continue
    const hasVertical = edges.has('N') || edges.has('S')
    const hasHorizontal = edges.has('E') || edges.has('W')
    if (hasVertical && hasHorizontal) result.add(key)
  }

  return result
}

function ghostFlowAtCell(path: Array<{ x: number; y: number }>, cell: { x: number; y: number }) {
  for (let i = 1; i < path.length - 1; i += 1) {
    const current = path[i]
    if (current.x !== cell.x || current.y !== cell.y) continue
    const prev = path[i - 1]
    const next = path[i + 1]
    const inEdge = edgeFromDelta(prev.x - current.x, prev.y - current.y)
    const outEdge = edgeFromDelta(next.x - current.x, next.y - current.y)
    return { inEdge, outEdge }
  }
  return null
}

function isStraightFlow(flow: { inEdge: Edge; outEdge: Edge } | null) {
  if (!flow) return false
  return OPPOSITE_EDGE[flow.inEdge] === flow.outEdge
}

function isAlongExistingBelt(
  family: LogisticsFamily,
  layout: LayoutState,
  prev: { x: number; y: number },
  current: { x: number; y: number },
  next: { x: number; y: number },
) {
  const entries = buildOccupancyMap(layout).get(`${current.x},${current.y}`) ?? []
  const existing = entries
    .map((entry) => getDeviceById(layout, entry.instanceId))
    .filter(isDeviceInstance)
    .find((device) => isTrackLikeByFamily(device.typeId, family))
  if (!existing) return false

  const flow = beltInOutEdge(existing)
  if (!flow) return false

  const inEdge = edgeFromDelta(prev.x - current.x, prev.y - current.y)
  const outEdge = edgeFromDelta(next.x - current.x, next.y - current.y)
  const onFlowIn = inEdge === flow.inEdge || inEdge === flow.outEdge
  const onFlowOut = outEdge === flow.inEdge || outEdge === flow.outEdge
  return onFlowIn && onFlowOut
}

function isValidLogisticsPathPrefix(layout: LayoutState, path: Array<{ x: number; y: number }>, family: LogisticsFamily) {
  if (path.length < 1) return false
  if (!validAxisPath(path)) return false
  if (path.length === 1) return true
  if (hasRepeatedSegment(path)) return false

  const occupancyMap = buildOccupancyMap(layout)
  const first = path[0]
  const last = path[path.length - 1]

  const startOutEdge = edgeFromDelta(path[1].x - first.x, path[1].y - first.y)
  const endInEdge = edgeFromDelta(path[path.length - 2].x - last.x, path[path.length - 2].y - last.y)

  if (!endpointAllowed(layout, occupancyMap, family, first, 'Output', startOutEdge)) return false
  if (!endpointAllowed(layout, occupancyMap, family, last, 'Input', endInEdge)) return false

  const pathCrossCells = selfCrossCells(path)

  for (let i = 1; i < path.length - 1; i += 1) {
    const current = path[i]
    const key = `${current.x},${current.y}`
    const entries = occupancyMap.get(`${current.x},${current.y}`) ?? []
    if (entries.length === 0) {
      if (pathCrossCells.has(key)) {
        const ghostFlow = ghostFlowAtCell(path, current)
        if (isStraightFlow(ghostFlow)) continue
        return false
      }
      continue
    }

    const sameFamilyTrack = entries
      .map((entry) => getDeviceById(layout, entry.instanceId))
      .filter(isDeviceInstance)
      .find((device) => isTrackLikeByFamily(device.typeId, family))
    const hasSameFamilyNonTrack = entries.some((entry) => {
      const device = getDeviceById(layout, entry.instanceId)
      return device !== null && isLogisticsLikeByFamily(device.typeId, family) && !isTrackLikeByFamily(device.typeId, family)
    })
    const hasBlockingNonLogistics = entries.some((entry) => {
      const device = getDeviceById(layout, entry.instanceId)
      return device !== null && !isLogisticsLikeByFamily(device.typeId, family) && !isCrossFamilyLogistics(device.typeId, family)
    })

    if (pathCrossCells.has(key)) {
      const ghostFlow = ghostFlowAtCell(path, current)
      if (!isStraightFlow(ghostFlow)) return false
      if (sameFamilyTrack && !canCrossStraight(sameFamilyTrack.typeId)) return false
      if (hasSameFamilyNonTrack || hasBlockingNonLogistics) return false
      continue
    }

    if (sameFamilyTrack && canCrossStraight(sameFamilyTrack.typeId)) continue
    if (sameFamilyTrack || hasSameFamilyNonTrack || hasBlockingNonLogistics) return false
  }

  if (path.length >= 3) {
    const prev = path[path.length - 3]
    const current = path[path.length - 2]
    const next = path[path.length - 1]
    if (isAlongExistingBelt(family, layout, prev, current, next)) return false
  }

  return true
}

export function longestValidLogisticsPrefix(
  layout: LayoutState,
  path: Array<{ x: number; y: number }>,
  family: LogisticsFamily = 'belt',
) {
  if (path.length === 0) return []

  let prefix = [path[0]]
  for (let i = 1; i < path.length; i += 1) {
    const trial = [...prefix, path[i]]
    if (!isValidLogisticsPathPrefix(layout, trial, family)) break
    prefix = trial
  }

  return prefix
}

export function applyLogisticsPath(
  layout: LayoutState,
  path: Array<{ x: number; y: number }>,
  family: LogisticsFamily = 'belt',
): LayoutState {
  if (path.length < 2 || !validAxisPath(path)) return layout

  const occupancyMap = buildOccupancyMap(layout)
  const nextDevices = [...layout.devices]
  const replacedIds = new Set<string>()

  const first = path[0]
  const last = path[path.length - 1]
  const firstKey = `${first.x},${first.y}`
  const lastKey = `${last.x},${last.y}`

  const visitCount = countPathCells(path)
  const pathCrossSet = selfCrossCells(path)
  const createdBridgeCells = new Set<string>()

  const startOutEdge = edgeFromDelta(path[1].x - first.x, path[1].y - first.y)
  const endInEdge = edgeFromDelta(path[path.length - 2].x - last.x, path[path.length - 2].y - last.y)

  if (!endpointAllowed(layout, occupancyMap, family, first, 'Output', startOutEdge)) return layout
  if (!endpointAllowed(layout, occupancyMap, family, last, 'Input', endInEdge)) return layout

  const startOn = (occupancyMap.get(`${first.x},${first.y}`) ?? [])
    .map((entry) => getDeviceById(layout, entry.instanceId))
    .filter(isDeviceInstance)
    .find((device) => isTrackLikeByFamily(device.typeId, family))
  const endOn = (occupancyMap.get(`${last.x},${last.y}`) ?? [])
    .map((entry) => getDeviceById(layout, entry.instanceId))
    .filter(isDeviceInstance)
    .find((device) => isTrackLikeByFamily(device.typeId, family))
  const startOnGhost = (visitCount.get(`${first.x},${first.y}`) ?? 0) > 1
  const endOnGhost = (visitCount.get(`${last.x},${last.y}`) ?? 0) > 1
  const startGhostFlow = startOnGhost ? ghostFlowAtCell(path, first) : null
  const endGhostFlow = endOnGhost ? ghostFlowAtCell(path, last) : null
  const startAnchored = endpointAnchoredByExistingDevice(layout, occupancyMap, family, first, 'Output', startOutEdge)
  const endAnchored = endpointAnchoredByExistingDevice(layout, occupancyMap, family, last, 'Input', endInEdge)

  if (startOn) {
    const flow = beltInOutEdge(startOn)
    const shouldForceBeltContinue =
      !!flow && !hasBeltOutputLink(layout, startOn.instanceId, flow.outEdge) && canRewriteBeltFlow(flow.inEdge, startOutEdge)
    if (shouldForceBeltContinue && flow) {
      replacedIds.add(startOn.instanceId)
      nextDevices.push(createTrackAt(family, first.x, first.y, flow.inEdge, startOutEdge))
    } else {
      replacedIds.add(startOn.instanceId)
      nextDevices.push(createJunctionAt(splitJunctionTypeByFamily(family), first.x, first.y, flow ? rotationFromEdge('E', flow.inEdge) : 0))
    }
  } else if (startOnGhost) {
    const splitterInEdge = startGhostFlow?.inEdge ?? OPPOSITE_EDGE[startOutEdge]
    nextDevices.push(createJunctionAt(splitJunctionTypeByFamily(family), first.x, first.y, rotationFromEdge('E', splitterInEdge)))
  } else if (startAnchored) {
    // anchored by existing endpoint device (building port or same-family junction), do not place overlapping track segment
  } else {
    nextDevices.push(createTrackAt(family, first.x, first.y, OPPOSITE_EDGE[startOutEdge], startOutEdge))
  }

  if (endOn) {
    const flow = beltInOutEdge(endOn)
    const shouldForceBeltConnect =
      !!flow && !hasBeltInputLink(layout, endOn.instanceId, flow.inEdge) && canRewriteBeltFlow(endInEdge, flow.outEdge)
    if (shouldForceBeltConnect && flow) {
      replacedIds.add(endOn.instanceId)
      nextDevices.push(createTrackAt(family, last.x, last.y, endInEdge, flow.outEdge))
    } else {
      replacedIds.add(endOn.instanceId)
      nextDevices.push(createJunctionAt(convergerJunctionTypeByFamily(family), last.x, last.y, flow ? rotationFromEdge('W', flow.outEdge) : 0))
    }
  } else if (endOnGhost) {
    const mergerOutEdge = endGhostFlow?.outEdge ?? OPPOSITE_EDGE[endInEdge]
    nextDevices.push(createJunctionAt(convergerJunctionTypeByFamily(family), last.x, last.y, rotationFromEdge('W', mergerOutEdge)))
  } else if (endAnchored) {
    // anchored by existing endpoint device (building port or same-family junction), do not place overlapping track segment
  } else {
    nextDevices.push(createTrackAt(family, last.x, last.y, endInEdge, OPPOSITE_EDGE[endInEdge]))
  }

  for (let i = 1; i < path.length - 1; i += 1) {
    const current = path[i]
    const prev = path[i - 1]
    const next = path[i + 1]
    const inEdge = edgeFromDelta(prev.x - current.x, prev.y - current.y)
    const outEdge = edgeFromDelta(next.x - current.x, next.y - current.y)
    const currentKey = `${current.x},${current.y}`

    const entries = occupancyMap.get(`${current.x},${current.y}`) ?? []
    const sameFamilyTrack = entries
      .map((entry) => getDeviceById(layout, entry.instanceId))
      .filter(isDeviceInstance)
      .find((device) => isTrackLikeByFamily(device.typeId, family))
    const sameFamilyNonTrack = entries
      .map((entry) => getDeviceById(layout, entry.instanceId))
      .filter(isDeviceInstance)
      .find((device) => isLogisticsLikeByFamily(device.typeId, family) && !isTrackLikeByFamily(device.typeId, family))
    const hasBlockingNonLogistics = entries.some((entry) => {
      const device = getDeviceById(layout, entry.instanceId)
      return device !== null && !isLogisticsLikeByFamily(device.typeId, family) && !isCrossFamilyLogistics(device.typeId, family)
    })

    if (pathCrossSet.has(currentKey)) {
      if (currentKey === firstKey || currentKey === lastKey) {
        continue
      }
      const ghostFlow = ghostFlowAtCell(path, current)
      if (!isStraightFlow(ghostFlow)) {
        return layout
      }
      if (sameFamilyTrack) {
        if (canCrossStraight(sameFamilyTrack.typeId)) {
          replacedIds.add(sameFamilyTrack.instanceId)
        } else if (!replacedIds.has(sameFamilyTrack.instanceId)) {
          return layout
        }
      }
      if (sameFamilyNonTrack || hasBlockingNonLogistics) {
        return layout
      }
      if (createdBridgeCells.has(currentKey)) {
        continue
      }
      nextDevices.push(createJunctionAt(connectorJunctionTypeByFamily(family), current.x, current.y, 0))
      createdBridgeCells.add(currentKey)
      continue
    }

    if (sameFamilyTrack) {
      if (canCrossStraight(sameFamilyTrack.typeId)) {
        replacedIds.add(sameFamilyTrack.instanceId)
        if (createdBridgeCells.has(currentKey)) {
          continue
        }
        nextDevices.push(createJunctionAt(connectorJunctionTypeByFamily(family), current.x, current.y, 0))
        createdBridgeCells.add(currentKey)
        continue
      }
      if (!replacedIds.has(sameFamilyTrack.instanceId)) {
        return layout
      }
    }
    if (sameFamilyNonTrack || hasBlockingNonLogistics) return layout

    nextDevices.push(createTrackAt(family, current.x, current.y, inEdge, outEdge))
  }

  const filtered = nextDevices.filter((device) => !replacedIds.has(device.instanceId))
  const finalLayout: LayoutState = { ...layout, devices: filtered }

  if (family === 'pipe') {
    return finalLayout
  }

  const outerRing = BASE_BY_ID[finalLayout.baseId]?.outerRing ?? { top: 0, right: 0, bottom: 0, left: 0 }

  return {
    ...finalLayout,
    devices: finalLayout.devices.filter((device) => isDeviceWithinAllowedPlacementArea(device, finalLayout.lotSize, outerRing)),
  }
}
