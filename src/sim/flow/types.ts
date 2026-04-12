import type { DeviceInstance, DeviceRuntime, ItemId } from '../../domain/types'

export type SendLane = 'slot' | 'ns' | 'we' | 'output'
export type ReceiveLane = 'slot' | 'ns' | 'we' | 'output'

export type FlowNodeBaseState = 'shadow-pending' | 'free' | 'provider'
export type FlowNodeResult = 'uncertain' | 'solved-run' | 'solved-block'
export type FlowEdgeState = 'uncertain' | 'accept'
export type FlowNodeKind = 'transport' | 'bridge' | 'processor-input' | 'processor-output' | 'storage'

export type FlowNodeSnapshot = {
  nodeId: string
  deviceId: string
  kind: FlowNodeKind
  baseState: FlowNodeBaseState
  result: FlowNodeResult
  deleted: boolean
  lane?: SendLane | ReceiveLane
  slotIndex?: number
  maxInteractItems: number | null
  itemId: ItemId | null
  amount: number
  capacity: number | null
}

export type FlowEdgeSnapshot = {
  edgeId: string
  portLinkKey: string
  fromNodeId: string
  toNodeId: string
  fromId: string
  fromPortId: string
  fromLane: SendLane
  toId: string
  toPortId: string
  toLane: ReceiveLane
  shadowPull: FlowEdgeState
  shadowPush: FlowEdgeState
  deleted: boolean
  plannedItemId: ItemId | null
  fromOutputSlotIndex?: number
  fromStorageSlotIndex?: number
  toInputSlotIndex?: number
  toStorageSlotIndex?: number
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

export type TransferMatch = {
  transferId: string
  edgeId: string
  portLinkKey: string
  fromNodeId: string
  fromNodeKind: FlowNodeKind
  fromId: string
  fromPortId: string
  fromLane: SendLane
  fromOutputSlotIndex?: number
  fromStorageSlotIndex?: number
  toNodeId: string
  toNodeKind: FlowNodeKind
  toId: string
  toPortId: string
  toLane: ReceiveLane
  toInputSlotIndex?: number
  toStorageSlotIndex?: number
  receiverCursorKey: string
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
  isBridgeType: (typeId: DeviceInstance['typeId']) => boolean
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
  getProcessorInputSlotCapacity: (device: DeviceInstance, runtime: DeviceRuntime, slotIndex: number) => number
  canAcceptProcessorInputAtSlot: (
    device: DeviceInstance,
    runtime: DeviceRuntime,
    toPortId: string,
    slotIndex: number,
    itemId: ItemId,
    amount: number,
  ) => boolean
  canOutputItemToPort: (
    device: DeviceInstance,
    runtime: DeviceRuntime,
    fromPortId: string,
    itemId: ItemId,
  ) => boolean
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
  nodeStates: FlowNodeSnapshot[]
  edgeStates: FlowEdgeSnapshot[]
}
