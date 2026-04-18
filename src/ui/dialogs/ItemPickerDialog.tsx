import { useState } from 'react'
import { match } from 'pinyin-pro'
import { usePersistentState } from '../../core/usePersistentState'
import { ITEMS } from '../../domain/registry'
import { isSuperRecipeItem, shouldShowSuperRecipeContent } from '../../domain/shared/superRecipeVisibility'
import type { ItemId } from '../../domain/types'
import { getItemLabel, type Language } from '../../i18n'
import type { ItemPickerFilter, ItemPickerState } from './itemPicker.types'
import type { ItemDef } from '../../domain/types'

const RECENT_ITEMS_SINGLE_ROW_COUNT = 8
const BOTTLED_LIQUID_TAG = '瓶装液体'
const HIDE_BOTTLED_LIQUIDS_STORAGE_KEY = 'stage1-item-picker-hide-bottled-liquids'
const ITEM_ID_COLLATOR = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
})

type ItemPickerDialogProps = {
  itemPickerState: ItemPickerState
  pickerSelectedItemId: ItemId | undefined
  recentItemIds: ItemId[]
  pickerDisabledItemIds: ReadonlySet<ItemId>
  pickerFilter?: ItemPickerFilter
  pickerAllowsEmpty?: boolean
  superRecipeEnabled: boolean
  language: Language
  t: (key: string, params?: Record<string, string | number>) => string
  getItemIconPath: (itemId: ItemId) => string
  onClose: () => void
  onSelectItem: (itemId: ItemId | null) => void
}

function isBottledLiquidItem(item: ItemDef) {
  return Boolean(item.tags?.includes(BOTTLED_LIQUID_TAG))
}

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase()
}

function compactSearchText(value: string) {
  return normalizeSearchText(value).replace(/[\s_-]+/g, '')
}

const ITEM_SEARCH_INDEX = ITEMS.map((item) => {
  const zhLabel = getItemLabel('zh-CN', item.id)
  const enLabel = getItemLabel('en-US', item.id)
  return {
    item,
    zhLabel,
    normalizedZhLabel: normalizeSearchText(zhLabel),
    normalizedEnLabel: normalizeSearchText(enLabel),
    compactEnLabel: compactSearchText(enLabel),
  }
})

function matchesItemSearch(
  entry: (typeof ITEM_SEARCH_INDEX)[number],
  normalizedSearchQuery: string,
  compactSearchQuery: string,
) {
  if (!normalizedSearchQuery) return true
  if (entry.normalizedZhLabel.includes(normalizedSearchQuery)) return true
  if (entry.normalizedEnLabel.includes(normalizedSearchQuery)) return true
  if (compactSearchQuery && entry.compactEnLabel.includes(compactSearchQuery)) return true
  if (!compactSearchQuery) return false
  return Boolean(match(entry.zhLabel, compactSearchQuery))
}

export function ItemPickerDialog({
  itemPickerState,
  pickerSelectedItemId,
  recentItemIds,
  pickerDisabledItemIds,
  pickerFilter,
  pickerAllowsEmpty = true,
  superRecipeEnabled,
  language,
  t,
  getItemIconPath,
  onClose,
  onSelectItem,
}: ItemPickerDialogProps) {
  const [hideBottledLiquids, setHideBottledLiquids] = usePersistentState(HIDE_BOTTLED_LIQUIDS_STORAGE_KEY, false)
  const [searchQuery, setSearchQuery] = useState('')

  const normalizedSearchQuery = normalizeSearchText(searchQuery)
  const compactSearchQuery = compactSearchText(searchQuery)
  const hasSearchQuery = normalizedSearchQuery.length > 0

  const dialogTitle =
    itemPickerState.kind === 'pickup'
      ? t('detail.pickupDialogTitle')
      : itemPickerState.kind === 'admission'
        ? t('detail.admissionDialogTitle')
      : itemPickerState.kind === 'admissionConfig'
        ? t('detail.admissionDialogTitle')
      : itemPickerState.kind === 'plannerTarget'
        ? t('detail.itemPickerTitle')
      : itemPickerState.kind === 'protocolHubOutput'
        ? t('detail.protocolHubOutputDialogTitle', { index: itemPickerState.portIndex + 1 })
      : itemPickerState.kind === 'pumpOutput'
        ? t('detail.pumpOutputDialogTitle')
      : itemPickerState.kind === 'reactorOutput'
        ? itemPickerState.output === 'solid'
          ? t('detail.reactorSolidOutputDialogTitle')
          : t('detail.reactorLiquidOutputDialogTitle', { index: itemPickerState.output === 'liquidA' ? 1 : 2 })
      : itemPickerState.kind === 'storageSlotPinned'
        ? t('detail.storageSlotPinnedDialogTitle', { index: itemPickerState.slotIndex + 1 })
      : itemPickerState.kind === 'storageSlotPreload'
        ? t('detail.storageSlotPreloadDialogTitle', { index: itemPickerState.slotIndex + 1 })
        : t('detail.preloadDialogTitle', { index: itemPickerState.slotIndex + 1 })

  const filteredItems = ITEM_SEARCH_INDEX.filter((entry) => {
    const { item } = entry
    if (!shouldShowSuperRecipeContent(superRecipeEnabled, isSuperRecipeItem(item))) {
      return false
    }
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
    if (hideBottledLiquids && isBottledLiquidItem(item)) {
      return false
    }
    if (!matchesItemSearch(entry, normalizedSearchQuery, compactSearchQuery)) {
      return false
    }
    return true
  })
    .map(({ item }) => item)
    .sort((a, b) => ITEM_ID_COLLATOR.compare(a.id, b.id))

  const filteredItemById = new Map(filteredItems.map((item) => [item.id, item]))
  const filteredItemIdSet = new Set(filteredItems.map((item) => item.id))
  const recentItems = recentItemIds
    .filter((itemId) => filteredItemIdSet.has(itemId))
    .map((itemId) => filteredItemById.get(itemId))
    .filter((item): item is (typeof filteredItems)[number] => Boolean(item))
    .slice(0, RECENT_ITEMS_SINGLE_ROW_COUNT)
  const showRecentGroup = recentItems.length > 0 && !hasSearchQuery

  return (
    <div className="global-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="global-dialog pickup-item-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('detail.itemPickerTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pickup-item-dialog-titlebar">
          <div className="global-dialog-title pickup-item-dialog-title">{dialogTitle}</div>
          <input
            className="global-dialog-input pickup-item-dialog-search"
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('detail.itemPickerSearchPlaceholder')}
            aria-label={t('detail.itemPickerSearchLabel')}
            autoFocus
            spellCheck={false}
          />
        </div>
        <div className="pickup-item-groups">
          {showRecentGroup ? (
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
          ) : null}

          <section className="pickup-item-group">
            <div className="pickup-item-group-header">
              <div className="pickup-item-group-title">{t('detail.itemPickerAllGroup')}</div>
              <label className="switch-toggle switch-toggle-inline pickup-item-dialog-switch" aria-label={t('detail.itemPickerHideBottledLiquids')}>
                <span className="pickup-item-dialog-switch-label">{t('detail.itemPickerHideBottledLiquids')}</span>
                <input type="checkbox" checked={hideBottledLiquids} onChange={(event) => setHideBottledLiquids(event.target.checked)} />
                <span className="switch-track" aria-hidden="true">
                  <span className="switch-thumb" />
                </span>
              </label>
            </div>
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
              {filteredItems.length === 0 ? <div className="pickup-item-empty">{t('detail.itemPickerNoResults')}</div> : null}
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
