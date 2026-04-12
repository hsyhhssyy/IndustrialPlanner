import { OPPOSITE_EDGE } from '../../domain/geometry'
import { getDirectionalPortIds, getPortPriorityGroup } from '../../domain/shared/portPriority'
import type {
  BufferGroupRuntime,
  BufferSlotRuntime,
  DeviceInstance,
  DeviceRuntime,
  Edge,
  ItemId,
  ProcessorRuntime,
  StorageRuntime,
} from '../../domain/types'
import type {
  FlowEdgeSnapshot,
  FlowNodeBaseState,
  FlowNodeKind,
  FlowNodeSnapshot,
  PlanContext,
  PlanResult,
  PortLink,
  TransferMatch,
} from './types'

type InternalNode = FlowNodeSnapshot & {
  device: DeviceInstance
  runtime: DeviceRuntime
  deviceIndex: number
  localOrder: number
}

type InternalEdge = FlowEdgeSnapshot & {
  fromNode: InternalNode
  toNode: InternalNode
}

type SourceCandidate = {
  itemId: ItemId
  fromStorageSlotIndex?: number
}

type StorageVirtualSlot = {
  slotIndex: number
  mode: BufferSlotRuntime['mode']
  pinnedItemId?: ItemId
  currentItemId: ItemId | null
  amount: number
  capacity: number
}

type StorageVirtualGroup = {
  inPortIds: string[]
  outPortIds: string[]
  slotIndices: number[]
}

type StorageVirtualState = {
  slotted: boolean
  slots: StorageVirtualSlot[]
  groups: StorageVirtualGroup[]
}

type ProcessorInputVirtualSlot = {
  slotIndex: number
  currentItemId: ItemId | null
  lockedItem: ItemId | null
  amount: number
  capacity: number
}

function buildTransferId(tick: number, sequence: number) {
  return `${tick}:${sequence}`
}

function buildPortLinkKey(link: Pick<PortLink, 'from' | 'to'>) {
  return `${link.from.instanceId}:${link.from.portId}->${link.to.instanceId}:${link.to.portId}`
}

function isStorageRuntime(runtime: DeviceRuntime): runtime is StorageRuntime {
  return 'inventory' in runtime
}

function isProcessorRuntime(runtime: DeviceRuntime): runtime is ProcessorRuntime {
  return 'inputBuffer' in runtime && 'outputBuffer' in runtime && !('transportSamples' in runtime)
}

function isTransportBufferRuntime(runtime: DeviceRuntime) {
  return 'inputBuffer' in runtime && 'outputBuffer' in runtime && 'transportSamples' in runtime
}

function getBufferGroups(runtime: DeviceRuntime): BufferGroupRuntime[] {
  if (!('bufferGroups' in runtime) || !Array.isArray(runtime.bufferGroups) || runtime.bufferGroups.length === 0) return []
  return runtime.bufferGroups
}

function sumFiniteAmounts(values: number[]) {
  let total = 0
  for (const value of values) {
    if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY
    total += value
  }
  return total
}

function compareNodeOrder(left: InternalNode, right: InternalNode) {
  if (left.deviceIndex !== right.deviceIndex) return right.deviceIndex - left.deviceIndex
  if (left.localOrder !== right.localOrder) return left.localOrder - right.localOrder
  return left.nodeId.localeCompare(right.nodeId)
}

function compareEdgeKey(left: InternalEdge, right: InternalEdge) {
  if (left.senderPickedOutLinkIndex !== right.senderPickedOutLinkIndex) {
    return left.senderPickedOutLinkIndex - right.senderPickedOutLinkIndex
  }
  if (left.receiverPriorityGroup !== right.receiverPriorityGroup) {
    return left.receiverPriorityGroup - right.receiverPriorityGroup
  }
  if (left.receiverPriorityPortIndex !== right.receiverPriorityPortIndex) {
    return left.receiverPriorityPortIndex - right.receiverPriorityPortIndex
  }
  const nodeCmp = compareNodeOrder(left.toNode, right.toNode)
  if (nodeCmp !== 0) return nodeCmp
  return left.edgeId.localeCompare(right.edgeId)
}

function compareReceiverEdge(left: InternalEdge, right: InternalEdge) {
  if (left.receiverPriorityGroup !== right.receiverPriorityGroup) {
    return left.receiverPriorityGroup - right.receiverPriorityGroup
  }
  if (left.receiverPriorityPortIndex !== right.receiverPriorityPortIndex) {
    return left.receiverPriorityPortIndex - right.receiverPriorityPortIndex
  }
  const fromCmp = compareNodeOrder(left.fromNode, right.fromNode)
  if (fromCmp !== 0) return fromCmp
  return left.edgeId.localeCompare(right.edgeId)
}

function laneKey(deviceId: string, lane: string | undefined) {
  return `${deviceId}:${lane ?? 'none'}`
}

function storageStateFromRuntime(runtime: StorageRuntime) {
  const groups = getBufferGroups(runtime)
  if (groups.length === 0) {
    return {
      slotted: false,
      slots: [],
      groups: [],
    } satisfies StorageVirtualState
  }

  return {
    slotted: true,
    slots: groups.flatMap((group) =>
      group.slots.map((slot) => ({
        slotIndex: slot.slotIndex,
        mode: slot.mode,
        pinnedItemId: slot.pinnedItemId,
        currentItemId: slot.currentItemId ?? null,
        amount: slot.amount,
        capacity: slot.capacity,
      })),
    ),
    groups: groups.map((group) => ({
      inPortIds: [...group.inPortIds],
      outPortIds: [...group.outPortIds],
      slotIndices: group.slots.map((slot) => slot.slotIndex),
    })),
  } satisfies StorageVirtualState
}

function storageSlotIndicesForInput(state: StorageVirtualState, toPortId: string) {
  const group = state.groups.find((entry) => entry.inPortIds.includes(toPortId))
  if (!group) return state.slots.map((slot) => slot.slotIndex).sort((left, right) => left - right)
  return [...group.slotIndices].sort((left, right) => left - right)
}

