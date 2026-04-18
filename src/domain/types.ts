export type Rotation = 0 | 90 | 180 | 270
export type Edge = 'N' | 'S' | 'E' | 'W'
export type Direction = 'Input' | 'Output'

export type RuntimeKind = 'processor' | 'storage' | 'conveyor' | 'junction'
export type StallReason =
  | 'NONE'
  | 'LOW_POWER'
  | 'OUT_OF_POWER_RANGE'
  | 'OVERLAP'
  | 'NO_INPUT'
  | 'OUTPUT_BUFFER_FULL'
  | 'DOWNSTREAM_BLOCKED'
  | 'BUS_NOT_CONNECTED'
  | 'PICKUP_BUS_NOT_CONNECTED'
  | 'CONFIG_ERROR'

export type ItemId = string
export type DeviceTypeId =
  | 'item_port_unloader_1'
  | 'item_port_loader_1'
  | 'item_port_grinder_1'
  | 'item_port_furnance_1'
  | 'item_port_liquid_furnance_1'
  | 'item_port_cmpt_mc_1'
  | 'item_port_shaper_1'
  | 'item_port_seedcol_1'
  | 'item_port_planter_1'
  | 'item_port_hydro_planter_1'
  | 'item_port_winder_1'
  | 'item_port_filling_pd_mc_1'
  | 'item_port_liquid_filling_pd_mc_1'
  | 'item_port_tools_asm_mc_1'
  | 'item_port_thickener_1'
  | 'item_port_power_sta_1'
  | 'item_port_mix_pool_1'
  | 'item_port_mix_pool_large_1'
  | 'item_port_xiranite_oven_1'
  | 'item_port_dismantler_1'
  | 'item_port_log_hongs_bus_source'
  | 'item_port_log_hongs_bus'
  | 'item_port_sp_hub_1'
  | 'item_port_water_pump_1'
  | 'item_port_udpipe_loader_1'
  | 'item_port_udpipe_unloader_1'
  | 'item_port_udpipe_loader_large_1'
  | 'item_port_udpipe_unloader_large_1'
  | 'item_liquid_cleaner_1'
  | 'item_port_liquid_purifier_1'
  | 'item_port_liquid_storager_1'
  | 'item_port_power_diffuser_1'
  | 'item_port_storager_1'
  | 'belt_straight_1x1'
  | 'belt_turn_cw_1x1'
  | 'belt_turn_ccw_1x1'
  | 'pipe_straight_1x1'
  | 'pipe_turn_cw_1x1'
  | 'pipe_turn_ccw_1x1'
  | 'item_log_splitter'
  | 'item_log_converger'
  | 'item_log_connector'
  | 'item_log_admission'
  | 'item_pipe_splitter'
  | 'item_pipe_converger'
  | 'item_pipe_admission'
  | 'item_pipe_connector'

export type BaseId =
  | 'valley4_protocol_core'
  | 'wuling_protocol_core'
  | 'wuling_tianwangping_aid'
  | 'valley4_rebuilt_command'
  | 'valley4_infra_outpost'
  | 'valley4_refugee_shelter'

export interface ItemDef {
  id: ItemId
  displayName: string
  type: 'solid' | 'liquid'
  tags?: string[]
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
  powerDemand: number
  size: { width: number; height: number }
  shortName: string
  tags?: string[]
  maxPlacementCount?: number
  placementLimitToastKey?: string
  inputBufferCapacity?: number
  outputBufferCapacity?: number
  inputBufferSlots?: number
  outputBufferSlots?: number
  inputBufferSlotCapacities?: number[]
  inputBufferAllowedTypesBySlot?: Array<Array<'solid' | 'liquid'>>
  outputBufferSlotCapacities?: number[]
  placementConstraints?: PlacementConstraint[]
  ports0: PortDef[]
}

export interface RecipeDef {
  id: string
  machineType: DeviceTypeId
  cycleSeconds: number
  inputs: Array<{ itemId: ItemId; amount: number }>
  outputs: Array<{ itemId: ItemId; amount: number }>
  tags?: string[]
}

export interface PreloadInputConfigEntry {
  slotIndex: number
  itemId: ItemId
  amount: number
}

export type BufferSlotMode = 'free' | 'pinned'

export interface BufferSlotRuntime {
  slotIndex: number
  mode: BufferSlotMode
  pinnedItemId?: ItemId
  currentItemId: ItemId | null
  amount: number
  capacity: number
}

export interface BufferGroupRuntime {
  id: string
  inPortIds: string[]
  outPortIds: string[]
  slots: BufferSlotRuntime[]
}

