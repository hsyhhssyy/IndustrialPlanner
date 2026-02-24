import { useCallback } from 'react'
import { dialogConfirm } from '../../ui/dialog'
import { isWithinLot } from '../../domain/geometry'
import type { DeviceTypeId, LayoutState } from '../../domain/types'

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
    typeId === 'item_pipe_splitter' ||
    typeId === 'item_pipe_converger' ||
    typeId === 'item_pipe_connector'
  )
    return 'logistics'
  if (typeId === 'item_port_unloader_1') return 'storage'
  if (
    typeId === 'item_port_storager_1' ||
    typeId === 'item_port_log_hongs_bus_source' ||
    typeId === 'item_port_log_hongs_bus' ||
    typeId === 'item_port_liquid_storager_1'
  )
    return 'storage'
  if (
    typeId === 'item_port_grinder_1' ||
    typeId === 'item_port_furnance_1' ||
    typeId === 'item_port_cmpt_mc_1' ||
    typeId === 'item_port_shaper_1' ||
    typeId === 'item_port_seedcol_1' ||
    typeId === 'item_port_planter_1'
  )
    return 'basic_production'
  if (
    typeId === 'item_port_winder_1' ||
    typeId === 'item_port_filling_pd_mc_1' ||
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
  t,
  foundationIdSet,
  setLayout,
  setSelection,
}: UseBuildDomainActionsParams) {
  const handleDeleteAll = useCallback(async () => {
    if (simIsRunning) return
    const confirmed = await dialogConfirm(t('left.deleteAllConfirm'), {
      title: t('dialog.title.confirm'),
      confirmText: t('dialog.ok'),
      cancelText: t('dialog.cancel'),
      variant: 'warning',
    })
    if (!confirmed) return
    setLayout((current) => ({
      ...current,
      devices: current.devices.filter((device) => foundationIdSet.has(device.instanceId)),
    }))
    setSelection([])
  }, [foundationIdSet, setLayout, setSelection, simIsRunning, t])

  const handleDeleteAllBelts = useCallback(async () => {
    if (simIsRunning) return
    const confirmed = await dialogConfirm(t('left.deleteAllBeltsConfirm'), {
      title: t('dialog.title.confirm'),
      confirmText: t('dialog.ok'),
      cancelText: t('dialog.cancel'),
      variant: 'warning',
    })
    if (!confirmed) return
    setLayout((current) => ({
      ...current,
      devices: current.devices.filter(
        (device) =>
          device.typeId !== 'item_log_connector' &&
          device.typeId !== 'item_log_splitter' &&
          device.typeId !== 'item_log_converger' &&
          device.typeId !== 'item_pipe_connector' &&
          device.typeId !== 'item_pipe_splitter' &&
          device.typeId !== 'item_pipe_converger' &&
          !device.typeId.startsWith('belt_') &&
          !device.typeId.startsWith('pipe_'),
      ),
    }))
    setSelection([])
  }, [setLayout, setSelection, simIsRunning, t])

  const handleClearLot = useCallback(async () => {
    if (simIsRunning) return
    const confirmed = await dialogConfirm(t('left.clearLotConfirm'), {
      title: t('dialog.title.confirm'),
      confirmText: t('dialog.ok'),
      cancelText: t('dialog.cancel'),
      variant: 'warning',
    })
    if (!confirmed) return
    setLayout((current) => ({
      ...current,
      devices: current.devices.filter((device) => foundationIdSet.has(device.instanceId) || !isWithinLot(device, current.lotSize)),
    }))
    setSelection([])
  }, [foundationIdSet, setLayout, setSelection, simIsRunning, t])

  return {
    handleDeleteAll,
    handleDeleteAllBelts,
    handleClearLot,
  }
}
