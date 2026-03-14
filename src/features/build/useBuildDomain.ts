import { useCallback } from 'react'
import type { DeviceTypeId, LayoutState } from '../../domain/types'
import { isBeltLike, isPipeLike } from '../../domain/geometry'

type PlaceGroupKey =
  | 'logistics'
  | 'resource'
  | 'storage'
  | 'basic_production'
  | 'advanced_manufacturing'
  | 'power'
  | 'functional'
  | 'combat_support'

export const PLACE_GROUP_ORDER: PlaceGroupKey[] = [
  'logistics',
  'resource',
  'storage',
  'basic_production',
  'advanced_manufacturing',
  'power',
  'functional',
  'combat_support',
]

export const PLACE_GROUP_LABEL_KEY: Record<PlaceGroupKey, string> = {
  logistics: 'left.group.logistics',
  resource: 'left.group.resource',
  storage: 'left.group.storage',
  basic_production: 'left.group.basicProduction',
  advanced_manufacturing: 'left.group.advancedManufacturing',
  power: 'left.group.power',
  functional: 'left.group.functional',
  combat_support: 'left.group.combatSupport',
}

export function getPlaceGroup(typeId: DeviceTypeId): PlaceGroupKey {
  if (
    typeId === 'item_log_splitter' ||
    typeId === 'item_log_converger' ||
    typeId === 'item_log_connector' ||
    typeId === 'item_log_admission' ||
    typeId === 'item_pipe_splitter' ||
    typeId === 'item_pipe_converger' ||
    typeId === 'item_pipe_admission' ||
    typeId === 'item_pipe_connector'
  )
    return 'logistics'
  if (typeId === 'item_port_unloader_1' || typeId === 'item_port_loader_1') return 'storage'
  if (
    typeId === 'item_port_storager_1' ||
    typeId === 'item_port_log_hongs_bus_source' ||
    typeId === 'item_port_log_hongs_bus' ||
    typeId === 'item_port_liquid_storager_1' ||
    typeId === 'item_port_udpipe_unloader_1'
  )
    return 'storage'
  if (typeId === 'item_port_water_pump_1') return 'resource'
  if (
    typeId === 'item_port_grinder_1' ||
    typeId === 'item_port_furnance_1' ||
    typeId === 'item_port_liquid_furnance_1' ||
    typeId === 'item_liquid_cleaner_1' ||
    typeId === 'item_port_cmpt_mc_1' ||
    typeId === 'item_port_shaper_1' ||
    typeId === 'item_port_seedcol_1' ||
    typeId === 'item_port_planter_1' ||
    typeId === 'item_port_hydro_planter_1'
  )
    return 'basic_production'
  if (
    typeId === 'item_port_winder_1' ||
    typeId === 'item_port_filling_pd_mc_1' ||
    typeId === 'item_port_liquid_filling_pd_mc_1' ||
    typeId === 'item_port_tools_asm_mc_1' ||
    typeId === 'item_port_thickener_1' ||
    typeId === 'item_port_mix_pool_1' ||
    typeId === 'item_port_xiranite_oven_1' ||
    typeId === 'item_port_dismantler_1'
  )
    return 'advanced_manufacturing'
  if (typeId === 'item_port_power_diffuser_1' || typeId === 'item_port_power_sta_1') return 'power'
  return 'functional'
}

type UseBuildDomainActionsParams = {
  simIsRunning: boolean
  t: (key: string, params?: Record<string, string | number>) => string
  foundationIdSet: ReadonlySet<string>
  setLayout: (updater: LayoutState | ((current: LayoutState) => LayoutState)) => void
  setSelection: (value: string[]) => void
}

export function useBuildDomainActions({
  simIsRunning,
  foundationIdSet,
  setLayout,
  setSelection,
}: UseBuildDomainActionsParams) {
  const handleDeleteAll = useCallback(() => {
    if (simIsRunning) return
    setLayout((current) => ({
      ...current,
      devices: current.devices.filter((device) => foundationIdSet.has(device.instanceId)),
    }))
    setSelection([])
  }, [foundationIdSet, setLayout, setSelection, simIsRunning])

  const handleDeleteAllBelts = useCallback(() => {
    if (simIsRunning) return
    setLayout((current) => ({
      ...current,
      devices: current.devices.filter((device) => !isBeltLike(device.typeId) && !isPipeLike(device.typeId)),
    }))
    setSelection([])
  }, [setLayout, setSelection, simIsRunning])

  const handleClearLot = useCallback(() => {
    if (simIsRunning) return
    setLayout((current) => ({
      ...current,
      devices: current.devices.filter((device) => foundationIdSet.has(device.instanceId)),
    }))
    setSelection([])
  }, [foundationIdSet, setLayout, setSelection, simIsRunning])

  return {
    handleDeleteAll,
    handleDeleteAllBelts,
    handleClearLot,
  }
}
