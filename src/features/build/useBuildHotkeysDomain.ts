import { useEffect } from 'react'
import { DEVICE_TYPE_BY_ID } from '../../domain/registry'
import { validatePlacementConstraints } from '../../domain/placement'
import { isDeviceWithinAllowedPlacementArea } from '../../domain/shared/placementArea'
import { rotatedFootprintSize } from '../../domain/shared/math'
import { showToast } from '../../ui/toast'
import type { DeviceInstance, DeviceTypeDef, DeviceTypeId, LayoutState, Rotation } from '../../domain/types'
import type { OuterRing } from './buildInteraction.contract'
import { buildPlaceGroups, QUICK_PLACE_GROUP_BY_KEY, type PlaceGroupKey } from './useBuildDomain'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Language } from '../../i18n'

const NON_ROTATABLE_PLACED_TYPE_IDS = new Set<DeviceTypeId>(['item_port_unloader_1', 'item_port_loader_1'])
const PAN_KEYS = new Set(['w', 'a', 's', 'd'])
const PAN_SPEED_CELLS_PER_SECOND = 14

type UseBuildHotkeysDomainParams = {
  simIsRunning: boolean
  mode: string
  language: Language
  canUsePipePlacement: boolean
  placeOperation: 'default' | 'belt' | 'pipe' | 'blueprint'
  placeType: DeviceTypeId | ''
  visiblePlaceableTypes: DeviceTypeDef[]
  setPlaceRotation: (updater: Rotation | ((current: Rotation) => Rotation)) => void
  setPlaceOperation: Dispatch<SetStateAction<'default' | 'belt' | 'pipe' | 'blueprint'>>
  setPlaceType: Dispatch<SetStateAction<DeviceTypeId | ''>>
  setViewOffset: Dispatch<SetStateAction<{ x: number; y: number }>>
  clampViewportOffset: (
    offset: { x: number; y: number },
    viewportSize: { width: number; height: number },
    canvasSize: { width: number; height: number },
  ) => { x: number; y: number }
  viewportRef: MutableRefObject<HTMLDivElement | null>
  zoomScale: number
  canvasWidthPx: number
  canvasHeightPx: number
  cellSize: number
  selection: string[]
  setSelection: Dispatch<SetStateAction<string[]>>
  layout: LayoutState
  foundationIdSet: ReadonlySet<string>
  foundationMovableIdSet: ReadonlySet<string>
  currentBaseOuterRing: OuterRing
  setLayout: (updater: LayoutState | ((current: LayoutState) => LayoutState)) => void
  returnToIdle: () => void
  resetPlacementTrace: () => void
  highlightedPlaceGroup: PlaceGroupKey | null
  setHighlightedPlaceGroup: Dispatch<SetStateAction<PlaceGroupKey | null>>
  undoLayout: () => boolean
  redoLayout: () => boolean
  outOfLotToastKey: string
  fallbackPlacementToastKey: string
  t: (key: string, params?: Record<string, string | number>) => string
}

function getDigitHotkeyIndex(event: KeyboardEvent) {
  const code = event.code
  if (code.startsWith('Digit')) {
    const value = Number.parseInt(code.slice(5), 10)
    if (Number.isNaN(value)) return null
    return value === 0 ? 9 : value - 1
  }
  if (code.startsWith('Numpad')) {
    const value = Number.parseInt(code.slice(6), 10)
    if (Number.isNaN(value)) return null
    return value === 0 ? 9 : value - 1
  }
  return null
}

