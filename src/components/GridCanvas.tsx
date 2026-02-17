import { Circle, Group, Layer, Line, Rect, Stage, Text } from "react-konva"
import { useEffect, useMemo, useState } from "react"
import { getMachinePorts } from "../core/machines"
import { useAppStore } from "../state/appStore"
import { BUILDING_PROTOTYPE_MAP } from "../types/domain"

const BUILDING_STROKE_WIDTH = 1
const BUILDING_STROKE_WIDTH_SELECTED = 2
const BUILDING_GAP_MIN = 0.8
const BUILDING_GAP_RATIO = 0.06

export function GridCanvas() {
  const selectedGridSize = useAppStore((state) => state.selectedGridSize)
  const mode = useAppStore((state) => state.mode)
  const interactionMode = useAppStore((state) => state.interactionMode)
  const machines = useAppStore((state) => state.machines)
  const selectedMachineId = useAppStore((state) => state.selectedMachineId)
  const activePrototypeId = useAppStore((state) => state.activePrototypeId)
  const machineRuntime = useAppStore((state) => state.machineRuntime)
  const placeMachineAt = useAppStore((state) => state.placeMachineAt)
  const deleteMachineById = useAppStore((state) => state.deleteMachineById)
  const selectMachine = useAppStore((state) => state.selectMachine)
  const moveMachine = useAppStore((state) => state.moveMachine)
  const logisticsMode = useAppStore((state) => state.logisticsMode)
  const beltSegments = useAppStore((state) => state.beltSegments)
  const beltDragBaseSegments = useAppStore((state) => state.beltDragBaseSegments)
  const beltDrawStart = useAppStore((state) => state.beltDrawStart)
  const startBeltDrag = useAppStore((state) => state.startBeltDrag)
  const extendBeltDrag = useAppStore((state) => state.extendBeltDrag)
  const finishBeltDrag = useAppStore((state) => state.finishBeltDrag)
  const deleteBeltAt = useAppStore((state) => state.deleteBeltAt)
  const inLogisticsMode = interactionMode === "logistics"

  const [zoom, setZoom] = useState(1)
  const [stagePosition, setStagePosition] = useState({ x: 0, y: 0 })
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [isMiddlePanning, setIsMiddlePanning] = useState(false)
  const [ghostGrid, setGhostGrid] = useState<{ x: number; y: number } | null>(null)
  const [isBeltDragging, setIsBeltDragging] = useState(false)
  const [draggingMachineGhost, setDraggingMachineGhost] = useState<{
    id: string
    x: number
    y: number
    w: number
    h: number
  } | null>(null)

  const activePrototype = BUILDING_PROTOTYPE_MAP[activePrototypeId]

  const getGhostTopLeftFromPointer = (pointer: { x: number; y: number }) => {
    const worldX = (pointer.x - stagePosition.x) / zoom
    const worldY = (pointer.y - stagePosition.y) / zoom
    const mouseGridX = worldX / cellSize
    const mouseGridY = worldY / cellSize

    return {
      x: Math.round(mouseGridX - activePrototype.w / 2),
      y: Math.round(mouseGridY - activePrototype.h / 2),
    }
  }

  const getGridFromPointer = (pointer: { x: number; y: number }) => {
    const worldX = (pointer.x - stagePosition.x) / zoom
    const worldY = (pointer.y - stagePosition.y) / zoom

    return {
      x: Math.floor(worldX / cellSize),
      y: Math.floor(worldY / cellSize),
    }
  }

  const clampPosition = (nextScale: number, candidate: { x: number; y: number }) => {
    const contentWidth = stageSize * nextScale
    const contentHeight = stageSize * nextScale

    const minX = Math.min(0, stageSize - contentWidth)
    const maxX = 0
    const minY = Math.min(0, stageSize - contentHeight)
    const maxY = 0

    return {
      x: Math.min(maxX, Math.max(minX, candidate.x)),
      y: Math.min(maxY, Math.max(minY, candidate.y)),
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setIsSpacePressed(true)
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setIsSpacePressed(false)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)

    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 1) {
        setIsMiddlePanning(false)
      }
    }

    window.addEventListener("mouseup", onMouseUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [])

  const { stageSize, cellSize } = useMemo(() => {
    const sidePx = 720
    return {
      stageSize: sidePx,
      cellSize: sidePx / selectedGridSize,
    }
  }, [selectedGridSize])

  const beltSegmentRenderItems = useMemo(() => {
    const segmentKey = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const a = `${from.x},${from.y}`
      const b = `${to.x},${to.y}`
      return a < b ? `${a}|${b}` : `${b}|${a}`
    }

    const baseKeys = new Set(
      beltDragBaseSegments.map((segment) => segmentKey(segment.from, segment.to)),
    )

    const portKeySet = new Set(
      machines.flatMap((machine) =>
        getMachinePorts(machine).map((port) => `${port.x},${port.y}`),
      ),
    )

    return beltSegments.map((segment, index) => {
      const key = segmentKey(segment.from, segment.to)
      const isPreview = isBeltDragging && !baseKeys.has(key)
      return {
        id: segment.id || `belt-segment-${index}`,
        isPreview,
        points: [
          segment.from.x * cellSize + cellSize / 2,
          segment.from.y * cellSize + cellSize / 2,
          segment.to.x * cellSize + cellSize / 2,
          segment.to.y * cellSize + cellSize / 2,
        ],
      }
    })
  }, [beltSegments, beltDragBaseSegments, isBeltDragging, cellSize])

  const beltDirectionTriangles = useMemo(() => {
    return beltSegmentRenderItems
      .map((segment) => {
        const [x1, y1, x2, y2] = segment.points
        const dx = x2 - x1
        const dy = y2 - y1
        const length = Math.hypot(dx, dy)
        if (length <= 0.001) {
          return null
        }

        const ux = dx / length
        const uy = dy / length
        const px = -uy
        const py = ux

        const midX = (x1 + x2) / 2
        const midY = (y1 + y2) / 2
        const halfLen = Math.max(0.9, cellSize * 0.065)
        const halfWidth = Math.max(0.6, cellSize * 0.045)

        const tipX = midX + ux * halfLen
        const tipY = midY + uy * halfLen
        const baseCenterX = midX - ux * halfLen
        const baseCenterY = midY - uy * halfLen
        const leftX = baseCenterX + px * halfWidth
        const leftY = baseCenterY + py * halfWidth
        const rightX = baseCenterX - px * halfWidth
        const rightY = baseCenterY - py * halfWidth

        return {
          id: `belt-dir-${segment.id}`,
          isPreview: segment.isPreview,
          points: [tipX, tipY, leftX, leftY, rightX, rightY],
        }
      })
      .filter((item) => item !== null)
  }, [beltSegmentRenderItems, cellSize])

  const beltNodeRenderItems = useMemo(() => {
    const keyOf = (x: number, y: number) => `${x},${y}`
    const parseKey = (key: string) => {
      const [x, y] = key.split(",").map(Number)
      return { x, y }
    }

    const segmentKey = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const a = `${from.x},${from.y}`
      const b = `${to.x},${to.y}`
      return a < b ? `${a}|${b}` : `${b}|${a}`
    }

    const baseKeys = new Set(
      beltDragBaseSegments.map((segment) => segmentKey(segment.from, segment.to)),
    )

    const degreeMap = new Map<
      string,
      {
        total: number
        previewCount: number
        inCount: number
        outCount: number
        hasHorizontal: boolean
        hasVertical: boolean
        horizontalCount: number
        verticalCount: number
      }
    >()

    beltSegments.forEach((segment) => {
      const key = segmentKey(segment.from, segment.to)
      const isPreview = isBeltDragging && !baseKeys.has(key)
      const endpointKeys = [keyOf(segment.from.x, segment.from.y), keyOf(segment.to.x, segment.to.y)]
      const isHorizontal = segment.from.y === segment.to.y
      const isVertical = segment.from.x === segment.to.x

      endpointKeys.forEach((endpointKey) => {
        const current = degreeMap.get(endpointKey) ?? {
          total: 0,
          previewCount: 0,
          inCount: 0,
          outCount: 0,
          hasHorizontal: false,
          hasVertical: false,
          horizontalCount: 0,
          verticalCount: 0,
        }
        const isFrom = endpointKey === keyOf(segment.from.x, segment.from.y)
        const isTo = endpointKey === keyOf(segment.to.x, segment.to.y)

        degreeMap.set(endpointKey, {
          total: current.total + 1,
          previewCount: current.previewCount + (isPreview ? 1 : 0),
          inCount: current.inCount + (isTo ? 1 : 0),
          outCount: current.outCount + (isFrom ? 1 : 0),
          hasHorizontal: current.hasHorizontal || isHorizontal,
          hasVertical: current.hasVertical || isVertical,
          horizontalCount: current.horizontalCount + (isHorizontal ? 1 : 0),
          verticalCount: current.verticalCount + (isVertical ? 1 : 0),
        })
      })
    })

    return Array.from(degreeMap.entries())
      .map(([key, value], index) => {
        let label = ""
        if (value.inCount === 1 && value.outCount >= 2) {
          label = "分"
        } else if (value.outCount === 1 && value.inCount >= 2) {
          label = "汇"
        } else {
          const isBridge =
            value.total === 4 &&
            value.horizontalCount === 2 &&
            value.verticalCount === 2 &&
            value.inCount === 2 &&
            value.outCount === 2
          if (!isBridge) {
            return null
          }
          label = "桥"
        }

        const point = parseKey(key)
        const isPreview = value.previewCount > 0
        return {
          id: `belt-node-${index}-${key}`,
          isPreview,
          label,
          x: point.x * cellSize + cellSize / 2,
          y: point.y * cellSize + cellSize / 2,
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
  }, [beltSegments, beltDragBaseSegments, isBeltDragging, cellSize])

  const beltMicroDotRenderItems = useMemo(() => {
    const keyOf = (x: number, y: number) => `${x},${y}`
    const parseKey = (key: string) => {
      const [x, y] = key.split(",").map(Number)
      return { x, y }
    }

    const segmentKey = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const a = `${from.x},${from.y}`
      const b = `${to.x},${to.y}`
      return a < b ? `${a}|${b}` : `${b}|${a}`
    }

    const baseKeys = new Set(
      beltDragBaseSegments.map((segment) => segmentKey(segment.from, segment.to)),
    )

    const portKeySet = new Set(
      machines.flatMap((machine) =>
        getMachinePorts(machine).map((port) => `${port.x},${port.y}`),
      ),
    )

    const degreeMap = new Map<
      string,
      {
        total: number
        previewCount: number
        inCount: number
        outCount: number
        hasHorizontal: boolean
        hasVertical: boolean
      }
    >()

    beltSegments.forEach((segment) => {
      const key = segmentKey(segment.from, segment.to)
      const isPreview = isBeltDragging && !baseKeys.has(key)
      const endpointKeys = [keyOf(segment.from.x, segment.from.y), keyOf(segment.to.x, segment.to.y)]
      const isHorizontal = segment.from.y === segment.to.y
      const isVertical = segment.from.x === segment.to.x

      endpointKeys.forEach((endpointKey) => {
        const current = degreeMap.get(endpointKey) ?? {
          total: 0,
          previewCount: 0,
          inCount: 0,
          outCount: 0,
          hasHorizontal: false,
          hasVertical: false,
        }
        const isFrom = endpointKey === keyOf(segment.from.x, segment.from.y)
        const isTo = endpointKey === keyOf(segment.to.x, segment.to.y)

        degreeMap.set(endpointKey, {
          total: current.total + 1,
          previewCount: current.previewCount + (isPreview ? 1 : 0),
          inCount: current.inCount + (isTo ? 1 : 0),
          outCount: current.outCount + (isFrom ? 1 : 0),
          hasHorizontal: current.hasHorizontal || isHorizontal,
          hasVertical: current.hasVertical || isVertical,
        })
      })
    })

    return Array.from(degreeMap.entries())
      .map(([key, value], index) => {
        const isCorner = value.total === 2 && value.hasHorizontal && value.hasVertical
        const isSplitOrMergeCross =
          value.total === 4 && value.hasHorizontal && value.hasVertical && (value.inCount === 1 || value.outCount === 1)
        const isDisconnectedEnd = value.total === 1 && !portKeySet.has(key)

        if (!isCorner && !isSplitOrMergeCross && !isDisconnectedEnd) {
          return null
        }

        const point = parseKey(key)
        return {
          id: `belt-micro-dot-${index}-${key}`,
          isPreview: value.previewCount > 0,
          x: point.x * cellSize + cellSize / 2,
          y: point.y * cellSize + cellSize / 2,
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
  }, [beltSegments, beltDragBaseSegments, machines, isBeltDragging, cellSize])

  return (
    <main className="canvas-shell">
      <div className="canvas-meta">
        <span>工业区：{selectedGridSize}x{selectedGridSize}</span>
        <span>模式：{mode === "edit" ? "编辑" : "仿真"}</span>
        <span>
          {inLogisticsMode && logisticsMode === "belt"
            ? "操作：按住左键拖拽铺设；滚轮缩放；空格+左键或中键拖拽平移"
            : inLogisticsMode && logisticsMode === "pipe"
              ? "操作：管道模式占位；滚轮缩放；空格+左键或中键拖拽平移"
              : interactionMode === "place"
              ? "操作：点击空白放置；滚轮缩放；空格+左键或中键拖拽平移"
              : interactionMode === "delete"
                ? "操作：点击建筑或传送带删除；滚轮缩放；空格+左键或中键拖拽平移"
                : "操作：选择模式（仅点选/移动）；滚轮缩放；空格+左键或中键拖拽平移"}
        </span>
      </div>
      <Stage
        width={stageSize}
        height={stageSize}
        className="stage-frame"
        draggable={isSpacePressed || isMiddlePanning}
        dragBoundFunc={(position) => clampPosition(zoom, position)}
        x={stagePosition.x}
        y={stagePosition.y}
        scaleX={zoom}
        scaleY={zoom}
        onDragEnd={(event) => {
          const stage = event.target.getStage()
          if (!stage || event.target !== stage) {
            return
          }
          setStagePosition(clampPosition(zoom, { x: event.target.x(), y: event.target.y() }))
        }}
        onWheel={(event) => {
          event.evt.preventDefault()
          const stage = event.target.getStage()
          if (!stage) {
            return
          }

          const pointer = stage.getPointerPosition()
          if (!pointer) {
            return
          }

          const oldScale = zoom
          const scaleBy = 1.08
          const direction = event.evt.deltaY > 0 ? -1 : 1
          const minScale = 1
          const maxScale = Math.max(1, selectedGridSize / 12)
          const nextScale = Math.min(
            maxScale,
            Math.max(minScale, direction > 0 ? oldScale * scaleBy : oldScale / scaleBy),
          )

          const mousePointTo = {
            x: (pointer.x - stagePosition.x) / oldScale,
            y: (pointer.y - stagePosition.y) / oldScale,
          }

          const nextPosition = clampPosition(nextScale, {
            x: pointer.x - mousePointTo.x * nextScale,
            y: pointer.y - mousePointTo.y * nextScale,
          })
          setZoom(nextScale)
          setStagePosition(nextPosition)
        }}
        onMouseDown={(event) => {
          if (event.evt.button === 1) {
            event.evt.preventDefault()
            setIsMiddlePanning(true)
            const stage = event.target.getStage()
            if (stage) {
              stage.startDrag()
            }
            return
          }

          if (mode !== "edit") {
            return
          }

          if (isSpacePressed) {
            return
          }

          if (inLogisticsMode && logisticsMode === "belt") {
            const pointer = event.target.getStage()?.getPointerPosition()
            if (!pointer) {
              return
            }

            const { x: gridX, y: gridY } = getGridFromPointer(pointer)

            if (gridX < 0 || gridY < 0 || gridX >= selectedGridSize || gridY >= selectedGridSize) {
              return
            }

            startBeltDrag(gridX, gridY)
            setIsBeltDragging(true)
            return
          }

          if (interactionMode === "delete") {
            const pointer = event.target.getStage()?.getPointerPosition()
            if (!pointer) {
              return
            }

            const grid = getGridFromPointer(pointer)
            if (
              grid.x < 0 ||
              grid.y < 0 ||
              grid.x >= selectedGridSize ||
              grid.y >= selectedGridSize
            ) {
              return
            }

            deleteBeltAt(grid.x, grid.y)
            return
          }

          if (interactionMode === "place") {
            const pointer = event.target.getStage()?.getPointerPosition()
            if (!pointer) {
              return
            }

            const { x: gridX, y: gridY } = getGhostTopLeftFromPointer(pointer)

            if (gridX < 0 || gridY < 0 || gridX >= selectedGridSize || gridY >= selectedGridSize) {
              return
            }

            setGhostGrid({ x: gridX, y: gridY })
            placeMachineAt(gridX, gridY)
            return
          }

          const clickedOnEmpty = event.target === event.target.getStage()
          if (clickedOnEmpty) {
            const pointer = event.target.getStage()?.getPointerPosition()
            if (!pointer) {
              return
            }

            const { x: gridX, y: gridY } = getGhostTopLeftFromPointer(pointer)

            if (gridX < 0 || gridY < 0 || gridX >= selectedGridSize || gridY >= selectedGridSize) {
              return
            }

            selectMachine(null)
            return
          }

          selectMachine(null)
        }}
        onMouseMove={(event) => {
          if (mode !== "edit" || isSpacePressed) {
            return
          }

          const stage = event.target.getStage()
          const pointer = stage?.getPointerPosition()
          if (!pointer) {
            return
          }

          const { x: gridX, y: gridY } = getGhostTopLeftFromPointer(pointer)

          if (inLogisticsMode && logisticsMode === "belt" && isBeltDragging) {
            const grid = getGridFromPointer(pointer)
            if (
              grid.x < 0 ||
              grid.y < 0 ||
              grid.x >= selectedGridSize ||
              grid.y >= selectedGridSize
            ) {
              return
            }
            extendBeltDrag(grid.x, grid.y)
            return
          }

          if (interactionMode !== "place") {
            return
          }

          setGhostGrid({ x: gridX, y: gridY })
        }}
        onMouseUp={(event) => {
          if (event.evt.button === 1) {
            const stage = event.target.getStage()
            stage?.stopDrag()
            setIsMiddlePanning(false)
            return
          }

          if (isBeltDragging) {
            finishBeltDrag()
            setIsBeltDragging(false)
          }
        }}
        onMouseLeave={() => {
          if (isBeltDragging) {
            finishBeltDrag()
            setIsBeltDragging(false)
          }
          setGhostGrid(null)
        }}
      >
        <Layer>
          {Array.from({ length: selectedGridSize + 1 }).map((_, index) => {
            const pos = index * cellSize
            return (
              <Group key={`grid-${index}`}>
                <Rect
                  x={0}
                  y={pos}
                  width={stageSize}
                  height={1}
                  fill="#2c3340"
                />
                <Rect
                  x={pos}
                  y={0}
                  width={1}
                  height={stageSize}
                  fill="#2c3340"
                />
              </Group>
            )
          })}
          <Rect
            x={0}
            y={0}
            width={stageSize}
            height={stageSize}
            stroke="#f28c28"
            strokeWidth={Math.max(3, cellSize * 0.28)}
            listening={false}
          />
          {beltSegmentRenderItems.map((segment) => (
            <Group key={segment.id}>
              <Line
                points={segment.points}
                stroke={segment.isPreview ? "#8b6a2a" : "#3e5a4e"}
                strokeWidth={Math.max(5, cellSize * 0.44)}
                lineCap="butt"
                lineJoin="round"
                listening={false}
              />
              <Line
                points={segment.points}
                stroke={segment.isPreview ? "#f6c66f" : "#bfe8d5"}
                strokeWidth={Math.max(3, cellSize * 0.24)}
                lineCap="butt"
                lineJoin="round"
                listening={false}
              />
            </Group>
          ))}
          {beltDirectionTriangles.map((triangle) => (
            <Line
              key={triangle.id}
              points={triangle.points}
              closed
              fill={triangle.isPreview ? "#6f541f" : "#355346"}
              stroke={triangle.isPreview ? "#6f541f" : "#355346"}
              strokeWidth={1}
              listening={false}
            />
          ))}
          {beltMicroDotRenderItems.map((dot) => (
            <Group key={dot.id}>
              <Circle
                x={dot.x}
                y={dot.y}
                radius={Math.max(2.5, cellSize * 0.22)}
                fill={dot.isPreview ? "#8b6a2a" : "#3e5a4e"}
                listening={false}
              />
              <Circle
                x={dot.x}
                y={dot.y}
                radius={Math.max(1.5, cellSize * 0.12)}
                fill={dot.isPreview ? "#f6c66f" : "#bfe8d5"}
                listening={false}
              />
            </Group>
          ))}
          {beltNodeRenderItems.map((node) => (
            <Group key={node.id}>
              <Circle
                x={node.x}
                y={node.y}
                radius={Math.max(4.5, cellSize * 0.45)}
                fillEnabled={false}
                stroke={node.isPreview ? "rgba(255,255,255,0.82)" : "rgba(255,255,255,0.82)"}
                strokeWidth={Math.max(0.7, cellSize * 0.04)}
                listening={false}
              />
              {node.label && (
                <Text
                  x={node.x - Math.max(2.4, cellSize * 0.17)}
                  y={node.y - Math.max(3.3, cellSize * 0.24)}
                  width={Math.max(4.8, cellSize * 0.34)}
                  height={Math.max(6.6, cellSize * 0.48)}
                  text={node.label}
                  fill={node.isPreview ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.75)"}
                  fontSize={Math.max(4.8, cellSize * 0.34)}
                  fontStyle="bold"
                  align="center"
                  verticalAlign="middle"
                  listening={false}
                />
              )}
            </Group>
          ))}
          {machines.map((machine) => {
            const isSelected = machine.id === selectedMachineId
            const machineX = machine.x * cellSize
            const machineY = machine.y * cellSize
            const machineW = machine.w * cellSize
            const machineH = machine.h * cellSize
            const blocked = machine.placementState !== "valid"
            const runtimeStatus = machineRuntime[machine.id]?.status
            const frameStrokeWidth = isSelected
              ? BUILDING_STROKE_WIDTH_SELECTED
              : BUILDING_STROKE_WIDTH
            const frameInset = frameStrokeWidth / 2
            const visualGap = Math.max(BUILDING_GAP_MIN, cellSize * BUILDING_GAP_RATIO)

            const ports = getMachinePorts(machine)

            return (
              <Group
                key={machine.id}
                x={machineX}
                y={machineY}
                draggable={mode === "edit" && interactionMode === "idle"}
                dragBoundFunc={(position) => {
                  const localX = (position.x - stagePosition.x) / zoom
                  const localY = (position.y - stagePosition.y) / zoom
                  const snappedLocalX = Math.round(localX / cellSize) * cellSize
                  const snappedLocalY = Math.round(localY / cellSize) * cellSize

                  return {
                    x: stagePosition.x + snappedLocalX * zoom,
                    y: stagePosition.y + snappedLocalY * zoom,
                  }
                }}
                onClick={(event) => {
                  event.cancelBubble = true
                  if (mode === "edit" && interactionMode === "delete") {
                    deleteMachineById(machine.id)
                    return
                  }
                  if (interactionMode === "logistics") {
                    return
                  }
                  if (interactionMode === "place") {
                    return
                  }
                  selectMachine(machine.id)
                }}
                onDragEnd={(event) => {
                  const absolute = event.target.absolutePosition()
                  const localX = (absolute.x - stagePosition.x) / zoom
                  const localY = (absolute.y - stagePosition.y) / zoom
                  const gridX = Math.round(localX / cellSize)
                  const gridY = Math.round(localY / cellSize)
                  moveMachine(machine.id, gridX, gridY)
                  setDraggingMachineGhost(null)
                }}
                onDragStart={() => {
                  setDraggingMachineGhost({
                    id: machine.id,
                    x: machine.x,
                    y: machine.y,
                    w: machine.w,
                    h: machine.h,
                  })
                }}
              >
                <Rect
                  x={frameInset + visualGap / 2}
                  y={frameInset + visualGap / 2}
                  width={Math.max(1, machineW - frameStrokeWidth - visualGap)}
                  height={Math.max(1, machineH - frameStrokeWidth - visualGap)}
                  fill={blocked ? "#6a1f2e" : "#2d4a78"}
                  stroke={isSelected ? "#f7d06a" : blocked ? "#ff6b6b" : "#5f7fb3"}
                  strokeWidth={frameStrokeWidth}
                  cornerRadius={Math.max(0, 4 - frameInset)}
                />
                <Text
                  text={machine.shortName || machine.name}
                  fill="#e5ebf3"
                  fontSize={8}
                  x={frameInset + visualGap / 2}
                  y={frameInset + visualGap / 2}
                  width={Math.max(1, machineW - frameStrokeWidth - visualGap)}
                  height={Math.max(1, machineH - frameStrokeWidth - visualGap)}
                  align="center"
                  verticalAlign="middle"
                />
                {blocked && (
                  <Text
                    text={machine.placementState === "overlap" ? "重叠停机" : "越界"}
                    fill="#ffb1b1"
                    fontSize={7}
                    y={frameInset + visualGap / 2 + machineH / 2 - 8}
                    width={Math.max(1, machineW - frameStrokeWidth - visualGap)}
                    align="center"
                  />
                )}

                {!blocked && runtimeStatus && runtimeStatus !== "running" && (
                  <Text
                    text={runtimeStatus}
                    fill="#ffb1b1"
                    fontSize={7}
                    y={frameInset + visualGap / 2 + machineH / 2 - 8}
                    width={Math.max(1, machineW - frameStrokeWidth - visualGap)}
                    align="center"
                  />
                )}

                {ports.map((port) => (
                  <Group key={`${machine.id}_${port.portId}`}>
                    {port.type === "out" && (() => {
                      const portLocalX = (port.x - machine.x + 0.5) * cellSize
                      const portLocalY = (port.y - machine.y + 0.5) * cellSize

                      const leftEdge = frameInset + visualGap / 2
                      const rightEdge = machineW - frameInset - visualGap / 2
                      const topEdge = frameInset + visualGap / 2
                      const bottomEdge = machineH - frameInset - visualGap / 2

                      let targetX = portLocalX
                      let targetY = portLocalY

                      if (port.direction === "-x") {
                        targetX = leftEdge
                      } else if (port.direction === "+x") {
                        targetX = rightEdge
                      } else if (port.direction === "-y") {
                        targetY = topEdge
                      } else {
                        targetY = bottomEdge
                      }

                      return (
                        <Line
                          points={[portLocalX, portLocalY, targetX, targetY]}
                          stroke="#0d1117"
                          strokeWidth={Math.max(1, cellSize * 0.09)}
                          lineCap="round"
                          listening={false}
                        />
                      )
                    })()}
                    <Circle
                      x={(port.x - machine.x + 0.5) * cellSize}
                      y={(port.y - machine.y + 0.5) * cellSize}
                      radius={Math.max(3, cellSize * 0.16)}
                      fill={
                        beltDrawStart &&
                        beltDrawStart.x === port.x &&
                        beltDrawStart.y === port.y
                          ? "#ffd166"
                          : port.type === "out"
                            ? "#69d2a3"
                            : "#f28c8c"
                      }
                      stroke="#0d1117"
                      strokeWidth={1}
                      onClick={(event) => {
                        event.cancelBubble = true
                        if (mode === "edit" && interactionMode === "delete") {
                          deleteMachineById(machine.id)
                        } else if (interactionMode === "idle") {
                          selectMachine(machine.id)
                        }
                      }}
                    />
                  </Group>
                ))}
              </Group>
            )
          })}
          {beltDrawStart && (
            <Rect
              x={beltDrawStart.x * cellSize + 1}
              y={beltDrawStart.y * cellSize + 1}
              width={Math.max(2, cellSize - 2)}
              height={Math.max(2, cellSize - 2)}
              fill="#ffd166"
              opacity={0.9}
              cornerRadius={2}
            />
          )}

          {draggingMachineGhost && (
            <Rect
              x={draggingMachineGhost.x * cellSize}
              y={draggingMachineGhost.y * cellSize}
              width={draggingMachineGhost.w * cellSize}
              height={draggingMachineGhost.h * cellSize}
              fill="#9bb7de"
              opacity={0.22}
              stroke="#dbe8ff"
              strokeWidth={1}
              dash={[4, 4]}
              listening={false}
            />
          )}

          {mode === "edit" && interactionMode === "place" && ghostGrid && (
            <Rect
              x={ghostGrid.x * cellSize}
              y={ghostGrid.y * cellSize}
              width={activePrototype.w * cellSize}
              height={activePrototype.h * cellSize}
              fill={
                ghostGrid.x >= 0 &&
                ghostGrid.y >= 0 &&
                ghostGrid.x + activePrototype.w <= selectedGridSize &&
                ghostGrid.y + activePrototype.h <= selectedGridSize
                  ? "#8db4ff"
                  : "#ff8d8d"
              }
              opacity={0.28}
              stroke="#dbe8ff"
              strokeWidth={1}
              dash={[4, 4]}
              listening={false}
            />
          )}

          <Text
            x={16}
            y={16}
            text="Industrial Planner Stage1 Phase1"
            fill="#a7b0bf"
            fontSize={13}
          />
        </Layer>
      </Stage>
    </main>
  )
}
