import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'

export type ToastVariant = 'info' | 'success' | 'warning' | 'error'

export interface ToastOptions {
  durationMs?: number
  variant?: ToastVariant
}

interface ToastMessage {
  id: number
  text: string
  durationMs: number
  variant: ToastVariant
}

type ToastListener = (message: ToastMessage) => void

const DEFAULT_DURATION_MS = 2000
const listeners = new Set<ToastListener>()
let toastSeq = 0

function emitToast(message: ToastMessage) {
  for (const listener of listeners) listener(message)
}

export function showToast(text: string, options: ToastOptions = {}) {
  const durationMs = Math.max(200, options.durationMs ?? DEFAULT_DURATION_MS)
  const variant = options.variant ?? 'info'
  emitToast({
    id: ++toastSeq,
    text,
    durationMs,
    variant,
  })
}

function subscribeToast(listener: ToastListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

interface ToastContextValue {
  show: (text: string, options?: ToastOptions) => void
}

const ToastContext = createContext<ToastContextValue>({
  show: showToast,
})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: PropsWithChildren) {
  const [queue, setQueue] = useState<ToastMessage[]>([])
  const [active, setActive] = useState<ToastMessage | null>(null)

  useEffect(() => {
    return subscribeToast((message) => {
      setQueue((current) => [...current, message])
    })
  }, [])

  useEffect(() => {
    if (active || queue.length === 0) return
    setActive(queue[0])
    setQueue((current) => current.slice(1))
  }, [active, queue])

  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => {
      setActive(null)
    }, active.durationMs)
    return () => window.clearTimeout(timer)
  }, [active])

  const value = useMemo<ToastContextValue>(
    () => ({
      show: showToast,
    }),
    [],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      {active && (
        <div className={`global-toast global-toast--${active.variant}`} role="status" aria-live="polite">
          {active.text}
        </div>
      )}
    </ToastContext.Provider>
  )
}
