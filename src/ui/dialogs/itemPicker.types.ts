import type { ItemId } from '../../domain/types'

export type ItemPickerState =
  | { kind: 'pickup'; deviceInstanceId: string }
  | { kind: 'protocolHubOutput'; deviceInstanceId: string; portId: string; portIndex: number }
  | { kind: 'pumpOutput'; deviceInstanceId: string }
  | { kind: 'preload'; deviceInstanceId: string; slotIndex: number }
  | { kind: 'storageSlotPinned'; slotIndex: number }
  | { kind: 'storageSlotPreload'; slotIndex: number }

export type ItemPickerFilter = {
  allowedTypes?: Array<'solid' | 'liquid'>
  requiredTags?: string[]
  allowedItemIds?: ReadonlySet<ItemId>
}
