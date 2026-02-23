import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { applyLogisticsPath, deleteConnectedBelts, nextId } from '../../domain/logistics'
import { getDeviceById, getFootprintCells, includesCell, isBeltLike, isWithinLot } from '../../domain/geometry'
import { validatePlacementConstraints } from '../../domain/placement'
import { DEVICE_TYPE_BY_ID } from '../../domain/registry'
import { clamp } from '../../domain/shared/math'
import type { DeviceInstance, DeviceTypeId, EditMode, LayoutState, Rotation } from '../../domain/types'
import { dialogConfirm } from '../../ui/dialog'
import { showToast } from '../../ui/toast'
import { initialStorageConfig } from '../../sim/engine'
import type { BlueprintSnapshot } from '../blueprint/useBlueprintDomain'

type Cell = { x: number; y: number }
type DragRect = { x1: number; y1: number; x2: number; y2: number }
type PanStart = { clientX: number; clientY: number; offsetX: number; offsetY: number }

const MANUAL_LOGISTICS_JUNCTION_TYPES = new Set<DeviceTypeId>(['item_log_splitter', 'item_log_converger', 'item_log_connector'])

type LayoutUpdater = LayoutState | ((current: LayoutState) => LayoutState)

type BuildInteractionParams = {
  viewportRef: MutableRefObject<HTMLDivElement | null>
  currentBaseOuterRing: { left: number; top: number }
  zoomScale: number
  viewOffset: { x: number; y: number }
  setViewOffset: Dispatch<SetStateAction<{ x: number; y: number }>>
  canvasWidthPx: number
  canvasHeightPx: number
  baseCellSize: number
  cellSize: number
  setCellSize: Dispatch<SetStateAction<number>>
  getMaxCellSizeForViewport: (viewport: HTMLDivElement | null) => number
  getZoomStep: (cellSize: number) => number
  clampViewportOffset: (
    offset: { x: number; y: number },
    viewportSize: { width: number; height: number },
    canvasSize: { width: number; height: number },
  ) => { x: number; y: number }
  layout: LayoutState
  setLayout: (updater: LayoutUpdater) => void
  mode: EditMode
  placeOperation: 'default' | 'belt'
  setPlaceOperation: Dispatch<SetStateAction<'default' | 'belt'>>
  placeType: DeviceTypeId | ''
  setPlaceType: Dispatch<SetStateAction<DeviceTypeId | ''>>
  placeRotation: Rotation
  toPlaceOrigin: (cell: Cell, typeId: DeviceTypeId, rotation: Rotation) => Cell
  simIsRunning: boolean
  logisticsPreview: Cell[] | null
  logStart: Cell | null
  setLogStart: Dispatch<SetStateAction<Cell | null>>
  logCurrent: Cell | null
  setLogCurrent: Dispatch<SetStateAction<Cell | null>>
  logTrace: Cell[]
  setLogTrace: Dispatch<SetStateAction<Cell[]>>
  selection: string[]
  setSelection: Dispatch<SetStateAction<string[]>>
  dragBasePositions: Record<string, Cell> | null
  setDragBasePositions: Dispatch<SetStateAction<Record<string, Cell> | null>>
  dragPreviewPositions: Record<string, Cell>
  setDragPreviewPositions: Dispatch<SetStateAction<Record<string, Cell>>>
  dragPreviewValid: boolean
  setDragPreviewValid: Dispatch<SetStateAction<boolean>>
  dragInvalidMessage: string | null
  setDragInvalidMessage: Dispatch<SetStateAction<string | null>>
  setDragInvalidSelection: Dispatch<SetStateAction<Set<string>>>
  dragStartCell: Cell | null
  setDragStartCell: Dispatch<SetStateAction<Cell | null>>
  dragRect: DragRect | null
  setDragRect: Dispatch<SetStateAction<DragRect | null>>
  dragOrigin: Cell | null
  setDragOrigin: Dispatch<SetStateAction<Cell | null>>
  setHoverCell: Dispatch<SetStateAction<Cell | null>>
  cellDeviceMap: Map<string, string>
  occupancyMap: Map<string, Array<{ instanceId: string }>>
  foundationIdSet: ReadonlySet<string>
  deleteTool: 'single' | 'wholeBelt' | 'box'
  deleteBoxConfirmingRef: MutableRefObject<boolean>
  activePlacementBlueprint: BlueprintSnapshot | null
  clipboardBlueprint: BlueprintSnapshot | null
  buildBlueprintPlacementPreview: (
    snapshot: BlueprintSnapshot | null,
    anchorCell: Cell,
    placementRotation: Rotation,
  ) => { devices: DeviceInstance[]; isValid: boolean; invalidMessageKey: string | null } | null
  blueprintPlacementRotation: Rotation
  setBlueprintPlacementRotation: Dispatch<SetStateAction<Rotation>>
  setClipboardBlueprint: Dispatch<SetStateAction<BlueprintSnapshot | null>>
  setSelectedBlueprintId: Dispatch<SetStateAction<string | null>>
  t: (key: string, params?: Record<string, string | number>) => string
  outOfLotToastKey: string
  fallbackPlacementToastKey: string
}

