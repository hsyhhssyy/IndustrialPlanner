import type { BaseId, DeviceConfig, DeviceInstance, LayoutState } from '../domain/types'
import { normalizePortPriorityGroups } from '../domain/shared/portPriority'

export const APP_VERSION = '1.0'
const PICKUP_OUTPUT_PORT_ID = 'p_out_mid'

export const LEGACY_BLUEPRINTS_KEY = 'stage1-blueprints'
export const LEGACY_SELECTED_BLUEPRINT_ID_KEY = 'stage1-selected-blueprint-id'
export const LEGACY_ARMED_BLUEPRINT_ID_KEY = 'stage1-armed-blueprint-id'
export const LEGACY_CLIPBOARD_BLUEPRINT_KEY = 'stage1-clipboard-blueprint'

export const USER_BLUEPRINTS_KEY = 'stage3-blueprints-user'
export const SYSTEM_BLUEPRINTS_KEY = 'stage3-blueprints-system'
export const SELECTED_BLUEPRINT_ID_KEY = 'stage3-selected-blueprint-id'
export const ARMED_BLUEPRINT_ID_KEY = 'stage3-armed-blueprint-id'
export const CLIPBOARD_BLUEPRINT_KEY = 'stage3-clipboard-blueprint'
export const PUBLIC_BLUEPRINT_INDEX_CACHE_KEY = 'stage3-public-blueprint-index'

export type BlueprintSource = 'user' | 'system'

const USER_BLUEPRINT_ID_PATTERN = /^BluePrint-HSY-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SYSTEM_BLUEPRINT_ID_PATTERN = /^PublicBluePrint-HSY-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

let blueprintStorageMigrationRan = false

type LayoutsByBaseStorage = {
  version: string
  layoutsByBase: Partial<Record<BaseId, LayoutState>>
}

type StoredBlueprintSnapshot = {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt?: string
  version: string
  blueprintVersion: string
  baseId: BaseId
  source: BlueprintSource
  devices: Array<{
    typeId: DeviceInstance['typeId']
    rotation: DeviceInstance['rotation']
    origin: { x: number; y: number }
    config: DeviceConfig
  }>
}

export type PublicBlueprintIndexEntry = {
  id: string
  blueprintVersion: string
  name: string
  path: string
  size: number
}

export type PublicBlueprintIndexCache = {
  version: number
  generatedAt: string
  files: PublicBlueprintIndexEntry[]
}

function randomHex(length: number) {
  const chars = '0123456789abcdef'
  let output = ''
  for (let index = 0; index < length; index += 1) {
    output += chars[Math.floor(Math.random() * chars.length)]
  }
  return output
}

function fallbackUuidV4() {
  const part1 = randomHex(8)
  const part2 = randomHex(4)
  const part3 = `4${randomHex(3)}`
  const variantNibble = (8 + Math.floor(Math.random() * 4)).toString(16)
  const part4 = `${variantNibble}${randomHex(3)}`
  const part5 = randomHex(12)
  return `${part1}-${part2}-${part3}-${part4}-${part5}`
}

function createUuidV4() {
  const globalCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (globalCrypto?.randomUUID) {
    return globalCrypto.randomUUID().toLowerCase()
  }
  return fallbackUuidV4()
}

export function createBlueprintId(source: BlueprintSource) {
  const prefix = source === 'user' ? 'BluePrint-HSY-' : 'PublicBluePrint-HSY-'
  return `${prefix}${createUuidV4()}`
}

function isValidBlueprintId(id: string, source: BlueprintSource) {
  return source === 'user' ? USER_BLUEPRINT_ID_PATTERN.test(id) : SYSTEM_BLUEPRINT_ID_PATTERN.test(id)
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

  const normalizedPortPriorityGroups = normalizePortPriorityGroups(nextConfig.portPriorityGroups)
  if (normalizedPortPriorityGroups) {
    nextConfig.portPriorityGroups = normalizedPortPriorityGroups
  } else {
    delete nextConfig.portPriorityGroups
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

      const source: BlueprintSource = entry.source === 'system' ? 'system' : 'user'
      const normalized: StoredBlueprintSnapshot = {
        id: entry.id,
        name: entry.name,
        createdAt: entry.createdAt,
        version: typeof entry.version === 'string' && entry.version.length > 0 ? entry.version : APP_VERSION,
        blueprintVersion:
          typeof entry.blueprintVersion === 'string' || typeof entry.blueprintVersion === 'number'
            ? String(entry.blueprintVersion)
            : '1',
        baseId: entry.baseId as BaseId,
        source,
        devices: migratedDevices,
      }
      if (typeof entry.description === 'string' && entry.description.trim()) {
        normalized.description = entry.description.trim()
      }
      if (typeof entry.updatedAt === 'string') {
        normalized.updatedAt = entry.updatedAt
      }
      return normalized
    })
    .filter((entry): entry is StoredBlueprintSnapshot => entry !== null)
}

function normalizeBlueprintSnapshotsWithSource(rawValue: unknown, source: BlueprintSource) {
  const normalized = normalizeBlueprintSnapshotsStorage(rawValue as StoredBlueprintSnapshot[])
  const usedIds = new Set<string>()
  return normalized
    .map((entry) => {
      const next = { ...entry, source }
      let id = next.id
      if (!isValidBlueprintId(id, source) || usedIds.has(id)) {
        do {
          id = createBlueprintId(source)
        } while (usedIds.has(id))
      }
      usedIds.add(id)
      return {
        ...next,
        id,
      }
    })
    .filter((entry) => entry.devices.length > 0)
}

