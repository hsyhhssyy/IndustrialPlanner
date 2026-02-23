import { clamp } from './math'

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

export function clampViewportOffset(
  offset: { x: number; y: number },
  viewportSize: { width: number; height: number },
  canvasSize: { width: number; height: number },
) {
  const x =
    canvasSize.width <= viewportSize.width
      ? (viewportSize.width - canvasSize.width) / 2
      : clamp(offset.x, viewportSize.width - canvasSize.width, 0)
  const y =
    canvasSize.height <= viewportSize.height
      ? (viewportSize.height - canvasSize.height) / 2
      : clamp(offset.y, viewportSize.height - canvasSize.height, 0)
  return { x: Math.round(x), y: Math.round(y) }
}