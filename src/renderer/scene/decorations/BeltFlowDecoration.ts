import {
  Container,
  Graphics,
  Sprite,
  Texture,
} from "pixi.js"

import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color"

import type { DecorationLayer } from "./DecorationLayer"
import type { DecorationSyncContext } from "./DecorationSyncContext"
import {
  resolveBeltPathSampleAtDistance,
  resolveBeltVisualPathEntries,
  resolveViewportPoint,
} from "./BeltVisualGeometry"

const BELT_VISUAL_SPEED_CELLS_PER_SECOND = 0.5
const HIGHLIGHT_TEXTURE_KEY = "texture-belt-highlight-strip-texture"
const HIGHLIGHT_SPEED_MULTIPLIER = 2
const HIGHLIGHT_SPACING_CELLS = 2
const HIGHLIGHT_LENGTH_CELLS = 0.56
const HIGHLIGHT_WIDTH_CELLS = 0.78
const HIGHLIGHT_ALPHA = 0.82
const HIGHLIGHT_TURN_SEGMENT_COUNT = 4
const ARROW_SPACING_CELLS = 1
const ARROW_LENGTH_RATIO = 0.28
const ARROW_WIDTH_RATIO = 0.24
const DISTANCE_EPSILON = 0.000001

type BeltFlowMarkKind = "highlight" | "arrow"

interface BeltFlowMark {
  readonly kind: BeltFlowMarkKind;
  readonly centerX: number;
  readonly centerY: number;
  readonly angleRadians: number;
  readonly lengthCells: number;
}

interface BeltFlowPalette {
  readonly beltColor: number;
}

export function createBeltFlowDecoration(): DecorationLayer {
  const container = new Container()
  const highlightLayer = new Container()
  const arrowGraphics = new Graphics({ roundPixels: true })
  const highlightSprites: Sprite[] = []
  let destroyed = false
  let highlightTexture: Texture | null = null
  let highlightTextureLoadStarted = false

  container.addChild(highlightLayer)
  container.addChild(arrowGraphics)

  const ensureHighlightTexture = (ctx: DecorationSyncContext): void => {
    if (highlightTextureLoadStarted || highlightTexture !== null) {
      return
    }

    const textureManager = ctx.workspace.render?.textureManager
    if (textureManager === undefined) {
      return
    }

    highlightTextureLoadStarted = true
    void textureManager.getTexture(HIGHLIGHT_TEXTURE_KEY).then((texture) => {
      if (destroyed) {
        return
      }

      highlightTexture = texture
    })
  }

  const ensureHighlightSprite = (index: number): Sprite => {
    let sprite = highlightSprites[index]
    if (sprite !== undefined) {
      return sprite
    }

    sprite = new Sprite(Texture.EMPTY)
    sprite.anchor.set(0.5)
    sprite.roundPixels = true
    highlightLayer.addChild(sprite)
    highlightSprites.push(sprite)
    return sprite
  }

  return {
    container,

    sync(ctx: DecorationSyncContext): void {
      if (ctx.workspace.app?.state?.settings?.gameUseSimplifiedDeviceIcons === true) {
        hide()
        return
      }

      ensureHighlightTexture(ctx)
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

      container.visible = true
      highlightLayer.visible = true
      arrowGraphics.visible = true
      const palette = resolveBeltFlowPalette(ctx)
      syncHighlightSprites({
        marks,
        texture: highlightTexture,
        gridCellSize: ctx.viewportState.gridCellPixelSize,
        palette,
        ensureHighlightSprite,
        highlightSprites,
      })
      drawBeltFlowMarks({
        graphics: arrowGraphics,
        marks,
        gridCellSize: ctx.viewportState.gridCellPixelSize,
        palette,
      })
    },

    destroy(): void {
      destroyed = true
      for (const sprite of highlightSprites) {
        sprite.destroy()
      }

      highlightSprites.length = 0
      arrowGraphics.destroy()
      highlightLayer.destroy({ children: true })
      container.destroy({ children: true })
    },
  }

  function hide(): void {
    container.visible = false
    highlightLayer.visible = false
    arrowGraphics.visible = false
    arrowGraphics.clear()

    for (const sprite of highlightSprites) {
      sprite.visible = false
    }
  }
}

