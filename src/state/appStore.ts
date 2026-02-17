import {
  buildBeltPath,
  createBeltCells,
  deleteBeltCell,
  deleteConnectedComponent,
} from "../core/belts"
import {
  createMachine,
  getMachinePorts,
  isMachinePowered,
  recalculatePlacementStates,
  rotateMachine,
} from "../core/machines"
import { fullRuntimeReset } from "../core/simulation"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import {
  BUILDING_PROTOTYPE_MAP,
  BUILDING_PROTOTYPES,
  DEFAULT_EXTERNAL_INVENTORY,
  DEFAULT_GRID_SIZE,
  type AppMode,
  type BeltCell,
  type BeltEdge,
  type BeltSegment,
  type BeltTransitItem,
  type BuildingPrototypeId,
  type GridPoint,
  type GridSize,
  type ItemId,
  type LogisticsMode,
  type MachineInstance,
  type MachinePort,
  type MachineRuntimeState,
  type MachineRuntimeStatus,
  type PortDirection,
  type PickupPortConfig,
  type PlotSnapshot,
  type SimulationSpeed,
} from "../types/domain"

type ItemWindow = Record<ItemId, number[]>

type AppState = {
  mode: AppMode
  speed: SimulationSpeed
  selectedGridSize: GridSize
  externalInventory: Record<ItemId, number>
  productionPerMin: Record<ItemId, number>
  consumptionPerMin: Record<ItemId, number>
  machineProgress: Record<string, number>
  machineInternal: Record<string, number>
  beltInTransit: Record<string, number>
  beltTransitItems: BeltTransitItem[]
  beltEmitCooldown: Record<string, number>
  machineRuntime: Record<string, MachineRuntimeState>
  tickCount: number
  productionWindow: ItemWindow
  consumptionWindow: ItemWindow

  machines: MachineInstance[]
  pickupPortConfigs: Record<string, PickupPortConfig>
  selectedMachineId: string | null
  activePrototypeId: BuildingPrototypeId
  interactionMode: "place" | "idle" | "delete" | "logistics"

  logisticsMode: LogisticsMode
  beltCells: BeltCell[]
  beltEdges: BeltEdge[]
  beltSegments: BeltSegment[]
  beltDrawStart: GridPoint | null
  beltDragLast: GridPoint | null
  beltDragTrace: GridPoint[]
  beltDragBaseCells: BeltCell[]
  beltDragBaseSegments: BeltSegment[]
  beltDeleteMode: "by_cell" | "by_connected_component"
  selectedBeltSegmentKey: string | null
  toastMessage: string | null

  plotSaves: Partial<Record<GridSize, PlotSnapshot>>

  startSimulation: () => void
  stopSimulationAndResetAll: () => void
  setSpeed: (speed: SimulationSpeed) => void
  setGridSize: (size: GridSize) => void
  resetAllRuntime: () => void
  stepSimulationTick: () => void

  setActivePrototype: (prototypeId: BuildingPrototypeId) => void
  setInteractionMode: (mode: "place" | "idle" | "delete" | "logistics") => void
  placeMachineAt: (x: number, y: number) => void
  deleteMachineById: (machineId: string) => void
  deleteAllMachines: () => void
  selectMachine: (machineId: string | null) => void
  moveMachine: (machineId: string, x: number, y: number) => void
  rotateSelectedMachine: () => void
  deleteSelectedMachine: () => void
  setPickupPortSelectedItem: (machineId: string, itemId: ItemId | null) => void

  setLogisticsMode: (mode: LogisticsMode) => void
  startBeltDrag: (x: number, y: number) => void
  extendBeltDrag: (x: number, y: number) => void
  finishBeltDrag: () => void
  cancelBeltDraw: () => void
  setBeltDeleteMode: (mode: "by_cell" | "by_connected_component") => void
  selectBeltSegment: (segmentKey: string | null) => void
  deleteBeltAt: (x: number, y: number) => void
  clearToast: () => void
}

const initial = fullRuntimeReset()

const emptyPlot = (): PlotSnapshot => ({
  machines: [],
  beltCells: [],
  beltEdges: [],
  beltSegments: [],
  pickupPortConfigs: {},
})

const cloneSnapshot = (snapshot: PlotSnapshot): PlotSnapshot => ({
  machines: snapshot.machines.map((machine) => ({ ...machine })),
  beltCells: snapshot.beltCells.map((cell) => ({ ...cell })),
  beltEdges: snapshot.beltEdges.map((edge) => ({
    ...edge,
    from: { ...edge.from },
    to: { ...edge.to },
    path: edge.path.map((point) => ({ ...point })),
  })),
  beltSegments: snapshot.beltSegments.map((segment) => ({
    ...segment,
    from: { ...segment.from },
    to: { ...segment.to },
  })),
  pickupPortConfigs: Object.fromEntries(
    Object.entries(snapshot.pickupPortConfigs).map(([machineId, config]) => [
      machineId,
      {
        ...config,
      },
    ]),
  ),
})

function emptyWindow(): ItemWindow {
  return {
    originium_ore: [],
    originium_powder: [],
  }
}

function pushWindow(window: ItemWindow, itemId: ItemId, count: number): ItemWindow {
  const next = {
    ...window,
    [itemId]: [...window[itemId], count],
  }
  if (next[itemId].length > 600) {
    next[itemId] = next[itemId].slice(next[itemId].length - 600)
  }
  return next
}

function sumWindow(values: number[]): number {
  return values.reduce((accumulator, value) => accumulator + value, 0)
}

function pointKey(point: GridPoint): string {
  return `${point.x},${point.y}`
}

function normalizeTrace(trace: GridPoint[]): GridPoint[] {
  if (trace.length === 0) {
    return []
  }

  const normalized: GridPoint[] = [trace[0]]
  for (let index = 1; index < trace.length; index += 1) {
    const current = trace[index]
    const previous = normalized[normalized.length - 1]
    if (current.x === previous.x && current.y === previous.y) {
      continue
    }
    normalized.push(current)
  }

  return normalized
}

function appendUniqueBeltCells(existing: BeltCell[], points: GridPoint[]): BeltCell[] {
  if (points.length === 0) {
    return existing
  }

  const existingKeys = new Set(existing.map((cell) => pointKey(cell)))
  const newPoints = points.filter((point) => !existingKeys.has(pointKey(point)))
  if (newPoints.length === 0) {
    return existing
  }

  return [...existing, ...createBeltCells(newPoints)]
}

function getSegmentKey(from: GridPoint, to: GridPoint): string {
  const a = `${from.x},${from.y}`
  const b = `${to.x},${to.y}`
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function appendSegmentsFromPath(existing: BeltSegment[], path: GridPoint[]): BeltSegment[] {
  if (path.length < 2) {
    return existing
  }

  const existingKeys = new Set(existing.map((segment) => getSegmentKey(segment.from, segment.to)))
  const appended: BeltSegment[] = []

  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1]
    const to = path[index]
    const key = getSegmentKey(from, to)
    if (existingKeys.has(key)) {
      continue
    }

    existingKeys.add(key)
    appended.push({
      id: `s_${Date.now()}_${index}_${Math.floor(Math.random() * 100000)}`,
      from: { ...from },
      to: { ...to },
    })
  }

  if (appended.length === 0) {
    return existing
  }

  return [...existing, ...appended]
}

function hasSameSegment(segments: BeltSegment[], from: GridPoint, to: GridPoint): boolean {
  const target = getSegmentKey(from, to)
  return segments.some((segment) => getSegmentKey(segment.from, segment.to) === target)
}

