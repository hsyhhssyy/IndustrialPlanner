import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { DEVICE_TYPE_BY_ID, ITEMS, PLACEABLE_TYPES, RECIPES } from './domain/registry'
import { applyLogisticsPath, deleteConnectedBelts, longestValidLogisticsPrefix, nextId, pathFromTrace } from './domain/logistics'
import { buildOccupancyMap, cellToDeviceId, EDGE_ANGLE, getDeviceById, getRotatedPorts, isWithinLot, linksFromLayout, OPPOSITE_EDGE } from './domain/geometry'
import type { DeviceInstance, DeviceRuntime, DeviceTypeId, Edge, EditMode, ItemId, LayoutState, Rotation, SimState, SlotData } from './domain/types'
import { usePersistentState } from './hooks/usePersistentState'
import { createTranslator, getDeviceLabel, getItemLabel, getModeLabel, LANGUAGE_OPTIONS, type Language } from './i18n'
import {
  createInitialSimState,
  initialStorageConfig,
  runtimeLabel,
  startSimulation,
  stopSimulation,
  tickSimulation,
} from './sim/engine'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function getInternalStatusText(
  selectedDevice: DeviceInstance,
  runtime: DeviceRuntime | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  if (!runtime) return t('detail.internal.noRuntime')

  if (!selectedDevice.typeId.startsWith('belt_') || !('slot' in runtime)) {
    return runtime.stallReason
  }

  const slot = runtime.slot
  if (!slot) return t('detail.internal.canAccept')
  if (slot.progress01 < 0.5) return t('detail.internal.occupiedHalf', { progress: slot.progress01.toFixed(2) })
  if (slot.progress01 < 1) return t('detail.internal.canTry', { progress: slot.progress01.toFixed(2) })
  return t('detail.internal.readyCommit', { progress: slot.progress01.toFixed(2) })
}

function formatItemPair(language: Language, ore: number, powder: number) {
  return `${getItemLabel(language, 'item_originium_ore')}: ${ore}, ${getItemLabel(language, 'item_originium_powder')}: ${powder}`
}

function getItemIconPath(itemId: ItemId) {
  return `/itemicon/${itemId}.png`
}

function formatSlotValue(
  slot: SlotData | null,
  language: Language,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  if (!slot) return t('detail.empty')
  return `${getItemLabel(language, slot.itemId)} @ ${slot.progress01.toFixed(2)}`
}

function recipeForDevice(typeId: DeviceTypeId) {
  return RECIPES.find((recipe) => recipe.machineType === typeId)
}

function formatRecipeSummary(typeId: DeviceTypeId, language: Language) {
  const recipe = recipeForDevice(typeId)
  if (!recipe) return '-'
  const input = recipe.inputs.map((entry) => `${getItemLabel(language, entry.itemId)} x${entry.amount}`).join(' + ')
  const output = recipe.outputs.map((entry) => `${getItemLabel(language, entry.itemId)} x${entry.amount}`).join(' + ')
  return `${input} -> ${output}`
}

function getZoomStep(cellSize: number) {
  if (cellSize < 48) return 1
  if (cellSize < 120) return 3
  if (cellSize < 200) return 8
  if (cellSize < 260) return 16
  return 30
}

function cycleTicksFromSeconds(cycleSeconds: number, tickRateHz: number) {
  return Math.max(1, Math.round(cycleSeconds * tickRateHz))
}

const BASE_CELL_SIZE = 64
const BELT_VIEWBOX_SIZE = 64

const HIDDEN_DEVICE_LABEL_TYPES = new Set<DeviceTypeId>(['splitter_1x1', 'merger_1x1', 'bridge_1x1'])
const HIDDEN_CHEVRON_DEVICE_TYPES = new Set<DeviceTypeId>(['splitter_1x1', 'merger_1x1', 'bridge_1x1'])
function isKnownDeviceTypeId(typeId: unknown): typeId is DeviceTypeId {
  return typeof typeId === 'string' && typeId in DEVICE_TYPE_BY_ID
}

const EDGE_ANCHOR: Record<Edge, { x: number; y: number }> = {
  N: { x: 32, y: 0 },
  S: { x: 32, y: 64 },
  W: { x: 0, y: 32 },
  E: { x: 64, y: 32 },
}

