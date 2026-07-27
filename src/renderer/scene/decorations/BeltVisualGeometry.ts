import type { WorldEntity } from "@/domain/document/world-document"
import type {
  GridEdge,
  GridFloatPoint,
  GridPoint,
  GridRotation,
} from "@/domain/shared/grid"
import type { GridRectSize } from "@/domain/shared/grid"
import type {
  EntityDefinition,
  PortDefinition,
  PortGroupDefinition,
} from "@/domain/registry/types/entity-definition"
import type { RegistryQuery } from "@/domain/registry/registry-query"

import { getRotatedGridFootprint } from "@/shared/geometry/grid"
import {
  resolveViewportPointFromWorldPoint,
  resolveWorldPointFromViewportPoint,
} from "@/shared/geometry/viewport-transform"

import type {
  DecorationSyncContext,
  DecorationViewportBounds,
  RenderViewportState,
} from "./DecorationSyncContext"

/** 视口裁剪边距（cell 数），避免设备在视口边缘闪烁 */
const VIEWPORT_CULL_MARGIN_CELLS = 2

/** 当前视口对应的世界坐标可见矩形 */
export interface VisibleWorldRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 根据当前视口状态计算世界坐标系下的可见矩形（含 margin）
 */
export function resolveVisibleWorldRect(
  viewportState: Pick<RenderViewportState, "centerX" | "centerY" | "gridCellPixelSize" | "displayRotation">,
  viewportBounds: DecorationViewportBounds,
  marginCells = VIEWPORT_CULL_MARGIN_CELLS,
): VisibleWorldRect {
  const viewportCorners = [
    { x: viewportBounds.left, y: viewportBounds.top },
    { x: viewportBounds.left + viewportBounds.width, y: viewportBounds.top },
    { x: viewportBounds.left, y: viewportBounds.top + viewportBounds.height },
    {
      x: viewportBounds.left + viewportBounds.width,
      y: viewportBounds.top + viewportBounds.height,
    },
  ]
  const worldCorners = viewportCorners.flatMap((viewportPoint) => {
    const worldPoint = resolveWorldPointFromViewportPoint({
      viewportPoint,
      viewportBounds,
      viewportCenter: {
        x: viewportState.centerX,
        y: viewportState.centerY,
      },
      gridCellPixelSize: viewportState.gridCellPixelSize,
      displayRotation: viewportState.displayRotation,
    })

    return worldPoint === null ? [] : [worldPoint]
  })

  if (worldCorners.length === 0) {
    return {
      left: viewportState.centerX - marginCells,
      right: viewportState.centerX + marginCells,
      top: viewportState.centerY - marginCells,
      bottom: viewportState.centerY + marginCells,
    }
  }

  return {
    left: Math.min(...worldCorners.map((corner) => corner.x)) - marginCells,
    right: Math.max(...worldCorners.map((corner) => corner.x)) + marginCells,
    top: Math.min(...worldCorners.map((corner) => corner.y)) - marginCells,
    bottom: Math.max(...worldCorners.map((corner) => corner.y)) + marginCells,
  }
}

/**
 * 判断 entity 的 footprint（含旋转）是否与可见矩形相交
 */
export function isWorldEntityVisible(
  entity: WorldEntity,
  footprint: GridRectSize,
  visibleRect: VisibleWorldRect,
): boolean {
  const rotated = getRotatedGridFootprint(footprint, entity.rotation)
  const eLeft = entity.position.x
  const eTop = entity.position.y
  const eRight = eLeft + rotated.width
  const eBottom = eTop + rotated.height

  return eRight > visibleRect.left
    && eLeft < visibleRect.right
    && eBottom > visibleRect.top
    && eTop < visibleRect.bottom
}

export const BELT_INSERTION_DEPTH_CELLS = 0.2

// AI-REMOVED 2026-07-27:
// Reason: renderer 不应维护 3 个传送带节 definition ID。
// Trigger: 用户要求 registry 外只使用 RegistryQuery。
// Evidence: RegistryQuery.isBelt 的定义正是 3 个传送带节。
// Replacement: isStrictBeltDefinitionId 的 queries 参数。
// Risk: Low
// Human Review: Required
//
// Original code:
// const STRICT_BELT_DEFINITION_IDS = new Set([
//   "belt_straight_1x1", "belt_turn_cw_1x1", "belt_turn_ccw_1x1",
// ])

const EDGE_ORDER: readonly GridEdge[] = ["NORTH", "EAST", "SOUTH", "WEST"]

