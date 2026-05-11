import type { WorldEntity } from "@/domain/document/world-document"
import type {
  GridEdge,
  GridFloatPoint,
  GridPoint,
  GridRotation,
} from "@/domain/shared/grid"
import type {
  EntityDefinition,
  PortDefinition,
  PortGroupDefinition,
} from "@/domain/registry/types/entity-definition"

import type {
  DecorationSyncContext,
  DecorationViewportBounds,
  RenderViewportState,
} from "./DecorationSyncContext"

export const BELT_INSERTION_DEPTH_CELLS = 0.2

const STRICT_BELT_DEFINITION_IDS = new Set([
  "belt_straight_1x1",
  "belt_turn_cw_1x1",
  "belt_turn_ccw_1x1",
])

const EDGE_ORDER: readonly GridEdge[] = ["NORTH", "EAST", "SOUTH", "WEST"]

export interface BeltInsertionEntry {
  readonly sourceEntityId: string;
  readonly targetEntityId: string;
  readonly boundary: GridFloatPoint;
  readonly edge: GridEdge;
  readonly angleRadians: number;
}

export interface BeltPathSample {
  readonly point: GridFloatPoint;
  readonly angleRadians: number;
}

interface WorldPortReference {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly group: PortGroupDefinition;
  readonly port: PortDefinition;
  readonly cell: GridPoint;
  readonly edge: GridEdge;
}

interface BeltPathEndpoints {
  readonly input: {
    readonly edge: GridEdge;
    readonly point: GridFloatPoint;
  };
  readonly output: {
    readonly edge: GridEdge;
    readonly point: GridFloatPoint;
  };
}

export function isStrictBeltDefinitionId(definitionId: string): boolean {
  return STRICT_BELT_DEFINITION_IDS.has(definitionId)
}

export function resolveBeltInsertionEntries(ctx: DecorationSyncContext): BeltInsertionEntry[] {
  const app = ctx.workspace.app
  if (app?.state?.settings?.gameUseSimplifiedDeviceIcons === true) {
    return []
  }

  const editor = ctx.workspace.editor
  if (editor === null) {
    return []
  }

  const definitionMap = createEntityDefinitionMap(ctx)
  const entities = editor.queries.listEntities()
  const inputPortsByConnectionKey = new Map<string, WorldPortReference[]>()
  const outputPorts: WorldPortReference[] = []

  for (const entity of entities) {
    const definition = definitionMap.get(entity.definitionId)
    if (definition === undefined) {
      continue
    }

    for (const portReference of resolveWorldPortReferences(entity, definition)) {
      if (portReference.group.kind !== "item") {
        continue
      }

      if (portReference.group.direction === "input" || portReference.group.direction === "bidirectional") {
        const key = createConnectionKey(portReference.cell, portReference.edge)
        const existing = inputPortsByConnectionKey.get(key)
        if (existing === undefined) {
          inputPortsByConnectionKey.set(key, [portReference])
        } else {
          existing.push(portReference)
        }
      }

      if (portReference.group.direction === "output" || portReference.group.direction === "bidirectional") {
        outputPorts.push(portReference)
      }
    }
  }

  const entries: BeltInsertionEntry[] = []

  for (const outputPort of outputPorts) {
    if (!isStrictBeltDefinitionId(outputPort.entity.definitionId)) {
      continue
    }

    const targetCell = addGridPoints(outputPort.cell, resolveEdgeDelta(outputPort.edge))
    const targetKey = createConnectionKey(targetCell, oppositeEdge(outputPort.edge))
    const targetPorts = inputPortsByConnectionKey.get(targetKey) ?? []
    const targetPort = targetPorts.find((candidate) =>
      candidate.entity.id !== outputPort.entity.id
      && !isStrictBeltDefinitionId(candidate.entity.definitionId),
    )

    if (targetPort === undefined) {
      continue
    }

    entries.push({
      sourceEntityId: outputPort.entity.id,
      targetEntityId: targetPort.entity.id,
      boundary: resolvePortBoundaryPoint(outputPort.cell, outputPort.edge),
      edge: outputPort.edge,
      angleRadians: resolveEdgeAngleRadians(outputPort.edge),
    })
  }

  return entries
}

export function resolveBeltPathSample(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
  progress: number;
}): BeltPathSample | null {
  if (!isStrictBeltDefinitionId(options.entity.definitionId)) {
    return null
  }

  const endpoints = resolveBeltPathEndpoints(options.definition)
  if (endpoints === null) {
    return null
  }

  const progress = clamp01(options.progress)
  const baseSample = sampleBaseBeltPath(endpoints, progress)
  if (baseSample === null) {
    return null
  }

  const point = rotateUnitPointClockwise(baseSample.point, options.entity.rotation)
  return {
    point,
    angleRadians: normalizeRadians(
      baseSample.angleRadians + rotationToRadians(options.entity.rotation),
    ),
  }
}

