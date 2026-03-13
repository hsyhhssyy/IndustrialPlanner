import { DEVICE_TYPE_BY_ID } from '../domain/registry'
import type { DeviceTypeId, ItemId } from '../domain/types'

const DEVICE_ICON_ALIAS_BY_TYPE_ID: Partial<Record<DeviceTypeId, string>> = {
  item_port_water_pump_1: 'item_port_pump_1',
  item_port_hydro_planter_1: 'item_port_planter_1',
  item_port_liquid_filling_pd_mc_1: 'item_port_filling_pd_mc_1',
}

export function getItemIconPath(itemId: ItemId | string) {
  return `/itemicon/${itemId}.webp`
}

export function getDeviceIconPath(typeId: DeviceTypeId | string) {
  const iconId = DEVICE_ICON_ALIAS_BY_TYPE_ID[typeId as DeviceTypeId] ?? typeId
  return `/device-icons/${iconId}.webp`
}

export function getDeviceMenuIconPath(typeId: DeviceTypeId) {
  if (DEVICE_TYPE_BY_ID[typeId]?.tags?.includes('超时空')) {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">',
      '<rect x="3" y="3" width="58" height="58" rx="8" fill="#243042" stroke="#7b8aa0" stroke-width="2"/>',
      '</svg>',
    ].join('')
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  }
  return getDeviceIconPath(typeId)
}