export interface ProtocolHubOutputConfigEntry {
  portId: string
  itemId?: ItemId
  ignoreInventory?: boolean
}

export interface StorageSlotConfigEntry {
  slotIndex: number
  mode: BufferSlotMode
  pinnedItemId?: ItemId
  preloadItemId?: ItemId
  preloadAmount?: number
}

export type DarkPipeInletMode = 'destroy' | 'link'
export type DarkPipeOutletMode = 'generate' | 'link'

export interface DeviceLink {
  linkId: string
  kind: 'dark_pipe'
  sourceInstanceId: string
  targetInstanceId: string
}

export interface BlueprintDeviceLink {
  kind: 'dark_pipe'
  sourceBlueprintInstanceId: string
  targetBlueprintInstanceId: string
}

export interface DeviceConfig {
  pickupItemId?: ItemId
  pickupIgnoreInventory?: boolean
  admissionItemId?: ItemId
  admissionAmount?: number
  protocolHubOutputs?: ProtocolHubOutputConfigEntry[]
  portPriorityGroups?: Partial<Record<string, number>>
  pumpOutputItemId?: ItemId
  submitToWarehouse?: boolean
  preloadInputs?: PreloadInputConfigEntry[]
  storagePreloadInputs?: PreloadInputConfigEntry[]
  storageSlots?: StorageSlotConfigEntry[]
  preloadInputItemId?: ItemId
  preloadInputAmount?: number
  darkPipeInletMode?: DarkPipeInletMode
  darkPipeOutletMode?: DarkPipeOutletMode
  reactorPool?: {
    selectedRecipeIds?: string[]
    solidOutputItemId?: ItemId
    liquidOutputItemId?: ItemId
    liquidOutputItemIdA?: ItemId
    liquidOutputItemIdB?: ItemId
  }
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
  movable: boolean
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

export type EditMode = 'place' | 'delete' | 'blueprint'

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
  everProduced: Record<ItemId, number>
  everConsumed: Record<ItemId, number>
  everStockPositive: Record<ItemId, number>
}

export interface MinuteWindowDelta {
  produced: Partial<Record<ItemId, number>>
  consumed: Partial<Record<ItemId, number>>
}

export interface BaseRuntime {
  progress01: number
  stallReason: StallReason
  isStalled: boolean
  inputPriorityGroupCursorByLane?: Partial<Record<string, number[]>>
  outputPriorityGroupCursorByGroup?: Partial<Record<string, number[]>>
}

export interface ProcessorRuntime extends BaseRuntime {
  inputBuffer: Partial<Record<ItemId, number>>
  outputBuffer: Partial<Record<ItemId, number>>
  inputSlotItems: Array<ItemId | null>
  outputSlotItems: Array<ItemId | null>
  cycleProgressTicks: number
  reactorCycleProgressTicks?: number[]
  producedItemsTotal: number
  lastCompletedCycleTicks: number
  lastCompletionTick: number | null
  lastCompletionIntervalTicks: number
  activeRecipeId?: string
  reactorActiveRecipeIds?: Array<string | undefined>
  thermalPowerTicksRemaining?: number
  thermalPowerKw?: number
  bufferGroups?: BufferGroupRuntime[]
}

export interface StorageRuntime extends BaseRuntime {
  inventory: Partial<Record<ItemId, number>>
  submitAccumulatorTicks: number
  bufferGroups?: BufferGroupRuntime[]
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
  producedItemsTotal: number
  lastSplitterOutputPortId?: string
}

export type DeviceRuntime = ProcessorRuntime | StorageRuntime | ConveyorRuntime | JunctionRuntime

export type PowerMode = 'real' | 'infinite'

export interface SimState {
  isRunning: boolean
  powerMode: PowerMode
  powerDemandOverrideKw: number | null
  speed: 0 | 0.25 | 1 | 2 | 4 | 16
  tick: number
  tickRateHz: number
  runtimeById: Record<string, DeviceRuntime>
  warehouse: WarehouseState
  stats: WarehouseStats
  minuteWindowDeltas: MinuteWindowDelta[]
  minuteWindowCursor: number
  minuteWindowCount: number
  minuteWindowCapacity: number
  powerStats: {
    totalSupplyKw: number
    totalDemandKw: number
    batteryPercent: number
    batteryStoredJ: number
  }
}

export interface LayoutState {
  baseId: BaseId
  lotSize: number
  devices: DeviceInstance[]
  links: DeviceLink[]
}

export interface SelectionState {
  selectedIds: string[]
  selectedBeltCell: { x: number; y: number } | null
}

export interface LogisticsDraft {
  start: { x: number; y: number } | null
  current: { x: number; y: number } | null
}