export interface BeltInsertionEntry {
  readonly sourceEntityId: string;
  readonly targetEntityId: string;
  readonly boundary: GridFloatPoint;
  readonly edge: GridEdge;
  readonly angleRadians: number;
}

export type BeltPortExtensionKind = "belt-output-to-device" | "device-output-to-belt"

export interface BeltPortExtensionEntry {
  readonly kind: BeltPortExtensionKind;
  readonly beltEntityId: string;
  readonly deviceEntityId: string;
  readonly boundary: GridFloatPoint;
  readonly edge: GridEdge;
  readonly angleRadians: number;
  readonly localStartCells: number;
  readonly localEndCells: number;
  readonly spriteCenterXCells: number;
}

export type BeltDisconnectedPortKind = "input" | "output"

export interface BeltDisconnectedPortEntry {
  readonly kind: BeltDisconnectedPortKind;
  readonly beltEntityId: string;
  readonly boundary: GridFloatPoint;
  readonly edge: GridEdge;
  readonly angleRadians: number;
}

export interface BeltPortConnectivityEntries {
  readonly extensions: readonly BeltPortExtensionEntry[];
  readonly disconnectedPorts: readonly BeltDisconnectedPortEntry[];
}

export interface BeltPathSample {
  readonly point: GridFloatPoint;
  readonly angleRadians: number;
}

