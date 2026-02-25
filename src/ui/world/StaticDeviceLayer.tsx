import { memo, useEffect, useRef } from 'react'
import { getDeviceSpritePath } from '../../domain/deviceSprites'
import { EDGE_ANGLE, getRotatedPorts } from '../../domain/geometry'
import { buildBeltTrackPath, junctionArrowPoints } from '../../domain/shared/beltVisual'
import { rotatedFootprintSize } from '../../domain/shared/math'
import { getDeviceLabel } from '../../i18n'
import { DEVICE_TYPE_BY_ID, ITEM_BY_ID, ITEMS, RECIPES } from '../../domain/registry'
import type { DeviceInstance, DeviceRuntime, DeviceTypeId, ItemId } from '../../domain/types'
import type { Language } from '../../i18n'

const BASE_CELL_SIZE = 64
const BELT_VIEWBOX_SIZE = 64
const PIPE_FILL_HOLD_TICKS = 4
const LIQUID_COLOR_TAG_PREFIX = 'liquid_color:'
const DEFAULT_PIPE_FLUID_COLOR = 'rgba(130, 214, 255, 0.72)'

const HIDDEN_DEVICE_LABEL_TYPES = new Set<DeviceTypeId>([
  'item_log_splitter',
  'item_log_converger',
  'item_log_connector',
  'item_pipe_splitter',
  'item_pipe_converger',
  'item_pipe_connector',
])

export type StaticDeviceLayerProps = {
  devices: DeviceInstance[]
  selectionSet: ReadonlySet<string>
  invalidSelectionSet: ReadonlySet<string>
  previewOriginsById: ReadonlyMap<string, { x: number; y: number }>
  language: Language
  extraClassName?: string
  showRuntimeItemIcons?: boolean
  runtimeById?: Readonly<Record<string, DeviceRuntime>>
  simTick?: number
}

function getItemIconPath(itemId: ItemId) {
  return `/itemicon/${itemId}.png`
}

