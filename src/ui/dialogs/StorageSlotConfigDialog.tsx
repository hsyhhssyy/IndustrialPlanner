import { useMemo, useState } from 'react'
import { ITEMS } from '../../domain/registry'
import type { DeviceInstance, ItemId, StorageSlotConfigEntry } from '../../domain/types'
import { getItemLabel, type Language } from '../../i18n'

type EditableStorageSlot = {
  slotIndex: number
  mode: 'free' | 'pinned'
  pinnedItemId: ItemId | null
  preloadItemId: ItemId | null
  preloadAmount: number
}

type StorageSlotConfigDialogProps = {
  device: DeviceInstance
  language: Language
  t: (key: string, params?: Record<string, string | number>) => string
  getItemIconPath: (itemId: ItemId) => string
  onClose: () => void
  onSave: (slots: StorageSlotConfigEntry[]) => void
}

function slotCountForDeviceType(typeId: DeviceInstance['typeId']) {
  if (typeId === 'item_port_mix_pool_1') return 5
  return 6
}

function buildEditableSlots(device: DeviceInstance, slotCount: number): EditableStorageSlot[] {
  const bySlot = new Map((device.config.storageSlots ?? []).map((entry) => [entry.slotIndex, entry]))
  const legacyPreloadsBySlot = new Map((device.config.storagePreloadInputs ?? []).map((entry) => [entry.slotIndex, entry]))

  return Array.from({ length: slotCount }, (_, slotIndex) => {
    const configSlot = bySlot.get(slotIndex)
    const legacyPreload = legacyPreloadsBySlot.get(slotIndex)
    const mode = configSlot?.mode === 'pinned' ? 'pinned' : 'free'
    const pinnedItemId = configSlot?.pinnedItemId ?? null
    const preloadItemId = configSlot?.preloadItemId ?? legacyPreload?.itemId ?? null
    const preloadAmount = Math.max(0, Math.floor(configSlot?.preloadAmount ?? legacyPreload?.amount ?? 0))

    return {
      slotIndex,
      mode,
      pinnedItemId,
      preloadItemId,
      preloadAmount,
    }
  })
}

