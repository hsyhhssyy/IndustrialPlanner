import { useCallback, useMemo } from 'react'
import { usePersistentState } from '../../core/usePersistentState'
import { uiEffects } from '../../app/uiEffects'
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
  updatedAt?: string
  version?: number
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

type BlueprintSharePayload = {
  schema: 'industrial-planner-blueprint'
  version: number
  name: string
  createdAt: string
  baseId: string
  devices: BlueprintDeviceSnapshot[]
}

type BlueprintShareImport = BlueprintSharePayload | { blueprint: BlueprintSharePayload }

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

function sanitizeRotation(value: unknown): Rotation {
  if (value === 0 || value === 90 || value === 180 || value === 270) return value
  return 0
}

function sanitizeName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'blueprint'
}

function normalizeSharePayload(input: unknown): BlueprintSharePayload | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as BlueprintShareImport
  const payload = 'blueprint' in candidate ? candidate.blueprint : candidate
  if (!payload || typeof payload !== 'object') return null

  const schema = (payload as Record<string, unknown>).schema
  const version = (payload as Record<string, unknown>).version
  const name = (payload as Record<string, unknown>).name
  const createdAt = (payload as Record<string, unknown>).createdAt
  const baseId = (payload as Record<string, unknown>).baseId
  const devices = (payload as Record<string, unknown>).devices

  if (schema !== 'industrial-planner-blueprint') return null
  if (typeof version !== 'number' || version < 1) return null
  if (typeof name !== 'string' || !name.trim()) return null
  if (typeof createdAt !== 'string' || !createdAt) return null
  if (typeof baseId !== 'string' || !baseId) return null
  if (!Array.isArray(devices) || devices.length === 0) return null

  const parsedDevices: BlueprintDeviceSnapshot[] = []
  for (const entry of devices) {
    if (!entry || typeof entry !== 'object') return null
    const typeId = (entry as Record<string, unknown>).typeId
    const rotation = (entry as Record<string, unknown>).rotation
    const origin = (entry as Record<string, unknown>).origin
    const config = (entry as Record<string, unknown>).config
    if (typeof typeId !== 'string' || !(typeId in DEVICE_TYPE_BY_ID)) return null
    if (!origin || typeof origin !== 'object') return null
    const x = (origin as Record<string, unknown>).x
    const y = (origin as Record<string, unknown>).y
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null
    parsedDevices.push({
      typeId: typeId as DeviceTypeId,
      rotation: sanitizeRotation(rotation),
      origin: { x: Math.round(x), y: Math.round(y) },
      config: cloneDeviceConfig((config ?? {}) as DeviceInstance['config']),
    })
  }

  return {
    schema: 'industrial-planner-blueprint',
    version,
    name: name.trim(),
    createdAt,
    baseId,
    devices: parsedDevices,
  }
}

type UseBlueprintDomainParams = {
  activeBaseId: BaseId
  placeOperation: 'default' | 'belt' | 'pipe' | 'blueprint'
  layout: LayoutState
  selection: string[]
  foundationIdSet: ReadonlySet<string>
  t: (key: string, params?: Record<string, string | number>) => string
}

