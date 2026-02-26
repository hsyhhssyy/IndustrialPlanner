import type { ReactNode } from 'react'
import type { ItemId } from '../../domain/types'

type PowerRangeOutline = {
  key: string
  left: number
  top: number
  width: number
  height: number
}

type RuntimeStallOverlay = {
  key: string
  left: number
  top: number
  width: number
  height: number
  isBelt: boolean
}

type TransitItem = {
  key: string
  itemId: ItemId
  progress01: number
  x: number
  y: number
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
  mainDeviceLayer: ReactNode
  logisticsPreviewLayer: ReactNode
  blueprintPreviewLayer: ReactNode
  runtimeStallOverlays: RuntimeStallOverlay[]
  inTransitItems: TransitItem[]
  getItemLabelText: (itemId: ItemId) => string
  getItemIconPath: (itemId: ItemId) => string
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
  mainDeviceLayer,
  logisticsPreviewLayer,
  blueprintPreviewLayer,
  runtimeStallOverlays,
  inTransitItems,
  getItemLabelText,
  getItemIconPath,
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

      {powerRangeOutlines.map((outline) => (
        <div
          key={outline.key}
          className="power-range-outline"
          style={{
            left: outline.left,
            top: outline.top,
            width: outline.width,
            height: outline.height,
          }}
        />
      ))}

      {mainDeviceLayer}
      {logisticsPreviewLayer}
      {blueprintPreviewLayer}

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

      <div className="in-transit-overlay" aria-hidden="true">
        {inTransitItems.map((item) => (
          <span
            key={item.key}
            className={`belt-item-box item-${item.itemId}`}
            style={{
              left: item.x,
              top: item.y,
              width: `${baseCellSize * 0.5}px`,
              height: `${baseCellSize * 0.5}px`,
            }}
            title={`${getItemLabelText(item.itemId)} @ ${item.progress01.toFixed(2)}`}
          >
            <img className="belt-item-cover" src={getItemIconPath(item.itemId)} alt="" draggable={false} />
          </span>
        ))}
      </div>

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