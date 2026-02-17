import {
  BUILDING_PROTOTYPE_MAP,
  type BuildingPrototypeId,
  type MachinePort,
  type MachineInstance,
  type MachinePlacementState,
  type PortDirection,
  type PortDef,
} from "../types/domain"

function overlapRect(a: MachineInstance, b: MachineInstance): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function boundaryState(machine: MachineInstance, gridSize: number): MachinePlacementState {
  const inside =
    machine.x >= 0 &&
    machine.y >= 0 &&
    machine.x + machine.w <= gridSize &&
    machine.y + machine.h <= gridSize
  return inside ? "valid" : "invalid_boundary"
}

export function createMachine(prototypeId: BuildingPrototypeId, x: number, y: number): MachineInstance {
  const prototype = BUILDING_PROTOTYPE_MAP[prototypeId]
  return {
    id: `m_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    prototypeId,
    name: prototype.name,
    shortName: prototype.shortName,
    x,
    y,
    w: prototype.w,
    h: prototype.h,
    rotation: 0,
    placementState: "valid",
    progressTick: 0,
  }
}

export function rotateMachine(machine: MachineInstance): MachineInstance {
  const prototype = BUILDING_PROTOTYPE_MAP[machine.prototypeId]
  const nextRotation = (((machine.rotation + 90) % 360) as 0 | 90 | 180 | 270)
  const nextW = nextRotation === 90 || nextRotation === 270 ? prototype.h : prototype.w
  const nextH = nextRotation === 90 || nextRotation === 270 ? prototype.w : prototype.h

  const centerX = machine.x + machine.w / 2
  const centerY = machine.y + machine.h / 2

  const nextX = Math.round(centerX - nextW / 2)
  const nextY = Math.round(centerY - nextH / 2)

  return {
    ...machine,
    rotation: nextRotation,
    x: nextX,
    y: nextY,
    w: nextW,
    h: nextH,
  }
}

export function expandMachineCells(machine: MachineInstance): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = []
  for (let dx = 0; dx < machine.w; dx += 1) {
    for (let dy = 0; dy < machine.h; dy += 1) {
      cells.push({ x: machine.x + dx, y: machine.y + dy })
    }
  }
  return cells
}

export function isMachinePowered(machine: MachineInstance, machines: MachineInstance[], gridSize: number): boolean {
  const poles = machines.filter((other) => other.prototypeId === "power_pole_2x2")
  if (poles.length === 0) {
    return false
  }

  const cells = expandMachineCells(machine)
  return poles.some((pole) => {
    const coverLeft = Math.max(0, pole.x - 5)
    const coverTop = Math.max(0, pole.y - 5)
    const coverRight = Math.min(gridSize - 1, coverLeft + 11)
    const coverBottom = Math.min(gridSize - 1, coverTop + 11)

    return cells.some(
      (cell) =>
        cell.x >= coverLeft &&
        cell.x <= coverRight &&
        cell.y >= coverTop &&
        cell.y <= coverBottom,
    )
  })
}

export function recalculatePlacementStates(machines: MachineInstance[], gridSize: number): MachineInstance[] {
  return machines.map((machine, index) => {
    const base = boundaryState(machine, gridSize)
    if (base === "invalid_boundary") {
      return {
        ...machine,
        placementState: "invalid_boundary",
      }
    }

    const overlap = machines.some((other, otherIndex) => {
      if (index === otherIndex) {
        return false
      }
      return overlapRect(machine, other)
    })

    return {
      ...machine,
      placementState: overlap ? "overlap" : "valid",
    }
  })
}

function rotateOffset(
  offset: Pick<PortDef, "offsetX" | "offsetY">,
  baseW: number,
  baseH: number,
  rotation: 0 | 90 | 180 | 270,
): { x: number; y: number } {
  const { offsetX, offsetY } = offset
  if (rotation === 0) {
    return { x: offsetX, y: offsetY }
  }
  if (rotation === 90) {
    return { x: baseH - 1 - offsetY, y: offsetX }
  }
  if (rotation === 180) {
    return { x: baseW - 1 - offsetX, y: baseH - 1 - offsetY }
  }
  return { x: offsetY, y: baseW - 1 - offsetX }
}

function rotateDirection(direction: PortDirection, rotation: 0 | 90 | 180 | 270): PortDirection {
  if (rotation === 0) {
    return direction
  }

  const rotate90 = (value: PortDirection): PortDirection => {
    if (value === "+x") return "+y"
    if (value === "+y") return "-x"
    if (value === "-x") return "-y"
    return "+x"
  }

  if (rotation === 90) {
    return rotate90(direction)
  }
  if (rotation === 180) {
    return rotate90(rotate90(direction))
  }
  return rotate90(rotate90(rotate90(direction)))
}

export function getMachinePorts(machine: MachineInstance): MachinePort[] {
  const prototype = BUILDING_PROTOTYPE_MAP[machine.prototypeId]
  return prototype.ports.map((port) => {
    const rotated = rotateOffset(port, prototype.w, prototype.h, machine.rotation)
    const direction = rotateDirection(port.direction, machine.rotation)
    return {
      machineId: machine.id,
      machineName: machine.name,
      portId: port.id,
      type: port.type,
      direction,
      x: machine.x + rotated.x,
      y: machine.y + rotated.y,
    }
  })
}