function storageSlotIndicesForOutput(state: StorageVirtualState, fromPortId: string) {
  const group = state.groups.find((entry) => entry.outPortIds.includes(fromPortId))
  if (!group) return state.slots.map((slot) => slot.slotIndex).sort((left, right) => left - right)
  return [...group.slotIndices].sort((left, right) => left - right)
}

function canStorageSlotAcceptItem(slot: StorageVirtualSlot, itemId: ItemId) {
  if (slot.amount >= slot.capacity) return false
  if (slot.mode === 'pinned') {
    if (!slot.pinnedItemId) return false
    if (slot.pinnedItemId !== itemId) return false
  }
  if (!slot.currentItemId) return true
  return slot.currentItemId === itemId
}

function reserveStorageInputSlot(state: StorageVirtualState, toPortId: string, itemId: ItemId) {
  const slotIndices = storageSlotIndicesForInput(state, toPortId)
  for (const slotIndex of slotIndices) {
    const slot = state.slots.find((entry) => entry.slotIndex === slotIndex)
    if (!slot || !canStorageSlotAcceptItem(slot, itemId)) continue
    slot.currentItemId = slot.currentItemId ?? itemId
    slot.amount += 1
    return slot.slotIndex
  }
  return null
}

function canStorageSlotOutput(state: StorageVirtualState, fromPortId: string, slotIndex: number, itemId: ItemId) {
  const allowedSlotIndices = storageSlotIndicesForOutput(state, fromPortId)
  if (!allowedSlotIndices.includes(slotIndex)) return false
  const slot = state.slots.find((entry) => entry.slotIndex === slotIndex)
  if (!slot || slot.amount <= 0 || !slot.currentItemId) return false
  return slot.currentItemId === itemId
}

function consumeStorageOutputSlot(state: StorageVirtualState, slotIndex: number) {
  const slot = state.slots.find((entry) => entry.slotIndex === slotIndex)
  if (!slot || slot.amount <= 0) return
  slot.amount = Math.max(0, slot.amount - 1)
  if (slot.amount === 0) slot.currentItemId = null
}

function createProcessorInputVirtualState(node: InternalNode, context: PlanContext): ProcessorInputVirtualSlot {
  const runtime = node.runtime as ProcessorRuntime
  const slotIndex = node.slotIndex ?? 0
  const itemId = runtime.inputSlotItems[slotIndex] ?? null
  const amount = itemId ? (runtime.inputBuffer[itemId] ?? 0) : 0
  return {
    slotIndex,
    currentItemId: itemId,
    lockedItem: itemId,
    amount,
    capacity: context.helpers.getProcessorInputSlotCapacity(node.device, node.runtime, slotIndex),
  }
}

function deleteNode(node: InternalNode, edgeById: Map<string, InternalEdge>) {
  if (node.deleted) return false
  node.deleted = true
  if (node.result === 'uncertain') node.result = 'solved-block'
  for (const edge of edgeById.values()) {
    if (edge.fromNode.nodeId === node.nodeId || edge.toNode.nodeId === node.nodeId) {
      edge.deleted = true
    }
  }
  return true
}

function deleteEdge(edge: InternalEdge) {
  if (edge.deleted) return false
  edge.deleted = true
  return true
}

function activeIncomingEdges(node: InternalNode, edgeById: Map<string, InternalEdge>) {
  return [...edgeById.values()].filter((edge) => !edge.deleted && edge.toNode.nodeId === node.nodeId && !edge.fromNode.deleted)
}

function activeOutgoingEdges(node: InternalNode, edgeById: Map<string, InternalEdge>) {
  return [...edgeById.values()].filter((edge) => !edge.deleted && edge.fromNode.nodeId === node.nodeId && !edge.toNode.deleted)
}

function trimProviderAndFreeEdges(nodes: InternalNode[], edgeById: Map<string, InternalEdge>) {
  for (const node of nodes) {
    if (node.deleted) continue
    if (node.baseState === 'provider') {
      for (const edge of activeIncomingEdges(node, edgeById)) {
        deleteEdge(edge)
      }
    }
    if ((node.kind === 'transport' || node.kind === 'bridge') && node.baseState === 'free') {
      for (const edge of activeOutgoingEdges(node, edgeById)) {
        deleteEdge(edge)
      }
    }
  }
}

function computeSccs(nodes: InternalNode[], edgeById: Map<string, InternalEdge>) {
  const activeNodes = nodes.filter((node) => !node.deleted)
  const adjacency = new Map<string, string[]>()
  const reverse = new Map<string, string[]>()

  for (const node of activeNodes) {
    adjacency.set(node.nodeId, [])
    reverse.set(node.nodeId, [])
  }

  for (const edge of edgeById.values()) {
    if (edge.deleted || edge.fromNode.deleted || edge.toNode.deleted) continue
    adjacency.get(edge.fromNode.nodeId)?.push(edge.toNode.nodeId)
    reverse.get(edge.toNode.nodeId)?.push(edge.fromNode.nodeId)
  }

  const visited = new Set<string>()
  const order: string[] = []
  const dfsOrder = (nodeId: string) => {
    if (visited.has(nodeId)) return
    visited.add(nodeId)
    for (const nextId of adjacency.get(nodeId) ?? []) dfsOrder(nextId)
    order.push(nodeId)
  }
  for (const node of activeNodes) dfsOrder(node.nodeId)

  visited.clear()
  const sccs: string[][] = []
  const dfsCollect = (nodeId: string, bucket: string[]) => {
    if (visited.has(nodeId)) return
    visited.add(nodeId)
    bucket.push(nodeId)
    for (const nextId of reverse.get(nodeId) ?? []) dfsCollect(nextId, bucket)
  }

  for (let index = order.length - 1; index >= 0; index -= 1) {
    const nodeId = order[index]
    if (visited.has(nodeId)) continue
    const bucket: string[] = []
    dfsCollect(nodeId, bucket)
    sccs.push(bucket)
  }

  return sccs
}

