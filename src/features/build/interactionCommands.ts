import { getFootprintCells, includesCell, isBeltLike, isPipeLike, isWithinLot } from '../../domain/geometry'
import { validatePlacementConstraints } from '../../domain/placement'
import type { DeviceInstance, DeviceTypeId, LayoutState, Rotation } from '../../domain/types'
import { initialStorageConfig } from '../../sim/engine'
import { showToast } from '../../ui/toast'
import { MANUAL_LOGISTICS_JUNCTION_TYPES, isManualBeltJunctionType, isManualPipeJunctionType, type Cell } from './buildInteraction.contract'
import { nextId } from '../../domain/logistics'

type PlaceDeviceParams = {
  cell: Cell
  placeType: DeviceTypeId
  placeRotation: Rotation
  layout: LayoutState
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
  toPlaceOrigin,
  setLayout,
  outOfLotToastKey,
  fallbackPlacementToastKey,
  t,
}: PlaceDeviceParams) {
  const placementCount = layout.devices.filter((device) => device.typeId === placeType).length
  if (placeType === 'item_port_log_hongs_bus_source' && placementCount >= 1) {
    showToast(t('toast.rule.busSourceMax1'), { variant: 'warning' })
    return false
  }
  if (placeType === 'item_port_xiranite_oven_1' && placementCount >= 2) {
    showToast(t('toast.rule.xiraniteOvenMax2'), { variant: 'warning' })
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

  if (!isWithinLot(instance, layout.lotSize)) {
    showToast(t(outOfLotToastKey), { variant: 'warning' })
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
