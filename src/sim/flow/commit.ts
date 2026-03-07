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
    isConvergerType: (typeId: DeviceInstance['typeId']) => boolean
    indexInConvergerInputOrder: (portId: string) => number
    advanceBufferGroupInputCursor: (runtime: DeviceRuntime, pickedPortId: string) => boolean
    advanceBufferGroupOutputCursor: (runtime: DeviceRuntime, pickedPortId: string) => boolean
  }
}

export function commitTransferMatches(context: CommitContext) {
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

    if (context.helpers.isRoundRobinJunctionType(fromDevice.typeId) && 'rrIndex' in fromRuntime && match.senderOutLinkCount > 0) {
      if (context.helpers.isSplitterType(fromDevice.typeId)) {
        fromRuntime.rrIndex = (fromRuntime.rrIndex + match.senderPickedOutLinkIndex + 1) % match.senderOutLinkCount
      } else {
        fromRuntime.rrIndex = (fromRuntime.rrIndex + 1) % match.senderOutLinkCount
      }
    }

    if (context.helpers.isConvergerType(toDevice.typeId) && 'rrIndex' in toRuntime) {
      const pickedInputOrderIndex = context.helpers.indexInConvergerInputOrder(match.toPortId)
      if (pickedInputOrderIndex >= 0) {
        toRuntime.rrIndex = (pickedInputOrderIndex + 1) % 3
      }
    }

    context.helpers.advanceBufferGroupInputCursor(toRuntime, match.toPortId)

    context.helpers.advanceBufferGroupOutputCursor(fromRuntime, match.fromPortId)
  }
}
