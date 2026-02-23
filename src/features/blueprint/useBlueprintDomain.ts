import { useCallback, useMemo } from 'react'
import { usePersistentState } from '../../core/usePersistentState'
import { dialogPrompt } from '../../ui/dialog'
import { showToast } from '../../ui/toast'
import { DEVICE_TYPE_BY_ID } from '../../domain/registry'
import { isWithinLot } from '../../domain/geometry'
import { validatePlacementConstraints } from '../../domain/placement'
import { rotatedFootprintSize } from '../../domain/shared/math'
import type { BaseId, DeviceInstance, DeviceTypeId, LayoutState, Rotation } from '../../domain/types'

type BlueprintDeviceSnapshot = {
  typeId: DeviceTypeId
  rotation: Rotation
  origin: { x: number; y: number }
  config: DeviceInstance['config']
}

export type BlueprintSnapshot = {
  id: string
  name: string
  createdAt: string
  baseId: BaseId
  devices: BlueprintDeviceSnapshot[]
}

type BlueprintPlacementPreview = {
  devices: DeviceInstance[]
  isValid: boolean
  invalidMessageKey: string | null
}

type BlueprintLocalRect = {
  typeId: DeviceTypeId
  rotation: Rotation
  config: DeviceInstance['config']
  x: number
  y: number
  width: number
  height: number
}

function cloneDeviceConfig(config: DeviceInstance['config']): DeviceInstance['config'] {
  return JSON.parse(JSON.stringify(config ?? {})) as DeviceInstance['config']
}

