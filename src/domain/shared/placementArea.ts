import { getFootprintCells } from '../geometry'
import { DEVICE_TYPE_BY_ID } from '../registry'
import type { DeviceInstance, DeviceTypeId } from '../types'

export type PlacementOuterRing = { top: number; right: number; bottom: number; left: number }

type Cell = { x: number; y: number }

function hasTypeTag(typeId: DeviceTypeId, tag: string) {
  return DEVICE_TYPE_BY_ID[typeId]?.tags?.includes(tag) ?? false
}

export function allowsOuterRingPlacement(typeId: DeviceTypeId) {
  return hasTypeTag(typeId, 'OuterRingAllowed')
}

export function isCellWithinPlacementArea(cell: Cell, lotSize: number, outerRing: PlacementOuterRing, allowOuterRing: boolean) {
  if (allowOuterRing) {
    return (
      cell.x >= -outerRing.left &&
      cell.y >= -outerRing.top &&
      cell.x < lotSize + outerRing.right &&
      cell.y < lotSize + outerRing.bottom
    )
  }
  return cell.x >= 0 && cell.y >= 0 && cell.x < lotSize && cell.y < lotSize
}

export function isDeviceWithinAllowedPlacementArea(device: DeviceInstance, lotSize: number, outerRing: PlacementOuterRing) {
  const footprint = getFootprintCells(device)
  if (footprint.length === 0) return false
  const allowOuterRing = allowsOuterRingPlacement(device.typeId)
  const inAllowedArea = footprint.every((cellPos) => isCellWithinPlacementArea(cellPos, lotSize, outerRing, allowOuterRing))
  if (!inAllowedArea) return false

  const innerRingNotAllowed = hasTypeTag(device.typeId, 'InnerRingNotAllowed')
  if (!innerRingNotAllowed) return true

  return footprint.every((cellPos) => !(cellPos.x >= 0 && cellPos.y >= 0 && cellPos.x < lotSize && cellPos.y < lotSize))
}