export interface BeltVisualPathEntry {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly inputConnectionKey: string;
  readonly outputConnectionKey: string;
  readonly lengthCells: number;
  readonly phaseOffsetCells: number;
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

interface BeltPortReferenceCollections {
  readonly inputPorts: readonly WorldPortReference[];
  readonly outputPorts: readonly WorldPortReference[];
  readonly inputPortsByConnectionKey: ReadonlyMap<string, readonly WorldPortReference[]>;
  readonly outputPortsByConnectionKey: ReadonlyMap<string, readonly WorldPortReference[]>;
}

interface ResolveBeltPortConnectivityOptions {
  readonly includeDisconnectedPorts?: boolean;
}

interface BeltConnectedPortState {
  readonly hasConnectedPort: boolean;
  readonly extensionPort: WorldPortReference | null;
}

export function isStrictBeltDefinitionId(
  definitionId: string,
  queries: RegistryQuery,
): boolean {
  return queries.isBelt(definitionId)
}

function isBeltPortExtensionEndpointDevice(
  ctx: DecorationSyncContext,
  definitionId: string,
): boolean {
  return !ctx.renderHost.workspace.registry.queries.isGeneralLogisticsDevice(definitionId)
}

export function resolveBeltInsertionEntries(ctx: DecorationSyncContext): BeltInsertionEntry[] {
  return resolveBeltPortExtensionEntries(ctx)
    .filter((entry) => entry.kind === "belt-output-to-device")
    .map((entry) => ({
      sourceEntityId: entry.beltEntityId,
      targetEntityId: entry.deviceEntityId,
      boundary: entry.boundary,
      edge: entry.edge,
      angleRadians: entry.angleRadians,
    }))
}

export function resolveBeltPortExtensionEntries(ctx: DecorationSyncContext): BeltPortExtensionEntry[] {
  return [...resolveBeltPortConnectivityEntries(ctx, {
    includeDisconnectedPorts: false,
  }).extensions]
}

export function resolveBeltPortConnectivityEntries(
  ctx: DecorationSyncContext,
  options: ResolveBeltPortConnectivityOptions = {},
): BeltPortConnectivityEntries {
  const app = ctx.renderHost.workspace.app
  if (app?.state?.settings?.gameUseBlueprintStyleDeviceImages === true) {
    return {
      extensions: [],
      disconnectedPorts: [],
    }
  }

  const collections = resolveBeltPortReferenceCollections(ctx)
  if (collections === null) {
    return {
      extensions: [],
      disconnectedPorts: [],
    }
  }

  const extensions: BeltPortExtensionEntry[] = []
  const disconnectedPorts: BeltDisconnectedPortEntry[] = []
  const includeDisconnectedPorts = options.includeDisconnectedPorts ?? true

  for (const outputPort of collections.outputPorts) {
    if (!isStrictBeltDefinitionId(
      outputPort.entity.definitionId,
      ctx.renderHost.workspace.registry.queries,
    )) {
      continue
    }

    const targetCell = addGridPoints(outputPort.cell, resolveEdgeDelta(outputPort.edge))
    const targetKey = createConnectionKey(targetCell, oppositeEdge(outputPort.edge))
    const targetPorts = collections.inputPortsByConnectionKey.get(targetKey) ?? []
    const targetState = resolveBeltConnectedPortState(ctx, targetPorts, outputPort.entity.id)

    if (includeDisconnectedPorts && !targetState.hasConnectedPort) {
      disconnectedPorts.push({
        kind: "output",
        beltEntityId: outputPort.entity.id,
        boundary: resolvePortBoundaryPoint(outputPort.cell, outputPort.edge),
        edge: outputPort.edge,
        angleRadians: resolveEdgeAngleRadians(outputPort.edge),
      })
    }

    if (targetState.extensionPort === null) {
      continue
    }

    extensions.push({
      kind: "belt-output-to-device",
      beltEntityId: outputPort.entity.id,
      deviceEntityId: targetState.extensionPort.entity.id,
      boundary: resolvePortBoundaryPoint(outputPort.cell, outputPort.edge),
      edge: outputPort.edge,
      angleRadians: resolveEdgeAngleRadians(outputPort.edge),
      localStartCells: 0,
      localEndCells: BELT_INSERTION_DEPTH_CELLS,
      spriteCenterXCells: BELT_INSERTION_DEPTH_CELLS - 0.5,
    })
  }

  for (const inputPort of collections.inputPorts) {
    if (!isStrictBeltDefinitionId(
      inputPort.entity.definitionId,
      ctx.renderHost.workspace.registry.queries,
    )) {
      continue
    }

    const sourceCell = addGridPoints(inputPort.cell, resolveEdgeDelta(inputPort.edge))
    const sourceKey = createConnectionKey(sourceCell, oppositeEdge(inputPort.edge))
    const sourcePorts = collections.outputPortsByConnectionKey.get(sourceKey) ?? []
    const sourceState = resolveBeltConnectedPortState(ctx, sourcePorts, inputPort.entity.id)
    const flowEdge = oppositeEdge(inputPort.edge)

    if (includeDisconnectedPorts && !sourceState.hasConnectedPort) {
      disconnectedPorts.push({
        kind: "input",
        beltEntityId: inputPort.entity.id,
        boundary: resolvePortBoundaryPoint(inputPort.cell, inputPort.edge),
        edge: flowEdge,
        angleRadians: resolveEdgeAngleRadians(flowEdge),
      })
    }

    if (sourceState.extensionPort === null) {
      continue
    }

    extensions.push({
      kind: "device-output-to-belt",
      beltEntityId: inputPort.entity.id,
      deviceEntityId: sourceState.extensionPort.entity.id,
      boundary: resolvePortBoundaryPoint(inputPort.cell, inputPort.edge),
      edge: flowEdge,
      angleRadians: resolveEdgeAngleRadians(flowEdge),
      localStartCells: -BELT_INSERTION_DEPTH_CELLS,
      localEndCells: 0,
      spriteCenterXCells: 0.5 - BELT_INSERTION_DEPTH_CELLS,
    })
  }

  return {
    extensions,
    disconnectedPorts,
  }
}

function resolveBeltConnectedPortState(
  ctx: DecorationSyncContext,
  ports: readonly WorldPortReference[],
  sourceEntityId: string,
): BeltConnectedPortState {
  let hasConnectedPort = false
  let extensionPort: WorldPortReference | null = null

  for (const port of ports) {
    if (port.entity.id === sourceEntityId) {
      continue
    }

    hasConnectedPort = true
    if (isBeltPortExtensionEndpointDevice(ctx, port.entity.definitionId)) {
      extensionPort = port
      break
    }
  }

  return {
    hasConnectedPort,
    extensionPort,
  }
}

function resolveBeltPortReferenceCollections(ctx: DecorationSyncContext): BeltPortReferenceCollections | null {
  const editor = ctx.renderHost.workspace.editor
  if (editor === null) {
    return null
  }

  const definitionMap = createEntityDefinitionMap(ctx)
  const entities = editor.queries.listEntities()
  const inputPortsByConnectionKey = new Map<string, WorldPortReference[]>()
  const outputPortsByConnectionKey = new Map<string, WorldPortReference[]>()
  const outputPorts: WorldPortReference[] = []
  const inputPorts: WorldPortReference[] = []

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
        inputPorts.push(portReference)
        addPortReference(inputPortsByConnectionKey, portReference)
      }

      if (portReference.group.direction === "output" || portReference.group.direction === "bidirectional") {
        outputPorts.push(portReference)
        addPortReference(outputPortsByConnectionKey, portReference)
      }
    }
  }

  return {
    inputPorts,
    outputPorts,
    inputPortsByConnectionKey,
    outputPortsByConnectionKey,
  }
}