function rotateBlueprintRects(rects: BlueprintLocalRect[], rotation: Rotation) {
  if (rects.length === 0) return rects

  const bounds = rects.reduce(
    (acc, rect) => ({
      minX: Math.min(acc.minX, rect.x),
      minY: Math.min(acc.minY, rect.y),
      maxX: Math.max(acc.maxX, rect.x + rect.width),
      maxY: Math.max(acc.maxY, rect.y + rect.height),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  )

  const normalized = rects.map((rect) => ({
    ...rect,
    x: rect.x - bounds.minX,
    y: rect.y - bounds.minY,
  }))

  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY

  if (rotation === 0) return normalized

  if (rotation === 90) {
    return normalized.map((rect) => ({
      ...rect,
      x: height - (rect.y + rect.height),
      y: rect.x,
      width: rect.height,
      height: rect.width,
      rotation: ((rect.rotation + 90) % 360) as Rotation,
    }))
  }

  if (rotation === 180) {
    return normalized.map((rect) => ({
      ...rect,
      x: width - (rect.x + rect.width),
      y: height - (rect.y + rect.height),
      rotation: ((rect.rotation + 180) % 360) as Rotation,
    }))
  }

  return normalized.map((rect) => ({
    ...rect,
    x: rect.y,
    y: width - (rect.x + rect.width),
    width: rect.height,
    height: rect.width,
    rotation: ((rect.rotation + 270) % 360) as Rotation,
  }))
}

type UseBlueprintDomainParams = {
  activeBaseId: BaseId
  mode: string
  layout: LayoutState
  selection: string[]
  foundationIdSet: ReadonlySet<string>
  t: (key: string, params?: Record<string, string | number>) => string
}

export function useBlueprintDomain({ activeBaseId, mode, layout, selection, foundationIdSet, t }: UseBlueprintDomainParams) {
  const [blueprints, setBlueprints] = usePersistentState<BlueprintSnapshot[]>('stage1-blueprints', [])
  const [selectedBlueprintId, setSelectedBlueprintId] = usePersistentState<string | null>('stage1-selected-blueprint-id', null)
  const [clipboardBlueprint, setClipboardBlueprint] = usePersistentState<BlueprintSnapshot | null>('stage1-clipboard-blueprint', null)
  const [blueprintPlacementRotation, setBlueprintPlacementRotation] = usePersistentState<Rotation>('stage1-blueprint-rotation', 0)

  const saveSelectionAsBlueprint = useCallback(async () => {
    const selectedIdSet = new Set(selection)
    const selectedDevices = layout.devices.filter((device) => selectedIdSet.has(device.instanceId) && !foundationIdSet.has(device.instanceId))

    if (selectedDevices.length === 0) {
      showToast(t('toast.blueprintNoSelection'), { variant: 'warning' })
      return
    }

    const minX = Math.min(...selectedDevices.map((device) => device.origin.x))
    const minY = Math.min(...selectedDevices.map((device) => device.origin.y))
    const createdAt = new Date().toISOString()
    const defaultName = `BP-${createdAt.slice(0, 19).replace('T', ' ')}`
    const inputName = await dialogPrompt(t('dialog.blueprintNamePrompt'), defaultName, {
      title: t('left.blueprintSubMode'),
      confirmText: t('dialog.ok'),
      cancelText: t('dialog.cancel'),
      variant: 'info',
    })
    if (inputName === null) return
    const name = inputName.trim()
    if (!name) {
      showToast(t('toast.blueprintNameRequired'), { variant: 'warning' })
      return
    }
    const snapshot: BlueprintSnapshot = {
      id: `bp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      createdAt,
      baseId: activeBaseId,
      devices: selectedDevices.map((device) => ({
        typeId: device.typeId,
        rotation: device.rotation,
        origin: { x: device.origin.x - minX, y: device.origin.y - minY },
        config: cloneDeviceConfig(device.config),
      })),
    }

    try {
      setBlueprints((current) => [snapshot, ...current].slice(0, 100))
      showToast(t('toast.blueprintSaved', { name, count: snapshot.devices.length }))
    } catch {
      showToast(t('toast.blueprintSaveFailed'), { variant: 'error' })
    }
  }, [activeBaseId, foundationIdSet, layout.devices, selection, setBlueprints, t])

  const selectedBlueprint = useMemo(() => {
    if (!selectedBlueprintId) return null
    return blueprints.find((blueprint) => blueprint.id === selectedBlueprintId) ?? null
  }, [blueprints, selectedBlueprintId])

  const activePlacementBlueprint = useMemo(() => {
    if (clipboardBlueprint) return clipboardBlueprint
    if (mode === 'blueprint') return selectedBlueprint
    return null
  }, [clipboardBlueprint, mode, selectedBlueprint])

  const buildBlueprintPlacementPreview = useCallback(
    (snapshot: BlueprintSnapshot | null, anchorCell: { x: number; y: number }, placementRotation: Rotation): BlueprintPlacementPreview | null => {
      if (!snapshot || snapshot.devices.length === 0) return null

      const baseRects: BlueprintLocalRect[] = snapshot.devices.map((entry) => {
        const size = rotatedFootprintSize(DEVICE_TYPE_BY_ID[entry.typeId].size, entry.rotation)
        return {
          typeId: entry.typeId,
          rotation: entry.rotation,
          config: entry.config,
          x: entry.origin.x,
          y: entry.origin.y,
          width: size.width,
          height: size.height,
        }
      })

      const rotatedRects = rotateBlueprintRects(baseRects, placementRotation)
      const rotatedBounds = rotatedRects.reduce(
        (acc, rect) => ({
          minX: Math.min(acc.minX, rect.x),
          minY: Math.min(acc.minY, rect.y),
          maxX: Math.max(acc.maxX, rect.x + rect.width),
          maxY: Math.max(acc.maxY, rect.y + rect.height),
        }),
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
      )
      const blueprintWidth = rotatedBounds.maxX - rotatedBounds.minX
      const blueprintHeight = rotatedBounds.maxY - rotatedBounds.minY
      const topLeftX = Math.round(anchorCell.x + 0.5 - blueprintWidth / 2)
      const topLeftY = Math.round(anchorCell.y + 0.5 - blueprintHeight / 2)

      const previewDevices: DeviceInstance[] = rotatedRects.map((entry, index) => ({
        instanceId: `blueprint-preview-${index}`,
        typeId: entry.typeId,
        origin: {
          x: topLeftX + entry.x,
          y: topLeftY + entry.y,
        },
        rotation: entry.rotation,
        config: cloneDeviceConfig(entry.config),
      }))

      const invalidOutOfLot = previewDevices.some((device) => !isWithinLot(device, layout.lotSize))
      if (invalidOutOfLot) {
        return {
          devices: previewDevices,
          isValid: false,
          invalidMessageKey: 'toast.outOfLot',
        }
      }

      const previewLayout: LayoutState = {
        ...layout,
        devices: [...layout.devices, ...previewDevices],
      }
      const invalidConstraint = previewDevices
        .map((device) => validatePlacementConstraints(previewLayout, device))
        .find((result) => !result.isValid)

      if (invalidConstraint && !invalidConstraint.isValid) {
        return {
          devices: previewDevices,
          isValid: false,
          invalidMessageKey: invalidConstraint.messageKey ?? 'toast.invalidPlacementFallback',
        }
      }

      return {
        devices: previewDevices,
        isValid: true,
        invalidMessageKey: null,
      }
    },
    [layout],
  )

  return {
    blueprints,
    setBlueprints,
    selectedBlueprintId,
    setSelectedBlueprintId,
    clipboardBlueprint,
    setClipboardBlueprint,
    blueprintPlacementRotation,
    setBlueprintPlacementRotation,
    selectedBlueprint,
    activePlacementBlueprint,
    saveSelectionAsBlueprint,
    buildBlueprintPlacementPreview,
    cloneDeviceConfig,
  }
}
