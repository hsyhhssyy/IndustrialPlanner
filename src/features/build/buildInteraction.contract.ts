import type {
  Dispatch,
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  SetStateAction,
  WheelEvent as ReactWheelEvent,
} from 'react'
import type { BlueprintSnapshot } from '../blueprint/useBlueprintDomain'
import type { DeviceInstance, DeviceTypeId, LayoutState, Rotation } from '../../domain/types'
import { DEVICE_TYPE_BY_ID } from '../../domain/registry'
import {
  allowsOuterRingPlacement,
  isCellWithinPlacementArea as isCellWithinPlacementAreaByRule,
} from '../../domain/shared/placementArea'

export type Cell = { x: number; y: number }
export type OuterRing = { top: number; right: number; bottom: number; left: number }
export type DragRect = { x1: number; y1: number; x2: number; y2: number }
export type PanStart = { clientX: number; clientY: number; offsetX: number; offsetY: number }
export type LayoutUpdater = LayoutState | ((current: LayoutState) => LayoutState)

export const MANUAL_LOGISTICS_JUNCTION_TYPES = new Set<DeviceTypeId>([
  'item_log_splitter',
  'item_log_converger',
  'item_log_connector',
  'item_pipe_splitter',
  'item_pipe_converger',
  'item_pipe_connector',
])

export function isManualBeltJunctionType(typeId: DeviceTypeId) {
  return typeId === 'item_log_splitter' || typeId === 'item_log_converger' || typeId === 'item_log_connector'
}

export function isManualPipeJunctionType(typeId: DeviceTypeId) {
  return typeId === 'item_pipe_splitter' || typeId === 'item_pipe_converger' || typeId === 'item_pipe_connector'
}

export function allowsOuterRingPlacementForType(typeId: DeviceTypeId) {
  return allowsOuterRingPlacement(typeId)
}

export function isCellWithinPlacementArea(cell: Cell, lotSize: number, outerRing: OuterRing, allowOuterRing: boolean) {
  return isCellWithinPlacementAreaByRule(cell, lotSize, outerRing, allowOuterRing)
}

export function getPlacementLimitViolationToastKey(layout: LayoutState, placeType: DeviceTypeId): string | null {
  const type = DEVICE_TYPE_BY_ID[placeType]
  const maxPlacementCount = type?.maxPlacementCount
  const placementLimitToastKey = type?.placementLimitToastKey
  if (typeof maxPlacementCount !== 'number') return null
  const placementCount = layout.devices.filter((device) => device.typeId === placeType).length
  return placementCount >= maxPlacementCount ? placementLimitToastKey ?? 'toast.invalidPlacementFallback' : null
}

// 输入契约：视口相关参数仅负责坐标换算与缩放平移，不承载业务规则。
export type BuildInteractionViewportParams = {
  viewportRef: MutableRefObject<HTMLDivElement | null>
  currentBaseOuterRing: OuterRing
  zoomScale: number
  viewOffset: { x: number; y: number }
  canvasWidthPx: number
  canvasHeightPx: number
  baseCellSize: number
  cellSize: number
  getMaxCellSizeForViewport: (viewport: HTMLDivElement | null) => number
  getZoomStep: (cellSize: number) => number
  clampViewportOffset: (
    offset: { x: number; y: number },
    viewportSize: { width: number; height: number },
    canvasSize: { width: number; height: number },
  ) => { x: number; y: number }
}

// 输入契约：建造域参数包含布局读写与模式状态，是交互处理的业务输入边界。
export type BuildInteractionBuildParams = {
  layout: LayoutState
  setLayout: (updater: LayoutUpdater) => void
  placeRotation: Rotation
  toPlaceOrigin: (cell: Cell, typeId: DeviceTypeId, rotation: Rotation) => Cell
  simIsRunning: boolean
  logisticsPreview: Cell[] | null
  cellDeviceMap: Map<string, string>
  occupancyMap: Map<string, Array<{ instanceId: string }>>
  foundationIdSet: ReadonlySet<string>
}

export type BuildInteractionBlueprintParams = {
  activePlacementBlueprint: BlueprintSnapshot | null
  clipboardBlueprint: BlueprintSnapshot | null
  buildBlueprintPlacementPreview: (
    snapshot: BlueprintSnapshot | null,
    anchorCell: Cell,
    placementRotation: Rotation,
  ) => { devices: DeviceInstance[]; isValid: boolean; invalidMessageKey: string | null } | null
  blueprintPlacementRotation: Rotation
  setBlueprintPlacementRotation: Dispatch<SetStateAction<Rotation>>
  setClipboardBlueprint: Dispatch<SetStateAction<BlueprintSnapshot | null>>
  setArmedBlueprintId: Dispatch<SetStateAction<string | null>>
}

export type BuildInteractionI18nParams = {
  t: (key: string, params?: Record<string, string | number>) => string
  outOfLotToastKey: string
  fallbackPlacementToastKey: string
}

export type BuildInteractionParams = {
  viewport: BuildInteractionViewportParams
  build: BuildInteractionBuildParams
  blueprint: BuildInteractionBlueprintParams
  i18n: BuildInteractionI18nParams
}

// 输出契约：交互域仅向 App 暴露画布事件处理器与平移态，不泄漏内部可变状态。
export type BuildInteractionHandlers = {
  isPanning: boolean
  onCanvasMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void
  onCanvasMouseMove: (event: ReactMouseEvent<HTMLDivElement>) => void
  onCanvasMouseUp: (event: ReactMouseEvent<HTMLDivElement>) => Promise<void>
  onCanvasWheel: (event: ReactWheelEvent<HTMLDivElement>) => void
}
