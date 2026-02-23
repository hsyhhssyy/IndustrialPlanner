import type { DeviceInstance, DeviceRuntime } from '../types'

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
    no_power: 'detail.status.noPower',
    overlap: 'detail.status.overlap',
    output_buffer_full: 'detail.status.outputBlocked',
    downstream_blocked: 'detail.status.outputBlocked',
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
  if (
    device.typeId.startsWith('belt_') &&
    (runtime.stallReason === 'DOWNSTREAM_BLOCKED' || runtime.stallReason === 'OUTPUT_BUFFER_FULL')
  ) {
    return false
  }
  if (runtime.stallReason === 'DOWNSTREAM_BLOCKED' && ('outputBuffer' in runtime || 'inventory' in runtime)) {
    return false
  }
  return true
}