export function resolveBeltFlowMarks(ctx: DecorationSyncContext): BeltFlowMark[] {
  const entries = resolveBeltVisualPathEntries(ctx)
  const marks: BeltFlowMark[] = []

  for (const entry of entries) {
    const highlightDistances = resolveRepeatingLocalDistances({
      phaseOffsetCells: entry.phaseOffsetCells,
      pathLengthCells: entry.lengthCells,
      spacingCells: HIGHLIGHT_SPACING_CELLS,
      speedCellsPerSecond: BELT_VISUAL_SPEED_CELLS_PER_SECOND * HIGHLIGHT_SPEED_MULTIPLIER,
      nowMs: ctx.nowMs,
    })
    const arrowDistances = resolveRepeatingLocalDistances({
      phaseOffsetCells: entry.phaseOffsetCells,
      pathLengthCells: entry.lengthCells,
      spacingCells: ARROW_SPACING_CELLS,
      speedCellsPerSecond: BELT_VISUAL_SPEED_CELLS_PER_SECOND,
      nowMs: ctx.nowMs,
    })

    for (const distanceCells of highlightDistances) {
      for (const segment of resolveHighlightSegmentDistances(entry, distanceCells)) {
        const mark = resolveBeltFlowMark({
          kind: "highlight",
          ctx,
          entry,
          distanceCells: segment.distanceCells,
          lengthCells: segment.lengthCells,
        })
        if (mark !== null) {
          marks.push(mark)
        }
      }
    }

    for (const distanceCells of arrowDistances) {
      const mark = resolveBeltFlowMark({
        kind: "arrow",
        ctx,
        entry,
        distanceCells,
        lengthCells: 0,
      })
      if (mark !== null) {
        marks.push(mark)
      }
    }
  }

  return marks
}

export function resolveRepeatingLocalDistances(options: {
  readonly phaseOffsetCells: number;
  readonly pathLengthCells: number;
  readonly spacingCells: number;
  readonly speedCellsPerSecond: number;
  readonly nowMs: number;
}): number[] {
  if (
    options.pathLengthCells <= 0
    || options.spacingCells <= 0
    || !Number.isFinite(options.pathLengthCells)
    || !Number.isFinite(options.spacingCells)
    || !Number.isFinite(options.speedCellsPerSecond)
  ) {
    return []
  }

  const traveledCells = positiveModulo(
    options.nowMs / 1000 * options.speedCellsPerSecond,
    options.spacingCells,
  )
  const firstRepeatIndex = Math.ceil(
    (options.phaseOffsetCells - traveledCells) / options.spacingCells,
  )
  const distances: number[] = []

  for (
    let repeatIndex = firstRepeatIndex;
    repeatIndex < firstRepeatIndex + Math.ceil(options.pathLengthCells / options.spacingCells) + 2;
    repeatIndex += 1
  ) {
    const distanceCells = repeatIndex * options.spacingCells
      + traveledCells
      - options.phaseOffsetCells

    if (distanceCells < -DISTANCE_EPSILON) {
      continue
    }

    if (distanceCells >= options.pathLengthCells - DISTANCE_EPSILON) {
      continue
    }

    distances.push(Math.max(0, distanceCells))
  }

  return distances
}

function resolveBeltFlowMark(options: {
  kind: BeltFlowMarkKind;
  ctx: DecorationSyncContext;
  entry: ReturnType<typeof resolveBeltVisualPathEntries>[number];
  distanceCells: number;
  lengthCells: number;
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
      x: options.entry.entity.position.x + sample.point.x,
      y: options.entry.entity.position.y + sample.point.y,
    },
    viewportBounds: options.ctx.viewportBounds,
    viewportState: options.ctx.viewportState,
  })

  return {
    kind: options.kind,
    centerX: center.x,
    centerY: center.y,
    angleRadians: sample.angleRadians,
    lengthCells: options.lengthCells,
  }
}

