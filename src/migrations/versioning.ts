import { DEVICE_TYPE_BY_ID, ITEM_BY_ID } from '../domain/registry'
import type { BaseId, DeviceConfig, DeviceInstance, ItemId, LayoutState } from '../domain/types'
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

type LayoutHistoryEntryStorage = {
  past: LayoutState[]
  future: LayoutState[]
}

export type LayoutHistoryByBaseStorage = {
  version: string
  historiesByBase: Partial<Record<BaseId, LayoutHistoryEntryStorage>>
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

export function normalizeKnownDeviceTypeId(typeId: unknown): DeviceInstance['typeId'] | null {
  if (typeof typeId !== 'string') return null
  return typeId in DEVICE_TYPE_BY_ID ? (typeId as DeviceInstance['typeId']) : null
}

function normalizeKnownItemId(itemId: unknown): ItemId | undefined {
  return typeof itemId === 'string' && itemId in ITEM_BY_ID ? (itemId as ItemId) : undefined
}

function normalizeKnownSolidItemId(itemId: unknown): ItemId | undefined {
  const normalized = normalizeKnownItemId(itemId)
  return normalized && ITEM_BY_ID[normalized]?.type === 'solid' ? normalized : undefined
}

function normalizeKnownLiquidItemId(itemId: unknown): ItemId | undefined {
  const normalized = normalizeKnownItemId(itemId)
  return normalized && ITEM_BY_ID[normalized]?.type === 'liquid' ? normalized : undefined
}

function normalizeSlotIndex(value: unknown) {
  if (!Number.isFinite(value)) return null
  const normalized = Math.floor(Number(value))
  return normalized >= 0 ? normalized : null
}

function normalizePositiveAmount(value: unknown) {
  if (!Number.isFinite(value)) return undefined
  const normalized = Math.max(0, Math.floor(Number(value)))
  return normalized > 0 ? normalized : undefined
}

function sanitizePreloadEntries(entries: DeviceConfig['preloadInputs'] | DeviceConfig['storagePreloadInputs']) {
  if (!Array.isArray(entries)) return []
  return entries
    .map((entry) => {
      const slotIndex = normalizeSlotIndex(entry?.slotIndex)
      const itemId = normalizeKnownItemId(entry?.itemId)
      const amount = normalizePositiveAmount(entry?.amount)
      if (slotIndex === null || !itemId || amount === undefined) return null
      return { slotIndex, itemId, amount }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
}

function sanitizeProtocolHubOutputs(outputs: DeviceConfig['protocolHubOutputs']) {
  if (!Array.isArray(outputs)) return []
  return outputs
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || typeof entry.portId !== 'string') return null
      const itemId = normalizeKnownSolidItemId(entry.itemId)
      if (!itemId) return null
      return {
        portId: entry.portId,
        itemId,
        ignoreInventory: Boolean(entry.ignoreInventory),
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
}

function sanitizeStorageSlots(storageSlots: DeviceConfig['storageSlots']) {
  if (!Array.isArray(storageSlots)) return []
  return storageSlots
    .map((entry) => {
      const slotIndex = normalizeSlotIndex(entry?.slotIndex)
      if (slotIndex === null) return null

      const mode = entry?.mode === 'pinned' ? 'pinned' : 'free'
      const pinnedItemId = normalizeKnownItemId(entry?.pinnedItemId)
      const preloadItemId = normalizeKnownItemId(entry?.preloadItemId)
      const preloadAmount = preloadItemId ? normalizePositiveAmount(entry?.preloadAmount) : undefined
      const normalizedMode = mode === 'pinned' && pinnedItemId ? 'pinned' : 'free'

      if (normalizedMode === 'free' && !preloadItemId) return null

      const normalizedEntry: NonNullable<DeviceConfig['storageSlots']>[number] = {
        slotIndex,
        mode: normalizedMode,
      }
      if (normalizedMode === 'pinned' && pinnedItemId) {
        normalizedEntry.pinnedItemId = pinnedItemId
      }
      if (preloadItemId && preloadAmount !== undefined) {
        normalizedEntry.preloadItemId = preloadItemId
        normalizedEntry.preloadAmount = preloadAmount
      }
      return normalizedEntry
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
}

function sanitizeReactorPoolConfig(reactorPool: DeviceConfig['reactorPool']) {
  if (!reactorPool || typeof reactorPool !== 'object') return undefined

  const selectedRecipeIds = Array.isArray(reactorPool.selectedRecipeIds)
    ? reactorPool.selectedRecipeIds.filter((recipeId): recipeId is string => typeof recipeId === 'string' && recipeId.trim().length > 0)
    : []
  const solidOutputItemId = normalizeKnownSolidItemId(reactorPool.solidOutputItemId)
  const liquidOutputItemId = normalizeKnownLiquidItemId(reactorPool.liquidOutputItemId)
  const liquidOutputItemIdA = normalizeKnownLiquidItemId(reactorPool.liquidOutputItemIdA)
  const liquidOutputItemIdB = normalizeKnownLiquidItemId(reactorPool.liquidOutputItemIdB)

  const next: NonNullable<DeviceConfig['reactorPool']> = {}
  if (selectedRecipeIds.length > 0) next.selectedRecipeIds = selectedRecipeIds
  if (solidOutputItemId) next.solidOutputItemId = solidOutputItemId
  if (liquidOutputItemId) next.liquidOutputItemId = liquidOutputItemId
  if (liquidOutputItemIdA) next.liquidOutputItemIdA = liquidOutputItemIdA
  if (liquidOutputItemIdB) next.liquidOutputItemIdB = liquidOutputItemIdB
  return Object.keys(next).length > 0 ? next : undefined
}

function sanitizeDeviceConfigUnknownItems(config: DeviceConfig, deviceTypeId: DeviceInstance['typeId'] | undefined): DeviceConfig {
  const nextConfig: DeviceConfig = { ...config }

  const protocolHubOutputs = sanitizeProtocolHubOutputs(nextConfig.protocolHubOutputs)
  if (protocolHubOutputs.length > 0) nextConfig.protocolHubOutputs = protocolHubOutputs
  else delete nextConfig.protocolHubOutputs

  const pickupItemId = normalizeKnownSolidItemId(nextConfig.pickupItemId)
  if (pickupItemId) nextConfig.pickupItemId = pickupItemId
  else delete nextConfig.pickupItemId

  const admissionItemId =
    deviceTypeId === 'item_log_admission'
      ? normalizeKnownSolidItemId(nextConfig.admissionItemId)
      : deviceTypeId === 'item_pipe_admission'
        ? normalizeKnownLiquidItemId(nextConfig.admissionItemId)
        : undefined
  if (admissionItemId) nextConfig.admissionItemId = admissionItemId
  else delete nextConfig.admissionItemId
  if (!admissionItemId) delete nextConfig.admissionAmount

  const pumpOutputItemId = normalizeKnownLiquidItemId(nextConfig.pumpOutputItemId)
  if (pumpOutputItemId) nextConfig.pumpOutputItemId = pumpOutputItemId
  else delete nextConfig.pumpOutputItemId

  const preloadInputs = sanitizePreloadEntries(nextConfig.preloadInputs)
  if (preloadInputs.length > 0) nextConfig.preloadInputs = preloadInputs
  else delete nextConfig.preloadInputs

  const preloadInputItemId = normalizeKnownItemId(nextConfig.preloadInputItemId)
  const preloadInputAmount = preloadInputItemId ? normalizePositiveAmount(nextConfig.preloadInputAmount) : undefined
  if (preloadInputItemId && preloadInputAmount !== undefined) {
    nextConfig.preloadInputItemId = preloadInputItemId
    nextConfig.preloadInputAmount = preloadInputAmount
  } else {
    delete nextConfig.preloadInputItemId
    delete nextConfig.preloadInputAmount
  }

  const storageSlots = sanitizeStorageSlots(nextConfig.storageSlots)
  if (storageSlots.length > 0) nextConfig.storageSlots = storageSlots
  else delete nextConfig.storageSlots

  const storagePreloadInputs = sanitizePreloadEntries(nextConfig.storagePreloadInputs)
  if (storagePreloadInputs.length > 0) nextConfig.storagePreloadInputs = storagePreloadInputs
  else delete nextConfig.storagePreloadInputs

  const reactorPool = sanitizeReactorPoolConfig(nextConfig.reactorPool)
  if (reactorPool) nextConfig.reactorPool = reactorPool
  else delete nextConfig.reactorPool

  const hasPickupOutputConfig = Boolean(nextConfig.protocolHubOutputs?.some((entry) => entry.portId === PICKUP_OUTPUT_PORT_ID))
  if (!pickupItemId && !hasPickupOutputConfig) {
    delete nextConfig.pickupIgnoreInventory
  }

  return nextConfig
}

export function migrateDeviceConfigToV1(config: DeviceConfig, deviceTypeId?: DeviceInstance['typeId']): DeviceConfig {
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

  return sanitizeDeviceConfigUnknownItems(nextConfig, deviceTypeId)
}

function migrateLayoutToV1(layout: LayoutState): LayoutState {
  return {
    ...layout,
    devices: layout.devices.flatMap((device) => {
      const normalizedTypeId = normalizeKnownDeviceTypeId(device.typeId)
      if (!normalizedTypeId) return []
      return [
        {
          ...device,
          typeId: normalizedTypeId,
          config: migrateDeviceConfigToV1(device.config ?? {}, normalizedTypeId),
        },
      ]
    }),
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

export function normalizeLayoutHistoryByBaseStorage(rawValue: LayoutHistoryByBaseStorage): LayoutHistoryByBaseStorage {
  const candidate = rawValue as unknown as LayoutHistoryByBaseStorage | undefined | null

  if (!candidate || typeof candidate !== 'object') {
    return { version: APP_VERSION, historiesByBase: {} }
  }

  if (candidate.version !== APP_VERSION) {
    return { version: APP_VERSION, historiesByBase: {} }
  }

  if (!candidate.historiesByBase || typeof candidate.historiesByBase !== 'object') {
    return { version: APP_VERSION, historiesByBase: {} }
  }

  const normalizedHistories: Partial<Record<BaseId, LayoutHistoryEntryStorage>> = {}
  for (const [baseId, entry] of Object.entries(candidate.historiesByBase)) {
    if (!entry || typeof entry !== 'object') continue
    normalizedHistories[baseId as BaseId] = {
      past: Array.isArray(entry.past) ? entry.past.map((layout) => migrateLayoutToV1(layout)) : [],
      future: Array.isArray(entry.future) ? entry.future.map((layout) => migrateLayoutToV1(layout)) : [],
    }
  }

  return {
    version: APP_VERSION,
    historiesByBase: normalizedHistories,
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
          const normalizedTypeId = normalizeKnownDeviceTypeId(device.typeId)
          if (!normalizedTypeId) return null
          if (typeof device.rotation !== 'number') return null
          if (!device.origin || typeof device.origin !== 'object') return null
          if (typeof device.origin.x !== 'number' || typeof device.origin.y !== 'number') return null

          return {
            typeId: normalizedTypeId,
            rotation: device.rotation,
            origin: { x: device.origin.x, y: device.origin.y },
            config: migrateDeviceConfigToV1((device.config ?? {}) as DeviceConfig, normalizedTypeId),
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