function addPortReference(
  map: Map<string, WorldPortReference[]>,
  portReference: WorldPortReference,
): void {
  const key = createConnectionKey(portReference.cell, portReference.edge)
  const existing = map.get(key)
  if (existing === undefined) {
    map.set(key, [portReference])
  } else {
    existing.push(portReference)
  }
}

export function resolveBeltVisualPathEntries(ctx: DecorationSyncContext): BeltVisualPathEntry[] {
  const editor = ctx.renderHost.workspace.editor
  if (editor === null) {
    return []
  }

  const definitionMap = createEntityDefinitionMap(ctx)
  const entities = editor.queries.listEntities()
  const entityOrderIndexById = new Map(
    entities.map((entity, index) => [entity.id, index]),
  )
  const rawEntries = entities.flatMap((entity) => {
    const definition = definitionMap.get(entity.definitionId)
    if (
      definition === undefined
      || !isStrictBeltDefinitionId(
        entity.definitionId,
        ctx.renderHost.workspace.registry.queries,
      )
    ) {
      return []
    }

    const inputPort = resolveSingleWorldPortReferenceByDirection(entity, definition, "input")
    const outputPort = resolveSingleWorldPortReferenceByDirection(entity, definition, "output")
    const lengthCells = resolveBeltPathLengthCells(definition)
    if (inputPort === null || outputPort === null || lengthCells === null) {
      return []
    }

    return [{
      entity,
      definition,
      inputConnectionKey: createConnectionKey(inputPort.cell, inputPort.edge),
      outputConnectionKey: createConnectionKey(
        addGridPoints(outputPort.cell, resolveEdgeDelta(outputPort.edge)),
        oppositeEdge(outputPort.edge),
      ),
      lengthCells,
    }]
  })

  const phaseOffsetByEntityId = resolveBeltPathPhaseOffsets({
    entries: rawEntries,
    entityOrderIndexById,
  })

  return rawEntries.map((entry) => ({
    ...entry,
    phaseOffsetCells: phaseOffsetByEntityId.get(entry.entity.id) ?? 0,
  }))
}

