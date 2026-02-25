import { ITEMS } from '../../domain/registry'
import type { ItemId } from '../../domain/types'
import { getItemLabel, type Language } from '../../i18n'

type ItemPickerState =
  | { kind: 'pickup'; deviceInstanceId: string }
  | { kind: 'pumpOutput'; deviceInstanceId: string }
  | { kind: 'preload'; deviceInstanceId: string; slotIndex: number }

type ItemPickerFilter = {
  allowedTypes?: Array<'solid' | 'liquid'>
  requiredTags?: string[]
  allowedItemIds?: ReadonlySet<ItemId>
}

type ItemPickerDialogProps = {
  itemPickerState: ItemPickerState
  pickerSelectedItemId: ItemId | undefined
  pickerDisabledItemIds: ReadonlySet<ItemId>
  pickerFilter?: ItemPickerFilter
  pickerAllowsEmpty?: boolean
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
  pickerFilter,
  pickerAllowsEmpty = true,
  language,
  t,
  getItemIconPath,
  onClose,
  onSelectItem,
}: ItemPickerDialogProps) {
  const filteredItems = ITEMS.filter((item) => {
    if (pickerFilter?.allowedTypes && pickerFilter.allowedTypes.length > 0 && !pickerFilter.allowedTypes.includes(item.type)) {
      return false
    }
    if (pickerFilter?.requiredTags && pickerFilter.requiredTags.length > 0) {
      const itemTags = item.tags ?? []
      if (!pickerFilter.requiredTags.some((tag) => itemTags.includes(tag))) return false
    }
    if (pickerFilter?.allowedItemIds && !pickerFilter.allowedItemIds.has(item.id)) {
      return false
    }
    return true
  })

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
            : itemPickerState.kind === 'pumpOutput'
              ? t('detail.pumpOutputDialogTitle')
              : t('detail.preloadDialogTitle', { index: itemPickerState.slotIndex + 1 })}
        </div>
        <div className="pickup-item-list">
          {pickerAllowsEmpty ? (
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
          ) : null}
          {filteredItems.map((item) => (
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
