import {
  Container,
  Graphics,
  Mesh,
  RopeGeometry,
  Texture,
} from "pixi.js"

import { resolveDedicatedLogisticTintColor } from "@/renderer/sprites/dedicated-logistic-sprite"
import {
  resolveDisplayRotationRadians,
  resolveViewportRectFromWorldGridRect,
} from "@/shared/geometry/viewport-transform"

import { BELT_TRANSPORT_DURATION_SECONDS } from "@/domain/registry";

import type { DecorationLayer } from "./DecorationLayer"
import type { DecorationSyncContext } from "./DecorationSyncContext"
import {
  isStrictBeltDefinitionId,
  resolveBeltPortExtensionEntries,
  resolveBeltPathSampleAtDistance,
  resolveBeltVisualPathEntries,
  resolveViewportPoint,
  resolveVisibleWorldRect,
  isWorldEntityVisible,
  createEntityDefinitionMap,
  type BeltVisualPathEntry,
} from "./BeltVisualGeometry"

const BELT_VISUAL_SPEED_CELLS_PER_SECOND = 1 / BELT_TRANSPORT_DURATION_SECONDS
const BELT_HIGHLIGHT_ENABLED = false
const HIGHLIGHT_TEXTURE_KEY = "texture-belt-highlight-strip-texture"
const HIGHLIGHT_SPEED_MULTIPLIER = 2
const HIGHLIGHT_SPACING_CELLS = 2
const HIGHLIGHT_LENGTH_CELLS = 2
const HIGHLIGHT_WIDTH_CELLS = 0.78
const HIGHLIGHT_ALPHA = 0.82
const HIGHLIGHT_TURN_SAMPLE_COUNT = 16
const ARROW_SPACING_CELLS = 1
const ARROW_LENGTH_RATIO = 0.28
const ARROW_WIDTH_RATIO = 0.24
const ARROW_TAIL_NOTCH_LENGTH_RATIO = 0.18
const DISTANCE_EPSILON = 0.000001

type BeltFlowMarkKind = "highlight" | "arrow"

interface BeltFlowPoint {
  readonly x: number;
  readonly y: number;
}

interface BeltFlowMark {
  readonly kind: BeltFlowMarkKind;
  readonly centerX: number;
  readonly centerY: number;
  readonly angleRadians: number;
  readonly lengthCells: number;
  readonly tint: number;
  readonly points?: readonly BeltFlowPoint[];
}

interface BeltFlowChainEntry {
  readonly entry: BeltVisualPathEntry;
  readonly startDistanceCells: number;
  readonly endDistanceCells: number;
}

interface BeltFlowChain {
  readonly entries: readonly BeltFlowChainEntry[];
  readonly phaseOffsetCells: number;
  readonly lengthCells: number;
}

