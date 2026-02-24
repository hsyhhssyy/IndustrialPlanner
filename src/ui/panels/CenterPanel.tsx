import type { ReactNode, RefObject } from 'react'
import { useEffect } from 'react'
import { useAppContext } from '../../app/AppContext'
import { useBuildInteractionDomain } from '../../features/build/useBuildInteractionDomain'
import type { BuildInteractionParams } from '../../features/build/buildInteraction.contract'

type CenterPanelProps = {
  viewportRef: RefObject<HTMLDivElement | null>
  gridRef: RefObject<HTMLDivElement | null>
  interactionParams: BuildInteractionParams
  mode: string
  canvasWidthPx: number
  canvasHeightPx: number
  baseCellSize: number
  viewOffset: { x: number; y: number }
  zoomScale: number
  worldContent: ReactNode
}

export function CenterPanel({
  viewportRef,
  gridRef,
  interactionParams,
  mode,
  canvasWidthPx,
  canvasHeightPx,
  baseCellSize,
  viewOffset,
  zoomScale,
  worldContent,
}: CenterPanelProps) {
  const { eventBus } = useAppContext()
  const { isPanning, onCanvasMouseDown, onCanvasMouseMove, onCanvasMouseUp, onCanvasWheel } = useBuildInteractionDomain(interactionParams)

  useEffect(() => {
    const unsubscribeFocus = eventBus.on('ui.center.focus', () => {
      viewportRef.current?.focus()
    })

    return () => {
      unsubscribeFocus()
    }
  }, [eventBus, viewportRef])

  return (
    <section className="canvas-panel panel">
      <div
        ref={viewportRef}
        tabIndex={-1}
        className={`canvas-viewport${isPanning ? ' panning' : ''}`}
        onMouseDown={onCanvasMouseDown}
        onMouseMove={onCanvasMouseMove}
        onMouseUp={onCanvasMouseUp}
        onMouseLeave={onCanvasMouseUp}
        onWheel={onCanvasWheel}
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