export function useBlueprintDomain({ activeBaseId, placeOperation, layout, selection, foundationIdSet, t }: UseBlueprintDomainParams) {
  const [blueprints, setBlueprints] = usePersistentState<BlueprintSnapshot[]>('stage1-blueprints', [])
  const [selectedBlueprintId, setSelectedBlueprintId] = usePersistentState<string | null>('stage1-selected-blueprint-id', null)
  const [armedBlueprintId, setArmedBlueprintId] = usePersistentState<string | null>('stage1-armed-blueprint-id', null)
  const [clipboardBlueprint, setClipboardBlueprint] = usePersistentState<BlueprintSnapshot | null>('stage1-clipboard-blueprint', null)
  const [blueprintPlacementRotation, setBlueprintPlacementRotation] = usePersistentState<Rotation>('stage1-blueprint-rotation', 0)

  const saveSelectionAsBlueprint = useCallback(async () => {
    const selectedIdSet = new Set(selection)
    const selectedDevices = layout.devices.filter((device) => selectedIdSet.has(device.instanceId) && !foundationIdSet.has(device.instanceId))

    if (selectedDevices.length === 0) {
      uiEffects.toast(t('toast.blueprintNoSelection'), { variant: 'warning' })
      return
    }

    const minX = Math.min(...selectedDevices.map((device) => device.origin.x))
    const minY = Math.min(...selectedDevices.map((device) => device.origin.y))
    const createdAt = new Date().toISOString()
    const defaultName = `BP-${createdAt.slice(0, 19).replace('T', ' ')}`
    const inputName = await uiEffects.prompt(t('dialog.blueprintNamePrompt'), defaultName, {
      title: t('left.blueprintSubMode'),
      confirmText: t('dialog.ok'),
      cancelText: t('dialog.cancel'),
      variant: 'info',
    })
    if (inputName === null) return
    const name = inputName.trim()
    if (!name) {
      uiEffects.toast(t('toast.blueprintNameRequired'), { variant: 'warning' })
      return
    }
    const snapshot: BlueprintSnapshot = {
      id: `bp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      createdAt,
      updatedAt: createdAt,
      version: 1,
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
      uiEffects.toast(t('toast.blueprintSaved', { name, count: snapshot.devices.length }))
    } catch {
      uiEffects.toast(t('toast.blueprintSaveFailed'), { variant: 'error' })
    }
  }, [activeBaseId, foundationIdSet, layout.devices, selection, setBlueprints, t])

  const selectedBlueprint = useMemo(() => {
    if (!selectedBlueprintId) return null
    return blueprints.find((blueprint) => blueprint.id === selectedBlueprintId) ?? null
  }, [blueprints, selectedBlueprintId])

  const armedBlueprint = useMemo(() => {
    if (!armedBlueprintId) return null
    return blueprints.find((blueprint) => blueprint.id === armedBlueprintId) ?? null
  }, [armedBlueprintId, blueprints])

  const selectBlueprint = useCallback(
    (id: string | null) => {
      setSelectedBlueprintId(id)
      if (id === null) {
        setArmedBlueprintId(null)
      }
    },
    [setArmedBlueprintId, setSelectedBlueprintId],
  )

  const armBlueprint = useCallback(
    (id: string) => {
      const target = blueprints.find((blueprint) => blueprint.id === id)
      if (!target) return
      setSelectedBlueprintId(id)
      setArmedBlueprintId(id)
      setBlueprintPlacementRotation(0)
    },
    [blueprints, setArmedBlueprintId, setBlueprintPlacementRotation, setSelectedBlueprintId],
  )

  const disarmBlueprint = useCallback(() => {
    setArmedBlueprintId(null)
    setBlueprintPlacementRotation(0)
  }, [setArmedBlueprintId, setBlueprintPlacementRotation])

  const renameBlueprint = useCallback(
    async (id: string) => {
      const target = blueprints.find((blueprint) => blueprint.id === id)
      if (!target) return
      const inputName = await uiEffects.prompt(t('dialog.blueprintRenamePrompt'), target.name, {
        title: t('left.blueprintSubMode'),
        confirmText: t('dialog.ok'),
        cancelText: t('dialog.cancel'),
        variant: 'info',
      })
      if (inputName === null) return
      const nextName = inputName.trim()
      if (!nextName) {
        uiEffects.toast(t('toast.blueprintNameRequired'), { variant: 'warning' })
        return
      }
      const updatedAt = new Date().toISOString()
      setBlueprints((current) =>
        current.map((blueprint) =>
          blueprint.id === id
            ? {
                ...blueprint,
                name: nextName,
                updatedAt,
                version: blueprint.version ?? 1,
              }
            : blueprint,
        ),
      )
      uiEffects.toast(t('toast.blueprintRenamed', { name: nextName }))
    },
    [blueprints, setBlueprints, t],
  )

  const getBlueprintShareText = useCallback(
    (id: string) => {
      const target = blueprints.find((blueprint) => blueprint.id === id)
      if (!target) return null
      const payload: BlueprintSharePayload = {
        schema: 'industrial-planner-blueprint',
        version: target.version ?? 1,
        name: target.name,
        createdAt: target.createdAt,
        baseId: target.baseId,
        devices: target.devices,
      }
      return JSON.stringify(payload, null, 2)
    },
    [blueprints],
  )

  const shareBlueprintToClipboard = useCallback(
    async (id: string) => {
      const target = blueprints.find((blueprint) => blueprint.id === id)
      if (!target) return
      const shareText = getBlueprintShareText(id)
      if (!shareText) return
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        uiEffects.toast(t('toast.blueprintShareUnsupported'), { variant: 'warning' })
        return
      }
      try {
        await navigator.clipboard.writeText(shareText)
        uiEffects.toast(t('toast.blueprintSharedClipboard', { name: target.name }))
      } catch {
        uiEffects.toast(t('toast.blueprintShareFailed'), { variant: 'error' })
      }
    },
    [blueprints, getBlueprintShareText, t],
  )

  const shareBlueprintToFile = useCallback(
    (id: string) => {
      const target = blueprints.find((blueprint) => blueprint.id === id)
      if (!target) return
      const shareText = getBlueprintShareText(id)
      if (!shareText) return
      const blob = new Blob([shareText], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const downloadName = `${sanitizeName(target.name)}.blueprint.json`
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = downloadName
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      uiEffects.toast(t('toast.blueprintSharedFile', { name: target.name }))
    },
    [blueprints, getBlueprintShareText, t],
  )

  const importBlueprintFromText = useCallback(
    async (rawText: string) => {
      const text = rawText.trim()
      if (!text) {
        uiEffects.toast(t('toast.blueprintImportEmpty'), { variant: 'warning' })
        return false
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        uiEffects.toast(t('toast.blueprintImportInvalidJson'), { variant: 'warning' })
        return false
      }

      const payload = normalizeSharePayload(parsed)
      if (!payload) {
        uiEffects.toast(t('toast.blueprintImportInvalidPayload'), { variant: 'warning' })
        return false
      }

      const createdAt = new Date().toISOString()
      const snapshot: BlueprintSnapshot = {
        id: `bp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: payload.name,
        createdAt,
        updatedAt: createdAt,
        version: payload.version,
        baseId: activeBaseId,
        devices: payload.devices.map((device) => ({
          typeId: device.typeId,
          rotation: sanitizeRotation(device.rotation),
          origin: { ...device.origin },
          config: cloneDeviceConfig(device.config),
        })),
      }

      setBlueprints((current) => [snapshot, ...current].slice(0, 100))
      setSelectedBlueprintId(snapshot.id)
      uiEffects.toast(t('toast.blueprintImported', { name: snapshot.name, count: snapshot.devices.length }))
      return true
    },
    [activeBaseId, setBlueprints, setSelectedBlueprintId, t],
  )

  const importBlueprintFromFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text()
        return await importBlueprintFromText(text)
      } catch {
        uiEffects.toast(t('toast.blueprintImportFileFailed'), { variant: 'error' })
        return false
      }
    },
    [importBlueprintFromText, t],
  )

  const deleteBlueprint = useCallback(
    async (id: string) => {
      const target = blueprints.find((blueprint) => blueprint.id === id)
      if (!target) return
      const confirmed = await uiEffects.confirm(t('dialog.blueprintDeleteConfirm', { name: target.name }), {
        title: t('dialog.title.confirm'),
        confirmText: t('dialog.ok'),
        cancelText: t('dialog.cancel'),
        variant: 'warning',
      })
      if (!confirmed) return
      setBlueprints((current) => current.filter((blueprint) => blueprint.id !== id))
      if (selectedBlueprintId === id) {
        setSelectedBlueprintId(null)
      }
      if (armedBlueprintId === id) {
        setArmedBlueprintId(null)
        setBlueprintPlacementRotation(0)
      }
      uiEffects.toast(t('toast.blueprintDeleted', { name: target.name }))
    },
    [armedBlueprintId, blueprints, selectedBlueprintId, setArmedBlueprintId, setBlueprintPlacementRotation, setBlueprints, setSelectedBlueprintId, t],
  )

  const activePlacementBlueprint = useMemo(() => {
    if (clipboardBlueprint) return clipboardBlueprint
    if (placeOperation === 'blueprint') return armedBlueprint
    return null
  }, [armedBlueprint, clipboardBlueprint, placeOperation])

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
    armedBlueprintId,
    setArmedBlueprintId,
    clipboardBlueprint,
    setClipboardBlueprint,
    blueprintPlacementRotation,
    setBlueprintPlacementRotation,
    selectedBlueprint,
    armedBlueprint,
    selectBlueprint,
    armBlueprint,
    disarmBlueprint,
    renameBlueprint,
    shareBlueprintToClipboard,
    shareBlueprintToFile,
    importBlueprintFromText,
    importBlueprintFromFile,
    deleteBlueprint,
    activePlacementBlueprint,
    saveSelectionAsBlueprint,
    buildBlueprintPlacementPreview,
    cloneDeviceConfig,
  }
}
