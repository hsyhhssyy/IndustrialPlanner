import { Container, Graphics } from "pixi.js"

import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color"

import type { DecorationLayer } from "./DecorationLayer"
import type { DecorationSyncContext } from "./DecorationSyncContext"
import {
  resolveBeltPathSampleAtDistance,
  resolveBeltVisualPathEntries,
  resolveViewportPoint,
} from "./BeltVisualGeometry"

const BELT_VISUAL_SPEED_CELLS_PER_SECOND = 0.5
const LIGHT_SPEED_MULTIPLIER = 2
const LIGHT_SPACING_CELLS = 2
const ARROW_SPACING_CELLS = 1
const LIGHT_LENGTH_RATIO = 0.34
const LIGHT_WIDTH_RATIO = 0.16
const ARROW_LENGTH_RATIO = 0.34
const ARROW_WIDTH_RATIO = 0.3
const DISTANCE_EPSILON = 0.000001

type BeltFlowMarkKind = "light" | "arrow"

interface BeltFlowMark {
  readonly kind: BeltFlowMarkKind;
  readonly centerX: number;
  readonly centerY: number;
  readonly angleRadians: number;
}

interface BeltFlowPalette {
  readonly lightColor: number;
  readonly arrowColor: number;
  readonly arrowStrokeColor: number;
}

export function createBeltFlowDecoration(): DecorationLayer {
  const container = new Container()
  const graphics = new Graphics({ roundPixels: true })
  container.addChild(graphics)

  return {
    container,

    sync(ctx: DecorationSyncContext): void {
      if (ctx.workspace.app?.state?.settings?.gameUseSimplifiedDeviceIcons === true) {
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

      container.visible = true
      graphics.visible = true
      drawBeltFlowMarks({
        graphics,
        marks,
        gridCellSize: ctx.viewportState.gridCellPixelSize,
        palette: resolveBeltFlowPalette(ctx),
      })
    },

    destroy(): void {
      graphics.destroy()
      container.destroy({ children: true })
    },
  }

  function hide(): void {
    container.visible = false
    graphics.visible = false
    graphics.clear()
  }
}

export function resolveBeltFlowMarks(ctx: DecorationSyncContext): BeltFlowMark[] {
  const entries = resolveBeltVisualPathEntries(ctx)
  const marks: BeltFlowMark[] = []

  for (const entry of entries) {
    const lightDistances = resolveRepeatingLocalDistances({
      phaseOffsetCells: entry.phaseOffsetCells,
      pathLengthCells: entry.lengthCells,
      spacingCells: LIGHT_SPACING_CELLS,
      speedCellsPerSecond: BELT_VISUAL_SPEED_CELLS_PER_SECOND * LIGHT_SPEED_MULTIPLIER,
      nowMs: ctx.nowMs,
    })
    const arrowDistances = resolveRepeatingLocalDistances({
      phaseOffsetCells: entry.phaseOffsetCells,
      pathLengthCells: entry.lengthCells,
      spacingCells: ARROW_SPACING_CELLS,
      speedCellsPerSecond: BELT_VISUAL_SPEED_CELLS_PER_SECOND,
      nowMs: ctx.nowMs,
    })

    for (const distanceCells of lightDistances) {
      const mark = resolveBeltFlowMark({
        kind: "light",
        ctx,
        entry,
        distanceCells,
      })
      if (mark !== null) {
        marks.push(mark)
      }
    }

    for (const distanceCells of arrowDistances) {
      const mark = resolveBeltFlowMark({
        kind: "arrow",
        ctx,
        entry,
        distanceCells,
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
  }
}

function drawBeltFlowMarks(options: {
  graphics: Graphics;
  marks: readonly BeltFlowMark[];
  gridCellSize: number;
  palette: BeltFlowPalette;
}): void {
  const lightLength = options.gridCellSize * LIGHT_LENGTH_RATIO
  const lightWidth = options.gridCellSize * LIGHT_WIDTH_RATIO
  const arrowLength = options.gridCellSize * ARROW_LENGTH_RATIO
  const arrowWidth = options.gridCellSize * ARROW_WIDTH_RATIO

  options.graphics.clear()

  for (const mark of options.marks) {
    if (mark.kind !== "light") {
      continue
    }

    options.graphics
      .poly(resolveRotatedRectanglePoints(mark, lightLength, lightWidth), true)
      .fill({ color: options.palette.lightColor, alpha: 0.72 })
  }

  for (const mark of options.marks) {
    if (mark.kind !== "arrow") {
      continue
    }

    options.graphics
      .poly(resolveRotatedArrowPoints(mark, arrowLength, arrowWidth), true)
      .fill({ color: options.palette.arrowColor, alpha: 0.9 })
      .stroke({
        width: Math.max(1, options.gridCellSize * 0.018),
        color: options.palette.arrowStrokeColor,
        alpha: 0.82,
        pixelLine: true,
      })
  }
}

function resolveBeltFlowPalette(ctx: DecorationSyncContext): BeltFlowPalette {
  const theme = ctx.workspace.app?.state.theme
  if (theme === undefined) {
    return {
      lightColor: 0xffffff,
      arrowColor: 0xffffff,
      arrowStrokeColor: 0x334155,
    }
  }

  return {
    lightColor: resolveAppThemeColorNumber(theme, theme.renderer.spritePreviewBorderBoxColorKey),
    arrowColor: resolveAppThemeColorNumber(theme, theme.renderer.portChevronColorKey),
    arrowStrokeColor: resolveAppThemeColorNumber(theme, theme.renderer.flowGlowStrokeColorKey),
  }
}

function resolveRotatedRectanglePoints(
  mark: Pick<BeltFlowMark, "centerX" | "centerY" | "angleRadians">,
  length: number,
  width: number,
): number[] {
  return rotateLocalPoints({
    centerX: mark.centerX,
    centerY: mark.centerY,
    angleRadians: mark.angleRadians,
    localPoints: [
      { x: -length / 2, y: -width / 2 },
      { x: length / 2, y: -width / 2 },
      { x: length / 2, y: width / 2 },
      { x: -length / 2, y: width / 2 },
    ],
  })
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
      { x: -length * 0.08, y: -halfWidth },
      { x: -length * 0.08, y: -width * 0.18 },
      { x: -halfLength, y: -width * 0.18 },
      { x: -halfLength, y: width * 0.18 },
      { x: -length * 0.08, y: width * 0.18 },
      { x: -length * 0.08, y: halfWidth },
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
