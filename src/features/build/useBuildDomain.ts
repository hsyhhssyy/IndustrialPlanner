import { useCallback } from 'react'
import type { DeviceTypeDef, DeviceTypeId, LayoutState } from '../../domain/types'
import { getDeviceLabel, type Language } from '../../i18n'
import { isBeltLike, isPipeLike } from '../../domain/geometry'

type PlaceGroupKey =
  | 'conveyor_logistics'
  | 'pipe_logistics'
  | 'resource_power'
  | 'storage'
  | 'basic_production'
  | 'advanced_manufacturing'
  | 'functional'
  | 'combat_support'

export type { PlaceGroupKey }

export type PlaceGroupEntry = {
  key: PlaceGroupKey
  labelKey: string
  devices: DeviceTypeDef[]
}

export const PLACE_GROUP_ORDER: PlaceGroupKey[] = [
  'conveyor_logistics',
  'pipe_logistics',
  'resource_power',
  'storage',
  'basic_production',
  'advanced_manufacturing',
  'functional',
  'combat_support',
]

export const PLACE_GROUP_LABEL_KEY: Record<PlaceGroupKey, string> = {
  conveyor_logistics: 'left.group.conveyorLogistics',
  pipe_logistics: 'left.group.pipeLogistics',
  resource_power: 'left.group.resourcePower',
  storage: 'left.group.storage',
  basic_production: 'left.group.basicProduction',
  advanced_manufacturing: 'left.group.advancedManufacturing',
  functional: 'left.group.functional',
  combat_support: 'left.group.combatSupport',
}

export const QUICK_PLACE_GROUP_BY_KEY: Partial<Record<string, PlaceGroupKey>> = {
  x: 'resource_power',
  c: 'storage',
  v: 'basic_production',
  b: 'advanced_manufacturing',
}

export function getPlaceGroup(typeId: DeviceTypeId): PlaceGroupKey {
  if (
    typeId === 'item_log_splitter' ||
    typeId === 'item_log_converger' ||
    typeId === 'item_log_connector' ||
    typeId === 'item_log_admission'
  )
    return 'conveyor_logistics'
  if (
    typeId === 'item_pipe_splitter' ||
    typeId === 'item_pipe_converger' ||
    typeId === 'item_pipe_admission' ||
    typeId === 'item_pipe_connector'
  )
    return 'pipe_logistics'
  if (typeId === 'item_port_unloader_1' || typeId === 'item_port_loader_1') return 'storage'
  if (
    typeId === 'item_port_storager_1' ||
    typeId === 'item_port_log_hongs_bus_source' ||
    typeId === 'item_port_log_hongs_bus' ||
    typeId === 'item_port_liquid_storager_1' ||
    typeId === 'item_port_udpipe_loader_1' ||
    typeId === 'item_port_udpipe_unloader_1' ||
    typeId === 'item_port_udpipe_loader_large_1' ||
    typeId === 'item_port_udpipe_unloader_large_1'
  )
    return 'storage'
  if (
    typeId === 'item_port_water_pump_1' ||
    typeId === 'item_port_power_diffuser_1' ||
    typeId === 'item_port_power_sta_1'
  )
    return 'resource_power'
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
    typeId === 'item_port_mix_pool_large_1' ||
    typeId === 'item_port_xiranite_oven_1' ||
    typeId === 'item_port_dismantler_1'
  )
    return 'advanced_manufacturing'
  return 'functional'
}

function getPlaceGroupCollator(language: Language) {
  return new Intl.Collator(language === 'zh-CN' ? 'zh-Hans-u-co-pinyin' : language, {
    numeric: true,
    sensitivity: 'base',
  })
}

export function buildPlaceGroups(visiblePlaceableTypes: DeviceTypeDef[], language: Language): PlaceGroupEntry[] {
  const collator = getPlaceGroupCollator(language)
  return PLACE_GROUP_ORDER.map((key) => ({
    key,
    labelKey: PLACE_GROUP_LABEL_KEY[key],
    devices: visiblePlaceableTypes
      .filter((deviceType) => getPlaceGroup(deviceType.id) === key)
      .sort((left, right) => collator.compare(getDeviceLabel(language, left.id), getDeviceLabel(language, right.id))),
  })).filter((entry) => entry.devices.length > 0)
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
