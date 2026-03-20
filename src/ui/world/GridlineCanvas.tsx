import { useEffect, useRef } from 'react'

type GridlineCanvasProps = {
  width: number
  height: number
  cellSize: number
  zoomScale: number
  originCellX: number
  originCellY: number
  themeKey: string
}

const MAJOR_GRID_INTERVAL = 5

function isMajorLine(index: number, originCell: number) {
  const relativeIndex = index - originCell
  return relativeIndex % MAJOR_GRID_INTERVAL === 0
}

export function GridlineCanvas({ width, height, cellSize, zoomScale, originCellX, originCellY, themeKey }: GridlineCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0 || height <= 0 || cellSize <= 0 || zoomScale <= 0) return

    const context = canvas.getContext('2d')
    if (!context) return

    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, width, height)

    const styles = getComputedStyle(canvas)
    const minorStroke = styles.getPropertyValue('--canvas-grid-line-minor').trim() || 'rgba(255, 255, 255, 0.2)'
    const majorStroke = styles.getPropertyValue('--canvas-grid-line-major').trim() || 'rgba(255, 255, 255, 0.4)'
    const minorLineWidth = 1 / zoomScale
    const majorLineWidth = 2 / zoomScale
    const columnCount = Math.round(width / cellSize)
    const rowCount = Math.round(height / cellSize)

    context.lineCap = 'butt'

    const drawLines = (axis: 'vertical' | 'horizontal', major: boolean) => {
      context.beginPath()
      context.strokeStyle = major ? majorStroke : minorStroke
      context.lineWidth = major ? majorLineWidth : minorLineWidth

      const maxIndex = axis === 'vertical' ? columnCount : rowCount
      const originCell = axis === 'vertical' ? originCellX : originCellY
      const lineWidth = major ? majorLineWidth : minorLineWidth

      for (let index = 0; index <= maxIndex; index += 1) {
        const shouldUseMajor = isMajorLine(index, originCell)
        if (shouldUseMajor !== major) continue

        const position = index * cellSize + lineWidth / 2
        if (axis === 'vertical') {
          context.moveTo(position, 0)
          context.lineTo(position, height)
          continue
        }

        context.moveTo(0, position)
        context.lineTo(width, position)
      }

      context.stroke()
    }

    drawLines('vertical', false)
    drawLines('horizontal', false)
    drawLines('vertical', true)
    drawLines('horizontal', true)
  }, [cellSize, height, originCellX, originCellY, themeKey, width, zoomScale])

  return <canvas ref={canvasRef} className="gridline-canvas" aria-hidden="true" />
}