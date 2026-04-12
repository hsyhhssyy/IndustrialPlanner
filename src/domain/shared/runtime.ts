import type { DeviceInstance, DeviceRuntime } from '../types'
import { isBelt, isPipe } from '../geometry'

export function runtimeLabel(runtime: DeviceRuntime | undefined) {
  if (!runtime) return 'idle'
  if (runtime.stallReason === 'NO_INPUT') return 'starved'
  if (runtime.stallReason === 'NONE') return 'running'
  return runtime.stallReason.toLowerCase()
}

export function getRuntimeStatusText(
  runtime: DeviceRuntime | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  const status = runtimeLabel(runtime)
  const keyByStatus: Record<string, string> = {
    idle: 'detail.status.idle',
    running: 'detail.status.running',
    starved: 'detail.status.starved',
    low_power: 'detail.status.lowPower',
    out_of_power_range: 'detail.status.outOfPowerRange',
    overlap: 'detail.status.overlap',
    output_buffer_full: 'detail.status.outputBlocked',
    downstream_blocked: 'detail.status.outputBlocked',
    bus_not_connected: 'detail.status.busNotConnected',
    pickup_bus_not_connected: 'detail.status.pickupBusNotConnected',
    config_error: 'detail.status.configError',
  }
  const key = keyByStatus[status]
  if (key) return t(key)
  return status
}

export function shouldShowRuntimeStallOverlay(device: DeviceInstance, runtime: DeviceRuntime | undefined) {
  const status = runtimeLabel(runtime)
  if (status === 'running' || status === 'idle') return false
  if (!runtime) return false
  const isBeltDevice = isBelt(device.typeId)
  const isPipeDevice = isPipe(device.typeId)
  const isTransientBlocked = runtime.stallReason === 'DOWNSTREAM_BLOCKED' || runtime.stallReason === 'OUTPUT_BUFFER_FULL'
  if (
    (isBeltDevice || isPipeDevice) &&
    isTransientBlocked
  ) {
    return false
  }
  if (runtime.stallReason === 'DOWNSTREAM_BLOCKED' && ('outputBuffer' in runtime || 'inventory' in runtime)) {
    return false
  }
  return true
}