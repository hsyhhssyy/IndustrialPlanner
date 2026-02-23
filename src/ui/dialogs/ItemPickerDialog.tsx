import { ITEMS } from '../../domain/registry'
import type { ItemId } from '../../domain/types'
import { getItemLabel, type Language } from '../../i18n'

type ItemPickerState =
  | { kind: 'pickup'; deviceInstanceId: string }
  | { kind: 'preload'; deviceInstanceId: string; slotIndex: number }

type ItemPickerDialogProps = {
  itemPickerState: ItemPickerState
  pickerSelectedItemId: ItemId | undefined
  pickerDisabledItemIds: ReadonlySet<ItemId>
  language: Language
  t: (key: string, params?: Record<string, string | number>) => string
  getItemIconPath: (itemId: ItemId) => string
  onClose: () => void
  onSelectItem: (itemId: ItemId | null) => void
}

export function ItemPickerDialog({
  itemPickerState,
  pickerSelectedItemId,
  pickerDisabledItemIds,
  language,
  t,
  getItemIconPath,
  onClose,
  onSelectItem,
}: ItemPickerDialogProps) {
  return (
    <div className="global-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="global-dialog pickup-item-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('detail.itemPickerTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="global-dialog-title">
          {itemPickerState.kind === 'pickup'
            ? t('detail.pickupDialogTitle')
            : t('detail.preloadDialogTitle', { index: itemPickerState.slotIndex + 1 })}
        </div>
        <div className="pickup-item-list">
          <button
            type="button"
            className={`pickup-item-option ${!pickerSelectedItemId ? 'active' : ''}`}
            onClick={() => {
              onSelectItem(null)
              onClose()
            }}
          >
            <span className="pickup-item-option-icon pickup-item-option-icon--empty">?</span>
            <span>{t('detail.unselected')}</span>
          </button>
          {ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`pickup-item-option ${pickerSelectedItemId === item.id ? 'active' : ''}`}
              disabled={itemPickerState.kind === 'preload' && pickerDisabledItemIds.has(item.id)}
              onClick={() => {
                onSelectItem(item.id)
                onClose()
              }}
            >
              <img className="pickup-item-option-icon" src={getItemIconPath(item.id)} alt="" aria-hidden="true" draggable={false} />
              <span>{getItemLabel(language, item.id)}</span>
            </button>
          ))}
        </div>
        <div className="global-dialog-actions">
          <button className="global-dialog-btn" onClick={onClose}>
            {t('dialog.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
