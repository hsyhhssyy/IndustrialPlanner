import type {
  CompiledSimulationDevice,
  CompiledSimulationNode,
  CompiledSimulationPort,
  CompiledSimulationTopology,
  SimulationAcceptRule,
  SimulationCountLimit,
} from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import {
  acceptsItem,
  canOutputSlotProvideItem,
  findInputSlotForItem,
  moveOneItem,
  resolveStorageSlotId,
} from "./runtime-slot-access";

interface SourceSelection {
  readonly sourceSlotId: string;
  readonly targetSlotId: string;
  readonly itemType: string;
}

/**
 * 对应《仿真运行原理》§5.3 Tick 阶段 3 与 §8 分层逆向求解。
 * 从可接收的 input-view Node 作为第 1 层锚点开始，先求解 input-view 产生
 * shadowPull，再沿入边向上游处理 output-view。严格物流设备在搜索过程中立即
 * 穿透处理，非严格物流设备则等待其 output-view 的所有下游 input-view 已遍历。
 */
export function solveTransferGraph(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  const visitedNodeIds = new Set<string>();
  let currentLayer = collectFirstLayerAnchors(topology, state, visitedNodeIds);

  while (currentLayer.length > 0) {
    const nextAnchors = new Map<string, CompiledSimulationNode>();

    for (const node of currentLayer) {
      processInputAnchor({
        topology,
        state,
        node,
        visitedNodeIds,
        nextAnchors,
      });
    }

    currentLayer = sortInputAnchors(
      topology,
      [...nextAnchors.values()].filter((node) => !visitedNodeIds.has(node.id)),
    );
  }
}

function collectFirstLayerAnchors(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  visitedNodeIds: ReadonlySet<string>,
): readonly CompiledSimulationNode[] {
  return sortInputAnchors(
    topology,
    topology.ordering.nodeOrder
      .map((nodeId) => topology.nodes[nodeId])
      .filter((node): node is CompiledSimulationNode =>
        node !== undefined
        && node.viewRole === "input-view"
        && !visitedNodeIds.has(node.id)
        && inputNodeHasAnyCapacity(topology, state, node),
      ),
  );
}

function processInputAnchor(options: {
  readonly topology: CompiledSimulationTopology;
  readonly state: SimulationMutableRuntimeState;
  readonly node: CompiledSimulationNode;
  readonly visitedNodeIds: Set<string>;
  readonly nextAnchors: Map<string, CompiledSimulationNode>;
}): void {
  if (options.visitedNodeIds.has(options.node.id)) {
    return;
  }

  solveInputNode(options.topology, options.state, options.node);
  markNodeVisited(options.state, options.visitedNodeIds, options.node);

  for (const edgeId of getOrderedInputEdgeIds(options.topology, options.state, options.node)) {
    const edge = options.topology.transferEdges[edgeId];
    const sourceNode = edge === undefined ? undefined : options.topology.nodes[edge.sourceNodeId];
    if (edge === undefined || sourceNode === undefined) {
      continue;
    }

    searchUpstreamFromOutputNode({
      topology: options.topology,
      state: options.state,
      outputNode: sourceNode,
      visitedNodeIds: options.visitedNodeIds,
      nextAnchors: options.nextAnchors,
    });
  }
}

