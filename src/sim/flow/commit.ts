import type { DeviceInstance, DeviceRuntime, ItemId } from '../../domain/types'
import { PORT_PRIORITY_GROUP_MIN, normalizePriorityCursorArray } from '../../domain/shared/portPriority'
import { createDebugLogger } from '../../app/debugLogger'
import type { CommittedTransfer, FlowEdgeSnapshot, FlowNodeSnapshot } from './types'

const simFlowLogger = createDebugLogger('sim-flow')
const FLOW_DEBUG_FOCUS_DEVICE_IDS = new Set([
  'item_log_converger_mno0wbt3_r',
  'item_log_splitter_mno0wbt3_2',
  'item_log_converger_mno0wbt3_q',
])

function shouldTraceFocusedFlow(fromId: string, toId: string) {
  return FLOW_DEBUG_FOCUS_DEVICE_IDS.has(fromId) || FLOW_DEBUG_FOCUS_DEVICE_IDS.has(toId)
}

type CommitContext = {
  tick: number
  runtimeById: Record<string, DeviceRuntime>
  deviceById: Map<string, DeviceInstance>
  warehouse: Record<ItemId, number>
  nodeStates: FlowNodeSnapshot[]
  edgeStates: FlowEdgeSnapshot[]
  helpers: {
    applyPlannedReceive: (plan: CommittedTransfer, runtime: DeviceRuntime, device: DeviceInstance, tick: number) => boolean
    isWarehouseSubmitPort: (device: DeviceInstance, toPortId: string) => boolean
    consumeSourceByPlan: (plan: CommittedTransfer, runtime: DeviceRuntime, device: DeviceInstance, tick: number) => void
    shouldIgnoreConfiguredOutputInventory: (device: DeviceInstance, fromPortId: string, itemId: ItemId) => boolean
    isSplitterType: (typeId: DeviceInstance['typeId']) => boolean
  }
}

function compareAcceptedEdge(
  left: FlowEdgeSnapshot,
  right: FlowEdgeSnapshot,
  nodeOrderIndexById: ReadonlyMap<string, number>,
) {
  if (left.senderPickedOutLinkIndex !== right.senderPickedOutLinkIndex) {
    return left.senderPickedOutLinkIndex - right.senderPickedOutLinkIndex
  }
  if (left.receiverPriorityGroup !== right.receiverPriorityGroup) {
    return left.receiverPriorityGroup - right.receiverPriorityGroup
  }
  if (left.receiverPriorityPortIndex !== right.receiverPriorityPortIndex) {
    return left.receiverPriorityPortIndex - right.receiverPriorityPortIndex
  }

  const leftOrder = nodeOrderIndexById.get(left.toNodeId) ?? Number.MAX_SAFE_INTEGER
  const rightOrder = nodeOrderIndexById.get(right.toNodeId) ?? Number.MAX_SAFE_INTEGER
  if (leftOrder !== rightOrder) return leftOrder - rightOrder

  return left.edgeId.localeCompare(right.edgeId)
}

function buildCommittedTransfers(context: CommitContext) {
  const nodeById = new Map(context.nodeStates.map((node) => [node.nodeId, node]))
  const nodeOrderIndexById = new Map(context.nodeStates.map((node, index) => [node.nodeId, index]))
  const outgoingByNodeId = new Map<string, FlowEdgeSnapshot[]>()

  for (const edge of context.edgeStates) {
    const outgoing = outgoingByNodeId.get(edge.fromNodeId)
    if (outgoing) {
      outgoing.push(edge)
      continue
    }
    outgoingByNodeId.set(edge.fromNodeId, [edge])
  }

  const committedTransfers: CommittedTransfer[] = []

  for (const node of context.nodeStates) {
    if (node.baseState === 'free' || node.result === 'solved-block') continue

    const acceptedOutgoing = (outgoingByNodeId.get(node.nodeId) ?? [])
      .filter((edge) => !edge.deleted && edge.shadowPull === 'accept' && edge.shadowPush === 'accept' && Boolean(edge.plannedItemId))
      .sort((left, right) => compareAcceptedEdge(left, right, nodeOrderIndexById))

    if (acceptedOutgoing.length === 0) continue

    for (const edge of acceptedOutgoing) {
      const toNode = nodeById.get(edge.toNodeId)
      if (!toNode || !edge.plannedItemId) continue

      committedTransfers.push({
        edgeId: edge.edgeId,
        portLinkKey: edge.portLinkKey,
        fromNodeId: edge.fromNodeId,
        fromNodeKind: node.kind,
        fromId: edge.fromId,
        fromPortId: edge.fromPortId,
        fromLane: edge.fromLane,
        fromOutputSlotIndex: edge.fromOutputSlotIndex,
        fromStorageSlotIndex: edge.fromStorageSlotIndex,
        toNodeId: edge.toNodeId,
        toNodeKind: toNode.kind,
        toId: edge.toId,
        toPortId: edge.toPortId,
        toLane: edge.toLane,
        toInputSlotIndex: edge.toInputSlotIndex,
        toStorageSlotIndex: edge.toStorageSlotIndex,
        itemId: edge.plannedItemId,
        senderOutLinkCount: edge.senderOutLinkCount,
        senderPickedOutLinkIndex: edge.senderPickedOutLinkIndex,
        senderPriorityGroupKey: edge.senderPriorityGroupKey,
        senderPriorityGroup: edge.senderPriorityGroup,
        senderPriorityPortIndex: edge.senderPriorityPortIndex,
        senderPriorityPortCount: edge.senderPriorityPortCount,
        receiverPriorityGroup: edge.receiverPriorityGroup,
        receiverPriorityPortIndex: edge.receiverPriorityPortIndex,
        receiverPriorityPortCount: edge.receiverPriorityPortCount,
      })
    }
  }

  return committedTransfers
}

