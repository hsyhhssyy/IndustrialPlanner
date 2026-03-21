const SETTINGS_STORAGE_KEY = 'settings'
export const LAYOUT_HISTORY_STORAGE_KEY = 'stage6-layout-history-by-base'

const LAYOUT_HISTORY_LIMIT_MIN = 5
const LAYOUT_HISTORY_LIMIT_DEFAULT = 10
const LAYOUT_HISTORY_LIMIT_MAX = 100
const LAYOUT_HISTORY_LIMIT_INFINITE = -1
const MIN_LAYOUT_HISTORY_ENTRIES = 4
const MAX_LAYOUT_HISTORY_STORAGE_CHARS = 1_500_000

type LayoutHistoryEntryLike = {
  past: unknown[]
  future: unknown[]
}

type LayoutHistoryStorageLike = {
  version: string
  historiesByBase: Record<string, LayoutHistoryEntryLike>
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function normalizeHistoryEntry(entry: unknown): LayoutHistoryEntryLike {
  if (!entry || typeof entry !== 'object') {
    return { past: [], future: [] }
  }

  const candidate = entry as { past?: unknown; future?: unknown }
  return {
    past: Array.isArray(candidate.past) ? candidate.past : [],
    future: Array.isArray(candidate.future) ? candidate.future : [],
  }
}

function normalizeLayoutHistoryStorage(value: unknown): LayoutHistoryStorageLike {
  if (!value || typeof value !== 'object') {
    return { version: '1.0', historiesByBase: {} }
  }

  const candidate = value as { version?: unknown; historiesByBase?: unknown }
  const incomingHistories = candidate.historiesByBase
  const historiesByBase = incomingHistories && typeof incomingHistories === 'object'
    ? Object.fromEntries(
        Object.entries(incomingHistories).map(([baseId, entry]) => [baseId, normalizeHistoryEntry(entry)]),
      )
    : {}

  return {
    version: typeof candidate.version === 'string' ? candidate.version : '1.0',
    historiesByBase,
  }
}

function getMaxHistoryEntryCount(storage: LayoutHistoryStorageLike) {
  return Math.max(
    0,
    ...Object.values(storage.historiesByBase).flatMap((entry) => [entry.past.length, entry.future.length]),
  )
}

function readConfiguredHistoryEntryLimit(): number | null {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return LAYOUT_HISTORY_LIMIT_DEFAULT
    const parsed = JSON.parse(raw) as { layoutHistoryLimit?: unknown }
    if (!Number.isFinite(parsed.layoutHistoryLimit)) return LAYOUT_HISTORY_LIMIT_DEFAULT
    const normalized = Math.round(Number(parsed.layoutHistoryLimit))
    if (normalized === LAYOUT_HISTORY_LIMIT_INFINITE) return null
    return clamp(normalized, LAYOUT_HISTORY_LIMIT_MIN, LAYOUT_HISTORY_LIMIT_MAX)
  } catch {
    return LAYOUT_HISTORY_LIMIT_DEFAULT
  }
}

export function isQuotaExceededError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: unknown; code?: unknown }
  return candidate.name === 'QuotaExceededError' || candidate.name === 'NS_ERROR_DOM_QUOTA_REACHED' || candidate.code === 22 || candidate.code === 1014
}

export function trimLayoutHistoryEntry<T extends LayoutHistoryEntryLike>(entry: T, maxEntries: number | null): T {
  if (maxEntries === null) {
    return entry
  }

  return {
    ...entry,
    past: entry.past.slice(-maxEntries),
    future: entry.future.slice(0, maxEntries),
  }
}

