import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import { BASE_BY_ID } from '../../domain/registry'
import { isWithinLot } from '../../domain/geometry'
import { isKnownDeviceTypeId } from '../../domain/shared/predicates'
import type { BaseId, DeviceInstance, LayoutState } from '../../domain/types'
import { usePersistentState } from '../../core/usePersistentState'
import { dialogConfirm } from '../../ui/dialog'
import { initialStorageConfig } from '../../sim/engine'

type UseBaseLayoutDomainParams = {
  cellSize: number
  baseCellSize: number
  setSelection: Dispatch<SetStateAction<string[]>>
  t: (key: string, params?: Record<string, string | number>) => string
}

function isKnownBaseId(baseId: unknown): baseId is BaseId {
  return typeof baseId === 'string' && baseId in BASE_BY_ID
}

function createLayoutForBase(baseId: BaseId): LayoutState {
  const base = BASE_BY_ID[baseId]
  return {
    baseId: base.id,
    lotSize: base.placeableSize,
    devices: base.foundationBuildings.map((building) => ({
      ...building,
      config: building.config ?? initialStorageConfig(building.typeId),
    })),
  }
}

function normalizeLayoutForBase(rawLayout: LayoutState | undefined, baseId: BaseId): LayoutState {
  const base = BASE_BY_ID[baseId]
  const fallback = createLayoutForBase(baseId)
  if (!rawLayout) return fallback

  const foundationById = new Map(base.foundationBuildings.map((device) => [device.instanceId, device]))
  const cleanedDevices = rawLayout.devices.filter((device) => isWithinLot(device, base.placeableSize))
  const cleanedWithoutFoundation = cleanedDevices.filter((device) => !foundationById.has(device.instanceId))
  const foundationDevices = base.foundationBuildings.map((building) => {
    const existing = cleanedDevices.find((device) => device.instanceId === building.instanceId)
    if (existing) return existing
    return {
      ...building,
      config: building.config ?? initialStorageConfig(building.typeId),
    }
  })

  return {
    baseId,
    lotSize: base.placeableSize,
    devices: [...foundationDevices, ...cleanedWithoutFoundation],
  }
}

export function useBaseLayoutDomain({ cellSize, baseCellSize, setSelection, t }: UseBaseLayoutDomainParams) {
  const [activeBaseId, setActiveBaseId] = usePersistentState<BaseId>('stage1-active-base', 'valley4_protocol_core')
  const [layoutsByBase, setLayoutsByBase] = usePersistentState<Partial<Record<BaseId, LayoutState>>>('stage1-layouts-by-base', {})

  const layout = useMemo(() => normalizeLayoutForBase(layoutsByBase[activeBaseId], activeBaseId), [layoutsByBase, activeBaseId])
  const setLayout = useCallback(
    (updater: LayoutState | ((current: LayoutState) => LayoutState)) => {
      setLayoutsByBase((currentAll) => {
        const currentLayout = normalizeLayoutForBase(currentAll[activeBaseId], activeBaseId)
        const nextLayout = typeof updater === 'function' ? (updater as (current: LayoutState) => LayoutState)(currentLayout) : updater
        const normalizedNext = normalizeLayoutForBase(nextLayout, activeBaseId)
        return {
          ...currentAll,
          [activeBaseId]: normalizedNext,
        }
      })
    },
    [activeBaseId, setLayoutsByBase],
  )

  const currentBaseId = activeBaseId
  const currentBase = BASE_BY_ID[currentBaseId]
  const foundationDevices = currentBase.foundationBuildings
  const foundationIdSet = new Set(foundationDevices.map((device) => device.instanceId))

  const zoomScale = cellSize / baseCellSize
  const canvasWidthCells = layout.lotSize + currentBase.outerRing.left + currentBase.outerRing.right
  const canvasHeightCells = layout.lotSize + currentBase.outerRing.top + currentBase.outerRing.bottom
  const canvasOffsetXPx = currentBase.outerRing.left * baseCellSize
  const canvasOffsetYPx = currentBase.outerRing.top * baseCellSize
  const canvasWidthPx = canvasWidthCells * baseCellSize
  const canvasHeightPx = canvasHeightCells * baseCellSize

  const layoutRef = useRef(layout)
  const unknownDevicePromptKeyRef = useRef<string>('')

  useEffect(() => {
    layoutRef.current = layout
  }, [layout])

  const unknownDevices = useMemo(
    () => layout.devices.filter((device) => !isKnownDeviceTypeId((device as DeviceInstance & { typeId: unknown }).typeId)),
    [layout.devices],
  )

  useEffect(() => {
    if (isKnownBaseId(activeBaseId)) return
    setActiveBaseId('valley4_protocol_core')
  }, [activeBaseId, setActiveBaseId])

  useEffect(() => {
    if (unknownDevices.length === 0) {
      unknownDevicePromptKeyRef.current = ''
      return
    }

    const promptKey = unknownDevices
      .map((device) => `${device.instanceId}:${String((device as DeviceInstance & { typeId: unknown }).typeId)}`)
      .join('|')
    if (promptKey === unknownDevicePromptKeyRef.current) return
    unknownDevicePromptKeyRef.current = promptKey

    const unknownTypeIds = Array.from(
      new Set(unknownDevices.map((device) => String((device as DeviceInstance & { typeId: unknown }).typeId))),
    )
    let cancelled = false

    void (async () => {
      const confirmed = await dialogConfirm(
        t('dialog.legacyUnknownTypesConfirm', { types: unknownTypeIds.join(', ') }),
        {
          title: t('dialog.title.confirm'),
          confirmText: t('dialog.ok'),
          cancelText: t('dialog.cancel'),
          variant: 'warning',
        },
      )
      if (!confirmed || cancelled) return

      const removedIds = new Set(unknownDevices.map((device) => device.instanceId))
      setLayout((current) => ({
        ...current,
        devices: current.devices.filter((device) => isKnownDeviceTypeId((device as DeviceInstance & { typeId: unknown }).typeId)),
      }))
      setSelection((current) => current.filter((id) => !removedIds.has(id)))
    })()

    return () => {
      cancelled = true
    }
  }, [unknownDevices, setLayout, setSelection, t])

  return {
    activeBaseId,
    setActiveBaseId,
    layout,
    setLayout,
    currentBaseId,
    currentBase,
    foundationIdSet,
    zoomScale,
    canvasOffsetXPx,
    canvasOffsetYPx,
    canvasWidthPx,
    canvasHeightPx,
    layoutRef,
    unknownDevicesCount: unknownDevices.length,
  }
}