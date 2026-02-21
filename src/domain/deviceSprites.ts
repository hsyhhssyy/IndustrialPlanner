import type { DeviceTypeId } from './types'

type DeviceSpriteRegistration = {
  typeId: DeviceTypeId
  fileName: string
}

export const DEVICE_SPRITE_REGISTRATIONS: DeviceSpriteRegistration[] = [
  { typeId: 'item_port_unloader_1', fileName: 'item_port_unloader_1.png' },
  { typeId: 'item_port_grinder_1', fileName: 'item_port_grinder_1.png' },
  { typeId: 'item_port_power_diffuser_1', fileName: 'item_port_power_diffuser_1.png' },
  { typeId: 'item_port_storager_1', fileName: 'item_port_storager_1.png' },
  { typeId: 'item_log_splitter', fileName: 'item_log_splitter.png' },
  { typeId: 'item_log_converger', fileName: 'item_log_converger.png' },
  { typeId: 'item_log_connector', fileName: 'item_log_connector.png' },
]

export const DEVICE_SPRITE_BY_TYPE: Partial<Record<DeviceTypeId, string>> = Object.fromEntries(
  DEVICE_SPRITE_REGISTRATIONS.map((entry) => [entry.typeId, `/sprites/${entry.fileName}`]),
)

export function getDeviceSpritePath(typeId: DeviceTypeId) {
  return DEVICE_SPRITE_BY_TYPE[typeId] ?? null
}