export function resolveViewportPoint(options: {
  point: GridFloatPoint;
  viewportBounds: DecorationViewportBounds;
  viewportState: Pick<RenderViewportState, "centerX" | "centerY" | "gridCellPixelSize">;
}): GridFloatPoint {
  const gridCellSize = options.viewportState.gridCellPixelSize

  return {
    x:
      options.viewportBounds.left
      + options.viewportBounds.width / 2
      + (options.point.x - options.viewportState.centerX) * gridCellSize,
    y:
      options.viewportBounds.top
      + options.viewportBounds.height / 2
      + (options.point.y - options.viewportState.centerY) * gridCellSize,
  }
}

export function offsetPointByEdge(
  point: GridFloatPoint,
  edge: GridEdge,
  distance: number,
): GridFloatPoint {
  const delta = resolveEdgeDelta(edge)

  return {
    x: point.x + delta.x * distance,
    y: point.y + delta.y * distance,
  }
}

export function createEntityDefinitionMap(
  ctx: DecorationSyncContext,
): Map<string, EntityDefinition> {
  return new Map(
    ctx.workspace.registry.entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  )
}

function resolveWorldPortReferences(
  entity: WorldEntity,
  definition: EntityDefinition,
): WorldPortReference[] {
  const references: WorldPortReference[] = []

  for (const group of definition.portGroups) {
    for (const port of group.ports) {
      references.push({
        entity,
        definition,
        group,
        port,
        cell: resolveRotatedPortCell({
          localCell: {
            x: port.localCellX,
            y: port.localCellY,
          },
          footprint: definition.footprint,
          position: entity.position,
          rotation: entity.rotation,
        }),
        edge: rotateGridEdge(port.edge, entity.rotation),
      })
    }
  }

  return references
}

function resolveBeltPathEndpoints(definition: EntityDefinition): BeltPathEndpoints | null {
  const input = resolveSinglePortByDirection(definition, "input")
  const output = resolveSinglePortByDirection(definition, "output")

  if (input === null || output === null) {
    return null
  }

  return {
    input: {
      edge: input.edge,
      point: resolvePortBoundaryPoint(
        {
          x: input.localCellX,
          y: input.localCellY,
        },
        input.edge,
      ),
    },
    output: {
      edge: output.edge,
      point: resolvePortBoundaryPoint(
        {
          x: output.localCellX,
          y: output.localCellY,
        },
        output.edge,
      ),
    },
  }
}

function resolveSinglePortByDirection(
  definition: EntityDefinition,
  direction: "input" | "output",
): PortDefinition | null {
  for (const group of definition.portGroups) {
    if (group.kind !== "item" || group.direction !== direction) {
      continue
    }

    return group.ports[0] ?? null
  }

  return null
}

function sampleBaseBeltPath(
  endpoints: BeltPathEndpoints,
  progress: number,
): BeltPathSample | null {
  if (areOppositeEdges(endpoints.input.edge, endpoints.output.edge)) {
    return {
      point: lerpPoint(endpoints.input.point, endpoints.output.point, progress),
      angleRadians: angleBetweenPoints(endpoints.input.point, endpoints.output.point),
    }
  }

  const corner = resolveSharedCorner(endpoints.input.edge, endpoints.output.edge)
  if (corner === null) {
    return null
  }

  const startAngle = angleBetweenPoints(corner, endpoints.input.point)
  const endAngle = angleBetweenPoints(corner, endpoints.output.point)
  const delta = normalizeTurnDelta(startAngle, endAngle)
  const angle = startAngle + delta * progress
  const radius = distanceBetweenPoints(corner, endpoints.input.point)
  const tangentAngle = angle + (delta >= 0 ? Math.PI / 2 : -Math.PI / 2)

  return {
    point: {
      x: corner.x + Math.cos(angle) * radius,
      y: corner.y + Math.sin(angle) * radius,
    },
    angleRadians: normalizeRadians(tangentAngle),
  }
}

function resolveSharedCorner(edgeA: GridEdge, edgeB: GridEdge): GridFloatPoint | null {
  const edges = new Set([edgeA, edgeB])

  if (edges.has("NORTH") && edges.has("EAST")) {
    return { x: 1, y: 0 }
  }

  if (edges.has("EAST") && edges.has("SOUTH")) {
    return { x: 1, y: 1 }
  }

  if (edges.has("SOUTH") && edges.has("WEST")) {
    return { x: 0, y: 1 }
  }

  if (edges.has("WEST") && edges.has("NORTH")) {
    return { x: 0, y: 0 }
  }

  return null
}

function normalizeTurnDelta(startAngle: number, endAngle: number): number {
  let delta = endAngle - startAngle

  while (delta <= -Math.PI) {
    delta += Math.PI * 2
  }

  while (delta > Math.PI) {
    delta -= Math.PI * 2
  }

  return delta
}

