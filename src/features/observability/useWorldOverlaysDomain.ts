import { useMemo } from 'react'
import { getRotatedPorts, isBelt } from '../../domain/geometry'
import { DEVICE_TYPE_BY_ID } from '../../domain/registry'
import type { DeviceInstance, DeviceRuntime, LayoutState } from '../../domain/types'

type BeltEdge = 'N' | 'S' | 'W' | 'E'

type UseWorldOverlaysDomainParams = {
  layout: LayoutState
  runtimeById: Record<string, DeviceRuntime>
  baseCellSize: number
  beltViewboxSize: number
  getBeltItemPosition: (inputEdge: BeltEdge, outputEdge: BeltEdge, progress01: number) => { x: number; y: number }
  shouldShowRuntimeStallOverlay: (device: DeviceInstance, runtime: DeviceRuntime | undefined) => boolean
  rotatedFootprintSize: (size: { width: number; height: number }, rotation: 0 | 90 | 180 | 270) => { width: number; height: number }
}

export function useWorldOverlaysDomain({
  layout,
  runtimeById,
  baseCellSize,
  beltViewboxSize,
  getBeltItemPosition,
  shouldShowRuntimeStallOverlay,
  rotatedFootprintSize,
}: UseWorldOverlaysDomainParams) {
  const inTransitItems = useMemo(() => {
    return layout.devices.flatMap((device) => {
      if (!isBelt(device.typeId)) return []
      const runtime = runtimeById[device.instanceId]
      if (!runtime || !('slot' in runtime) || !runtime.slot) return []

      const beltPorts = getRotatedPorts(device)
      const beltInEdge = (beltPorts.find((port) => port.direction === 'Input')?.edge ?? 'W') as BeltEdge
      const beltOutEdge = (beltPorts.find((port) => port.direction === 'Output')?.edge ?? 'E') as BeltEdge
      const position = getBeltItemPosition(beltInEdge, beltOutEdge, runtime.slot.progress01)

      return [
        {
          key: `${device.instanceId}:${runtime.slot.enteredTick}:${runtime.slot.itemId}`,
          itemId: runtime.slot.itemId,
          progress01: runtime.slot.progress01,
          x: (device.origin.x + position.x / beltViewboxSize) * baseCellSize,
          y: (device.origin.y + position.y / beltViewboxSize) * baseCellSize,
        },
      ]
    })
  }, [baseCellSize, beltViewboxSize, getBeltItemPosition, layout.devices, runtimeById])

  const runtimeStallOverlays = useMemo(() => {
    return layout.devices.flatMap((device) => {
      const runtime = runtimeById[device.instanceId]
      if (!shouldShowRuntimeStallOverlay(device, runtime)) return []
      const type = DEVICE_TYPE_BY_ID[device.typeId]
      if (!type) return []
      const footprintSize = rotatedFootprintSize(type.size, device.rotation)
      return [
        {
          key: `stall-${device.instanceId}`,
          left: device.origin.x * baseCellSize,
          top: device.origin.y * baseCellSize,
          width: footprintSize.width * baseCellSize,
          height: footprintSize.height * baseCellSize,
          isBelt: isBelt(device.typeId),
        },
      ]
    })
  }, [baseCellSize, layout.devices, rotatedFootprintSize, runtimeById, shouldShowRuntimeStallOverlay])

  const powerRangeOutlines = useMemo(() => {
    return layout.devices
      .filter((device) => device.typeId === 'item_port_power_diffuser_1')
      .map((device) => ({
        key: `power-range-${device.instanceId}`,
        left: (device.origin.x - 5) * baseCellSize,
        top: (device.origin.y - 5) * baseCellSize,
        width: 12 * baseCellSize,
        height: 12 * baseCellSize,
      }))
  }, [baseCellSize, layout.devices])

  return {
    inTransitItems,
    runtimeStallOverlays,
    powerRangeOutlines,
  }
}