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

export type ItemId =
  | 'item_originium_ore'
  | 'item_originium_powder'
  | 'item_iron_ore'
  | 'item_iron_nugget'
  | 'item_iron_powder'
  | 'item_plant_moss_3'
  | 'item_plant_moss_seed_3'
  | 'item_plant_moss_powder_3'
  | 'item_iron_enr_powder'
export type DeviceTypeId =
  | 'item_port_unloader_1'
  | 'item_port_grinder_1'
  | 'item_port_furnance_1'
  | 'item_port_cmpt_mc_1'
  | 'item_port_shaper_1'
  | 'item_port_seedcol_1'
  | 'item_port_planter_1'
  | 'item_port_winder_1'
  | 'item_port_filling_pd_mc_1'
  | 'item_port_tools_asm_mc_1'
  | 'item_port_thickener_1'
  | 'item_port_power_sta_1'
  | 'item_port_mix_pool_1'
  | 'item_port_xiranite_oven_1'
  | 'item_port_dismantler_1'
  | 'item_port_log_hongs_bus_source'
  | 'item_port_log_hongs_bus'
  | 'item_port_liquid_storager_1'
  | 'item_port_power_diffuser_1'
  | 'item_port_storager_1'
  | 'belt_straight_1x1'
  | 'belt_turn_cw_1x1'
  | 'belt_turn_ccw_1x1'
  | 'item_log_splitter'
  | 'item_log_converger'
  | 'item_log_connector'

export type BaseId =
  | 'valley4_protocol_core'
  | 'valley4_rebuilt_command'
  | 'valley4_infra_outpost'
  | 'valley4_refugee_shelter'

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

export interface EdgeContactPlacementConstraint {
  kind: 'edge_contact'
  edgeMode: 'explicit' | 'opposite_of_port'
  edge?: Edge
  portId?: string
  minAdjacentCells: number
  targetTypeIds?: DeviceTypeId[]
  targetTagsAny?: string[]
  violationMessageKey?: string
}

export type PlacementConstraint = EdgeContactPlacementConstraint

export interface DeviceTypeDef {
  id: DeviceTypeId
  runtimeKind: RuntimeKind
  requiresPower: boolean
  size: { width: number; height: number }
  shortName: string
  tags?: string[]
  inputBufferCapacity?: number
  outputBufferCapacity?: number
  inputBufferSlots?: number
  outputBufferSlots?: number
  placementConstraints?: PlacementConstraint[]
  ports0: PortDef[]
}

export interface RecipeDef {
  id: string
  machineType: DeviceTypeId
  cycleSeconds: number
  inputs: Array<{ itemId: ItemId; amount: number }>
  outputs: Array<{ itemId: ItemId; amount: number }>
}

export interface PreloadInputConfigEntry {
  slotIndex: number
  itemId: ItemId
  amount: number
}

export interface DeviceConfig {
  pickupItemId?: ItemId
  submitToWarehouse?: boolean
  preloadInputs?: PreloadInputConfigEntry[]
  preloadInputItemId?: ItemId
  preloadInputAmount?: number
}

export interface DeviceInstance {
  instanceId: string
  typeId: DeviceTypeId
  origin: { x: number; y: number }
  rotation: Rotation
  config: DeviceConfig
}

export interface BaseFoundationDef {
  instanceId: string
  typeId: DeviceTypeId
  origin: { x: number; y: number }
  rotation: Rotation
  config?: DeviceConfig
}

export interface BaseDef {
  id: BaseId
  name: string
  placeableSize: number
  outerRing: {
    top: number
    right: number
    bottom: number
    left: number
  }
  tags: string[]
  foundationBuildings: BaseFoundationDef[]
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

export type WarehouseState = Record<ItemId, number>

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
  activeRecipeId?: string
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
  minuteWindowCursor: number
  minuteWindowCount: number
  minuteWindowCapacity: number
}

export interface LayoutState {
  baseId: BaseId
  lotSize: number
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
