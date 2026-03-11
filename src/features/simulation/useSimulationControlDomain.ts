import { useCallback } from 'react'
import { dialogAlertNonBlocking } from '../../ui/dialog'
import { startSimulation } from '../../sim/engine'
import type { LayoutState, PowerMode, SimState } from '../../domain/types'

type UseSimulationControlDomainParams = {
  unknownDevicesCount: number
  t: (key: string, params?: Record<string, string | number>) => string
  layout: LayoutState
  powerMode: PowerMode
  initialBatteryPercent: number
  powerDemandOverrideKw: number | null
  updateSim: (updater: (current: SimState) => SimState) => SimState
  onStarted?: () => void
}

export function useSimulationControlDomain({
  unknownDevicesCount,
  t,
  layout,
  powerMode,
  initialBatteryPercent,
  powerDemandOverrideKw,
  updateSim,
  onStarted,
}: UseSimulationControlDomainParams) {
  const handleStartSimulation = useCallback(() => {
    if (unknownDevicesCount > 0) {
      dialogAlertNonBlocking(t('dialog.legacyUnknownTypesStartBlocked'), {
        title: t('dialog.title.warning'),
        closeText: t('dialog.ok'),
        variant: 'warning',
      })
      return
    }
    updateSim((current) => startSimulation(layout, current, powerMode, initialBatteryPercent, powerDemandOverrideKw))
    onStarted?.()
  }, [initialBatteryPercent, layout, onStarted, powerDemandOverrideKw, powerMode, t, unknownDevicesCount, updateSim])

  return {
    handleStartSimulation,
  }
}