function eliminateCycles(nodes: InternalNode[], edgeById: Map<string, InternalEdge>) {
  let changed = false

  const deleteInternalEdgesWithExternalExit = () => {
    let localChanged = false
    const sccs = computeSccs(nodes, edgeById)
    for (const scc of sccs) {
      const memberSet = new Set(scc)
      const hasCycle = scc.length > 1 || [...edgeById.values()].some((edge) => !edge.deleted && edge.fromNode.nodeId === edge.toNode.nodeId && memberSet.has(edge.fromNode.nodeId))
      if (!hasCycle) continue
      for (const nodeId of scc) {
        const node = nodes.find((entry) => entry.nodeId === nodeId)
        if (!node || node.deleted) continue
        const outgoing = activeOutgoingEdges(node, edgeById)
        const internal = outgoing.filter((edge) => memberSet.has(edge.toNode.nodeId))
        const external = outgoing.filter((edge) => !memberSet.has(edge.toNode.nodeId))
        if (internal.length === 0 || external.length === 0) continue
        for (const edge of internal) {
          localChanged = deleteEdge(edge) || localChanged
        }
      }
    }
    return localChanged
  }

  changed = deleteInternalEdgesWithExternalExit() || changed
  const remaining = computeSccs(nodes, edgeById)
  for (const scc of remaining) {
    const memberSet = new Set(scc)
    const hasCycle = scc.length > 1 || [...edgeById.values()].some((edge) => !edge.deleted && edge.fromNode.nodeId === edge.toNode.nodeId && memberSet.has(edge.fromNode.nodeId))
    if (!hasCycle) continue
    for (const edge of edgeById.values()) {
      if (edge.deleted) continue
      if (memberSet.has(edge.fromNode.nodeId) && memberSet.has(edge.toNode.nodeId)) {
        changed = deleteEdge(edge) || changed
      }
    }
  }

  return changed
}

function pruneGraph(nodes: InternalNode[], edgeById: Map<string, InternalEdge>) {
  let changed = true
  while (changed) {
    changed = false
    trimProviderAndFreeEdges(nodes, edgeById)

    for (const node of nodes) {
      if (node.deleted) continue
      const incoming = activeIncomingEdges(node, edgeById)
      const outgoing = activeOutgoingEdges(node, edgeById)

      if (incoming.length === 0 && outgoing.length === 0) {
        changed = deleteNode(node, edgeById) || changed
        continue
      }
      if (node.baseState === 'free' && incoming.length === 0) {
        changed = deleteNode(node, edgeById) || changed
        continue
      }
      if (node.baseState === 'free' && incoming.length > 0 && incoming.every((edge) => edge.fromNode.baseState === 'free' || edge.fromNode.deleted)) {
        changed = deleteNode(node, edgeById) || changed
        continue
      }
      if ((node.baseState === 'shadow-pending' || node.baseState === 'provider') && outgoing.length === 0) {
        changed = deleteNode(node, edgeById) || changed
      }
    }
  }
}

function buildDevicePriorityMeta(context: PlanContext) {
  const receiverOrderByDevice = context.helpers.buildDevicePullInputPortOrderMap()
  const senderOutLinksByDevice = new Map<string, PortLink[]>()
  const senderMetaByLinkKey = new Map<string, Pick<InternalEdge, 'senderOutLinkCount' | 'senderPickedOutLinkIndex' | 'senderPriorityGroupKey' | 'senderPriorityGroup' | 'senderPriorityPortIndex' | 'senderPriorityPortCount'>>()
  const receiverMetaByDevicePort = new Map<string, Pick<InternalEdge, 'receiverPriorityGroup' | 'receiverPriorityPortIndex' | 'receiverPriorityPortCount'>>()

  for (const device of context.layoutDevices) {
    const runtime = context.runtimeById[device.instanceId]
    if (!runtime) continue

    const orderedOutLinks = context.helpers.orderedOutLinks(device, runtime, context.outMap.get(device.instanceId) ?? [])
    senderOutLinksByDevice.set(device.instanceId, orderedOutLinks)
    const allLiveOutLinks = context.outMap.get(device.instanceId) ?? []

    for (const link of orderedOutLinks) {
      const priorityGroup = getPortPriorityGroup(device.config, link.from.portId)
      const outputGroups = getBufferGroups(runtime)
      const outputGroup = outputGroups.find((group) => group.outPortIds.includes(link.from.portId))
      const outputPortIds = outputGroup?.outPortIds ?? getDirectionalPortIds(device.typeId, 'Output')
      const livePortIds = outputPortIds.filter((portId) => allLiveOutLinks.some((outLink) => outLink.from.portId === portId))
      const sameGroupPortIds = livePortIds.filter((portId) => getPortPriorityGroup(device.config, portId) === priorityGroup)
      senderMetaByLinkKey.set(buildPortLinkKey(link), {
        senderOutLinkCount: orderedOutLinks.length,
        senderPickedOutLinkIndex: orderedOutLinks.findIndex((entry) => buildPortLinkKey(entry) === buildPortLinkKey(link)),
        senderPriorityGroupKey: outputGroup?.id ?? (outputPortIds.length > 0 ? '__default__' : null),
        senderPriorityGroup: priorityGroup,
        senderPriorityPortIndex: Math.max(0, sameGroupPortIds.findIndex((portId) => portId === link.from.portId)),
        senderPriorityPortCount: sameGroupPortIds.length,
      })
    }

    const liveInputPorts = [...new Set((context.inMap.get(device.instanceId) ?? []).map((link) => link.to.portId))]
    const preferred = receiverOrderByDevice.get(device.instanceId) ?? []
    const orderedPorts = [...preferred.filter((portId) => liveInputPorts.includes(portId))]
    for (const portId of liveInputPorts) {
      if (!orderedPorts.includes(portId)) orderedPorts.push(portId)
    }

    for (const portId of orderedPorts) {
      const priorityGroup = getPortPriorityGroup(device.config, portId)
      const sameGroupPortIds = orderedPorts.filter((candidatePortId) => getPortPriorityGroup(device.config, candidatePortId) === priorityGroup)
      receiverMetaByDevicePort.set(`${device.instanceId}:${portId}`, {
        receiverPriorityGroup: priorityGroup,
        receiverPriorityPortIndex: Math.max(0, sameGroupPortIds.findIndex((candidatePortId) => candidatePortId === portId)),
        receiverPriorityPortCount: sameGroupPortIds.length,
      })
    }
  }

  return {
    senderMetaByLinkKey,
    receiverMetaByDevicePort,
  }
}