function getNodeFlowStats(segments: BeltSegment[], point: GridPoint): {
  degree: number
  inCount: number
  outCount: number
} {
  let degree = 0
  let inCount = 0
  let outCount = 0

  segments.forEach((segment) => {
    const touchesFrom = segment.from.x === point.x && segment.from.y === point.y
    const touchesTo = segment.to.x === point.x && segment.to.y === point.y
    if (!touchesFrom && !touchesTo) {
      return
    }

    degree += 1
    if (touchesFrom) {
      outCount += 1
    }
    if (touchesTo) {
      inCount += 1
    }
  })

  return {
    degree,
    inCount,
    outCount,
  }
}

function isTurnOrEndpointUsage(trace: GridPoint[], point: GridPoint): boolean {
  if (trace.length === 0) {
    return false
  }

  for (let index = 0; index < trace.length; index += 1) {
    const current = trace[index]
    if (current.x !== point.x || current.y !== point.y) {
      continue
    }

    if (index === 0 || index === trace.length - 1) {
      return true
    }

    const prev = trace[index - 1]
    const next = trace[index + 1]
    const prevHorizontal = prev.y === current.y
    const nextHorizontal = next.y === current.y
    if (prevHorizontal !== nextHorizontal) {
      return true
    }
  }

  return false
}

function violatesCrossJunctionByUsage(
  _baseSegments: BeltSegment[],
  currentSegments: BeltSegment[],
  candidateSegments: BeltSegment[],
  candidateTrace: GridPoint[],
  point: GridPoint,
): boolean {
  const before = getNodeFlowStats(currentSegments, point)
  const after = getNodeFlowStats(candidateSegments, point)

  if (after.degree !== 4 || before.degree >= 4) {
    return false
  }

  if (!isTurnOrEndpointUsage(candidateTrace, point)) {
    return false
  }

  return !(after.inCount === 1 || after.outCount === 1)
}

function isCornerPointInSegments(segments: BeltSegment[], point: GridPoint): boolean {
  let hasHorizontal = false
  let hasVertical = false
  let degree = 0

  segments.forEach((segment) => {
    const touchesFrom = segment.from.x === point.x && segment.from.y === point.y
    const touchesTo = segment.to.x === point.x && segment.to.y === point.y
    if (!touchesFrom && !touchesTo) {
      return
    }

    degree += 1
    if (segment.from.y === segment.to.y) {
      hasHorizontal = true
    }
    if (segment.from.x === segment.to.x) {
      hasVertical = true
    }
  })

  return degree === 2 && hasHorizontal && hasVertical
}

function violatesHeadOnCollisionAtPoint(segments: BeltSegment[], point: GridPoint): boolean {
  let degree = 0
  let incomingFromLeft = false
  let incomingFromRight = false
  let incomingFromUp = false
  let incomingFromDown = false

  let outgoingToLeft = false
  let outgoingToRight = false
  let outgoingToUp = false
  let outgoingToDown = false

  segments.forEach((segment) => {
    const touchesFrom = segment.from.x === point.x && segment.from.y === point.y
    const touchesTo = segment.to.x === point.x && segment.to.y === point.y
    if (!touchesFrom && !touchesTo) {
      return
    }

    degree += 1

    if (touchesTo) {
      const source = segment.from
      if (source.x < point.x) incomingFromLeft = true
      if (source.x > point.x) incomingFromRight = true
      if (source.y < point.y) incomingFromUp = true
      if (source.y > point.y) incomingFromDown = true
    }

    if (touchesFrom) {
      const target = segment.to
      if (target.x < point.x) outgoingToLeft = true
      if (target.x > point.x) outgoingToRight = true
      if (target.y < point.y) outgoingToUp = true
      if (target.y > point.y) outgoingToDown = true
    }
  })

  if (degree !== 2) {
    return false
  }

  const horizontalHeadOn =
    (incomingFromLeft && incomingFromRight) || (outgoingToLeft && outgoingToRight)
  const verticalHeadOn =
    (incomingFromUp && incomingFromDown) || (outgoingToUp && outgoingToDown)

  return horizontalHeadOn || verticalHeadOn
}

function deriveSegmentsFromCells(cells: BeltCell[]): BeltSegment[] {
  const keyOf = (x: number, y: number) => `${x},${y}`
  const cellSet = new Set(cells.map((cell) => keyOf(cell.x, cell.y)))
  const segments: BeltSegment[] = []

  cells.forEach((cell, index) => {
    const right = { x: cell.x + 1, y: cell.y }
    if (cellSet.has(keyOf(right.x, right.y))) {
      segments.push({
        id: `m_r_${cell.x}_${cell.y}_${index}`,
        from: { x: cell.x, y: cell.y },
        to: right,
      })
    }

    const down = { x: cell.x, y: cell.y + 1 }
    if (cellSet.has(keyOf(down.x, down.y))) {
      segments.push({
        id: `m_d_${cell.x}_${cell.y}_${index}`,
        from: { x: cell.x, y: cell.y },
        to: down,
      })
    }
  })

  return segments
}

function deriveSegmentsFromEdges(edges: BeltEdge[]): BeltSegment[] {
  const keys = new Set<string>()
  const segments: BeltSegment[] = []

  edges.forEach((edge, edgeIndex) => {
    for (let index = 1; index < edge.path.length; index += 1) {
      const from = edge.path[index - 1]
      const to = edge.path[index]
      const key = getSegmentKey(from, to)
      if (keys.has(key)) {
        continue
      }

      keys.add(key)
      segments.push({
        id: `e_s_${edgeIndex}_${index}_${Math.floor(Math.random() * 100000)}`,
        from: { ...from },
        to: { ...to },
      })
    }
  })

  return segments
}

function deriveCellsFromTrace(trace: GridPoint[], machines: MachineInstance[]): GridPoint[] {
  if (trace.length <= 1) {
    return []
  }

  const used = new Set<string>()
  const points: GridPoint[] = []

  for (let index = 1; index < trace.length; index += 1) {
    const point = trace[index]
    if (getPortAtPoint(machines, point)) {
      continue
    }
    const key = pointKey(point)
    if (used.has(key)) {
      continue
    }

    used.add(key)
    points.push(point)
  }

  return points
}

function isWithinGrid(point: GridPoint, selectedGridSize: GridSize): boolean {
  return (
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < selectedGridSize &&
    point.y < selectedGridSize
  )
}

function getPortAtPoint(machines: MachineInstance[], point: GridPoint) {
  for (const machine of machines) {
    const ports = getMachinePorts(machine)
    const found = ports.find((port) => port.x === point.x && port.y === point.y)
    if (found) {
      return found
    }
  }

  return null
}

function stepDirection(from: GridPoint, to: GridPoint): PortDirection | null {
  const dx = to.x - from.x
  const dy = to.y - from.y

  if (dx === 1 && dy === 0) {
    return "+x"
  }
  if (dx === -1 && dy === 0) {
    return "-x"
  }
  if (dx === 0 && dy === 1) {
    return "+y"
  }
  if (dx === 0 && dy === -1) {
    return "-y"
  }
  return null
}

function isEnterDirectionValid(direction: PortDirection, from: GridPoint, to: GridPoint): boolean {
  return stepDirection(from, to) === direction
}

function isExitDirectionValid(direction: PortDirection, from: GridPoint, to: GridPoint): boolean {
  return stepDirection(from, to) === direction
}

function createCellsFromSegments(segments: BeltSegment[], machines: MachineInstance[]): BeltCell[] {
  const unique = new Map<string, GridPoint>()

  segments.forEach((segment) => {
    const points = [segment.from, segment.to]
    points.forEach((point) => {
      if (!getPortAtPoint(machines, point)) {
        unique.set(pointKey(point), point)
      }
    })
  })

  return createBeltCells(Array.from(unique.values()))
}