export function resolveBeltPathSample(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
  progress: number;
  queries: RegistryQuery;
}): BeltPathSample | null {
  if (!isStrictBeltDefinitionId(options.entity.definitionId, options.queries)) {
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

export function resolveBeltPathSampleAtDistance(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
  distanceCells: number;
  queries: RegistryQuery;
}): BeltPathSample | null {
  const lengthCells = resolveBeltPathLengthCells(options.definition)
  if (lengthCells === null || lengthCells <= 0) {
    return null
  }

  return resolveBeltPathSample({
    entity: options.entity,
    definition: options.definition,
    progress: options.distanceCells / lengthCells,
    queries: options.queries,
  })
}

export function resolveBeltPathLengthCells(definition: EntityDefinition): number | null {
  const endpoints = resolveBeltPathEndpoints(definition)
  if (endpoints === null) {
    return null
  }

  if (areOppositeEdges(endpoints.input.edge, endpoints.output.edge)) {
    return distanceBetweenPoints(endpoints.input.point, endpoints.output.point)
  }

  const corner = resolveSharedCorner(endpoints.input.edge, endpoints.output.edge)
  if (corner === null) {
    return null
  }

  const startAngle = angleBetweenPoints(corner, endpoints.input.point)
  const endAngle = angleBetweenPoints(corner, endpoints.output.point)
  const delta = normalizeTurnDelta(startAngle, endAngle)
  const radius = distanceBetweenPoints(corner, endpoints.input.point)

  return Math.abs(delta) * radius
}

export function resolveViewportPoint(options: {
  point: GridFloatPoint;
  viewportBounds: DecorationViewportBounds;
  viewportState: Pick<RenderViewportState, "centerX" | "centerY" | "gridCellPixelSize" | "displayRotation">;
}): GridFloatPoint {
  return resolveViewportPointFromWorldPoint({
    worldPoint: options.point,
    viewportBounds: options.viewportBounds,
    viewportCenter: {
      x: options.viewportState.centerX,
      y: options.viewportState.centerY,
    },
    gridCellPixelSize: options.viewportState.gridCellPixelSize,
    displayRotation: options.viewportState.displayRotation,
  })
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
    ctx.renderHost.workspace.registry.entityDefinitions.map((definition) => [
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

function resolveSingleWorldPortReferenceByDirection(
  entity: WorldEntity,
  definition: EntityDefinition,
  direction: "input" | "output",
): WorldPortReference | null {
  for (const portReference of resolveWorldPortReferences(entity, definition)) {
    if (portReference.group.kind !== "item" || portReference.group.direction !== direction) {
      continue
    }

    return portReference
  }

  return null
}

function resolveBeltPathPhaseOffsets(options: {
  entries: ReadonlyArray<Omit<BeltVisualPathEntry, "phaseOffsetCells">>;
  entityOrderIndexById: ReadonlyMap<string, number>;
}): Map<string, number> {
  const entryByEntityId = new Map(
    options.entries.map((entry) => [entry.entity.id, entry]),
  )
  const entriesByInputConnectionKey = new Map<string, Array<Omit<BeltVisualPathEntry, "phaseOffsetCells">>>()
  for (const entry of options.entries) {
    const entries = entriesByInputConnectionKey.get(entry.inputConnectionKey)
    if (entries === undefined) {
      entriesByInputConnectionKey.set(entry.inputConnectionKey, [entry])
    } else {
      entries.push(entry)
    }
  }

  for (const entries of entriesByInputConnectionKey.values()) {
    entries.sort((left, right) => compareBeltPathEntries(left, right, options.entityOrderIndexById))
  }

  const nextEntityIdByEntityId = new Map<string, string>()
  const predecessorIdsByEntityId = new Map<string, Set<string>>()
  for (const entry of options.entries) {
    const nextEntry = entriesByInputConnectionKey
      .get(entry.outputConnectionKey)
      ?.find((candidate) => candidate.entity.id !== entry.entity.id)
    if (nextEntry === undefined) {
      continue
    }

    nextEntityIdByEntityId.set(entry.entity.id, nextEntry.entity.id)
    let predecessorIds = predecessorIdsByEntityId.get(nextEntry.entity.id)
    if (predecessorIds === undefined) {
      predecessorIds = new Set()
      predecessorIdsByEntityId.set(nextEntry.entity.id, predecessorIds)
    }

    predecessorIds.add(entry.entity.id)
  }

  const phaseOffsetByEntityId = new Map<string, number>()
  const sortedEntries = [...options.entries].sort((left, right) =>
    compareBeltPathEntries(left, right, options.entityOrderIndexById),
  )

  for (const entry of sortedEntries) {
    const predecessorIds = predecessorIdsByEntityId.get(entry.entity.id)
    if (predecessorIds !== undefined && predecessorIds.size > 0) {
      continue
    }

    assignBeltPathPhaseOffsetsFrom({
      startEntityId: entry.entity.id,
      startPhaseOffsetCells: 0,
      entryByEntityId,
      nextEntityIdByEntityId,
      phaseOffsetByEntityId,
    })
  }

  for (const entry of sortedEntries) {
    if (phaseOffsetByEntityId.has(entry.entity.id)) {
      continue
    }

    assignBeltPathPhaseOffsetsFrom({
      startEntityId: entry.entity.id,
      startPhaseOffsetCells: 0,
      entryByEntityId,
      nextEntityIdByEntityId,
      phaseOffsetByEntityId,
    })
  }

  return phaseOffsetByEntityId
}

function assignBeltPathPhaseOffsetsFrom(options: {
  startEntityId: string;
  startPhaseOffsetCells: number;
  entryByEntityId: ReadonlyMap<string, Omit<BeltVisualPathEntry, "phaseOffsetCells">>;
  nextEntityIdByEntityId: ReadonlyMap<string, string>;
  phaseOffsetByEntityId: Map<string, number>;
}): void {
  let currentEntityId: string | undefined = options.startEntityId
  let phaseOffsetCells = options.startPhaseOffsetCells

  while (currentEntityId !== undefined) {
    if (options.phaseOffsetByEntityId.has(currentEntityId)) {
      return
    }

    const entry = options.entryByEntityId.get(currentEntityId)
    if (entry === undefined) {
      return
    }

    options.phaseOffsetByEntityId.set(currentEntityId, phaseOffsetCells)
    phaseOffsetCells += entry.lengthCells
    currentEntityId = options.nextEntityIdByEntityId.get(currentEntityId)
  }
}

function compareBeltPathEntries(
  left: Pick<BeltVisualPathEntry, "entity">,
  right: Pick<BeltVisualPathEntry, "entity">,
  entityOrderIndexById: ReadonlyMap<string, number>,
): number {
  const leftIndex = entityOrderIndexById.get(left.entity.id) ?? Number.MAX_SAFE_INTEGER
  const rightIndex = entityOrderIndexById.get(right.entity.id) ?? Number.MAX_SAFE_INTEGER
  const indexDelta = leftIndex - rightIndex

  return indexDelta === 0
    ? left.entity.id.localeCompare(right.entity.id)
    : indexDelta
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
