import type { ItemId } from '../../domain/types'
import { getDirectionalPortIds, getPortPriorityGroup, orderPortsByPriorityGroup } from '../../domain/shared/portPriority'
import type { PlanContext, PlanResult, PortLink, PullIntent, ReceiveLane, TransferMatch } from './types'

type CandidateLink = PortLink & {
  receiverPortId: string
  receiverPortRank: number
  receiverPriorityGroup: number
  receiverPriorityPortIndex: number
  receiverPriorityPortCount: number
}

type ReceiverState = {
  key: string
  receiverId: string
  candidateLinks: CandidateLink[]
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

function compareCandidateLinks(left: PortLink, right: PortLink) {
  const fromCmp = left.from.instanceId.localeCompare(right.from.instanceId)
  if (fromCmp !== 0) return fromCmp
  return left.from.portId.localeCompare(right.from.portId)
}

function getPriorityGroupCursor(runtime: PlanContext['runtimeById'][string], laneKey: string, priorityGroup: number) {
  const cursors = runtime.inputPriorityGroupCursorByLane?.[laneKey]
  return cursors?.[priorityGroup - 1] ?? 0
}

function liveOrderedInputPorts(
  context: PlanContext,
  deviceId: string,
  inLinks: PortLink[],
  devicePullInputPortOrderById: Map<string, string[]>,
) {
  const runtime = context.runtimeById[deviceId]
  const device = context.deviceById.get(deviceId)
  if (!runtime || !device) return [] as string[]

  const linkedPorts = [...new Set(inLinks.map((link) => link.to.portId))]
  if (linkedPorts.length === 0) return []

  const preferredPortOrder = devicePullInputPortOrderById.get(deviceId) ?? []
  const ordered = preferredPortOrder.filter((portId) => linkedPorts.includes(portId))
  for (const portId of linkedPorts) {
    if (!ordered.includes(portId)) {
      ordered.push(portId)
    }
  }
  return ordered
}

function buildReceiverStates(
  context: PlanContext,
  devicePullInputPortOrderById: Map<string, string[]>,
) {
  const states: ReceiverState[] = []

  for (const device of context.layoutDevices) {
    const runtime = context.runtimeById[device.instanceId]
    if (!runtime || context.helpers.isHardBlockedStall(runtime.stallReason)) continue

    const inLinks = context.inMap.get(device.instanceId) ?? []
    if (inLinks.length === 0) continue

    const linksByPort = new Map<string, PortLink[]>()
    for (const link of inLinks) {
      const existing = linksByPort.get(link.to.portId)
      if (existing) {
        existing.push(link)
      } else {
        linksByPort.set(link.to.portId, [link])
      }
    }

    const portOrder = liveOrderedInputPorts(context, device.instanceId, inLinks, devicePullInputPortOrderById)
    const candidateLinksByLane = new Map<string, CandidateLink[]>()
    const stateOrder: string[] = []

    for (const receiverPortId of portOrder) {
      const receiverLane = context.helpers.receiveLaneForPort(device, runtime, receiverPortId)
      if (!receiverLane) continue
      const stateKey = `${device.instanceId}:${receiverLane}`
      let laneCandidates = candidateLinksByLane.get(stateKey)
      if (!laneCandidates) {
        laneCandidates = []
        candidateLinksByLane.set(stateKey, laneCandidates)
        stateOrder.push(stateKey)
      }

      laneCandidates.push(
        ...(linksByPort.get(receiverPortId) ?? []).map((link) => ({
          ...link,
          receiverPortId,
          receiverPortRank: -1,
          receiverPriorityGroup: getPortPriorityGroup(device.config, receiverPortId),
          receiverPriorityPortIndex: 0,
          receiverPriorityPortCount: 0,
        })),
      )
    }

    for (const stateKey of stateOrder) {
      const laneCandidates = candidateLinksByLane.get(stateKey) ?? []
      const orderedByPriorityGroup = Array.from({ length: 10 }, (_, index) => index + 1)
        .flatMap((priorityGroup) => {
          const groupedCandidates = laneCandidates.filter((link) => link.receiverPriorityGroup === priorityGroup)
          const groupedByPort = new Map<string, CandidateLink[]>()
          for (const candidate of groupedCandidates) {
            const existing = groupedByPort.get(candidate.receiverPortId)
            if (existing) {
              existing.push(candidate)
            } else {
              groupedByPort.set(candidate.receiverPortId, [candidate])
            }
          }

          const orderedGroupCandidates: CandidateLink[] = []
          const canonicalGroupPortOrder = portOrder.filter((receiverPortId) => groupedByPort.has(receiverPortId))
          const canonicalPortIndexById = new Map(canonicalGroupPortOrder.map((receiverPortId, index) => [receiverPortId, index]))
          const groupPortOrder = orderPortsByPriorityGroup(
            canonicalGroupPortOrder,
            () => priorityGroup,
            (() => {
              const cursors = Array.from({ length: 10 }, () => 0)
              cursors[priorityGroup - 1] = getPriorityGroupCursor(runtime, stateKey, priorityGroup)
              return cursors
            })(),
          )
          for (const receiverPortId of groupPortOrder) {
            const portCandidates = groupedByPort.get(receiverPortId)
            if (!portCandidates || portCandidates.length === 0) continue
            portCandidates.sort(compareCandidateLinks)
            orderedGroupCandidates.push(
              ...portCandidates.map((candidate) => ({
                ...candidate,
                receiverPriorityGroup: priorityGroup,
                receiverPriorityPortIndex: canonicalPortIndexById.get(receiverPortId) ?? 0,
                receiverPriorityPortCount: canonicalGroupPortOrder.length,
              })),
            )
          }
          return orderedGroupCandidates
        })

      const candidateLinks = orderedByPriorityGroup.map((candidate, index) => ({
        ...candidate,
        receiverPortRank: index,
      }))
      if (candidateLinks.length === 0) continue
      states.push({
        key: stateKey,
        receiverId: device.instanceId,
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
      link.receiverPortId,
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

    let senderPriorityGroupKey: string | null = null
    let senderPriorityGroup = 5
    let senderPriorityPortIndex = 0
    let senderPriorityPortCount = 0
    const allSenderOutLinks = context.outMap.get(senderDevice.instanceId) ?? []
    const outputGroupPortIds = context.helpers.isStorageWithBufferGroups(senderRuntime)
      && 'bufferGroups' in senderRuntime
      && Array.isArray(senderRuntime.bufferGroups)
      ? senderRuntime.bufferGroups.find((group) => group.outPortIds.includes(link.from.portId))?.outPortIds
      : getDirectionalPortIds(senderDevice.typeId, 'Output')
    if (outputGroupPortIds && outputGroupPortIds.length > 0) {
      senderPriorityGroupKey = context.helpers.isStorageWithBufferGroups(senderRuntime)
        && 'bufferGroups' in senderRuntime
        && Array.isArray(senderRuntime.bufferGroups)
        ? (senderRuntime.bufferGroups.find((group) => group.outPortIds.includes(link.from.portId))?.id ?? null)
        : '__default__'
      const livePortIds = outputGroupPortIds.filter((portId) => allSenderOutLinks.some((outLink) => outLink.from.portId === portId))
      senderPriorityGroup = getPortPriorityGroup(senderDevice.config, link.from.portId)
      const groupPortIds = livePortIds.filter((portId) => getPortPriorityGroup(senderDevice.config, portId) === senderPriorityGroup)
      senderPriorityPortIndex = Math.max(0, groupPortIds.findIndex((portId) => portId === link.from.portId))
      senderPriorityPortCount = groupPortIds.length
    }

    const slotIndex = pickStorageOutputSlotForPort(context, senderDevice.instanceId, link.from.portId, prepared.itemId)
    if (context.helpers.isStorageWithBufferGroups(senderRuntime) && typeof slotIndex !== 'number') continue

    return {
      intent: {
        receiverId: state.receiverId,
        receiverPortId: link.receiverPortId,
        receiverLane,
        receiverCandidateRank: link.receiverPortRank,
        fromId: link.from.instanceId,
        fromPortId: link.from.portId,
        fromLane,
        fromOutputSlotIndex: slotIndex,
        itemId: prepared.itemId,
        senderOutLinkCount: orderedOutLinks.length,
        senderPickedOutLinkIndex: pickedOutLinkIndex,
        senderPriorityGroupKey,
        senderPriorityGroup,
        senderPriorityPortIndex,
        senderPriorityPortCount,
        receiverPriorityGroup: link.receiverPriorityGroup,
        receiverPriorityPortIndex: link.receiverPriorityPortIndex,
        receiverPriorityPortCount: link.receiverPriorityPortCount,
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

function compareReceiverLaneIntents(left: ActiveIntent, right: ActiveIntent) {
  if (left.receiverCandidateRank !== right.receiverCandidateRank) {
    return left.receiverCandidateRank - right.receiverCandidateRank
  }

  const senderCmp = left.fromId.localeCompare(right.fromId)
  if (senderCmp !== 0) return senderCmp

  const portCmp = left.fromPortId.localeCompare(right.fromPortId)
  if (portCmp !== 0) return portCmp

  return compareIntents(left, right)
}

export function solvePullTransferMatches(context: PlanContext): PlanResult {
  const transferMatches: TransferMatch[] = []
  const plannedSenders = new Set<string>()
  const matchedReceiverLanes = new Set<string>()
  const lanesClearingThisTick = new Set<string>()
  const lanesAdvancedThisTick = new Set<string>()

  const devicePullInputPortOrderById = context.helpers.buildDevicePullInputPortOrderMap()
  const receiverStates = buildReceiverStates(context, devicePullInputPortOrderById)
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

    const selectedIntentByReceiverLane = new Map<string, ActiveIntent>()
    for (const intent of activeIntents) {
      const existing = selectedIntentByReceiverLane.get(intent.receiverLaneKey)
      if (!existing || compareReceiverLaneIntents(intent, existing) < 0) {
        selectedIntentByReceiverLane.set(intent.receiverLaneKey, intent)
      }
    }

    const receiverSelectedIntents = [...selectedIntentByReceiverLane.values()]

    const groupedBySender = new Map<string, ActiveIntent[]>()
    for (const intent of receiverSelectedIntents) {
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
    const receiverSelectedIntentSet = new Set(receiverSelectedIntents)
    for (const intent of activeIntents) {
      if (!receiverSelectedIntentSet.has(intent)) continue
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
        senderPriorityGroupKey: winner.senderPriorityGroupKey,
        senderPriorityGroup: winner.senderPriorityGroup,
        senderPriorityPortIndex: winner.senderPriorityPortIndex,
        senderPriorityPortCount: winner.senderPriorityPortCount,
        receiverPriorityGroup: winner.receiverPriorityGroup,
        receiverPriorityPortIndex: winner.receiverPriorityPortIndex,
        receiverPriorityPortCount: winner.receiverPriorityPortCount,
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
