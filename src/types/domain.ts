export type GridSize = 60 | 80 | 100

export type SimulationSpeed = 1 | 2 | 4

export type AppMode = "edit" | "simulate"

export type ItemId = "originium_ore" | "originium_powder"
export type LogisticsMode = "none" | "belt" | "pipe"

export type GridPoint = {
  x: number
  y: number
}

export type PortType = "in" | "out"

export type PortDirection = "+x" | "+y" | "-x" | "-y"

export type PortDef = {
  id: string
  type: PortType
  direction: PortDirection
  offsetX: number
  offsetY: number
}

export type MachinePort = {
  machineId: string
  machineName: string
  portId: string
  type: PortType
  direction: PortDirection
  x: number
  y: number
}

export type BeltCell = {
  id: string
  x: number
  y: number
}

export type BeltEdge = {
  id: string
  from: { machineId: string; portId: string }
  to: { machineId: string; portId: string }
  path: GridPoint[]
}

export type BeltSegment = {
  id: string
  from: GridPoint
  to: GridPoint
}

export type BeltTransitItem = {
  id: string
  itemId: ItemId
  path: GridPoint[]
  stepIndex: number
  stepTick: number
}

export type PickupPortConfig = {
  machineId: string
  selectedItemId: ItemId | null
}

export type PlotSnapshot = {
  machines: MachineInstance[]
  beltCells: BeltCell[]
  beltEdges: BeltEdge[]
  beltSegments: BeltSegment[]
  pickupPortConfigs: Record<string, PickupPortConfig>
}

export type MachinePlacementState = "valid" | "overlap" | "invalid_boundary"

export type MachineRuntimeStatus =
  | "running"
  | "starved"
  | "blocked_overlap"
  | "blocked_boundary"
  | "unpowered"

export type BuildingPrototypeId =
  | "pickup_port_3x1"
  | "crusher_3x3"
  | "power_pole_2x2"
  | "storage_box_3x3"
  | "filler_6x4"

export type MachineInstance = {
  id: string
  prototypeId: BuildingPrototypeId
  name: string
  shortName: string
  x: number
  y: number
  w: number
  h: number
  rotation: 0 | 90 | 180 | 270
  placementState: MachinePlacementState
  progressTick: number
}

export type MachineRuntimeState = {
  machineId: string
  status: MachineRuntimeStatus
  missingInputs?: string[]
}

export type BuildingPrototype = {
  id: BuildingPrototypeId
  name: string
  shortName: string
  w: number
  h: number
  ports: PortDef[]
  storageCapacity?: number
  inputStorageCapacity?: number
  outputStorageCapacity?: number
}

export type RuntimeStock = {
  machineInternal: Record<string, number>
  beltInTransit: Record<string, number>
}

export type StoreSnapshot = {
  externalInventory: Record<ItemId, number>
  runtimeStock: RuntimeStock
  machineProgress: Record<string, number>
}

export const DEFAULT_GRID_SIZE: GridSize = 60

export const GRID_SIZE_OPTIONS: GridSize[] = [60, 80, 100]

export const DEFAULT_EXTERNAL_INVENTORY: Record<ItemId, number> = {
  originium_ore: 0,
  originium_powder: 0,
}

export const EMPTY_RUNTIME_STOCK: RuntimeStock = {
  machineInternal: {},
  beltInTransit: {},
}

export const BUILDING_PROTOTYPES: BuildingPrototype[] = [
  {
    id: "pickup_port_3x1",
    name: "物品取货口",
    shortName: "取货口",
    w: 3,
    h: 1,
    ports: [{ id: "out_mid", type: "out", direction: "+y", offsetX: 1, offsetY: 0 }],
  },
  {
    id: "crusher_3x3",
    name: "粉碎机",
    shortName: "粉碎机",
    w: 3,
    h: 3,
    storageCapacity: 50,
    inputStorageCapacity: 50,
    outputStorageCapacity: 50,
    ports: [
      { id: "in_0", type: "in", direction: "+y", offsetX: 0, offsetY: 0 },
      { id: "in_1", type: "in", direction: "+y", offsetX: 1, offsetY: 0 },
      { id: "in_2", type: "in", direction: "+y", offsetX: 2, offsetY: 0 },
      { id: "out_0", type: "out", direction: "+y", offsetX: 0, offsetY: 2 },
      { id: "out_1", type: "out", direction: "+y", offsetX: 1, offsetY: 2 },
      { id: "out_2", type: "out", direction: "+y", offsetX: 2, offsetY: 2 },
    ],
  },
  { id: "power_pole_2x2", name: "供电桩", shortName: "供电桩", w: 2, h: 2, ports: [] },
  {
    id: "storage_box_3x3",
    name: "物流存储箱",
    shortName: "存储箱",
    w: 3,
    h: 3,
    ports: [
      { id: "in_0", type: "in", direction: "+y", offsetX: 0, offsetY: 0 },
      { id: "in_1", type: "in", direction: "+y", offsetX: 1, offsetY: 0 },
      { id: "in_2", type: "in", direction: "+y", offsetX: 2, offsetY: 0 },
      { id: "out_0", type: "out", direction: "+y", offsetX: 0, offsetY: 2 },
      { id: "out_1", type: "out", direction: "+y", offsetX: 1, offsetY: 2 },
      { id: "out_2", type: "out", direction: "+y", offsetX: 2, offsetY: 2 },
    ],
  },
  {
    id: "filler_6x4",
    name: "灌装机",
    shortName: "灌装机",
    w: 6,
    h: 4,
    ports: [
      { id: "in_0", type: "in", direction: "+y", offsetX: 0, offsetY: 0 },
      { id: "in_1", type: "in", direction: "+y", offsetX: 1, offsetY: 0 },
      { id: "in_2", type: "in", direction: "+y", offsetX: 2, offsetY: 0 },
      { id: "in_3", type: "in", direction: "+y", offsetX: 3, offsetY: 0 },
      { id: "in_4", type: "in", direction: "+y", offsetX: 4, offsetY: 0 },
      { id: "in_5", type: "in", direction: "+y", offsetX: 5, offsetY: 0 },
      { id: "out_0", type: "out", direction: "+y", offsetX: 0, offsetY: 3 },
      { id: "out_1", type: "out", direction: "+y", offsetX: 1, offsetY: 3 },
      { id: "out_2", type: "out", direction: "+y", offsetX: 2, offsetY: 3 },
      { id: "out_3", type: "out", direction: "+y", offsetX: 3, offsetY: 3 },
      { id: "out_4", type: "out", direction: "+y", offsetX: 4, offsetY: 3 },
      { id: "out_5", type: "out", direction: "+y", offsetX: 5, offsetY: 3 },
    ],
  },
]

export const BUILDING_PROTOTYPE_MAP: Record<BuildingPrototypeId, BuildingPrototype> =
  Object.fromEntries(BUILDING_PROTOTYPES.map((prototype) => [prototype.id, prototype])) as Record<
    BuildingPrototypeId,
    BuildingPrototype
  >
