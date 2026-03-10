import { memo, useEffect, useRef } from 'react'
import { getDeviceSpritePath } from '../../domain/deviceSprites'
import { EDGE_ANGLE, getRotatedPorts, isBelt, isPipe, OPPOSITE_EDGE } from '../../domain/geometry'
import { buildBeltTrackPath, getBeltItemPosition } from '../../domain/shared/beltVisual'
import { rotatedFootprintSize } from '../../domain/shared/math'
import { getDeviceLabel } from '../../i18n'
import { DEVICE_TYPE_BY_ID, ITEM_BY_ID, ITEMS, RECIPES } from '../../domain/registry'
import { hasCustomPortPriorityGroups } from '../../domain/shared/portPriority'
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
  'item_log_admission',
  'item_pipe_splitter',
  'item_pipe_converger',
  'item_pipe_connector',
])

const REACTOR_LIQUID_PORT_TAGS: Record<string, string> = {
  out_w_1: '1',
  out_w_3: '2',
}
const PROTOCOL_HUB_OUTPUT_PORT_TAGS: Record<string, string> = {
  out_w_2: '1',
  out_w_5: '2',
  out_w_8: '3',
  out_e_2: '4',
  out_e_5: '5',
  out_e_8: '6',
}
const PICKUP_OUTPUT_PORT_ID = 'p_out_mid'
const SPLITTER_OUTPUT_PORT_ORDER = ['out_w', 'out_n', 'out_s'] as const

export type StaticDeviceRenderPass = 'underlay' | 'transit' | 'overlay' | 'adornment'

export type StaticDeviceLayerProps = {
  renderPass?: StaticDeviceRenderPass
  devices: DeviceInstance[]
  selectionSet: ReadonlySet<string>
  invalidSelectionSet: ReadonlySet<string>
  highlightedSet?: ReadonlySet<string>
  previewOriginsById: ReadonlyMap<string, { x: number; y: number }>
  language: Language
  extraClassName?: string
  showRuntimeItemIcons?: boolean
  showPreloadSummary?: boolean
  runtimeById?: Readonly<Record<string, DeviceRuntime>>
  simTick?: number
}

function getItemIconPath(itemId: ItemId) {
  return `/itemicon/${itemId}.png`
}

