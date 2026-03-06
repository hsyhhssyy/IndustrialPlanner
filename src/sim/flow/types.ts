import type { DeviceInstance, DeviceRuntime, ItemId } from '../../domain/types'

export type SendLane = 'slot' | 'ns' | 'we' | 'output'
export type ReceiveLane = 'slot' | 'ns' | 'we' | 'output'

export type TransferPlan = {
  transferId: string
  fromId: string
  fromPortId: string
  fromLane: SendLane
  fromOutputSlotIndex?: number
  toId: string
  toPortId: string
  toLane: ReceiveLane
  itemId: ItemId
  senderOutLinkCount: number
  senderPickedOutLinkIndex: number
}

export type PortLink = {
  from: { instanceId: string; portId: string }
  to: { instanceId: string; portId: string }
}

export type ReceiveState = { lane: ReceiveLane | null; canTry: boolean; canAccept: boolean }

export type PlanHelpers = {
  isHardBlockedStall: (stallReason: DeviceRuntime['stallReason']) => boolean
  orderedOutLinks: (device: DeviceInstance, runtime: DeviceRuntime, outLinks: PortLink[]) => PortLink[]
  buildConvergerPreferredInputPortMap: () => Map<string, string>
  buildDevicePreferredSolidInputPortMap: () => Map<string, Set<string>>
  isConvergerType: (typeId: DeviceInstance['typeId']) => boolean
  sourceSlotLane: (device: DeviceInstance, runtime: DeviceRuntime, fromPortId: string) => SendLane
  prepareSourceLaneItem: (
    device: DeviceInstance,
    runtime: DeviceRuntime,
    fromLane: SendLane,
    fromPortId: string,
    lanesReachedHalfThisTick: ReadonlySet<string>,
    lanesAdvancedThisTick: Set<string>,
  ) => { itemId: ItemId | null; laneProgressAdvanced: boolean }
  canReceiveOnPortWithPlan: (
    device: DeviceInstance,
    runtime: DeviceRuntime,
    toPortId: string,
    reservedReceivers: Set<string>,
    lanesClearingThisTick: Set<string>,
    itemId: ItemId,
  ) => ReceiveState
  isStorageWithBufferGroups: (runtime: DeviceRuntime) => boolean
  orderedStorageSlotIndicesForOutput: (runtime: DeviceRuntime, outPortId?: string) => number[]
  getStorageSlotItemId: (runtime: DeviceRuntime, slotIndex: number, outPortId?: string) => ItemId | null
  canStorageSlotOutputToPort: (device: DeviceInstance, runtime: DeviceRuntime, slotIndex: number, portId: string, itemId: ItemId) => boolean
}

export type PlanContext = {
  tick: number
  layoutDevices: DeviceInstance[]
  runtimeById: Record<string, DeviceRuntime>
  deviceById: Map<string, DeviceInstance>
  outMap: Map<string, PortLink[]>
  helpers: PlanHelpers
  lanesReachedHalfThisTick: ReadonlySet<string>
}

export type PlanResult = {
  transferPlans: TransferPlan[]
  plannedSenders: Set<string>
  reservedReceivers: Set<string>
  lanesClearingThisTick: Set<string>
  lanesAdvancedThisTick: Set<string>
}
