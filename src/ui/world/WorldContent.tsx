import type { ReactNode } from 'react'
type PowerRangeOutline = {
  key: string
  left: number
  top: number
  width: number
  height: number
  isPreview?: boolean
}

type PowerRangeCell = {
  key: string
  left: number
  top: number
  width: number
  height: number
  isPreview?: boolean
}

type RuntimeStallOverlay = {
  key: string
  left: number
  top: number
  width: number
  height: number
  isBelt: boolean
}

type PortChevron = {
  key: string
  x: number
  y: number
  angle: number
  width: number
  height: number
}

type PlacePreviewChevron = {
  key: string
  x: number
  y: number
  angle: number
  width: number
  height: number
}

type LogisticsEndpointHighlight = {
  key: string
  x: number
  y: number
  kind: 'start' | 'end'
}

type PlacePreview = {
  origin: { x: number; y: number }
  footprintSize: { width: number; height: number }
  rotation: number
  textureSrc: string | null
  textureWidthPx: number
  textureHeightPx: number
  chevrons: PlacePreviewChevron[]
  isValid: boolean
}

type DragRect = { x1: number; y1: number; x2: number; y2: number }

type WorldContentProps = {
  baseCellSize: number
  canvasOffsetXPx: number
  canvasOffsetYPx: number
  lotSize: number
  powerRangeOutlines: PowerRangeOutline[]
  powerRangeCells: PowerRangeCell[]
  underlayLayer: ReactNode
  transitLayer: ReactNode
  overlayLayer: ReactNode
  adornmentLayer: ReactNode
  runtimeStallOverlays: RuntimeStallOverlay[]
  logisticsEndpointHighlights: LogisticsEndpointHighlight[]
  portChevrons: PortChevron[]
  placePreview: PlacePreview | null
  dragRect: DragRect | null
}

export function WorldContent({
  baseCellSize,
  canvasOffsetXPx,
  canvasOffsetYPx,
  lotSize,
  powerRangeOutlines,
  powerRangeCells,
  underlayLayer,
  transitLayer,
  overlayLayer,
  adornmentLayer,
  runtimeStallOverlays,
  logisticsEndpointHighlights,
  portChevrons,
  placePreview,
  dragRect,
}: WorldContentProps) {
  return (
    <div
      className="world-layer"
      style={{
        left: canvasOffsetXPx,
        top: canvasOffsetYPx,
        width: lotSize * baseCellSize,
        height: lotSize * baseCellSize,
      }}
    >
      <div className="lot-border" />

      {powerRangeCells.map((cell) => (
        <div
          key={cell.key}
          className={`power-range-cell ${cell.isPreview ? 'preview' : ''}`.trim()}
          style={{
            left: cell.left,
            top: cell.top,
            width: cell.width,
            height: cell.height,
          }}
        />
      ))}

      {powerRangeOutlines.map((outline) => (
        <div
          key={outline.key}
          className={`power-range-outline ${outline.isPreview ? 'preview' : ''}`.trim()}
          style={{
            left: outline.left,
            top: outline.top,
            width: outline.width,
            height: outline.height,
          }}
        />
      ))}

      <div className="world-pass-layer world-pass-underlay">{underlayLayer}</div>
      <div className="world-pass-layer world-pass-transit">{transitLayer}</div>
      <div className="world-pass-layer world-pass-overlay">{overlayLayer}</div>
      <div className="world-pass-layer world-pass-adornment">{adornmentLayer}</div>

      {logisticsEndpointHighlights.map((highlight) => (
        <div
          key={highlight.key}
          className={`logistics-endpoint-highlight ${highlight.kind}`}
          style={{
            left: highlight.x * baseCellSize,
            top: highlight.y * baseCellSize,
            width: baseCellSize,
            height: baseCellSize,
          }}
        />
      ))}

      {runtimeStallOverlays.map((overlay) => (
        <div
          key={overlay.key}
          className={`device-runtime-overlay ${overlay.isBelt ? 'is-belt' : 'is-device'}`}
          style={{
            left: overlay.left,
            top: overlay.top,
            width: overlay.width,
            height: overlay.height,
          }}
        />
      ))}

      {portChevrons.map((chevron) => (
        <div
          key={chevron.key}
          className="port-chevron"
          style={{
            left: chevron.x,
            top: chevron.y,
            width: chevron.width,
            height: chevron.height,
            transform: `translate(-50%, -50%) rotate(${chevron.angle}deg)`,
          }}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline className="port-chevron-outline" points="0,12 100,50 0,88" />
            <polyline className="port-chevron-inner" points="0,22 84,50 0,78" />
          </svg>
        </div>
      ))}

      {placePreview && (
        <div
          className={`place-ghost ${placePreview.isValid ? 'valid' : 'invalid'}`}
          style={{
            left: placePreview.origin.x * baseCellSize,
            top: placePreview.origin.y * baseCellSize,
            width: placePreview.footprintSize.width * baseCellSize,
            height: placePreview.footprintSize.height * baseCellSize,
          }}
        >
          <div className="place-ghost-surface">
            {placePreview.textureSrc && (
              <img
                className="place-ghost-texture"
                src={placePreview.textureSrc}
                alt=""
                aria-hidden="true"
                draggable={false}
                style={{
                  width: `${placePreview.textureWidthPx}px`,
                  height: `${placePreview.textureHeightPx}px`,
                  transform: `translate(-50%, -50%) rotate(${placePreview.rotation}deg)`,
                }}
              />
            )}
          </div>
          {placePreview.chevrons.map((chevron) => (
            <div
              key={chevron.key}
              className="port-chevron place-ghost-chevron"
              style={{
                left: chevron.x,
                top: chevron.y,
                width: chevron.width,
                height: chevron.height,
                transform: `translate(-50%, -50%) rotate(${chevron.angle}deg)`,
              }}
            >
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <polyline className="port-chevron-outline" points="0,12 100,50 0,88" />
                <polyline className="port-chevron-inner" points="0,22 84,50 0,78" />
              </svg>
            </div>
          ))}
        </div>
      )}

      {dragRect && (
        <div
          className="selection-rect"
          style={{
            left: Math.min(dragRect.x1, dragRect.x2) * baseCellSize,
            top: Math.min(dragRect.y1, dragRect.y2) * baseCellSize,
            width: (Math.abs(dragRect.x2 - dragRect.x1) + 1) * baseCellSize,
            height: (Math.abs(dragRect.y2 - dragRect.y1) + 1) * baseCellSize,
          }}
        />
      )}
    </div>
  )
}