function getOtherEndpoint(segment: BeltSegment, point: GridPoint): GridPoint | null {
  if (segment.from.x === point.x && segment.from.y === point.y) {
    return segment.to
  }
  if (segment.to.x === point.x && segment.to.y === point.y) {
    return segment.from
  }
  return null
}

function getNodeDegree(segments: BeltSegment[], point: GridPoint): number {
  return segments.reduce((count, segment) => {
    const touches =
      (segment.from.x === point.x && segment.from.y === point.y) ||
      (segment.to.x === point.x && segment.to.y === point.y)
    return count + (touches ? 1 : 0)
  }, 0)
}

function isCrossingNode(segments: BeltSegment[], point: GridPoint): boolean {
  let horizontal = 0
  let vertical = 0
  let degree = 0

  segments.forEach((segment) => {
    const touches =
      (segment.from.x === point.x && segment.from.y === point.y) ||
      (segment.to.x === point.x && segment.to.y === point.y)
    if (!touches) {
      return
    }

    degree += 1
    if (segment.from.y === segment.to.y) {
      horizontal += 1
    }
    if (segment.from.x === segment.to.x) {
      vertical += 1
    }
  })

  return degree === 4 && horizontal === 2 && vertical === 2
}

function selectNextSegmentsOnDelete(
  segments: BeltSegment[],
  prev: GridPoint,
  current: GridPoint,
): BeltSegment[] {
  const incident = segments.filter((segment) => {
    const touchesCurrent =
      (segment.from.x === current.x && segment.from.y === current.y) ||
      (segment.to.x === current.x && segment.to.y === current.y)
    if (!touchesCurrent) {
      return false
    }

    const other = getOtherEndpoint(segment, current)
    if (!other) {
      return false
    }

    return !(other.x === prev.x && other.y === prev.y)
  })

  const degree = getNodeDegree(segments, current)
  if (degree === 3) {
    return []
  }

  if (isCrossingNode(segments, current)) {
    const incomingDx = current.x - prev.x
    const incomingDy = current.y - prev.y
    return incident.filter((segment) => {
      const other = getOtherEndpoint(segment, current)
      if (!other) {
        return false
      }
      const outDx = other.x - current.x
      const outDy = other.y - current.y
      return outDx === incomingDx && outDy === incomingDy
    })
  }

  return incident
}

function deleteBeltLineByRules(segments: BeltSegment[], start: GridPoint): BeltSegment[] {
  const startIncident = segments.filter(
    (segment) =>
      (segment.from.x === start.x && segment.from.y === start.y) ||
      (segment.to.x === start.x && segment.to.y === start.y),
  )

  if (startIncident.length === 0) {
    return segments
  }

  const removedIds = new Set<string>()
  const queue: Array<{ prev: GridPoint; current: GridPoint }> = []

  startIncident.forEach((segment) => {
    removedIds.add(segment.id)
    const other = getOtherEndpoint(segment, start)
    if (other) {
      queue.push({ prev: start, current: other })
    }
  })

  while (queue.length > 0) {
    const task = queue.shift()
    if (!task) {
      continue
    }

    const nextSegments = selectNextSegmentsOnDelete(segments, task.prev, task.current)
    nextSegments.forEach((segment) => {
      if (removedIds.has(segment.id)) {
        return
      }

      removedIds.add(segment.id)
      const nextPoint = getOtherEndpoint(segment, task.current)
      if (nextPoint) {
        queue.push({ prev: task.current, current: nextPoint })
      }
    })
  }

  return segments.filter((segment) => !removedIds.has(segment.id))
}

function hasMachineBodyAtPoint(machines: MachineInstance[], point: GridPoint): boolean {
  return machines.some(
    (machine) =>
      point.x >= machine.x &&
      point.x < machine.x + machine.w &&
      point.y >= machine.y &&
      point.y < machine.y + machine.h,
  )
}

function resetRuntimeOnly(state: AppState) {
  const reset = fullRuntimeReset()
  const cleanedMachines = state.machines.map((machine) => ({
    ...machine,
    progressTick: 0,
  }))

  return {
    externalInventory: { ...DEFAULT_EXTERNAL_INVENTORY },
    productionPerMin: reset.productionPerMin,
    consumptionPerMin: reset.consumptionPerMin,
    machineProgress: {},
    machineInternal: reset.runtimeStock.machineInternal,
    beltInTransit: reset.runtimeStock.beltInTransit,
    beltTransitItems: [],
    beltEmitCooldown: {},
    machineRuntime: {},
    tickCount: 0,
    productionWindow: emptyWindow(),
    consumptionWindow: emptyWindow(),
    machines: cleanedMachines,
    selectedMachineId: null,
    logisticsMode: "none" as const,
    beltDrawStart: null,
    beltDragLast: null,
    beltDragTrace: [],
    beltDragBaseCells: [],
    beltDragBaseSegments: [],
    toastMessage: null,
  }
}

function needsPower(machine: MachineInstance): boolean {
  return machine.prototypeId === "crusher_3x3" || machine.prototypeId === "storage_box_3x3"
}

const BELT_TICKS_PER_CELL = 20

function machineInputKey(machineId: string, itemId: ItemId): string {
  return `${machineId}:in:${itemId}`
}

function machineOutputKey(machineId: string, itemId: ItemId): string {
  return `${machineId}:out:${itemId}`
}

function getMachineInputStoredTotal(machineId: string, machineInternal: Record<string, number>): number {
  const prefix = `${machineId}:in:`
  return Object.entries(machineInternal).reduce((sum, [key, value]) => {
    if (!key.startsWith(prefix)) {
      return sum
    }
    return sum + value
  }, 0)
}

function getMachineOutputStoredTotal(machineId: string, machineInternal: Record<string, number>): number {
  const prefix = `${machineId}:out:`
  return Object.entries(machineInternal).reduce((sum, [key, value]) => {
    if (!key.startsWith(prefix)) {
      return sum
    }
    return sum + value
  }, 0)
}

function buildOutgoingMap(segments: BeltSegment[]): Map<string, GridPoint[]> {
  const outgoing = new Map<string, GridPoint[]>()
  segments.forEach((segment) => {
    const key = pointKey(segment.from)
    const current = outgoing.get(key) ?? []
    if (!current.some((point) => point.x === segment.to.x && point.y === segment.to.y)) {
      outgoing.set(key, [...current, segment.to])
    }
  })

  return outgoing
}

function buildPortMaps(machines: MachineInstance[]) {
  const outPorts = machines.flatMap((machine) =>
    getMachinePorts(machine).filter((port) => port.type === "out"),
  )
  const inPorts = machines.flatMap((machine) =>
    getMachinePorts(machine).filter((port) => port.type === "in"),
  )

  const inPortByPoint = new Map<string, (typeof inPorts)[number]>()
  inPorts.forEach((port) => {
    inPortByPoint.set(`${port.x},${port.y}`, port)
  })

  return {
    outPorts,
    inPortByPoint,
  }
}

function pickNextPoint(candidates: GridPoint[]): GridPoint | null {
  if (candidates.length === 0) {
    return null
  }

  const sorted = [...candidates].sort((a, b) => {
    if (a.y !== b.y) {
      return a.y - b.y
    }
    return a.x - b.x
  })

  return sorted[0] ?? null
}

function buildPathFromOutputPort(
  start: GridPoint,
  outgoing: Map<string, GridPoint[]>,
  inPortByPoint: Map<string, MachinePort>,
): GridPoint[] {
  const path: GridPoint[] = [{ ...start }]
  const visited = new Set<string>()
  visited.add(pointKey(start))

  let current = start
  for (let step = 0; step < 600; step += 1) {
    const nextCandidates = outgoing.get(pointKey(current)) ?? []
    const next = pickNextPoint(nextCandidates)
    if (!next) {
      break
    }

    path.push({ ...next })
    const nextKey = pointKey(next)
    if (inPortByPoint.has(nextKey)) {
      break
    }

    if (visited.has(nextKey)) {
      break
    }

    visited.add(nextKey)
    current = next
  }

  return path
}