export function compactLayoutHistoryStorage<T extends LayoutHistoryStorageLike>(storage: T, historyEntryLimit?: number | null): T {
  const baseEntries = Object.entries(storage.historiesByBase)

  const buildStorage = (maxEntries: number | null, dropFuture: boolean): T => ({
    ...storage,
    historiesByBase: Object.fromEntries(
      baseEntries.map(([baseId, entry]) => {
        const trimmed = trimLayoutHistoryEntry(entry, maxEntries)
        return [
          baseId,
          dropFuture
            ? {
                past: trimmed.past,
                future: [],
              }
            : trimmed,
        ]
      }),
    ),
  })

  let maxEntries = historyEntryLimit === undefined ? readConfiguredHistoryEntryLimit() : historyEntryLimit
  if (maxEntries === null) {
    maxEntries = getMaxHistoryEntryCount(storage)
  }

  let compacted = buildStorage(maxEntries, false)

  while (JSON.stringify(compacted).length > MAX_LAYOUT_HISTORY_STORAGE_CHARS && maxEntries > MIN_LAYOUT_HISTORY_ENTRIES) {
    maxEntries = Math.max(MIN_LAYOUT_HISTORY_ENTRIES, Math.floor(maxEntries / 2))
    compacted = buildStorage(maxEntries, false)
  }

  if (JSON.stringify(compacted).length <= MAX_LAYOUT_HISTORY_STORAGE_CHARS) {
    return compacted
  }

  compacted = buildStorage(maxEntries, true)
  while (JSON.stringify(compacted).length > MAX_LAYOUT_HISTORY_STORAGE_CHARS && maxEntries > MIN_LAYOUT_HISTORY_ENTRIES) {
    maxEntries = Math.max(MIN_LAYOUT_HISTORY_ENTRIES, Math.floor(maxEntries / 2))
    compacted = buildStorage(maxEntries, true)
  }

  return compacted
}

export function reduceHistoryStorageOnPersistError<T extends LayoutHistoryStorageLike>(storage: T, historyEntryLimit?: number | null): T | undefined {
  const baseEntries = Object.entries(storage.historiesByBase)
  if (baseEntries.length === 0) return undefined

  const nextStorage = compactLayoutHistoryStorage({
    ...storage,
    historiesByBase: Object.fromEntries(
      baseEntries.flatMap(([baseId, entry]) => {
        if (entry.past.length === 0 && entry.future.length === 0) {
          return [[baseId, entry] as const]
        }

        const nextPastLength = entry.past.length <= 1 ? 0 : Math.floor(entry.past.length / 2)
        const nextEntry = {
          past: entry.past.slice(-nextPastLength),
          future: [],
        }

        // 最坏情况下需要允许历史完全清空，否则单条超大快照会让所有其他 localStorage 写入都永久失败。
        if (nextEntry.past.length === 0 && nextEntry.future.length === 0) {
          return []
        }

        return [[baseId, nextEntry] as const]
      }),
    ),
  } as T, historyEntryLimit)

  if (JSON.stringify(nextStorage) === JSON.stringify(storage)) {
    return undefined
  }

  return nextStorage
}

export function recoverLocalStorageQuotaByCompactingHistory(historyEntryLimit?: number | null) {
  if (typeof localStorage === 'undefined') return false

  let rawHistory: string | null = null
  try {
    rawHistory = localStorage.getItem(LAYOUT_HISTORY_STORAGE_KEY)
  } catch {
    return false
  }

  if (!rawHistory) return false

  let nextStorage: LayoutHistoryStorageLike
  try {
    nextStorage = compactLayoutHistoryStorage(normalizeLayoutHistoryStorage(JSON.parse(rawHistory)), historyEntryLimit)
  } catch {
    return false
  }

  while (true) {
    const nextSerialized = JSON.stringify(nextStorage)
    if (nextSerialized === rawHistory) {
      const reduced = reduceHistoryStorageOnPersistError(nextStorage, historyEntryLimit)
      if (!reduced) return false
      nextStorage = reduced
      continue
    }

    try {
      localStorage.setItem(LAYOUT_HISTORY_STORAGE_KEY, nextSerialized)
      return true
    } catch (error) {
      if (!isQuotaExceededError(error)) {
        return false
      }
      const reduced = reduceHistoryStorageOnPersistError(nextStorage, historyEntryLimit)
      if (!reduced) return false
      rawHistory = nextSerialized
      nextStorage = reduced
    }
  }
}

export function setLocalStorageItemWithRecovery(key: string, serializedValue: string, historyEntryLimit?: number | null) {
  try {
    localStorage.setItem(key, serializedValue)
    return
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      throw error
    }
    const recovered = recoverLocalStorageQuotaByCompactingHistory(historyEntryLimit)
    if (!recovered) {
      throw error
    }
    localStorage.setItem(key, serializedValue)
  }
}

export function trySetLocalStorageItemWithRecovery(key: string, serializedValue: string, historyEntryLimit?: number | null) {
  try {
    setLocalStorageItemWithRecovery(key, serializedValue, historyEntryLimit)
    return true
  } catch (error) {
    throw error
  }
}