export function useBuildInteractionDomain({
  viewportRef,
  currentBaseOuterRing,
  zoomScale,
  viewOffset,
  setViewOffset,
  canvasWidthPx,
  canvasHeightPx,
  baseCellSize,
  cellSize,
  setCellSize,
  getMaxCellSizeForViewport,
  getZoomStep,
  clampViewportOffset,
  layout,
  setLayout,
  mode,
  placeOperation,
  setPlaceOperation,
  placeType,
  setPlaceType,
  placeRotation,
  toPlaceOrigin,
  simIsRunning,
  logisticsPreview,
  logStart,
  setLogStart,
  logCurrent,
  setLogCurrent,
  logTrace,
  setLogTrace,
  selection,
  setSelection,
  dragBasePositions,
  setDragBasePositions,
  dragPreviewPositions,
  setDragPreviewPositions,
  dragPreviewValid,
  setDragPreviewValid,
  dragInvalidMessage,
  setDragInvalidMessage,
  setDragInvalidSelection,
  dragStartCell,
  setDragStartCell,
  dragRect,
  setDragRect,
  dragOrigin,
  setDragOrigin,
  setHoverCell,
  cellDeviceMap,
  occupancyMap,
  foundationIdSet,
  deleteTool,
  deleteBoxConfirmingRef,
  activePlacementBlueprint,
  clipboardBlueprint,
  buildBlueprintPlacementPreview,
  blueprintPlacementRotation,
  setBlueprintPlacementRotation,
  setClipboardBlueprint,
  setSelectedBlueprintId,
  t,
  outOfLotToastKey,
  fallbackPlacementToastKey,
}: BuildInteractionParams) {
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState<PanStart | null>(null)

  const resetDragState = useCallback(() => {
    setDragStartCell(null)
    setDragOrigin(null)
    setDragRect(null)
    setDragBasePositions(null)
    setDragPreviewPositions({})
    setDragPreviewValid(true)
    setDragInvalidMessage(null)
    setDragInvalidSelection(new Set())
  }, [
    setDragBasePositions,
    setDragInvalidMessage,
    setDragInvalidSelection,
    setDragOrigin,
    setDragPreviewPositions,
    setDragPreviewValid,
    setDragRect,
    setDragStartCell,
  ])

  const toRawCell = useCallback(
    (clientX: number, clientY: number) => {
      const viewportRect = viewportRef.current?.getBoundingClientRect()
      if (!viewportRect) return null
      const scaledCellSize = baseCellSize * zoomScale
      const rawX = Math.floor((clientX - viewportRect.left - viewOffset.x) / scaledCellSize)
      const rawY = Math.floor((clientY - viewportRect.top - viewOffset.y) / scaledCellSize)
      const x = rawX - currentBaseOuterRing.left
      const y = rawY - currentBaseOuterRing.top
      return { x, y }
    },
    [baseCellSize, currentBaseOuterRing.left, currentBaseOuterRing.top, viewOffset.x, viewOffset.y, viewportRef, zoomScale],
  )

  const toCell = useCallback(
    (clientX: number, clientY: number) => {
      const rawCell = toRawCell(clientX, clientY)
      if (!rawCell) return null
      if (rawCell.x < 0 || rawCell.y < 0 || rawCell.x >= layout.lotSize || rawCell.y >= layout.lotSize) return null
      return rawCell
    },
    [layout.lotSize, toRawCell],
  )

  const placeDevice = useCallback(
    (cell: Cell) => {
      if (!placeType) return false
      const origin = toPlaceOrigin(cell, placeType, placeRotation)
      const instance: DeviceInstance = {
        instanceId: nextId(placeType),
        typeId: placeType,
        origin,
        rotation: placeRotation,
        config: initialStorageConfig(placeType),
      }
      if (!isWithinLot(instance, layout.lotSize)) {
        showToast(t(outOfLotToastKey), { variant: 'warning' })
        return false
      }
      const validation = validatePlacementConstraints(layout, instance)
      if (!validation.isValid) {
        showToast(t(validation.messageKey ?? fallbackPlacementToastKey), { variant: 'warning' })
        return false
      }

      setLayout((current) => {
        if (!MANUAL_LOGISTICS_JUNCTION_TYPES.has(instance.typeId)) {
          return { ...current, devices: [...current.devices, instance] }
        }

        const footprint = getFootprintCells(instance)
        if (footprint.length === 0) {
          return { ...current, devices: [...current.devices, instance] }
        }

        const replacedBeltIds = new Set<string>()
        for (const device of current.devices) {
          if (!device.typeId.startsWith('belt_')) continue
          if (footprint.some((cellPos) => includesCell(device, cellPos.x, cellPos.y))) {
            replacedBeltIds.add(device.instanceId)
          }
        }

        return {
          ...current,
          devices: [...current.devices.filter((device) => !replacedBeltIds.has(device.instanceId)), instance],
        }
      })
      return true
    },
    [
      fallbackPlacementToastKey,
      layout,
      outOfLotToastKey,
      placeRotation,
      placeType,
      setLayout,
      t,
      toPlaceOrigin,
    ],
  )

  const onCanvasMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button === 1) {
        event.preventDefault()
        if (mode === 'place' && placeOperation === 'belt') {
          setLogStart(null)
          setLogCurrent(null)
          setLogTrace([])
        }
        setIsPanning(true)
        setPanStart({ clientX: event.clientX, clientY: event.clientY, offsetX: viewOffset.x, offsetY: viewOffset.y })
        return
      }

      if (event.button === 2) {
        event.preventDefault()
        if (!simIsRunning && clipboardBlueprint) {
          setClipboardBlueprint(null)
          setBlueprintPlacementRotation(0)
          showToast(t('toast.blueprintClipboardCancelled'))
          return
        }
        if (!simIsRunning && mode === 'place') {
          setPlaceOperation('default')
          setLogStart(null)
          setLogCurrent(null)
          setLogTrace([])
          setPlaceType('')
        }
        if (!simIsRunning && mode === 'blueprint') {
          setSelectedBlueprintId(null)
          setBlueprintPlacementRotation(0)
        }
        return
      }

      if (event.button !== 0) return

      const cell = toCell(event.clientX, event.clientY)
      if (!cell) return

      if (mode === 'place' && placeOperation === 'belt') {
        if (simIsRunning) return
        setLogStart(cell)
        setLogCurrent(cell)
        setLogTrace([cell])
        return
      }

      if (mode === 'place' && placeType) {
        if (simIsRunning) return
        const placed = placeDevice(cell)
        if (placed) {
          setPlaceType('')
        }
        return
      }

      if (activePlacementBlueprint) {
        if (simIsRunning) return
        const preview = buildBlueprintPlacementPreview(activePlacementBlueprint, cell, blueprintPlacementRotation)
        if (!preview) {
          showToast(t('toast.blueprintNoSelection'), { variant: 'warning' })
          return
        }
        if (!preview.isValid) {
          showToast(t(preview.invalidMessageKey ?? fallbackPlacementToastKey), { variant: 'warning' })
          return
        }

        setLayout((current) => ({
          ...current,
          devices: [
            ...current.devices,
            ...preview.devices.map((device) => ({
              ...device,
              instanceId: nextId(device.typeId),
            })),
          ],
        }))
        showToast(t('toast.blueprintPlaced', { name: activePlacementBlueprint.name, count: preview.devices.length }))
        return
      }

      if (mode === 'delete') {
        if (simIsRunning) return
        setSelection([])
        setDragStartCell(null)
        setDragBasePositions(null)
        setDragPreviewPositions({})
        setDragPreviewValid(true)
        setDragInvalidMessage(null)
        setDragInvalidSelection(new Set())
        setDragOrigin(cell)
        setDragRect({ x1: cell.x, y1: cell.y, x2: cell.x, y2: cell.y })
        return
      }

      const clickedId = cellDeviceMap.get(`${cell.x},${cell.y}`)
      if (clickedId) {
        const activeSelection = (selection.includes(clickedId) ? selection : [clickedId]).filter((id) => !foundationIdSet.has(id))
        if (!selection.includes(clickedId)) setSelection(activeSelection)
        if (activeSelection.length === 0) {
          resetDragState()
          return
        }
        const base: Record<string, Cell> = {}
        for (const id of activeSelection) {
          const device = getDeviceById(layout, id)
          if (device) base[id] = { ...device.origin }
        }
        setDragBasePositions(base)
        setDragPreviewPositions(base)
        setDragPreviewValid(true)
        setDragInvalidMessage(null)
        setDragInvalidSelection(new Set())
        setDragStartCell(cell)
        setDragOrigin(cell)
        setDragRect(null)
        return
      }

      setSelection([])
      setDragBasePositions(null)
      setDragPreviewPositions({})
      setDragPreviewValid(true)
      setDragInvalidMessage(null)
      setDragInvalidSelection(new Set())
      setDragOrigin(cell)
      setDragRect({ x1: cell.x, y1: cell.y, x2: cell.x, y2: cell.y })
    },
    [
      activePlacementBlueprint,
      clipboardBlueprint,
      blueprintPlacementRotation,
      buildBlueprintPlacementPreview,
      cellDeviceMap,
      fallbackPlacementToastKey,
      foundationIdSet,
      layout,
      mode,
      placeDevice,
      placeOperation,
      placeType,
      resetDragState,
      selection,
      setBlueprintPlacementRotation,
      setClipboardBlueprint,
      setDragBasePositions,
      setDragInvalidMessage,
      setDragInvalidSelection,
      setDragOrigin,
      setDragPreviewPositions,
      setDragPreviewValid,
      setDragRect,
      setDragStartCell,
      setLayout,
      setLogCurrent,
      setLogStart,
      setLogTrace,
      setPlaceOperation,
      setPlaceType,
      setSelectedBlueprintId,
      setSelection,
      simIsRunning,
      t,
      toCell,
      viewOffset.x,
      viewOffset.y,
    ],
  )

  const onCanvasMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isPanning && panStart) {
        const viewport = viewportRef.current
        if (!viewport) return
        const canvasWidth = canvasWidthPx * zoomScale
        const canvasHeight = canvasHeightPx * zoomScale
        const nextOffset = {
          x: panStart.offsetX + (event.clientX - panStart.clientX),
          y: panStart.offsetY + (event.clientY - panStart.clientY),
        }
        setViewOffset(
          clampViewportOffset(
            nextOffset,
            { width: viewport.clientWidth, height: viewport.clientHeight },
            { width: canvasWidth, height: canvasHeight },
          ),
        )
        return
      }

      const rawCell = toRawCell(event.clientX, event.clientY)
      if (!rawCell) {
        setHoverCell(null)
        return
      }
      const cell = rawCell.x >= 0 && rawCell.y >= 0 && rawCell.x < layout.lotSize && rawCell.y < layout.lotSize ? rawCell : null
      setHoverCell(cell)

      if (mode === 'place' && placeOperation === 'belt' && logStart) {
        if (!cell) return
        const last = logTrace[logTrace.length - 1]
        if (last && last.x === cell.x && last.y === cell.y) return
        setLogTrace((current) => [...current, cell])
        setLogCurrent(cell)
        return
      }

      if ((mode === 'select' || (mode === 'place' && !placeType)) && dragBasePositions && dragOrigin && selection.length > 0 && !simIsRunning) {
        const dx = rawCell.x - dragOrigin.x
        const dy = rawCell.y - dragOrigin.y
        const previewPositions: Record<string, Cell> = {}
        for (const id of selection) {
          const base = dragBasePositions[id]
          if (!base) continue
          previewPositions[id] = { x: base.x + dx, y: base.y + dy }
        }
        setDragPreviewPositions(previewPositions)

        const previewLayout: LayoutState = {
          ...layout,
          devices: layout.devices.map((device) => {
            const preview = previewPositions[device.instanceId]
            if (!preview) return device
            return {
              ...device,
              origin: preview,
            }
          }),
        }
        const movedSelection = previewLayout.devices.filter((device) => selection.includes(device.instanceId))
        const outOfLotDevice = movedSelection.find((device) => !isWithinLot(device, layout.lotSize))
        let invalidMessageKey: string | null = null
        if (outOfLotDevice) {
          invalidMessageKey = outOfLotToastKey
        } else {
          const constraintFailure = movedSelection
            .map((device) => validatePlacementConstraints(previewLayout, device))
            .find((result) => !result.isValid)
          if (constraintFailure && !constraintFailure.isValid) {
            invalidMessageKey = constraintFailure.messageKey ?? fallbackPlacementToastKey
          }
        }
        const isValidPlacement = invalidMessageKey === null
        setDragPreviewValid(isValidPlacement)
        setDragInvalidMessage(invalidMessageKey)
        setDragInvalidSelection(isValidPlacement ? new Set() : new Set(selection))
        setDragStartCell(rawCell)
        return
      }

      if (!cell) return

      if (mode === 'delete' && dragOrigin && dragRect) {
        setDragRect({ ...dragRect, x2: cell.x, y2: cell.y })
        return
      }

      if ((mode === 'select' || (mode === 'place' && !placeType)) && dragOrigin && dragRect) {
        setDragRect({ ...dragRect, x2: cell.x, y2: cell.y })
        return
      }

      if ((mode === 'select' || (mode === 'place' && !placeType)) && dragStartCell) {
        setDragStartCell(cell)
      }
    },
    [
      canvasHeightPx,
      canvasWidthPx,
      clampViewportOffset,
      dragBasePositions,
      dragOrigin,
      dragRect,
      dragStartCell,
      fallbackPlacementToastKey,
      layout,
      logStart,
      logTrace,
      mode,
      outOfLotToastKey,
      panStart,
      placeOperation,
      placeType,
      selection,
      setDragInvalidMessage,
      setDragInvalidSelection,
      setDragPreviewPositions,
      setDragPreviewValid,
      setDragRect,
      setDragStartCell,
      setHoverCell,
      setLogCurrent,
      setLogTrace,
      setViewOffset,
      simIsRunning,
      toRawCell,
      viewportRef,
      zoomScale,
      isPanning,
    ],
  )

  const onCanvasMouseUp = useCallback(
    async (_event: React.MouseEvent<HTMLDivElement>) => {
      if (isPanning) {
        setIsPanning(false)
        setPanStart(null)
        return
      }

      if (mode === 'place' && placeOperation === 'belt' && logStart && logCurrent && !simIsRunning) {
        const path = logisticsPreview
        if (path && path.length >= 2) {
          setLayout((current) => applyLogisticsPath(current, path))
        }
        setLogStart(null)
        setLogCurrent(null)
        setLogTrace([])
        return
      }

      if (mode === 'delete' && dragRect && dragOrigin && !simIsRunning) {
        if (deleteBoxConfirmingRef.current) return
        deleteBoxConfirmingRef.current = true

        const xMin = Math.min(dragRect.x1, dragRect.x2)
        const xMax = Math.max(dragRect.x1, dragRect.x2)
        const yMin = Math.min(dragRect.y1, dragRect.y2)
        const yMax = Math.max(dragRect.y1, dragRect.y2)
        const idsInRect = new Set<string>()

        setDragStartCell(null)
        setDragOrigin(null)
        setDragRect(null)
        setDragBasePositions(null)
        setDragPreviewPositions({})
        setDragPreviewValid(true)
        setDragInvalidMessage(null)
        setDragInvalidSelection(new Set())

        const isSingleCellRect = xMin === xMax && yMin === yMax

        if (isSingleCellRect) {
          try {
            const id = cellDeviceMap.get(`${xMin},${yMin}`)
            if (id && !foundationIdSet.has(id)) {
              if (deleteTool === 'wholeBelt') {
                setLayout((current) => {
                  const target = getDeviceById(current, id)
                  if (target && isBeltLike(target.typeId)) {
                    return deleteConnectedBelts(current, xMin, yMin)
                  }
                  return {
                    ...current,
                    devices: current.devices.filter((device) => device.instanceId !== id),
                  }
                })
              } else {
                setLayout((current) => ({ ...current, devices: current.devices.filter((device) => device.instanceId !== id) }))
              }
              setSelection((current) => current.filter((currentId) => currentId !== id))
            }
          } finally {
            deleteBoxConfirmingRef.current = false
          }
          return
        }

        for (const [key, entries] of occupancyMap.entries()) {
          const [x, y] = key.split(',').map(Number)
          if (x < xMin || x > xMax || y < yMin || y > yMax) continue
          for (const entry of entries) {
            if (foundationIdSet.has(entry.instanceId)) continue
            idsInRect.add(entry.instanceId)
          }
        }

        try {
          if (idsInRect.size > 0) {
            const confirmed = await dialogConfirm(t('left.deleteBoxConfirm', { count: idsInRect.size }), {
              title: t('dialog.title.confirm'),
              confirmText: t('dialog.ok'),
              cancelText: t('dialog.cancel'),
              variant: 'warning',
            })
            if (confirmed) {
              setLayout((current) => ({
                ...current,
                devices: current.devices.filter((device) => !idsInRect.has(device.instanceId)),
              }))
              setSelection((current) => current.filter((id) => !idsInRect.has(id)))
            }
          }
        } finally {
          deleteBoxConfirmingRef.current = false
        }
        return
      }

      if ((mode === 'select' || (mode === 'place' && !placeType)) && dragRect && dragOrigin) {
        const xMin = Math.min(dragRect.x1, dragRect.x2)
        const xMax = Math.max(dragRect.x1, dragRect.x2)
        const yMin = Math.min(dragRect.y1, dragRect.y2)
        const yMax = Math.max(dragRect.y1, dragRect.y2)
        const ids = layout.devices
          .filter((device) =>
            DEVICE_TYPE_BY_ID[device.typeId]
              ? DEVICE_TYPE_BY_ID[device.typeId] &&
                [...occupancyMap.entries()].some(([key, value]) => {
                  const [x, y] = key.split(',').map(Number)
                  return x >= xMin && x <= xMax && y >= yMin && y <= yMax && value.some((entry) => entry.instanceId === device.instanceId)
                })
              : false,
          )
          .filter((device) => !foundationIdSet.has(device.instanceId))
          .map((device) => device.instanceId)
        setSelection(ids)
        setDragRect(null)
        setDragOrigin(null)
        setDragBasePositions(null)
        setDragPreviewPositions({})
        setDragPreviewValid(true)
        setDragInvalidMessage(null)
        setDragInvalidSelection(new Set())
        return
      }

      if ((mode === 'select' || (mode === 'place' && !placeType)) && dragStartCell && dragOrigin && dragBasePositions && selection.length > 0 && !simIsRunning) {
        if (dragPreviewValid) {
          setLayout((current) => ({
            ...current,
            devices: current.devices.map((device) => {
              if (!selection.includes(device.instanceId)) return device
              const preview = dragPreviewPositions[device.instanceId]
              if (!preview) return device
              return {
                ...device,
                origin: { ...preview },
              }
            }),
          }))
        } else if (dragInvalidMessage) {
          showToast(t(dragInvalidMessage), { variant: 'warning' })
        }
        setDragPreviewPositions({})
        setDragPreviewValid(true)
        setDragInvalidMessage(null)
        setDragInvalidSelection(new Set())
        setDragStartCell(null)
        setDragOrigin(null)
        setDragBasePositions(null)
        return
      }

      resetDragState()
    },
    [
      cellDeviceMap,
      deleteBoxConfirmingRef,
      deleteTool,
      dragBasePositions,
      dragInvalidMessage,
      dragOrigin,
      dragPreviewPositions,
      dragPreviewValid,
      dragRect,
      dragStartCell,
      foundationIdSet,
      isPanning,
      layout.devices,
      logCurrent,
      logStart,
      logisticsPreview,
      mode,
      occupancyMap,
      placeOperation,
      placeType,
      resetDragState,
      selection,
      setDragBasePositions,
      setDragInvalidMessage,
      setDragInvalidSelection,
      setDragOrigin,
      setDragPreviewPositions,
      setDragPreviewValid,
      setDragRect,
      setDragStartCell,
      setIsPanning,
      setLayout,
      setLogCurrent,
      setLogStart,
      setLogTrace,
      setSelection,
      simIsRunning,
      t,
    ],
  )

  const onCanvasWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault()
      const viewport = viewportRef.current
      if (!viewport) return

      const maxCellSize = getMaxCellSizeForViewport(viewport)
      const baseStep = getZoomStep(cellSize)
      const deltaStrength = clamp(Math.round(Math.abs(event.deltaY) / 100), 1, 3)
      const step = baseStep * deltaStrength
      const next = clamp(cellSize + (event.deltaY < 0 ? step : -step), 12, maxCellSize)
      if (next === cellSize) return

      const viewportRect = viewport.getBoundingClientRect()
      const anchorX = event.clientX - viewportRect.left
      const anchorY = event.clientY - viewportRect.top
      const scaledCellSize = baseCellSize * zoomScale
      const worldX = (anchorX - viewOffset.x) / scaledCellSize
      const worldY = (anchorY - viewOffset.y) / scaledCellSize
      const nextOffset = {
        x: anchorX - worldX * baseCellSize * (next / baseCellSize),
        y: anchorY - worldY * baseCellSize * (next / baseCellSize),
      }
      const clampedOffset = clampViewportOffset(
        nextOffset,
        { width: viewport.clientWidth, height: viewport.clientHeight },
        { width: canvasWidthPx * (next / baseCellSize), height: canvasHeightPx * (next / baseCellSize) },
      )
      setViewOffset(clampedOffset)
      setCellSize(next)
    },
    [
      baseCellSize,
      canvasHeightPx,
      canvasWidthPx,
      cellSize,
      clampViewportOffset,
      getMaxCellSizeForViewport,
      getZoomStep,
      setCellSize,
      setViewOffset,
      viewOffset.x,
      viewOffset.y,
      viewportRef,
      zoomScale,
    ],
  )

  return {
    isPanning,
    onCanvasMouseDown,
    onCanvasMouseMove,
    onCanvasMouseUp,
    onCanvasWheel,
  }
}