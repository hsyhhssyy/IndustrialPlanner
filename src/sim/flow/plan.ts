import type { ItemId } from '../../domain/types'
import type { PlanContext, PlanResult, PortLink, ReceiveState, TransferPlan } from './types'

function receiveKey(deviceId: string, lane: string) {
  return `${deviceId}:${lane}`
}

function buildTransferId(tick: number, sequence: number) {
  return `${tick}:${sequence}`
}

function selectStoragePlanForSender(
  context: PlanContext,
  senderDevice: PlanContext['layoutDevices'][number],
  senderId: string,
  outLinks: PortLink[],
  reservedReceivers: Set<string>,
  lanesClearingThisTick: Set<string>,
  convergerPreferredInputPortById: Map<string, string>,
  devicePreferredSolidInputPortsById: Map<string, Set<string>>,
): { link: PortLink; slotIndex: number; itemId: ItemId; recvState: ReceiveState; pickedLinkIndex: number } | null {
  const senderRuntime = context.runtimeById[senderId]
  if (!senderRuntime || !context.helpers.isStorageWithBufferGroups(senderRuntime)) return null
  for (let linkIndex = 0; linkIndex < outLinks.length; linkIndex += 1) {
    const link = outLinks[linkIndex]
    const slotIndices = context.helpers.orderedStorageSlotIndicesForOutput(senderRuntime, link.from.portId)

    for (const slotIndex of slotIndices) {
      const itemId = context.helpers.getStorageSlotItemId(senderRuntime, slotIndex, link.from.portId)
      if (!itemId) continue
      if (!context.helpers.canStorageSlotOutputToPort(senderDevice, senderRuntime, slotIndex, link.from.portId, itemId)) continue
      const toRuntime = context.runtimeById[link.to.instanceId]
      const toDevice = context.deviceById.get(link.to.instanceId)
      if (!toRuntime || !toDevice) continue

      const recvState = context.helpers.canReceiveOnPortWithPlan(
        toDevice,
        toRuntime,
        link.to.portId,
        reservedReceivers,
        lanesClearingThisTick,
        itemId,
      )
      if (!recvState.lane || !recvState.canTry || !recvState.canAccept) continue

      if (context.helpers.isConvergerType(toDevice.typeId)) {
        const preferredPort = convergerPreferredInputPortById.get(toDevice.instanceId)
        if (preferredPort && preferredPort !== link.to.portId) continue
      }

      const preferredSolidInputPorts = devicePreferredSolidInputPortsById.get(toDevice.instanceId)
      if (preferredSolidInputPorts && preferredSolidInputPorts.size > 0 && !preferredSolidInputPorts.has(link.to.portId)) continue

      return { link, slotIndex, itemId, recvState, pickedLinkIndex: linkIndex }
    }
  }

  return null
}

export function buildTransferPlans(context: PlanContext): PlanResult {
  const transferPlans: TransferPlan[] = []
  const plannedSenders = new Set<string>()
  const reservedReceivers = new Set<string>()
  const lanesClearingThisTick = new Set<string>()
  const lanesAdvancedThisTick = new Set<string>()

  let changed = true
  while (changed) {
    changed = false

    const convergerPreferredInputPortById = context.helpers.buildConvergerPreferredInputPortMap()
    const devicePreferredSolidInputPortsById = context.helpers.buildDevicePreferredSolidInputPortMap()

    for (const device of context.layoutDevices) {
      const runtime = context.runtimeById[device.instanceId]
      if (!runtime || context.helpers.isHardBlockedStall(runtime.stallReason) || plannedSenders.has(device.instanceId)) continue

      const rawOutLinks = context.outMap.get(device.instanceId) ?? []
      const outLinks = context.helpers.orderedOutLinks(device, runtime, rawOutLinks)
      if (outLinks.length === 0) continue

      const storagePick = selectStoragePlanForSender(
        context,
        device,
        device.instanceId,
        outLinks,
        reservedReceivers,
        lanesClearingThisTick,
        convergerPreferredInputPortById,
        devicePreferredSolidInputPortsById,
      )
      if (storagePick) {
        transferPlans.push({
          transferId: buildTransferId(context.tick, transferPlans.length),
          fromId: device.instanceId,
          fromPortId: storagePick.link.from.portId,
          fromLane: 'output',
          fromOutputSlotIndex: storagePick.slotIndex,
          toId: storagePick.link.to.instanceId,
          toPortId: storagePick.link.to.portId,
          toLane: storagePick.recvState.lane!,
          itemId: storagePick.itemId,
          senderOutLinkCount: outLinks.length,
          senderPickedOutLinkIndex: storagePick.pickedLinkIndex,
        })

        plannedSenders.add(device.instanceId)
        reservedReceivers.add(receiveKey(storagePick.link.to.instanceId, storagePick.recvState.lane!))
        lanesClearingThisTick.add(receiveKey(device.instanceId, 'output'))
        changed = true
        continue
      }

      for (let outLinkIndex = 0; outLinkIndex < outLinks.length; outLinkIndex += 1) {
        const link = outLinks[outLinkIndex]
        const toRuntime = context.runtimeById[link.to.instanceId]
        const toDevice = context.deviceById.get(link.to.instanceId)
        if (!toRuntime || !toDevice) continue

        if (context.helpers.isConvergerType(toDevice.typeId)) {
          const preferredPort = convergerPreferredInputPortById.get(toDevice.instanceId)
          if (preferredPort && preferredPort !== link.to.portId) continue
        }

        const preferredSolidInputPorts = devicePreferredSolidInputPortsById.get(toDevice.instanceId)
        if (preferredSolidInputPorts && preferredSolidInputPorts.size > 0 && !preferredSolidInputPorts.has(link.to.portId)) continue

        const fromLane = context.helpers.sourceSlotLane(device, runtime, link.from.portId)
        const laneAdvanceKey = `${device.instanceId}:${fromLane}`
        if (context.lanesReachedHalfThisTick.has(laneAdvanceKey)) continue

        const prepared = context.helpers.prepareSourceLaneItem(
          device,
          runtime,
          fromLane,
          link.from.portId,
          context.lanesReachedHalfThisTick,
          lanesAdvancedThisTick,
        )
        if (prepared.laneProgressAdvanced) changed = true
        if (!prepared.itemId) continue

        const recvState = context.helpers.canReceiveOnPortWithPlan(
          toDevice,
          toRuntime,
          link.to.portId,
          reservedReceivers,
          lanesClearingThisTick,
          prepared.itemId,
        )
        if (!recvState.lane || !recvState.canTry || !recvState.canAccept) continue

        transferPlans.push({
          transferId: buildTransferId(context.tick, transferPlans.length),
          fromId: device.instanceId,
          fromPortId: link.from.portId,
          fromLane,
          toId: toDevice.instanceId,
          toPortId: link.to.portId,
          toLane: recvState.lane,
          itemId: prepared.itemId,
          senderOutLinkCount: outLinks.length,
          senderPickedOutLinkIndex: outLinkIndex,
        })

        plannedSenders.add(device.instanceId)
        reservedReceivers.add(receiveKey(toDevice.instanceId, recvState.lane))
        lanesClearingThisTick.add(receiveKey(device.instanceId, fromLane))
        changed = true
        break
      }
    }
  }

  return {
    transferPlans,
    plannedSenders,
    reservedReceivers,
    lanesClearingThisTick,
    lanesAdvancedThisTick,
  }
}