export function commitFlowPlan(context: CommitContext) {
  const committedTransfers = buildCommittedTransfers(context)
  const committedSenders = new Set<string>()
  const interactedDeviceIds = new Set<string>()
  let committedCount = 0

  for (const match of committedTransfers) {
    const fromRuntime = context.runtimeById[match.fromId]
    const fromDevice = context.deviceById.get(match.fromId)
    if (!fromRuntime || !fromDevice) continue
    context.helpers.consumeSourceByPlan(match, fromRuntime, fromDevice, context.tick)
  }

  for (const match of committedTransfers) {
    const fromRuntime = context.runtimeById[match.fromId]
    const toRuntime = context.runtimeById[match.toId]
    const fromDevice = context.deviceById.get(match.fromId)
    const toDevice = context.deviceById.get(match.toId)
    if (!fromRuntime || !toRuntime || !fromDevice || !toDevice) continue

    const received = context.helpers.applyPlannedReceive(match, toRuntime, toDevice, context.tick)
    if (!received) {
      if (shouldTraceFocusedFlow(match.fromId, match.toId)) {
        simFlowLogger.debug('commit-blocked', {
          tick: context.tick,
          fromId: match.fromId,
          fromTypeId: fromDevice.typeId,
          fromPortId: match.fromPortId,
          fromLane: match.fromLane,
          toId: match.toId,
          toTypeId: toDevice.typeId,
          toPortId: match.toPortId,
          toLane: match.toLane,
          itemId: match.itemId,
        }, 'planned transfer failed during commit because receiver could not actually accept the item')
      }
      continue
    }

    if (shouldTraceFocusedFlow(match.fromId, match.toId)) {
      simFlowLogger.debug('commit-applied', {
        tick: context.tick,
        fromId: match.fromId,
        fromTypeId: fromDevice.typeId,
        fromPortId: match.fromPortId,
        fromLane: match.fromLane,
        toId: match.toId,
        toTypeId: toDevice.typeId,
        toPortId: match.toPortId,
        toLane: match.toLane,
        itemId: match.itemId,
      }, 'planned transfer committed successfully for traced splitter/converger path')
    }

    committedCount += 1
    committedSenders.add(match.fromId)
    interactedDeviceIds.add(match.fromId)
    interactedDeviceIds.add(match.toId)

    if (context.helpers.isWarehouseSubmitPort(toDevice, match.toPortId) && 'inventory' in toRuntime) {
      toRuntime.inventory[match.itemId] = Math.max(0, (toRuntime.inventory[match.itemId] ?? 0) - 1)
      if (Number.isFinite(context.warehouse[match.itemId])) {
        context.warehouse[match.itemId] += 1
      }
    }

    if (fromDevice.typeId === 'item_port_unloader_1' || fromDevice.typeId === 'item_port_sp_hub_1') {
      if (!context.helpers.shouldIgnoreConfiguredOutputInventory(fromDevice, match.fromPortId, match.itemId) && Number.isFinite(context.warehouse[match.itemId])) {
        context.warehouse[match.itemId] = Math.max(0, context.warehouse[match.itemId] - 1)
      }
    }

    if (context.helpers.isSplitterType(fromDevice.typeId) && 'lastSplitterOutputPortId' in fromRuntime) {
      fromRuntime.lastSplitterOutputPortId = match.fromPortId
    }

    if (toRuntime.inputPriorityGroupCursorByLane) {
      const laneKey = `${match.toId}:${match.toLane}`
      const current = normalizePriorityCursorArray(toRuntime.inputPriorityGroupCursorByLane[laneKey])
      const next = [...current]
      if (match.receiverPriorityPortCount > 0) {
        const groupIndex = match.receiverPriorityGroup - PORT_PRIORITY_GROUP_MIN
        if (groupIndex >= 0 && groupIndex < next.length) {
          next[groupIndex] =
            (current[groupIndex] + match.receiverPriorityPortIndex + 1) % match.receiverPriorityPortCount
        }
      }
      toRuntime.inputPriorityGroupCursorByLane[laneKey] = next
    }

    if (fromRuntime.outputPriorityGroupCursorByGroup && match.senderPriorityGroupKey) {
      const current = normalizePriorityCursorArray(fromRuntime.outputPriorityGroupCursorByGroup[match.senderPriorityGroupKey])
      const next = [...current]
      if (match.senderPriorityPortCount > 0) {
        const groupIndex = match.senderPriorityGroup - PORT_PRIORITY_GROUP_MIN
        if (groupIndex >= 0 && groupIndex < next.length) {
          next[groupIndex] = (match.senderPriorityPortIndex + 1) % match.senderPriorityPortCount
        }
      }
      fromRuntime.outputPriorityGroupCursorByGroup[match.senderPriorityGroupKey] = next
    }
  }

  return {
    committedCount,
    committedSenders,
    interactedDeviceIds,
  }
}