function searchUpstreamFromOutputNode(options: {
  readonly topology: CompiledSimulationTopology;
  readonly state: SimulationMutableRuntimeState;
  readonly outputNode: CompiledSimulationNode;
  readonly visitedNodeIds: Set<string>;
  readonly nextAnchors: Map<string, CompiledSimulationNode>;
}): void {
  if (options.outputNode.viewRole !== "output-view" || options.visitedNodeIds.has(options.outputNode.id)) {
    return;
  }

  const device = options.topology.devices[options.outputNode.deviceId];
  if (device === undefined) {
    return;
  }

  if (isStrictLogisticsDevice(device)) {
    solveOutputNode(options.topology, options.state, options.outputNode);
    markNodeVisited(options.state, options.visitedNodeIds, options.outputNode);

    const inputNode = getDeviceInputViewNodes(options.topology, device)[0];
    if (inputNode === undefined || options.visitedNodeIds.has(inputNode.id)) {
      return;
    }

    solveInputNode(options.topology, options.state, inputNode);
    markNodeVisited(options.state, options.visitedNodeIds, inputNode);
    for (const edgeId of getOrderedInputEdgeIds(options.topology, options.state, inputNode)) {
      const edge = options.topology.transferEdges[edgeId];
      const sourceNode = edge === undefined ? undefined : options.topology.nodes[edge.sourceNodeId];
      if (sourceNode !== undefined) {
        searchUpstreamFromOutputNode({
          topology: options.topology,
          state: options.state,
          outputNode: sourceNode,
          visitedNodeIds: options.visitedNodeIds,
          nextAnchors: options.nextAnchors,
        });
      }
    }
    return;
  }

  if (!allDownstreamInputNodesVisited(options.topology, options.outputNode, options.visitedNodeIds)) {
    return;
  }

  solveOutputNode(options.topology, options.state, options.outputNode);
  markNodeVisited(options.state, options.visitedNodeIds, options.outputNode);

  for (const inputNode of getDeviceInputViewNodes(options.topology, device)) {
    if (!options.visitedNodeIds.has(inputNode.id)) {
      options.nextAnchors.set(inputNode.id, inputNode);
    }
  }
}

function solveOutputNode(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
): void {
  let moved = true;
  while (moved) {
    moved = false;
    for (const edgeId of getOrderedOutputEdgeIds(topology, state, node)) {
      const edge = topology.transferEdges[edgeId];
      const edgeState = state.transient.edges[edgeId];
      if (edge === undefined || edgeState === undefined || edgeState.shadowPull !== "accept") {
        continue;
      }
      if (edgeState.currentThroughCount >= resolvePerTickLimit(edge.count)) {
        continue;
      }
      if (edgeState.sourceSlotId === null || edgeState.targetSlotId === null || edgeState.itemType === null) {
        continue;
      }

      const ok = moveOneItem({
        topology,
        state,
        sourceSlotId: edgeState.sourceSlotId,
        targetSlotId: edgeState.targetSlotId,
        itemType: edgeState.itemType,
      });
      if (!ok) {
        continue;
      }

      edgeState.shadowPush = "accept";
      edgeState.amount += 1;
      edgeState.currentThroughCount += 1;
      edgeState.shadowPull = "moved";
      edgeState.shadowPush = "moved";
      pushUnique(state.transient.nodes[node.id]?.acceptedOutputEdgeIds, edgeId);
      state.transient.transfers.push({
        edgeId,
        sourceSlotId: edgeState.sourceSlotId,
        targetSlotId: edgeState.targetSlotId,
        itemType: edgeState.itemType,
        amount: 1,
      });

      const targetNode = topology.nodes[edge.targetNodeId];
      if (targetNode !== undefined) {
        solveInputNode(topology, state, targetNode);
      }
      moved = true;
    }
  }
}

function solveInputNode(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
): void {
  const nodeState = state.transient.nodes[node.id];
  if (nodeState === undefined) {
    return;
  }

  for (const edgeId of getOrderedInputEdgeIds(topology, state, node)) {
    const edge = topology.transferEdges[edgeId];
    const edgeState = state.transient.edges[edgeId];
    if (edge === undefined || edgeState === undefined || edgeState.currentThroughCount >= resolvePerTickLimit(edge.count)) {
      continue;
    }

    const sourceNode = topology.nodes[edge.sourceNodeId];
    if (sourceNode === undefined) {
      continue;
    }

    const selection = selectAcceptedSourceForEdge({
      topology,
      state,
      sourceNode,
      targetNode: node,
      acceptRule: edge.acceptRule,
    });
    if (selection === null) {
      continue;
    }

    edgeState.shadowPull = "accept";
    edgeState.sourceSlotId = selection.sourceSlotId;
    edgeState.targetSlotId = selection.targetSlotId;
    edgeState.itemType = selection.itemType;
    nodeState.result = "solved-run";
    pushUnique(nodeState.acceptedInputEdgeIds, edgeId);
  }

  if (nodeState.result === "uncertain") {
    nodeState.result = "solved-block";
  }
}

