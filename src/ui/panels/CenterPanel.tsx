import type { MouseEventHandler, ReactNode, RefObject, WheelEventHandler } from 'react'

type CenterPanelProps = {
  viewportRef: RefObject<HTMLDivElement | null>
  gridRef: RefObject<HTMLDivElement | null>
  mode: string
  isPanning: boolean
  canvasWidthPx: number
  canvasHeightPx: number
  baseCellSize: number
  viewOffset: { x: number; y: number }
  zoomScale: number
  onMouseDown: MouseEventHandler<HTMLDivElement>
  onMouseMove: MouseEventHandler<HTMLDivElement>
  onMouseUp: MouseEventHandler<HTMLDivElement>
  onWheel: WheelEventHandler<HTMLDivElement>
  worldContent: ReactNode
}

export function CenterPanel({
  viewportRef,
  gridRef,
  mode,
  isPanning,
  canvasWidthPx,
  canvasHeightPx,
  baseCellSize,
  viewOffset,
  zoomScale,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onWheel,
  worldContent,
}: CenterPanelProps) {
  return (
    <section className="canvas-panel panel">
      <div
        ref={viewportRef}
        className={`canvas-viewport${isPanning ? ' panning' : ''}`}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        onContextMenu={(event) => event.preventDefault()}
        onAuxClick={(event) => event.preventDefault()}
      >
        <div
          ref={gridRef}
          className={`grid-canvas mode-${mode}`}
          style={{
            width: canvasWidthPx,
            height: canvasHeightPx,
            backgroundSize: `${baseCellSize}px ${baseCellSize}px`,
            transformOrigin: 'top left',
            transform: `translate(${viewOffset.x}px, ${viewOffset.y}px) scale(${zoomScale})`,
          }}
        >
          {worldContent}
        </div>
      </div>
    </section>
  )
}
