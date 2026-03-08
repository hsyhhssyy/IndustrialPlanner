import type { DeviceInstance, DeviceRuntime, ItemId } from '../../domain/types'

export type SendLane = 'slot' | 'ns' | 'we' | 'output'
export type ReceiveLane = 'slot' | 'ns' | 'we' | 'output'

export type TransferMatch = {
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
  senderPriorityGroupKey: string | null
  senderPriorityGroup: number
  senderPriorityPortIndex: number
  senderPriorityPortCount: number
  receiverPriorityGroup: number
  receiverPriorityPortIndex: number
  receiverPriorityPortCount: number
}

export type PullIntent = {
  receiverId: string
  receiverPortId: string
  receiverLane: ReceiveLane
  receiverCandidateRank: number
  fromId: string
  fromPortId: string
  fromLane: SendLane
  fromOutputSlotIndex?: number
  itemId: ItemId
  senderOutLinkCount: number
  senderPickedOutLinkIndex: number
  senderPriorityGroupKey: string | null
  senderPriorityGroup: number
  senderPriorityPortIndex: number
  senderPriorityPortCount: number
  receiverPriorityGroup: number
  receiverPriorityPortIndex: number
  receiverPriorityPortCount: number
}

export type PortLink = {
  from: { instanceId: string; portId: string }
  to: { instanceId: string; portId: string }
}

export type PlanHelpers = {
  isHardBlockedStall: (stallReason: DeviceRuntime['stallReason']) => boolean
  orderedOutLinks: (device: DeviceInstance, runtime: DeviceRuntime, outLinks: PortLink[]) => PortLink[]
  buildDevicePullInputPortOrderMap: () => Map<string, string[]>
  isSplitterType: (typeId: DeviceInstance['typeId']) => boolean
  receiveLaneForPort: (device: DeviceInstance, runtime: DeviceRuntime, toPortId: string) => ReceiveLane | null
  sourceSlotLane: (device: DeviceInstance, runtime: DeviceRuntime, fromPortId: string) => SendLane
  prepareSourceLaneItem: (
    device: DeviceInstance,
    runtime: DeviceRuntime,
    fromLane: SendLane,
    fromPortId: string,
    lanesReachedHalfThisTick: ReadonlySet<string>,
    lanesAdvancedThisTick: Set<string>,
  ) => { itemId: ItemId | null; laneProgressAdvanced: boolean }
  canReceiveLaneForItem: (
    device: DeviceInstance,
    runtime: DeviceRuntime,
    toPortId: string,
    lanesClearingThisTick: Set<string>,
    itemId: ItemId,
  ) => ReceiveLane | null
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
  inMap: Map<string, PortLink[]>
  outMap: Map<string, PortLink[]>
  helpers: PlanHelpers
  lanesReachedHalfThisTick: ReadonlySet<string>
}

export type PlanResult = {
  transferMatches: TransferMatch[]
  plannedSenders: Set<string>
  lanesAdvancedThisTick: Set<string>
}