function buildNodes(context: PlanContext) {
  const nodes: InternalNode[] = []

  const createNode = (
    device: DeviceInstance,
    runtime: DeviceRuntime,
    localOrder: number,
    baseState: FlowNodeBaseState,
    kind: FlowNodeKind,
    options: Partial<FlowNodeSnapshot> = {},
  ) => {
    const node: InternalNode = {
      nodeId: options.nodeId ?? `${device.instanceId}:${kind}:${localOrder}`,
      deviceId: device.instanceId,
      kind,
      baseState,
      result: options.result ?? 'uncertain',
      deleted: options.deleted ?? false,
      lane: options.lane,
      slotIndex: options.slotIndex,
      maxInteractItems: options.maxInteractItems ?? 1,
      itemId: options.itemId ?? null,
      amount: options.amount ?? 0,
      capacity: options.capacity ?? null,
      device,
      runtime,
      deviceIndex: context.layoutDevices.findIndex((entry) => entry.instanceId === device.instanceId),
      localOrder,
    }
    nodes.push(node)
    return node
  }

  for (const device of context.layoutDevices) {
    const runtime = context.runtimeById[device.instanceId]
    if (!runtime || context.helpers.isHardBlockedStall(runtime.stallReason)) continue

    if (isStorageRuntime(runtime)) {
      const storageState = storageStateFromRuntime(runtime)
      const hasOutputPorts = getDirectionalPortIds(device.typeId, 'Output').length > 0
      const hasInputPorts = getDirectionalPortIds(device.typeId, 'Input').length > 0
      const slottedAmounts = storageState.slots.map((slot) => slot.amount)
      const totalAmount = storageState.slotted
        ? sumFiniteAmounts(slottedAmounts)
        : sumFiniteAmounts(Object.values(runtime.inventory ?? {}).map((amount) => amount ?? 0))

      let canProvide = false
      if (storageState.slotted) {
        canProvide = storageState.slots.some((slot) => slot.amount > 0 && slot.currentItemId)
      } else if (hasOutputPorts) {
        for (const portId of getDirectionalPortIds(device.typeId, 'Output')) {
          const prepared = context.helpers.prepareSourceLaneItem(
            device,
            runtime,
            'output',
            portId,
            context.lanesReachedHalfThisTick,
            new Set<string>(),
          )
          if (prepared.itemId) {
            canProvide = true
            break
          }
        }
      }

      const canReceive = storageState.slotted
        ? storageState.slots.some((slot) => slot.amount < slot.capacity)
        : hasInputPorts

      const baseState: FlowNodeBaseState = canProvide
        ? (canReceive ? 'shadow-pending' : 'provider')
        : 'free'

      createNode(device, runtime, 1, baseState, 'storage', {
        nodeId: `${device.instanceId}:storage`,
        amount: totalAmount,
        capacity: storageState.slotted ? sumFiniteAmounts(storageState.slots.map((slot) => slot.capacity)) : null,
        maxInteractItems: null,
      })
      continue
    }

    if (isProcessorRuntime(runtime)) {
      for (let slotIndex = 0; slotIndex < runtime.outputSlotItems.length; slotIndex += 1) {
        const itemId = runtime.outputSlotItems[slotIndex]
        const amount = itemId ? (runtime.outputBuffer[itemId] ?? 0) : 0
        createNode(device, runtime, slotIndex, 'provider', 'processor-output', {
          nodeId: `${device.instanceId}:processor-output:${slotIndex}`,
          slotIndex,
          itemId: itemId ?? null,
          amount,
          capacity: amount,
          maxInteractItems: amount,
          deleted: !itemId || amount <= 0,
          result: !itemId || amount <= 0 ? 'solved-block' : 'uncertain',
        })
      }

      for (let slotIndex = 0; slotIndex < runtime.inputSlotItems.length; slotIndex += 1) {
        const itemId = runtime.inputSlotItems[slotIndex] ?? null
        const amount = itemId ? (runtime.inputBuffer[itemId] ?? 0) : 0
        const capacity = context.helpers.getProcessorInputSlotCapacity(device, runtime, slotIndex)
        const remaining = Math.max(0, capacity - amount)
        createNode(device, runtime, 100 + slotIndex, 'free', 'processor-input', {
          nodeId: `${device.instanceId}:processor-input:${slotIndex}`,
          slotIndex,
          itemId,
          amount,
          capacity,
          maxInteractItems: remaining,
          deleted: remaining <= 0,
          result: remaining <= 0 ? 'solved-block' : 'uncertain',
        })
      }
      continue
    }

    if (context.helpers.isBridgeType(device.typeId)) {
      for (const lane of ['ns', 'we'] as const) {
        const slot = lane === 'ns' && 'nsSlot' in runtime
          ? runtime.nsSlot
          : lane === 'we' && 'weSlot' in runtime
            ? runtime.weSlot
            : null
        const baseState: FlowNodeBaseState = slot ? 'shadow-pending' : 'free'
        const deleted = Boolean(slot && slot.progress01 < 0.5)
        createNode(device, runtime, lane === 'ns' ? 1 : 2, baseState, 'bridge', {
          nodeId: `${device.instanceId}:${lane}`,
          lane,
          itemId: slot?.itemId ?? null,
          amount: slot ? 1 : 0,
          capacity: 1,
          maxInteractItems: 1,
          deleted,
          result: deleted ? 'solved-block' : 'uncertain',
        })
      }
      continue
    }

    if (isTransportBufferRuntime(runtime)) {
      const itemId = runtime.outputSlotItems.find((candidateItemId) => candidateItemId && (runtime.outputBuffer[candidateItemId] ?? 0) > 0) ?? null
      const hasReadyOutput = Boolean(itemId)
      const inProgress = Boolean(runtime.slot && runtime.slot.progress01 < 1 && !hasReadyOutput)
      createNode(device, runtime, 1, hasReadyOutput ? 'shadow-pending' : 'free', 'transport', {
        nodeId: `${device.instanceId}:transport`,
        lane: 'output',
        itemId,
        amount: hasReadyOutput ? 1 : 0,
        capacity: 1,
        maxInteractItems: 1,
        deleted: inProgress,
        result: inProgress ? 'solved-block' : 'uncertain',
      })
      continue
    }

    const slot = 'slot' in runtime ? runtime.slot : null
    const baseState: FlowNodeBaseState = slot ? 'shadow-pending' : 'free'
    const deleted = Boolean(slot && slot.progress01 < 0.5)
    createNode(device, runtime, 1, baseState, 'transport', {
      nodeId: `${device.instanceId}:transport`,
      lane: 'slot',
      itemId: slot?.itemId ?? null,
      amount: slot ? 1 : 0,
      capacity: 1,
      maxInteractItems: 1,
      deleted,
      result: deleted ? 'solved-block' : 'uncertain',
    })
  }

  return nodes.sort(compareNodeOrder)
}