function selectAcceptedSourceForEdge(options: {
  readonly topology: CompiledSimulationTopology;
  readonly state: SimulationMutableRuntimeState;
  readonly sourceNode: CompiledSimulationNode;
  readonly targetNode: CompiledSimulationNode;
  readonly acceptRule: SimulationAcceptRule;
}): SourceSelection | null {
  for (const sourceSlotId of getReadableSourceSlotIds(options.state, options.sourceNode)) {
    const slot = options.topology.slots[sourceSlotId];
    const storageSlotId = resolveStorageSlotId(options.state, sourceSlotId);
    const itemType = options.state.persistent.slots[storageSlotId]?.itemType ?? slot?.lock ?? null;
    if (slot === undefined || itemType === null || !acceptsItem(options.topology, options.acceptRule, itemType)) {
      continue;
    }
    if (!canOutputSlotProvideItem({
      topology: options.topology,
      state: options.state,
      sourceSlotId,
      itemType,
    })) {
      continue;
    }

    const targetSlotId = findInputSlotForItem({
      topology: options.topology,
      state: options.state,
      node: options.targetNode,
      itemType,
    });
    if (targetSlotId !== null) {
      return { sourceSlotId, targetSlotId, itemType };
    }
  }

  return null;
}

function inputNodeHasAnyCapacity(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
): boolean {
  for (const slotId of node.slotIds) {
    const slot = topology.slots[slotId];
    const storageSlotId = resolveStorageSlotId(state, slotId);
    const slotState = state.persistent.slots[storageSlotId];
    if (slot === undefined || slotState === undefined) {
      continue;
    }

    const sharedSlotIds = state.persistent.sharedCapacitySlotIdsBySlotId[slotId];
    if (sharedSlotIds === undefined) {
      if (slotState.count < slot.capacity) {
        return true;
      }
      continue;
    }

    const occupiedStorageSlotIds = new Set<string>();
    let occupied = 0;
    for (const sharedSlotId of sharedSlotIds) {
      const sharedStorageSlotId = resolveStorageSlotId(state, sharedSlotId);
      if (occupiedStorageSlotIds.has(sharedStorageSlotId)) {
        continue;
      }
      occupiedStorageSlotIds.add(sharedStorageSlotId);
      occupied += state.persistent.slots[sharedStorageSlotId]?.count ?? 0;
    }
    if (occupied < (state.persistent.sharedCapacityLimitBySlotId[slotId] ?? slot.capacity)) {
      return true;
    }
  }
  return false;
}

function allDownstreamInputNodesVisited(
  topology: CompiledSimulationTopology,
  outputNode: CompiledSimulationNode,
  visitedNodeIds: ReadonlySet<string>,
): boolean {
  for (const edgeId of getRawOutputEdgeIds(topology, outputNode)) {
    const targetNodeId = topology.transferEdges[edgeId]?.targetNodeId;
    if (targetNodeId !== undefined && !visitedNodeIds.has(targetNodeId)) {
      return false;
    }
  }
  return true;
}

function getDeviceInputViewNodes(
  topology: CompiledSimulationTopology,
  device: CompiledSimulationDevice,
): readonly CompiledSimulationNode[] {
  return device.nodeIds
    .map((nodeId) => topology.nodes[nodeId])
    .filter((node): node is CompiledSimulationNode => node !== undefined && node.viewRole === "input-view")
    .sort((left, right) => left.groupOrder - right.groupOrder);
}

function isStrictLogisticsDevice(device: CompiledSimulationDevice): boolean {
  return device.transportClass === "strict-belt" || device.transportClass === "strict-pipe";
}

function getReadableSourceSlotIds(
  state: SimulationMutableRuntimeState,
  sourceNode: CompiledSimulationNode,
): readonly string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const slotId of sourceNode.slotIds) {
    const readableSlotIds = state.persistent.sharedCapacitySlotIdsBySlotId[slotId] ?? [slotId];
    for (const readableSlotId of readableSlotIds) {
      if (!seen.has(readableSlotId)) {
        seen.add(readableSlotId);
        result.push(readableSlotId);
      }
    }
  }
  return result;
}

function markNodeVisited(
  state: SimulationMutableRuntimeState,
  visitedNodeIds: Set<string>,
  node: CompiledSimulationNode,
): void {
  visitedNodeIds.add(node.id);
  const nodeState = state.transient.nodes[node.id];
  if (nodeState !== undefined) {
    nodeState.visited = true;
  }
}