export function useBuildHotkeysDomain({
  simIsRunning,
  mode,
  language,
  canUsePipePlacement,
  placeOperation,
  placeType,
  visiblePlaceableTypes,
  setPlaceRotation,
  setPlaceOperation,
  setPlaceType,
  setViewOffset,
  clampViewportOffset,
  viewportRef,
  zoomScale,
  canvasWidthPx,
  canvasHeightPx,
  cellSize,
  selection,
  setSelection,
  layout,
  foundationIdSet,
  foundationMovableIdSet,
  currentBaseOuterRing,
  setLayout,
  returnToIdle,
  resetPlacementTrace,
  highlightedPlaceGroup,
  setHighlightedPlaceGroup,
  undoLayout,
  redoLayout,
  outOfLotToastKey,
  fallbackPlacementToastKey,
  t,
}: UseBuildHotkeysDomainParams) {
  useEffect(() => {
    const placeGroups = buildPlaceGroups(visiblePlaceableTypes, language)
    const placeGroupByKey = new Map(placeGroups.map((entry) => [entry.key, entry]))
    const pressedPanKeys = new Set<string>()
    let panFrameId: number | null = null
    let lastPanTimestamp: number | null = null

    const stopPanLoop = () => {
      if (panFrameId !== null) {
        window.cancelAnimationFrame(panFrameId)
        panFrameId = null
      }
      lastPanTimestamp = null
    }

    const stepPanLoop = (timestamp: number) => {
      if (pressedPanKeys.size === 0) {
        stopPanLoop()
        return
      }
      const viewport = viewportRef.current
      if (viewport) {
        const elapsedMs = lastPanTimestamp === null ? 16 : Math.min(48, timestamp - lastPanTimestamp)
        lastPanTimestamp = timestamp
        const deltaUnit = (PAN_SPEED_CELLS_PER_SECOND * cellSize * elapsedMs) / 1000
        let dx = 0
        let dy = 0
        if (pressedPanKeys.has('a')) dx += deltaUnit
        if (pressedPanKeys.has('d')) dx -= deltaUnit
        if (pressedPanKeys.has('w')) dy += deltaUnit
        if (pressedPanKeys.has('s')) dy -= deltaUnit
        if (dx !== 0 && dy !== 0) {
          dx *= Math.SQRT1_2
          dy *= Math.SQRT1_2
        }
        if (dx !== 0 || dy !== 0) {
          setViewOffset((current) =>
            clampViewportOffset(
              { x: current.x + dx, y: current.y + dy },
              { width: viewport.clientWidth, height: viewport.clientHeight },
              { width: canvasWidthPx * zoomScale, height: canvasHeightPx * zoomScale },
            ),
          )
        }
      }
      panFrameId = window.requestAnimationFrame(stepPanLoop)
    }

    const ensurePanLoop = () => {
      if (panFrameId !== null || pressedPanKeys.size === 0) return
      panFrameId = window.requestAnimationFrame(stepPanLoop)
    }

    const deleteSelectedDevices = () => {
      const removableIds = new Set(
        selection.filter((instanceId) => !foundationIdSet.has(instanceId) || foundationMovableIdSet.has(instanceId)),
      )
      if (removableIds.size === 0) return
      setLayout((current) => ({
        ...current,
        devices: current.devices.filter((device) => !removableIds.has(device.instanceId)),
      }))
      setSelection([])
    }

    const resolveDigitPlaceGroup = () => {
      if (highlightedPlaceGroup) return highlightedPlaceGroup
      if (placeOperation === 'belt') return 'conveyor_logistics'
      if (placeOperation === 'pipe') return 'pipe_logistics'
      return null
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (simIsRunning) return
      const target = event.target as HTMLElement | null
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable)
      if (isTypingTarget) return

      const lowerKey = event.key.toLowerCase()

      if (!event.ctrlKey && !event.metaKey && !event.altKey && PAN_KEYS.has(lowerKey)) {
        if (mode === 'place') {
          event.preventDefault()
          pressedPanKeys.add(lowerKey)
          ensurePanLoop()
        }
      }

      const wantsUndo = (event.ctrlKey || event.metaKey) && !event.altKey && lowerKey === 'z' && !event.shiftKey
      const wantsRedo =
        (event.ctrlKey || event.metaKey) && !event.altKey && ((lowerKey === 'z' && event.shiftKey) || lowerKey === 'y')

      if (wantsUndo) {
        event.preventDefault()
        undoLayout()
        return
      }

      if (wantsRedo) {
        event.preventDefault()
        redoLayout()
        return
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Delete') {
        if (selection.length > 0) {
          event.preventDefault()
          deleteSelectedDevices()
        }
        return
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey && lowerKey === 'h') {
        const viewport = viewportRef.current
        if (!viewport) return
        event.preventDefault()
        const centeredOffset = clampViewportOffset(
          {
            x: viewport.clientWidth / 2 - (currentBaseOuterRing.left + layout.lotSize / 2) * cellSize,
            y: viewport.clientHeight / 2 - (currentBaseOuterRing.top + layout.lotSize / 2) * cellSize,
          },
          { width: viewport.clientWidth, height: viewport.clientHeight },
          { width: canvasWidthPx * zoomScale, height: canvasHeightPx * zoomScale },
        )
        setViewOffset(centeredOffset)
        return
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey && mode === 'place' && (lowerKey === 'q' || lowerKey === 'e')) {
        const targetOperation = lowerKey === 'q' ? 'pipe' : 'belt'
        const targetGroup = lowerKey === 'q' ? 'pipe_logistics' : 'conveyor_logistics'
        if (targetOperation === 'pipe' && !canUsePipePlacement) return
        event.preventDefault()
        if (placeOperation === targetOperation && !placeType) {
          returnToIdle()
          return
        }
        returnToIdle()
        setPlaceOperation(targetOperation)
        setHighlightedPlaceGroup(targetGroup)
        return
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey && mode === 'place' && QUICK_PLACE_GROUP_BY_KEY[lowerKey]) {
        event.preventDefault()
        returnToIdle()
        setHighlightedPlaceGroup(QUICK_PLACE_GROUP_BY_KEY[lowerKey] ?? null)
        return
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey && mode === 'place') {
        const digitIndex = getDigitHotkeyIndex(event)
        if (digitIndex !== null) {
          const targetGroupKey = resolveDigitPlaceGroup()
          const targetGroup = targetGroupKey ? placeGroupByKey.get(targetGroupKey) : null
          const targetDevice = targetGroup?.devices[digitIndex]
          if (targetDevice) {
            event.preventDefault()
            returnToIdle()
            setPlaceType(targetDevice.id)
          }
          return
        }
      }

      if (lowerKey !== 'r') return
      event.preventDefault()

      if (mode === 'place' && placeType) {
        setPlaceRotation((current) => ((current + 90) % 360) as Rotation)
        return
      }
      if (selection.length === 0) return

      const selectedRotatable = layout.devices.filter(
        (device) =>
          selection.includes(device.instanceId) &&
            (!foundationIdSet.has(device.instanceId) || foundationMovableIdSet.has(device.instanceId)) &&
          !NON_ROTATABLE_PLACED_TYPE_IDS.has(device.typeId),
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

      const outOfLotDevice = Array.from(rotatedById.values()).find((device) => {
        return !isDeviceWithinAllowedPlacementArea(device, nextLayout.lotSize, currentBaseOuterRing)
      })
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
    const onKeyUp = (event: KeyboardEvent) => {
      const lowerKey = event.key.toLowerCase()
      if (!PAN_KEYS.has(lowerKey)) return
      pressedPanKeys.delete(lowerKey)
      if (pressedPanKeys.size === 0) stopPanLoop()
    }

    const onWindowBlur = () => {
      pressedPanKeys.clear()
      stopPanLoop()
    }

    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      stopPanLoop()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [
    canUsePipePlacement,
    canvasHeightPx,
    canvasWidthPx,
    cellSize,
    clampViewportOffset,
    fallbackPlacementToastKey,
    foundationIdSet,
    foundationMovableIdSet,
    highlightedPlaceGroup,
    currentBaseOuterRing,
    language,
    layout,
    mode,
    outOfLotToastKey,
    placeOperation,
    placeType,
    redoLayout,
    resetPlacementTrace,
    returnToIdle,
    selection,
    setHighlightedPlaceGroup,
    setLayout,
    setPlaceOperation,
    setPlaceRotation,
    setPlaceType,
    setSelection,
    setViewOffset,
    simIsRunning,
    t,
    undoLayout,
    viewportRef,
    visiblePlaceableTypes,
    zoomScale,
  ])
}