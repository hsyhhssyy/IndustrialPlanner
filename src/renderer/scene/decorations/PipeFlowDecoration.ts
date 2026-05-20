import { Container, Graphics } from "pixi.js"

import type { WorldEntity } from "@/domain/document/world-document"
import { EntityCollectionType } from "@/domain/editor/types/editor-types"
import type { EntityDefinition } from "@/domain/registry/types/entity-definition"
import type {
  GridEdge,
  GridFloatPoint,
  GridPoint,
  GridRotation,
} from "@/domain/shared/grid"
import { resolveViewportPointFromWorldPoint } from "@/shared/geometry/viewport-transform"
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color"

import type { DecorationLayer } from "./DecorationLayer"
import type {
  DecorationSyncContext,
  DecorationViewportBounds,
  RenderViewportState,
} from "./DecorationSyncContext"

const PIPE_VISUAL_SPEED_CELLS_PER_SECOND = 2
const PIPE_CHEVRON_GROUP_SPACING_CELLS = 4
const PIPE_CHEVRON_PAIR_CENTER_SPACING_CELLS = 0.22
const PIPE_CHEVRON_LENGTH_CELLS = 0.22
const PIPE_CHEVRON_WIDTH_CELLS = 0.16
const PIPE_CHEVRON_TAIL_NOTCH_LENGTH_RATIO = 0.24
const PIPE_CHEVRON_ALPHA = 0.95
const VIEWPORT_CULL_MARGIN_CELLS = 2
const DISTANCE_EPSILON = 0.000001

const EDGE_ORDER: readonly GridEdge[] = ["NORTH", "EAST", "SOUTH", "WEST"]

const STRICT_PIPE_DEFINITION_IDS = new Set([
  "pipe_straight_1x1",
  "pipe_turn_cw_1x1",
  "pipe_turn_ccw_1x1",
])

interface VisibleWorldRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface PipeVisualPathEntry {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly inputConnectionKey: string;
  readonly outputConnectionKey: string;
  readonly lengthCells: number;
  readonly phaseOffsetCells: number;
}

interface PipeFlowMark {
  readonly centerX: number;
  readonly centerY: number;
  readonly angleRadians: number;
  readonly tint: number;
}

interface PipeFlowChainEntry {
  readonly entry: PipeVisualPathEntry;
  readonly startDistanceCells: number;
  readonly endDistanceCells: number;
}

interface PipeFlowChain {
  readonly entries: readonly PipeFlowChainEntry[];
  readonly phaseOffsetCells: number;
  readonly lengthCells: number;
}

interface WorldPortReference {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly group: EntityDefinition["portGroups"][number];
  readonly port: EntityDefinition["portGroups"][number]["ports"][number];
  readonly cell: GridPoint;
  readonly edge: GridEdge;
}

interface PipePathEndpoints {
  readonly input: {
    readonly edge: GridEdge;
    readonly point: GridFloatPoint;
  };
  readonly output: {
    readonly edge: GridEdge;
    readonly point: GridFloatPoint;
  };
}

interface PipePathSample {
  readonly point: GridFloatPoint;
  readonly angleRadians: number;
}

export function createPipeFlowDecoration(): DecorationLayer {
  const container = new Container()
  const arrowGraphics = new Graphics({ roundPixels: true })
  const arrowMask = new Graphics({ roundPixels: true })
  arrowGraphics.mask = arrowMask
  container.addChild(arrowGraphics)
  container.addChild(arrowMask)

  return {
    container,

    sync(ctx: DecorationSyncContext): void {
      if (ctx.renderHost.workspace.app?.state?.settings?.gameUseSimplifiedDeviceIcons === true) {
        hide()
        return
      }

      const activePipeEntityIds = resolveActivePipeEntityIds(ctx)
      if (activePipeEntityIds.size === 0) {
        hide()
        return
      }

      const entries = resolvePipeVisualPathEntries(ctx, activePipeEntityIds)
      if (entries.length === 0) {
        hide()
        return
      }

      const marks = resolvePipeFlowMarks(ctx, entries)
      if (marks.length === 0) {
        hide()
        return
      }

      container.visible = true
      arrowGraphics.visible = true
      arrowMask.visible = true
      drawPipeFlowMask(ctx, arrowMask, activePipeEntityIds)
      drawPipeFlowMarks({
        graphics: arrowGraphics,
        marks,
        gridCellSize: ctx.viewportState.gridCellPixelSize,
      })
    },

    destroy(): void {
      arrowGraphics.destroy()
      arrowMask.destroy()
      container.destroy({ children: true })
    },
  }

  function hide(): void {
    container.visible = false
    arrowGraphics.visible = false
    arrowGraphics.clear()
    arrowMask.visible = false
    arrowMask.clear()
  }
}

