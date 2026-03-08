import { useMemo, useState } from 'react'
import { useAppContext } from '../../app/AppContext'
import { ITEMS } from '../../domain/registry'
import type { DeviceInstance, ItemId, StorageSlotConfigEntry } from '../../domain/types'
import { getItemLabel, type Language } from '../../i18n'
import { ItemPickerDialog } from './ItemPickerDialog'
import type { ItemPickerState } from './itemPicker.types'

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

type StorageSlotPickerState = Extract<ItemPickerState, { kind: 'storageSlotPinned' | 'storageSlotPreload' }>

const SLOT_CAPACITY = 50

function slotCountForDeviceType(typeId: DeviceInstance['typeId']) {
  if (typeId === 'item_port_mix_pool_1') return 5
  return 6
}

function clampAmount(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(SLOT_CAPACITY, Math.floor(value)))
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
    const preloadAmount = clampAmount(configSlot?.preloadAmount ?? legacyPreload?.amount ?? 0)

    return {
      slotIndex,
      mode,
      pinnedItemId,
      preloadItemId,
      preloadAmount,
    }
  })
}

function toFreeSlot(slot: EditableStorageSlot): EditableStorageSlot {
  return {
    ...slot,
    mode: 'free',
    preloadItemId: slot.preloadItemId ?? (slot.preloadAmount > 0 ? slot.pinnedItemId : null),
  }
}

function toPinnedSlot(slot: EditableStorageSlot): EditableStorageSlot {
  return {
    ...slot,
    mode: 'pinned',
    pinnedItemId: slot.pinnedItemId ?? slot.preloadItemId,
    preloadItemId: null,
  }
}

function getEffectiveItemId(slot: EditableStorageSlot) {
  return slot.mode === 'pinned' ? slot.pinnedItemId : slot.preloadItemId
}

function hasConfiguredContent(slot: EditableStorageSlot) {
  return slot.mode === 'pinned' || Boolean(getEffectiveItemId(slot))
}

