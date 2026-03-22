import { trySetLocalStorageItemWithRecovery } from './localStorageRecovery'

export function readLocalStorageJson<T>(key: string): T | null {
  if (typeof localStorage === 'undefined') {
    return null
  }

  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function readLocalStorageJsonWithFallback<T>(key: string, fallback: T, normalize?: (value: T) => T): T {
  const parsed = readLocalStorageJson<T>(key)
  if (parsed === null) {
    return normalize ? normalize(fallback) : fallback
  }
  return normalize ? normalize(parsed) : parsed
}

export function writeLocalStorageJsonWithRecovery(key: string, value: unknown, historyEntryLimit?: number | null) {
  trySetLocalStorageItemWithRecovery(key, JSON.stringify(value), historyEntryLimit)
}