function resolveActivePipeEntityIds(ctx: DecorationSyncContext): Set<string> {
  const editor = ctx.renderHost.workspace.editor
  const queries = ctx.renderHost.workspace.simulation?.queries
  if (editor === null || queries === undefined) {
    return new Set()
  }

  const activePipeEntityIds = new Set<string>()
  for (const entity of editor.queries.listEntities()) {
    if (!isStrictPipeDefinitionId(entity.definitionId)) {
      continue
    }

    if (queries.getPipeFluidItemId(entity.id) !== null) {
      activePipeEntityIds.add(entity.id)
    }
  }

  return activePipeEntityIds
}

function drawPipeFlowMask(
  ctx: DecorationSyncContext,
  graphics: Graphics,
  activePipeEntityIds: ReadonlySet<string>,
): void {
  graphics.clear()

  const editor = ctx.renderHost.workspace.editor
  if (editor === null) {
    return
  }

  const gridCellSize = ctx.viewportState.gridCellPixelSize
  const visibleRect = resolveVisibleWorldRect(ctx.viewportState, ctx.viewportBounds)
  const definitionMap = createEntityDefinitionMap(ctx)
  for (const entity of editor.queries.listEntities()) {
    if (!activePipeEntityIds.has(entity.id) || !isStrictPipeDefinitionId(entity.definitionId)) {
      continue
    }

    const definition = definitionMap.get(entity.definitionId)
    if (definition === undefined || !isWorldEntityVisible(entity, definition.footprint, visibleRect)) {
      continue
    }

    const cellTopLeft = resolveViewportPoint({
      point: entity.position,
      viewportBounds: ctx.viewportBounds,
      viewportState: ctx.viewportState,
    })

    graphics
      .rect(cellTopLeft.x, cellTopLeft.y, gridCellSize, gridCellSize)
      .fill(0xffffff)
  }
}

function resolvePipeFlowMarks(
  ctx: DecorationSyncContext,
  entries: readonly PipeVisualPathEntry[],
): PipeFlowMark[] {
  const marks: PipeFlowMark[] = []

  for (const chain of resolvePipeFlowChains(entries)) {
    const overflowCells = PIPE_CHEVRON_PAIR_CENTER_SPACING_CELLS / 2
      + PIPE_CHEVRON_LENGTH_CELLS / 2
    const markDistances = resolveRepeatingLocalDistances({
      phaseOffsetCells: chain.phaseOffsetCells,
      pathLengthCells: chain.lengthCells,
      spacingCells: PIPE_CHEVRON_GROUP_SPACING_CELLS,
      speedCellsPerSecond: PIPE_VISUAL_SPEED_CELLS_PER_SECOND,
      nowMs: ctx.nowMs,
      startOverflowCells: overflowCells,
      endOverflowCells: overflowCells,
    })

    for (const distanceCells of markDistances) {
      const mark = resolvePipeFlowMarkAtChainDistance({
        ctx,
        chain,
        distanceCells,
      })
      if (mark !== null) {
        marks.push(mark)
      }
    }
  }

  return marks
}