function buildEdges(context: PlanContext, nodes: InternalNode[]) {
  const nodeByTransportLane = new Map<string, InternalNode>()
  const nodeByStorage = new Map<string, InternalNode>()
  const processorOutputNodesByDevice = new Map<string, InternalNode[]>()
  const processorInputNodesByDevice = new Map<string, InternalNode[]>()

  for (const node of nodes) {
    if ((node.kind === 'transport' || node.kind === 'bridge') && node.lane) {
      nodeByTransportLane.set(laneKey(node.deviceId, node.lane), node)
    }
    if (node.kind === 'storage') {
      nodeByStorage.set(node.deviceId, node)
    }
    if (node.kind === 'processor-output') {
      const existing = processorOutputNodesByDevice.get(node.deviceId)
      if (existing) existing.push(node)
      else processorOutputNodesByDevice.set(node.deviceId, [node])
    }
    if (node.kind === 'processor-input') {
      const existing = processorInputNodesByDevice.get(node.deviceId)
      if (existing) existing.push(node)
      else processorInputNodesByDevice.set(node.deviceId, [node])
    }
  }

  const { senderMetaByLinkKey, receiverMetaByDevicePort } = buildDevicePriorityMeta(context)
  const edges: InternalEdge[] = []

  for (const sourceDevice of context.layoutDevices) {
    const sourceRuntime = context.runtimeById[sourceDevice.instanceId]
    if (!sourceRuntime || context.helpers.isHardBlockedStall(sourceRuntime.stallReason)) continue
    const outLinks = context.outMap.get(sourceDevice.instanceId) ?? []
    for (const link of outLinks) {
      const linkKey = buildPortLinkKey(link)
      const senderMeta = senderMetaByLinkKey.get(linkKey)
      const receiverMeta = receiverMetaByDevicePort.get(`${link.to.instanceId}:${link.to.portId}`)
      if (!senderMeta || !receiverMeta) continue

      const fromNodes: InternalNode[] = []
      const toNodes: InternalNode[] = []

      const sourceStorage = nodeByStorage.get(link.from.instanceId)
      if (sourceStorage) {
        fromNodes.push(sourceStorage)
      } else {
        const sourceProcessorOutputs = processorOutputNodesByDevice.get(link.from.instanceId) ?? []
        if (sourceProcessorOutputs.length > 0) {
          fromNodes.push(...sourceProcessorOutputs)
        } else {
          const sourceLane = context.helpers.sourceSlotLane(sourceDevice, sourceRuntime, link.from.portId)
          const transportNode = nodeByTransportLane.get(laneKey(link.from.instanceId, sourceLane))
          if (transportNode) fromNodes.push(transportNode)
        }
      }

      const targetDevice = context.deviceById.get(link.to.instanceId)
      const targetRuntime = context.runtimeById[link.to.instanceId]
      if (!targetDevice || !targetRuntime) continue

      const targetStorage = nodeByStorage.get(link.to.instanceId)
      if (targetStorage) {
        toNodes.push(targetStorage)
      } else {
        const targetProcessorInputs = processorInputNodesByDevice.get(link.to.instanceId) ?? []
        if (targetProcessorInputs.length > 0) {
          toNodes.push(...targetProcessorInputs)
        } else {
          const receiveLane = context.helpers.receiveLaneForPort(targetDevice, targetRuntime, link.to.portId)
          const transportNode = receiveLane ? nodeByTransportLane.get(laneKey(link.to.instanceId, receiveLane)) : null
          if (transportNode) toNodes.push(transportNode)
        }
      }

      for (const fromNode of fromNodes) {
        for (const toNode of toNodes) {
          const edgeId = `${linkKey}:${fromNode.nodeId}->${toNode.nodeId}`
          edges.push({
            edgeId,
            portLinkKey: linkKey,
            fromNodeId: fromNode.nodeId,
            toNodeId: toNode.nodeId,
            fromId: link.from.instanceId,
            fromPortId: link.from.portId,
            fromLane: fromNode.lane ?? 'output',
            toId: link.to.instanceId,
            toPortId: link.to.portId,
            toLane: toNode.lane ?? 'output',
            shadowPull: 'uncertain',
            shadowPush: 'uncertain',
            deleted: fromNode.deleted || toNode.deleted,
            plannedItemId: null,
            fromOutputSlotIndex: fromNode.kind === 'processor-output' ? fromNode.slotIndex : undefined,
            fromStorageSlotIndex: undefined,
            toInputSlotIndex: toNode.kind === 'processor-input' ? toNode.slotIndex : undefined,
            toStorageSlotIndex: undefined,
            senderOutLinkCount: senderMeta.senderOutLinkCount,
            senderPickedOutLinkIndex: senderMeta.senderPickedOutLinkIndex,
            senderPriorityGroupKey: senderMeta.senderPriorityGroupKey,
            senderPriorityGroup: senderMeta.senderPriorityGroup,
            senderPriorityPortIndex: senderMeta.senderPriorityPortIndex,
            senderPriorityPortCount: senderMeta.senderPriorityPortCount,
            receiverPriorityGroup: receiverMeta.receiverPriorityGroup,
            receiverPriorityPortIndex: receiverMeta.receiverPriorityPortIndex,
            receiverPriorityPortCount: receiverMeta.receiverPriorityPortCount,
            fromNode,
            toNode,
          })
        }
      }
    }
  }

  return new Map(edges.map((edge) => [edge.edgeId, edge]))
}