export function StorageSlotConfigDialog({ device, language, t, getItemIconPath, onClose, onSave }: StorageSlotConfigDialogProps) {
  const solidItems = useMemo(() => ITEMS.filter((item) => item.type === 'solid'), [])
  const slotCount = slotCountForDeviceType(device.typeId)
  const [slots, setSlots] = useState<EditableStorageSlot[]>(() => buildEditableSlots(device, slotCount))

  const normalizedSlots = useMemo<StorageSlotConfigEntry[]>(() => {
    return slots
      .map((slot) => {
        const mode = slot.mode === 'pinned' ? 'pinned' : 'free'
        const pinnedItemId = mode === 'pinned' ? slot.pinnedItemId ?? undefined : undefined
        const normalizedPreloadItemId =
          mode === 'pinned'
            ? pinnedItemId
            : slot.preloadItemId ?? undefined
        const normalizedPreloadAmount =
          normalizedPreloadItemId && Number.isFinite(slot.preloadAmount)
            ? Math.max(0, Math.floor(slot.preloadAmount))
            : 0

        const entry: StorageSlotConfigEntry = {
          slotIndex: slot.slotIndex,
          mode,
        }
        if (pinnedItemId) entry.pinnedItemId = pinnedItemId
        if (normalizedPreloadItemId && normalizedPreloadAmount > 0) {
          entry.preloadItemId = normalizedPreloadItemId
          entry.preloadAmount = normalizedPreloadAmount
        }
        return entry
      })
      .filter((slot) => {
        const hasPreload = Boolean(slot.preloadItemId) && (slot.preloadAmount ?? 0) > 0
        if (slot.mode === 'pinned') return true
        return hasPreload
      })
  }, [slots])

  return (
    <div className="global-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="global-dialog storage-slot-config-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('detail.storageSlotDialogTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="global-dialog-title">{t('detail.storageSlotDialogTitle')}</div>

        <div className="preload-slot-list storage-slot-config-list">
          {slots.map((slot) => {
            const slotPinnedUnavailable = slot.mode === 'pinned' && !slot.pinnedItemId
            const effectivePreloadItemId = slot.mode === 'pinned' ? slot.pinnedItemId : slot.preloadItemId
            return (
              <div key={`storage-slot-config-${slot.slotIndex}`} className="storage-slot-config-row">
                <div className="preload-slot-label">{t('detail.preloadSlot', { index: slot.slotIndex + 1 })}</div>

                <label className="storage-slot-config-field">
                  <span>{t('detail.storageSlotMode')}</span>
                  <select
                    value={slot.mode}
                    onChange={(event) => {
                      const nextMode = event.target.value === 'pinned' ? 'pinned' : 'free'
                      setSlots((current) =>
                        current.map((entry) =>
                          entry.slotIndex === slot.slotIndex
                            ? {
                                ...entry,
                                mode: nextMode,
                                preloadItemId: nextMode === 'pinned' ? null : entry.preloadItemId,
                              }
                            : entry,
                        ),
                      )
                    }}
                  >
                    <option value="free">{t('detail.storageSlotModeFree')}</option>
                    <option value="pinned">{t('detail.storageSlotModePinned')}</option>
                  </select>
                </label>

                <label className="storage-slot-config-field">
                  <span>{t('detail.storageSlotPinnedItem')}</span>
                  <select
                    value={slot.pinnedItemId ?? ''}
                    disabled={slot.mode !== 'pinned'}
                    onChange={(event) => {
                      const nextItemId = event.target.value ? (event.target.value as ItemId) : null
                      setSlots((current) =>
                        current.map((entry) =>
                          entry.slotIndex === slot.slotIndex
                            ? {
                                ...entry,
                                pinnedItemId: nextItemId,
                                preloadItemId: entry.mode === 'pinned' ? null : entry.preloadItemId,
                              }
                            : entry,
                        ),
                      )
                    }}
                  >
                    <option value="">{t('detail.unselected')}</option>
                    {solidItems.map((item) => (
                      <option key={`storage-slot-pin-${slot.slotIndex}-${item.id}`} value={item.id}>
                        {getItemLabel(language, item.id)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="storage-slot-config-field">
                  <span>{t('detail.storageSlotPreloadItem')}</span>
                  {slot.mode === 'pinned' ? (
                    <button type="button" className="picker-open-btn" disabled>
                      <span className="pickup-picker-current">
                        {effectivePreloadItemId ? (
                          <img
                            className="pickup-picker-current-icon"
                            src={getItemIconPath(effectivePreloadItemId)}
                            alt=""
                            aria-hidden="true"
                            draggable={false}
                          />
                        ) : (
                          <span className="pickup-picker-current-icon pickup-picker-current-icon--empty">?</span>
                        )}
                        <span>
                          {effectivePreloadItemId
                            ? getItemLabel(language, effectivePreloadItemId)
                            : t('detail.unselected')}
                        </span>
                      </span>
                    </button>
                  ) : (
                    <select
                      value={slot.preloadItemId ?? ''}
                      onChange={(event) => {
                        const nextItemId = event.target.value ? (event.target.value as ItemId) : null
                        setSlots((current) =>
                          current.map((entry) =>
                            entry.slotIndex === slot.slotIndex
                              ? {
                                  ...entry,
                                  preloadItemId: nextItemId,
                                  preloadAmount: nextItemId ? Math.max(1, entry.preloadAmount) : 0,
                                }
                              : entry,
                          ),
                        )
                      }}
                    >
                      <option value="">{t('detail.unselected')}</option>
                      {solidItems.map((item) => (
                        <option key={`storage-slot-preload-${slot.slotIndex}-${item.id}`} value={item.id}>
                          {getItemLabel(language, item.id)}
                        </option>
                      ))}
                    </select>
                  )}
                </label>

                <label className="storage-slot-config-field">
                  <span>{t('detail.storageSlotPreloadAmount')}</span>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    step={1}
                    value={slot.preloadAmount}
                    disabled={slot.mode === 'pinned' ? !slot.pinnedItemId : !slot.preloadItemId}
                    onChange={(event) => {
                      const parsed = Number.parseInt(event.target.value, 10)
                      const nextAmount = Number.isFinite(parsed) ? Math.max(0, Math.min(50, parsed)) : 0
                      setSlots((current) =>
                        current.map((entry) => (entry.slotIndex === slot.slotIndex ? { ...entry, preloadAmount: nextAmount } : entry)),
                      )
                    }}
                  />
                </label>

                {slotPinnedUnavailable && <small className="storage-slot-config-hint">{t('detail.storageSlotPinnedHint')}</small>}
              </div>
            )
          })}
        </div>

        <div className="global-dialog-actions">
          <button className="global-dialog-btn" onClick={onClose}>
            {t('dialog.cancel')}
          </button>
          <button
            className="global-dialog-btn primary"
            onClick={() => {
              onSave(normalizedSlots)
              onClose()
            }}
          >
            {t('dialog.ok')}
          </button>
        </div>
      </div>
    </div>
  )
}
