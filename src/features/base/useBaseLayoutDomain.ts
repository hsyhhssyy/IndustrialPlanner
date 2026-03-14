import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import { isBeltLike, isPipeLike } from '../../domain/geometry'
import { BASE_BY_ID } from '../../domain/registry'
import { isKnownDeviceTypeId } from '../../domain/shared/predicates'
import { isDeviceWithinAllowedPlacementArea } from '../../domain/shared/placementArea'
import type { BaseId, DeviceInstance, LayoutState } from '../../domain/types'
import { usePersistentState } from '../../core/usePersistentState'
import { dialogConfirm } from '../../ui/dialog'
import { getDeviceLabel, type Language } from '../../i18n'
import { initialStorageConfig } from '../../sim/engine'
import { APP_VERSION, normalizeLayoutHistoryByBaseStorage, normalizeLayoutsByBaseStorage, type LayoutHistoryByBaseStorage } from '../../migrations/versioning'

type UseBaseLayoutDomainParams = {
  cellSize: number
  baseCellSize: number
  language: Language
  setSelection: Dispatch<SetStateAction<string[]>>
  t: (key: string, params?: Record<string, string | number>) => string
}

type LayoutsByBaseStorage = {
  version: string
  layoutsByBase: Partial<Record<BaseId, LayoutState>>
}

type LayoutHistoryEntry = {
  past: LayoutState[]
  future: LayoutState[]
}

type LayoutHistoryViewEntry = {
  index: number
  isCurrent: boolean
  layout: LayoutState
  summary: string
}

const MAX_LAYOUT_HISTORY_ENTRIES = 100
const LAYOUT_HISTORY_STORAGE_KEY = 'stage6-layout-history-by-base'

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
  const cleanedDevices = rawLayout.devices.filter((device) => isDeviceWithinAllowedPlacementArea(device, base.placeableSize, base.outerRing))
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

function cloneLayoutState(layout: LayoutState): LayoutState {
  if (typeof structuredClone === 'function') {
    return structuredClone(layout)
  }
  return JSON.parse(JSON.stringify(layout)) as LayoutState
}

function areLayoutsEqual(left: LayoutState, right: LayoutState) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isSameOrigin(left: DeviceInstance, right: DeviceInstance) {
  return left.origin.x === right.origin.x && left.origin.y === right.origin.y
}

function isSameConfig(left: DeviceInstance, right: DeviceInstance) {
  return JSON.stringify(left.config) === JSON.stringify(right.config)
}

function formatDeviceCount(language: Language, count: number) {
  return language === 'zh-CN' ? `${count} 个设备` : `${count} devices`
}

function summarizeAddedDevices(language: Language, devices: DeviceInstance[]) {
  if (devices.length === 0) return language === 'zh-CN' ? '空变更' : 'Empty change'
  if (devices.every((device) => isBeltLike(device.typeId))) {
    return language === 'zh-CN'
      ? `铺设 ${devices.length} 段传送带物流`
      : `Placed ${devices.length} belt segments`
  }
  if (devices.every((device) => isPipeLike(device.typeId))) {
    return language === 'zh-CN'
      ? `铺设 ${devices.length} 段管道物流`
      : `Placed ${devices.length} pipe segments`
  }
  if (devices.length === 1) {
    return language === 'zh-CN'
      ? `放置 ${getDeviceLabel(language, devices[0].typeId)}`
      : `Placed ${getDeviceLabel(language, devices[0].typeId)}`
  }

  const uniqueTypeIds = new Set(devices.map((device) => device.typeId))
  if (uniqueTypeIds.size === 1) {
    return language === 'zh-CN'
      ? `放置 ${devices.length} 个${getDeviceLabel(language, devices[0].typeId)}`
      : `Placed ${devices.length} ${getDeviceLabel(language, devices[0].typeId)}`
  }
  return language === 'zh-CN' ? `放置蓝图（${formatDeviceCount(language, devices.length)}）` : `Placed blueprint (${formatDeviceCount(language, devices.length)})`
}