export function createBeltFlowDecoration(): DecorationLayer {
  const container = new Container()
  const highlightLayer = new Container()
  const highlightMask = new Graphics({ roundPixels: true })
  const arrowGraphics = new Graphics({ roundPixels: true })
  const arrowMask = new Graphics({ roundPixels: true })
  const highlightMeshes: Array<Mesh<RopeGeometry>> = []
  let destroyed = false
  let highlightTexture: Texture | null = null
  let highlightTextureLoadStarted = false

  highlightLayer.mask = highlightMask
  arrowGraphics.mask = arrowMask
  container.addChild(highlightLayer)
  container.addChild(highlightMask)
  container.addChild(arrowGraphics)
  container.addChild(arrowMask)

  const ensureHighlightTexture = (ctx: DecorationSyncContext): void => {
    if (highlightTextureLoadStarted || highlightTexture !== null) {
      return
    }

    highlightTextureLoadStarted = true
    void ctx.renderHost.textureManager.getTexture(HIGHLIGHT_TEXTURE_KEY).then((texture) => {
      if (destroyed) {
        return
      }

      highlightTexture = texture
    })
  }

  const ensureHighlightMesh = (index: number): Mesh<RopeGeometry> => {
    let mesh = highlightMeshes[index]
    if (mesh !== undefined) {
      return mesh
    }

    mesh = new Mesh({
      texture: Texture.EMPTY,
      geometry: new RopeGeometry({
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        width: 1,
      }),
      roundPixels: true,
    })
    highlightLayer.addChild(mesh)
    highlightMeshes.push(mesh)
    return mesh
  }

  return {
    container,

    sync(ctx: DecorationSyncContext): void {
      if (ctx.renderHost.workspace.app?.state?.settings?.gameUseSimplifiedDeviceIcons === true) {
        hide()
        return
      }

      const entries = resolveBeltVisualPathEntries(ctx)
      if (entries.length === 0) {
        hide()
        return
      }

      const marks = resolveBeltFlowMarks(ctx)
      if (marks.length === 0) {
        hide()
        return
      }

      const hasHighlightMarks = marks.some((mark) => mark.kind === "highlight")
      if (hasHighlightMarks) {
        ensureHighlightTexture(ctx)
      }

      container.visible = true
      highlightLayer.visible = hasHighlightMarks
      highlightMask.visible = hasHighlightMarks
      arrowGraphics.visible = true
      arrowMask.visible = true
      if (hasHighlightMarks) {
        drawHighlightMask(ctx, highlightMask)
      } else {
        highlightMask.clear()
      }
      drawArrowMask(ctx, arrowMask)

      syncHighlightMeshes({
        marks,
        texture: hasHighlightMarks ? highlightTexture : null,
        gridCellSize: ctx.viewportState.gridCellPixelSize,
        ensureHighlightMesh,
        highlightMeshes,
      })
      drawBeltFlowMarks({
        graphics: arrowGraphics,
        marks,
        gridCellSize: ctx.viewportState.gridCellPixelSize,
      })
    },

    destroy(): void {
      destroyed = true
      for (const mesh of highlightMeshes) {
        mesh.destroy()
      }

      highlightMeshes.length = 0
      arrowGraphics.destroy()
      arrowMask.destroy()
      highlightMask.destroy()
      highlightLayer.destroy({ children: true })
      container.destroy({ children: true })
    },
  }

  function hide(): void {
    container.visible = false
    highlightLayer.visible = false
    highlightMask.visible = false
    highlightMask.clear()
    arrowGraphics.visible = false
    arrowGraphics.clear()
    arrowMask.visible = false
    arrowMask.clear()

    for (const mesh of highlightMeshes) {
      mesh.visible = false
    }
  }
}

function drawHighlightMask(ctx: DecorationSyncContext, graphics: Graphics): void {
  graphics.clear()

  const editor = ctx.renderHost.workspace.editor
  if (editor === null) {
    return
  }

  const gridCellSize = ctx.viewportState.gridCellPixelSize
  const visibleRect = resolveVisibleWorldRect(ctx.viewportState, ctx.viewportBounds)
  const definitionMap = createEntityDefinitionMap(ctx)
  for (const entity of editor.queries.listEntities()) {
    if (!isStrictBeltDefinitionId(entity.definitionId)) {
      continue
    }

    const definition = definitionMap.get(entity.definitionId)
    if (definition === undefined || !isWorldEntityVisible(entity, definition.footprint, visibleRect)) {
      continue
    }

    const cellRect = resolveViewportRectFromWorldGridRect({
      gridRect: {
        x: entity.position.x,
        y: entity.position.y,
        width: 1,
        height: 1,
      },
      viewportBounds: ctx.viewportBounds,
      viewportCenter: {
        x: ctx.viewportState.centerX,
        y: ctx.viewportState.centerY,
      },
      gridCellPixelSize: gridCellSize,
      displayRotation: ctx.viewportState.displayRotation,
    })

    if (cellRect === null) {
      continue
    }

    graphics
      .rect(cellRect.left, cellRect.top, cellRect.width, cellRect.height)
      .fill(0xffffff)
  }
}

