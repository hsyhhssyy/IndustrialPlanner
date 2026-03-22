import { useEffect, useMemo, useState } from 'react'
import { readLocalStorageJsonWithFallback, writeLocalStorageJsonWithRecovery } from './persistentStorage'

type PersistentStateOptions<T> = {
  normalize?: (value: T) => T
  onPersistError?: (value: T, error: unknown) => T | undefined
  quotaRecoveryHistoryLimit?: number | null
}

export function usePersistentState<T>(key: string, initial: T, normalizeOrOptions?: ((value: T) => T) | PersistentStateOptions<T>) {
  const options = useMemo<PersistentStateOptions<T>>(() => {
    if (typeof normalizeOrOptions === 'function') {
      return { normalize: normalizeOrOptions }
    }
    return normalizeOrOptions ?? {}
  }, [normalizeOrOptions])
  const normalize = options.normalize

  const [state, setState] = useState<T>(() => {
    return readLocalStorageJsonWithFallback(key, initial, normalize)
  })

  useEffect(() => {
    try {
      writeLocalStorageJsonWithRecovery(key, state, options.quotaRecoveryHistoryLimit)
    } catch (error) {
      // 持久化失败时不能让整个应用崩溃，尤其是历史快照这类大对象达到浏览器配额时。
      console.warn(`Failed to persist localStorage key: ${key}`, error)
      const recoveredState = options.onPersistError?.(state, error)
      if (recoveredState !== undefined && recoveredState !== state) {
        setState(recoveredState)
      }
    }
  }, [key, options, state])

  return [state, setState] as const
}