function summarizeRemovedDevices(language: Language, devices: DeviceInstance[]) {
  if (devices.length === 0) return language === 'zh-CN' ? '空变更' : 'Empty change'
  if (devices.every((device) => isBeltLike(device.typeId))) {
    return language === 'zh-CN'
      ? `删除 ${devices.length} 段传送带物流`
      : `Deleted ${devices.length} belt segments`
  }
  if (devices.every((device) => isPipeLike(device.typeId))) {
    return language === 'zh-CN'
      ? `删除 ${devices.length} 段管道物流`
      : `Deleted ${devices.length} pipe segments`
  }
  if (devices.length === 1) {
    return language === 'zh-CN'
      ? `删除 ${getDeviceLabel(language, devices[0].typeId)}`
      : `Deleted ${getDeviceLabel(language, devices[0].typeId)}`
  }

  const uniqueTypeIds = new Set(devices.map((device) => device.typeId))
  if (uniqueTypeIds.size === 1) {
    return language === 'zh-CN'
      ? `删除 ${devices.length} 个${getDeviceLabel(language, devices[0].typeId)}`
      : `Deleted ${devices.length} ${getDeviceLabel(language, devices[0].typeId)}`
  }
  return language === 'zh-CN' ? `删除 ${formatDeviceCount(language, devices.length)}` : `Deleted ${formatDeviceCount(language, devices.length)}`
}

function summarizeLayoutChange(previous: LayoutState | null, next: LayoutState, language: Language) {
  if (!previous) {
    return language === 'zh-CN' ? '初始布局' : 'Initial layout'
  }

  const previousById = new Map(previous.devices.map((device) => [device.instanceId, device]))
  const nextById = new Map(next.devices.map((device) => [device.instanceId, device]))

  const added = next.devices.filter((device) => !previousById.has(device.instanceId))
  const removed = previous.devices.filter((device) => !nextById.has(device.instanceId))
  const changed = next.devices.flatMap((device) => {
    const previousDevice = previousById.get(device.instanceId)
    if (!previousDevice) return []
    if (JSON.stringify(previousDevice) === JSON.stringify(device)) return []
    return [{ previous: previousDevice, next: device }]
  })

  if (added.length > 0 && removed.length === 0 && changed.length === 0) {
    return summarizeAddedDevices(language, added)
  }

  if (removed.length > 0 && added.length === 0 && changed.length === 0) {
    return summarizeRemovedDevices(language, removed)
  }

  if (changed.length > 0 && added.length === 0 && removed.length === 0) {
    const movedOnly = changed.every(({ previous: previousDevice, next: nextDevice }) => !isSameOrigin(previousDevice, nextDevice) && previousDevice.rotation === nextDevice.rotation && isSameConfig(previousDevice, nextDevice))
    const rotatedOnly = changed.every(({ previous: previousDevice, next: nextDevice }) => isSameOrigin(previousDevice, nextDevice) && previousDevice.rotation !== nextDevice.rotation && isSameConfig(previousDevice, nextDevice))
    const configOnly = changed.every(({ previous: previousDevice, next: nextDevice }) => isSameOrigin(previousDevice, nextDevice) && previousDevice.rotation === nextDevice.rotation && !isSameConfig(previousDevice, nextDevice))

    if (configOnly) {
      if (changed.length === 1) {
        return language === 'zh-CN'
          ? `调整 ${getDeviceLabel(language, changed[0].next.typeId)} 配置`
          : `Adjusted ${getDeviceLabel(language, changed[0].next.typeId)} configuration`
      }
      return language === 'zh-CN' ? `调整 ${formatDeviceCount(language, changed.length)} 配置` : `Adjusted ${formatDeviceCount(language, changed.length)} configuration`
    }

    if (movedOnly) {
      return language === 'zh-CN' ? `移动 ${formatDeviceCount(language, changed.length)}` : `Moved ${formatDeviceCount(language, changed.length)}`
    }

    if (rotatedOnly) {
      return language === 'zh-CN' ? `旋转 ${formatDeviceCount(language, changed.length)}` : `Rotated ${formatDeviceCount(language, changed.length)}`
    }

    return language === 'zh-CN' ? `调整 ${formatDeviceCount(language, changed.length)}` : `Adjusted ${formatDeviceCount(language, changed.length)}`
  }

  const fragments = [
    added.length > 0 ? (language === 'zh-CN' ? `放置 ${added.length}` : `+${added.length}`) : null,
    removed.length > 0 ? (language === 'zh-CN' ? `删除 ${removed.length}` : `-${removed.length}`) : null,
    changed.length > 0 ? (language === 'zh-CN' ? `调整 ${changed.length}` : `~${changed.length}`) : null,
  ].filter(Boolean)
  return language === 'zh-CN' ? `复合变更（${fragments.join('，')}）` : `Composite change (${fragments.join(', ')})`
}

