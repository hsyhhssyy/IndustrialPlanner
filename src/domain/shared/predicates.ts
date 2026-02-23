import { DEVICE_TYPE_BY_ID, ITEMS } from '../registry'
import type { DeviceTypeId, ItemId } from '../types'

const ORE_ITEM_TAG = '矿石'
const ORE_ITEM_ID_SET = new Set<ItemId>(ITEMS.filter((item) => item.tags?.includes(ORE_ITEM_TAG)).map((item) => item.id))

export function isOreItemId(itemId: ItemId | undefined) {
  return Boolean(itemId && ORE_ITEM_ID_SET.has(itemId))
}

export function isKnownDeviceTypeId(typeId: unknown): typeId is DeviceTypeId {
  return typeof typeId === 'string' && typeId in DEVICE_TYPE_BY_ID
}