function buildBeltTrackPath(inEdge: Edge, outEdge: Edge) {
  const start = EDGE_ANCHOR[inEdge]
  const end = EDGE_ANCHOR[outEdge]
  if (OPPOSITE_EDGE[inEdge] === outEdge) {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`
  }
  return `M ${start.x} ${start.y} L 32 32 L ${end.x} ${end.y}`
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function getBeltItemPosition(inEdge: Edge, outEdge: Edge, progress01: number) {
  const t = clamp(progress01, 0, 1)
  const start = EDGE_ANCHOR[inEdge]
  const end = EDGE_ANCHOR[outEdge]
  if (OPPOSITE_EDGE[inEdge] === outEdge) {
    return {
      x: lerp(start.x, end.x, t),
      y: lerp(start.y, end.y, t),
    }
  }

  if (t < 0.5) {
    const local = t / 0.5
    return {
      x: lerp(start.x, 32, local),
      y: lerp(start.y, 32, local),
    }
  }

  const local = (t - 0.5) / 0.5
  return {
    x: lerp(32, end.x, local),
    y: lerp(32, end.y, local),
  }
}

function junctionArrowPoints(edge: Edge) {
  if (edge === 'E') return '68,44 80,50 68,56'
  if (edge === 'W') return '32,44 20,50 32,56'
  if (edge === 'N') return '44,32 50,20 56,32'
  return '44,68 50,80 56,68'
}

function rotatedFootprintSize(size: { width: number; height: number }, rotation: Rotation) {
  if (rotation === 90 || rotation === 270) {
    return { width: size.height, height: size.width }
  }
  return size
}

function getMaxCellSizeForViewport(viewport: HTMLDivElement | null) {
  if (!viewport) return 300
  return Math.max(12, Math.ceil(Math.max(viewport.clientWidth, viewport.clientHeight) / 12))
}

function clampViewportOffset(
  offset: { x: number; y: number },
  viewportSize: { width: number; height: number },
  canvasSize: { width: number; height: number },
) {
  const x =
    canvasSize.width <= viewportSize.width
      ? (viewportSize.width - canvasSize.width) / 2
      : clamp(offset.x, viewportSize.width - canvasSize.width, 0)
  const y =
    canvasSize.height <= viewportSize.height
      ? (viewportSize.height - canvasSize.height) / 2
      : clamp(offset.y, viewportSize.height - canvasSize.height, 0)
  return { x: Math.round(x), y: Math.round(y) }
}

function App() {
  const [layout, setLayout] = usePersistentState<LayoutState>('stage1-layout', { lotSize: 60, devices: [] })
  const [language, setLanguage] = usePersistentState<Language>('stage1-language', 'zh-CN')
  const [mode, setMode] = usePersistentState<EditMode>('stage1-mode', 'select')
  const [placeType, setPlaceType] = usePersistentState<DeviceTypeId>('stage1-place-type', 'item_port_grinder_1')
  const [deleteWholeBelt, setDeleteWholeBelt] = usePersistentState<boolean>('stage1-delete-whole-belt', false)
  const [cellSize, setCellSize] = usePersistentState<number>('stage1-cell-size', 64)
  const [selection, setSelection] = useState<string[]>([])
  const [sim, setSim] = useState<SimState>(() => createInitialSimState())
  const [logStart, setLogStart] = useState<{ x: number; y: number } | null>(null)
  const [logCurrent, setLogCurrent] = useState<{ x: number; y: number } | null>(null)
  const [logTrace, setLogTrace] = useState<Array<{ x: number; y: number }>>([])
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | null>(null)
  const [dragBasePositions, setDragBasePositions] = useState<Record<string, { x: number; y: number }> | null>(null)
  const [dragStartCell, setDragStartCell] = useState<{ x: number; y: number } | null>(null)
  const [dragRect, setDragRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number } | null>(null)
  const [logisticsTool, setLogisticsTool] = useState<'belt'>('belt')
  const [viewOffset, setViewOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState<{ clientX: number; clientY: number; offsetX: number; offsetY: number } | null>(null)
  const [measuredTickRate, setMeasuredTickRate] = useState(0)

  const zoomScale = cellSize / BASE_CELL_SIZE

  const gridRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const simTimerRef = useRef<number | null>(null)
  const tickRateSampleRef = useRef<{ tick: number; ms: number } | null>(null)
  const simTickRef = useRef(0)
  const unknownDevicePromptKeyRef = useRef<string>('')

  const occupancyMap = useMemo(() => buildOccupancyMap(layout), [layout])
  const cellDeviceMap = useMemo(() => cellToDeviceId(layout), [layout])
  const t = useMemo(() => createTranslator(language), [language])

  const unknownDevices = useMemo(
    () => layout.devices.filter((device) => !isKnownDeviceTypeId((device as DeviceInstance & { typeId: unknown }).typeId)),
    [layout.devices],
  )

  useEffect(() => {
    const hasLegacyStorageId = layout.devices.some(
      (device) => String((device as DeviceInstance & { typeId: unknown }).typeId) === 'storage_box_3x3',
    )
    const hasLegacyPowerPoleId = layout.devices.some(
      (device) => String((device as DeviceInstance & { typeId: unknown }).typeId) === 'power_pole_2x2',
    )
    if (!hasLegacyStorageId && !hasLegacyPowerPoleId) return

    setLayout((current) => ({
      ...current,
      devices: current.devices.map((device) =>
        String((device as DeviceInstance & { typeId: unknown }).typeId) === 'storage_box_3x3'
          ? { ...device, typeId: 'item_port_storager_1' }
          : String((device as DeviceInstance & { typeId: unknown }).typeId) === 'power_pole_2x2'
            ? { ...device, typeId: 'item_port_power_diffuser_1' }
            : device,
      ),
    }))
  }, [layout.devices, setLayout])

  useEffect(() => {
    if (!isKnownDeviceTypeId(placeType)) {
      setPlaceType('item_port_grinder_1')
    }
  }, [placeType, setPlaceType])

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
    const confirmed = window.confirm(
      `检测到旧存档不兼容设备类型：${unknownTypeIds.join(', ')}。\n点击“确定”将删除无法识别的设备。`,
    )
    if (!confirmed) return

    const removedIds = new Set(unknownDevices.map((device) => device.instanceId))
    setLayout((current) => ({
      ...current,
      devices: current.devices.filter((device) => isKnownDeviceTypeId((device as DeviceInstance & { typeId: unknown }).typeId)),
    }))
    setSelection((current) => current.filter((id) => !removedIds.has(id)))
  }, [unknownDevices, setLayout])

  useEffect(() => {
    if (simTimerRef.current !== null) {
      window.clearInterval(simTimerRef.current)
      simTimerRef.current = null
    }

    if (!sim.isRunning) return
    const intervalMs = 1000 / (sim.tickRateHz * sim.speed)
    simTimerRef.current = window.setInterval(() => {
      setSim((current) => tickSimulation(layout, current))
    }, intervalMs)

    return () => {
      if (simTimerRef.current !== null) {
        window.clearInterval(simTimerRef.current)
        simTimerRef.current = null
      }
    }
  }, [layout, sim.isRunning, sim.speed, sim.tickRateHz])

  useEffect(() => {
    simTickRef.current = sim.tick
  }, [sim.tick])

  useEffect(() => {
    if (!sim.isRunning) {
      setMeasuredTickRate(0)
      tickRateSampleRef.current = null
      return
    }

    tickRateSampleRef.current = { tick: simTickRef.current, ms: performance.now() }
    const timer = window.setInterval(() => {
      const prev = tickRateSampleRef.current
      if (!prev) {
        tickRateSampleRef.current = { tick: simTickRef.current, ms: performance.now() }
        return
      }
      const nowMs = performance.now()
      const currentTick = simTickRef.current
      const deltaTick = currentTick - prev.tick
      const deltaSec = (nowMs - prev.ms) / 1000
      if (deltaSec > 0) setMeasuredTickRate(deltaTick / deltaSec)
      tickRateSampleRef.current = { tick: currentTick, ms: nowMs }
    }, 1000)

    return () => window.clearInterval(timer)
  }, [sim.isRunning])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'r' || selection.length === 0 || sim.isRunning) return
      setLayout((current) => ({
        ...current,
        devices: current.devices.map((device) => {
          if (!selection.includes(device.instanceId)) return device
          if (device.typeId.startsWith('belt_')) return device
          const nextRotation = ((device.rotation + 90) % 360) as Rotation
          return { ...device, rotation: nextRotation }
        }),
      }))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selection, setLayout, sim.isRunning])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const canvasWidth = layout.lotSize * BASE_CELL_SIZE * zoomScale
    const canvasHeight = layout.lotSize * BASE_CELL_SIZE * zoomScale
    setViewOffset((current) =>
      clampViewportOffset(
        current,
        { width: viewport.clientWidth, height: viewport.clientHeight },
        { width: canvasWidth, height: canvasHeight },
      ),
    )
  }, [layout.lotSize, zoomScale])

  const toCell = (clientX: number, clientY: number) => {
    const viewportRect = viewportRef.current?.getBoundingClientRect()
    if (!viewportRect) return null
    const scaledCellSize = BASE_CELL_SIZE * zoomScale
    const x = Math.floor((clientX - viewportRect.left - viewOffset.x) / scaledCellSize)
    const y = Math.floor((clientY - viewportRect.top - viewOffset.y) / scaledCellSize)
    if (x < 0 || y < 0 || x >= layout.lotSize || y >= layout.lotSize) return null
    return { x, y }
  }

  const toPlaceOrigin = (cell: { x: number; y: number }, typeId: DeviceTypeId) => {
    const type = DEVICE_TYPE_BY_ID[typeId]
    return {
      x: Math.floor(cell.x + 0.5 - type.size.width / 2),
      y: Math.floor(cell.y + 0.5 - type.size.height / 2),
    }
  }

  const placeDevice = (cell: { x: number; y: number }) => {
    const origin = toPlaceOrigin(cell, placeType)
    const instance: DeviceInstance = {
      instanceId: nextId(placeType),
      typeId: placeType,
      origin,
      rotation: 0,
      config: initialStorageConfig(placeType),
    }
    if (!isWithinLot(instance, layout.lotSize)) return
    setLayout((current) => ({ ...current, devices: [...current.devices, instance] }))
  }

  const onCanvasMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button === 1) {
      event.preventDefault()
      if (mode === 'logistics') {
        setLogStart(null)
        setLogCurrent(null)
        setLogTrace([])
      }
      setIsPanning(true)
      setPanStart({ clientX: event.clientX, clientY: event.clientY, offsetX: viewOffset.x, offsetY: viewOffset.y })
      return
    }

    if (event.button !== 0) return

    const cell = toCell(event.clientX, event.clientY)
    if (!cell) return

    if (mode === 'place') {
      if (sim.isRunning) return
      placeDevice(cell)
      return
    }

    if (mode === 'delete') {
      if (sim.isRunning) return
      const id = cellDeviceMap.get(`${cell.x},${cell.y}`)
      if (!id) return
      if (deleteWholeBelt) {
        setLayout((current) => deleteConnectedBelts(current, cell.x, cell.y))
      } else {
        setLayout((current) => ({ ...current, devices: current.devices.filter((device) => device.instanceId !== id) }))
      }
      setSelection([])
      return
    }

    if (mode === 'logistics') {
      if (sim.isRunning) return
      setLogStart(cell)
      setLogCurrent(cell)
      setLogTrace([cell])
      return
    }

    const clickedId = cellDeviceMap.get(`${cell.x},${cell.y}`)
    if (clickedId) {
      const activeSelection = selection.includes(clickedId) ? selection : [clickedId]
      if (!selection.includes(clickedId)) setSelection(activeSelection)
      const base: Record<string, { x: number; y: number }> = {}
      for (const id of activeSelection) {
        const device = getDeviceById(layout, id)
        if (device) base[id] = { ...device.origin }
      }
      setDragBasePositions(base)
      setDragStartCell(cell)
      setDragOrigin(cell)
      setDragRect(null)
      return
    }

    setSelection([])
    setDragOrigin(cell)
    setDragRect({ x1: cell.x, y1: cell.y, x2: cell.x, y2: cell.y })
  }

  const onCanvasMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isPanning && panStart) {
      const viewport = viewportRef.current
      if (!viewport) return
      const canvasWidth = layout.lotSize * BASE_CELL_SIZE * zoomScale
      const canvasHeight = layout.lotSize * BASE_CELL_SIZE * zoomScale
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

    const cell = toCell(event.clientX, event.clientY)
    if (!cell) {
      setHoverCell(null)
      return
    }
    setHoverCell(cell)

    if (mode === 'logistics' && logStart) {
      const last = logTrace[logTrace.length - 1]
      if (last && last.x === cell.x && last.y === cell.y) return
      setLogTrace((current) => [...current, cell])
      setLogCurrent(cell)
      return
    }

    if (mode === 'select' && dragBasePositions && dragOrigin && selection.length > 0 && !sim.isRunning) {
      const dx = cell.x - dragOrigin.x
      const dy = cell.y - dragOrigin.y
      setLayout((current) => {
        const moved = current.devices.map((device) => {
          if (!selection.includes(device.instanceId)) return device
          const base = dragBasePositions[device.instanceId]
          if (!base) return device
          return {
            ...device,
            origin: { x: base.x + dx, y: base.y + dy },
          }
        })

        if (!moved.every((device) => isWithinLot(device, current.lotSize))) return current
        return { ...current, devices: moved }
      })
      setDragStartCell(cell)
      return
    }

    if (mode === 'select' && dragOrigin && dragRect) {
      setDragRect({ ...dragRect, x2: cell.x, y2: cell.y })
      return
    }

    if (mode === 'select' && dragStartCell) {
      setDragStartCell(cell)
    }
  }

  const onCanvasMouseUp = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isPanning) {
      setIsPanning(false)
      setPanStart(null)
      return
    }

    const cell = toCell(event.clientX, event.clientY)

    if (mode === 'logistics' && logStart && logCurrent && !sim.isRunning) {
      const path = logisticsPreview
      if (path && path.length >= 2 && logisticsTool === 'belt') {
        setLayout((current) => applyLogisticsPath(current, path))
      }
      setLogStart(null)
      setLogCurrent(null)
      setLogTrace([])
      return
    }

    if (mode === 'select' && dragRect && dragOrigin) {
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
        .map((device) => device.instanceId)
      setSelection(ids)
      setDragRect(null)
      setDragOrigin(null)
      return
    }

    if (mode === 'select' && dragStartCell && dragOrigin && cell && selection.length > 0 && !sim.isRunning) {
      setDragStartCell(null)
      setDragOrigin(null)
      setDragBasePositions(null)
      return
    }

    setDragStartCell(null)
    setDragOrigin(null)
    setDragRect(null)
    setDragBasePositions(null)
  }

  const onCanvasWheel = (event: React.WheelEvent<HTMLDivElement>) => {
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
    const scaledCellSize = BASE_CELL_SIZE * zoomScale
    const worldX = (anchorX - viewOffset.x) / scaledCellSize
    const worldY = (anchorY - viewOffset.y) / scaledCellSize
    const nextOffset = {
      x: anchorX - worldX * BASE_CELL_SIZE * (next / BASE_CELL_SIZE),
      y: anchorY - worldY * BASE_CELL_SIZE * (next / BASE_CELL_SIZE),
    }
    const clampedOffset = clampViewportOffset(
      nextOffset,
      { width: viewport.clientWidth, height: viewport.clientHeight },
      { width: layout.lotSize * BASE_CELL_SIZE * (next / BASE_CELL_SIZE), height: layout.lotSize * BASE_CELL_SIZE * (next / BASE_CELL_SIZE) },
    )
    setViewOffset(clampedOffset)
    setCellSize(next)
  }

  const selectedDevice = useMemo(() => {
    if (selection.length !== 1) return null
    return getDeviceById(layout, selection[0])
  }, [layout, selection])

  const selectedRuntime = useMemo(() => {
    if (!selectedDevice) return undefined
    return sim.runtimeById[selectedDevice.instanceId]
  }, [selectedDevice, sim.runtimeById])

  const logisticsPreview = useMemo(() => {
    if (!logStart || !logCurrent || logTrace.length === 0) return null
    const candidatePath = pathFromTrace(logTrace)
    if (!candidatePath) return null
    return longestValidLogisticsPrefix(layout, candidatePath)
  }, [layout, logStart, logCurrent, logTrace])

  const inTransitItems = useMemo(() => {
    return layout.devices.flatMap((device) => {
      if (!device.typeId.startsWith('belt_')) return []
      const runtime = sim.runtimeById[device.instanceId]
      if (!runtime || !('slot' in runtime) || !runtime.slot) return []

      const beltPorts = getRotatedPorts(device)
      const beltInEdge = beltPorts.find((port) => port.direction === 'Input')?.edge ?? 'W'
      const beltOutEdge = beltPorts.find((port) => port.direction === 'Output')?.edge ?? 'E'
      const position = getBeltItemPosition(beltInEdge, beltOutEdge, runtime.slot.progress01)

      return [
        {
          key: `${device.instanceId}:${runtime.slot.enteredTick}:${runtime.slot.itemId}`,
          itemId: runtime.slot.itemId,
          progress01: runtime.slot.progress01,
          x: (device.origin.x + position.x / BELT_VIEWBOX_SIZE) * BASE_CELL_SIZE,
          y: (device.origin.y + position.y / BELT_VIEWBOX_SIZE) * BASE_CELL_SIZE,
        },
      ]
    })
  }, [layout.devices, sim.runtimeById])

  const powerRangeOutlines = useMemo(() => {
    return layout.devices
      .filter((device) => device.typeId === 'item_port_power_diffuser_1')
      .map((device) => ({
        key: `power-range-${device.instanceId}`,
        left: (device.origin.x - 5) * BASE_CELL_SIZE,
        top: (device.origin.y - 5) * BASE_CELL_SIZE,
        width: 12 * BASE_CELL_SIZE,
        height: 12 * BASE_CELL_SIZE,
      }))
  }, [layout.devices])

  const portChevrons = useMemo(() => {
    if (mode !== 'logistics' && mode !== 'select') return []
    const links = linksFromLayout(layout)
    const connectedPortKeys = new Set<string>()
    const keyOf = (port: { instanceId: string; portId: string; x: number; y: number; edge: string }) =>
      `${port.instanceId}:${port.portId}:${port.x}:${port.y}:${port.edge}`

    for (const link of links) {
      connectedPortKeys.add(keyOf(link.from))
      connectedPortKeys.add(keyOf(link.to))
    }

    const result: Array<{ key: string; x: number; y: number; angle: number; width: number; height: number }> = []
    const chevronLength = BASE_CELL_SIZE * (1 / 5)
    const chevronThickness = BASE_CELL_SIZE * (2 / 3)
    const outsideOffset = chevronLength / 2
    for (const device of layout.devices) {
      if (device.typeId.startsWith('belt_')) continue
      if (HIDDEN_CHEVRON_DEVICE_TYPES.has(device.typeId)) continue
      if (mode === 'select' && !selection.includes(device.instanceId)) continue
      for (const port of getRotatedPorts(device)) {
        const portKey = keyOf(port)
        if (mode === 'logistics' && connectedPortKeys.has(portKey)) continue

        const centerX = (port.x + 0.5) * BASE_CELL_SIZE
        const centerY = (port.y + 0.5) * BASE_CELL_SIZE
        let x = centerX
        let y = centerY
        if (port.edge === 'N') y = port.y * BASE_CELL_SIZE - outsideOffset
        if (port.edge === 'S') y = (port.y + 1) * BASE_CELL_SIZE + outsideOffset
        if (port.edge === 'W') x = port.x * BASE_CELL_SIZE - outsideOffset
        if (port.edge === 'E') x = (port.x + 1) * BASE_CELL_SIZE + outsideOffset

        result.push({
          key: portKey,
          x,
          y,
          angle: port.direction === 'Input' ? EDGE_ANGLE[OPPOSITE_EDGE[port.edge]] : EDGE_ANGLE[port.edge],
          width: chevronLength,
          height: chevronThickness,
        })
      }
    }

    return result
  }, [layout, mode, selection])

  const placePreview = useMemo(() => {
    if (mode !== 'place' || !hoverCell || sim.isRunning) return null
    const origin = toPlaceOrigin(hoverCell, placeType)
    const instance: DeviceInstance = {
      instanceId: 'preview',
      typeId: placeType,
      origin,
      rotation: 0,
      config: {},
    }
    return {
      origin,
      type: DEVICE_TYPE_BY_ID[placeType],
      isValid: isWithinLot(instance, layout.lotSize),
    }
  }, [hoverCell, layout.lotSize, mode, placeType, sim.isRunning])

  const uiHint = sim.isRunning ? t('top.runningHint') : t('top.editHint')

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <div className="topbar-title">{t('app.title')}</div>
          <label className="language-switch">
            <span>{t('app.language')}</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="topbar-controls">
          {!sim.isRunning ? (
            <button
              onClick={() => {
                if (unknownDevices.length > 0) {
                  window.alert('当前存档包含无法识别的旧设备，请先确认删除后再开始仿真。')
                  return
                }
                setSim((current) => startSimulation(layout, current))
              }}
            >
              {t('top.start')}
            </button>
          ) : (
            <button onClick={() => setSim((current) => stopSimulation(current))}>{t('top.stop')}</button>
          )}
          {[0.25, 1, 2, 4, 16].map((speed) => (
            <button
              key={speed}
              className={sim.speed === speed ? 'active' : ''}
              onClick={() => setSim((current) => ({ ...current, speed: speed as 0.25 | 1 | 2 | 4 | 16 }))}
            >
              {speed}x
            </button>
          ))}
          <span className="hint">{t('top.zoomHint', { size: cellSize })}</span>
          <span className="hint">{uiHint}</span>
        </div>
      </header>

      <main className="main-grid">
        <aside className="panel left-panel">
          <h3>{t('left.mode')}</h3>
          {(['select', 'place', 'logistics', 'delete'] as const).map((entry) => (
            <button key={entry} className={mode === entry ? 'active' : ''} onClick={() => setMode(entry)}>
              {getModeLabel(language, entry)}
            </button>
          ))}

          {mode === 'place' && (
            <>
              <h3>{t('left.device')}</h3>
              {PLACEABLE_TYPES.map((deviceType) => (
                <button
                  key={deviceType.id}
                  className={placeType === deviceType.id ? 'active' : ''}
                  onClick={() => setPlaceType(deviceType.id)}
                >
                  {getDeviceLabel(language, deviceType.id)}
                </button>
              ))}
            </>
          )}

          {mode === 'logistics' && (
            <>
              <h3>{t('left.logisticsSubMode')}</h3>
              <button className={logisticsTool === 'belt' ? 'active' : ''} onClick={() => setLogisticsTool('belt')}>
                {t('left.placeBelt')}
              </button>
            </>
          )}

          {mode === 'delete' && (
            <>
              <h3>{t('left.deleteSubMode')}</h3>
              <button className={!deleteWholeBelt ? 'active' : ''} onClick={() => setDeleteWholeBelt(false)}>
                {t('left.deleteSingle')}
              </button>
              <button className={deleteWholeBelt ? 'active' : ''} onClick={() => setDeleteWholeBelt(true)}>
                {t('left.deleteWholeBelt')}
              </button>
              <button
                onClick={() => {
                  if (sim.isRunning) return
                  setLayout((current) => ({ ...current, devices: [] }))
                  setSelection([])
                }}
              >
                {t('left.deleteAll')}
              </button>
            </>
          )}
        </aside>

        <section className="canvas-panel panel">
          <div
            ref={viewportRef}
            className={`canvas-viewport${isPanning ? ' panning' : ''}`}
            onMouseDown={onCanvasMouseDown}
            onMouseMove={onCanvasMouseMove}
            onMouseUp={onCanvasMouseUp}
            onMouseLeave={onCanvasMouseUp}
            onWheel={onCanvasWheel}
            onAuxClick={(event) => event.preventDefault()}
          >
            <div
              ref={gridRef}
              className={`grid-canvas mode-${mode}`}
              style={{
                width: layout.lotSize * BASE_CELL_SIZE,
                height: layout.lotSize * BASE_CELL_SIZE,
                backgroundSize: `${BASE_CELL_SIZE}px ${BASE_CELL_SIZE}px`,
                transformOrigin: 'top left',
                transform: `translate(${viewOffset.x}px, ${viewOffset.y}px) scale(${zoomScale})`,
              }}
            >
              <div className="lot-border" />

              {powerRangeOutlines.map((outline) => (
                <div
                  key={outline.key}
                  className="power-range-outline"
                  style={{
                    left: outline.left,
                    top: outline.top,
                    width: outline.width,
                    height: outline.height,
                  }}
                />
              ))}

              {layout.devices.map((device) => {
                const type = DEVICE_TYPE_BY_ID[device.typeId]
                if (!type) return null
                const footprintSize = rotatedFootprintSize(type.size, device.rotation)
                const surfaceContentWidthPx = footprintSize.width * BASE_CELL_SIZE - 6
                const surfaceContentHeightPx = footprintSize.height * BASE_CELL_SIZE - 6
                const isQuarterTurn = device.rotation === 90 || device.rotation === 270
                const textureWidthPx = isQuarterTurn ? surfaceContentHeightPx : surfaceContentWidthPx
                const textureHeightPx = isQuarterTurn ? surfaceContentWidthPx : surfaceContentHeightPx
                const runtime = sim.runtimeById[device.instanceId]
                const status = runtimeLabel(runtime)
                const isPickupPort = device.typeId === 'item_port_unloader_1'
                const isGrinder = device.typeId === 'item_port_grinder_1'
                const isPowerPole = device.typeId === 'item_port_power_diffuser_1'
                const isStorage = device.typeId === 'item_port_storager_1'
                const isTexturedDevice = isPickupPort || isGrinder || isPowerPole || isStorage
                const textureSrc = isPickupPort
                  ? '/sprites/item_port_unloader_1.png'
                  : isGrinder
                    ? '/sprites/item_port_grinder_1.png'
                    : isPowerPole
                      ? '/sprites/item_port_power_diffuser_1.png'
                    : isStorage
                      ? '/sprites/item_port_storager_1.png'
                    : null
                const isBelt = device.typeId.startsWith('belt_')
                const isSplitter = device.typeId === 'splitter_1x1'
                const isMerger = device.typeId === 'merger_1x1'
                const beltPorts = isBelt ? getRotatedPorts(device) : []
                const beltInEdge = isBelt
                  ? beltPorts.find((port) => port.direction === 'Input')?.edge ?? 'W'
                  : 'W'
                const beltOutEdge = isBelt
                  ? beltPorts.find((port) => port.direction === 'Output')?.edge ?? 'E'
                  : 'E'
                const beltPath = buildBeltTrackPath(beltInEdge, beltOutEdge)
                const splitterOutputEdges = isSplitter
                  ? getRotatedPorts(device)
                      .filter((port) => port.direction === 'Output')
                      .map((port) => port.edge)
                  : []
                const mergerOutputEdges = isMerger
                  ? [getRotatedPorts(device).find((port) => port.direction === 'Output')?.edge ?? 'E']
                  : []
                const junctionArrowEdges = isSplitter ? splitterOutputEdges : mergerOutputEdges
                return (
                  <div
                    key={device.instanceId}
                    className={`device ${isBelt ? 'belt-device' : ''} ${selection.includes(device.instanceId) ? 'selected' : ''} ${status !== 'running' && status !== 'idle' ? 'stalled' : ''}`}
                    style={{
                      left: device.origin.x * BASE_CELL_SIZE,
                      top: device.origin.y * BASE_CELL_SIZE,
                      width: footprintSize.width * BASE_CELL_SIZE,
                      height: footprintSize.height * BASE_CELL_SIZE,
                    }}
                    title={`${device.typeId} | ${status}`}
                  >
                    {isBelt ? (
                      <div className="belt-track-wrap">
                        <svg className="belt-track-svg" viewBox={`0 0 ${BELT_VIEWBOX_SIZE} ${BELT_VIEWBOX_SIZE}`} preserveAspectRatio="none" aria-hidden="true">
                          {(() => {
                            const beltEdgeMaskId = `belt-edge-mask-${device.instanceId}`
                            return (
                              <>
                                <defs>
                                  <mask id={beltEdgeMaskId} maskUnits="userSpaceOnUse">
                                    <rect x="0" y="0" width={BELT_VIEWBOX_SIZE} height={BELT_VIEWBOX_SIZE} fill="black" />
                                    <path d={beltPath} className="belt-edge-mask-outer" />
                                    <path d={beltPath} className="belt-edge-mask-inner" />
                                  </mask>
                                </defs>
                                <path d={beltPath} className="belt-track-fill" />
                                <path d={beltPath} className="belt-track-edge" mask={`url(#${beltEdgeMaskId})`} />
                              </>
                            )
                          })()}
                        </svg>
                        <span
                          className="belt-arrow"
                          style={{ transform: `translate(-50%, -50%) rotate(${EDGE_ANGLE[beltOutEdge]}deg)` }}
                        />
                      </div>
                    ) : (
                      <div
                        className={`device-surface ${isPickupPort ? 'pickup-port-surface' : ''} ${isGrinder ? 'grinder-surface' : ''} ${isTexturedDevice ? 'textured-surface' : ''}`}
                      >
                        {textureSrc && (
                          <img
                            className="device-texture"
                            src={textureSrc}
                            alt=""
                            aria-hidden="true"
                            draggable={false}
                            style={{
                              width: `${textureWidthPx}px`,
                              height: `${textureHeightPx}px`,
                              transform: `translate(-50%, -50%) rotate(${device.rotation}deg)`,
                            }}
                          />
                        )}
                        {(isSplitter || isMerger) && (
                          <div className="junction-icon" aria-hidden="true">
                            <svg className="junction-icon-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                              <line className="junction-cross-line" x1="20" y1="50" x2="80" y2="50" />
                              <line className="junction-cross-line" x1="50" y1="20" x2="50" y2="80" />
                              {junctionArrowEdges.map((edge) => (
                                <polyline
                                  key={`${device.instanceId}-${edge}`}
                                  className="junction-arrow-line"
                                  points={junctionArrowPoints(edge)}
                                />
                              ))}
                            </svg>
                          </div>
                        )}
                        {!HIDDEN_DEVICE_LABEL_TYPES.has(device.typeId) && (
                          <span className={`device-label ${isPickupPort ? 'pickup-label' : ''} ${isPickupPort && isQuarterTurn ? 'pickup-label-vertical' : ''}`}>
                            {getDeviceLabel(language, device.typeId)}
                          </span>
                        )}
                        {isPickupPort && !device.config.pickupItemId && <em>?</em>}
                      </div>
                    )}
                  </div>
                )
              })}

              <div className="in-transit-overlay" aria-hidden="true">
                {inTransitItems.map((item) => (
                  <span
                    key={item.key}
                    className={`belt-item-box item-${item.itemId}`}
                    style={{
                      left: item.x,
                      top: item.y,
                      width: `${BASE_CELL_SIZE * 0.5}px`,
                      height: `${BASE_CELL_SIZE * 0.5}px`,
                    }}
                    title={`${getItemLabel(language, item.itemId)} @ ${item.progress01.toFixed(2)}`}
                  >
                    <img className="belt-item-cover" src={getItemIconPath(item.itemId)} alt="" draggable={false} />
                  </span>
                ))}
              </div>

              {portChevrons.map((chevron) => (
                <div
                  key={chevron.key}
                  className="port-chevron"
                  style={{
                    left: chevron.x,
                    top: chevron.y,
                    width: chevron.width,
                    height: chevron.height,
                    transform: `translate(-50%, -50%) rotate(${chevron.angle}deg)`,
                  }}
                >
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    <polyline className="port-chevron-outline" points="0,12 100,50 0,88" />
                    <polyline className="port-chevron-inner" points="0,22 84,50 0,78" />
                  </svg>
                </div>
              ))}

              {placePreview && (
                <div
                  className={`place-ghost ${placePreview.isValid ? 'valid' : 'invalid'}`}
                  style={{
                    left: placePreview.origin.x * BASE_CELL_SIZE,
                    top: placePreview.origin.y * BASE_CELL_SIZE,
                    width: placePreview.type.size.width * BASE_CELL_SIZE,
                    height: placePreview.type.size.height * BASE_CELL_SIZE,
                  }}
                />
              )}

              {dragRect && (
                <div
                  className="selection-rect"
                  style={{
                    left: Math.min(dragRect.x1, dragRect.x2) * BASE_CELL_SIZE,
                    top: Math.min(dragRect.y1, dragRect.y2) * BASE_CELL_SIZE,
                    width: (Math.abs(dragRect.x2 - dragRect.x1) + 1) * BASE_CELL_SIZE,
                    height: (Math.abs(dragRect.y2 - dragRect.y1) + 1) * BASE_CELL_SIZE,
                  }}
                />
              )}

              {logisticsPreview?.map((cell, index) => (
                <div
                  key={`preview-${cell.x}-${cell.y}-${index}`}
                  className="log-preview"
                  style={{ left: cell.x * BASE_CELL_SIZE, top: cell.y * BASE_CELL_SIZE, width: BASE_CELL_SIZE, height: BASE_CELL_SIZE }}
                />
              ))}
            </div>
          </div>
        </section>

        <aside className="panel right-panel">
          <h3>{t('right.lot')}</h3>
          <div className="row">
            {[60, 40].map((size) => (
              <button
                key={size}
                className={layout.lotSize === size ? 'active' : ''}
                onClick={() => setLayout((current) => ({ ...current, lotSize: size as 40 | 60 }))}
              >
                {size}x{size}
              </button>
            ))}
          </div>

          <h3>{t('right.stats')}</h3>
          <table className="stats-table">
            <thead>
              <tr>
                <th>{t('table.itemName')}</th>
                <th>{t('table.producedPerMinute')}</th>
                <th>{t('table.consumedPerMinute')}</th>
                <th>{t('table.currentStock')}</th>
              </tr>
            </thead>
            <tbody>
              {ITEMS.map((item) => (
                <tr key={item.id}>
                  <td>{getItemLabel(language, item.id)}</td>
                  <td>{sim.stats.producedPerMinute[item.id].toFixed(2)}</td>
                  <td>{sim.stats.consumedPerMinute[item.id].toFixed(2)}</td>
                  <td>{Number.isFinite(sim.warehouse[item.id]) ? sim.warehouse[item.id] : '∞'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>{t('right.simDebug')}</h3>
          <div className="kv"><span>{t('debug.measuredTps')}</span><span>{measuredTickRate.toFixed(2)}</span></div>
          <div className="kv"><span>{t('debug.simTick')}</span><span>{sim.tick}</span></div>
          <div className="kv"><span>{t('debug.simSeconds')}</span><span>{sim.stats.simSeconds.toFixed(2)}</span></div>

          <h3>{t('right.selected')}</h3>
          {selectedDevice ? (
            <>
              <div className="kv"><span>{t('detail.instanceId')}</span><span>{selectedDevice.instanceId}</span></div>
              <div className="kv"><span>{t('detail.deviceType')}</span><span>{getDeviceLabel(language, selectedDevice.typeId)}</span></div>
              <div className="kv"><span>{t('detail.rotation')}</span><span>{selectedDevice.rotation}</span></div>
              <div className="kv"><span>{t('detail.position')}</span><span>{selectedDevice.origin.x},{selectedDevice.origin.y}</span></div>
              <div className="kv"><span>{t('detail.currentStatus')}</span><span>{runtimeLabel(selectedRuntime)}</span></div>
              <div className="kv">
                <span>{t('detail.internalStatus')}</span>
                <span>{getInternalStatusText(selectedDevice, selectedRuntime, t)}</span>
              </div>
              {selectedDevice.typeId.startsWith('belt_') && selectedRuntime && 'slot' in selectedRuntime && (
                <>
                  <div className="kv">
                    <span>{t('detail.currentItem')}</span>
                    <span>{selectedRuntime.slot ? getItemLabel(language, selectedRuntime.slot.itemId) : t('detail.empty')}</span>
                  </div>
                  <div className="kv">
                    <span>{t('detail.progress01')}</span>
                    <span>{selectedRuntime.slot ? selectedRuntime.slot.progress01.toFixed(2) : '0.00'}</span>
                  </div>
                  <div className="kv">
                    <span>{t('detail.avgTransitTicks')}</span>
                    <span>
                      {'transportSamples' in selectedRuntime && selectedRuntime.transportSamples > 0
                        ? (selectedRuntime.transportTotalTicks / selectedRuntime.transportSamples).toFixed(2)
                        : '-'}
                    </span>
                  </div>
                </>
              )}
              {selectedRuntime && (
                <>
                  {'inputBuffer' in selectedRuntime && 'outputBuffer' in selectedRuntime && (
                    (() => {
                      const recipe = recipeForDevice(selectedDevice.typeId)
                      const recipeCycleTicks = recipe ? cycleTicksFromSeconds(recipe.cycleSeconds, sim.tickRateHz) : 0
                      const progress = recipe
                        ? `${(selectedRuntime.progress01 * 100).toFixed(1)}% (${selectedRuntime.cycleProgressTicks}/${recipeCycleTicks})`
                        : `${(selectedRuntime.progress01 * 100).toFixed(1)}%`
                      const simSeconds = sim.tick / sim.tickRateHz
                      const avgItemsPerSecond = simSeconds > 0 ? selectedRuntime.producedItemsTotal / simSeconds : 0

                      return (
                        <>
                          <div className="kv">
                            <span>{t('detail.currentRecipe')}</span>
                            <span>{formatRecipeSummary(selectedDevice.typeId, language)}</span>
                          </div>
                          <div className="kv">
                            <span>{t('detail.productionProgress')}</span>
                            <span>{progress}</span>
                          </div>
                          <div className="kv">
                            <span>{t('detail.avgProducedPerSecond')}</span>
                            <span>{avgItemsPerSecond.toFixed(3)}</span>
                          </div>
                        </>
                      )
                    })()
                  )}
                  {'inputBuffer' in selectedRuntime && (
                    <div className="kv">
                      <span>{t('detail.cacheInputBuffer')}</span>
                      <span>
                        {formatItemPair(
                          language,
                          selectedRuntime.inputBuffer.item_originium_ore ?? 0,
                          selectedRuntime.inputBuffer.item_originium_powder ?? 0,
                        )}
                      </span>
                    </div>
                  )}
                  {'outputBuffer' in selectedRuntime && (
                    <div className="kv">
                      <span>{t('detail.cacheOutputBuffer')}</span>
                      <span>
                        {formatItemPair(
                          language,
                          selectedRuntime.outputBuffer.item_originium_ore ?? 0,
                          selectedRuntime.outputBuffer.item_originium_powder ?? 0,
                        )}
                      </span>
                    </div>
                  )}
                  {'inventory' in selectedRuntime && (
                    <div className="kv">
                      <span>{t('detail.cacheInventory')}</span>
                      <span>
                        {formatItemPair(
                          language,
                          selectedRuntime.inventory.item_originium_ore ?? 0,
                          selectedRuntime.inventory.item_originium_powder ?? 0,
                        )}
                      </span>
                    </div>
                  )}
                  {'slot' in selectedRuntime && (
                    <div className="kv">
                      <span>{t('detail.cacheSlot')}</span>
                      <span>{formatSlotValue(selectedRuntime.slot, language, t)}</span>
                    </div>
                  )}
                  {'nsSlot' in selectedRuntime && (
                    <div className="kv">
                      <span>{t('detail.cacheNsSlot')}</span>
                      <span>{formatSlotValue(selectedRuntime.nsSlot, language, t)}</span>
                    </div>
                  )}
                  {'weSlot' in selectedRuntime && (
                    <div className="kv">
                      <span>{t('detail.cacheWeSlot')}</span>
                      <span>{formatSlotValue(selectedRuntime.weSlot, language, t)}</span>
                    </div>
                  )}
                </>
              )}
              {selectedDevice.typeId === 'item_port_unloader_1' && (
                <div className="picker">
                  <label>{t('detail.pickupItem')}</label>
                  <select
                    disabled={sim.isRunning}
                    value={selectedDevice.config.pickupItemId ?? ''}
                    onChange={(event) => {
                      const value = event.target.value
                      setLayout((current) => ({
                        ...current,
                        devices: current.devices.map((device) =>
                          device.instanceId === selectedDevice.instanceId
                            ? { ...device, config: { ...device.config, pickupItemId: value ? (value as ItemId) : undefined } }
                            : device,
                        ),
                      }))
                    }}
                  >
                    <option value="">{t('detail.unselected')}</option>
                    {ITEMS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {getItemLabel(language, item.id)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {selectedDevice.typeId === 'item_port_storager_1' && (
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={selectedDevice.config.submitToWarehouse ?? true}
                    disabled={sim.isRunning}
                    onChange={(event) => {
                      const checked = event.target.checked
                      setLayout((current) => ({
                        ...current,
                        devices: current.devices.map((device) =>
                          device.instanceId === selectedDevice.instanceId
                            ? { ...device, config: { ...device.config, submitToWarehouse: checked } }
                            : device,
                        ),
                      }))
                    }}
                  />
                  {t('detail.submitWarehouse')}
                </label>
              )}
            </>
          ) : (
            <p>{t('right.noneSelected')}</p>
          )}
        </aside>
      </main>
    </div>
  )
}

export default App
