import { DEVICE_TYPE_BY_ID, BELT_TYPES, RECIPES } from './registry'
import type {
  DeviceInstance,
  Direction,
  Edge,
  ItemId,
  LayoutState,
  OccupancyEntry,
  PortDef,
  PortLink,
  RotatedPort,
  Rotation,
} from './types'

export const EDGE_DELTA: Record<Edge, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
  E: { dx: 1, dy: 0 },
}

export const OPPOSITE_EDGE: Record<Edge, Edge> = {
  N: 'S',
  S: 'N',
  W: 'E',
  E: 'W',
}

export const EDGE_ANGLE: Record<Edge, number> = {
  E: 0,
  S: 90,
  W: 180,
  N: 270,
}

function rotatePoint(x: number, y: number, width: number, height: number, rotation: Rotation) {
  if (rotation === 0) return { x, y }
  if (rotation === 90) return { x: height - 1 - y, y: x }
  if (rotation === 180) return { x: width - 1 - x, y: height - 1 - y }
  return { x: y, y: width - 1 - x }
}

function rotateEdge(edge: Edge, rotation: Rotation): Edge {
  const order: Edge[] = ['N', 'E', 'S', 'W']
  const steps = rotation / 90
  const idx = order.indexOf(edge)
  return order[(idx + steps) % 4]
}

function boundaryKey(x: number, y: number, edge: Edge) {
  if (edge === 'E') return `${x},${y}|E`
  if (edge === 'W') return `${x - 1},${y}|E`
  if (edge === 'S') return `${x},${y}|S`
  return `${x},${y - 1}|S`
}

const RECIPE_INPUT_ITEM_IDS = new Set<ItemId>(RECIPES.flatMap((recipe) => recipe.inputs.map((entry) => entry.itemId)))
const RECIPE_OUTPUT_ITEM_IDS = new Set<ItemId>(RECIPES.flatMap((recipe) => recipe.outputs.map((entry) => entry.itemId)))

function allowedItemIds(port: RotatedPort): Set<ItemId> | 'any' {
  const mode = port.allowedItems.mode
  if (mode === 'any' || mode === 'recipe_items') return 'any'
  if (mode === 'recipe_inputs') return RECIPE_INPUT_ITEM_IDS
  if (mode === 'recipe_outputs') return RECIPE_OUTPUT_ITEM_IDS
  return new Set(port.allowedItems.whitelist)
}

export function isItemCompatible(output: RotatedPort, input: RotatedPort): boolean {
  if (output.allowedTypes.mode === 'liquid' || input.allowedTypes.mode === 'liquid') return false
  const outAllowed = allowedItemIds(output)
  const inAllowed = allowedItemIds(input)
  if (outAllowed === 'any' || inAllowed === 'any') return true
  for (const item of outAllowed) {
    if (inAllowed.has(item)) return true
  }
  return false
}

export function getFootprintCells(device: DeviceInstance) {
  const type = DEVICE_TYPE_BY_ID[device.typeId]
  if (!type) return []
  const cells: Array<{ x: number; y: number }> = []
  for (let y = 0; y < type.size.height; y += 1) {
    for (let x = 0; x < type.size.width; x += 1) {
      const p = rotatePoint(x, y, type.size.width, type.size.height, device.rotation)
      cells.push({ x: device.origin.x + p.x, y: device.origin.y + p.y })
    }
  }
  return cells
}

export function getRotatedPorts(device: DeviceInstance): RotatedPort[] {
  const type = DEVICE_TYPE_BY_ID[device.typeId]
  if (!type) return []
  return type.ports0.map((port: PortDef) => {
    const p = rotatePoint(port.localCellX, port.localCellY, type.size.width, type.size.height, device.rotation)
    return {
      instanceId: device.instanceId,
      typeId: device.typeId,
      portId: port.id,
      direction: port.direction,
      edge: rotateEdge(port.edge, device.rotation),
      x: device.origin.x + p.x,
      y: device.origin.y + p.y,
      allowedItems: port.allowedItems,
      allowedTypes: port.allowedTypes,
    }
  })
}

export function buildOccupancyMap(layout: LayoutState) {
  const byCell = new Map<string, OccupancyEntry[]>()
  for (const device of layout.devices) {
    for (const cell of getFootprintCells(device)) {
      const key = `${cell.x},${cell.y}`
      const bucket = byCell.get(key)
      const entry: OccupancyEntry = { ...cell, instanceId: device.instanceId }
      if (bucket) bucket.push(entry)
      else byCell.set(key, [entry])
    }
  }
  return byCell
}

export function detectOverlaps(layout: LayoutState) {
  const overlapIds = new Set<string>()
  for (const entries of buildOccupancyMap(layout).values()) {
    if (entries.length > 1) {
      for (const entry of entries) overlapIds.add(entry.instanceId)
    }
  }
  return overlapIds
}