function drawArrowMask(ctx: DecorationSyncContext, graphics: Graphics): void {
  graphics.clear()

  const editor = ctx.renderHost.workspace.editor
  if (editor === null) {
    return
  }

  const gridCellSize = ctx.viewportState.gridCellPixelSize
  const visibleRect = resolveVisibleWorldRect(ctx.viewportState, ctx.viewportBounds)
  const definitionMap = createEntityDefinitionMap(ctx)
  for (const entity of editor.queries.listEntities()) {
    if (!isStrictBeltDefinitionId(entity.definitionId)) {
      continue
    }

    const definition = definitionMap.get(entity.definitionId)
    if (definition === undefined || !isWorldEntityVisible(entity, definition.footprint, visibleRect)) {
      continue
    }

    const cellRect = resolveViewportRectFromWorldGridRect({
      gridRect: {
        x: entity.position.x,
        y: entity.position.y,
        width: 1,
        height: 1,
      },
      viewportBounds: ctx.viewportBounds,
      viewportCenter: {
        x: ctx.viewportState.centerX,
        y: ctx.viewportState.centerY,
      },
      gridCellPixelSize: gridCellSize,
      displayRotation: ctx.viewportState.displayRotation,
    })

    if (cellRect === null) {
      continue
    }

    graphics
      .rect(cellRect.left, cellRect.top, cellRect.width, cellRect.height)
      .fill(0xffffff)
  }

  for (const entry of resolveBeltPortExtensionEntries(ctx)) {
    const boundary = resolveViewportPoint({
      point: entry.boundary,
      viewportBounds: ctx.viewportBounds,
      viewportState: ctx.viewportState,
    })

    graphics
      .poly(resolveRotatedExtensionMaskPoints({
          centerX: boundary.x,
          centerY: boundary.y,
          angleRadians: entry.angleRadians
            + resolveDisplayRotationRadians(ctx.viewportState.displayRotation),
          startX: entry.localStartCells * gridCellSize,
        endX: entry.localEndCells * gridCellSize,
        halfWidth: gridCellSize / 2,
      }), true)
      .fill(0xffffff)
  }
}

export function resolveBeltFlowMarks(ctx: DecorationSyncContext): BeltFlowMark[] {
  const entries = resolveBeltVisualPathEntries(ctx)
  const marks: BeltFlowMark[] = []
  const chains = resolveBeltFlowChains(entries)

  if (BELT_HIGHLIGHT_ENABLED) {
    for (const chain of chains) {
      const highlightIntervals = resolveRepeatingLocalIntervals({
        phaseOffsetCells: chain.phaseOffsetCells,
        pathLengthCells: chain.lengthCells,
        spacingCells: HIGHLIGHT_SPACING_CELLS,
        lengthCells: HIGHLIGHT_LENGTH_CELLS,
        speedCellsPerSecond: BELT_VISUAL_SPEED_CELLS_PER_SECOND * HIGHLIGHT_SPEED_MULTIPLIER,
        nowMs: ctx.nowMs,
      })

      for (const interval of highlightIntervals) {
        marks.push(...resolveHighlightMarksForInterval({
          ctx,
          chain,
          interval,
        }))
      }
    }
  }

  const portExtensionEntries = resolveBeltPortExtensionEntries(ctx)
  for (const chain of chains) {
    const overflowCells = resolveBeltFlowChainArrowOverflowCells({
      chain,
      portExtensionEntries,
    })
    const arrowDistances = resolveRepeatingLocalDistances({
      phaseOffsetCells: chain.phaseOffsetCells,
      pathLengthCells: chain.lengthCells,
      spacingCells: ARROW_SPACING_CELLS,
      speedCellsPerSecond: BELT_VISUAL_SPEED_CELLS_PER_SECOND,
      nowMs: ctx.nowMs,
      startOverflowCells: overflowCells.startCells,
      endOverflowCells: overflowCells.endCells,
    })

    for (const distanceCells of arrowDistances) {
      const mark = resolveBeltFlowMarkAtChainDistance({
        ctx,
        chain,
        distanceCells,
      })
      if (mark !== null) {
        marks.push(mark)
      }
    }
  }

  // AI-REMOVED 2026-05-12:
  // Reason: Arrow marks must survive while only the arrow tail remains inside the belt mask; per-tile generation removed marks as soon as their center left a tile.
  // Trigger: User observed arrows disappearing abruptly after mask clipping fixed overdraw into empty cells and general logistics devices.
  // Evidence: resolveRepeatingLocalDistances() excluded distanceCells >= entry.lengthCells, so drawBeltFlowMarks() never received the final partially visible arrow.
  // Replacement: Chain-level arrow generation in resolveBeltFlowMarks(), using resolveBeltFlowMarkAtChainDistance().
  // Risk: Low; chain-internal seams no longer generate duplicate endpoint arrows, and tests cover empty/general-logistics/admission boundaries.
  // Human Review: Required
  //
  // Original code:
  // for (const entry of entries) {
  //   const arrowDistances = resolveRepeatingLocalDistances({
  //     phaseOffsetCells: entry.phaseOffsetCells,
  //     pathLengthCells: entry.lengthCells,
  //     spacingCells: ARROW_SPACING_CELLS,
  //     speedCellsPerSecond: BELT_VISUAL_SPEED_CELLS_PER_SECOND,
  //     nowMs: ctx.nowMs,
  //   })
  //
  //   for (const distanceCells of arrowDistances) {
  //     const mark = resolveBeltFlowMark({
  //       kind: "arrow",
  //       ctx,
  //       entry,
  //       distanceCells,
  //       lengthCells: 0,
  //     })
  //     if (mark !== null) {
  //       marks.push(mark)
  //     }
  //   }
  // }

  return marks
}