export const StaticDeviceLayer = memo(
  ({
    devices,
    selectionSet,
    invalidSelectionSet,
    previewOriginsById,
    language,
    extraClassName,
    showRuntimeItemIcons = false,
    runtimeById = {},
    simTick = 0,
  }: StaticDeviceLayerProps) => {
    const pipeLastFluidStateRef = useRef<Map<string, { tick: number; itemId: ItemId }>>(new Map())

    useEffect(() => {
      const liveIds = new Set(devices.map((device) => device.instanceId))
      for (const instanceId of pipeLastFluidStateRef.current.keys()) {
        if (!liveIds.has(instanceId)) {
          pipeLastFluidStateRef.current.delete(instanceId)
        }
      }
    }, [devices])

    function slotLiquidData(slot: unknown): { itemId: ItemId; progress01: number } | null {
      if (!slot || typeof slot !== 'object') return null
      const maybeItemId = (slot as { itemId?: unknown }).itemId
      const maybeProgress = (slot as { progress01?: unknown }).progress01
      if (typeof maybeItemId !== 'string') return null
      if (typeof maybeProgress !== 'number') return null
      const itemDef = ITEM_BY_ID[maybeItemId]
      if (!itemDef || itemDef.type !== 'liquid') return null
      const progress01 = Math.min(1, Math.max(0, maybeProgress))
      if (progress01 <= 0) return null
      return { itemId: maybeItemId, progress01 }
    }

    function pipeFluidColor(itemId: ItemId): string {
      const itemDef = ITEM_BY_ID[itemId]
      const colorTag = itemDef?.tags?.find((tag) => tag.startsWith(LIQUID_COLOR_TAG_PREFIX))
      if (!colorTag) return DEFAULT_PIPE_FLUID_COLOR
      const colorValue = colorTag.slice(LIQUID_COLOR_TAG_PREFIX.length).trim()
      return colorValue || DEFAULT_PIPE_FLUID_COLOR
    }

    function pipeFluidItemNow(device: DeviceInstance): ItemId | null {
      const runtime = runtimeById[device.instanceId]
      if (!runtime) return null

      const candidates: Array<{ itemId: ItemId; progress01: number }> = []

      if ('slot' in runtime) {
        const liquid = slotLiquidData(runtime.slot)
        if (liquid) candidates.push(liquid)
      }

      if ('nsSlot' in runtime || 'weSlot' in runtime) {
        const nsLiquid = 'nsSlot' in runtime ? slotLiquidData(runtime.nsSlot) : null
        const weLiquid = 'weSlot' in runtime ? slotLiquidData(runtime.weSlot) : null
        if (nsLiquid) candidates.push(nsLiquid)
        if (weLiquid) candidates.push(weLiquid)
      }

      if (candidates.length === 0) return null
      candidates.sort((left, right) => right.progress01 - left.progress01)
      return candidates[0]?.itemId ?? null
    }

    function visiblePipeFluidItem(device: DeviceInstance): ItemId | null {
      const itemNow = pipeFluidItemNow(device)
      if (itemNow) {
        pipeLastFluidStateRef.current.set(device.instanceId, { tick: simTick, itemId: itemNow })
        return itemNow
      }

      const lastState = pipeLastFluidStateRef.current.get(device.instanceId)
      if (!lastState) return null
      if (simTick < lastState.tick) {
        pipeLastFluidStateRef.current.delete(device.instanceId)
        return null
      }
      return simTick - lastState.tick <= PIPE_FILL_HOLD_TICKS ? lastState.itemId : null
    }

    function getRuntimeIconItemId(device: DeviceInstance): ItemId | undefined {
      if (!showRuntimeItemIcons) return undefined
      const type = DEVICE_TYPE_BY_ID[device.typeId]
      if (!type || type.runtimeKind !== 'processor') return undefined
      const runtime = runtimeById[device.instanceId]
      if (!runtime || !('outputBuffer' in runtime) || !('inputBuffer' in runtime)) return undefined

      for (const item of ITEMS) {
        if ((runtime.outputBuffer[item.id] ?? 0) > 0) return item.id
      }

      if (runtime.cycleProgressTicks > 0 && runtime.activeRecipeId) {
        const recipe = RECIPES.find((entry) => entry.id === runtime.activeRecipeId)
        if (recipe && recipe.outputs.length > 0) return recipe.outputs[0].itemId
      }

      return undefined
    }

    return (
      <>
        {devices.map((device) => {
          const previewOrigin = previewOriginsById.get(device.instanceId)
          const renderDevice = previewOrigin ? { ...device, origin: previewOrigin } : device
          const type = DEVICE_TYPE_BY_ID[renderDevice.typeId]
          if (!type) return null
          const footprintSize = rotatedFootprintSize(type.size, renderDevice.rotation)
          const surfaceContentWidthPx = footprintSize.width * BASE_CELL_SIZE - 6
          const surfaceContentHeightPx = footprintSize.height * BASE_CELL_SIZE - 6
          const isQuarterTurn = renderDevice.rotation === 90 || renderDevice.rotation === 270
          const textureWidthPx = isQuarterTurn ? surfaceContentHeightPx : surfaceContentWidthPx
          const textureHeightPx = isQuarterTurn ? surfaceContentWidthPx : surfaceContentHeightPx
          const isPickupPort = renderDevice.typeId === 'item_port_unloader_1'
          const isGrinder = renderDevice.typeId === 'item_port_grinder_1'
          const textureSrc = getDeviceSpritePath(renderDevice.typeId)
          const isTexturedDevice = textureSrc !== null
          const pickupItemId = isPickupPort ? renderDevice.config.pickupItemId : undefined
          const runtimeIconItemId = getRuntimeIconItemId(renderDevice)
          const displayItemIconId = pickupItemId ?? runtimeIconItemId
          const isPipe = renderDevice.typeId.startsWith('pipe_')
          const isBelt = renderDevice.typeId.startsWith('belt_')
          const isLogisticsTrack = isBelt || isPipe
          const isSplitter = renderDevice.typeId === 'item_log_splitter'
          const isMerger = renderDevice.typeId === 'item_log_converger'
          const beltPorts = isLogisticsTrack ? getRotatedPorts(renderDevice) : []
          const beltInEdge = isLogisticsTrack ? beltPorts.find((port) => port.direction === 'Input')?.edge ?? 'W' : 'W'
          const beltOutEdge = isLogisticsTrack ? beltPorts.find((port) => port.direction === 'Output')?.edge ?? 'E' : 'E'
          const beltPath = buildBeltTrackPath(beltInEdge, beltOutEdge)
          const pipeFluidItemId = isPipe ? visiblePipeFluidItem(renderDevice) : null
          const pipeHasWater = Boolean(pipeFluidItemId)
          const pipeFluidWidth = 16
          const splitterOutputEdges = isSplitter
            ? getRotatedPorts(renderDevice)
                .filter((port) => port.direction === 'Output')
                .map((port) => port.edge)
            : []
          const mergerOutputEdges = isMerger ? [getRotatedPorts(renderDevice).find((port) => port.direction === 'Output')?.edge ?? 'W'] : []
          const junctionArrowEdges = isSplitter ? splitterOutputEdges : mergerOutputEdges
          return (
            <div
              key={renderDevice.instanceId}
              className={`device ${isLogisticsTrack ? 'belt-device' : ''} ${isPipe ? 'pipe-device' : ''} ${selectionSet.has(renderDevice.instanceId) ? 'selected' : ''} ${invalidSelectionSet.has(renderDevice.instanceId) ? 'drag-invalid' : ''} ${extraClassName ?? ''}`.trim()}
              style={{
                left: renderDevice.origin.x * BASE_CELL_SIZE,
                top: renderDevice.origin.y * BASE_CELL_SIZE,
                width: footprintSize.width * BASE_CELL_SIZE,
                height: footprintSize.height * BASE_CELL_SIZE,
              }}
              title={renderDevice.typeId}
            >
              {isLogisticsTrack ? (
                <div className="belt-track-wrap">
                  <svg className="belt-track-svg" viewBox={`0 0 ${BELT_VIEWBOX_SIZE} ${BELT_VIEWBOX_SIZE}`} preserveAspectRatio="none" aria-hidden="true">
                    {(() => {
                      const beltEdgeMaskId = `belt-edge-mask-${renderDevice.instanceId}`
                      return (
                        <>
                          <defs>
                            <mask id={beltEdgeMaskId} maskUnits="userSpaceOnUse">
                              <rect x="0" y="0" width={BELT_VIEWBOX_SIZE} height={BELT_VIEWBOX_SIZE} fill="black" />
                              <path d={beltPath} className="belt-edge-mask-outer" />
                              <path d={beltPath} className="belt-edge-mask-inner" />
                            </mask>
                          </defs>
                          <path d={beltPath} className="belt-track-fill" />
                          {isPipe && pipeHasWater ? (
                            <path d={beltPath} className="pipe-fluid-fill" style={{ strokeWidth: pipeFluidWidth, stroke: pipeFluidColor(pipeFluidItemId!) }} />
                          ) : null}
                          <path d={beltPath} className="belt-track-edge" mask={`url(#${beltEdgeMaskId})`} />
                        </>
                      )
                    })()}
                  </svg>
                  {!isPipe ? <span className="belt-arrow" style={{ transform: `translate(-50%, -50%) rotate(${EDGE_ANGLE[beltOutEdge]}deg)` }} /> : null}
                </div>
              ) : (
                <div
                  className={`device-surface ${isPickupPort ? 'pickup-port-surface' : ''} ${isGrinder ? 'grinder-surface' : ''} ${isTexturedDevice ? 'textured-surface' : ''}`}
                >
                  {textureSrc && (
                    <img
                      className="device-texture"
                      src={textureSrc}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                      style={{
                        width: `${textureWidthPx}px`,
                        height: `${textureHeightPx}px`,
                        transform: `translate(-50%, -50%) rotate(${renderDevice.rotation}deg)`,
                      }}
                    />
                  )}
                  {(isSplitter || isMerger) && !isTexturedDevice && (
                    <div className="junction-icon" aria-hidden="true">
                      <svg className="junction-icon-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                        <line className="junction-cross-line" x1="20" y1="50" x2="80" y2="50" />
                        <line className="junction-cross-line" x1="50" y1="20" x2="50" y2="80" />
                        {junctionArrowEdges.map((edge) => (
                          <polyline key={`${renderDevice.instanceId}-${edge}`} className="junction-arrow-line" points={junctionArrowPoints(edge)} />
                        ))}
                      </svg>
                    </div>
                  )}
                  {displayItemIconId && (
                    <img className="device-item-icon" src={getItemIconPath(displayItemIconId)} alt="" aria-hidden="true" draggable={false} />
                  )}
                  {!displayItemIconId && !HIDDEN_DEVICE_LABEL_TYPES.has(renderDevice.typeId) && (
                    <span className={`device-label ${isPickupPort ? 'pickup-label' : ''} ${isPickupPort && isQuarterTurn ? 'pickup-label-vertical' : ''}`}>
                      {getDeviceLabel(language, renderDevice.typeId)}
                    </span>
                  )}
                  {isPickupPort && !pickupItemId && <em>?</em>}
                </div>
              )}
            </div>
          )
        })}
      </>
    )
  },
)
