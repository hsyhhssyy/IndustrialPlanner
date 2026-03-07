import type { ItemId } from '../../domain/types'
import type { PlanContext, PlanResult, PortLink, PullIntent, ReceiveLane, TransferMatch } from './types'

type ReceiverState = {
  key: string
  receiverId: string
  receiverPortId: string
  receiverPortRank: number
  candidateLinks: PortLink[]
}

type ActiveIntent = PullIntent & {
  receiverLaneKey: string
  receiverStateKey: string
  selectedCandidateIndex: number
}

function laneKey(deviceId: string, lane: ReceiveLane) {
  return `${deviceId}:${lane}`
}

function buildTransferId(tick: number, sequence: number) {
  return `${tick}:${sequence}`
}

function pickStorageOutputSlotForPort(context: PlanContext, senderDeviceId: string, senderPortId: string, itemId: ItemId) {
  const senderRuntime = context.runtimeById[senderDeviceId]
  const senderDevice = context.deviceById.get(senderDeviceId)
  if (!senderRuntime || !senderDevice || !context.helpers.isStorageWithBufferGroups(senderRuntime)) return undefined

  const slotIndices = context.helpers.orderedStorageSlotIndicesForOutput(senderRuntime, senderPortId)
  for (const slotIndex of slotIndices) {
    const slotItemId = context.helpers.getStorageSlotItemId(senderRuntime, slotIndex, senderPortId)
    if (!slotItemId || slotItemId !== itemId) continue
    if (!context.helpers.canStorageSlotOutputToPort(senderDevice, senderRuntime, slotIndex, senderPortId, itemId)) continue
    return slotIndex
  }

  return undefined
}

function buildReceiverStates(
  context: PlanContext,
  convergerPullInputPortOrderById: Map<string, string[]>,
  devicePullInputPortOrderById: Map<string, string[]>,
) {
  const states: ReceiverState[] = []

  for (const device of context.layoutDevices) {
    const runtime = context.runtimeById[device.instanceId]
    if (!runtime || context.helpers.isHardBlockedStall(runtime.stallReason)) continue

    const inLinks = context.inMap.get(device.instanceId) ?? []
    if (inLinks.length === 0) continue

    const preferredPortOrder = context.helpers.isConvergerType(device.typeId)
      ? (convergerPullInputPortOrderById.get(device.instanceId) ?? [])
      : (devicePullInputPortOrderById.get(device.instanceId) ?? [])

    const linksByPort = new Map<string, PortLink[]>()
    const discoveredPortOrder: string[] = []
    for (const link of inLinks) {
      const existing = linksByPort.get(link.to.portId)
      if (existing) {
        existing.push(link)
      } else {
        linksByPort.set(link.to.portId, [link])
        discoveredPortOrder.push(link.to.portId)
      }
    }

    const portOrder = preferredPortOrder.filter((portId) => linksByPort.has(portId))
    for (const portId of discoveredPortOrder) {
      if (!portOrder.includes(portId)) {
        portOrder.push(portId)
      }
    }

    for (let rank = 0; rank < portOrder.length; rank += 1) {
      const receiverPortId = portOrder[rank]
      const candidateLinks = linksByPort.get(receiverPortId) ?? []
      if (candidateLinks.length === 0) continue
      states.push({
        key: `${device.instanceId}:${receiverPortId}`,
        receiverId: device.instanceId,
        receiverPortId,
        receiverPortRank: rank,
        candidateLinks,
      })
    }
  }

  return states
}

function pickIntentForReceiverState(
  context: PlanContext,
  state: ReceiverState,
  receiverCursorByState: Map<string, number>,
  plannedSenders: Set<string>,
  matchedReceiverLanes: Set<string>,
  lanesClearingThisTick: Set<string>,
  lanesAdvancedThisTick: Set<string>,
) {
  const receiverRuntime = context.runtimeById[state.receiverId]
  const receiverDevice = context.deviceById.get(state.receiverId)
  if (!receiverRuntime || !receiverDevice) return { intent: null as ActiveIntent | null, advanced: false }

  let advanced = false
  const startIndex = receiverCursorByState.get(state.key) ?? 0
  for (let index = startIndex; index < state.candidateLinks.length; index += 1) {
    const link = state.candidateLinks[index]
    const senderRuntime = context.runtimeById[link.from.instanceId]
    const senderDevice = context.deviceById.get(link.from.instanceId)
    if (!senderRuntime || !senderDevice) continue
    if (context.helpers.isHardBlockedStall(senderRuntime.stallReason)) continue
    if (plannedSenders.has(link.from.instanceId)) continue

    const fromLane = context.helpers.sourceSlotLane(senderDevice, senderRuntime, link.from.portId)
    const laneAdvanceKey = `${senderDevice.instanceId}:${fromLane}`
    if (context.lanesReachedHalfThisTick.has(laneAdvanceKey)) continue

    const prepared = context.helpers.prepareSourceLaneItem(
      senderDevice,
      senderRuntime,
      fromLane,
      link.from.portId,
      context.lanesReachedHalfThisTick,
      lanesAdvancedThisTick,
    )
    if (prepared.laneProgressAdvanced) advanced = true
    if (!prepared.itemId) continue

    const receiverLane = context.helpers.canReceiveLaneForItem(
      receiverDevice,
      receiverRuntime,
      state.receiverPortId,
      lanesClearingThisTick,
      prepared.itemId,
    )
    if (!receiverLane) continue

    const receiverLaneKey = laneKey(state.receiverId, receiverLane)
    if (matchedReceiverLanes.has(receiverLaneKey)) continue

    const orderedOutLinks = context.helpers.orderedOutLinks(senderDevice, senderRuntime, context.outMap.get(senderDevice.instanceId) ?? [])
    const pickedOutLinkIndex = orderedOutLinks.findIndex(
      (outLink) =>
        outLink.from.instanceId === link.from.instanceId
        && outLink.from.portId === link.from.portId
        && outLink.to.instanceId === link.to.instanceId
        && outLink.to.portId === link.to.portId,
    )
    if (pickedOutLinkIndex < 0) continue

    const slotIndex = pickStorageOutputSlotForPort(context, senderDevice.instanceId, link.from.portId, prepared.itemId)
    if (context.helpers.isStorageWithBufferGroups(senderRuntime) && typeof slotIndex !== 'number') continue

    return {
      intent: {
        receiverId: state.receiverId,
        receiverPortId: state.receiverPortId,
        receiverLane,
        receiverCandidateRank: state.receiverPortRank * 1000 + index,
        fromId: link.from.instanceId,
        fromPortId: link.from.portId,
        fromLane,
        fromOutputSlotIndex: slotIndex,
        itemId: prepared.itemId,
        senderOutLinkCount: orderedOutLinks.length,
        senderPickedOutLinkIndex: pickedOutLinkIndex,
        receiverLaneKey,
        receiverStateKey: state.key,
        selectedCandidateIndex: index,
      },
      advanced,
    }
  }

  receiverCursorByState.set(state.key, state.candidateLinks.length)
  return { intent: null as ActiveIntent | null, advanced }
}

