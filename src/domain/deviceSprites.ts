import type { DeviceTypeId } from './types'

type DeviceSpriteRegistration = {
  typeId: DeviceTypeId
  fileName: string
}

export const DEVICE_SPRITE_REGISTRATIONS: DeviceSpriteRegistration[] = [
  { typeId: 'item_port_unloader_1', fileName: 'item_port_unloader_1.png' },
  { typeId: 'item_port_grinder_1', fileName: 'item_port_grinder_1.png' },
  { typeId: 'item_port_furnance_1', fileName: 'item_port_furnance_1.png' },
  { typeId: 'item_port_cmpt_mc_1', fileName: 'item_port_cmpt_mc_1.png' },
  { typeId: 'item_port_shaper_1', fileName: 'item_port_shaper_1.png' },
  { typeId: 'item_port_seedcol_1', fileName: 'item_port_seedcol_1.png' },
  { typeId: 'item_port_planter_1', fileName: 'item_port_planter_1.png' },
  { typeId: 'item_port_winder_1', fileName: 'item_port_winder_1.png' },
  { typeId: 'item_port_filling_pd_mc_1', fileName: 'item_port_filling_pd_mc_1.png' },
  { typeId: 'item_port_tools_asm_mc_1', fileName: 'item_port_tools_asm_mc_1.png' },
  { typeId: 'item_port_thickener_1', fileName: 'item_port_thickener_1.png' },
  { typeId: 'item_port_power_sta_1', fileName: 'item_port_power_sta_1.png' },
  { typeId: 'item_port_mix_pool_1', fileName: 'item_port_mix_pool_1.png' },
  { typeId: 'item_port_xiranite_oven_1', fileName: 'item_port_xiranite_oven_1.png' },
  { typeId: 'item_port_dismantler_1', fileName: 'item_port_dismantler_1.png' },
  { typeId: 'item_port_log_hongs_bus_source', fileName: 'item_port_log_hongs_bus_source.png' },
  { typeId: 'item_port_log_hongs_bus', fileName: 'item_port_log_hongs_bus.png' },
  { typeId: 'item_port_water_pump_1', fileName: 'liquid_placeholder_structure.svg' },
  { typeId: 'item_port_liquid_storager_1', fileName: 'liquid_placeholder_structure.svg' },
  { typeId: 'item_port_power_diffuser_1', fileName: 'item_port_power_diffuser_1.png' },
  { typeId: 'item_port_storager_1', fileName: 'item_port_storager_1.png' },
  { typeId: 'item_log_splitter', fileName: 'item_log_splitter.png' },
  { typeId: 'item_log_converger', fileName: 'item_log_converger.png' },
  { typeId: 'item_log_connector', fileName: 'item_log_connector.png' },
  { typeId: 'item_pipe_splitter', fileName: 'item_log_splitter.png' },
  { typeId: 'item_pipe_converger', fileName: 'item_log_converger.png' },
  { typeId: 'item_pipe_connector', fileName: 'item_log_connector.png' },
]

export const DEVICE_SPRITE_BY_TYPE: Partial<Record<DeviceTypeId, string>> = Object.fromEntries(
  DEVICE_SPRITE_REGISTRATIONS.map((entry) => [entry.typeId, `/sprites/${entry.fileName}`]),
)

export function getDeviceSpritePath(typeId: DeviceTypeId) {
  return DEVICE_SPRITE_BY_TYPE[typeId] ?? null
}