function sortInputAnchors(
  topology: CompiledSimulationTopology,
  nodes: readonly CompiledSimulationNode[],
): readonly CompiledSimulationNode[] {
  return [...nodes].sort((left, right) => {
    const deviceOrder = topology.ordering.deviceOrder.indexOf(right.deviceId)
      - topology.ordering.deviceOrder.indexOf(left.deviceId);
    if (deviceOrder !== 0) {
      return deviceOrder;
    }
    return left.groupOrder - right.groupOrder;
  });
}

function resolvePerTickLimit(count: SimulationCountLimit): number {
  return count === "unlimited" ? Number.MAX_SAFE_INTEGER : count;
}

function getOrderedInputEdgeIds(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
): readonly string[] {
  return getOrderedEdgeIdsForPorts({
    topology,
    state,
    portIds: node.inputPortIds,
    edgeSelector: getPortInputEdgeIds,
  });
}

function getOrderedOutputEdgeIds(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
): readonly string[] {
  return getOrderedEdgeIdsForPorts({
    topology,
    state,
    portIds: node.outputPortIds,
    edgeSelector: getPortOutputEdgeIds,
  });
}

function getOrderedEdgeIdsForPorts(options: {
  readonly topology: CompiledSimulationTopology;
  readonly state: SimulationMutableRuntimeState;
  readonly portIds: readonly string[];
  readonly edgeSelector: (topology: CompiledSimulationTopology, portId: string) => readonly string[];
}): readonly string[] {
  return getOrderedPorts(options.topology, options.state, options.portIds)
    .flatMap((port) => options.edgeSelector(options.topology, port.id));
}

function getOrderedPorts(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  portIds: readonly string[],
): readonly CompiledSimulationPort[] {
  const ports = portIds
    .map((portId) => topology.ports[portId])
    .filter((port): port is CompiledSimulationPort => port !== undefined)
    .sort(comparePortsForRouting);
  const priorityGroups = [...new Set(ports.map((port) => port.priorityGroup))].sort((left, right) => left - right);
  const ordered: CompiledSimulationPort[] = [];
  for (const priorityGroup of priorityGroups) {
    const groupPorts = ports.filter((port) => port.priorityGroup === priorityGroup);
    const cursor = state.persistent.routingCursors[getRoutingCursorGroupKey(groupPorts[0])] ?? 0;
    const normalizedCursor = groupPorts.length === 0 ? 0 : ((cursor % groupPorts.length) + groupPorts.length) % groupPorts.length;
    ordered.push(...groupPorts.slice(normalizedCursor), ...groupPorts.slice(0, normalizedCursor));
  }
  return ordered;
}

function comparePortsForRouting(left: CompiledSimulationPort, right: CompiledSimulationPort): number {
  return left.priorityGroup - right.priorityGroup
    || left.roundRobinSeed - right.roundRobinSeed
    || left.order - right.order
    || left.id.localeCompare(right.id);
}

function getRoutingCursorGroupKey(port: CompiledSimulationPort | undefined): string {
  if (port === undefined) {
    return "unknown";
  }
  return `${port.deviceId}:${port.portGroupId}:${port.direction}:priority-${port.priorityGroup}`;
}

function getRawOutputEdgeIds(topology: CompiledSimulationTopology, node: CompiledSimulationNode): readonly string[] {
  return node.outputPortIds.flatMap((portId) => getPortOutputEdgeIds(topology, portId));
}

function getPortInputEdgeIds(topology: CompiledSimulationTopology, portId: string): readonly string[] {
  return topology.ordering.edgeOrder.filter((edgeId) => topology.transferEdges[edgeId]?.targetPortId === portId);
}

function getPortOutputEdgeIds(topology: CompiledSimulationTopology, portId: string): readonly string[] {
  return topology.ordering.edgeOrder.filter((edgeId) => topology.transferEdges[edgeId]?.sourcePortId === portId);
}

function pushUnique(values: string[] | undefined, value: string): void {
  if (values !== undefined && !values.includes(value)) {
    values.push(value);
  }
}
