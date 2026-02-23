import { ITEMS } from '../registry'
import type { ItemId, SlotData } from '../types'
import { getItemLabel, type Language } from '../../i18n'

export function formatInventoryAmounts(
  language: Language,
  amounts: Partial<Record<ItemId, number>>,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  const entries = ITEMS.map((item) => ({ itemId: item.id, amount: Math.max(0, amounts[item.id] ?? 0) })).filter(
    (entry) => entry.amount > 0,
  )
  if (entries.length === 0) return t('detail.empty')
  return entries.map((entry) => `${getItemLabel(language, entry.itemId)}: ${entry.amount}`).join(', ')
}

export function formatInputBufferAmounts(
  language: Language,
  amounts: Partial<Record<ItemId, number>>,
  slots: number,
  capacity: number,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  const entries: Array<{ itemId: ItemId; amount: number }> = []
  let total = 0
  for (const item of ITEMS) {
    const amount = Math.max(0, amounts[item.id] ?? 0)
    if (amount <= 0) continue
    total += amount
    entries.push({ itemId: item.id, amount })
  }
  if (entries.length === 0) return `${t('detail.empty')} (0/${slots}, 0/${capacity})`
  const detail = entries.map((entry) => `${getItemLabel(language, entry.itemId)}: ${entry.amount}`).join(', ')
  return `${detail} (${entries.length}/${slots}, ${total}/${capacity})`
}

export function formatOutputBufferAmounts(
  language: Language,
  amounts: Partial<Record<ItemId, number>>,
  slots: number,
  capacity: number,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  const entries: Array<{ itemId: ItemId; amount: number }> = []
  let total = 0
  for (const item of ITEMS) {
    const amount = Math.max(0, amounts[item.id] ?? 0)
    if (amount <= 0) continue
    total += amount
    entries.push({ itemId: item.id, amount })
  }
  if (entries.length === 0) return `${t('detail.empty')} (0/${slots}, 0/${capacity})`
  const detail = entries.map((entry) => `${getItemLabel(language, entry.itemId)}: ${entry.amount}`).join(', ')
  return `${detail} (${entries.length}/${slots}, ${total}/${capacity})`
}

export function formatSlotValue(
  slot: SlotData | null,
  language: Language,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  if (!slot) return t('detail.empty')
  return `${getItemLabel(language, slot.itemId)} @ ${slot.progress01.toFixed(2)}`
}

export function formatCompactNumber(value: number) {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 10000) {
    return `${sign}${Math.floor(abs / 1000)}k`
  }

  const integerDigits = Math.floor(abs).toString().length
  if (integerDigits > 2) {
    return `${Math.round(value)}`
  }
  return value.toFixed(2)
}

export function formatCompactStock(value: number) {
  if (!Number.isFinite(value)) return '∞'
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 10000) {
    return `${sign}${Math.floor(abs / 1000)}k`
  }
  return `${Math.round(value)}`
}