export const StaticDeviceLayer = memo(
  ({
    renderPass = 'overlay',
    devices,
    selectionSet,
    invalidSelectionSet,
    highlightedSet = new Set(),
    previewOriginsById,
    language,
    extraClassName,
    showRuntimeItemIcons = false,
    showPreloadSummary = false,
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

    function slotSolidData(slot: unknown): { itemId: ItemId; progress01: number } | null {
      if (!slot || typeof slot !== 'object') return null
      const maybeItemId = (slot as { itemId?: unknown }).itemId
      const maybeProgress = (slot as { progress01?: unknown }).progress01
      if (typeof maybeItemId !== 'string') return null
      if (typeof maybeProgress !== 'number') return null
      const itemDef = ITEM_BY_ID[maybeItemId]
      if (!itemDef || itemDef.type !== 'solid') return null
      const progress01 = Math.min(1, Math.max(0, maybeProgress))
      if (progress01 <= 0) return null
      return { itemId: maybeItemId, progress01 }
    }

    function junctionFlowPath(edgeA: 'N' | 'S' | 'W' | 'E', edgeB: 'N' | 'S' | 'W' | 'E') {
      const anchors = {
        N: { x: 50, y: 20 },
        S: { x: 50, y: 80 },
        W: { x: 20, y: 50 },
        E: { x: 80, y: 50 },
      }
      const start = anchors[edgeA]
      const end = anchors[edgeB]
      if (OPPOSITE_EDGE[edgeA] === edgeB) {
        return `M ${start.x} ${start.y} L ${end.x} ${end.y}`
      }
      return `M ${start.x} ${start.y} L 50 50 L ${end.x} ${end.y}`
    }

    function junctionInternalTransportPath(
      device: DeviceInstance,
      runtime: DeviceRuntime | undefined,
      rotatedPorts: ReturnType<typeof getRotatedPorts>,
    ): { path: string; itemId: ItemId; isBlocked: boolean } | null {
      if (!runtime || !('slot' in runtime)) return null
      const slot = slotSolidData(runtime.slot)
      if (!slot) return null
      const isBlocked = runtime.stallReason === 'DOWNSTREAM_BLOCKED' && Boolean(runtime.slot && runtime.slot.progress01 >= 1)

      if (device.typeId === 'item_log_splitter') {
        const inputEdge = rotatedPorts.find((port) => port.direction === 'Input')?.edge
        const outputPorts = SPLITTER_OUTPUT_PORT_ORDER.map((portId) => rotatedPorts.find((port) => port.portId === portId)).filter(
          (port): port is NonNullable<typeof port> => Boolean(port),
        )
        if (!inputEdge || outputPorts.length === 0 || !('lastSplitterOutputPortId' in runtime)) return null
        const pickedOutput = outputPorts.find((port) => port.portId === runtime.lastSplitterOutputPortId)?.edge ?? null
        if (!pickedOutput) return null
        return { path: junctionFlowPath(inputEdge, pickedOutput), itemId: slot.itemId, isBlocked }
      }

      if (device.typeId === 'item_log_converger') {
        const outputEdge = rotatedPorts.find((port) => port.direction === 'Output')?.edge
        const inputEdge = runtime.slot ? runtime.slot.enteredFrom : null
        if (!outputEdge || !inputEdge) return null
        return { path: junctionFlowPath(inputEdge, outputEdge), itemId: slot.itemId, isBlocked }
      }

      return null
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

    function getPreloadSummaryEntries(device: DeviceInstance): Array<{ itemId: ItemId; amount: number }> {
      const amountByItem = new Map<ItemId, number>()
      const preloadInputs = device.config.preloadInputs ?? []
      for (const entry of preloadInputs) {
        if (!entry || typeof entry.itemId !== 'string') continue
        const amount = Math.max(0, Math.floor(Number(entry.amount) || 0))
        if (amount <= 0) continue
        amountByItem.set(entry.itemId, (amountByItem.get(entry.itemId) ?? 0) + amount)
      }

      if (amountByItem.size === 0 && device.config.preloadInputItemId) {
        const fallbackAmount = Math.max(0, Math.floor(Number(device.config.preloadInputAmount) || 0))
        if (fallbackAmount > 0) {
          amountByItem.set(device.config.preloadInputItemId, fallbackAmount)
        }
      }

      return Array.from(amountByItem.entries()).map(([itemId, amount]) => ({ itemId, amount }))
    }

    function reactorLiquidPortTagStyle(
      port: { x: number; y: number; edge: 'N' | 'S' | 'W' | 'E' },
      origin: { x: number; y: number },
    ) {
      const localX = port.x - origin.x
      const localY = port.y - origin.y
      const centerX = (localX + 0.5) * BASE_CELL_SIZE
      const centerY = (localY + 0.5) * BASE_CELL_SIZE
      const insetOffset = BASE_CELL_SIZE * 0.24
      const offsetByEdge =
        port.edge === 'W'
          ? { dx: insetOffset, dy: 0 }
          : port.edge === 'E'
            ? { dx: -insetOffset, dy: 0 }
            : port.edge === 'N'
              ? { dx: 0, dy: insetOffset }
              : { dx: 0, dy: -insetOffset }

      return {
        left: `${centerX + offsetByEdge.dx}px`,
        top: `${centerY + offsetByEdge.dy}px`,
      }
    }

    function protocolHubOutputPortTagStyle(
      port: { x: number; y: number; edge: 'N' | 'S' | 'W' | 'E' },
      origin: { x: number; y: number },
    ) {
      const localX = port.x - origin.x
      const localY = port.y - origin.y
      const centerX = (localX + 0.5) * BASE_CELL_SIZE
      const centerY = (localY + 0.5) * BASE_CELL_SIZE
      const inwardOffset = BASE_CELL_SIZE
      const offsetByEdge =
        port.edge === 'W'
          ? { dx: inwardOffset, dy: 0 }
          : port.edge === 'E'
            ? { dx: -inwardOffset, dy: 0 }
            : port.edge === 'N'
              ? { dx: 0, dy: inwardOffset }
              : { dx: 0, dy: -inwardOffset }

      return {
        left: `${centerX + offsetByEdge.dx}px`,
        top: `${centerY + offsetByEdge.dy}px`,
      }
    }

    function shouldRenderDevicePass(params: {
      renderPass: StaticDeviceRenderPass
      isLogisticsTrack: boolean
      isBeltTrack: boolean
      isPipeTrack: boolean
      hasBeltTransit: boolean
      hasPipeTransit: boolean
      hasJunctionTransit: boolean
    }) {
      const { renderPass, isLogisticsTrack, isBeltTrack, isPipeTrack, hasBeltTransit, hasPipeTransit, hasJunctionTransit } = params
      if (renderPass === 'underlay') return isLogisticsTrack
      if (renderPass === 'transit') return (isBeltTrack && hasBeltTransit) || (isPipeTrack && hasPipeTransit)
      if (renderPass === 'adornment') return hasJunctionTransit
      return true
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
          const isProtocolHub = renderDevice.typeId === 'item_port_sp_hub_1'
          const isGrinder = renderDevice.typeId === 'item_port_grinder_1'
          const textureSrc = getDeviceSpritePath(renderDevice.typeId)
          const isTexturedDevice = textureSrc !== null
          const pickupOutputEntry = isPickupPort
            ? (renderDevice.config.protocolHubOutputs ?? []).find((entry) => entry.portId === PICKUP_OUTPUT_PORT_ID)
            : undefined
          const pickupItemId = isPickupPort ? pickupOutputEntry?.itemId ?? renderDevice.config.pickupItemId : undefined
          const runtimeIconItemId = getRuntimeIconItemId(renderDevice)
          const displayItemIconId = runtimeIconItemId
          const preloadSummaryEntries = showPreloadSummary ? getPreloadSummaryEntries(renderDevice) : []
          const configuredPortItemEntries =
            isPickupPort || isProtocolHub
              ? (renderDevice.config.protocolHubOutputs ?? [])
                  .filter((entry) => Boolean(entry.itemId))
                  .map((entry) => ({ portId: entry.portId, itemId: entry.itemId as ItemId }))
              : []
          const isPipeTrack = isPipe(renderDevice.typeId)
          const isBeltTrack = isBelt(renderDevice.typeId)
          const isLogisticsTrack = isBeltTrack || isPipeTrack
          const isSplitter = renderDevice.typeId === 'item_log_splitter'
          const isMerger = renderDevice.typeId === 'item_log_converger'
          const runtime = runtimeById[renderDevice.instanceId]
          const rotatedPorts = getRotatedPorts(renderDevice)
          const configuredPortIcons = configuredPortItemEntries
            .map((entry) => {
              const port = rotatedPorts.find((candidate) => candidate.portId === entry.portId)
              if (!port) return null
              const localX = port.x - renderDevice.origin.x
              const localY = port.y - renderDevice.origin.y
              return {
                key: `${renderDevice.instanceId}-port-item-${entry.portId}`,
                itemId: entry.itemId,
                left: (localX + 0.5) * BASE_CELL_SIZE,
                top: (localY + 0.5) * BASE_CELL_SIZE,
              }
            })
            .filter((entry): entry is { key: string; itemId: ItemId; left: number; top: number } => Boolean(entry))
          const showDeviceLabel =
            (isProtocolHub && !HIDDEN_DEVICE_LABEL_TYPES.has(renderDevice.typeId)) ||
            (!isProtocolHub && !displayItemIconId && configuredPortIcons.length === 0 && !HIDDEN_DEVICE_LABEL_TYPES.has(renderDevice.typeId))
          const beltPorts = isLogisticsTrack ? rotatedPorts : []
          const beltInEdge = isLogisticsTrack ? beltPorts.find((port) => port.direction === 'Input')?.edge ?? 'W' : 'W'
          const beltOutEdge = isLogisticsTrack ? beltPorts.find((port) => port.direction === 'Output')?.edge ?? 'E' : 'E'
          const beltPath = buildBeltTrackPath(beltInEdge, beltOutEdge)
          const pipeFluidItemId = isPipeTrack ? visiblePipeFluidItem(renderDevice) : null
          const pipeHasWater = Boolean(pipeFluidItemId)
          const beltTransitSlot = isBeltTrack ? slotSolidData(runtime && 'slot' in runtime ? runtime.slot : null) : null
          const beltTransitPosition = beltTransitSlot ? getBeltItemPosition(beltInEdge, beltOutEdge, beltTransitSlot.progress01) : null
          const pipeFluidWidth = 16
          const junctionTransport = isSplitter || isMerger
            ? junctionInternalTransportPath(renderDevice, runtime, rotatedPorts)
            : null
          const reactorLiquidPortTags =
            renderDevice.typeId === 'item_port_mix_pool_1' && selectionSet.has(renderDevice.instanceId)
              ? rotatedPorts.filter((port) => REACTOR_LIQUID_PORT_TAGS[port.portId])
              : []
          const protocolHubOutputPortTags =
            isProtocolHub && selectionSet.has(renderDevice.instanceId)
              ? rotatedPorts.filter((port) => PROTOCOL_HUB_OUTPUT_PORT_TAGS[port.portId])
              : []
          const hasBeltTransit = Boolean(beltTransitSlot && beltTransitPosition)
          const hasPipeTransit = Boolean(isPipeTrack && pipeHasWater)
          const hasJunctionTransit = Boolean((isSplitter || isMerger) && junctionTransport)
          if (!shouldRenderDevicePass({ renderPass, isLogisticsTrack, isBeltTrack, isPipeTrack, hasBeltTransit, hasPipeTransit, hasJunctionTransit })) {
            return null
          }
          return (
            <div
              key={renderDevice.instanceId}
              className={`device render-pass-${renderPass} ${isLogisticsTrack ? 'belt-device' : ''} ${isPipeTrack ? 'pipe-device' : ''} ${selectionSet.has(renderDevice.instanceId) ? 'selected' : ''} ${invalidSelectionSet.has(renderDevice.instanceId) ? 'drag-invalid' : ''} ${highlightedSet.has(renderDevice.instanceId) ? 'power-range-highlight' : ''} ${hasCustomPortPriorityGroups(renderDevice.config) ? 'port-priority-customized' : ''} ${extraClassName ?? ''}`.trim()}
              style={{
                left: renderDevice.origin.x * BASE_CELL_SIZE,
                top: renderDevice.origin.y * BASE_CELL_SIZE,
                width: footprintSize.width * BASE_CELL_SIZE,
                height: footprintSize.height * BASE_CELL_SIZE,
              }}
              title={renderPass === 'overlay' ? renderDevice.typeId : undefined}
            >
              {renderPass === 'underlay' && isLogisticsTrack ? (
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
                          <path d={beltPath} className="belt-track-edge" mask={`url(#${beltEdgeMaskId})`} />
                        </>
                      )
                    })()}
                  </svg>
                  {!isPipeTrack ? <span className="belt-arrow" style={{ transform: `translate(-50%, -50%) rotate(${EDGE_ANGLE[beltOutEdge]}deg)` }} /> : null}
                </div>
              ) : null}

              {renderPass === 'transit' && isPipeTrack && pipeHasWater ? (
                <div className="belt-track-wrap">
                  <svg className="belt-track-svg belt-transit-svg" viewBox={`0 0 ${BELT_VIEWBOX_SIZE} ${BELT_VIEWBOX_SIZE}`} preserveAspectRatio="none" aria-hidden="true">
                    <path d={beltPath} className="pipe-fluid-fill" style={{ strokeWidth: pipeFluidWidth, stroke: pipeFluidColor(pipeFluidItemId!) }} />
                  </svg>
                </div>
              ) : null}

              {renderPass === 'transit' && beltTransitSlot && beltTransitPosition ? (
                <span
                  className="belt-item-box belt-item-box-inline"
                  style={{
                    left: `${(beltTransitPosition.x / BELT_VIEWBOX_SIZE) * BASE_CELL_SIZE}px`,
                    top: `${(beltTransitPosition.y / BELT_VIEWBOX_SIZE) * BASE_CELL_SIZE}px`,
                    width: `${BASE_CELL_SIZE * 0.5}px`,
                    height: `${BASE_CELL_SIZE * 0.5}px`,
                  }}
                >
                  <img className="belt-item-cover" src={getItemIconPath(beltTransitSlot.itemId)} alt="" draggable={false} />
                </span>
              ) : null}

              {renderPass === 'adornment' && hasJunctionTransit ? (
                <div className="junction-icon junction-transit-icon" aria-hidden="true">
                  <svg className="junction-icon-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                    <path className={`junction-item-flow ${junctionTransport!.isBlocked ? 'is-blocked' : ''}`.trim()} d={junctionTransport!.path} />
                  </svg>
                </div>
              ) : null}

              {renderPass === 'overlay' && !isLogisticsTrack ? (
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
                  {displayItemIconId && (
                    <img className="device-item-icon" src={getItemIconPath(displayItemIconId)} alt="" aria-hidden="true" draggable={false} />
                  )}
                  {configuredPortIcons.map((entry) => (
                    <img
                      key={entry.key}
                      className="device-port-item-icon"
                      src={getItemIconPath(entry.itemId)}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                      style={{ left: `${entry.left}px`, top: `${entry.top}px` }}
                    />
                  ))}
                  {showDeviceLabel && (
                    <span className={`device-label ${isPickupPort ? 'pickup-label' : ''} ${isPickupPort && isQuarterTurn ? 'pickup-label-vertical' : ''}`}>
                      {getDeviceLabel(language, renderDevice.typeId)}
                    </span>
                  )}
                  {showDeviceLabel && preloadSummaryEntries.length > 0 && (
                    <div className="device-preload-row" aria-hidden="true">
                      {preloadSummaryEntries.map((entry) => (
                        <span key={`${renderDevice.instanceId}-preload-${entry.itemId}`} className="device-preload-chip">
                          <img className="device-preload-icon" src={getItemIconPath(entry.itemId)} alt="" draggable={false} />
                          <span className="device-preload-amount">x{entry.amount}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {isPickupPort && !pickupItemId && <em>?</em>}
                  {reactorLiquidPortTags.map((port) => (
                    <span
                      key={`${renderDevice.instanceId}-liquid-port-tag-${port.portId}`}
                      className="reactor-liquid-port-tag"
                      style={reactorLiquidPortTagStyle(port, renderDevice.origin)}
                    >
                      {REACTOR_LIQUID_PORT_TAGS[port.portId]}
                    </span>
                  ))}
                  {protocolHubOutputPortTags.map((port) => (
                    <span
                      key={`${renderDevice.instanceId}-protocol-hub-port-tag-${port.portId}`}
                      className="protocol-hub-output-port-tag"
                      style={protocolHubOutputPortTagStyle(port, renderDevice.origin)}
                    >
                      {PROTOCOL_HUB_OUTPUT_PORT_TAGS[port.portId]}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </>
    )
  },
)
