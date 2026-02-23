import { useEffect } from 'react'
import { showToast } from '../../ui/toast'
import type { BaseId, DeviceInstance, LayoutState, Rotation } from '../../domain/types'
import type { BlueprintSnapshot } from './useBlueprintDomain'

type UseBlueprintHotkeysDomainParams = {
  simIsRunning: boolean
  selection: string[]
  layout: LayoutState
  foundationIdSet: ReadonlySet<string>
  activeBaseId: BaseId
  cloneDeviceConfig: (config: DeviceInstance['config']) => DeviceInstance['config']
  setClipboardBlueprint: (value: BlueprintSnapshot) => void
  setBlueprintPlacementRotation: (updater: Rotation | ((current: Rotation) => Rotation)) => void
  activePlacementBlueprint: BlueprintSnapshot | null
  t: (key: string, params?: Record<string, string | number>) => string
}

export function useBlueprintHotkeysDomain({
  simIsRunning,
  selection,
  layout,
  foundationIdSet,
  activeBaseId,
  cloneDeviceConfig,
  setClipboardBlueprint,
  setBlueprintPlacementRotation,
  activePlacementBlueprint,
  t,
}: UseBlueprintHotkeysDomainParams) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (simIsRunning) return
      const target = event.target as HTMLElement | null
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable)
      if (isTypingTarget) return

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'c') {
        if (selection.length < 2) {
          showToast(t('toast.blueprintCopyNeedsMultiSelect'), { variant: 'warning' })
          return
        }
        event.preventDefault()
        const selectedIdSet = new Set(selection)
        const selectedDevices = layout.devices.filter(
          (device) => selectedIdSet.has(device.instanceId) && !foundationIdSet.has(device.instanceId),
        )
        if (selectedDevices.length < 2) {
          showToast(t('toast.blueprintCopyNeedsMultiSelect'), { variant: 'warning' })
          return
        }

        const minX = Math.min(...selectedDevices.map((device) => device.origin.x))
        const minY = Math.min(...selectedDevices.map((device) => device.origin.y))
        const createdAt = new Date().toISOString()
        const tempSnapshot: BlueprintSnapshot = {
          id: `clipboard_${Date.now()}`,
          name: 'clipboard',
          createdAt,
          baseId: activeBaseId,
          devices: selectedDevices.map((device) => ({
            typeId: device.typeId,
            rotation: device.rotation,
            origin: { x: device.origin.x - minX, y: device.origin.y - minY },
            config: cloneDeviceConfig(device.config),
          })),
        }
        setClipboardBlueprint(tempSnapshot)
        setBlueprintPlacementRotation(0)
        showToast(t('toast.blueprintClipboardReady', { count: tempSnapshot.devices.length }))
        return
      }

      if (event.key.toLowerCase() !== 'r') return
      if (!activePlacementBlueprint) return
      event.preventDefault()
      setBlueprintPlacementRotation((current) => ((current + 90) % 360) as Rotation)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    activeBaseId,
    activePlacementBlueprint,
    cloneDeviceConfig,
    foundationIdSet,
    layout,
    selection,
    setBlueprintPlacementRotation,
    setClipboardBlueprint,
    simIsRunning,
    t,
  ])
}