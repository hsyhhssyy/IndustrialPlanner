import { useEffect, useState } from 'react'

export function usePersistentState<T>(key: string, initial: T, normalize?: (value: T) => T) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      const parsed = raw ? (JSON.parse(raw) as T) : initial
      return normalize ? normalize(parsed) : parsed
    } catch {
      return normalize ? normalize(initial) : initial
    }
  })

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state))
  }, [key, state])

  return [state, setState] as const
}