function buildStorageStates(nodes: InternalNode[]) {
  const stateByNodeId = new Map<string, StorageVirtualState>()
  for (const node of nodes) {
    if (node.kind !== 'storage') continue
    stateByNodeId.set(node.nodeId, storageStateFromRuntime(node.runtime as StorageRuntime))
  }
  return stateByNodeId
}

function buildProcessorInputStates(nodes: InternalNode[], context: PlanContext) {
  const stateByDeviceId = new Map<string, ProcessorInputVirtualSlot[]>()
  for (const node of nodes) {
    if (node.kind !== 'processor-input') continue
    const existing = stateByDeviceId.get(node.deviceId)
    const slotState = createProcessorInputVirtualState(node, context)
    if (existing) existing.push(slotState)
    else stateByDeviceId.set(node.deviceId, [slotState])
  }
  for (const slotStates of stateByDeviceId.values()) {
    slotStates.sort((left, right) => left.slotIndex - right.slotIndex)
  }
  return stateByDeviceId
}

function sourceCandidatesForEdge(
  context: PlanContext,
  edge: InternalEdge,
  lanesAdvancedThisTick: Set<string>,
  storageStates: Map<string, StorageVirtualState>,
) {
  const fromNode = edge.fromNode
  if (fromNode.deleted) return [] as SourceCandidate[]

  if (fromNode.kind === 'bridge') {
    const slot = edge.fromLane === 'ns'
      ? ('nsSlot' in fromNode.runtime ? fromNode.runtime.nsSlot : null)
      : edge.fromLane === 'we'
        ? ('weSlot' in fromNode.runtime ? fromNode.runtime.weSlot : null)
        : null
    if (!slot) return []
    const requiredOutputEdge = OPPOSITE_EDGE[slot.enteredFrom]
    const outputEdge = edge.fromPortId.slice(-1).toUpperCase() as Edge
    if (requiredOutputEdge !== outputEdge) return []
  }

  if (fromNode.kind === 'storage') {
    const storageState = storageStates.get(fromNode.nodeId)
    if (storageState?.slotted) {
      const candidates: SourceCandidate[] = []
      for (const slotIndex of storageSlotIndicesForOutput(storageState, edge.fromPortId)) {
        const slot = storageState.slots.find((entry) => entry.slotIndex === slotIndex)
        if (!slot || !slot.currentItemId || slot.amount <= 0) continue
        if (!canStorageSlotOutput(storageState, edge.fromPortId, slotIndex, slot.currentItemId)) continue
        candidates.push({ itemId: slot.currentItemId, fromStorageSlotIndex: slot.slotIndex })
      }
      return candidates
    }
  }

  if (fromNode.kind === 'processor-output') {
    if (!fromNode.itemId) return []
    if (!context.helpers.canOutputItemToPort(fromNode.device, fromNode.runtime, edge.fromPortId, fromNode.itemId)) return []
    return [{ itemId: fromNode.itemId }]
  }

  const prepared = context.helpers.prepareSourceLaneItem(
    fromNode.device,
    fromNode.runtime,
    edge.fromLane,
    edge.fromPortId,
    context.lanesReachedHalfThisTick,
    lanesAdvancedThisTick,
  )
  if (!prepared.itemId) return []
  return [{ itemId: prepared.itemId }]
}

function canTransportReceiverAccept(
  context: PlanContext,
  edge: InternalEdge,
  itemId: ItemId,
  receivableShadowNodes: ReadonlySet<string>,
) {
  const clearSet = new Set<string>()
  if (edge.toNode.baseState === 'shadow-pending' && receivableShadowNodes.has(edge.toNode.nodeId) && edge.toNode.lane) {
    clearSet.add(`${edge.toNode.deviceId}:${edge.toNode.lane}`)
  }
  return context.helpers.canReceiveLaneForItem(edge.toNode.device, edge.toNode.runtime, edge.toPortId, clearSet, itemId) === edge.toLane
}

function canProcessorInputReceive(
  context: PlanContext,
  edge: InternalEdge,
  itemId: ItemId,
  processorStates: Map<string, ProcessorInputVirtualSlot[]>,
) {
  const slotIndex = edge.toNode.slotIndex
  if (typeof slotIndex !== 'number') return false
  const deviceSlots = processorStates.get(edge.toNode.deviceId) ?? []
  const targetSlot = deviceSlots.find((slot) => slot.slotIndex === slotIndex)
  if (!targetSlot) return false
  if (!context.helpers.canAcceptProcessorInputAtSlot(edge.toNode.device, edge.toNode.runtime, edge.toPortId, slotIndex, itemId, 1)) return false

  const lockedItem = targetSlot.lockedItem ?? targetSlot.currentItemId
  if (lockedItem && lockedItem !== itemId) return false
  if (!lockedItem && deviceSlots.some((slot) => slot.slotIndex !== slotIndex && (slot.lockedItem ?? slot.currentItemId) === itemId)) {
    return false
  }
  return targetSlot.amount + 1 <= targetSlot.capacity
}

