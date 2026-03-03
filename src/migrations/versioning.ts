import type { BaseId, DeviceConfig, DeviceInstance, LayoutState } from '../domain/types'

export const APP_VERSION = '1.0'
const PICKUP_OUTPUT_PORT_ID = 'p_out_mid'

type LayoutsByBaseStorage = {
  version: string
  layoutsByBase: Partial<Record<BaseId, LayoutState>>
}

type StoredBlueprintSnapshot = {
  id: string
  name: string
  createdAt: string
  updatedAt?: string
  version: string
  baseId: BaseId
  devices: Array<{
    typeId: DeviceInstance['typeId']
    rotation: DeviceInstance['rotation']
    origin: { x: number; y: number }
    config: DeviceConfig
  }>
}

export function migrateDeviceConfigToV1(config: DeviceConfig): DeviceConfig {
  const nextConfig: DeviceConfig = { ...config }
  const outputs = Array.isArray(nextConfig.protocolHubOutputs) ? [...nextConfig.protocolHubOutputs] : []

  if (nextConfig.pickupItemId) {
    const existingIndex = outputs.findIndex((entry) => entry.portId === PICKUP_OUTPUT_PORT_ID)
    const nextEntry = {
      portId: PICKUP_OUTPUT_PORT_ID,
      itemId: nextConfig.pickupItemId,
      ignoreInventory: Boolean(nextConfig.pickupIgnoreInventory),
    }
    if (existingIndex >= 0) outputs[existingIndex] = { ...outputs[existingIndex], ...nextEntry }
    else outputs.push(nextEntry)
  }

  if (outputs.length > 0) {
    nextConfig.protocolHubOutputs = outputs
  } else {
    delete nextConfig.protocolHubOutputs
  }

  return nextConfig
}

function migrateLayoutToV1(layout: LayoutState): LayoutState {
  return {
    ...layout,
    devices: layout.devices.map((device) => ({
      ...device,
      config: migrateDeviceConfigToV1(device.config ?? {}),
    })),
  }
}

export function normalizeLayoutsByBaseStorage(rawValue: LayoutsByBaseStorage): LayoutsByBaseStorage {
  const candidate = rawValue as unknown as
    | LayoutsByBaseStorage
    | Partial<Record<BaseId, LayoutState>>
    | undefined
    | null

  if (!candidate || typeof candidate !== 'object') {
    return { version: APP_VERSION, layoutsByBase: {} }
  }

  const hasEnvelope = 'layoutsByBase' in candidate
  const incomingLayouts = hasEnvelope
    ? ((candidate as LayoutsByBaseStorage).layoutsByBase ?? {})
    : (candidate as Partial<Record<BaseId, LayoutState>>)

  const migratedLayouts: Partial<Record<BaseId, LayoutState>> = {}
  for (const [baseId, layout] of Object.entries(incomingLayouts)) {
    if (!layout) continue
    migratedLayouts[baseId as BaseId] = migrateLayoutToV1(layout)
  }

  return {
    version: APP_VERSION,
    layoutsByBase: migratedLayouts,
  }
}

export function normalizeBlueprintSnapshotsStorage(rawValue: StoredBlueprintSnapshot[]): StoredBlueprintSnapshot[] {
  const list = Array.isArray(rawValue) ? (rawValue as unknown as Array<Partial<StoredBlueprintSnapshot>>) : []

  return list
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      if (typeof entry.id !== 'string' || typeof entry.name !== 'string' || typeof entry.createdAt !== 'string') return null
      if (typeof entry.baseId !== 'string' || !Array.isArray(entry.devices)) return null

      const migratedDevices = entry.devices
        .map((device) => {
          if (!device || typeof device !== 'object') return null
          if (typeof device.typeId !== 'string') return null
          if (typeof device.rotation !== 'number') return null
          if (!device.origin || typeof device.origin !== 'object') return null
          if (typeof device.origin.x !== 'number' || typeof device.origin.y !== 'number') return null

          return {
            typeId: device.typeId,
            rotation: device.rotation,
            origin: { x: device.origin.x, y: device.origin.y },
            config: migrateDeviceConfigToV1((device.config ?? {}) as DeviceConfig),
          }
        })
        .filter((device): device is NonNullable<typeof device> => Boolean(device))

      const normalized: StoredBlueprintSnapshot = {
        id: entry.id,
        name: entry.name,
        createdAt: entry.createdAt,
        version: typeof entry.version === 'string' && entry.version.length > 0 ? entry.version : APP_VERSION,
        baseId: entry.baseId as BaseId,
        devices: migratedDevices,
      }
      if (typeof entry.updatedAt === 'string') {
        normalized.updatedAt = entry.updatedAt
      }
      return normalized
    })
    .filter((entry): entry is StoredBlueprintSnapshot => entry !== null)
}

export function currentVersion() {
  return APP_VERSION
}
