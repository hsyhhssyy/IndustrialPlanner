import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'

export type DialogVariant = 'info' | 'success' | 'warning' | 'error'

export interface DialogOptions {
  title?: string
  confirmText?: string
  cancelText?: string
  closeText?: string
  variant?: DialogVariant
}

export interface NonBlockingAlertOptions extends DialogOptions {
}

interface BlockingDialogRequest {
  id: number
  kind: 'alert' | 'confirm'
  message: string
  options: DialogOptions
  resolve: (result: boolean) => void
}

interface NonBlockingAlertItem {
  id: number
  message: string
  options: NonBlockingAlertOptions
}

type DialogListener =
  | {
      type: 'blocking'
      request: BlockingDialogRequest
    }
  | {
      type: 'non-blocking-alert'
      item: NonBlockingAlertItem
    }

const listeners = new Set<(event: DialogListener) => void>()
let dialogSeq = 0

function emit(event: DialogListener) {
  for (const listener of listeners) listener(event)
}

function subscribe(listener: (event: DialogListener) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function dialogConfirm(message: string, options: DialogOptions = {}) {
  return new Promise<boolean>((resolve) => {
    emit({
      type: 'blocking',
      request: {
        id: ++dialogSeq,
        kind: 'confirm',
        message,
        options,
        resolve,
      },
    })
  })
}

export function dialogAlertBlocking(message: string, options: DialogOptions = {}) {
  return new Promise<void>((resolve) => {
    emit({
      type: 'blocking',
      request: {
        id: ++dialogSeq,
        kind: 'alert',
        message,
        options,
        resolve: () => resolve(),
      },
    })
  })
}

export function dialogAlertNonBlocking(message: string, options: NonBlockingAlertOptions = {}) {
  emit({
    type: 'non-blocking-alert',
    item: {
      id: ++dialogSeq,
      message,
      options,
    },
  })
}

interface DialogContextValue {
  confirm: (message: string, options?: DialogOptions) => Promise<boolean>
  alertBlocking: (message: string, options?: DialogOptions) => Promise<void>
  alertNonBlocking: (message: string, options?: NonBlockingAlertOptions) => void
}

const DialogContext = createContext<DialogContextValue>({
  confirm: dialogConfirm,
  alertBlocking: dialogAlertBlocking,
  alertNonBlocking: dialogAlertNonBlocking,
})

export function useDialog() {
  return useContext(DialogContext)
}

function resolveVariantClass(variant: DialogVariant | undefined) {
  if (variant === 'success') return 'global-dialog--success'
  if (variant === 'warning') return 'global-dialog--warning'
  if (variant === 'error') return 'global-dialog--error'
  return 'global-dialog--info'
}

export function DialogProvider({ children }: PropsWithChildren) {
  const [blockingQueue, setBlockingQueue] = useState<BlockingDialogRequest[]>([])
  const [activeBlocking, setActiveBlocking] = useState<BlockingDialogRequest | null>(null)
  const [nonBlockingAlerts, setNonBlockingAlerts] = useState<NonBlockingAlertItem[]>([])

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === 'blocking') {
        setBlockingQueue((current) => [...current, event.request])
        return
      }
      setNonBlockingAlerts((current) => [...current, event.item])
    })
  }, [])

  useEffect(() => {
    if (activeBlocking || blockingQueue.length === 0) return
    setActiveBlocking(blockingQueue[0])
    setBlockingQueue((current) => current.slice(1))
  }, [activeBlocking, blockingQueue])

  const contextValue = useMemo<DialogContextValue>(
    () => ({
      confirm: dialogConfirm,
      alertBlocking: dialogAlertBlocking,
      alertNonBlocking: dialogAlertNonBlocking,
    }),
    [],
  )

  const closeBlocking = (result: boolean) => {
    if (!activeBlocking) return
    activeBlocking.resolve(result)
    setActiveBlocking(null)
  }

  return (
    <DialogContext.Provider value={contextValue}>
      {children}

      {activeBlocking && (
        <div className="global-dialog-backdrop" role="presentation">
          <div className={`global-dialog ${resolveVariantClass(activeBlocking.options.variant)}`} role="dialog" aria-modal="true">
            {activeBlocking.options.title && <div className="global-dialog-title">{activeBlocking.options.title}</div>}
            <div className="global-dialog-message">{activeBlocking.message}</div>
            <div className="global-dialog-actions">
              {activeBlocking.kind === 'confirm' && (
                <button className="global-dialog-btn" onClick={() => closeBlocking(false)}>
                  {activeBlocking.options.cancelText ?? 'Cancel'}
                </button>
              )}
              <button className="global-dialog-btn primary" onClick={() => closeBlocking(true)}>
                {activeBlocking.options.confirmText ?? activeBlocking.options.closeText ?? 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}

      {nonBlockingAlerts.length > 0 && (
        <div className="global-dialog-floating-layer" role="region" aria-live="polite">
          {nonBlockingAlerts.map((item) => (
            <div key={item.id} className={`global-dialog floating ${resolveVariantClass(item.options.variant)}`} role="alertdialog" aria-modal="false">
              {item.options.title && <div className="global-dialog-title">{item.options.title}</div>}
              <div className="global-dialog-message">{item.message}</div>
              <div className="global-dialog-actions">
                <button
                  className="global-dialog-btn primary"
                  onClick={() => {
                    setNonBlockingAlerts((current) => current.filter((entry) => entry.id !== item.id))
                  }}
                >
                  {item.options.closeText ?? item.options.confirmText ?? 'OK'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </DialogContext.Provider>
  )
}
