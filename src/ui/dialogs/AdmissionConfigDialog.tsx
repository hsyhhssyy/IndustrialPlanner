import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { DeviceInstance, ItemId } from '../../domain/types'
import { getItemLabel, type Language } from '../../i18n'
import { ItemPickerDialog } from './ItemPickerDialog'

type AdmissionConfigDialogProps = {
  device: DeviceInstance
  language: Language
  t: (key: string, params?: Record<string, string | number>) => string
  admissionItemId: ItemId | undefined
  admissionAmount: number | undefined
  passedCount: number
  recentItemIds: ItemId[]
  superRecipeEnabled: boolean
  getItemIconPath: (itemId: ItemId) => string
  onRememberItem: (itemId: ItemId) => void
  onClose: () => void
  onSave: (nextItemId: ItemId | undefined, nextAmount: number | undefined) => void
  onResetCount: () => void
}

export function AdmissionConfigDialog({
  device,
  language,
  t,
  admissionItemId,
  admissionAmount,
  passedCount,
  recentItemIds,
  superRecipeEnabled,
  getItemIconPath,
  onRememberItem,
  onClose,
  onSave,
  onResetCount,
}: AdmissionConfigDialogProps) {
  const [draftItemId, setDraftItemId] = useState<ItemId | ''>(admissionItemId ?? '')
  const [draftAmount, setDraftAmount] = useState(admissionAmount === undefined ? '' : String(admissionAmount))
  const [isPickerOpen, setIsPickerOpen] = useState(false)

  const trimmedAmount = draftAmount.trim()
  const parsedAmount = trimmedAmount.length === 0 ? undefined : Number.parseInt(trimmedAmount, 10)
  const amountIsValid =
    trimmedAmount.length === 0 || (parsedAmount !== undefined && /^\d+$/.test(trimmedAmount) && parsedAmount >= 0)

  return createPortal(
    <>
      <div className="global-dialog-backdrop" role="presentation" onClick={onClose}>
        <div
          className="global-dialog admission-config-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t('detail.admissionConfigDialogTitle')}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="global-dialog-title">{t('detail.admissionConfigDialogTitle')}</div>

          <div className="admission-config-body">
            <section className="admission-config-panel">
              <div className="admission-config-panel-header">
                <span>{t('detail.admissionItem')}</span>
                <button type="button" className="secondary-action-btn" onClick={() => setIsPickerOpen(true)}>
                  {t('detail.admissionOpenItemPicker')}
                </button>
              </div>
              <button type="button" className="picker-open-btn admission-config-picker-btn" onClick={() => setIsPickerOpen(true)}>
                <span className="pickup-picker-current">
                  {draftItemId ? (
                    <img
                      className="pickup-picker-current-icon"
                      src={getItemIconPath(draftItemId)}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                    />
                  ) : (
                    <span className="pickup-picker-current-icon pickup-picker-current-icon--empty">?</span>
                  )}
                  <span>{draftItemId ? getItemLabel(language, draftItemId) : t('detail.unselected')}</span>
                </span>
              </button>
            </section>

            <section className="admission-config-panel admission-config-panel--limit">
              <label className="admission-config-field">
                <span>{t('detail.admissionAmount')}</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={draftAmount}
                  placeholder={t('detail.admissionNoLimit')}
                  onChange={(event) => setDraftAmount(event.target.value)}
                />
                <small>{t('detail.admissionAmountHint')}</small>
              </label>
            </section>

            <section className="admission-config-panel admission-config-panel--runtime">
              <div className="admission-config-runtime-row">
                <div className="admission-config-counter">
                  <span>{t('detail.admissionPassedCount')}</span>
                  <strong>{passedCount}</strong>
                </div>
                <button type="button" className="secondary-action-btn" onClick={onResetCount}>
                  {t('detail.admissionResetCount')}
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
              disabled={!amountIsValid}
              onClick={() => {
                onSave(draftItemId || undefined, amountIsValid ? parsedAmount : undefined)
                onClose()
              }}
            >
              {t('dialog.ok')}
            </button>
          </div>
        </div>
      </div>

      {isPickerOpen && (
        <ItemPickerDialog
          itemPickerState={{ kind: 'admissionConfig' }}
          pickerSelectedItemId={draftItemId || undefined}
          recentItemIds={recentItemIds}
          pickerDisabledItemIds={new Set<ItemId>()}
          pickerFilter={{ allowedTypes: [device.typeId === 'item_pipe_admission' ? 'liquid' : 'solid'] }}
          pickerAllowsEmpty
          superRecipeEnabled={superRecipeEnabled}
          language={language}
          t={t}
          getItemIconPath={getItemIconPath}
          onClose={() => setIsPickerOpen(false)}
          onSelectItem={(itemId) => {
            setDraftItemId(itemId ?? '')
            if (itemId) {
              onRememberItem(itemId)
            }
          }}
        />
      )}
    </>,
    document.body,
  )
}