function reserveProcessorInput(
  deviceId: string,
  slotIndex: number,
  itemId: ItemId,
  processorStates: Map<string, ProcessorInputVirtualSlot[]>,
) {
  const deviceSlots = processorStates.get(deviceId) ?? []
  const targetSlot = deviceSlots.find((slot) => slot.slotIndex === slotIndex)
  if (!targetSlot) return
  targetSlot.lockedItem = targetSlot.lockedItem ?? itemId
  targetSlot.currentItemId = targetSlot.currentItemId ?? itemId
  targetSlot.amount += 1
}

function nodeReceivesDuringPull(node: InternalNode, receivableShadowNodes: ReadonlySet<string>) {
  if (node.deleted) return false
  if (node.kind === 'storage') {
    return node.baseState === 'free' || node.baseState === 'shadow-pending'
  }
  if (node.kind === 'processor-input') return node.baseState === 'free'
  if (node.baseState === 'free') return true
  if ((node.kind === 'transport' || node.kind === 'bridge') && node.baseState === 'shadow-pending') {
    return receivableShadowNodes.has(node.nodeId)
  }
  return false
}

function resetDynamicState(nodes: InternalNode[], edgeById: Map<string, InternalEdge>) {
  for (const node of nodes) {
    if (!node.deleted) node.result = 'uncertain'
  }
  for (const edge of edgeById.values()) {
    if (edge.deleted) continue
    edge.shadowPull = 'uncertain'
    edge.shadowPush = 'uncertain'
    edge.plannedItemId = null
    edge.fromStorageSlotIndex = undefined
    edge.toStorageSlotIndex = undefined
  }
}

function selectShadowPull(
  context: PlanContext,
  nodes: InternalNode[],
  edgeById: Map<string, InternalEdge>,
  receivableShadowNodes: ReadonlySet<string>,
  lanesAdvancedThisTick: Set<string>,
  storageStates: Map<string, StorageVirtualState>,
) {
  const orderedNodes = [...nodes].sort(compareNodeOrder)

  for (const node of orderedNodes) {
    if (!nodeReceivesDuringPull(node, receivableShadowNodes)) continue
    const incoming = activeIncomingEdges(node, edgeById).sort(compareReceiverEdge)
    if (incoming.length === 0) continue

    if (node.kind === 'storage') {
      const storageState = storageStates.get(node.nodeId)
      if (!storageState) continue
      if (!storageState.slotted) {
        for (const edge of incoming) {
          if (edge.deleted) continue
          const sourceCandidates = sourceCandidatesForEdge(context, edge, lanesAdvancedThisTick, storageStates)
          if (sourceCandidates.length === 0) continue
          edge.shadowPull = 'accept'
        }
        continue
      }

      for (const edge of incoming) {
        if (edge.deleted) continue
        const sourceCandidates = sourceCandidatesForEdge(context, edge, lanesAdvancedThisTick, storageStates)
        if (sourceCandidates.length === 0) continue
        const candidate = sourceCandidates.find((entry) => reserveStorageInputSlot(storageState, edge.toPortId, entry.itemId) !== null)
        if (!candidate) continue
        const reservedSlotIndex = reserveStorageInputSlot(storageState, edge.toPortId, candidate.itemId)
        if (reservedSlotIndex === null) continue
        edge.shadowPull = 'accept'
        edge.plannedItemId = candidate.itemId
        edge.toStorageSlotIndex = reservedSlotIndex
      }
        continue
    }

    const capacity = Math.max(0, node.maxInteractItems ?? 0)
    if (capacity <= 0) continue
    let acceptedCount = 0
    for (const edge of incoming) {
      if (acceptedCount >= capacity) break
      const sourceCandidates = sourceCandidatesForEdge(context, edge, lanesAdvancedThisTick, storageStates)
      if (sourceCandidates.length === 0) continue
      const accepted = sourceCandidates.some((candidate) => {
        if (node.kind === 'processor-input') {
          return context.helpers.canAcceptProcessorInputAtSlot(node.device, node.runtime, edge.toPortId, node.slotIndex ?? 0, candidate.itemId, 1)
        }
        return canTransportReceiverAccept(context, edge, candidate.itemId, receivableShadowNodes)
      })
      if (!accepted) continue
      edge.shadowPull = 'accept'
      acceptedCount += 1
    }
  }
}