function resolvePipeFlowChains(entries: readonly PipeVisualPathEntry[]): PipeFlowChain[] {
  const entryByEntityId = new Map(
    entries.map((entry) => [entry.entity.id, entry]),
  )
  const entriesByInputConnectionKey = new Map<string, PipeVisualPathEntry[]>()
  for (const entry of entries) {
    const candidates = entriesByInputConnectionKey.get(entry.inputConnectionKey)
    if (candidates === undefined) {
      entriesByInputConnectionKey.set(entry.inputConnectionKey, [entry])
    } else {
      candidates.push(entry)
    }
  }

  const nextEntityIdByEntityId = new Map<string, string>()
  const predecessorIdsByEntityId = new Map<string, Set<string>>()
  for (const entry of entries) {
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

  const sortedEntries = [...entries].sort(comparePipeFlowEntries)
  const visitedEntityIds = new Set<string>()
  const chains: PipeFlowChain[] = []

  for (const entry of sortedEntries) {
    const predecessorIds = predecessorIdsByEntityId.get(entry.entity.id)
    if (predecessorIds !== undefined && predecessorIds.size > 0) {
      continue
    }

    chains.push(resolvePipeFlowChainFrom({
      startEntry: entry,
      entryByEntityId,
      nextEntityIdByEntityId,
      visitedEntityIds,
    }))
  }

  for (const entry of sortedEntries) {
    if (visitedEntityIds.has(entry.entity.id)) {
      continue
    }

    chains.push(resolvePipeFlowChainFrom({
      startEntry: entry,
      entryByEntityId,
      nextEntityIdByEntityId,
      visitedEntityIds,
    }))
  }

  return chains.filter((chain) => chain.entries.length > 0)
}

function resolvePipeFlowChainFrom(options: {
  startEntry: PipeVisualPathEntry;
  entryByEntityId: ReadonlyMap<string, PipeVisualPathEntry>;
  nextEntityIdByEntityId: ReadonlyMap<string, string>;
  visitedEntityIds: Set<string>;
}): PipeFlowChain {
  const rawEntries: PipeVisualPathEntry[] = []
  let currentEntry: PipeVisualPathEntry | undefined = options.startEntry

  while (
    currentEntry !== undefined
    && !options.visitedEntityIds.has(currentEntry.entity.id)
  ) {
    options.visitedEntityIds.add(currentEntry.entity.id)
    rawEntries.push(currentEntry)
    currentEntry = options.entryByEntityId.get(
      options.nextEntityIdByEntityId.get(currentEntry.entity.id) ?? "",
    )
  }

  let distanceCells = 0
  const chainEntries = rawEntries.map((entry) => {
    const startDistanceCells = distanceCells
    distanceCells += entry.lengthCells

    return {
      entry,
      startDistanceCells,
      endDistanceCells: distanceCells,
    }
  })

  return {
    entries: chainEntries,
    phaseOffsetCells: rawEntries[0]?.phaseOffsetCells ?? 0,
    lengthCells: distanceCells,
  }
}

function comparePipeFlowEntries(
  left: PipeVisualPathEntry,
  right: PipeVisualPathEntry,
): number {
  const phaseDelta = left.phaseOffsetCells - right.phaseOffsetCells

  return phaseDelta === 0
    ? left.entity.id.localeCompare(right.entity.id)
    : phaseDelta
}

function resolvePipeFlowMarkAtChainDistance(options: {
  ctx: DecorationSyncContext;
  chain: PipeFlowChain;
  distanceCells: number;
}): PipeFlowMark | null {
  const target = resolvePipeFlowChainDistanceTarget(options.chain, options.distanceCells)
  if (target === null) {
    return null
  }

  return resolvePipeFlowMark({
    ctx: options.ctx,
    entry: target.entry,
    distanceCells: target.distanceCells,
    overflowCells: target.overflowCells,
  })
}

function resolvePipeFlowChainDistanceTarget(
  chain: PipeFlowChain,
  distanceCells: number,
): {
  readonly entry: PipeVisualPathEntry;
  readonly distanceCells: number;
  readonly overflowCells: number;
} | null {
  const firstChainEntry = chain.entries[0]
  if (firstChainEntry === undefined) {
    return null
  }

  if (distanceCells < 0) {
    return {
      entry: firstChainEntry.entry,
      distanceCells: 0,
      overflowCells: distanceCells,
    }
  }

  if (distanceCells >= chain.lengthCells) {
    const lastChainEntry = chain.entries.at(-1)
    if (lastChainEntry === undefined) {
      return null
    }

    return {
      entry: lastChainEntry.entry,
      distanceCells: lastChainEntry.entry.lengthCells,
      overflowCells: distanceCells - chain.lengthCells,
    }
  }

  const chainEntry = chain.entries.find((entry) =>
    distanceCells >= entry.startDistanceCells - DISTANCE_EPSILON
    && distanceCells < entry.endDistanceCells - DISTANCE_EPSILON,
  ) ?? chain.entries.at(-1)
  if (chainEntry === undefined) {
    return null
  }

  const localDistanceCells = distanceCells - chainEntry.startDistanceCells

  return {
    entry: chainEntry.entry,
    distanceCells: Math.min(
      Math.max(0, localDistanceCells),
      chainEntry.entry.lengthCells,
    ),
    overflowCells: 0,
  }
}

function resolvePipeFlowMark(options: {
  ctx: DecorationSyncContext;
  entry: PipeVisualPathEntry;
  distanceCells: number;
  overflowCells: number;
}): PipeFlowMark | null {
  const sample = resolvePipePathSampleAtDistance({
    entity: options.entry.entity,
    definition: options.entry.definition,
    distanceCells: options.distanceCells,
  })
  if (sample === null) {
    return null
  }

  const center = resolveViewportPoint({
    point: {
      x:
        options.entry.entity.position.x
        + sample.point.x
        + Math.cos(sample.angleRadians) * options.overflowCells,
      y:
        options.entry.entity.position.y
        + sample.point.y
        + Math.sin(sample.angleRadians) * options.overflowCells,
    },
    viewportBounds: options.ctx.viewportBounds,
    viewportState: options.ctx.viewportState,
  })

  return {
    centerX: center.x,
    centerY: center.y,
    angleRadians: sample.angleRadians,
    tint: resolvePipeFlowTintColor(options.ctx, options.entry),
  }
}

function drawPipeFlowMarks(options: {
  graphics: Graphics;
  marks: readonly PipeFlowMark[];
  gridCellSize: number;
}): void {
  const chevronLength = options.gridCellSize * PIPE_CHEVRON_LENGTH_CELLS
  const chevronWidth = options.gridCellSize * PIPE_CHEVRON_WIDTH_CELLS
  const pairHalfDistance = options.gridCellSize * PIPE_CHEVRON_PAIR_CENTER_SPACING_CELLS / 2

  options.graphics.clear()

  for (const mark of options.marks) {
    const cos = Math.cos(mark.angleRadians)
    const sin = Math.sin(mark.angleRadians)
    for (const offset of [-pairHalfDistance, pairHalfDistance]) {
      options.graphics
        .poly(resolveRotatedChevronPoints({
          centerX: mark.centerX + cos * offset,
          centerY: mark.centerY + sin * offset,
          angleRadians: mark.angleRadians,
        }, chevronLength, chevronWidth), true)
        .fill({ color: mark.tint, alpha: PIPE_CHEVRON_ALPHA })
    }
  }
}

function resolveRotatedChevronPoints(
  mark: Pick<PipeFlowMark, "centerX" | "centerY" | "angleRadians">,
  length: number,
  width: number,
): number[] {
  const halfLength = length / 2
  const halfWidth = width / 2
  const tailNotchX = -halfLength + length * PIPE_CHEVRON_TAIL_NOTCH_LENGTH_RATIO

  return rotateLocalPoints({
    centerX: mark.centerX,
    centerY: mark.centerY,
    angleRadians: mark.angleRadians,
    localPoints: [
      { x: halfLength, y: 0 },
      { x: -halfLength, y: -halfWidth },
      { x: tailNotchX, y: 0 },
      { x: -halfLength, y: halfWidth },
    ],
  })
}

function resolvePipeVisualPathEntries(
  ctx: DecorationSyncContext,
  activePipeEntityIds: ReadonlySet<string>,
): PipeVisualPathEntry[] {
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
      || !activePipeEntityIds.has(entity.id)
      || !isStrictPipeDefinitionId(entity.definitionId)
    ) {
      return []
    }

    const inputPort = resolveSingleWorldPortReferenceByDirection(entity, definition, "input")
    const outputPort = resolveSingleWorldPortReferenceByDirection(entity, definition, "output")
    const lengthCells = resolvePipePathLengthCells(definition)
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

  const phaseOffsetByEntityId = resolvePipePathPhaseOffsets({
    entries: rawEntries,
    entityOrderIndexById,
  })

  return rawEntries.map((entry) => ({
    ...entry,
    phaseOffsetCells: phaseOffsetByEntityId.get(entry.entity.id) ?? 0,
  }))
}