export function isWithinLot(device: DeviceInstance, lotSize: number) {
  const footprint = getFootprintCells(device)
  if (footprint.length === 0) return false
  return footprint.every((cell) => cell.x >= 0 && cell.y >= 0 && cell.x < lotSize && cell.y < lotSize)
}

export function linksFromLayout(layout: LayoutState): PortLink[] {
  const allPorts = layout.devices.flatMap((device) => getRotatedPorts(device))
  const buckets = new Map<string, RotatedPort[]>()
  for (const port of allPorts) {
    const key = boundaryKey(port.x, port.y, port.edge)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(port)
    else buckets.set(key, [port])
  }

  const links: PortLink[] = []
  for (const ports of buckets.values()) {
    if (ports.length < 2) continue
    const outputs = ports.filter((port) => port.direction === 'Output')
    const inputs = ports.filter((port) => port.direction === 'Input')
    for (const output of outputs) {
      for (const input of inputs) {
        if (output.instanceId === input.instanceId) continue
        if (OPPOSITE_EDGE[output.edge] !== input.edge) continue
        if (!isItemCompatible(output, input)) continue
        links.push({ from: output, to: input })
      }
    }
  }
  return links
}

export function neighborsFromLinks(layout: LayoutState) {
  const links = linksFromLayout(layout)
  const outMap = new Map<string, PortLink[]>()
  const inMap = new Map<string, PortLink[]>()
  for (const link of links) {
    const outBucket = outMap.get(link.from.instanceId)
    if (outBucket) outBucket.push(link)
    else outMap.set(link.from.instanceId, [link])
    const inBucket = inMap.get(link.to.instanceId)
    if (inBucket) inBucket.push(link)
    else inMap.set(link.to.instanceId, [link])
  }
  return { outMap, inMap, links }
}

export function cellToDeviceId(layout: LayoutState) {
  const cellMap = new Map<string, string>()
  for (const device of layout.devices) {
    for (const cell of getFootprintCells(device)) {
      cellMap.set(`${cell.x},${cell.y}`, device.instanceId)
    }
  }
  return cellMap
}

export function getDeviceById(layout: LayoutState, instanceId: string) {
  return layout.devices.find((device) => device.instanceId === instanceId) ?? null
}

export function isBeltLike(typeId: string) {
  return BELT_TYPES.has(typeId)
}

export function edgeFromDelta(dx: number, dy: number): Edge {
  if (dx === 1 && dy === 0) return 'E'
  if (dx === -1 && dy === 0) return 'W'
  if (dx === 0 && dy === 1) return 'S'
  return 'N'
}

export function directionFromEdges(inEdge: Edge, outEdge: Edge): { typeId: string; rotation: Rotation } {
  const inDir = EDGE_ANGLE[inEdge]
  const outDir = EDGE_ANGLE[outEdge]
  if ((inDir + 180) % 360 === outDir) {
    return {
      typeId: 'belt_straight_1x1',
      rotation: (outDir as Rotation),
    }
  }

  const rotMap: Array<{ inEdge: Edge; outEdge: Edge; cw: Rotation }> = [
    { inEdge: 'N', outEdge: 'E', cw: 0 },
    { inEdge: 'E', outEdge: 'S', cw: 90 },
    { inEdge: 'S', outEdge: 'W', cw: 180 },
    { inEdge: 'W', outEdge: 'N', cw: 270 },
  ]

  for (const map of rotMap) {
    if (map.inEdge === inEdge && map.outEdge === outEdge) {
      return { typeId: 'belt_turn_cw_1x1', rotation: map.cw }
    }
  }

  const ccwRotMap: Array<{ inEdge: Edge; outEdge: Edge; ccw: Rotation }> = [
    { inEdge: 'N', outEdge: 'W', ccw: 0 },
    { inEdge: 'E', outEdge: 'N', ccw: 90 },
    { inEdge: 'S', outEdge: 'E', ccw: 180 },
    { inEdge: 'W', outEdge: 'S', ccw: 270 },
  ]

  for (const map of ccwRotMap) {
    if (map.inEdge === inEdge && map.outEdge === outEdge) {
      return { typeId: 'belt_turn_ccw_1x1', rotation: map.ccw }
    }
  }

  return { typeId: 'belt_straight_1x1', rotation: 0 }
}

export function includesCell(device: DeviceInstance, x: number, y: number) {
  return getFootprintCells(device).some((cell) => cell.x === x && cell.y === y)
}

export function inferPortDirection(portId: string): Direction {
  return portId.startsWith('in_') ? 'Input' : 'Output'
}