function resolveHighlightSegmentDistances(
  entry: ReturnType<typeof resolveBeltVisualPathEntries>[number],
  centerDistanceCells: number,
): Array<{
  readonly distanceCells: number;
  readonly lengthCells: number;
}> {
  if (entry.entity.definitionId === "belt_straight_1x1") {
    return [{
      distanceCells: centerDistanceCells,
      lengthCells: HIGHLIGHT_LENGTH_CELLS,
    }]
  }

  const segmentLengthCells = HIGHLIGHT_LENGTH_CELLS / HIGHLIGHT_TURN_SEGMENT_COUNT
  const segmentStartCells = centerDistanceCells - HIGHLIGHT_LENGTH_CELLS / 2
  const segments: Array<{
    readonly distanceCells: number;
    readonly lengthCells: number;
  }> = []

  for (let index = 0; index < HIGHLIGHT_TURN_SEGMENT_COUNT; index += 1) {
    const distanceCells = segmentStartCells + segmentLengthCells * (index + 0.5)
    if (distanceCells < 0 || distanceCells >= entry.lengthCells) {
      continue
    }

    segments.push({
      distanceCells,
      lengthCells: segmentLengthCells,
    })
  }

  return segments
}

function syncHighlightSprites(options: {
  marks: readonly BeltFlowMark[];
  texture: Texture | null;
  gridCellSize: number;
  palette: BeltFlowPalette;
  ensureHighlightSprite: (index: number) => Sprite;
  highlightSprites: readonly Sprite[];
}): void {
  let visibleCount = 0

  for (const mark of options.marks) {
    if (mark.kind !== "highlight" || options.texture === null) {
      continue
    }

    const sprite = options.ensureHighlightSprite(visibleCount)
    sprite.visible = true
    sprite.texture = options.texture
    sprite.x = mark.centerX
    sprite.y = mark.centerY
    sprite.rotation = mark.angleRadians
    sprite.width = options.gridCellSize * mark.lengthCells
    sprite.height = options.gridCellSize * HIGHLIGHT_WIDTH_CELLS
    sprite.tint = options.palette.beltColor
    sprite.alpha = HIGHLIGHT_ALPHA
    visibleCount += 1
  }

  for (let index = visibleCount; index < options.highlightSprites.length; index += 1) {
    const sprite = options.highlightSprites[index]
    if (sprite !== undefined) {
      sprite.visible = false
    }
  }
}

function drawBeltFlowMarks(options: {
  graphics: Graphics;
  marks: readonly BeltFlowMark[];
  gridCellSize: number;
  palette: BeltFlowPalette;
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
      .fill({ color: options.palette.beltColor, alpha: 1 })
  }
}

function resolveBeltFlowPalette(ctx: DecorationSyncContext): BeltFlowPalette {
  const theme = ctx.workspace.app?.state.theme
  if (theme === undefined) {
    return {
      beltColor: 0xf59e0b,
    }
  }

  return {
    beltColor: resolveAppThemeColorNumber(theme, theme.renderer.beltTileStrokeColorKey),
  }
}

function resolveRotatedArrowPoints(
  mark: Pick<BeltFlowMark, "centerX" | "centerY" | "angleRadians">,
  length: number,
  width: number,
): number[] {
  const halfLength = length / 2
  const halfWidth = width / 2

  return rotateLocalPoints({
    centerX: mark.centerX,
    centerY: mark.centerY,
    angleRadians: mark.angleRadians,
    localPoints: [
      { x: halfLength, y: 0 },
      { x: -halfLength, y: -halfWidth },
      { x: -halfLength, y: halfWidth },
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
