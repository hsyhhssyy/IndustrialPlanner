export type Rotation = 0 | 90 | 180 | 270
export type Edge = 'N' | 'S' | 'E' | 'W'
export type Direction = 'Input' | 'Output'

export type RuntimeKind = 'processor' | 'storage' | 'conveyor' | 'junction'
export type StallReason =
  | 'NONE'
  | 'NO_POWER'
  | 'OVERLAP'
  | 'NO_INPUT'
  | 'OUTPUT_BLOCKED'
  | 'CONFIG_ERROR'

export type ItemId = 'originium_ore' | 'originium_powder'
export type DeviceTypeId =
  | 'pickup_port_3x1'
  | 'crusher_3x3'
  | 'power_pole_2x2'
  | 'storage_box_3x3'
  | 'belt_straight_1x1'
  | 'belt_turn_cw_1x1'
  | 'belt_turn_ccw_1x1'
  | 'splitter_1x1'
  | 'merger_1x1'
  | 'bridge_1x1'

export interface ItemDef {
  id: ItemId
  displayName: string
  type: 'solid'
}

export interface PortAllowance {
  mode: 'recipe_items' | 'recipe_inputs' | 'recipe_outputs' | 'whitelist' | 'any'
  whitelist: ItemId[]
}

export interface TypeAllowance {
  mode: 'solid' | 'liquid' | 'whitelist'
  whitelist: Array<'solid' | 'liquid'>
}

export interface PortDef {
  id: string
  localCellX: number
  localCellY: number
  edge: Edge
  direction: Direction
  allowedItems: PortAllowance
  allowedTypes: TypeAllowance
}

export interface DeviceTypeDef {
  id: DeviceTypeId
  runtimeKind: RuntimeKind
  requiresPower: boolean
  size: { width: number; height: number }
  shortName: string
  ports0: PortDef[]
}

export interface RecipeDef {
  id: 'r_crusher_originium_powder_basic'
  machineType: 'crusher_3x3'
  cycleSeconds: number
  inputs: Array<{ itemId: ItemId; amount: number }>
  outputs: Array<{ itemId: ItemId; amount: number }>
}

export interface DeviceConfig {
  pickupItemId?: ItemId
  submitToWarehouse?: boolean
}

export interface DeviceInstance {
  instanceId: string
  typeId: DeviceTypeId
  origin: { x: number; y: number }
  rotation: Rotation
  config: DeviceConfig
}

export type EditMode = 'select' | 'place' | 'logistics' | 'delete'

export interface OccupancyEntry {
  x: number
  y: number
  instanceId: string
}

export interface RotatedPort {
  instanceId: string
  typeId: DeviceTypeId
  portId: string
  direction: Direction
  edge: Edge
  x: number
  y: number
  allowedItems: PortAllowance
  allowedTypes: TypeAllowance
}

export interface PortLink {
  from: RotatedPort
  to: RotatedPort
}

export interface WarehouseState {
  originium_ore: number
  originium_powder: number
}

export interface WarehouseStats {
  simSeconds: number
  producedPerMinute: Record<ItemId, number>
  consumedPerMinute: Record<ItemId, number>
}

export interface BaseRuntime {
  progress01: number
  stallReason: StallReason
  isStalled: boolean
}

export interface ProcessorRuntime extends BaseRuntime {
  inputBuffer: Partial<Record<ItemId, number>>
  outputBuffer: Partial<Record<ItemId, number>>
  cycleProgressTicks: number
  producedItemsTotal: number
}

export interface StorageRuntime extends BaseRuntime {
  inventory: Partial<Record<ItemId, number>>
  submitAccumulatorTicks: number
}

export interface SlotData {
  itemId: ItemId
  progress01: number
  enteredFrom: Edge
  enteredTick: number
}

export interface ConveyorRuntime extends BaseRuntime {
  slot: SlotData | null
  transportTotalTicks: number
  transportSamples: number
}

export interface JunctionRuntime extends BaseRuntime {
  slot: SlotData | null
  nsSlot: SlotData | null
  weSlot: SlotData | null
  rrIndex: number
}

export type DeviceRuntime = ProcessorRuntime | StorageRuntime | ConveyorRuntime | JunctionRuntime

export interface SimState {
  isRunning: boolean
  speed: 0.25 | 1 | 2 | 4 | 16
  tick: number
  tickRateHz: number
  runtimeById: Record<string, DeviceRuntime>
  warehouse: WarehouseState
  stats: WarehouseStats
  minuteWindowDeltas: Array<Partial<Record<ItemId, number>>>
}

export interface LayoutState {
  lotSize: 40 | 60
  devices: DeviceInstance[]
}

export interface SelectionState {
  selectedIds: string[]
  selectedBeltCell: { x: number; y: number } | null
}

export interface LogisticsDraft {
  start: { x: number; y: number } | null
  current: { x: number; y: number } | null
}
