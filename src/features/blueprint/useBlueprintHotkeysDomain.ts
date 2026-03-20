import { useEffect } from 'react'
import { showToast } from '../../ui/toast'
import { sanitizeBlueprintLinks } from '../../domain/deviceLinks'
import type { BaseId, DeviceInstance, LayoutState, Rotation } from '../../domain/types'
import type { BlueprintSnapshot } from './useBlueprintDomain'
import { APP_VERSION, createBlueprintId } from '../../migrations/versioning'

type UseBlueprintHotkeysDomainParams = {
  simIsRunning: boolean
  selection: string[]
  layout: LayoutState
  foundationIdSet: ReadonlySet<string>
  activeBaseId: BaseId
  cloneDeviceConfig: (config: DeviceInstance['config']) => DeviceInstance['config']
  setClipboardBlueprint: (value: BlueprintSnapshot) => void
  lastClipboardBlueprint: BlueprintSnapshot | null
  setLastClipboardBlueprint: (value: BlueprintSnapshot) => void
  setBlueprintPlacementRotation: (updater: Rotation | ((current: Rotation) => Rotation)) => void
  setArmedBlueprintId: (updater: string | null | ((current: string | null) => string | null)) => void
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
  lastClipboardBlueprint,
  setLastClipboardBlueprint,
  setBlueprintPlacementRotation,
  setArmedBlueprintId,
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
        if (selection.length < 1) {
          showToast(t('toast.blueprintCopyNeedsMultiSelect'), { variant: 'warning' })
          return
        }
        event.preventDefault()
        const selectedIdSet = new Set(selection)
        const selectedDevices = layout.devices.filter(
          (device) =>
            selectedIdSet.has(device.instanceId) && (!foundationIdSet.has(device.instanceId) || device.typeId === 'item_port_sp_hub_1'),
        )
        if (selectedDevices.length < 1) {
          showToast(t('toast.blueprintCopyNeedsMultiSelect'), { variant: 'warning' })
          return
        }

        const minX = Math.min(...selectedDevices.map((device) => device.origin.x))
        const minY = Math.min(...selectedDevices.map((device) => device.origin.y))
        const createdAt = new Date().toISOString()
        const tempSnapshot: BlueprintSnapshot = {
          id: createBlueprintId('user'),
          source: 'user',
          name: 'clipboard',
          createdAt,
          version: APP_VERSION,
          blueprintVersion: '1',
          baseId: activeBaseId,
          devices: selectedDevices.map((device) => ({
            blueprintInstanceId: device.instanceId,
            typeId: device.typeId,
            rotation: device.rotation,
            origin: { x: device.origin.x - minX, y: device.origin.y - minY },
            config: cloneDeviceConfig(device.config),
          })),
          links: sanitizeBlueprintLinks(
            layout.links
              .filter((link) => selectedDevices.some((device) => device.instanceId === link.sourceInstanceId) && selectedDevices.some((device) => device.instanceId === link.targetInstanceId))
              .map((link) => ({
                kind: link.kind,
                sourceBlueprintInstanceId: link.sourceInstanceId,
                targetBlueprintInstanceId: link.targetInstanceId,
              })),
            selectedDevices.map((device) => ({ blueprintInstanceId: device.instanceId, typeId: device.typeId })),
          ),
        }
        setClipboardBlueprint(tempSnapshot)
        setLastClipboardBlueprint(tempSnapshot)
        setArmedBlueprintId(null)
        setBlueprintPlacementRotation(0)
        showToast(t('toast.blueprintClipboardReady', { count: tempSnapshot.devices.length }))
        return
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'v') {
        if (!lastClipboardBlueprint) return
        event.preventDefault()
        setClipboardBlueprint(lastClipboardBlueprint)
        setArmedBlueprintId(null)
        setBlueprintPlacementRotation(0)
        showToast(t('toast.blueprintClipboardRestored', { count: lastClipboardBlueprint.devices.length }))
        return
      }

      if (event.key === 'Escape') {
        if (!activePlacementBlueprint) return
        event.preventDefault()
        setArmedBlueprintId(null)
        setBlueprintPlacementRotation(0)
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
    lastClipboardBlueprint,
    selection,
    setArmedBlueprintId,
    setBlueprintPlacementRotation,
    setClipboardBlueprint,
    setLastClipboardBlueprint,
    simIsRunning,
    t,
  ])
}