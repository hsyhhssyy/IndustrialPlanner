import { useCallback, useMemo } from 'react'
import { applyLogisticsPath, longestValidLogisticsPrefix, pathFromTrace } from '../../domain/logistics'
import { cellToDeviceId, getDeviceById, getRotatedPorts, isBelt, isBeltLike, isPipe, isPipeLike, linksFromLayout, OPPOSITE_EDGE, shouldHidePortChevron } from '../../domain/geometry'
import { DEVICE_TYPE_BY_ID } from '../../domain/registry'
import { validatePlacementConstraints } from '../../domain/placement'
import { getDeviceSpritePath } from '../../domain/deviceSprites'
import { isDeviceWithinAllowedPlacementArea } from '../../domain/shared/placementArea'
import { rotatedFootprintSize } from '../../domain/shared/math'
import type { DeviceInstance, DeviceTypeId, LayoutState, Rotation } from '../../domain/types'
import type { PlaceOperation } from '../../app/AppContext'
import {
  getPlacementLimitViolationToastKey,
  type OuterRing,
} from './buildInteraction.contract'

type Cell = { x: number; y: number }

type UseBuildPreviewDomainParams = {
  layout: LayoutState
  currentBaseOuterRing: OuterRing
  mode: string
  placeType: DeviceTypeId | ''
  placeRotation: Rotation
  placeOperation: PlaceOperation
  selection: string[]
  dragPreviewPositions: Record<string, Cell>
  hoverCell: Cell | null
  simIsRunning: boolean
  logStart: Cell | null
  logCurrent: Cell | null
  logTrace: Cell[]
  baseCellSize: number
  edgeAngle: Record<string, number>
  hiddenLabelDeviceTypes: ReadonlySet<DeviceTypeId>
}

type LogisticsEndpointHighlight = {
  key: string
  x: number
  y: number
  kind: 'start' | 'end'
}