export function StorageSlotConfigDialog({ device, language, t, getItemIconPath, onClose, onSave }: StorageSlotConfigDialogProps) {
  const {
    state: { superRecipeEnabled },
  } = useAppContext()
  const slotCount = slotCountForDeviceType(device.typeId)
  const [slots, setSlots] = useState<EditableStorageSlot[]>(() => buildEditableSlots(device, slotCount))
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(0)
  const [pickerState, setPickerState] = useState<StorageSlotPickerState | null>(null)
  const [recentItemIds, setRecentItemIds] = useState<ItemId[]>([])

  const pickerDisabledItemIds = useMemo<ReadonlySet<ItemId>>(() => new Set<ItemId>(), [])
  const solidItemIds = useMemo(() => new Set(ITEMS.filter((item) => item.type === 'solid').map((item) => item.id)), [])
  const selectedSlot = slots[selectedSlotIndex] ?? slots[0]
  const pinnedCount = useMemo(() => slots.filter((slot) => slot.mode === 'pinned').length, [slots])
  const configuredCount = useMemo(() => slots.filter((slot) => hasConfiguredContent(slot)).length, [slots])
  const preloadTotal = useMemo(() => slots.reduce((sum, slot) => sum + clampAmount(slot.preloadAmount), 0), [slots])

  const normalizedSlots = useMemo<StorageSlotConfigEntry[]>(() => {
    return slots
      .map((slot) => {
        const mode = slot.mode === 'pinned' ? 'pinned' : 'free'
        const pinnedItemId = mode === 'pinned' ? slot.pinnedItemId ?? undefined : undefined
        const normalizedPreloadItemId = mode === 'pinned' ? pinnedItemId : slot.preloadItemId ?? undefined
        const normalizedPreloadAmount = normalizedPreloadItemId ? clampAmount(slot.preloadAmount) : 0

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

  const pickerSelectedItemId = useMemo(() => {
    if (!pickerState) return undefined
    const targetSlot = slots[pickerState.slotIndex]
    if (!targetSlot) return undefined
    return pickerState.kind === 'storageSlotPinned' ? targetSlot.pinnedItemId ?? undefined : targetSlot.preloadItemId ?? undefined
  }, [pickerState, slots])

  const updateSlot = (slotIndex: number, updater: (slot: EditableStorageSlot) => EditableStorageSlot) => {
    setSlots((current) => current.map((slot) => (slot.slotIndex === slotIndex ? updater(slot) : slot)))
  }

  const setSlotMode = (slotIndex: number, nextMode: EditableStorageSlot['mode']) => {
    updateSlot(slotIndex, (slot) => (nextMode === 'pinned' ? toPinnedSlot(slot) : toFreeSlot(slot)))
  }

  const adjustSelectedAmount = (nextAmount: number) => {
    if (!selectedSlot) return
    updateSlot(selectedSlot.slotIndex, (slot) => ({ ...slot, preloadAmount: clampAmount(nextAmount) }))
  }

  const handlePickerSelect = (itemId: ItemId | null) => {
    if (!pickerState) return

    if (pickerState.kind === 'storageSlotPinned') {
      updateSlot(pickerState.slotIndex, (slot) => ({
        ...slot,
        pinnedItemId: itemId,
        preloadItemId: null,
        preloadAmount: itemId ? Math.max(1, slot.preloadAmount) : 0,
      }))
    } else {
      updateSlot(pickerState.slotIndex, (slot) => ({
        ...slot,
        preloadItemId: itemId,
        preloadAmount: itemId ? Math.max(1, slot.preloadAmount) : 0,
      }))
    }

    if (itemId) {
      setRecentItemIds((current) => [itemId, ...current.filter((existing) => existing !== itemId)].slice(0, 8))
    }
    setPickerState(null)
  }

  if (!selectedSlot) return null

  const selectedEffectiveItemId = getEffectiveItemId(selectedSlot)
  const selectedPinnedUnavailable = selectedSlot.mode === 'pinned' && !selectedSlot.pinnedItemId
  const amountDisabled = !selectedEffectiveItemId

  const renderPickerValue = (itemId: ItemId | null | undefined, emptyLabel: string) => (
    <span className="pickup-picker-current">
      {itemId ? (
        <img className="pickup-picker-current-icon" src={getItemIconPath(itemId)} alt="" aria-hidden="true" draggable={false} />
      ) : (
        <span className="pickup-picker-current-icon pickup-picker-current-icon--empty">?</span>
      )}
      <span>{itemId ? getItemLabel(language, itemId) : emptyLabel}</span>
    </span>
  )

  return (
    <>
      <div className="global-dialog-backdrop" role="presentation" onClick={onClose}>
        <div
          className="global-dialog storage-slot-config-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t('detail.storageSlotDialogTitle')}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="global-dialog-title">{t('detail.storageSlotDialogTitle')}</div>
          <div className="storage-slot-config-subtitle">{t('detail.storageSlotDialogHint', { slots: slotCount, cap: SLOT_CAPACITY })}</div>

          <div className="storage-slot-config-shell">
            <section className="storage-slot-config-stage">
              <div className="storage-slot-config-summary">
                <div className="storage-slot-summary-chip">
                  <strong>{configuredCount}</strong>
                  <span>{t('detail.storageSlotSummaryConfigured', { count: configuredCount, slots: slotCount })}</span>
                </div>
                <div className="storage-slot-summary-chip">
                  <strong>{pinnedCount}</strong>
                  <span>{t('detail.storageSlotSummaryPinned', { count: pinnedCount })}</span>
                </div>
                <div className="storage-slot-summary-chip">
                  <strong>{preloadTotal}</strong>
                  <span>{t('detail.storageSlotSummaryPreload', { total: preloadTotal, cap: slotCount * SLOT_CAPACITY })}</span>
                </div>
              </div>

              <div className="storage-slot-grid" role="list" aria-label={t('detail.storageSlotConfig')}>
                {slots.map((slot) => {
                  const effectiveItemId = getEffectiveItemId(slot)
                  const isSelected = slot.slotIndex === selectedSlot.slotIndex
                  const isPinned = slot.mode === 'pinned'
                  const fillPercent = Math.max(0, Math.min(100, (clampAmount(slot.preloadAmount) / SLOT_CAPACITY) * 100))

                  return (
                    <div
                      key={`storage-slot-config-${slot.slotIndex}`}
                      className={`storage-slot-card${isSelected ? ' is-selected' : ''}${isPinned ? ' is-pinned' : ' is-free'}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedSlotIndex(slot.slotIndex)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        setSelectedSlotIndex(slot.slotIndex)
                      }}
                    >
                      <div className="storage-slot-card-header">
                        <div className="storage-slot-card-title">{t('detail.preloadSlot', { index: slot.slotIndex + 1 })}</div>
                        <button
                          type="button"
                          className={`storage-slot-lock-btn ${isPinned ? 'is-active' : ''}`}
                          aria-label={t(isPinned ? 'detail.storageSlotUnlock' : 'detail.storageSlotLock')}
                          title={t(isPinned ? 'detail.storageSlotUnlock' : 'detail.storageSlotLock')}
                          onClick={(event) => {
                            event.stopPropagation()
                            setSlotMode(slot.slotIndex, isPinned ? 'free' : 'pinned')
                          }}
                        >
                          {isPinned ? '🔒' : '🔓'}
                        </button>
                      </div>

                      <div className="storage-slot-card-body">
                        {effectiveItemId ? (
                          <img className="storage-slot-card-icon" src={getItemIconPath(effectiveItemId)} alt="" aria-hidden="true" draggable={false} />
                        ) : (
                          <div className="storage-slot-card-icon storage-slot-card-icon--empty">?</div>
                        )}
                      </div>

                      <div className="storage-slot-card-footer">
                        <div className="storage-slot-card-amount">
                          {clampAmount(slot.preloadAmount)} / {SLOT_CAPACITY}
                        </div>
                        <div className="storage-slot-card-bar" aria-hidden="true">
                          <span style={{ width: `${fillPercent}%` }} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="storage-slot-stage-actions">
                <button
                  type="button"
                  className="global-dialog-btn"
                  onClick={() => {
                    setSlots((current) => current.map((slot) => toFreeSlot(slot)))
                  }}
                >
                  {t('detail.storageSlotUnlockAll')}
                </button>
                <button
                  type="button"
                  className="global-dialog-btn"
                  onClick={() => {
                    setSlots((current) =>
                      current.map((slot) => ({
                        ...slot,
                        mode: 'free',
                        pinnedItemId: null,
                        preloadItemId: null,
                        preloadAmount: 0,
                      })),
                    )
                  }}
                >
                  {t('detail.storageSlotClearAll')}
                </button>
              </div>
            </section>

            <section className="storage-slot-editor">
              <div className="storage-slot-editor-header">
                <div>
                  <div className="storage-slot-editor-kicker">{t('detail.storageSlotSelectionTitle', { index: selectedSlot.slotIndex + 1 })}</div>
                  <div className="storage-slot-editor-title">{selectedEffectiveItemId ? getItemLabel(language, selectedEffectiveItemId) : t('detail.storageSlotEmptyState')}</div>
                </div>
              </div>

              <div className="storage-slot-editor-preview">
                {selectedEffectiveItemId ? (
                  <img className="storage-slot-editor-preview-icon" src={getItemIconPath(selectedEffectiveItemId)} alt="" aria-hidden="true" draggable={false} />
                ) : (
                  <div className="storage-slot-editor-preview-icon storage-slot-editor-preview-icon--empty">?</div>
                )}
                <div className="storage-slot-editor-preview-meta">
                  <div>{selectedEffectiveItemId ? getItemLabel(language, selectedEffectiveItemId) : t('detail.storageSlotEmptyState')}</div>
                  <small>{t('detail.storageSlotAmountRange', { amount: clampAmount(selectedSlot.preloadAmount), cap: SLOT_CAPACITY })}</small>
                </div>
              </div>

              <button
                type="button"
                className={`storage-slot-lock-toggle ${selectedSlot.mode === 'pinned' ? 'is-active' : ''}`}
                onClick={() => setSlotMode(selectedSlot.slotIndex, selectedSlot.mode === 'pinned' ? 'free' : 'pinned')}
              >
                <span className="storage-slot-lock-toggle-icon" aria-hidden="true">{selectedSlot.mode === 'pinned' ? '🔒' : '🔓'}</span>
                <span>{t(selectedSlot.mode === 'pinned' ? 'detail.storageSlotUnlock' : 'detail.storageSlotLock')}</span>
              </button>

              <div className="storage-slot-editor-fields">
                <label className="storage-slot-config-field">
                  <span>{t('detail.storageSlotItem')}</span>
                  <button
                    type="button"
                    className="picker-open-btn storage-slot-picker-btn"
                    onClick={() =>
                      setPickerState({
                        kind: selectedSlot.mode === 'pinned' ? 'storageSlotPinned' : 'storageSlotPreload',
                        slotIndex: selectedSlot.slotIndex,
                      })
                    }
                  >
                    {selectedSlot.mode === 'pinned'
                      ? renderPickerValue(selectedSlot.pinnedItemId, t('detail.storageSlotSelectPinnedItem'))
                      : renderPickerValue(selectedSlot.preloadItemId, t('detail.storageSlotSelectPreloadItem'))}
                  </button>
                </label>

                <label className="storage-slot-config-field">
                  <span>{t('detail.storageSlotPreloadAmount')}</span>
                  <div className="storage-slot-amount-row">
                    <button type="button" className="storage-slot-step-btn" disabled={amountDisabled} onClick={() => adjustSelectedAmount(selectedSlot.preloadAmount - 1)}>
                      −
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={SLOT_CAPACITY}
                      step={1}
                      value={selectedSlot.preloadAmount}
                      disabled={amountDisabled}
                      onChange={(event) => {
                        const parsed = Number.parseInt(event.target.value, 10)
                        adjustSelectedAmount(Number.isFinite(parsed) ? parsed : 0)
                      }}
                    />
                    <button type="button" className="storage-slot-step-btn" disabled={amountDisabled} onClick={() => adjustSelectedAmount(selectedSlot.preloadAmount + 1)}>
                      +
                    </button>
                  </div>
                  <input
                    className="storage-slot-amount-slider"
                    type="range"
                    min={0}
                    max={SLOT_CAPACITY}
                    step={1}
                    value={selectedSlot.preloadAmount}
                    disabled={amountDisabled}
                    onChange={(event) => adjustSelectedAmount(Number.parseInt(event.target.value, 10))}
                  />
                  <small className="storage-slot-editor-note">{t('detail.storageSlotAmountRange', { amount: clampAmount(selectedSlot.preloadAmount), cap: SLOT_CAPACITY })}</small>
                </label>
              </div>

              {selectedSlot.mode === 'pinned' ? <div className="storage-slot-editor-note">{t('detail.storageSlotPinnedUsesBoundItem')}</div> : null}
              {selectedPinnedUnavailable ? <div className="storage-slot-editor-note is-warning">{t('detail.storageSlotPinnedHint')}</div> : null}

              <div className="storage-slot-editor-actions">
                <button
                  type="button"
                  className="global-dialog-btn"
                  disabled={amountDisabled}
                  onClick={() => adjustSelectedAmount(SLOT_CAPACITY)}
                >
                  {t('detail.storageSlotQuickFill')}
                </button>
                <button
                  type="button"
                  className="global-dialog-btn"
                  disabled={!selectedEffectiveItemId && selectedSlot.preloadAmount === 0}
                  onClick={() => {
                    updateSlot(selectedSlot.slotIndex, (slot) => {
                      if (slot.mode === 'pinned') {
                        return { ...slot, preloadAmount: 0 }
                      }
                      return { ...slot, preloadItemId: null, preloadAmount: 0 }
                    })
                  }}
                >
                  {t('detail.storageSlotQuickClearPreload')}
                </button>
                <button
                  type="button"
                  className="global-dialog-btn"
                  onClick={() => {
                    updateSlot(selectedSlot.slotIndex, () => ({
                      slotIndex: selectedSlot.slotIndex,
                      mode: 'free',
                      pinnedItemId: null,
                      preloadItemId: null,
                      preloadAmount: 0,
                    }))
                  }}
                >
                  {t('detail.storageSlotQuickReset')}
                </button>
              </div>
            </section>
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

      {pickerState ? (
        <ItemPickerDialog
          itemPickerState={pickerState}
          pickerSelectedItemId={pickerSelectedItemId}
          recentItemIds={recentItemIds}
          pickerDisabledItemIds={pickerDisabledItemIds}
          pickerFilter={{ allowedTypes: ['solid'], allowedItemIds: solidItemIds }}
          pickerAllowsEmpty={true}
          superRecipeEnabled={superRecipeEnabled}
          language={language}
          t={t}
          getItemIconPath={getItemIconPath}
          onClose={() => setPickerState(null)}
          onSelectItem={handlePickerSelect}
        />
      ) : null}
    </>
  )
}
