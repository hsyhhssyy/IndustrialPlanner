import type { DeviceInstance, DeviceRuntime, ItemId } from '../../domain/types'
import type { PortLink, TransferMatch } from './types'

type CommitContext = {
  tick: number
  runtimeById: Record<string, DeviceRuntime>
  deviceById: Map<string, DeviceInstance>
  outMap: Map<string, PortLink[]>
  warehouse: Record<ItemId, number>
  transferMatches: TransferMatch[]
  helpers: {
    tryReceiveToLane: (
      device: DeviceInstance,
      runtime: DeviceRuntime,
      lane: 'slot' | 'ns' | 'we' | 'output',
      toPortId: string,
      itemId: ItemId,
      tick: number,
    ) => boolean
    isWarehouseSubmitPort: (device: DeviceInstance, toPortId: string) => boolean
    consumeSourceByPlan: (plan: TransferMatch, runtime: DeviceRuntime, device: DeviceInstance, tick: number) => void
    shouldIgnoreConfiguredOutputInventory: (device: DeviceInstance, fromPortId: string, itemId: ItemId) => boolean
    isRoundRobinJunctionType: (typeId: DeviceInstance['typeId']) => boolean
    isSplitterType: (typeId: DeviceInstance['typeId']) => boolean
  }
}

export function commitTransferMatches(context: CommitContext) {
  const committedSenders = new Set<string>()
  let committedCount = 0

  for (const match of context.transferMatches) {
    const fromRuntime = context.runtimeById[match.fromId]
    const toRuntime = context.runtimeById[match.toId]
    const fromDevice = context.deviceById.get(match.fromId)
    const toDevice = context.deviceById.get(match.toId)
    if (!fromRuntime || !toRuntime || !fromDevice || !toDevice) continue

    const received = context.helpers.tryReceiveToLane(toDevice, toRuntime, match.toLane, match.toPortId, match.itemId, context.tick)
    if (!received) {
      continue
    }

    committedCount += 1
    committedSenders.add(match.fromId)

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
    } else {
      context.helpers.consumeSourceByPlan(match, fromRuntime, fromDevice, context.tick)
    }

    if (
      context.helpers.isRoundRobinJunctionType(fromDevice.typeId)
      && context.helpers.isSplitterType(fromDevice.typeId)
      && 'rrIndex' in fromRuntime
      && match.senderOutLinkCount > 0
    ) {
      fromRuntime.rrIndex = (fromRuntime.rrIndex + match.senderPickedOutLinkIndex + 1) % match.senderOutLinkCount
    }

    if (toRuntime.inputPriorityGroupCursorByLane) {
      const laneKey = `${match.toId}:${match.toLane}`
      const current = toRuntime.inputPriorityGroupCursorByLane[laneKey] ?? [0, 0]
      const next = [...current] as [number, number]
      if (match.receiverPriorityPortCount > 0) {
        next[match.receiverPriorityTier] = (match.receiverPriorityPortIndex + 1) % match.receiverPriorityPortCount
      }
      toRuntime.inputPriorityGroupCursorByLane[laneKey] = next
    }

    if (fromRuntime.outputPriorityGroupCursorByGroup && match.senderPriorityGroupKey) {
      const current = fromRuntime.outputPriorityGroupCursorByGroup[match.senderPriorityGroupKey] ?? [0, 0]
        const next = [...current] as [number, number]
        if (match.senderPriorityPortCount > 0) {
          next[match.senderPriorityTier] = (match.senderPriorityPortIndex + 1) % match.senderPriorityPortCount
        }
        fromRuntime.outputPriorityGroupCursorByGroup[match.senderPriorityGroupKey] = next
    }
  }

  return {
    committedCount,
    committedSenders,
  }
}
