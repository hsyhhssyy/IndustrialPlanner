import type { ItemId } from '../../domain/types'
import {
  isReactorLiquidInputPort,
  isReactorSolidInputPort,
} from './types'

export function isReactorInputPort(portId: string): boolean {
  return isReactorSolidInputPort(portId) || isReactorLiquidInputPort(portId)
}

export function clampRecipeIds(recipeIds: string[], maxCount: number): string[] {
  const deduped = Array.from(new Set(recipeIds.filter((id) => id.trim().length > 0)))
  return deduped.slice(0, Math.max(0, Math.floor(maxCount)))
}

export function isLiquidItem(itemType: 'solid' | 'liquid' | undefined) {
  return itemType === 'liquid'
}

export function slotBoundItem(slotItems: Array<ItemId | null>, slotIndex: number) {
  if (slotIndex < 0 || slotIndex >= slotItems.length) return null
  return slotItems[slotIndex]
}

export function findBoundSlotIndex(slotItems: Array<ItemId | null>, itemId: ItemId) {
  return slotItems.findIndex((slotItemId) => slotItemId === itemId)
}

export function findFirstEmptySlot(slotItems: Array<ItemId | null>) {
  return slotItems.findIndex((slotItemId) => slotItemId === null)
}