function resolveRotatedPortCell(options: {
  localCell: GridPoint;
  footprint: {
    readonly width: number;
    readonly height: number;
  };
  position: GridPoint;
  rotation: GridRotation;
}): GridPoint {
  const rotatedLocalCell = rotateGridCellClockwise(
    options.localCell,
    options.footprint,
    options.rotation,
  )

  return {
    x: options.position.x + rotatedLocalCell.x,
    y: options.position.y + rotatedLocalCell.y,
  }
}

function rotateGridCellClockwise(
  localCell: GridPoint,
  footprint: {
    readonly width: number;
    readonly height: number;
  },
  rotation: GridRotation,
): GridPoint {
  switch (rotation) {
    case 90:
      return {
        x: footprint.height - 1 - localCell.y,
        y: localCell.x,
      }
    case 180:
      return {
        x: footprint.width - 1 - localCell.x,
        y: footprint.height - 1 - localCell.y,
      }
    case 270:
      return {
        x: localCell.y,
        y: footprint.width - 1 - localCell.x,
      }
    default:
      return localCell
  }
}

function rotateUnitPointClockwise(
  point: GridFloatPoint,
  rotation: GridRotation,
): GridFloatPoint {
  switch (rotation) {
    case 90:
      return {
        x: 1 - point.y,
        y: point.x,
      }
    case 180:
      return {
        x: 1 - point.x,
        y: 1 - point.y,
      }
    case 270:
      return {
        x: point.y,
        y: 1 - point.x,
      }
    default:
      return point
  }
}

function rotateGridEdge(edge: GridEdge, rotation: GridRotation): GridEdge {
  const rotationSteps = rotation / 90
  const edgeIndex = EDGE_ORDER.indexOf(edge)

  return EDGE_ORDER[(edgeIndex + rotationSteps) % EDGE_ORDER.length] ?? edge
}

function oppositeEdge(edge: GridEdge): GridEdge {
  switch (edge) {
    case "NORTH":
      return "SOUTH"
    case "EAST":
      return "WEST"
    case "SOUTH":
      return "NORTH"
    case "WEST":
      return "EAST"
    default:
      return edge
  }
}

function resolveEdgeDelta(edge: GridEdge): GridPoint {
  switch (edge) {
    case "NORTH":
      return { x: 0, y: -1 }
    case "EAST":
      return { x: 1, y: 0 }
    case "SOUTH":
      return { x: 0, y: 1 }
    case "WEST":
      return { x: -1, y: 0 }
    default:
      return { x: 0, y: 0 }
  }
}

function resolveEdgeAngleRadians(edge: GridEdge): number {
  switch (edge) {
    case "NORTH":
      return -Math.PI / 2
    case "EAST":
      return 0
    case "SOUTH":
      return Math.PI / 2
    case "WEST":
      return Math.PI
    default:
      return 0
  }
}

function resolvePortBoundaryPoint(
  cell: GridPoint,
  edge: GridEdge,
): GridFloatPoint {
  switch (edge) {
    case "NORTH":
      return {
        x: cell.x + 0.5,
        y: cell.y,
      }
    case "EAST":
      return {
        x: cell.x + 1,
        y: cell.y + 0.5,
      }
    case "SOUTH":
      return {
        x: cell.x + 0.5,
        y: cell.y + 1,
      }
    case "WEST":
      return {
        x: cell.x,
        y: cell.y + 0.5,
      }
    default:
      return {
        x: cell.x + 0.5,
        y: cell.y + 0.5,
      }
  }
}

function createConnectionKey(cell: GridPoint, edge: GridEdge): string {
  return `${cell.x}:${cell.y}:${edge}`
}

function addGridPoints(left: GridPoint, right: GridPoint): GridPoint {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
  }
}

function areOppositeEdges(left: GridEdge, right: GridEdge): boolean {
  return oppositeEdge(left) === right
}

function angleBetweenPoints(from: GridFloatPoint, to: GridFloatPoint): number {
  return Math.atan2(to.y - from.y, to.x - from.x)
}

function distanceBetweenPoints(left: GridFloatPoint, right: GridFloatPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y)
}

function lerpPoint(
  start: GridFloatPoint,
  end: GridFloatPoint,
  progress: number,
): GridFloatPoint {
  return {
    x: lerp(start.x, end.x, progress),
    y: lerp(start.y, end.y, progress),
  }
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.min(1, value))
}

function rotationToRadians(rotation: GridRotation): number {
  return (rotation / 180) * Math.PI
}

function normalizeRadians(value: number): number {
  let result = value

  while (result <= -Math.PI) {
    result += Math.PI * 2
  }

  while (result > Math.PI) {
    result -= Math.PI * 2
  }

  return result
}