function resolveBeltFlowChainArrowOverflowCells(options: {
  chain: BeltFlowChain;
  portExtensionEntries: ReturnType<typeof resolveBeltPortExtensionEntries>;
}): {
  readonly startCells: number;
  readonly endCells: number;
} {
  const firstEntry = options.chain.entries[0]?.entry
  const lastEntry = options.chain.entries.at(-1)?.entry
  const halfArrowLengthCells = ARROW_LENGTH_RATIO / 2
  const startExtensionCells = firstEntry === undefined
    ? 0
    : resolveBeltPortExtensionLengthCells(
      options.portExtensionEntries.find((entry) =>
        entry.kind === "device-output-to-belt"
        && entry.beltEntityId === firstEntry.entity.id,
      ),
    )
  const endExtensionCells = lastEntry === undefined
    ? 0
    : resolveBeltPortExtensionLengthCells(
      options.portExtensionEntries.find((entry) =>
        entry.kind === "belt-output-to-device"
        && entry.beltEntityId === lastEntry.entity.id,
      ),
    )

  return {
    startCells: halfArrowLengthCells + startExtensionCells,
    endCells: halfArrowLengthCells + endExtensionCells,
  }
}

function resolveBeltPortExtensionLengthCells(
  entry: ReturnType<typeof resolveBeltPortExtensionEntries>[number] | undefined,
): number {
  if (entry === undefined) {
    return 0
  }

  return Math.abs(entry.localEndCells - entry.localStartCells)
}

