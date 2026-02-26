import { getFootprintCells, includesCell, isBeltLike, isPipeLike } from '../../domain/geometry'
import { validatePlacementConstraints } from '../../domain/placement'
import { isDeviceWithinAllowedPlacementArea } from '../../domain/shared/placementArea'
import type { DeviceInstance, DeviceTypeId, LayoutState, Rotation } from '../../domain/types'
import { initialStorageConfig } from '../../sim/engine'
import { showToast } from '../../ui/toast'
import {
  MANUAL_LOGISTICS_JUNCTION_TYPES,
  getPlacementLimitViolationToastKey,
  type OuterRing,
  isManualBeltJunctionType,
  isManualPipeJunctionType,
  type Cell,
} from './buildInteraction.contract'
import { nextId } from '../../domain/logistics'

type PlaceDeviceParams = {
  cell: Cell
  placeType: DeviceTypeId
  placeRotation: Rotation
  layout: LayoutState
  currentBaseOuterRing: OuterRing
  toPlaceOrigin: (cell: Cell, typeId: DeviceTypeId, rotation: Rotation) => Cell
  setLayout: (updater: LayoutState | ((current: LayoutState) => LayoutState)) => void
  outOfLotToastKey: string
  fallbackPlacementToastKey: string
  t: (key: string, params?: Record<string, string | number>) => string
}

export function tryPlaceDevice({
  cell,
  placeType,
  placeRotation,
  layout,
  currentBaseOuterRing,
  toPlaceOrigin,
  setLayout,
  outOfLotToastKey,
  fallbackPlacementToastKey,
  t,
}: PlaceDeviceParams) {
  const placementLimitToastKey = getPlacementLimitViolationToastKey(layout, placeType)
  if (placementLimitToastKey) {
    showToast(t(placementLimitToastKey), { variant: 'warning' })
    return false
  }

  const origin = toPlaceOrigin(cell, placeType, placeRotation)
  const instance: DeviceInstance = {
    instanceId: nextId(placeType),
    typeId: placeType,
    origin,
    rotation: placeRotation,
    config: initialStorageConfig(placeType),
  }

  if (!isDeviceWithinAllowedPlacementArea(instance, layout.lotSize, currentBaseOuterRing)) {
    const isWaterPumpInsideIndustrialArea =
      placeType === 'item_port_water_pump_1' &&
      getFootprintCells(instance).some(
        (cellPos) => cellPos.x >= 0 && cellPos.y >= 0 && cellPos.x < layout.lotSize && cellPos.y < layout.lotSize,
      )
    showToast(t(isWaterPumpInsideIndustrialArea ? 'toast.rule.waterPumpOuterOnly' : outOfLotToastKey), { variant: 'warning' })
    return false
  }

  const validation = validatePlacementConstraints(layout, instance)
  if (!validation.isValid) {
    showToast(t(validation.messageKey ?? fallbackPlacementToastKey), { variant: 'warning' })
    return false
  }

  setLayout((current) => {
    if (!MANUAL_LOGISTICS_JUNCTION_TYPES.has(instance.typeId)) {
      return { ...current, devices: [...current.devices, instance] }
    }

    const footprint = getFootprintCells(instance)
    if (footprint.length === 0) {
      return { ...current, devices: [...current.devices, instance] }
    }

    const replacedBeltIds = new Set<string>()
    const replacePipeTrack = isManualPipeJunctionType(instance.typeId)
    const replaceBeltTrack = isManualBeltJunctionType(instance.typeId)
    for (const device of current.devices) {
      if (replaceBeltTrack && !isBeltLike(device.typeId)) continue
      if (replacePipeTrack && !isPipeLike(device.typeId)) continue
      if (!replaceBeltTrack && !replacePipeTrack) continue
      if (footprint.some((cellPos) => includesCell(device, cellPos.x, cellPos.y))) {
        replacedBeltIds.add(device.instanceId)
      }
    }

    return {
      ...current,
      devices: [...current.devices.filter((device) => !replacedBeltIds.has(device.instanceId)), instance],
    }
  })

  return true
}