function resolvePipePathPhaseOffsets(options: {
  entries: ReadonlyArray<Omit<PipeVisualPathEntry, "phaseOffsetCells">>;
  entityOrderIndexById: ReadonlyMap<string, number>;
}): Map<string, number> {
  const entryByEntityId = new Map(
    options.entries.map((entry) => [entry.entity.id, entry]),
  )
  const entriesByInputConnectionKey = new Map<string, Array<Omit<PipeVisualPathEntry, "phaseOffsetCells">>>()
  for (const entry of options.entries) {
    const entries = entriesByInputConnectionKey.get(entry.inputConnectionKey)
    if (entries === undefined) {
      entriesByInputConnectionKey.set(entry.inputConnectionKey, [entry])
    } else {
      entries.push(entry)
    }
  }

  for (const entries of entriesByInputConnectionKey.values()) {
    entries.sort((left, right) => comparePipePathEntries(left, right, options.entityOrderIndexById))
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
    comparePipePathEntries(left, right, options.entityOrderIndexById),
  )

  for (const entry of sortedEntries) {
    const predecessorIds = predecessorIdsByEntityId.get(entry.entity.id)
    if (predecessorIds !== undefined && predecessorIds.size > 0) {
      continue
    }

    assignPipePathPhaseOffsetsFrom({
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

    assignPipePathPhaseOffsetsFrom({
      startEntityId: entry.entity.id,
      startPhaseOffsetCells: 0,
      entryByEntityId,
      nextEntityIdByEntityId,
      phaseOffsetByEntityId,
    })
  }

  return phaseOffsetByEntityId
}

function assignPipePathPhaseOffsetsFrom(options: {
  startEntityId: string;
  startPhaseOffsetCells: number;
  entryByEntityId: ReadonlyMap<string, Omit<PipeVisualPathEntry, "phaseOffsetCells">>;
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

function comparePipePathEntries(
  left: Pick<PipeVisualPathEntry, "entity">,
  right: Pick<PipeVisualPathEntry, "entity">,
  entityOrderIndexById: ReadonlyMap<string, number>,
): number {
  const leftIndex = entityOrderIndexById.get(left.entity.id) ?? Number.MAX_SAFE_INTEGER
  const rightIndex = entityOrderIndexById.get(right.entity.id) ?? Number.MAX_SAFE_INTEGER
  const indexDelta = leftIndex - rightIndex

  return indexDelta === 0
    ? left.entity.id.localeCompare(right.entity.id)
    : indexDelta
}

function resolvePipePathSampleAtDistance(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
  distanceCells: number;
}): PipePathSample | null {
  const lengthCells = resolvePipePathLengthCells(options.definition)
  if (lengthCells === null || lengthCells <= 0) {
    return null
  }

  return resolvePipePathSample({
    entity: options.entity,
    definition: options.definition,
    progress: options.distanceCells / lengthCells,
  })
}

function resolvePipePathSample(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
  progress: number;
}): PipePathSample | null {
  if (!isStrictPipeDefinitionId(options.entity.definitionId)) {
    return null
  }

  const endpoints = resolvePipePathEndpoints(options.definition)
  if (endpoints === null) {
    return null
  }

  const progress = clamp01(options.progress)
  const baseSample = sampleBasePipePath(endpoints, progress)
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

function resolvePipePathLengthCells(definition: EntityDefinition): number | null {
  const endpoints = resolvePipePathEndpoints(definition)
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

function resolvePipePathEndpoints(definition: EntityDefinition): PipePathEndpoints | null {
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
): EntityDefinition["portGroups"][number]["ports"][number] | null {
  for (const group of definition.portGroups) {
    if (group.kind !== "fluid" || group.direction !== direction) {
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
    if (portReference.group.kind !== "fluid" || portReference.group.direction !== direction) {
      continue
    }

    return portReference
  }

  return null
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

function sampleBasePipePath(
  endpoints: PipePathEndpoints,
  progress: number,
): PipePathSample | null {
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

function resolveRepeatingLocalDistances(options: {
  readonly phaseOffsetCells: number;
  readonly pathLengthCells: number;
  readonly spacingCells: number;
  readonly speedCellsPerSecond: number;
  readonly nowMs: number;
  readonly startOverflowCells?: number;
  readonly endOverflowCells?: number;
}): number[] {
  const startOverflowCells = Math.max(0, options.startOverflowCells ?? 0)
  const endOverflowCells = Math.max(0, options.endOverflowCells ?? 0)

  if (
    options.pathLengthCells <= 0
    || options.spacingCells <= 0
    || !Number.isFinite(options.pathLengthCells)
    || !Number.isFinite(options.spacingCells)
    || !Number.isFinite(options.speedCellsPerSecond)
    || !Number.isFinite(startOverflowCells)
    || !Number.isFinite(endOverflowCells)
  ) {
    return []
  }

  const traveledCells = positiveModulo(
    options.nowMs / 1000 * options.speedCellsPerSecond,
    options.spacingCells,
  )
  const firstRepeatIndex = Math.ceil(
    (options.phaseOffsetCells - startOverflowCells - traveledCells) / options.spacingCells,
  )
  const distances: number[] = []

  for (
    let repeatIndex = firstRepeatIndex;
    repeatIndex < firstRepeatIndex + Math.ceil(
      (options.pathLengthCells + startOverflowCells + endOverflowCells) / options.spacingCells,
    ) + 2;
    repeatIndex += 1
  ) {
    const distanceCells = repeatIndex * options.spacingCells
      + traveledCells
      - options.phaseOffsetCells

    if (distanceCells < -startOverflowCells - DISTANCE_EPSILON) {
      continue
    }

    if (distanceCells >= options.pathLengthCells + endOverflowCells - DISTANCE_EPSILON) {
      continue
    }

    distances.push(Math.abs(distanceCells) <= DISTANCE_EPSILON ? 0 : distanceCells)
  }

  return distances
}

function resolvePipeFlowTintColor(
  ctx: DecorationSyncContext,
  entry: PipeVisualPathEntry,
): number {
  const collections = ctx.renderHost.workspace.editor?.state?.collections
  const ordinaryColor = resolveAppThemeColorNumber(
    ctx.theme,
    ctx.theme.renderer.pipeBodyTintColorKey,
  )
  const selectionTintColor = resolveAppThemeColorNumber(
    ctx.theme,
    ctx.theme.renderer.worldPreviewRectFillColorKey,
  )

  if (!collections) {
    return ordinaryColor
  }

  const previewCollection = collections[EntityCollectionType.preview]
  const marqueeCollection = collections[EntityCollectionType.marquee]
  const reverseMarqueeCollection = collections[EntityCollectionType.reverseMarquee]
  const logisticsHeadCollection = collections[EntityCollectionType.logisticsHead]
  const selectionCollection = collections[EntityCollectionType.selection]
  const isPreview = previewCollection?.contains(entry.entity.id) ?? false
  const isPreviewGroup = isPreview && (previewCollection?.length ?? 0) > 1
  const isMarquee = marqueeCollection?.contains(entry.entity.id) ?? false
  const isReverseMarquee = reverseMarqueeCollection?.contains(entry.entity.id) ?? false
  const isPlacementHead = logisticsHeadCollection?.contains(entry.entity.id) ?? false
  const isSelected = selectionCollection?.contains(entry.entity.id) ?? false

  if (
    isPreviewGroup
    || isMarquee
    || (isSelected && (selectionCollection?.length ?? 0) > 1 && !isReverseMarquee)
  ) {
    return selectionTintColor
  }

  if (isPreview || isPlacementHead || isSelected) {
    return resolveAppThemeColorNumber(
      ctx.theme,
      ctx.theme.renderer.dedicatedLogisticFocusTintColorKey,
    )
  }

  return ordinaryColor
}

function isStrictPipeDefinitionId(definitionId: string): boolean {
  return STRICT_PIPE_DEFINITION_IDS.has(definitionId)
}

function resolveVisibleWorldRect(
  viewportState: Pick<RenderViewportState, "centerX" | "centerY" | "gridCellPixelSize">,
  viewportBounds: DecorationViewportBounds,
  marginCells = VIEWPORT_CULL_MARGIN_CELLS,
): VisibleWorldRect {
  const halfW = viewportBounds.width / 2 / viewportState.gridCellPixelSize
  const halfH = viewportBounds.height / 2 / viewportState.gridCellPixelSize

  return {
    left: viewportState.centerX - halfW - marginCells,
    right: viewportState.centerX + halfW + marginCells,
    top: viewportState.centerY - halfH - marginCells,
    bottom: viewportState.centerY + halfH + marginCells,
  }
}

function isWorldEntityVisible(
  entity: WorldEntity,
  footprint: EntityDefinition["footprint"],
  visibleRect: VisibleWorldRect,
): boolean {
  const rotated = getRotatedGridFootprint(footprint, entity.rotation)
  const entityLeft = entity.position.x
  const entityTop = entity.position.y
  const entityRight = entityLeft + rotated.width
  const entityBottom = entityTop + rotated.height

  return entityRight > visibleRect.left
    && entityLeft < visibleRect.right
    && entityBottom > visibleRect.top
    && entityTop < visibleRect.bottom
}

function getRotatedGridFootprint(
  footprint: EntityDefinition["footprint"],
  rotation: GridRotation,
): EntityDefinition["footprint"] {
  if (rotation === 90 || rotation === 270) {
    return {
      width: footprint.height,
      height: footprint.width,
    }
  }

  return footprint
}

function resolveViewportPoint(options: {
  point: GridFloatPoint;
  viewportBounds: DecorationViewportBounds;
  viewportState: Pick<RenderViewportState, "centerX" | "centerY" | "gridCellPixelSize">;
}): GridFloatPoint {
  return resolveViewportPointFromWorldPoint({
    worldPoint: options.point,
    viewportBounds: options.viewportBounds,
    viewportCenter: {
      x: options.viewportState.centerX,
      y: options.viewportState.centerY,
    },
    gridCellPixelSize: options.viewportState.gridCellPixelSize,
  })
}

function createEntityDefinitionMap(
  ctx: DecorationSyncContext,
): Map<string, EntityDefinition> {
  return new Map(
    ctx.renderHost.workspace.registry.entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  )
}

function resolveRotatedPortCell(options: {
  localCell: GridPoint;
  footprint: EntityDefinition["footprint"];
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
  footprint: EntityDefinition["footprint"],
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

function angleBetweenPoints(from: GridFloatPoint, to: GridFloatPoint): number {
  return Math.atan2(to.y - from.y, to.x - from.x)
}

function distanceBetweenPoints(left: GridFloatPoint, right: GridFloatPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y)
}

function lerpPoint(
  from: GridFloatPoint,
  to: GridFloatPoint,
  progress: number,
): GridFloatPoint {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  }
}

function rotateLocalPoints(options: {
  centerX: number;
  centerY: number;
  angleRadians: number;
  localPoints: ReadonlyArray<{
    readonly x: number;
    readonly y: number;
  }>;
}): number[] {
  const cos = Math.cos(options.angleRadians)
  const sin = Math.sin(options.angleRadians)
  const points: number[] = []

  for (const point of options.localPoints) {
    points.push(
      options.centerX + point.x * cos - point.y * sin,
      options.centerY + point.x * sin + point.y * cos,
    )
  }

  return points
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function rotationToRadians(rotation: GridRotation): number {
  return rotation / 180 * Math.PI
}

function normalizeRadians(value: number): number {
  let normalized = value
  while (normalized <= -Math.PI) {
    normalized += Math.PI * 2
  }

  while (normalized > Math.PI) {
    normalized -= Math.PI * 2
  }

  return normalized
}

function positiveModulo(value: number, modulo: number): number {
  const result = value % modulo

  return result < 0 ? result + modulo : result
}
