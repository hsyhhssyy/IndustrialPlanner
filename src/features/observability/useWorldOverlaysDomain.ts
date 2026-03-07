import { useMemo } from 'react'
import { isBelt } from '../../domain/geometry'
import { DEVICE_TYPE_BY_ID } from '../../domain/registry'
import type { DeviceInstance, DeviceRuntime, LayoutState } from '../../domain/types'

type UseWorldOverlaysDomainParams = {
  layout: LayoutState
  runtimeById: Record<string, DeviceRuntime>
  baseCellSize: number
  shouldShowRuntimeStallOverlay: (device: DeviceInstance, runtime: DeviceRuntime | undefined) => boolean
  rotatedFootprintSize: (size: { width: number; height: number }, rotation: 0 | 90 | 180 | 270) => { width: number; height: number }
}

export function useWorldOverlaysDomain({
  layout,
  runtimeById,
  baseCellSize,
  shouldShowRuntimeStallOverlay,
  rotatedFootprintSize,
}: UseWorldOverlaysDomainParams) {
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
    runtimeStallOverlays,
    powerRangeOutlines,
  }
}