function selectShadowPush(
  context: PlanContext,
  nodes: InternalNode[],
  edgeById: Map<string, InternalEdge>,
  receivableShadowNodes: Set<string>,
  lanesAdvancedThisTick: Set<string>,
  storageStates: Map<string, StorageVirtualState>,
  processorStates: Map<string, ProcessorInputVirtualSlot[]>,
) {
  const orderedNodes = [...nodes].sort(compareNodeOrder)

  for (const node of orderedNodes) {
    if (node.deleted || node.baseState === 'free') continue
    const outgoing = activeOutgoingEdges(node, edgeById)
      .filter((edge) => edge.shadowPull === 'accept')
      .sort(compareEdgeKey)

    if (outgoing.length === 0) {
      node.result = 'solved-block'
      continue
    }

    let acceptedCount = 0
    const capacity = node.kind === 'storage'
      ? Number.POSITIVE_INFINITY
      : Math.max(0, node.maxInteractItems ?? 0)

    for (const edge of outgoing) {
      if (acceptedCount >= capacity) break
      const sourceCandidates = sourceCandidatesForEdge(context, edge, lanesAdvancedThisTick, storageStates)
      if (sourceCandidates.length === 0) continue

      const selectedCandidate = sourceCandidates.find((candidate) => {
        if (edge.toNode.kind === 'storage') {
          if (edge.toStorageSlotIndex === undefined && storageStates.get(edge.toNode.nodeId)?.slotted) return false
          if (edge.toStorageSlotIndex !== undefined && edge.plannedItemId && edge.plannedItemId !== candidate.itemId) return false
          return true
        }
        if (edge.toNode.kind === 'processor-input') {
          return canProcessorInputReceive(context, edge, candidate.itemId, processorStates)
        }
        return canTransportReceiverAccept(context, edge, candidate.itemId, receivableShadowNodes)
      })
      if (!selectedCandidate) continue

      edge.shadowPush = 'accept'
      edge.plannedItemId = selectedCandidate.itemId
      if (selectedCandidate.fromStorageSlotIndex !== undefined) {
        edge.fromStorageSlotIndex = selectedCandidate.fromStorageSlotIndex
      }

      if (node.kind === 'storage') {
        const storageState = storageStates.get(node.nodeId)
        if (storageState?.slotted && selectedCandidate.fromStorageSlotIndex !== undefined) {
          consumeStorageOutputSlot(storageState, selectedCandidate.fromStorageSlotIndex)
        }
      }

      if (edge.toNode.kind === 'processor-input' && typeof edge.toNode.slotIndex === 'number') {
        reserveProcessorInput(edge.toNode.deviceId, edge.toNode.slotIndex, selectedCandidate.itemId, processorStates)
      }

      acceptedCount += 1
    }

    if (acceptedCount > 0) {
      node.result = 'solved-run'
      if ((node.kind === 'transport' || node.kind === 'bridge') && node.baseState === 'shadow-pending') {
        receivableShadowNodes.add(node.nodeId)
      }
    } else {
      node.result = 'solved-block'
    }
  }

  for (const node of nodes) {
    if (node.deleted || node.result !== 'uncertain') continue
    const hasAcceptedIncoming = activeIncomingEdges(node, edgeById).some((edge) => edge.shadowPull === 'accept' && edge.shadowPush === 'accept')
    if (hasAcceptedIncoming) {
      node.result = 'solved-run'
    }
  }
}

function signatureForState(edgeById: Map<string, InternalEdge>, receivableShadowNodes: ReadonlySet<string>) {
  const acceptedPulls = [...edgeById.values()].filter((edge) => !edge.deleted && edge.shadowPull === 'accept').map((edge) => edge.edgeId).sort()
  const acceptedPushes = [...edgeById.values()].filter((edge) => !edge.deleted && edge.shadowPush === 'accept').map((edge) => edge.edgeId).sort()
  const receivable = [...receivableShadowNodes].sort()
  return JSON.stringify({ acceptedPulls, acceptedPushes, receivable })
}

function finalizeNodeResults(nodes: InternalNode[]) {
  for (const node of nodes) {
    if (node.deleted) {
      node.result = 'solved-block'
      continue
    }
    if (node.result === 'uncertain') node.result = 'solved-block'
  }
}

function buildTransferMatches(tick: number, edgeById: Map<string, InternalEdge>) {
  const transferMatches: TransferMatch[] = []
  let sequence = 0

  for (const edge of [...edgeById.values()].sort(compareEdgeKey)) {
    if (edge.deleted || edge.shadowPull !== 'accept' || edge.shadowPush !== 'accept' || !edge.plannedItemId) continue
    transferMatches.push({
      transferId: buildTransferId(tick, sequence),
      edgeId: edge.edgeId,
      portLinkKey: edge.portLinkKey,
      fromNodeId: edge.fromNodeId,
      fromNodeKind: edge.fromNode.kind,
      fromId: edge.fromId,
      fromPortId: edge.fromPortId,
      fromLane: edge.fromLane,
      fromOutputSlotIndex: edge.fromNode.kind === 'processor-output' ? edge.fromNode.slotIndex : edge.fromOutputSlotIndex,
      fromStorageSlotIndex: edge.fromStorageSlotIndex,
      toNodeId: edge.toNodeId,
      toNodeKind: edge.toNode.kind,
      toId: edge.toId,
      toPortId: edge.toPortId,
      toLane: edge.toLane,
      toInputSlotIndex: edge.toNode.kind === 'processor-input' ? edge.toNode.slotIndex : edge.toInputSlotIndex,
      toStorageSlotIndex: edge.toStorageSlotIndex,
      receiverCursorKey: `${edge.toId}:${edge.toLane}`,
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
    sequence += 1
  }

  return transferMatches
}

export function solvePullTransferMatches(context: PlanContext): PlanResult {
  const nodes = buildNodes(context)
  const edgeById = buildEdges(context, nodes)

  trimProviderAndFreeEdges(nodes, edgeById)
  eliminateCycles(nodes, edgeById)
  pruneGraph(nodes, edgeById)

  const lanesAdvancedThisTick = new Set<string>()
  const receivableShadowNodes = new Set<string>()
  let previousSignature = ''
  const maxIterations = Math.max(8, nodes.length + edgeById.size)

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    resetDynamicState(nodes, edgeById)
    const storageStates = buildStorageStates(nodes)
    selectShadowPull(context, nodes, edgeById, receivableShadowNodes, lanesAdvancedThisTick, storageStates)
    const processorStates = buildProcessorInputStates(nodes, context)
    selectShadowPush(context, nodes, edgeById, receivableShadowNodes, lanesAdvancedThisTick, storageStates, processorStates)
    finalizeNodeResults(nodes)

    const signature = signatureForState(edgeById, receivableShadowNodes)
    if (signature === previousSignature) break
    previousSignature = signature
  }

  finalizeNodeResults(nodes)
  const transferMatches = buildTransferMatches(context.tick, edgeById)

  return {
    transferMatches,
    plannedSenders: new Set(transferMatches.map((match) => match.fromId)),
    lanesAdvancedThisTick,
    nodeStates: nodes.map(({ device, runtime, deviceIndex, localOrder, ...node }) => node),
    edgeStates: [...edgeById.values()].map(({ fromNode, toNode, ...edge }) => edge),
  }
}