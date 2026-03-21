import { useCallback, useEffect, useState } from 'react'
import { isDarkPipeInletType, isDarkPipeOutletType, upsertDarkPipeLink } from '../../domain/deviceLinks'
import { applyLogisticsPath, deleteConnectedBelts, nextId } from '../../domain/logistics'
import { getDeviceById, isBelt, isPipe } from '../../domain/geometry'
import { validatePlacementConstraints } from '../../domain/placement'
import { isDeviceWithinAllowedPlacementArea } from '../../domain/shared/placementArea'
import { DEVICE_TYPE_BY_ID } from '../../domain/registry'
import { clamp } from '../../domain/shared/math'
import type { LayoutState } from '../../domain/types'
import { uiEffects } from '../../app/uiEffects'
import { useAppContext } from '../../app/AppContext'
import { tryPlaceDevice } from './interactionCommands'
import {
  allowsOuterRingPlacementForType,
  type BuildInteractionHandlers,
  type BuildInteractionParams,
  type Cell,
  isCellWithinPlacementArea,
  type PanStart,
} from './buildInteraction.contract'

// 输入：五组参数（viewport/build/interaction/blueprint/i18n），分别承载坐标、业务状态、交互状态、蓝图状态与文案。
// 输出：稳定的画布事件处理器集合与平移状态，供 App 直接绑定到画布组件。
export function useBuildInteractionDomain({
  viewport,
  build,
  blueprint,
  i18n,
}: BuildInteractionParams): BuildInteractionHandlers {
  const {
    viewportRef,
    currentBaseOuterRing,
    zoomScale,
    viewOffset,
    canvasWidthPx,
    canvasHeightPx,
    baseCellSize,
    cellSize,
    getMaxCellSizeForViewport,
    getZoomStep,
    clampViewportOffset,
  } = viewport

  const {
    layout,
    setLayout,
    returnToIdle,
    placeRotation,
    toPlaceOrigin,
    simIsRunning,
    logisticsPreview,
    cellDeviceMap,
    occupancyMap,
    foundationIdSet,
    foundationMovableIdSet,
  } = build

  const canMoveDevice = useCallback(
    (instanceId: string) => !foundationIdSet.has(instanceId) || foundationMovableIdSet.has(instanceId),
    [foundationIdSet, foundationMovableIdSet],
  )

  const {
    state: { activeWorkbenchView },
    editor: {
      state: {
        mode,
        placeOperation,
        linkDraftSourceId,
        placeType,
        deleteTool,
        selection,
        logStart,
        logCurrent,
        logTrace,
        dragBasePositions,
        dragPreviewPositions,
        dragPreviewValid,
        dragInvalidMessage,
        dragStartCell,
        dragRect,
        dragOrigin,
      },
      actions: {
        setViewOffset,
        setCellSize,
        setPlaceOperation,
        setLinkDraftSourceId,
        setPlaceType,
        setSelection,
        setLogStart,
        setLogCurrent,
        setLogTrace,
        setHoverCell,
        setDragBasePositions,
        setDragPreviewPositions,
        setDragPreviewValid,
        setDragInvalidMessage,
        setDragInvalidSelection,
        setDragStartCell,
        setDragRect,
        setDragOrigin,
      },
    },
  } = useAppContext()

  const {
    activePlacementBlueprint,
    clipboardBlueprint,
    buildBlueprintPlacementPreview,
    blueprintPlacementRotation,
    setBlueprintPlacementRotation,
    setClipboardBlueprint,
    setArmedBlueprintId,
  } = blueprint

  const { t, outOfLotToastKey, fallbackPlacementToastKey } = i18n

  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState<PanStart | null>(null)
  const canUseCanvasEditing = activeWorkbenchView !== 'history'
  const canUseDeleteDragRect = canUseCanvasEditing && mode === 'delete'
  const canUsePlaceSelectionRect = canUseCanvasEditing && mode === 'place' && placeOperation === 'default' && !placeType

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

  // 历史视图和蓝图浏览态都不应该残留任何框选/拖拽框状态。
  useEffect(() => {
    if (canUseDeleteDragRect || canUsePlaceSelectionRect) return
    resetDragState()
  }, [canUseDeleteDragRect, canUsePlaceSelectionRect, resetDragState])

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
    [
      baseCellSize,
      currentBaseOuterRing.left,
      currentBaseOuterRing.top,
      viewOffset.x,
      viewOffset.y,
      viewportRef,
      zoomScale,
    ],
  )

  const toCell = useCallback(
    (clientX: number, clientY: number) => {
      const rawCell = toRawCell(clientX, clientY)
      if (!rawCell) return null
      const allowOuterRingInCurrentContext =
        mode === 'delete' ||
        (mode === 'place' &&
          (placeOperation === 'pipe' ||
            !placeType ||
            (Boolean(placeType) && allowsOuterRingPlacementForType(placeType))))
      if (!isCellWithinPlacementArea(rawCell, layout.lotSize, currentBaseOuterRing, allowOuterRingInCurrentContext)) return null
      return rawCell
    },
    [currentBaseOuterRing, layout.lotSize, mode, placeOperation, placeType, toRawCell],
  )

  const placeDevice = useCallback(
    (cell: Cell) => {
      if (!placeType) return false
      return tryPlaceDevice({
        cell,
        placeType,
        placeRotation,
        layout,
        currentBaseOuterRing,
        toPlaceOrigin,
        setLayout,
        outOfLotToastKey,
        fallbackPlacementToastKey,
        t,
      })
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
        if (mode === 'place' && (placeOperation === 'belt' || placeOperation === 'pipe')) {
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
        if (!canUseCanvasEditing) {
          resetDragState()
          return
        }
        if (!simIsRunning && linkDraftSourceId) {
          setLinkDraftSourceId(null)
          return
        }
        if (!simIsRunning && clipboardBlueprint) {
          setClipboardBlueprint(null)
          setBlueprintPlacementRotation(0)
          return
        }
        if (!simIsRunning && (mode === 'blueprint' || (mode === 'place' && placeOperation === 'blueprint'))) {
          setArmedBlueprintId(null)
          setBlueprintPlacementRotation(0)
          if (mode === 'blueprint') {
            setPlaceOperation('blueprint')
          }
          return
        }
        if (!simIsRunning && mode === 'place') {
          if (placeType || placeOperation === 'belt' || placeOperation === 'pipe') {
            returnToIdle()
            return
          }
        }
        if (!simIsRunning && selection.length > 0) {
          returnToIdle()
          setSelection([])
          resetDragState()
          return
        }
        if (!simIsRunning && mode === 'place') {
          returnToIdle()
        }
        return
      }

      if (event.button !== 0) return

      if (!canUseCanvasEditing) {
        resetDragState()
        return
      }

      const cell = toCell(event.clientX, event.clientY)
      if (!cell) return

      if (!simIsRunning && linkDraftSourceId) {
        const clickedId = cellDeviceMap.get(`${cell.x},${cell.y}`)
        if (!clickedId || clickedId === linkDraftSourceId) return
        setLayout((current) => {
          const sourceDevice = getDeviceById(current, linkDraftSourceId)
          const clickedDevice = getDeviceById(current, clickedId)
          if (!sourceDevice || !clickedDevice) return current
          const sourceIsInlet = isDarkPipeInletType(sourceDevice.typeId)
          const clickedIsOutlet = isDarkPipeOutletType(clickedDevice.typeId)
          if (!sourceIsInlet || !clickedIsOutlet) return current

          const inletId = sourceDevice.instanceId
          const outletId = clickedDevice.instanceId
          const linked = upsertDarkPipeLink(current, inletId, outletId)
          return {
            ...linked,
            devices: linked.devices.map((device) => {
              if (device.instanceId === inletId) {
                return { ...device, config: { ...device.config, darkPipeInletMode: 'link' } }
              }
              if (device.instanceId === outletId) {
                return { ...device, config: { ...device.config, darkPipeOutletMode: 'link' } }
              }
              return device
            }),
          }
        })
        setSelection([clickedId])
        setLinkDraftSourceId(null)
        return
      }

      if (mode === 'place' && (placeOperation === 'belt' || placeOperation === 'pipe')) {
        if (simIsRunning) return
        setLogStart(cell)
        setLogCurrent(cell)
        setLogTrace([cell])
        return
      }

      if (mode === 'place' && placeType) {
        if (simIsRunning) return
        const placed = placeDevice(cell)
        if (placed && !event.shiftKey) {
          setPlaceType('')
        }
        return
      }

      if (activePlacementBlueprint) {
        if (simIsRunning) return
        const preview = buildBlueprintPlacementPreview(activePlacementBlueprint, cell, blueprintPlacementRotation)
        if (!preview) {
          uiEffects.toast(t('toast.blueprintNoSelection'), { variant: 'warning' })
          return
        }
        if (!preview.isValid) {
          uiEffects.toast(t(preview.invalidMessageKey ?? fallbackPlacementToastKey), { variant: 'warning' })
          return
        }

        setLayout((current) => {
          const preservedDevices = current.devices.filter((device) => !preview.replacementInstanceIds.includes(device.instanceId))
          const blueprintIdToPlacedId = new Map<string, string>()
          const placedDevices = preview.devices.map((device, index) => {
            const instanceId = preview.replacementInstanceIds.includes(device.instanceId) ? device.instanceId : nextId(device.typeId)
            const blueprintInstanceId = activePlacementBlueprint?.devices[index]?.blueprintInstanceId
            if (blueprintInstanceId) blueprintIdToPlacedId.set(blueprintInstanceId, instanceId)
            return instanceId === device.instanceId ? device : { ...device, instanceId }
          })
          const mappedLinks = preview.links.flatMap((link) => {
            const sourceInstanceId = blueprintIdToPlacedId.get(link.sourceBlueprintInstanceId)
            const targetInstanceId = blueprintIdToPlacedId.get(link.targetBlueprintInstanceId)
            if (!sourceInstanceId || !targetInstanceId) return []
            return [{
              linkId: nextId('device_link'),
              kind: link.kind,
              sourceInstanceId,
              targetInstanceId,
            }]
          })

          return {
            ...current,
            devices: [...preservedDevices, ...placedDevices],
            links: [
              ...current.links.filter(
                (link) =>
                  !preview.replacementInstanceIds.includes(link.sourceInstanceId) &&
                  !preview.replacementInstanceIds.includes(link.targetInstanceId),
              ),
              ...mappedLinks,
            ],
          }
        })
        return
      }

      if (mode === 'blueprint') {
        resetDragState()
        return
      }

      if (canUseDeleteDragRect) {
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
        const shouldToggleSelection = canUsePlaceSelectionRect && !simIsRunning && (event.ctrlKey || event.metaKey || event.shiftKey)
        if (shouldToggleSelection) {
          if (canMoveDevice(clickedId)) {
            setSelection((current) =>
              current.includes(clickedId) ? current.filter((id) => id !== clickedId) : [...current, clickedId],
            )
          }
          resetDragState()
          return
        }

        if (selection.includes(clickedId)) {
          const activeSelection = selection.filter((id) => canMoveDevice(id))
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
      }

      if (!canUsePlaceSelectionRect) {
        resetDragState()
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
      foundationMovableIdSet,
      canUseCanvasEditing,
      canUseDeleteDragRect,
      canUsePlaceSelectionRect,
      canMoveDevice,
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
      setSelection,
      simIsRunning,
      t,
      toCell,
      returnToIdle,
      resetDragState,
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
      const allowOuterRingInCurrentContext =
        canUseDeleteDragRect ||
        (mode === 'place' &&
          (placeOperation === 'pipe' ||
            !placeType ||
            (Boolean(placeType) && allowsOuterRingPlacementForType(placeType))))
      const cell = isCellWithinPlacementArea(rawCell, layout.lotSize, currentBaseOuterRing, allowOuterRingInCurrentContext)
        ? rawCell
        : null
      setHoverCell(cell)

      if (linkDraftSourceId) return

      if (mode === 'place' && (placeOperation === 'belt' || placeOperation === 'pipe') && logStart) {
        if (!cell) return
        const last = logTrace[logTrace.length - 1]
        if (last && last.x === cell.x && last.y === cell.y) return
        setLogTrace((current) => [...current, cell])
        setLogCurrent(cell)
        return
      }

      if (mode === 'place' && !placeType && dragBasePositions && dragOrigin && selection.length > 0 && !simIsRunning) {
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
        const outOfLotDevice = movedSelection.find(
          (device) => !isDeviceWithinAllowedPlacementArea(device, layout.lotSize, currentBaseOuterRing),
        )
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

      if (canUseDeleteDragRect && dragOrigin && dragRect) {
        setDragRect({ ...dragRect, x2: cell.x, y2: cell.y })
        return
      }

      if (canUsePlaceSelectionRect && dragOrigin && dragRect) {
        setDragRect({ ...dragRect, x2: cell.x, y2: cell.y })
        return
      }

      if (canUsePlaceSelectionRect && dragStartCell) {
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
      canUseDeleteDragRect,
      canUsePlaceSelectionRect,
      currentBaseOuterRing,
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
    async () => {
      if (isPanning) {
        setIsPanning(false)
        setPanStart(null)
        return
      }

      if (!canUseCanvasEditing) {
        resetDragState()
        return
      }

      if (linkDraftSourceId) return

      if (mode === 'place' && (placeOperation === 'belt' || placeOperation === 'pipe') && logStart && logCurrent && !simIsRunning) {
        const path = logisticsPreview
        if (path && path.length >= 2) {
          const family = placeOperation === 'pipe' ? 'pipe' : 'belt'
          setLayout((current) => applyLogisticsPath(current, path, family))
        }
        setLogStart(null)
        setLogCurrent(null)
        setLogTrace([])
        return
      }

      if (canUseDeleteDragRect && dragRect && dragOrigin && !simIsRunning) {
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
          const id = cellDeviceMap.get(`${xMin},${yMin}`)
          if (id && !foundationIdSet.has(id)) {
            if (deleteTool === 'wholeBelt') {
              setLayout((current) => {
                const target = getDeviceById(current, id)
                if (target && (isBelt(target.typeId) || isPipe(target.typeId))) {
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

        if (idsInRect.size > 0) {
          setLayout((current) => ({
            ...current,
            devices: current.devices.filter((device) => !idsInRect.has(device.instanceId)),
          }))
          setSelection((current) => current.filter((id) => !idsInRect.has(id)))
          }
        return
      }

      if (canUsePlaceSelectionRect && dragRect && dragOrigin) {
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
          .filter((device) => canMoveDevice(device.instanceId))
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

      if (canUsePlaceSelectionRect && dragStartCell && dragOrigin && dragBasePositions && selection.length > 0 && !simIsRunning) {
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
          uiEffects.toast(t(dragInvalidMessage), { variant: 'warning' })
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
      deleteTool,
      dragBasePositions,
      dragInvalidMessage,
      dragOrigin,
      dragPreviewPositions,
      dragPreviewValid,
      dragRect,
      dragStartCell,
      foundationIdSet,
      foundationMovableIdSet,
      canUseCanvasEditing,
      canUseDeleteDragRect,
      canUsePlaceSelectionRect,
      canMoveDevice,
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