function compareIntents(left: ActiveIntent, right: ActiveIntent) {
  if (left.senderPickedOutLinkIndex !== right.senderPickedOutLinkIndex) {
    return left.senderPickedOutLinkIndex - right.senderPickedOutLinkIndex
  }

  const leftSlot = typeof left.fromOutputSlotIndex === 'number' ? left.fromOutputSlotIndex : Number.MAX_SAFE_INTEGER
  const rightSlot = typeof right.fromOutputSlotIndex === 'number' ? right.fromOutputSlotIndex : Number.MAX_SAFE_INTEGER
  if (leftSlot !== rightSlot) {
    return leftSlot - rightSlot
  }

  if (left.receiverCandidateRank !== right.receiverCandidateRank) {
    return left.receiverCandidateRank - right.receiverCandidateRank
  }

  const receiverCmp = left.receiverId.localeCompare(right.receiverId)
  if (receiverCmp !== 0) return receiverCmp
  return left.receiverPortId.localeCompare(right.receiverPortId)
}

export function solvePullTransferMatches(context: PlanContext): PlanResult {
  const transferMatches: TransferMatch[] = []
  const plannedSenders = new Set<string>()
  const matchedReceiverLanes = new Set<string>()
  const lanesClearingThisTick = new Set<string>()
  const lanesAdvancedThisTick = new Set<string>()

  const convergerPullInputPortOrderById = context.helpers.buildConvergerPullInputPortOrderMap()
  const devicePullInputPortOrderById = context.helpers.buildDevicePullInputPortOrderMap()
  const receiverStates = buildReceiverStates(context, convergerPullInputPortOrderById, devicePullInputPortOrderById)
  const receiverCursorByState = new Map(receiverStates.map((state) => [state.key, 0]))

  const totalLinks = receiverStates.reduce((sum, state) => sum + state.candidateLinks.length, 0)
  const maxRounds = Math.max(8, totalLinks)

  let transferSequence = 0
  for (let round = 0; round < maxRounds; round += 1) {
    const activeIntents: ActiveIntent[] = []
    let laneAdvancedThisRound = false

    for (const state of receiverStates) {
      const { intent, advanced } = pickIntentForReceiverState(
        context,
        state,
        receiverCursorByState,
        plannedSenders,
        matchedReceiverLanes,
        lanesClearingThisTick,
        lanesAdvancedThisTick,
      )
      if (advanced) laneAdvancedThisRound = true
      if (intent) activeIntents.push(intent)
    }

    if (activeIntents.length === 0) {
      if (!laneAdvancedThisRound) break
      continue
    }

    const groupedBySender = new Map<string, ActiveIntent[]>()
    for (const intent of activeIntents) {
      const grouped = groupedBySender.get(intent.fromId)
      if (grouped) {
        grouped.push(intent)
      } else {
        groupedBySender.set(intent.fromId, [intent])
      }
    }

    const winningIntentBySender = new Map<string, ActiveIntent>()
    for (const [senderId, intents] of groupedBySender.entries()) {
      intents.sort(compareIntents)
      winningIntentBySender.set(senderId, intents[0])
    }

    const winners = [...winningIntentBySender.values()]
    if (winners.length === 0) {
      if (!laneAdvancedThisRound) break
      continue
    }

    const winnerSet = new Set(winners)
    for (const intent of activeIntents) {
      if (winnerSet.has(intent)) continue
      receiverCursorByState.set(intent.receiverStateKey, intent.selectedCandidateIndex + 1)
    }

    for (const winner of winners) {
      transferMatches.push({
        transferId: buildTransferId(context.tick, transferSequence),
        fromId: winner.fromId,
        fromPortId: winner.fromPortId,
        fromLane: winner.fromLane,
        fromOutputSlotIndex: winner.fromOutputSlotIndex,
        toId: winner.receiverId,
        toPortId: winner.receiverPortId,
        toLane: winner.receiverLane,
        itemId: winner.itemId,
        senderOutLinkCount: winner.senderOutLinkCount,
        senderPickedOutLinkIndex: winner.senderPickedOutLinkIndex,
      })
      transferSequence += 1
      plannedSenders.add(winner.fromId)
      matchedReceiverLanes.add(winner.receiverLaneKey)
      lanesClearingThisTick.add(`${winner.fromId}:${winner.fromLane}`)
    }
  }

  return {
    transferMatches,
    plannedSenders,
    lanesAdvancedThisTick,
  }
}