function rebuildBeltEdgesFromSegments(
  machines: MachineInstance[],
  segments: BeltSegment[],
): BeltEdge[] {
  const outgoing = buildOutgoingMap(segments)
  const { outPorts, inPortByPoint } = buildPortMaps(machines)

  const nextEdges: BeltEdge[] = []
  outPorts.forEach((outPort) => {
    const path = buildPathFromOutputPort(
      { x: outPort.x, y: outPort.y },
      outgoing,
      inPortByPoint,
    )

    if (path.length < 2) {
      return
    }

    const end = path[path.length - 1]
    if (!end) {
      return
    }

    const endInPort = inPortByPoint.get(pointKey(end))
    if (!endInPort) {
      return
    }

    const duplicate = nextEdges.some(
      (edge) =>
        edge.from.machineId === outPort.machineId &&
        edge.from.portId === outPort.portId &&
        edge.to.machineId === endInPort.machineId &&
        edge.to.portId === endInPort.portId,
    )
    if (duplicate) {
      return
    }

    nextEdges.push({
      id: `e_auto_${outPort.machineId}_${outPort.portId}_${endInPort.machineId}_${endInPort.portId}`,
      from: {
        machineId: outPort.machineId,
        portId: outPort.portId,
      },
      to: {
        machineId: endInPort.machineId,
        portId: endInPort.portId,
      },
      path,
    })
  })

  return nextEdges
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      mode: "edit",
      speed: 1,
      selectedGridSize: DEFAULT_GRID_SIZE,
      externalInventory: initial.externalInventory,
      productionPerMin: initial.productionPerMin,
      consumptionPerMin: initial.consumptionPerMin,
      machineProgress: initial.machineProgress,
      machineInternal: initial.runtimeStock.machineInternal,
      beltInTransit: initial.runtimeStock.beltInTransit,
      beltTransitItems: [],
      beltEmitCooldown: {},
      machineRuntime: {},
      tickCount: 0,
      productionWindow: emptyWindow(),
      consumptionWindow: emptyWindow(),

      machines: [],
      pickupPortConfigs: {},
      selectedMachineId: null,
      activePrototypeId: BUILDING_PROTOTYPES[0].id,
      interactionMode: "idle",

      logisticsMode: "none",
      beltCells: [],
      beltEdges: [],
      beltSegments: [],
      beltDrawStart: null,
      beltDragLast: null,
      beltDragTrace: [],
      beltDragBaseCells: [],
      beltDragBaseSegments: [],
      beltDeleteMode: "by_cell",
      selectedBeltSegmentKey: null,
      toastMessage: null,

      plotSaves: {
        60: emptyPlot(),
      },

      startSimulation: () =>
        set((state) => {
          const pickupPorts = state.machines.filter(
            (machine) => machine.prototypeId === "pickup_port_3x1",
          )
          const hasOreSelectedPickup = pickupPorts.some(
            (pickup) => state.pickupPortConfigs[pickup.id]?.selectedItemId === "originium_ore",
          )

          const hasAnyPowerPole = state.machines.some(
            (machine) => machine.prototypeId === "power_pole_2x2",
          )
          const hasMachineNeedsPower = state.machines.some(
            (machine) => machine.prototypeId === "crusher_3x3" || machine.prototypeId === "storage_box_3x3",
          )

          let toastMessage = "仿真已开始（10Hz）"
          if (!hasOreSelectedPickup) {
            toastMessage = "仿真已开始：取货口未选择“源石矿”，产线不会出料"
          } else if (hasMachineNeedsPower && !hasAnyPowerPole) {
            toastMessage = "仿真已开始：缺少供电桩，需供电后机器才能运行"
          }

          const rebuiltEdges = rebuildBeltEdgesFromSegments(state.machines, state.beltSegments)

          return {
            mode: "simulate",
            beltEdges: rebuiltEdges,
            interactionMode: "idle",
            logisticsMode: "none",
            beltDrawStart: null,
            beltDragLast: null,
            beltDragTrace: [],
            beltDragBaseCells: [],
            beltDragBaseSegments: [],
            toastMessage,
          }
        }),
      stopSimulationAndResetAll: () =>
        set((state) => ({
          mode: "edit",
          speed: 1,
          ...resetRuntimeOnly(state),
          toastMessage: "已退出仿真并清空运行态数据",
        })),
      setSpeed: (speed) => set({ speed }),
      setGridSize: (size) =>
        set((state) => {
          if (state.mode !== "edit") {
            return {
              toastMessage: "仿真模式下禁止切换地块尺寸",
            }
          }

          if (size === state.selectedGridSize) {
            return state
          }

          const currentSize = state.selectedGridSize
          const currentSnapshot: PlotSnapshot = {
            machines: state.machines,
            beltCells: state.beltCells,
            beltEdges: state.beltEdges,
            beltSegments: state.beltSegments,
            pickupPortConfigs: state.pickupPortConfigs,
          }

          const targetSnapshot = state.plotSaves[size] ?? emptyPlot()

          return {
            selectedGridSize: size,
            plotSaves: {
              ...state.plotSaves,
              [currentSize]: cloneSnapshot(currentSnapshot),
              [size]: cloneSnapshot(targetSnapshot),
            },
            machines: recalculatePlacementStates(cloneSnapshot(targetSnapshot).machines, size),
            beltCells: cloneSnapshot(targetSnapshot).beltCells,
            beltEdges: cloneSnapshot(targetSnapshot).beltEdges,
            beltSegments: cloneSnapshot(targetSnapshot).beltSegments,
            pickupPortConfigs: cloneSnapshot(targetSnapshot).pickupPortConfigs,
            selectedMachineId: null,
            beltDrawStart: null,
            beltDragLast: null,
            beltDragTrace: [],
            toastMessage: state.plotSaves[size]
              ? `已加载 ${size}x${size} 地块存档`
              : `已创建并加载 ${size}x${size} 空地块`,
          }
        }),
      resetAllRuntime: () =>
        set((state) => ({
          ...resetRuntimeOnly(state),
          toastMessage: "已清空运行态数据",
        })),
      stepSimulationTick: () =>
        set((state) => {
          if (state.mode !== "simulate") {
            return state
          }

          let producedPowder = 0
          let consumedOre = 0
          const runtime: Record<string, MachineRuntimeState> = {}

          const nextMachineInternal: Record<string, number> = { ...state.machineInternal }
          const outgoing = buildOutgoingMap(state.beltSegments)
          const { outPorts, inPortByPoint } = buildPortMaps(state.machines)
          const rebuiltEdges = rebuildBeltEdgesFromSegments(state.machines, state.beltSegments)

          const beltCellKeys = new Set(state.beltCells.map((cell) => `${cell.x},${cell.y}`))
          const occupiedCellKeys = new Set<string>()

          const isCellPoint = (point: GridPoint): boolean => beltCellKeys.has(`${point.x},${point.y}`)

          const currentCellKeyOfItem = (item: BeltTransitItem): string | null => {
            if (item.path.length === 0) {
              return null
            }
            const currentPoint = item.path[Math.min(item.stepIndex, item.path.length - 1)]
            if (!currentPoint || !isCellPoint(currentPoint)) {
              return null
            }
            return pointKey(currentPoint)
          }

          state.beltTransitItems.forEach((item) => {
            const cellKey = currentCellKeyOfItem(item)
            if (cellKey) {
              occupiedCellKeys.add(cellKey)
            }
          })

          const cooldownAfterDecay: Record<string, number> = {}
          Object.entries(state.beltEmitCooldown).forEach(([portKey, cooldown]) => {
            cooldownAfterDecay[portKey] = Math.max(0, cooldown - 1)
          })

          const movedItems: BeltTransitItem[] = []
          const itemsToUpdate = [...state.beltTransitItems]

          const removeCurrentCellOccupancy = (item: BeltTransitItem) => {
            const currentPoint = item.path[Math.min(item.stepIndex, item.path.length - 1)]
            if (currentPoint && isCellPoint(currentPoint)) {
              occupiedCellKeys.delete(pointKey(currentPoint))
            }
          }

          itemsToUpdate.forEach((item) => {
            if (item.path.length < 2) {
              return
            }

            const isAtPathEnd = item.stepIndex >= item.path.length - 1
            if (isAtPathEnd) {
              movedItems.push(item)
              return
            }

            const nextTick = item.stepTick + 1
            if (nextTick < BELT_TICKS_PER_CELL) {
              movedItems.push({
                ...item,
                stepTick: nextTick,
              })
              return
            }

            const nextIndex = Math.min(item.stepIndex + 1, item.path.length - 1)
            const nextPoint = item.path[nextIndex]
            const currentPoint = item.path[item.stepIndex]
            if (!nextPoint || !currentPoint) {
              movedItems.push(item)
              return
            }

            const nextIsCell = isCellPoint(nextPoint)
            const nextCellKey = pointKey(nextPoint)

            if (nextIsCell && occupiedCellKeys.has(nextCellKey)) {
              movedItems.push(item)
              return
            }

            removeCurrentCellOccupancy(item)
            if (nextIsCell) {
              occupiedCellKeys.add(nextCellKey)
            }

            const arrivedInPort = inPortByPoint.has(nextCellKey)
            if (arrivedInPort) {
              const inPort = inPortByPoint.get(nextCellKey)
              if (inPort) {
                const targetMachine = state.machines.find((entry) => entry.id === inPort.machineId)
                if (targetMachine?.prototypeId === "crusher_3x3") {
                  const inputCapacity =
                    BUILDING_PROTOTYPE_MAP[targetMachine.prototypeId].inputStorageCapacity ?? 0
                  const inputStored = getMachineInputStoredTotal(targetMachine.id, nextMachineInternal)
                  if (inputStored >= inputCapacity) {
                    movedItems.push(item)
                    return
                  }

                  const arriveKey = machineInputKey(inPort.machineId, item.itemId)
                  nextMachineInternal[arriveKey] = (nextMachineInternal[arriveKey] ?? 0) + 1
                }
              }
              return
            }

            movedItems.push({
              ...item,
              stepIndex: nextIndex,
              stepTick: 0,
            })
          })

          const emittedItems: BeltTransitItem[] = []

          outPorts.forEach((outPort) => {
            const outKey = `${outPort.machineId}:${outPort.portId}`
            const cooldown = cooldownAfterDecay[outKey] ?? 0
            if (cooldown > 0) {
              return
            }

            const machine = state.machines.find((entry) => entry.id === outPort.machineId)
            if (!machine) {
              return
            }

            let itemId: ItemId | null = null
            let sourceKey: string | null = null
            if (machine.prototypeId === "pickup_port_3x1") {
              itemId = state.pickupPortConfigs[machine.id]?.selectedItemId ?? null
            } else if (machine.prototypeId === "crusher_3x3") {
              itemId = "originium_powder"
              sourceKey = machineOutputKey(machine.id, itemId)
            }

            if (!itemId) {
              return
            }

            const path = buildPathFromOutputPort(
              { x: outPort.x, y: outPort.y },
              outgoing,
              inPortByPoint,
            )
            if (path.length < 2) {
              return
            }

            const firstCell = path[1]
            if (!firstCell || !isCellPoint(firstCell)) {
              return
            }

            const firstCellKey = pointKey(firstCell)
            if (occupiedCellKeys.has(firstCellKey)) {
              return
            }

            if (sourceKey) {
              const sourceStock = nextMachineInternal[sourceKey] ?? 0
              if (sourceStock <= 0) {
                return
              }
              nextMachineInternal[sourceKey] = sourceStock - 1
            }

            occupiedCellKeys.add(firstCellKey)
            emittedItems.push({
              id: `ti_${outPort.machineId}_${outPort.portId}_${state.tickCount}_${Math.floor(Math.random() * 100000)}`,
              itemId,
              path,
              stepIndex: 1,
              stepTick: 0,
            })
            cooldownAfterDecay[outKey] = BELT_TICKS_PER_CELL
          })

          const finalTransitItems = [...movedItems, ...emittedItems]

          const nextMachines = state.machines.map((machine) => {
            let status: MachineRuntimeStatus = "running"
            let missingInputs: string[] | undefined

            if (machine.placementState === "overlap") {
              status = "blocked_overlap"
            } else if (machine.placementState === "invalid_boundary") {
              status = "blocked_boundary"
            } else if (needsPower(machine) && !isMachinePowered(machine, state.machines, state.selectedGridSize)) {
              status = "unpowered"
            }

            if (machine.prototypeId !== "crusher_3x3") {
              runtime[machine.id] = {
                machineId: machine.id,
                status,
                missingInputs,
              }
              return machine
            }

            if (status !== "running") {
              runtime[machine.id] = {
                machineId: machine.id,
                status,
                missingInputs,
              }
              return machine
            }

            const outputCapacity = BUILDING_PROTOTYPE_MAP[machine.prototypeId].outputStorageCapacity ?? 50

            const oreInKey = machineInputKey(machine.id, "originium_ore")
            const powderOutKey = machineOutputKey(machine.id, "originium_powder")

            const inputStored = getMachineInputStoredTotal(machine.id, nextMachineInternal)
            const outputStored = getMachineOutputStoredTotal(machine.id, nextMachineInternal)

            let nextProgress = machine.progressTick

            if (nextProgress > 0) {
              nextProgress += 1

              if (nextProgress >= 20) {
                if (outputStored >= outputCapacity) {
                  nextProgress = 19
                } else {
                  producedPowder += 1
                  nextMachineInternal[powderOutKey] = (nextMachineInternal[powderOutKey] ?? 0) + 1
                  nextProgress = 0
                }
              }
            } else {
              if (inputStored <= 0) {
                status = "starved"
                missingInputs = ["originium_ore"]
              } else if (outputStored >= outputCapacity) {
                status = "running"
              } else {
                const oreStock = nextMachineInternal[oreInKey] ?? 0
                if (oreStock > 0) {
                  nextMachineInternal[oreInKey] = oreStock - 1
                  consumedOre += 1
                  nextProgress = 1
                } else {
                  status = "starved"
                  missingInputs = ["originium_ore"]
                }
              }
            }

            runtime[machine.id] = {
              machineId: machine.id,
              status,
              missingInputs,
            }

            return {
              ...machine,
              progressTick: nextProgress,
            }
          })

          const nextExternal = {
            ...state.externalInventory,
            originium_powder: state.externalInventory.originium_powder + producedPowder,
          }

          const nextProdWindowOre = pushWindow(state.productionWindow, "originium_ore", 0)
          const nextProdWindowPowder = pushWindow(nextProdWindowOre, "originium_powder", producedPowder)
          const nextConsWindowOre = pushWindow(state.consumptionWindow, "originium_ore", consumedOre)
          const nextConsWindowPowder = pushWindow(nextConsWindowOre, "originium_powder", 0)

          const machineProgress = Object.fromEntries(
            nextMachines.map((machine) => [machine.id, machine.progressTick]),
          )

          return {
            tickCount: state.tickCount + 1,
            machines: nextMachines,
            machineRuntime: runtime,
            machineProgress,
            machineInternal: nextMachineInternal,
            beltEdges: rebuiltEdges,
            beltTransitItems: finalTransitItems,
            beltEmitCooldown: cooldownAfterDecay,
            beltInTransit: {
              originium_ore: finalTransitItems.filter((item) => item.itemId === "originium_ore").length,
              originium_powder: finalTransitItems.filter((item) => item.itemId === "originium_powder").length,
            },
            externalInventory: nextExternal,
            productionWindow: nextProdWindowPowder,
            consumptionWindow: nextConsWindowPowder,
            productionPerMin: {
              originium_ore: sumWindow(nextProdWindowPowder.originium_ore),
              originium_powder: sumWindow(nextProdWindowPowder.originium_powder),
            },
            consumptionPerMin: {
              originium_ore: sumWindow(nextConsWindowPowder.originium_ore),
              originium_powder: sumWindow(nextConsWindowPowder.originium_powder),
            },
          }
        }),

      setActivePrototype: (prototypeId) => set({ activePrototypeId: prototypeId }),
      setInteractionMode: (mode) =>
        set((state) => ({
          interactionMode: mode,
          logisticsMode: mode === "logistics" ? state.logisticsMode : "none",
          beltDrawStart: null,
          selectedMachineId: mode === "place" ? null : state.selectedMachineId,
          selectedBeltSegmentKey: mode === "idle" ? state.selectedBeltSegmentKey : null,
          beltDragBaseCells: [],
          beltDragBaseSegments: [],
        })),
      placeMachineAt: (x, y) =>
        set((state) => {
          if (state.mode !== "edit") {
            return state
          }

          if (state.interactionMode !== "place") {
            return {
              selectedMachineId: null,
            }
          }

          const nextMachine = createMachine(state.activePrototypeId, x, y)
          const nextPickupPortConfigs =
            nextMachine.prototypeId === "pickup_port_3x1"
              ? {
                  ...state.pickupPortConfigs,
                  [nextMachine.id]: {
                    machineId: nextMachine.id,
                    selectedItemId: null,
                  },
                }
              : state.pickupPortConfigs

          const nextMachines = recalculatePlacementStates(
            [...state.machines, nextMachine],
            state.selectedGridSize,
          )

          return {
            machines: nextMachines,
            pickupPortConfigs: nextPickupPortConfigs,
            selectedMachineId: nextMachine.id,
            toastMessage: null,
            plotSaves: {
              ...state.plotSaves,
              [state.selectedGridSize]: {
                machines: nextMachines,
                beltCells: state.beltCells,
                beltEdges: state.beltEdges,
                beltSegments: state.beltSegments,
                pickupPortConfigs: nextPickupPortConfigs,
              },
            },
          }
        }),
      deleteMachineById: (machineId) =>
        set((state) => {
          if (state.mode !== "edit") {
            return state
          }

          const nextMachines = recalculatePlacementStates(
            state.machines.filter((machine) => machine.id !== machineId),
            state.selectedGridSize,
          )
          const nextPickupPortConfigs = Object.fromEntries(
            Object.entries(state.pickupPortConfigs).filter(([id]) => id !== machineId),
          ) as Record<string, PickupPortConfig>
          const nextEdges = rebuildBeltEdgesFromSegments(nextMachines, state.beltSegments)

          return {
            machines: nextMachines,
            pickupPortConfigs: nextPickupPortConfigs,
            beltEdges: nextEdges,
            beltCells: state.beltCells,
            beltSegments: state.beltSegments,
            beltTransitItems: [],
            beltEmitCooldown: {},
            selectedMachineId: state.selectedMachineId === machineId ? null : state.selectedMachineId,
            toastMessage: null,
            plotSaves: {
              ...state.plotSaves,
              [state.selectedGridSize]: {
                machines: nextMachines,
                beltCells: state.beltCells,
                beltEdges: nextEdges,
                beltSegments: state.beltSegments,
                pickupPortConfigs: nextPickupPortConfigs,
              },
            },
          }
        }),
      deleteAllMachines: () =>
        set((state) => {
          if (state.mode !== "edit") {
            return state
          }

          return {
            machines: [],
            pickupPortConfigs: {},
            beltCells: state.beltCells,
            beltEdges: [],
            beltSegments: state.beltSegments,
            beltTransitItems: [],
            beltEmitCooldown: {},
            selectedMachineId: null,
            toastMessage: "已删除所有建筑（传送带已保留）",
            plotSaves: {
              ...state.plotSaves,
              [state.selectedGridSize]: {
                machines: [],
                beltCells: state.beltCells,
                beltEdges: [],
                beltSegments: state.beltSegments,
                pickupPortConfigs: {},
              },
            },
          }
        }),
      selectMachine: (machineId) => set({ selectedMachineId: machineId }),
      moveMachine: (machineId, x, y) =>
        set((state) => {
          if (state.mode !== "edit") {
            return state
          }

          const movingMachine = state.machines.find((machine) => machine.id === machineId)
          if (!movingMachine) {
            return state
          }

          if (movingMachine.x === x && movingMachine.y === y) {
            return state
          }

          const oldPorts = getMachinePorts(movingMachine)
          const oldPortKeys = new Set(oldPorts.map((port) => `${port.x},${port.y}`))

          const movedMachines = state.machines.map((machine) =>
            machine.id === machineId
              ? {
                  ...machine,
                  x,
                  y,
                }
              : machine,
          )

          const nextMachines = recalculatePlacementStates(movedMachines, state.selectedGridSize)
          const detachedSegments = state.beltSegments.filter(
            (segment) =>
              !oldPortKeys.has(`${segment.from.x},${segment.from.y}`) &&
              !oldPortKeys.has(`${segment.to.x},${segment.to.y}`),
          )

          const nextCells = createCellsFromSegments(detachedSegments, nextMachines)
          const rebuiltEdges = rebuildBeltEdgesFromSegments(nextMachines, detachedSegments)

          return {
            machines: nextMachines,
            beltSegments: detachedSegments,
            beltEdges: rebuiltEdges,
            beltCells: nextCells,
            beltTransitItems: [],
            beltEmitCooldown: {},
            toastMessage: null,
            plotSaves: {
              ...state.plotSaves,
              [state.selectedGridSize]: {
                machines: nextMachines,
                beltCells: nextCells,
                beltEdges: rebuiltEdges,
                beltSegments: detachedSegments,
                pickupPortConfigs: state.pickupPortConfigs,
              },
            },
          }
        }),
      rotateSelectedMachine: () =>
        set((state) => {
          if (state.mode !== "edit" || !state.selectedMachineId) {
            return state
          }

          const rotated = state.machines.map((machine) =>
            machine.id === state.selectedMachineId ? rotateMachine(machine) : machine,
          )
          const nextMachines = recalculatePlacementStates(rotated, state.selectedGridSize)

          return {
            machines: nextMachines,
            toastMessage: null,
            plotSaves: {
              ...state.plotSaves,
              [state.selectedGridSize]: {
                machines: nextMachines,
                beltCells: state.beltCells,
                beltEdges: state.beltEdges,
                beltSegments: state.beltSegments,
                pickupPortConfigs: state.pickupPortConfigs,
              },
            },
          }
        }),
      deleteSelectedMachine: () =>
        set((state) => {
          if (state.mode !== "edit" || !state.selectedMachineId) {
            return state
          }

          const machineId = state.selectedMachineId
          const nextMachines = recalculatePlacementStates(
            state.machines.filter((machine) => machine.id !== machineId),
            state.selectedGridSize,
          )
          const nextPickupPortConfigs = Object.fromEntries(
            Object.entries(state.pickupPortConfigs).filter(([id]) => id !== machineId),
          ) as Record<string, PickupPortConfig>
          const nextEdges = rebuildBeltEdgesFromSegments(nextMachines, state.beltSegments)

          return {
            machines: nextMachines,
            pickupPortConfigs: nextPickupPortConfigs,
            beltEdges: nextEdges,
            beltCells: state.beltCells,
            beltSegments: state.beltSegments,
            beltTransitItems: [],
            beltEmitCooldown: {},
            selectedMachineId: null,
            toastMessage: null,
            plotSaves: {
              ...state.plotSaves,
              [state.selectedGridSize]: {
                machines: nextMachines,
                beltCells: state.beltCells,
                beltEdges: nextEdges,
                beltSegments: state.beltSegments,
                pickupPortConfigs: nextPickupPortConfigs,
              },
            },
          }
        }),

      setPickupPortSelectedItem: (machineId, itemId) =>
        set((state) => {
          if (state.mode !== "edit") {
            return {
              toastMessage: "仿真模式下禁止修改取货口出货物品",
            }
          }

          const machine = state.machines.find((entry) => entry.id === machineId)
          if (!machine || machine.prototypeId !== "pickup_port_3x1") {
            return state
          }

          const current = state.pickupPortConfigs[machineId]
          if (current?.selectedItemId === itemId) {
            return state
          }

          const nextPickupPortConfigs: Record<string, PickupPortConfig> = {
            ...state.pickupPortConfigs,
            [machineId]: {
              machineId,
              selectedItemId: itemId,
            },
          }

          return {
            pickupPortConfigs: nextPickupPortConfigs,
            toastMessage: itemId ? `取货口已选择：${itemId}` : "取货口已清空选择",
            plotSaves: {
              ...state.plotSaves,
              [state.selectedGridSize]: {
                machines: state.machines,
                beltCells: state.beltCells,
                beltEdges: state.beltEdges,
                beltSegments: state.beltSegments,
                pickupPortConfigs: nextPickupPortConfigs,
              },
            },
          }
        }),

      setLogisticsMode: (mode) =>
        set((state) => {
          if (state.mode !== "edit") {
            return {
              toastMessage: "仿真模式下禁止编辑物流系统",
            }
          }

          if (state.interactionMode !== "logistics") {
            return {
              toastMessage: "请先切换到物流模式",
            }
          }

          return {
            logisticsMode: mode,
            beltDrawStart: null,
            beltDragLast: null,
            beltDragTrace: [],
            beltDragBaseCells: [],
            beltDragBaseSegments: [],
            selectedMachineId: mode === "none" ? state.selectedMachineId : null,
            toastMessage:
              mode === "pipe"
                ? "管道模式在 Phase1 仅占位，不创建可运行连接"
                : mode === "belt"
                  ? "已进入传送带拖拽铺设模式：按住左键拖拽铺设"
                  : null,
          }
        }),
      startBeltDrag: (x, y) =>
        set((state) => {
          if (state.mode !== "edit" || state.logisticsMode !== "belt") {
            return state
          }

          const start: GridPoint = { x, y }
          if (!isWithinGrid(start, state.selectedGridSize)) {
            return state
          }

          const startPort = getPortAtPoint(state.machines, start)
          const machineBodyAtStart = hasMachineBodyAtPoint(state.machines, start)

          if (startPort?.type === "in") {
            return {
              toastMessage: "起点不能是输入端口",
            }
          }

          if (machineBodyAtStart && startPort?.type !== "out") {
            return {
              toastMessage: "起点不合法：机器本体仅允许从输出端口开始",
            }
          }

          return {
            beltDrawStart: start,
            beltDragLast: start,
            beltDragTrace: [start],
            beltDragBaseCells: state.beltCells,
            beltDragBaseSegments: state.beltSegments,
            toastMessage: null,
          }
        }),
      extendBeltDrag: (x, y) =>
        set((state) => {
          if (state.mode !== "edit" || state.logisticsMode !== "belt" || !state.beltDragLast) {
            return state
          }

          const nextPoint: GridPoint = { x, y }
          if (!isWithinGrid(nextPoint, state.selectedGridSize)) {
            return state
          }

          if (state.beltDragLast.x === nextPoint.x && state.beltDragLast.y === nextPoint.y) {
            return state
          }

          const segment = buildBeltPath(state.beltDragLast, nextPoint).slice(1)
          if (segment.length === 0) {
            return state
          }

          let currentTrace = [...state.beltDragTrace]
          let blockedMessage: string | null = null

          for (let index = 0; index < segment.length; index += 1) {
            const point = segment[index]
            const last = currentTrace[currentTrace.length - 1]
            if (!last) {
              continue
            }

            if (last.x === point.x && last.y === point.y) {
              continue
            }

            if (currentTrace.length >= 2) {
              const prev = currentTrace[currentTrace.length - 2]
              if (prev.x === point.x && prev.y === point.y) {
                currentTrace.pop()
                continue
              }
            }

            if (currentTrace.length >= 2 && isCornerPointInSegments(state.beltDragBaseSegments, last)) {
              blockedMessage = "铺设失败：不能在已有传送带拐角处继续分叉"
              break
            }

            const currentSegments = appendSegmentsFromPath(state.beltDragBaseSegments, currentTrace)
            if (hasSameSegment(currentSegments, last, point)) {
              blockedMessage = "铺设失败：不允许顺着已有传送带继续铺设"
              break
            }

            const candidateTrace = [...currentTrace, point]
            const candidateSegments = appendSegmentsFromPath(state.beltDragBaseSegments, candidateTrace)

            if (
              violatesHeadOnCollisionAtPoint(candidateSegments, last) ||
              violatesHeadOnCollisionAtPoint(candidateSegments, point)
            ) {
              blockedMessage = "铺设失败：不允许传送带对撞"
              break
            }

            if (
              violatesCrossJunctionByUsage(
                state.beltDragBaseSegments,
                currentSegments,
                candidateSegments,
                candidateTrace,
                last,
              ) ||
              violatesCrossJunctionByUsage(
                state.beltDragBaseSegments,
                currentSegments,
                candidateSegments,
                candidateTrace,
                point,
              )
            ) {
              blockedMessage = "铺设失败：路口必须满足单入或单出（分流/汇流）"
              break
            }

            const lastPort = getPortAtPoint(state.machines, last)
            if (lastPort) {
              if (lastPort.type === "in") {
                blockedMessage = "铺设失败：入口端口为终点，不能继续向外绘制"
                break
              }

              if (lastPort.type === "out" && !isExitDirectionValid(lastPort.direction, last, point)) {
                blockedMessage = "铺设失败：出口端口方向不匹配"
                break
              }
            }

            const hasMachineBody = hasMachineBodyAtPoint(state.machines, point)
            if (!hasMachineBody) {
              currentTrace.push(point)
              continue
            }

            const pointPort = getPortAtPoint(state.machines, point)
            if (!pointPort || pointPort.type !== "in") {
              blockedMessage = "铺设失败：路径进入建筑本体"
              break
            }

            if (!isEnterDirectionValid(pointPort.direction, last, point)) {
              blockedMessage = "铺设失败：只能从入口边方向连入设备"
              break
            }

            currentTrace.push(point)
          }

          const nextTrace = normalizeTrace(currentTrace)
          const tracePoints = deriveCellsFromTrace(nextTrace, state.machines)

          const nextSegments = appendSegmentsFromPath(state.beltDragBaseSegments, nextTrace)
          const nextBeltCells = appendUniqueBeltCells(state.beltDragBaseCells, tracePoints)
          const nextLast = nextTrace[nextTrace.length - 1] ?? state.beltDrawStart

          const hasChanged =
            nextTrace.length !== state.beltDragTrace.length ||
            nextLast?.x !== state.beltDragLast?.x ||
            nextLast?.y !== state.beltDragLast?.y

          if (!hasChanged && blockedMessage) {
            return {
              toastMessage: blockedMessage,
            }
          }

          return {
            beltCells: nextBeltCells,
            beltSegments: nextSegments,
            beltDragLast: nextLast,
            beltDragTrace: nextTrace,
            toastMessage: blockedMessage,
            plotSaves: {
              ...state.plotSaves,
              [state.selectedGridSize]: {
                machines: state.machines,
                beltCells: nextBeltCells,
                beltEdges: state.beltEdges,
                beltSegments: nextSegments,
                pickupPortConfigs: state.pickupPortConfigs,
              },
            },
          }
        }),
      finishBeltDrag: () =>
        set((state) => {
          if (state.mode !== "edit" || state.logisticsMode !== "belt" || !state.beltDrawStart) {
            return state
          }

          const trace = normalizeTrace(state.beltDragTrace)
          const start = state.beltDrawStart
          const end = state.beltDragLast ?? start

          const resetDragState = {
            beltDrawStart: null,
            beltDragLast: null,
            beltDragTrace: [],
            beltDragBaseCells: [],
            beltDragBaseSegments: [],
          }

          if (trace.length <= 1) {
            return {
              ...resetDragState,
              toastMessage: null,
            }
          }

          const startPort = getPortAtPoint(state.machines, start)
          const endPort = getPortAtPoint(state.machines, end)

          if (!startPort || startPort.type !== "out" || !endPort || endPort.type !== "in") {
            return {
              ...resetDragState,
              toastMessage: "已完成拖拽铺设（未形成 out -> in 连接）",
            }
          }

          const duplicated = state.beltEdges.some(
            (edge) =>
              edge.from.machineId === startPort.machineId &&
              edge.from.portId === startPort.portId &&
              edge.to.machineId === endPort.machineId &&
              edge.to.portId === endPort.portId,
          )

          if (duplicated) {
            return {
              ...resetDragState,
              toastMessage: "连接创建失败：重复连接",
            }
          }

          const nextEdges = rebuildBeltEdgesFromSegments(state.machines, state.beltSegments)

          return {
            beltEdges: nextEdges,
            beltTransitItems: [],
            beltEmitCooldown: {},
            ...resetDragState,
            toastMessage:
              nextEdges.some(
                (edge) =>
                  edge.from.machineId === startPort.machineId &&
                  edge.from.portId === startPort.portId &&
                  edge.to.machineId === endPort.machineId &&
                  edge.to.portId === endPort.portId,
              )
                ? `连接已创建，共 ${trace.length} 格`
                : "已完成拖拽铺设（未形成 out -> in 连接）",
            plotSaves: {
              ...state.plotSaves,
              [state.selectedGridSize]: {
                machines: state.machines,
                beltCells: state.beltCells,
                beltEdges: nextEdges,
                beltSegments: state.beltSegments,
                pickupPortConfigs: state.pickupPortConfigs,
              },
            },
          }
        }),
      cancelBeltDraw: () =>
        set({
          beltDrawStart: null,
          beltDragLast: null,
          beltDragTrace: [],
          beltDragBaseCells: [],
          beltDragBaseSegments: [],
          toastMessage: "已取消传送带绘制",
        }),
      setBeltDeleteMode: (mode) => set({ beltDeleteMode: mode }),
      selectBeltSegment: (segmentKey) =>
        set((state) => ({
          selectedBeltSegmentKey: segmentKey,
          selectedMachineId: segmentKey ? null : state.selectedMachineId,
        })),
      deleteBeltAt: (x, y) =>
        set((state) => {
          if (state.mode !== "edit" || state.interactionMode !== "delete") {
            return state
          }

          const nextBelts =
            state.beltDeleteMode === "by_cell"
              ? deleteBeltCell(state.beltCells, { x, y })
              : deleteConnectedComponent(state.beltCells, { x, y })

          let nextSegments = state.beltSegments
          let nextEdges = state.beltEdges
          let finalBelts = nextBelts

          if (state.beltDeleteMode === "by_connected_component") {
            const remainingSegments = deleteBeltLineByRules(state.beltSegments, { x, y })
            if (remainingSegments.length === state.beltSegments.length) {
              return {
                toastMessage: "当前位置没有可删除的传送带",
              }
            }

            nextSegments = remainingSegments
            nextEdges = rebuildBeltEdgesFromSegments(state.machines, remainingSegments)
            finalBelts = createCellsFromSegments(remainingSegments, state.machines)
          } else {
            if (nextBelts.length === state.beltCells.length) {
              return {
                toastMessage: "当前位置没有可删除的传送带",
              }
            }

            const nextCellKeys = new Set(nextBelts.map((cell) => `${cell.x},${cell.y}`))
            nextSegments = state.beltSegments.filter(
              (segment) =>
                (getPortAtPoint(state.machines, segment.from) ||
                  nextCellKeys.has(`${segment.from.x},${segment.from.y}`)) &&
                (getPortAtPoint(state.machines, segment.to) ||
                  nextCellKeys.has(`${segment.to.x},${segment.to.y}`)),
            )
            nextEdges = rebuildBeltEdgesFromSegments(state.machines, nextSegments)
            finalBelts = nextBelts
          }

          return {
            beltCells: finalBelts,
            beltEdges: nextEdges,
            beltSegments: nextSegments,
            beltTransitItems: [],
            beltEmitCooldown: {},
            toastMessage:
              state.beltDeleteMode === "by_cell"
                ? "已按格删除传送带"
                : "已删除整条联通传送带（4 邻接）",
            plotSaves: {
              ...state.plotSaves,
              [state.selectedGridSize]: {
                machines: state.machines,
                beltCells: finalBelts,
                beltEdges: nextEdges,
                beltSegments: nextSegments,
                pickupPortConfigs: state.pickupPortConfigs,
              },
            },
          }
        }),
      clearToast: () => set({ toastMessage: null }),
    }),
    {
      name: "industrial-planner-stage1-phase1",
      partialize: (state) => ({
        selectedGridSize: state.selectedGridSize,
        activePrototypeId: state.activePrototypeId,
        plotSaves: state.plotSaves,
      }),
      merge: (persistedState, currentState) => {
        const merged = { ...currentState, ...(persistedState as Partial<AppState>) }
        const selectedGridSize = merged.selectedGridSize ?? DEFAULT_GRID_SIZE
        const snapshot = merged.plotSaves?.[selectedGridSize] ?? emptyPlot()

        return {
          ...merged,
          mode: "edit",
          speed: 1,
          machines: recalculatePlacementStates(snapshot.machines, selectedGridSize),
          pickupPortConfigs: snapshot.pickupPortConfigs ?? {},
          beltCells: snapshot.beltCells,
          beltEdges: snapshot.beltEdges,
          beltSegments:
            snapshot.beltSegments && snapshot.beltSegments.length > 0
              ? snapshot.beltSegments
              : snapshot.beltEdges.length > 0
                ? deriveSegmentsFromEdges(snapshot.beltEdges)
                : deriveSegmentsFromCells(snapshot.beltCells),
          selectedMachineId: null,
          selectedBeltSegmentKey: null,
          interactionMode: "idle",
          logisticsMode: "none",
          beltDrawStart: null,
          beltDragLast: null,
          beltDragTrace: [],
          beltDragBaseCells: [],
          beltDragBaseSegments: [],
          beltDeleteMode: "by_cell",
          toastMessage: null,
          machineRuntime: {},
          tickCount: 0,
          machineProgress: {},
          machineInternal: {},
          beltInTransit: {},
          beltTransitItems: [],
          beltEmitCooldown: {},
          productionPerMin: { originium_ore: 0, originium_powder: 0 },
          consumptionPerMin: { originium_ore: 0, originium_powder: 0 },
          productionWindow: emptyWindow(),
          consumptionWindow: emptyWindow(),
          externalInventory: { ...DEFAULT_EXTERNAL_INVENTORY },
        }
      },
    },
  ),
)