function resolveBeltFlowChains(entries: readonly BeltVisualPathEntry[]): BeltFlowChain[] {
  const entryByEntityId = new Map(
    entries.map((entry) => [entry.entity.id, entry]),
  )
  const entriesByInputConnectionKey = new Map<string, BeltVisualPathEntry[]>()
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

  const sortedEntries = [...entries].sort(compareBeltFlowEntries)
  const visitedEntityIds = new Set<string>()
  const chains: BeltFlowChain[] = []

  for (const entry of sortedEntries) {
    const predecessorIds = predecessorIdsByEntityId.get(entry.entity.id)
    if (predecessorIds !== undefined && predecessorIds.size > 0) {
      continue
    }

    chains.push(resolveBeltFlowChainFrom({
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

    chains.push(resolveBeltFlowChainFrom({
      startEntry: entry,
      entryByEntityId,
      nextEntityIdByEntityId,
      visitedEntityIds,
    }))
  }

  return chains.filter((chain) => chain.entries.length > 0)
}

function resolveBeltFlowChainFrom(options: {
  startEntry: BeltVisualPathEntry;
  entryByEntityId: ReadonlyMap<string, BeltVisualPathEntry>;
  nextEntityIdByEntityId: ReadonlyMap<string, string>;
  visitedEntityIds: Set<string>;
}): BeltFlowChain {
  const rawEntries: BeltVisualPathEntry[] = []
  let currentEntry: BeltVisualPathEntry | undefined = options.startEntry

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

function compareBeltFlowEntries(
  left: BeltVisualPathEntry,
  right: BeltVisualPathEntry,
): number {
  const phaseDelta = left.phaseOffsetCells - right.phaseOffsetCells

  return phaseDelta === 0
    ? left.entity.id.localeCompare(right.entity.id)
    : phaseDelta
}

export function resolveRepeatingLocalDistances(options: {
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

function resolveBeltFlowMarkAtChainDistance(options: {
  ctx: DecorationSyncContext;
  chain: BeltFlowChain;
  distanceCells: number;
}): BeltFlowMark | null {
  const target = resolveBeltFlowChainDistanceTarget(options.chain, options.distanceCells)
  if (target === null) {
    return null
  }

  return resolveBeltFlowMark({
    kind: "arrow",
    ctx: options.ctx,
    entry: target.entry,
    distanceCells: target.distanceCells,
    lengthCells: 0,
    overflowCells: target.overflowCells,
  })
}

function resolveBeltFlowChainDistanceTarget(
  chain: BeltFlowChain,
  distanceCells: number,
): {
  readonly entry: BeltVisualPathEntry;
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

export function resolveRepeatingLocalIntervals(options: {
  readonly phaseOffsetCells: number;
  readonly pathLengthCells: number;
  readonly spacingCells: number;
  readonly lengthCells: number;
  readonly speedCellsPerSecond: number;
  readonly nowMs: number;
}): Array<{
  readonly startCells: number;
  readonly endCells: number;
}> {
  if (
    options.pathLengthCells <= 0
    || options.spacingCells <= 0
    || options.lengthCells <= 0
    || !Number.isFinite(options.pathLengthCells)
    || !Number.isFinite(options.spacingCells)
    || !Number.isFinite(options.lengthCells)
    || !Number.isFinite(options.speedCellsPerSecond)
  ) {
    return []
  }

  const traveledCells = positiveModulo(
    options.nowMs / 1000 * options.speedCellsPerSecond,
    options.spacingCells,
  )
  const halfLengthCells = options.lengthCells / 2
  const firstRepeatIndex = Math.ceil(
    (options.phaseOffsetCells - halfLengthCells - traveledCells) / options.spacingCells,
  )
  const intervals: Array<{
    readonly startCells: number;
    readonly endCells: number;
  }> = []

  for (
    let repeatIndex = firstRepeatIndex;
    repeatIndex < firstRepeatIndex + Math.ceil(
      (options.pathLengthCells + options.lengthCells) / options.spacingCells,
    ) + 2;
    repeatIndex += 1
  ) {
    const centerCells = repeatIndex * options.spacingCells
      + traveledCells
      - options.phaseOffsetCells
    const startCells = Math.max(0, centerCells - halfLengthCells)
    const endCells = Math.min(options.pathLengthCells, centerCells + halfLengthCells)

    if (endCells - startCells <= DISTANCE_EPSILON) {
      continue
    }

    intervals.push({
      startCells,
      endCells,
    })
  }

  return intervals
}

function resolveBeltFlowMark(options: {
  kind: BeltFlowMarkKind;
  ctx: DecorationSyncContext;
  entry: ReturnType<typeof resolveBeltVisualPathEntries>[number];
  distanceCells: number;
  lengthCells: number;
  overflowCells?: number;
}): BeltFlowMark | null {
  const sample = resolveBeltPathSampleAtDistance({
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
        + Math.cos(sample.angleRadians) * (options.overflowCells ?? 0),
      y:
        options.entry.entity.position.y
        + sample.point.y
        + Math.sin(sample.angleRadians) * (options.overflowCells ?? 0),
    },
    viewportBounds: options.ctx.viewportBounds,
    viewportState: options.ctx.viewportState,
  })

  return {
    kind: options.kind,
    centerX: center.x,
    centerY: center.y,
    angleRadians: sample.angleRadians
      + resolveDisplayRotationRadians(options.ctx.viewportState.displayRotation),
    lengthCells: options.lengthCells,
    tint: resolveBeltFlowTintColor(options.ctx, options.entry),
  }
}

function resolveHighlightMarksForInterval(options: {
  ctx: DecorationSyncContext;
  chain: BeltFlowChain;
  interval: {
    readonly startCells: number;
    readonly endCells: number;
  };
}): BeltFlowMark[] {
  const marks: BeltFlowMark[] = []
  let activeSegments: Array<{
    readonly entry: BeltVisualPathEntry;
    readonly startCells: number;
    readonly endCells: number;
  }> = []
  let activeTint: number | null = null

  const flushActiveSegments = (): void => {
    if (activeSegments.length === 0 || activeTint === null) {
      return
    }

    const points = resolveHighlightPathPoints(options.ctx, activeSegments)
    if (points.length >= 2) {
      const center = resolvePathCenterPoint(points)
      const lengthCells = activeSegments.reduce(
        (sum, segment) => sum + segment.endCells - segment.startCells,
        0,
      )

      marks.push({
        kind: "highlight",
        centerX: center.x,
        centerY: center.y,
        angleRadians: 0,
        lengthCells,
        tint: activeTint,
        points,
      })
    }

    activeSegments = []
    activeTint = null
  }

  for (const chainEntry of options.chain.entries) {
    if (chainEntry.entry.entity.definitionId !== "belt_straight_1x1") {
      flushActiveSegments()
      continue
    }

    const startCells = Math.max(
      options.interval.startCells,
      chainEntry.startDistanceCells,
    )
    const endCells = Math.min(
      options.interval.endCells,
      chainEntry.endDistanceCells,
    )
    if (endCells - startCells <= DISTANCE_EPSILON) {
      continue
    }

    const tint = resolveBeltFlowTintColor(options.ctx, chainEntry.entry)
    if (activeTint !== null && activeTint !== tint) {
      flushActiveSegments()
    }

    activeTint = tint
    activeSegments.push({
      entry: chainEntry.entry,
      startCells: startCells - chainEntry.startDistanceCells,
      endCells: endCells - chainEntry.startDistanceCells,
    })
  }

  flushActiveSegments()

  return marks
}

function resolvePathCenterPoint(points: readonly BeltFlowPoint[]): BeltFlowPoint {
  if (points.length === 0) {
    return { x: 0, y: 0 }
  }

  let totalLength = 0
  for (let index = 1; index < points.length; index += 1) {
    const previousPoint = points[index - 1]
    const point = points[index]
    if (previousPoint === undefined || point === undefined) {
      continue
    }

    totalLength += Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y)
  }

  if (totalLength <= DISTANCE_EPSILON) {
    return points[0] ?? { x: 0, y: 0 }
  }

  const targetLength = totalLength / 2
  let visitedLength = 0
  for (let index = 1; index < points.length; index += 1) {
    const previousPoint = points[index - 1]
    const point = points[index]
    if (previousPoint === undefined || point === undefined) {
      continue
    }

    const segmentLength = Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y)
    if (visitedLength + segmentLength < targetLength) {
      visitedLength += segmentLength
      continue
    }

    const segmentProgress = segmentLength <= DISTANCE_EPSILON
      ? 0
      : (targetLength - visitedLength) / segmentLength

    return {
      x: previousPoint.x + (point.x - previousPoint.x) * segmentProgress,
      y: previousPoint.y + (point.y - previousPoint.y) * segmentProgress,
    }
  }

  return points.at(-1) ?? points[0] ?? { x: 0, y: 0 }
}

function resolveHighlightPathPoints(
  ctx: DecorationSyncContext,
  segments: ReadonlyArray<{
    readonly entry: BeltVisualPathEntry;
    readonly startCells: number;
    readonly endCells: number;
  }>,
): BeltFlowPoint[] {
  const points: BeltFlowPoint[] = []

  for (const segment of segments) {
    for (const distanceCells of resolveHighlightSampleDistances(segment)) {
      const sample = resolveBeltPathSampleAtDistance({
        entity: segment.entry.entity,
        definition: segment.entry.definition,
        distanceCells,
      })
      if (sample === null) {
        continue
      }

      const point = resolveViewportPoint({
        point: {
          x: segment.entry.entity.position.x + sample.point.x,
          y: segment.entry.entity.position.y + sample.point.y,
        },
        viewportBounds: ctx.viewportBounds,
        viewportState: ctx.viewportState,
      })

      const previousPoint = points.at(-1)
      if (
        previousPoint !== undefined
        && Math.abs(previousPoint.x - point.x) <= DISTANCE_EPSILON
        && Math.abs(previousPoint.y - point.y) <= DISTANCE_EPSILON
      ) {
        continue
      }

      points.push(point)
    }
  }

  return points
}

function resolveHighlightSampleDistances(segment: {
  readonly entry: BeltVisualPathEntry;
  readonly startCells: number;
  readonly endCells: number;
}): number[] {
  if (segment.endCells - segment.startCells <= DISTANCE_EPSILON) {
    return []
  }

  if (segment.entry.entity.definitionId === "belt_straight_1x1") {
    return [segment.startCells, segment.endCells]
  }

  const sampleCount = Math.max(
    1,
    Math.ceil(
      (segment.endCells - segment.startCells)
      / segment.entry.lengthCells
      * HIGHLIGHT_TURN_SAMPLE_COUNT,
    ),
  )
  const distances: number[] = []

  for (let index = 0; index <= sampleCount; index += 1) {
    distances.push(
      segment.startCells
      + (segment.endCells - segment.startCells) * index / sampleCount,
    )
  }

  return distances
}

function syncHighlightMeshes(options: {
  marks: readonly BeltFlowMark[];
  texture: Texture | null;
  gridCellSize: number;
  ensureHighlightMesh: (index: number) => Mesh<RopeGeometry>;
  highlightMeshes: readonly Mesh<RopeGeometry>[];
}): void {
  let visibleCount = 0

  for (const mark of options.marks) {
    if (mark.kind !== "highlight" || options.texture === null || mark.points === undefined) {
      continue
    }

    const mesh = options.ensureHighlightMesh(visibleCount)
    const previousGeometry = mesh.geometry
    mesh.visible = true
    mesh.texture = options.texture
    mesh.geometry = new RopeGeometry({
      points: [...mark.points],
      width: options.gridCellSize * HIGHLIGHT_WIDTH_CELLS,
      textureScale: HIGHLIGHT_LENGTH_CELLS / HIGHLIGHT_WIDTH_CELLS,
    })
    previousGeometry.destroy()
    mesh.tint = mark.tint
    mesh.alpha = HIGHLIGHT_ALPHA
    visibleCount += 1
  }

  for (let index = visibleCount; index < options.highlightMeshes.length; index += 1) {
    const mesh = options.highlightMeshes[index]
    if (mesh !== undefined) {
      mesh.visible = false
    }
  }
}

function drawBeltFlowMarks(options: {
  graphics: Graphics;
  marks: readonly BeltFlowMark[];
  gridCellSize: number;
}): void {
  const arrowLength = options.gridCellSize * ARROW_LENGTH_RATIO
  const arrowWidth = options.gridCellSize * ARROW_WIDTH_RATIO

  options.graphics.clear()

  for (const mark of options.marks) {
    if (mark.kind !== "arrow") {
      continue
    }

    options.graphics
      .poly(resolveRotatedArrowPoints(mark, arrowLength, arrowWidth), true)
      .fill({ color: mark.tint, alpha: 1 })
  }
}

function resolveBeltFlowTintColor(
  ctx: DecorationSyncContext,
  entry: ReturnType<typeof resolveBeltVisualPathEntries>[number],
): number {
  return resolveDedicatedLogisticTintColor({
    entityId: entry.entity.id,
    spriteId: entry.definition.spriteId,
    theme: ctx.theme,
    workspace: ctx.renderHost.workspace,
  })
}

function resolveRotatedArrowPoints(
  mark: Pick<BeltFlowMark, "centerX" | "centerY" | "angleRadians">,
  length: number,
  width: number,
): number[] {
  const halfLength = length / 2
  const halfWidth = width / 2
  const tailNotchX = -halfLength + length * ARROW_TAIL_NOTCH_LENGTH_RATIO

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

function resolveRotatedExtensionMaskPoints(options: {
  centerX: number;
  centerY: number;
  angleRadians: number;
  startX: number;
  endX: number;
  halfWidth: number;
}): number[] {
  return rotateLocalPoints({
    centerX: options.centerX,
    centerY: options.centerY,
    angleRadians: options.angleRadians,
    localPoints: [
      { x: options.startX, y: -options.halfWidth },
      { x: options.endX, y: -options.halfWidth },
      { x: options.endX, y: options.halfWidth },
      { x: options.startX, y: options.halfWidth },
    ],
  })
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

function positiveModulo(value: number, modulo: number): number {
  const result = value % modulo

  return result < 0 ? result + modulo : result
}
