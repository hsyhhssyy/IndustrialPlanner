import { DEVICE_TYPE_BY_ID, ITEM_BY_ID, LIQUID_ITEM_IDS, SOLID_ITEM_IDS } from '../registry'
import type { DeviceTypeId, ItemDef, ItemId } from '../types'

const SOLID_ITEM_ID_SET = new Set<ItemId>(SOLID_ITEM_IDS)
const LIQUID_ITEM_ID_SET = new Set<ItemId>(LIQUID_ITEM_IDS)

export const DEFAULT_EXTERNAL_LIQUID_SOURCE_ITEM_ID: ItemId = 'item_liquid_water'

export function selectableItemIdsForType(type: ItemDef['type']): ReadonlySet<ItemId> {
  return type === 'solid' ? SOLID_ITEM_ID_SET : LIQUID_ITEM_ID_SET
}

export function normalizeItemIdByType(itemId: ItemId | undefined, type: ItemDef['type']): ItemId | undefined {
  return itemId && ITEM_BY_ID[itemId]?.type === type ? itemId : undefined
}

export function normalizeExternalLiquidSourceItemId(itemId: ItemId | undefined): ItemId {
  return normalizeItemIdByType(itemId, 'liquid') ?? DEFAULT_EXTERNAL_LIQUID_SOURCE_ITEM_ID
}

export function isExternalLiquidSourceDeviceType(typeId: DeviceTypeId | undefined): boolean {
  return typeId === 'item_port_water_pump_1' || typeId === 'item_port_udpipe_unloader_1'
}

export function inputBufferAllowedTypesForSlot(deviceTypeId: DeviceTypeId, slotIndex: number): Array<ItemDef['type']> {
  const slotTypes = DEVICE_TYPE_BY_ID[deviceTypeId].inputBufferAllowedTypesBySlot?.[slotIndex]
  if (!Array.isArray(slotTypes) || slotTypes.length === 0) return ['solid']
  return Array.from(new Set(slotTypes.filter((type): type is ItemDef['type'] => type === 'solid' || type === 'liquid')))
}

export function normalizeItemIdByAllowedTypes(itemId: ItemId | undefined, allowedTypes: Array<ItemDef['type']>): ItemId | undefined {
  return itemId && ITEM_BY_ID[itemId] && allowedTypes.includes(ITEM_BY_ID[itemId].type) ? itemId : undefined
}