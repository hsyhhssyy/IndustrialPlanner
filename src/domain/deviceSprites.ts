import type { DeviceTypeId, Rotation } from './types'
import { withAssetVersion } from '../assets/assetVersion'

type DeviceSpriteRenderBounds = {
  widthCells: number
  heightCells: number
  offsetCells?: { x: number; y: number }
}

type DeviceSpriteRegistration = {
  typeId: DeviceTypeId
  fileName: string
  renderBounds?: DeviceSpriteRenderBounds
}

export const DEVICE_SPRITE_REGISTRATIONS: DeviceSpriteRegistration[] = [
  { typeId: 'item_port_unloader_1', fileName: 'item_port_unloader_1.png' },
  { typeId: 'item_port_loader_1', fileName: 'item_port_loader_1.png' },
  { typeId: 'item_port_grinder_1', fileName: 'item_port_grinder_1.png' },
  { typeId: 'item_port_furnance_1', fileName: 'item_port_furnance_1.png' },
  { typeId: 'item_port_liquid_furnance_1', fileName: 'item_port_liquid_furnance_1.png' },
  { typeId: 'item_port_cmpt_mc_1', fileName: 'item_port_cmpt_mc_1.png' },
  { typeId: 'item_port_shaper_1', fileName: 'item_port_shaper_1.png' },
  { typeId: 'item_port_seedcol_1', fileName: 'item_port_seedcol_1.png' },
  { typeId: 'item_port_planter_1', fileName: 'item_port_planter_1.png' },
  { typeId: 'item_port_hydro_planter_1', fileName: 'item_port_planter_1.png' },
  { typeId: 'item_port_winder_1', fileName: 'item_port_winder_1.png' },
  { typeId: 'item_port_filling_pd_mc_1', fileName: 'item_port_filling_pd_mc_1.png' },
  { typeId: 'item_port_liquid_filling_pd_mc_1', fileName: 'item_port_filling_pd_mc_1.png' },
  { typeId: 'item_port_tools_asm_mc_1', fileName: 'item_port_tools_asm_mc_1.png' },
  { typeId: 'item_port_thickener_1', fileName: 'item_port_thickener_1.png' },
  { typeId: 'item_port_power_sta_1', fileName: 'item_port_power_sta_1.png' },
  { typeId: 'item_port_mix_pool_1', fileName: 'item_port_mix_pool_1.png' },
  {
    typeId: 'item_port_mix_pool_large_1',
    fileName: 'item_port_mix_pool_large_1.png',
    renderBounds: {
      widthCells: 6,
      heightCells: 5,
    },
  },
  { typeId: 'item_port_liquid_purifier_1', fileName: 'item_port_liquid_purifier_1.png' },
  { typeId: 'item_port_xiranite_oven_1', fileName: 'item_port_xiranite_oven_1.png' },
  { typeId: 'item_port_dismantler_1', fileName: 'item_port_dismantler_1.png' },
  { typeId: 'item_port_log_hongs_bus_source', fileName: 'item_port_log_hongs_bus_source.png' },
  { typeId: 'item_port_log_hongs_bus', fileName: 'item_port_log_hongs_bus.png' },
  { typeId: 'item_port_sp_hub_1', fileName: 'item_port_sp_hub_1.png' },
  {
    typeId: 'item_port_water_pump_1',
    fileName: 'item_port_water_pump_1.png',
    renderBounds: {
      widthCells: 5,
      heightCells: 3,
      offsetCells: { x: -1, y: 0 },
    },
  },
  { typeId: 'item_port_udpipe_loader_1', fileName: 'item_port_udpipe_loader_1.png' },
  { typeId: 'item_port_udpipe_unloader_1', fileName: 'item_port_udpipe_unloader_1.png' },
  {
    typeId: 'item_port_udpipe_loader_2',
    fileName: 'item_port_udpipe_loader_2.png',
    renderBounds: {
      widthCells: 2,
      heightCells: 4,
    },
  },
  {
    typeId: 'item_port_udpipe_unloader_2',
    fileName: 'item_port_udpipe_unloader_2.png',
    renderBounds: {
      widthCells: 2,
      heightCells: 4,
    },
  },
  { typeId: 'item_liquid_cleaner_1', fileName: 'item_liquid_cleaner_1.png' },
  { typeId: 'item_port_liquid_storager_1', fileName: 'item_port_liquid_storager_1.png' },
  { typeId: 'item_port_power_diffuser_1', fileName: 'item_port_power_diffuser_1.png' },
  { typeId: 'item_port_storager_1', fileName: 'item_port_storager_1.png' },
  { typeId: 'item_log_splitter', fileName: 'item_log_splitter.png' },
  { typeId: 'item_log_converger', fileName: 'item_log_converger.png' },
  { typeId: 'item_log_connector', fileName: 'item_log_connector.png' },
  { typeId: 'item_log_admission', fileName: 'item_log_admission.png' },
  { typeId: 'item_pipe_splitter', fileName: 'item_pipe_splitter.png' },
  { typeId: 'item_pipe_converger', fileName: 'item_pipe_converger.png' },
  { typeId: 'item_pipe_admission', fileName: 'item_pipe_admission.png' },
  { typeId: 'item_pipe_connector', fileName: 'item_pipe_connector.png' },
]

export const DEVICE_SPRITE_BY_TYPE: Partial<Record<DeviceTypeId, string>> = Object.fromEntries(
  DEVICE_SPRITE_REGISTRATIONS.map((entry) => [entry.typeId, withAssetVersion(`/sprites/${entry.fileName.replace(/\.[^.]+$/, '.webp')}`)]),
)

const DEVICE_SPRITE_RENDER_BOUNDS_BY_TYPE: Partial<Record<DeviceTypeId, DeviceSpriteRenderBounds>> = Object.fromEntries(
  DEVICE_SPRITE_REGISTRATIONS.filter((entry) => entry.renderBounds).map((entry) => [entry.typeId, entry.renderBounds as DeviceSpriteRenderBounds]),
)

function rotateOffset(offset: { x: number; y: number }, rotation: Rotation) {
  switch (rotation) {
    case 90:
      return { x: -offset.y, y: offset.x }
    case 180:
      return { x: -offset.x, y: -offset.y }
    case 270:
      return { x: offset.y, y: -offset.x }
    default:
      return offset
  }
}

export function getDeviceSpriteRenderMetrics({
  typeId,
  rotation,
  baseCellSize,
  fallbackTextureSize,
}: {
  typeId: DeviceTypeId
  rotation: Rotation
  baseCellSize: number
  fallbackTextureSize: { width: number; height: number }
}) {
  const renderBounds = DEVICE_SPRITE_RENDER_BOUNDS_BY_TYPE[typeId]
  const baseRenderSize = renderBounds
    ? { width: renderBounds.widthCells, height: renderBounds.heightCells }
    : fallbackTextureSize
  const offsetCells = renderBounds?.offsetCells ? rotateOffset(renderBounds.offsetCells, rotation) : { x: 0, y: 0 }

  return {
    textureWidthPx: baseRenderSize.width * baseCellSize - 6,
    textureHeightPx: baseRenderSize.height * baseCellSize - 6,
    centerOffsetXPx: offsetCells.x * baseCellSize,
    centerOffsetYPx: offsetCells.y * baseCellSize,
  }
}

export function getDeviceSpritePath(typeId: DeviceTypeId) {
  return DEVICE_SPRITE_BY_TYPE[typeId] ?? null
}
