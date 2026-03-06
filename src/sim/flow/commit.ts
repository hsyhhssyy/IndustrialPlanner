import type { DeviceInstance, DeviceRuntime, ItemId } from '../../domain/types'
import type { PortLink, TransferPlan } from './types'

type CommitContext = {
  tick: number
  runtimeById: Record<string, DeviceRuntime>
  deviceById: Map<string, DeviceInstance>
  outMap: Map<string, PortLink[]>
  warehouse: Record<ItemId, number>
  transferPlans: TransferPlan[]
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
    consumeSourceByPlan: (plan: TransferPlan, runtime: DeviceRuntime, device: DeviceInstance, tick: number) => void
    shouldIgnoreConfiguredOutputInventory: (device: DeviceInstance, fromPortId: string, itemId: ItemId) => boolean
    isRoundRobinJunctionType: (typeId: DeviceInstance['typeId']) => boolean
    isSplitterType: (typeId: DeviceInstance['typeId']) => boolean
    isConvergerType: (typeId: DeviceInstance['typeId']) => boolean
    indexInConvergerInputOrder: (portId: string) => number
    advanceBufferGroupInputCursor: (runtime: DeviceRuntime, pickedPortId: string) => boolean
    advanceBufferGroupOutputCursor: (runtime: DeviceRuntime, pickedPortId: string) => boolean
  }
}

export function commitTransferPlans(context: CommitContext) {
  for (const plan of context.transferPlans) {
    const fromRuntime = context.runtimeById[plan.fromId]
    const toRuntime = context.runtimeById[plan.toId]
    const fromDevice = context.deviceById.get(plan.fromId)
    const toDevice = context.deviceById.get(plan.toId)
    if (!fromRuntime || !toRuntime || !fromDevice || !toDevice) continue

    const received = context.helpers.tryReceiveToLane(toDevice, toRuntime, plan.toLane, plan.toPortId, plan.itemId, context.tick)
    if (!received) {
      continue
    }

    if (context.helpers.isWarehouseSubmitPort(toDevice, plan.toPortId) && 'inventory' in toRuntime) {
      toRuntime.inventory[plan.itemId] = Math.max(0, (toRuntime.inventory[plan.itemId] ?? 0) - 1)
      if (Number.isFinite(context.warehouse[plan.itemId])) {
        context.warehouse[plan.itemId] += 1
      }
    }

    if (fromDevice.typeId === 'item_port_unloader_1' || fromDevice.typeId === 'item_port_sp_hub_1') {
      if (!context.helpers.shouldIgnoreConfiguredOutputInventory(fromDevice, plan.fromPortId, plan.itemId) && Number.isFinite(context.warehouse[plan.itemId])) {
        context.warehouse[plan.itemId] = Math.max(0, context.warehouse[plan.itemId] - 1)
      }
    } else {
      context.helpers.consumeSourceByPlan(plan, fromRuntime, fromDevice, context.tick)
    }

    if (context.helpers.isRoundRobinJunctionType(fromDevice.typeId) && 'rrIndex' in fromRuntime && plan.senderOutLinkCount > 0) {
      if (context.helpers.isSplitterType(fromDevice.typeId)) {
        fromRuntime.rrIndex = (fromRuntime.rrIndex + plan.senderPickedOutLinkIndex + 1) % plan.senderOutLinkCount
      } else {
        fromRuntime.rrIndex = (fromRuntime.rrIndex + 1) % plan.senderOutLinkCount
      }
    }

    if (context.helpers.isConvergerType(toDevice.typeId) && 'rrIndex' in toRuntime) {
      const pickedInputOrderIndex = context.helpers.indexInConvergerInputOrder(plan.toPortId)
      if (pickedInputOrderIndex >= 0) {
        toRuntime.rrIndex = (pickedInputOrderIndex + 1) % 3
      }
    }

    context.helpers.advanceBufferGroupInputCursor(toRuntime, plan.toPortId)

    context.helpers.advanceBufferGroupOutputCursor(fromRuntime, plan.fromPortId)
  }
}
