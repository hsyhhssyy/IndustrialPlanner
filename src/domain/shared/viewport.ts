import { clamp } from './math'

const MIN_VISIBLE_VIEWPORT_RATIO = 1 / 3

export function getZoomStep(cellSize: number) {
  if (cellSize < 48) return 1
  if (cellSize < 120) return 3
  if (cellSize < 200) return 8
  if (cellSize < 260) return 16
  return 30
}

export function getMaxCellSizeForViewport(viewport: HTMLDivElement | null) {
  if (!viewport) return 300
  return Math.max(12, Math.ceil(Math.max(viewport.clientWidth, viewport.clientHeight) / 12))
}

function getMinimumVisibleSpan(viewportSpan: number, canvasSpan: number) {
  return Math.min(canvasSpan, viewportSpan * MIN_VISIBLE_VIEWPORT_RATIO)
}

export function clampViewportOffset(
  offset: { x: number; y: number },
  viewportSize: { width: number; height: number },
  canvasSize: { width: number; height: number },
) {
  const minVisibleWidth = getMinimumVisibleSpan(viewportSize.width, canvasSize.width)
  const minVisibleHeight = getMinimumVisibleSpan(viewportSize.height, canvasSize.height)
  const x = clamp(offset.x, minVisibleWidth - canvasSize.width, viewportSize.width - minVisibleWidth)
  const y = clamp(offset.y, minVisibleHeight - canvasSize.height, viewportSize.height - minVisibleHeight)
  return { x: Math.round(x), y: Math.round(y) }
}