import { ITEMS } from '../../domain/registry'
import type { ItemId } from '../../domain/types'
import { getItemLabel, type Language } from '../../i18n'
import type { ItemPickerFilter, ItemPickerState } from './itemPicker.types'

const RECENT_ITEMS_SINGLE_ROW_COUNT = 8

type ItemPickerDialogProps = {
  itemPickerState: ItemPickerState
  pickerSelectedItemId: ItemId | undefined
  recentItemIds: ItemId[]
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
  recentItemIds,
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

  const filteredItemById = new Map(filteredItems.map((item) => [item.id, item]))
  const filteredItemIdSet = new Set(filteredItems.map((item) => item.id))
  const recentItems = recentItemIds
    .filter((itemId) => filteredItemIdSet.has(itemId))
    .map((itemId) => filteredItemById.get(itemId))
    .filter((item): item is (typeof filteredItems)[number] => Boolean(item))
    .slice(0, RECENT_ITEMS_SINGLE_ROW_COUNT)

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
            : itemPickerState.kind === 'protocolHubOutput'
              ? t('detail.protocolHubOutputDialogTitle', { index: itemPickerState.portIndex + 1 })
            : itemPickerState.kind === 'pumpOutput'
              ? t('detail.pumpOutputDialogTitle')
            : itemPickerState.kind === 'storageSlotPinned'
              ? t('detail.storageSlotPinnedDialogTitle', { index: itemPickerState.slotIndex + 1 })
            : itemPickerState.kind === 'storageSlotPreload'
              ? t('detail.storageSlotPreloadDialogTitle', { index: itemPickerState.slotIndex + 1 })
              : t('detail.preloadDialogTitle', { index: itemPickerState.slotIndex + 1 })}
        </div>
        <div className="pickup-item-groups">
          <section className="pickup-item-group">
            <div className="pickup-item-group-title">{t('detail.itemPickerRecentGroup')}</div>
            <div className="pickup-item-list pickup-item-list--recent">
              {recentItems.map((item) => (
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
          </section>

          <section className="pickup-item-group">
            <div className="pickup-item-group-title">{t('detail.itemPickerAllGroup')}</div>
            <div className="pickup-item-list pickup-item-list--all">
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
          </section>
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
