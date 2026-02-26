import type { ItemId } from '../../domain/types'
export function isReactorInputPort(portId: string): boolean {
  return portId === 'in_s_1' || portId === 'in_s_3' || portId === 'in_e_1' || portId === 'in_e_3'
}

export function isReactorSolidInputPort(portId: string): boolean {
  return portId === 'in_s_1' || portId === 'in_s_3'
}

export function isReactorLiquidInputPort(portId: string): boolean {
  return portId === 'in_e_1' || portId === 'in_e_3'
}

export function clampRecipeIdsMax2(recipeIds: string[]): string[] {
  const deduped = Array.from(new Set(recipeIds.filter((id) => id.trim().length > 0)))
  return deduped.slice(0, 2)
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
