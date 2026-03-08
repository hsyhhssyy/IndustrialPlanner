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

function addCommitDependency(
  edges: Map<number, Set<number>>,
  inDegree: number[],
  beforeIndex: number,
  afterIndex: number,
) {
  if (beforeIndex === afterIndex) return
  let next = edges.get(beforeIndex)
  if (!next) {
    next = new Set<number>()
    edges.set(beforeIndex, next)
  }
  if (next.has(afterIndex)) return
  next.add(afterIndex)
  inDegree[afterIndex] += 1
}

function sortTransferMatchesForCommit(transferMatches: TransferMatch[]) {
  const edges = new Map<number, Set<number>>()
  const inDegree = Array.from({ length: transferMatches.length }, () => 0)

  for (let leftIndex = 0; leftIndex < transferMatches.length; leftIndex += 1) {
    const left = transferMatches[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < transferMatches.length; rightIndex += 1) {
      const right = transferMatches[rightIndex]

      if (left.fromId === right.toId && left.fromLane === right.toLane) {
        addCommitDependency(edges, inDegree, leftIndex, rightIndex)
      }
      if (right.fromId === left.toId && right.fromLane === left.toLane) {
        addCommitDependency(edges, inDegree, rightIndex, leftIndex)
      }
    }
  }

  const ready: number[] = []
  for (let index = 0; index < inDegree.length; index += 1) {
    if (inDegree[index] === 0) ready.push(index)
  }

  const ordered: TransferMatch[] = []
  const visited = new Set<number>()

  while (ready.length > 0) {
    const index = ready.shift()
    if (typeof index !== 'number' || visited.has(index)) continue
    visited.add(index)
    ordered.push(transferMatches[index])

    const next = edges.get(index)
    if (!next) continue
    for (const dependentIndex of next) {
      inDegree[dependentIndex] -= 1
      if (inDegree[dependentIndex] === 0) {
        ready.push(dependentIndex)
      }
    }
  }

  if (ordered.length === transferMatches.length) {
    return ordered
  }

  for (let index = 0; index < transferMatches.length; index += 1) {
    if (!visited.has(index)) {
      ordered.push(transferMatches[index])
    }
  }

  return ordered
}

export function commitTransferMatches(context: CommitContext) {
  const committedSenders = new Set<string>()
  let committedCount = 0

  for (const match of sortTransferMatchesForCommit(context.transferMatches)) {
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

  return {
    committedCount,
    committedSenders,
  }
}