export function normalizeUserBlueprintSnapshotsStorage(rawValue: unknown): StoredBlueprintSnapshot[] {
  return normalizeBlueprintSnapshotsWithSource(rawValue, 'user')
}

export function normalizeSystemBlueprintSnapshotsStorage(rawValue: unknown): StoredBlueprintSnapshot[] {
  return normalizeBlueprintSnapshotsWithSource(rawValue, 'system')
}

export function normalizePublicBlueprintIndexCacheStorage(rawValue: unknown): PublicBlueprintIndexCache {
  const fallback: PublicBlueprintIndexCache = {
    version: 1,
    generatedAt: '',
    files: [],
  }

  if (!rawValue || typeof rawValue !== 'object') return fallback
  const value = rawValue as Partial<PublicBlueprintIndexCache>
  const files = Array.isArray(value.files) ? value.files : []
  const schemaVersion =
    typeof (rawValue as { schemaVersion?: unknown }).schemaVersion === 'number' &&
    Number.isFinite((rawValue as { schemaVersion?: number }).schemaVersion)
      ? (rawValue as { schemaVersion: number }).schemaVersion
      : typeof value.version === 'number' && Number.isFinite(value.version)
        ? value.version
        : 1

  return {
    version: schemaVersion,
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : '',
    files: files
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null
        const candidate = entry as Partial<PublicBlueprintIndexEntry>
        if (typeof candidate.id !== 'string' || !SYSTEM_BLUEPRINT_ID_PATTERN.test(candidate.id)) return null
        const blueprintVersionRaw =
          typeof candidate.blueprintVersion === 'string' || typeof candidate.blueprintVersion === 'number'
            ? candidate.blueprintVersion
            : typeof (candidate as { version?: unknown }).version === 'string' ||
                typeof (candidate as { version?: unknown }).version === 'number'
              ? (candidate as { version: string | number }).version
              : ''
        const blueprintVersion = String(blueprintVersionRaw).trim()
        if (!blueprintVersion) return null
        if (typeof candidate.name !== 'string' || typeof candidate.path !== 'string') return null
        const size = typeof candidate.size === 'number' && Number.isFinite(candidate.size) ? candidate.size : 0
        return {
          id: candidate.id,
          blueprintVersion,
          name: candidate.name,
          path: candidate.path,
          size,
        }
      })
      .filter(Boolean) as PublicBlueprintIndexEntry[],
  }
}

function safeReadJson(key: string): unknown {
  try {
    const text = localStorage.getItem(key)
    if (!text) return null
    return JSON.parse(text)
  } catch {
    return null
  }
}

function safeWriteJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    return
  }
}

export function runBlueprintStorageMigration() {
  if (blueprintStorageMigrationRan) return
  blueprintStorageMigrationRan = true
  if (typeof localStorage === 'undefined') return

  const hasStage3UserBlueprints = Boolean(localStorage.getItem(USER_BLUEPRINTS_KEY))
  let migratedUserBlueprints = normalizeUserBlueprintSnapshotsStorage(safeReadJson(USER_BLUEPRINTS_KEY))
  if (!hasStage3UserBlueprints) {
    const legacyBlueprintsRaw = safeReadJson(LEGACY_BLUEPRINTS_KEY)
    migratedUserBlueprints = normalizeUserBlueprintSnapshotsStorage(legacyBlueprintsRaw)
    safeWriteJson(USER_BLUEPRINTS_KEY, migratedUserBlueprints)

    const legacyNormalized = normalizeBlueprintSnapshotsStorage((legacyBlueprintsRaw ?? []) as StoredBlueprintSnapshot[])
    const idMap = new Map<string, string>()
    for (let index = 0; index < legacyNormalized.length && index < migratedUserBlueprints.length; index += 1) {
      idMap.set(legacyNormalized[index].id, migratedUserBlueprints[index].id)
    }

    if (!localStorage.getItem(SELECTED_BLUEPRINT_ID_KEY)) {
      const parsed = safeReadJson(LEGACY_SELECTED_BLUEPRINT_ID_KEY)
      if (typeof parsed === 'string') {
        const mapped = idMap.get(parsed)
        if (mapped) localStorage.setItem(SELECTED_BLUEPRINT_ID_KEY, JSON.stringify(mapped))
      }
    }

    if (!localStorage.getItem(ARMED_BLUEPRINT_ID_KEY)) {
      const parsed = safeReadJson(LEGACY_ARMED_BLUEPRINT_ID_KEY)
      if (typeof parsed === 'string') {
        const mapped = idMap.get(parsed)
        if (mapped) localStorage.setItem(ARMED_BLUEPRINT_ID_KEY, JSON.stringify(mapped))
      }
    }

    if (!localStorage.getItem(CLIPBOARD_BLUEPRINT_KEY)) {
      const legacyClipboardRaw = safeReadJson(LEGACY_CLIPBOARD_BLUEPRINT_KEY)
      if (legacyClipboardRaw) {
        const normalizedClipboard = normalizeUserBlueprintSnapshotsStorage([legacyClipboardRaw])[0] ?? null
        safeWriteJson(CLIPBOARD_BLUEPRINT_KEY, normalizedClipboard)
      }
    }
  }

  if (!localStorage.getItem(SYSTEM_BLUEPRINTS_KEY)) {
    safeWriteJson(SYSTEM_BLUEPRINTS_KEY, [])
  }

  if (!localStorage.getItem(PUBLIC_BLUEPRINT_INDEX_CACHE_KEY)) {
    safeWriteJson(PUBLIC_BLUEPRINT_INDEX_CACHE_KEY, { version: 1, generatedAt: '', files: [] })
  }
}

export function currentVersion() {
  return APP_VERSION
}