export function useBuildPreviewDomain({
  layout,
  currentBaseOuterRing,
  mode,
  placeType,
  placeRotation,
  placeOperation,
  selection,
  dragPreviewPositions,
  hoverCell,
  simIsRunning,
  logStart,
  logCurrent,
  logTrace,
  baseCellSize,
  edgeAngle,
  hiddenLabelDeviceTypes,
}: UseBuildPreviewDomainParams) {
  const toPlaceOrigin = useCallback((cell: Cell, typeId: DeviceTypeId, rotation: Rotation) => {
    const type = DEVICE_TYPE_BY_ID[typeId]
    const footprint = rotatedFootprintSize(type.size, rotation)
    return {
      x: Math.floor(cell.x + 0.5 - footprint.width / 2),
      y: Math.floor(cell.y + 0.5 - footprint.height / 2),
    }
  }, [])

  const logisticsPreview = useMemo(() => {
    if (!logStart || !logCurrent || logTrace.length === 0) return null
    const candidatePath = pathFromTrace(logTrace)
    if (!candidatePath) return null
    const family = placeOperation === 'pipe' ? 'pipe' : 'belt'
    return longestValidLogisticsPrefix(layout, candidatePath, family)
  }, [layout, logStart, logCurrent, logTrace, placeOperation])

  const logisticsPreviewDevices = useMemo(() => {
    if (mode !== 'place' || (placeOperation !== 'belt' && placeOperation !== 'pipe') || !logisticsPreview || logisticsPreview.length < 1) return []
    const family = placeOperation === 'pipe' ? 'pipe' : 'belt'
    const projectedLayout = applyLogisticsPath(layout, logisticsPreview, family)
    if (projectedLayout === layout) return []
    const projectedCellMap = cellToDeviceId(projectedLayout)
    const seenProjectedIds = new Set<string>()
    const result: DeviceInstance[] = []

    for (const cell of logisticsPreview) {
      const projectedId = projectedCellMap.get(`${cell.x},${cell.y}`)
      if (!projectedId || seenProjectedIds.has(projectedId)) continue
      seenProjectedIds.add(projectedId)
      const projectedDevice = getDeviceById(projectedLayout, projectedId)
      if (!projectedDevice) continue
      if (!isBeltLike(projectedDevice.typeId) && !isPipeLike(projectedDevice.typeId) && !hiddenLabelDeviceTypes.has(projectedDevice.typeId)) continue
      result.push({
        ...projectedDevice,
        instanceId: `preview-${projectedDevice.instanceId}`,
      })
    }

    return result
  }, [hiddenLabelDeviceTypes, layout, logisticsPreview, mode, placeOperation])

  const portChevrons = useMemo(() => {
    if (!(mode === 'place' && ((placeOperation === 'belt' || placeOperation === 'pipe') || !placeType))) return []
    const isLogisticsPlacementMode = mode === 'place' && (placeOperation === 'belt' || placeOperation === 'pipe')
    const isSelectionOnlyChevronMode = mode === 'place' && !placeType && !isLogisticsPlacementMode
    const keyOf = (port: { instanceId: string; portId: string; x: number; y: number; edge: string }) =>
      `${port.instanceId}:${port.portId}:${port.x}:${port.y}:${port.edge}`

    const result: Array<{ key: string; x: number; y: number; angle: number; width: number; height: number }> = []
    const connectedPortKeys = new Set<string>()
    if (isLogisticsPlacementMode && placeOperation === 'pipe') {
      for (const link of linksFromLayout(layout)) {
        connectedPortKeys.add(`${link.from.instanceId}:${link.from.portId}`)
        connectedPortKeys.add(`${link.to.instanceId}:${link.to.portId}`)
      }
    }
    const chevronLength = baseCellSize * (1 / 6)
    const chevronThickness = baseCellSize * (2 / 5)
    const chevronGap = baseCellSize * (1 / 12)
    const outsideOffset = chevronLength / 2 + chevronGap

    type ChevronCandidate = {
      device: DeviceInstance
      port: ReturnType<typeof getRotatedPorts>[number]
      portKey: string
    }

    const candidates: ChevronCandidate[] = []
    for (const device of layout.devices) {
      const previewOrigin = dragPreviewPositions[device.instanceId]
      const shouldFollowDragPreview = isSelectionOnlyChevronMode
      const renderDevice =
        shouldFollowDragPreview && previewOrigin
          ? {
              ...device,
              origin: previewOrigin,
            }
          : device
      for (const port of getRotatedPorts(renderDevice)) {
        candidates.push({ device: renderDevice, port, portKey: keyOf(port) })
      }
    }

    const resolveChevron = (candidate: ChevronCandidate) => {
      const { device, port, portKey } = candidate

      if (isBelt(device.typeId)) return null
      if (shouldHidePortChevron(device.typeId)) return null
      if (isSelectionOnlyChevronMode && !selection.includes(device.instanceId)) return null

      if (isLogisticsPlacementMode) {
        const allowsSolid =
          port.allowedTypes.mode === 'solid' ||
          (port.allowedTypes.mode === 'whitelist' && port.allowedTypes.whitelist.includes('solid'))
        const allowsLiquid =
          port.allowedTypes.mode === 'liquid' ||
          (port.allowedTypes.mode === 'whitelist' && port.allowedTypes.whitelist.includes('liquid'))

        if (placeOperation === 'belt' && !allowsSolid) return null
        if (placeOperation === 'pipe' && !allowsLiquid) return null

        if (placeOperation === 'pipe') {
          if (isPipe(device.typeId)) {
            if (connectedPortKeys.has(`${port.instanceId}:${port.portId}`)) return null
          }
        }
      }

      const centerX = (port.x + 0.5) * baseCellSize
      const centerY = (port.y + 0.5) * baseCellSize
      let x = centerX
      let y = centerY
      if (port.edge === 'N') y = port.y * baseCellSize - outsideOffset
      if (port.edge === 'S') y = (port.y + 1) * baseCellSize + outsideOffset
      if (port.edge === 'W') x = port.x * baseCellSize - outsideOffset
      if (port.edge === 'E') x = (port.x + 1) * baseCellSize + outsideOffset

      return {
        key: portKey,
        x,
        y,
        angle: port.direction === 'Input' ? edgeAngle[OPPOSITE_EDGE[port.edge]] : edgeAngle[port.edge],
        width: chevronLength,
        height: chevronThickness,
      }
    }

    for (const candidate of candidates) {
      const chevron = resolveChevron(candidate)
      if (!chevron) continue
      result.push(chevron)
    }

    return result
  }, [
    baseCellSize,
    dragPreviewPositions,
    edgeAngle,
    layout,
    mode,
    placeOperation,
    placeType,
    selection,
  ])

  const placePreview = useMemo(() => {
    if (mode !== 'place' || !placeType || !hoverCell || simIsRunning) return null
    const origin = toPlaceOrigin(hoverCell, placeType, placeRotation)
    const instance: DeviceInstance = {
      instanceId: 'preview',
      typeId: placeType,
      origin,
      rotation: placeRotation,
      config: {},
    }
    const type = DEVICE_TYPE_BY_ID[placeType]
    const footprintSize = rotatedFootprintSize(type.size, placeRotation)
    const textureSrc = getDeviceSpritePath(placeType)
    const surfaceContentWidthPx = footprintSize.width * baseCellSize - 6
    const surfaceContentHeightPx = footprintSize.height * baseCellSize - 6
    const isQuarterTurn = placeRotation === 90 || placeRotation === 270
    const textureWidthPx = isQuarterTurn ? surfaceContentHeightPx : surfaceContentWidthPx
    const textureHeightPx = isQuarterTurn ? surfaceContentWidthPx : surfaceContentHeightPx
    const chevronLength = baseCellSize * (1 / 6)
    const chevronThickness = baseCellSize * (2 / 5)
    const chevronGap = baseCellSize * (1 / 12)
    const outsideOffset = chevronLength / 2 + chevronGap
    const chevrons = getRotatedPorts(instance).map((port) => {
      const localCenterX = (port.x - origin.x + 0.5) * baseCellSize
      const localCenterY = (port.y - origin.y + 0.5) * baseCellSize
      let x = localCenterX
      let y = localCenterY
      if (port.edge === 'N') y = (port.y - origin.y) * baseCellSize - outsideOffset
      if (port.edge === 'S') y = (port.y - origin.y + 1) * baseCellSize + outsideOffset
      if (port.edge === 'W') x = (port.x - origin.x) * baseCellSize - outsideOffset
      if (port.edge === 'E') x = (port.x - origin.x + 1) * baseCellSize + outsideOffset
      return {
        key: `preview-${port.instanceId}-${port.portId}-${port.x}-${port.y}-${port.edge}-${port.direction}`,
        x,
        y,
        angle: port.direction === 'Input' ? edgeAngle[OPPOSITE_EDGE[port.edge]] : edgeAngle[port.edge],
        width: chevronLength,
        height: chevronThickness,
      }
    })
    return {
      origin,
      type,
      rotation: placeRotation,
      textureSrc,
      textureWidthPx,
      textureHeightPx,
      footprintSize,
      chevrons,
      isValid:
        getPlacementLimitViolationToastKey(layout, placeType) === null &&
        isDeviceWithinAllowedPlacementArea(instance, layout.lotSize, currentBaseOuterRing) &&
        validatePlacementConstraints(layout, instance).isValid,
    }
  }, [baseCellSize, currentBaseOuterRing, edgeAngle, hoverCell, layout, mode, placeRotation, placeType, simIsRunning, toPlaceOrigin])

  const logisticsEndpointHighlights = useMemo<LogisticsEndpointHighlight[]>(() => {
    const isLogisticsPlacementMode = mode === 'place' && (placeOperation === 'belt' || placeOperation === 'pipe')
    if (!isLogisticsPlacementMode || !logStart || !logCurrent || !logisticsPreview || logisticsPreview.length === 0) return []

    const allowsPortInCurrentMode = (port: ReturnType<typeof getRotatedPorts>[number]) => {
      const allowsSolid =
        port.allowedTypes.mode === 'solid' ||
        (port.allowedTypes.mode === 'whitelist' && port.allowedTypes.whitelist.includes('solid'))
      const allowsLiquid =
        port.allowedTypes.mode === 'liquid' ||
        (port.allowedTypes.mode === 'whitelist' && port.allowedTypes.whitelist.includes('liquid'))
      if (placeOperation === 'belt') return allowsSolid
      return allowsLiquid
    }

    const hasLegalPortAtCell = (cell: Cell) => {
      for (const device of layout.devices) {
        if (isBeltLike(device.typeId) || isPipeLike(device.typeId)) continue
        for (const port of getRotatedPorts(device)) {
          if (port.x !== cell.x || port.y !== cell.y) continue
          if (!allowsPortInCurrentMode(port)) continue
          return true
        }
      }
      return false
    }

    const startCell = logisticsPreview[0]
    const endCell = logisticsPreview[logisticsPreview.length - 1]
    const highlights: LogisticsEndpointHighlight[] = []

    if (startCell && startCell.x === logStart.x && startCell.y === logStart.y && hasLegalPortAtCell(logStart)) {
      highlights.push({ key: `log-endpoint-start-${logStart.x}-${logStart.y}`, x: logStart.x, y: logStart.y, kind: 'start' })
    }

    if (endCell && endCell.x === logCurrent.x && endCell.y === logCurrent.y && hasLegalPortAtCell(logCurrent)) {
      const duplicateStart = highlights.some((highlight) => highlight.x === logCurrent.x && highlight.y === logCurrent.y)
      if (!duplicateStart) {
        highlights.push({ key: `log-endpoint-end-${logCurrent.x}-${logCurrent.y}`, x: logCurrent.x, y: logCurrent.y, kind: 'end' })
      }
    }

    return highlights
  }, [layout.devices, logCurrent, logStart, logisticsPreview, mode, placeOperation])

  return {
    toPlaceOrigin,
    logisticsPreview,
    logisticsPreviewDevices,
    logisticsEndpointHighlights,
    portChevrons,
    placePreview,
  }
}