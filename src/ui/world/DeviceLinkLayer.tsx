import { DEVICE_TYPE_BY_ID } from '../../domain/registry'
import { rotatedFootprintSize } from '../../domain/shared/math'
import type { DeviceInstance, DeviceLink } from '../../domain/types'

type DeviceLinkLayerProps = {
  baseCellSize: number
  devices: DeviceInstance[]
  links: DeviceLink[]
  draftSourceId: string | null
  draftTargetIds: ReadonlySet<string>
}

function getDeviceMetrics(device: DeviceInstance, baseCellSize: number) {
  const type = DEVICE_TYPE_BY_ID[device.typeId]
  const footprint = rotatedFootprintSize(type.size, device.rotation)
  return {
    left: device.origin.x * baseCellSize,
    top: device.origin.y * baseCellSize,
    width: footprint.width * baseCellSize,
    height: footprint.height * baseCellSize,
    centerX: (device.origin.x + footprint.width / 2) * baseCellSize,
    centerY: (device.origin.y + footprint.height / 2) * baseCellSize,
  }
}

export function DeviceLinkLayer({ baseCellSize, devices, links, draftSourceId, draftTargetIds }: DeviceLinkLayerProps) {
  const deviceById = new Map(devices.map((device) => [device.instanceId, device]))

  return (
    <>
      {draftSourceId && <div className="device-link-mask" />}
      <svg className="device-link-svg" aria-hidden="true">
        {links.map((link) => {
          const source = deviceById.get(link.sourceInstanceId)
          const target = deviceById.get(link.targetInstanceId)
          if (!source || !target) return null
          const sourceMetrics = getDeviceMetrics(source, baseCellSize)
          const targetMetrics = getDeviceMetrics(target, baseCellSize)
          return (
            <line
              key={link.linkId}
              className="device-link-line"
              x1={sourceMetrics.centerX}
              y1={sourceMetrics.centerY}
              x2={targetMetrics.centerX}
              y2={targetMetrics.centerY}
            />
          )
        })}
      </svg>
      {draftSourceId &&
        devices.map((device) => {
          const isSource = device.instanceId === draftSourceId
          const isCandidate = draftTargetIds.has(device.instanceId)
          if (!isSource && !isCandidate) return null
          const metrics = getDeviceMetrics(device, baseCellSize)
          return (
            <div
              key={`device-link-highlight-${device.instanceId}`}
              className={`device-link-highlight ${isSource ? 'is-source' : 'is-target'}`}
              style={{
                left: metrics.left,
                top: metrics.top,
                width: metrics.width,
                height: metrics.height,
              }}
            />
          )
        })}
    </>
  )
}