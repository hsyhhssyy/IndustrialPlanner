import { useEffect } from 'react'
import { DEVICE_TYPE_BY_ID } from '../../domain/registry'
import { isWithinLot } from '../../domain/geometry'
import { validatePlacementConstraints } from '../../domain/placement'
import { rotatedFootprintSize } from '../../domain/shared/math'
import { showToast } from '../../ui/toast'
import type { DeviceInstance, DeviceTypeId, LayoutState, Rotation } from '../../domain/types'

type UseBuildHotkeysDomainParams = {
  simIsRunning: boolean
  mode: string
  placeType: DeviceTypeId | ''
  setPlaceRotation: (updater: Rotation | ((current: Rotation) => Rotation)) => void
  selection: string[]
  layout: LayoutState
  foundationIdSet: ReadonlySet<string>
  setLayout: (updater: LayoutState) => void
  outOfLotToastKey: string
  fallbackPlacementToastKey: string
  t: (key: string, params?: Record<string, string | number>) => string
}

export function useBuildHotkeysDomain({
  simIsRunning,
  mode,
  placeType,
  setPlaceRotation,
  selection,
  layout,
  foundationIdSet,
  setLayout,
  outOfLotToastKey,
  fallbackPlacementToastKey,
  t,
}: UseBuildHotkeysDomainParams) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (simIsRunning) return
      const target = event.target as HTMLElement | null
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable)
      if (isTypingTarget) return

      if (event.key.toLowerCase() !== 'r') return
      event.preventDefault()

      if (mode === 'place' && placeType) {
        setPlaceRotation((current) => ((current + 90) % 360) as Rotation)
        return
      }
      if (selection.length === 0) return

      const selectedRotatable = layout.devices.filter(
        (device) => selection.includes(device.instanceId) && !foundationIdSet.has(device.instanceId),
      )
      if (selectedRotatable.length === 0) return

      const selectedBounds = selectedRotatable.reduce(
        (acc, device) => {
          const type = DEVICE_TYPE_BY_ID[device.typeId]
          const size = rotatedFootprintSize(type.size, device.rotation)
          const right = device.origin.x + size.width
          const bottom = device.origin.y + size.height
          return {
            minX: Math.min(acc.minX, device.origin.x),
            minY: Math.min(acc.minY, device.origin.y),
            maxX: Math.max(acc.maxX, right),
            maxY: Math.max(acc.maxY, bottom),
          }
        },
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
      )

      const centerX = (selectedBounds.minX + selectedBounds.maxX) / 2
      const centerY = (selectedBounds.minY + selectedBounds.maxY) / 2

      const rotatedById = new Map<string, DeviceInstance>()
      for (const device of selectedRotatable) {
        const currentSize = rotatedFootprintSize(DEVICE_TYPE_BY_ID[device.typeId].size, device.rotation)
        const currentCenterX = device.origin.x + currentSize.width / 2
        const currentCenterY = device.origin.y + currentSize.height / 2
        const nextCenterX = centerX - (currentCenterY - centerY)
        const nextCenterY = centerY + (currentCenterX - centerX)
        const nextRotation = ((device.rotation + 90) % 360) as Rotation
        const nextSize = rotatedFootprintSize(DEVICE_TYPE_BY_ID[device.typeId].size, nextRotation)
        const nextOrigin = {
          x: Math.round(nextCenterX - nextSize.width / 2),
          y: Math.round(nextCenterY - nextSize.height / 2),
        }
        rotatedById.set(device.instanceId, {
          ...device,
          rotation: nextRotation,
          origin: nextOrigin,
        })
      }

      const nextLayout: LayoutState = {
        ...layout,
        devices: layout.devices.map((device) => rotatedById.get(device.instanceId) ?? device),
      }

      const outOfLotDevice = Array.from(rotatedById.values()).find((device) => !isWithinLot(device, nextLayout.lotSize))
      if (outOfLotDevice) {
        showToast(t(outOfLotToastKey), { variant: 'warning' })
        return
      }

      const constraintFailure = Array.from(rotatedById.values())
        .map((device) => validatePlacementConstraints(nextLayout, device))
        .find((result) => !result.isValid)
      if (constraintFailure && !constraintFailure.isValid) {
        showToast(t(constraintFailure.messageKey ?? fallbackPlacementToastKey), { variant: 'warning' })
        return
      }

      setLayout(nextLayout)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    fallbackPlacementToastKey,
    foundationIdSet,
    layout,
    mode,
    outOfLotToastKey,
    placeType,
    selection,
    setLayout,
    setPlaceRotation,
    simIsRunning,
    t,
  ])
}