import { useCallback, useMemo } from 'react'
import { applyLogisticsPath, longestValidLogisticsPrefix, pathFromTrace } from '../../domain/logistics'
import { cellToDeviceId, getDeviceById, getRotatedPorts, isWithinLot, linksFromLayout, OPPOSITE_EDGE } from '../../domain/geometry'
import { DEVICE_TYPE_BY_ID } from '../../domain/registry'
import { validatePlacementConstraints } from '../../domain/placement'
import { getDeviceSpritePath } from '../../domain/deviceSprites'
import { rotatedFootprintSize } from '../../domain/shared/math'
import type { DeviceInstance, DeviceTypeId, LayoutState, Rotation } from '../../domain/types'
import type { PlaceOperation } from '../../app/AppContext'

type Cell = { x: number; y: number }

type UseBuildPreviewDomainParams = {
  layout: LayoutState
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
  hiddenChevronDeviceTypes: ReadonlySet<DeviceTypeId>
  hiddenLabelDeviceTypes: ReadonlySet<DeviceTypeId>
}

export function useBuildPreviewDomain({
  layout,
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
  hiddenChevronDeviceTypes,
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
      if (!projectedDevice.typeId.startsWith('belt_') && !projectedDevice.typeId.startsWith('pipe_') && !hiddenLabelDeviceTypes.has(projectedDevice.typeId)) continue
      result.push({
        ...projectedDevice,
        instanceId: `preview-${projectedDevice.instanceId}`,
      })
    }

    return result
  }, [hiddenLabelDeviceTypes, layout, logisticsPreview, mode, placeOperation])

  const portChevrons = useMemo(() => {
    if (mode !== 'select' && !(mode === 'place' && ((placeOperation === 'belt' || placeOperation === 'pipe') || !placeType))) return []
    const links = linksFromLayout(layout)
    const connectedPortKeys = new Set<string>()
    const keyOf = (port: { instanceId: string; portId: string; x: number; y: number; edge: string }) =>
      `${port.instanceId}:${port.portId}:${port.x}:${port.y}:${port.edge}`

    for (const link of links) {
      connectedPortKeys.add(keyOf(link.from))
      connectedPortKeys.add(keyOf(link.to))
    }

    const result: Array<{ key: string; x: number; y: number; angle: number; width: number; height: number }> = []
    const chevronLength = baseCellSize * (1 / 6)
    const chevronThickness = baseCellSize * (2 / 5)
    const chevronGap = baseCellSize * (1 / 12)
    const outsideOffset = chevronLength / 2 + chevronGap
    for (const device of layout.devices) {
      const previewOrigin = dragPreviewPositions[device.instanceId]
      const shouldFollowDragPreview = mode === 'select' || (mode === 'place' && !placeType)
      const renderDevice =
        shouldFollowDragPreview && previewOrigin
          ? {
              ...device,
              origin: previewOrigin,
            }
          : device
      if (device.typeId.startsWith('belt_')) continue
      if (hiddenChevronDeviceTypes.has(device.typeId)) continue
      if ((mode === 'select' || (mode === 'place' && !placeType)) && !selection.includes(device.instanceId)) continue
      for (const port of getRotatedPorts(renderDevice)) {
        const portKey = keyOf(port)
        if (mode === 'place' && (placeOperation === 'belt' || placeOperation === 'pipe') && connectedPortKeys.has(portKey)) continue

        const centerX = (port.x + 0.5) * baseCellSize
        const centerY = (port.y + 0.5) * baseCellSize
        let x = centerX
        let y = centerY
        if (port.edge === 'N') y = port.y * baseCellSize - outsideOffset
        if (port.edge === 'S') y = (port.y + 1) * baseCellSize + outsideOffset
        if (port.edge === 'W') x = port.x * baseCellSize - outsideOffset
        if (port.edge === 'E') x = (port.x + 1) * baseCellSize + outsideOffset

        result.push({
          key: portKey,
          x,
          y,
          angle: port.direction === 'Input' ? edgeAngle[OPPOSITE_EDGE[port.edge]] : edgeAngle[port.edge],
          width: chevronLength,
          height: chevronThickness,
        })
      }
    }

    return result
  }, [
    baseCellSize,
    dragPreviewPositions,
    edgeAngle,
    hiddenChevronDeviceTypes,
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
      isValid: isWithinLot(instance, layout.lotSize) && validatePlacementConstraints(layout, instance).isValid,
    }
  }, [baseCellSize, edgeAngle, hoverCell, layout, mode, placeRotation, placeType, simIsRunning, toPlaceOrigin])

  return {
    toPlaceOrigin,
    logisticsPreview,
    logisticsPreviewDevices,
    portChevrons,
    placePreview,
  }
}