function buildHistoryViewEntries(history: LayoutHistoryEntry | undefined, currentLayout: LayoutState, language: Language): LayoutHistoryViewEntry[] {
  const past = history?.past ?? []
  const future = history?.future ?? []
  const entries = [...past, currentLayout, ...future]
  return entries.map((layout, index) => ({
    index,
    isCurrent: index === past.length,
    layout: cloneLayoutState(layout),
    summary: summarizeLayoutChange(index > 0 ? entries[index - 1] : null, layout, language),
  }))
}

export function useBaseLayoutDomain({ cellSize, baseCellSize, language, setSelection, t }: UseBaseLayoutDomainParams) {
  const [activeBaseId, setActiveBaseId] = usePersistentState<BaseId>('stage1-active-base', 'valley4_protocol_core')
  const [layoutsStorage, setLayoutsStorage] = usePersistentState<LayoutsByBaseStorage>(
    'stage1-layouts-by-base',
    { version: APP_VERSION, layoutsByBase: {} },
    normalizeLayoutsByBaseStorage,
  )
  const [layoutHistoryStorage, setLayoutHistoryStorage] = usePersistentState<LayoutHistoryByBaseStorage>(
    LAYOUT_HISTORY_STORAGE_KEY,
    { version: APP_VERSION, historiesByBase: {} },
    normalizeLayoutHistoryByBaseStorage,
  )

  const layoutsByBase = layoutsStorage.layoutsByBase

  const layout = useMemo(() => normalizeLayoutForBase(layoutsByBase[activeBaseId], activeBaseId), [layoutsByBase, activeBaseId])

  const currentBaseId = activeBaseId
  const currentBase = BASE_BY_ID[currentBaseId]
  const foundationDevices = currentBase.foundationBuildings
  const foundationIdSet = new Set(foundationDevices.map((device) => device.instanceId))
  const foundationMovableIdSet = new Set(
    foundationDevices.filter((device) => device.movable).map((device) => device.instanceId),
  )

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

  const currentHistory = layoutHistoryStorage.historiesByBase[activeBaseId] ?? { past: [], future: [] }

  const writeHistoryForActiveBase = useCallback(
    (nextHistory: LayoutHistoryEntry) => {
      setLayoutHistoryStorage((currentStorage) => ({
        version: APP_VERSION,
        historiesByBase: {
          ...currentStorage.historiesByBase,
          [activeBaseId]: nextHistory,
        },
      }))
    },
    [activeBaseId, setLayoutHistoryStorage],
  )

  const writeLayoutForActiveBase = useCallback(
    (nextLayout: LayoutState) => {
      setLayoutsStorage((currentStorage) => ({
        version: APP_VERSION,
        layoutsByBase: {
          ...currentStorage.layoutsByBase,
          [activeBaseId]: nextLayout,
        },
      }))
    },
    [activeBaseId, setLayoutsStorage],
  )

  const setLayout = useCallback(
    (updater: LayoutState | ((current: LayoutState) => LayoutState)) => {
      const currentLayout = normalizeLayoutForBase(layoutRef.current, activeBaseId)
      const nextLayout = typeof updater === 'function' ? (updater as (current: LayoutState) => LayoutState)(currentLayout) : updater
      const normalizedNext = normalizeLayoutForBase(nextLayout, activeBaseId)
      if (areLayoutsEqual(currentLayout, normalizedNext)) return

      writeHistoryForActiveBase({
        past: [...currentHistory.past, cloneLayoutState(currentLayout)].slice(-MAX_LAYOUT_HISTORY_ENTRIES),
        future: [],
      })
      layoutRef.current = normalizedNext
      writeLayoutForActiveBase(normalizedNext)
    },
    [activeBaseId, currentHistory, writeHistoryForActiveBase, writeLayoutForActiveBase],
  )

  const undoLayout = useCallback(() => {
    if (!currentHistory || currentHistory.past.length === 0) return false

    const currentLayout = normalizeLayoutForBase(layoutRef.current, activeBaseId)
    const previousLayout = normalizeLayoutForBase(currentHistory.past[currentHistory.past.length - 1], activeBaseId)
    writeHistoryForActiveBase({
      past: currentHistory.past.slice(0, -1),
      future: [cloneLayoutState(currentLayout), ...currentHistory.future].slice(0, MAX_LAYOUT_HISTORY_ENTRIES),
    })
    layoutRef.current = previousLayout
    writeLayoutForActiveBase(previousLayout)
    return true
  }, [activeBaseId, currentHistory, writeHistoryForActiveBase, writeLayoutForActiveBase])

  const redoLayout = useCallback(() => {
    if (!currentHistory || currentHistory.future.length === 0) return false

    const currentLayout = normalizeLayoutForBase(layoutRef.current, activeBaseId)
    const [nextLayoutSnapshot, ...remainingFuture] = currentHistory.future
    const nextLayout = normalizeLayoutForBase(nextLayoutSnapshot, activeBaseId)
    writeHistoryForActiveBase({
      past: [...currentHistory.past, cloneLayoutState(currentLayout)].slice(-MAX_LAYOUT_HISTORY_ENTRIES),
      future: remainingFuture,
    })
    layoutRef.current = nextLayout
    writeLayoutForActiveBase(nextLayout)
    return true
  }, [activeBaseId, currentHistory, writeHistoryForActiveBase, writeLayoutForActiveBase])

  const jumpToHistory = useCallback(
    (index: number) => {
      const currentLayout = normalizeLayoutForBase(layoutRef.current, activeBaseId)
      const combined = [...currentHistory.past, currentLayout, ...currentHistory.future]
      if (index < 0 || index >= combined.length) return false
      const currentIndex = currentHistory.past.length
      if (index === currentIndex) return false

      const nextLayout = normalizeLayoutForBase(combined[index], activeBaseId)
      writeHistoryForActiveBase({
        past: combined.slice(0, index).map((entry) => cloneLayoutState(normalizeLayoutForBase(entry, activeBaseId))).slice(-MAX_LAYOUT_HISTORY_ENTRIES),
        future: combined.slice(index + 1).map((entry) => cloneLayoutState(normalizeLayoutForBase(entry, activeBaseId))).slice(0, MAX_LAYOUT_HISTORY_ENTRIES),
      })
      layoutRef.current = nextLayout
      writeLayoutForActiveBase(nextLayout)
      return true
    },
    [activeBaseId, currentHistory, writeHistoryForActiveBase, writeLayoutForActiveBase],
  )

  const canUndo = currentHistory.past.length > 0
  const canRedo = currentHistory.future.length > 0
  const historyEntries = useMemo(
    () => buildHistoryViewEntries(currentHistory, layout, language),
    [currentHistory, language, layout],
  )

  const unknownDevices = useMemo(
    () => layout.devices.filter((device) => !isKnownDeviceTypeId((device as DeviceInstance & { typeId: unknown }).typeId)),
    [layout.devices],
  )

  useEffect(() => {
    if (isKnownBaseId(activeBaseId)) return
    setActiveBaseId('valley4_protocol_core')
  }, [activeBaseId, setActiveBaseId])

  useEffect(() => {
    const existingIds = new Set(layout.devices.map((device) => device.instanceId))
    setSelection((current) => current.filter((id) => existingIds.has(id)))
  }, [layout, setSelection])

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
    foundationMovableIdSet,
    zoomScale,
    canvasOffsetXPx,
    canvasOffsetYPx,
    canvasWidthPx,
    canvasHeightPx,
    layoutRef,
    canUndo,
    canRedo,
    undoLayout,
    redoLayout,
    historyEntries,
    jumpToHistory,
    unknownDevicesCount: unknownDevices.length,
  }
}