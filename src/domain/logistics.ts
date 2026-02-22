import {
  EDGE_ANGLE,
  OPPOSITE_EDGE,
  cellToDeviceId,
  directionFromEdges,
  edgeFromDelta,
  getDeviceById,
  getRotatedPorts,
  inferPortDirection,
  isBeltLike,
  isWithinLot,
  linksFromLayout,
} from './geometry'
import type { DeviceInstance, Edge, LayoutState, Rotation } from './types'

let idCounter = 1

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
  typeId: 'item_log_splitter' | 'item_log_converger' | 'item_log_connector',
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

function createBeltAt(
  x: number,
  y: number,
  inEdge: 'N' | 'S' | 'E' | 'W',
  outEdge: 'N' | 'S' | 'E' | 'W',
): DeviceInstance {
  const result = directionFromEdges(inEdge, outEdge)
  return {
    instanceId: nextId(result.typeId),
    typeId: result.typeId as DeviceInstance['typeId'],
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
  if (!start || !isBeltLike(start.typeId)) return layout

  const beltAdjacency = new Map<string, Set<string>>()
  for (const link of linksFromLayout(layout)) {
    const fromDevice = getDeviceById(layout, link.from.instanceId)
    const toDevice = getDeviceById(layout, link.to.instanceId)
    if (!fromDevice || !toDevice) continue
    if (!isBeltLike(fromDevice.typeId) || !isBeltLike(toDevice.typeId)) continue
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
    if (!isBeltLike(device.typeId)) continue
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
  return existingType === 'belt_straight_1x1'
}

function rotationFromEdge(baseEdge: Edge, targetEdge: Edge): Rotation {
  const delta = (EDGE_ANGLE[targetEdge] - EDGE_ANGLE[baseEdge] + 360) % 360
  return delta as Rotation
}

function beltInOutEdge(device: DeviceInstance): { inEdge: Edge; outEdge: Edge } | null {
  if (!isBeltLike(device.typeId)) return null
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

function endpointAllowed(
  layout: LayoutState,
  cell: { x: number; y: number },
  requiredDirection: 'Input' | 'Output',
  requiredEdge: Edge,
) {
  const cellMap = cellToDeviceId(layout)
  const occupiedId = cellMap.get(`${cell.x},${cell.y}`)
  if (!occupiedId) return true

  const device = getDeviceById(layout, occupiedId)
  if (!device) return false
  if (isBeltLike(device.typeId)) return true

  return getRotatedPorts(device).some(
    (port) =>
      port.x === cell.x &&
      port.y === cell.y &&
      port.edge === requiredEdge &&
      inferPortDirection(port.portId) === requiredDirection,
  )
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
  layout: LayoutState,
  prev: { x: number; y: number },
  current: { x: number; y: number },
  next: { x: number; y: number },
) {
  const cellMap = cellToDeviceId(layout)
  const occupyId = cellMap.get(`${current.x},${current.y}`)
  if (!occupyId) return false

  const existing = getDeviceById(layout, occupyId)
  if (!existing || !isBeltLike(existing.typeId)) return false

  const flow = beltInOutEdge(existing)
  if (!flow) return false

  const inEdge = edgeFromDelta(prev.x - current.x, prev.y - current.y)
  const outEdge = edgeFromDelta(next.x - current.x, next.y - current.y)
  const onFlowIn = inEdge === flow.inEdge || inEdge === flow.outEdge
  const onFlowOut = outEdge === flow.inEdge || outEdge === flow.outEdge
  return onFlowIn && onFlowOut
}

function isValidLogisticsPathPrefix(layout: LayoutState, path: Array<{ x: number; y: number }>) {
  if (path.length < 1) return false
  if (!validAxisPath(path)) return false
  if (path.length === 1) return true
  if (hasRepeatedSegment(path)) return false

  const cellMap = cellToDeviceId(layout)
  const first = path[0]
  const last = path[path.length - 1]

  const startOutEdge = edgeFromDelta(path[1].x - first.x, path[1].y - first.y)
  const endInEdge = edgeFromDelta(path[path.length - 2].x - last.x, path[path.length - 2].y - last.y)

  if (!endpointAllowed(layout, first, 'Output', startOutEdge)) return false
  if (!endpointAllowed(layout, last, 'Input', endInEdge)) return false

  const pathCrossCells = selfCrossCells(path)

  for (let i = 1; i < path.length - 1; i += 1) {
    const current = path[i]
    const key = `${current.x},${current.y}`
    const occupyId = cellMap.get(`${current.x},${current.y}`)
    if (!occupyId) {
      if (pathCrossCells.has(key)) {
        const ghostFlow = ghostFlowAtCell(path, current)
        if (isStraightFlow(ghostFlow)) continue
        return false
      }
      continue
    }
    const existing = getDeviceById(layout, occupyId)
    if (existing && canCrossStraight(existing.typeId)) continue
    return false
  }

  if (path.length >= 3) {
    const prev = path[path.length - 3]
    const current = path[path.length - 2]
    const next = path[path.length - 1]
    if (isAlongExistingBelt(layout, prev, current, next)) return false
  }

  return true
}

export function longestValidLogisticsPrefix(layout: LayoutState, path: Array<{ x: number; y: number }>) {
  if (path.length === 0) return []

  let prefix = [path[0]]
  for (let i = 1; i < path.length; i += 1) {
    const trial = [...prefix, path[i]]
    if (!isValidLogisticsPathPrefix(layout, trial)) break
    prefix = trial
  }

  return prefix
}

export function applyLogisticsPath(layout: LayoutState, path: Array<{ x: number; y: number }>): LayoutState {
  if (path.length < 2 || !validAxisPath(path)) return layout

  const cellMap = cellToDeviceId(layout)
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

  if (!endpointAllowed(layout, first, 'Output', startOutEdge)) return layout
  if (!endpointAllowed(layout, last, 'Input', endInEdge)) return layout

  const startOn = cellMap.get(`${first.x},${first.y}`)
  const endOn = cellMap.get(`${last.x},${last.y}`)
  const startOnGhost = (visitCount.get(`${first.x},${first.y}`) ?? 0) > 1
  const endOnGhost = (visitCount.get(`${last.x},${last.y}`) ?? 0) > 1
  const startGhostFlow = startOnGhost ? ghostFlowAtCell(path, first) : null
  const endGhostFlow = endOnGhost ? ghostFlowAtCell(path, last) : null

  if (startOn) {
    const d = getDeviceById(layout, startOn)
    if (d && isBeltLike(d.typeId)) {
      const flow = beltInOutEdge(d)
      const shouldForceBeltContinue =
        !!flow && !hasBeltOutputLink(layout, d.instanceId, flow.outEdge) && canRewriteBeltFlow(flow.inEdge, startOutEdge)
      if (shouldForceBeltContinue && flow) {
        replacedIds.add(d.instanceId)
        nextDevices.push(createBeltAt(first.x, first.y, flow.inEdge, startOutEdge))
      } else {
        replacedIds.add(d.instanceId)
        nextDevices.push(
          createJunctionAt('item_log_splitter', first.x, first.y, flow ? rotationFromEdge('E', flow.inEdge) : 0),
        )
      }
    }
  } else if (startOnGhost) {
    const splitterInEdge = startGhostFlow?.inEdge ?? OPPOSITE_EDGE[startOutEdge]
    nextDevices.push(createJunctionAt('item_log_splitter', first.x, first.y, rotationFromEdge('E', splitterInEdge)))
  } else {
    nextDevices.push(createBeltAt(first.x, first.y, OPPOSITE_EDGE[startOutEdge], startOutEdge))
  }

  if (endOn) {
    const d = getDeviceById(layout, endOn)
    if (d && isBeltLike(d.typeId)) {
      const flow = beltInOutEdge(d)
      const shouldForceBeltConnect =
        !!flow && !hasBeltInputLink(layout, d.instanceId, flow.inEdge) && canRewriteBeltFlow(endInEdge, flow.outEdge)
      if (shouldForceBeltConnect && flow) {
        replacedIds.add(d.instanceId)
        nextDevices.push(createBeltAt(last.x, last.y, endInEdge, flow.outEdge))
      } else {
        replacedIds.add(d.instanceId)
        nextDevices.push(
          createJunctionAt('item_log_converger', last.x, last.y, flow ? rotationFromEdge('W', flow.outEdge) : 0),
        )
      }
    }
  } else if (endOnGhost) {
    const mergerOutEdge = endGhostFlow?.outEdge ?? OPPOSITE_EDGE[endInEdge]
    nextDevices.push(createJunctionAt('item_log_converger', last.x, last.y, rotationFromEdge('W', mergerOutEdge)))
  } else {
    nextDevices.push(createBeltAt(last.x, last.y, endInEdge, OPPOSITE_EDGE[endInEdge]))
  }

  for (let i = 1; i < path.length - 1; i += 1) {
    const current = path[i]
    const prev = path[i - 1]
    const next = path[i + 1]
    const inEdge = edgeFromDelta(prev.x - current.x, prev.y - current.y)
    const outEdge = edgeFromDelta(next.x - current.x, next.y - current.y)
    const currentKey = `${current.x},${current.y}`

    const occupyId = cellMap.get(`${current.x},${current.y}`)
    if (pathCrossSet.has(currentKey)) {
      if (currentKey === firstKey || currentKey === lastKey) {
        continue
      }
      const ghostFlow = ghostFlowAtCell(path, current)
      if (!isStraightFlow(ghostFlow)) {
        return layout
      }
      if (occupyId) {
        const existing = getDeviceById(layout, occupyId)
        if (existing && canCrossStraight(existing.typeId)) {
          replacedIds.add(existing.instanceId)
        } else if (!replacedIds.has(occupyId)) {
          return layout
        }
      }
      if (createdBridgeCells.has(currentKey)) {
        continue
      }
      nextDevices.push(createJunctionAt('item_log_connector', current.x, current.y, 0))
      createdBridgeCells.add(currentKey)
      continue
    }

    if (occupyId) {
      const existing = getDeviceById(layout, occupyId)
      if (existing && canCrossStraight(existing.typeId)) {
        replacedIds.add(existing.instanceId)
        if (createdBridgeCells.has(currentKey)) {
          continue
        }
        nextDevices.push(createJunctionAt('item_log_connector', current.x, current.y, 0))
        createdBridgeCells.add(currentKey)
        continue
      }
      if (existing && (existing.typeId === 'belt_turn_ccw_1x1' || existing.typeId === 'belt_turn_cw_1x1')) {
        return layout
      }
      if (!replacedIds.has(occupyId)) {
        return layout
      }
    }

    nextDevices.push(createBeltAt(current.x, current.y, inEdge, outEdge))
  }

  const filtered = nextDevices.filter((device) => !replacedIds.has(device.instanceId))
  const finalLayout: LayoutState = { ...layout, devices: filtered }

  return {
    ...finalLayout,
    devices: finalLayout.devices.filter((device) => isWithinLot(device, finalLayout.lotSize)),
  }
}
