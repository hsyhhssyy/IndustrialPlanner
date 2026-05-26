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
import { canDeviceTransferAtCurrentPhase } from "./phase-gating";

// AI-REMOVED 2026-05-17:
// Reason: TickPerfStage3Details 未在本文件使用，保留 import 会阻断 lint。
// Trigger: REQ-078 验收运行定向 eslint 时暴露 unused import。
// Evidence: rg 仅命中本文件 import 行，无有效引用。
// Replacement: SolveTransferGraphPerf 作为本文件内部 perf 输入类型。
// Risk: Low
// Human Review: Required
//
// Original code:
// TickPerfStage3Details,

interface SourceSelection {
  readonly sourceSlotId: string;
  readonly targetSlotId: string;
  readonly itemType: string;
}

/** Stage 3 内部分段计时累加器，perfEnabled 时由 createNextTickSnapshot 注入。 */
export interface SolveTransferGraphPerf {
  layerCount: number;
  anchorCount: number;
  outputNodeCount: number;
  moveCount: number;
  refreshBlockedMs: number;
  refreshBlockedCalls: number;
}

/**
 * 对应《仿真运行原理》§5.3 Tick 阶段 3 与 §8 分层逆向求解。
 * 从可接收的 input-view Node 作为第 1 层锚点开始，先求解 input-view 产生
 * shadowPull，再沿入边向上游处理 output-view。严格物流设备在搜索过程中立即
 * 穿透处理，非严格物流设备则等待其 output-view 的所有下游 input-view 已遍历。
 * 订正（2026-05-08）：非严格 output-view 等待的是所有下游 input-view 已求解完成；
 * 无容量的 input-view 会标记为 blocked-resolved，不再误阻塞同 output-view 的其他出口。
 */
export function solveTransferGraph(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  perf?: SolveTransferGraphPerf,
): void {
  let currentLayer = collectFirstLayerAnchors(topology, state);

  while (currentLayer.length > 0) {
    if (perf !== undefined) perf.layerCount += 1;

    const nextAnchors = new Map<string, CompiledSimulationNode>();

    for (const node of currentLayer) {
      if (perf !== undefined) perf.anchorCount += 1;
      processInputAnchor({
        topology,
        state,
        node,
        nextAnchors,
        perf,
      });
    }

    currentLayer = collectAvailableInputAnchors(
      topology,
      state,
      [...nextAnchors.values()],
    );
  }
}

function collectFirstLayerAnchors(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): readonly CompiledSimulationNode[] {
  return collectAvailableInputAnchors(
    topology,
    state,
    topology.ordering.nodeOrder.map((nodeId) => topology.nodes[nodeId]),
  );
}

function processInputAnchor(options: {
  readonly topology: CompiledSimulationTopology;
  readonly state: SimulationMutableRuntimeState;
  readonly node: CompiledSimulationNode;
  readonly nextAnchors: Map<string, CompiledSimulationNode>;
  readonly perf?: SolveTransferGraphPerf;
}): void {
  if (isNodeVisited(options.state, options.node)) {
    return;
  }

  if (!prepareInputNodeForProcessing(options.topology, options.state, options.node)) {
    return;
  }

  solveInputNode(options.topology, options.state, options.node);
  markNodeVisited(options.state, options.node);

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
      nextAnchors: options.nextAnchors,
      perf: options.perf,
    });
  }
}

function searchUpstreamFromOutputNode(options: {
  readonly topology: CompiledSimulationTopology;
  readonly state: SimulationMutableRuntimeState;
  readonly outputNode: CompiledSimulationNode;
  readonly nextAnchors: Map<string, CompiledSimulationNode>;
  readonly perf?: SolveTransferGraphPerf;
}): void {
  if (options.outputNode.viewRole !== "output-view" || isNodeVisited(options.state, options.outputNode)) {
    return;
  }

  const device = options.topology.devices[options.outputNode.deviceId];
  if (device === undefined) {
    return;
  }

  if (isStrictLogisticsDevice(device)) {
    if (!canDeviceTransferAtCurrentPhase(options.topology, options.state, device)) {
      return;
    }

    const outputMoved = solveOutputNode(options.topology, options.state, options.outputNode, options.nextAnchors, options.perf);
    if (outputMoved) {
      markNodeVisited(options.state, options.outputNode);
    }

    const inputNode = getDeviceInputViewNodes(options.topology, device)[0];
    if (inputNode === undefined || isNodeVisited(options.state, inputNode)) {
      return;
    }
    if (!prepareInputNodeForProcessing(options.topology, options.state, inputNode)) {
      return;
    }

    solveInputNode(options.topology, options.state, inputNode);
    markNodeVisited(options.state, inputNode);
    for (const edgeId of getOrderedInputEdgeIds(options.topology, options.state, inputNode)) {
      const edge = options.topology.transferEdges[edgeId];
      const sourceNode = edge === undefined ? undefined : options.topology.nodes[edge.sourceNodeId];
      if (sourceNode !== undefined) {
        searchUpstreamFromOutputNode({
          topology: options.topology,
          state: options.state,
          outputNode: sourceNode,
          nextAnchors: options.nextAnchors,
          perf: options.perf,
        });
      }
    }
    return;
  }

  if (!allDownstreamInputNodesResolved(options.topology, options.state, options.outputNode)) {
    return;
  }

  solveOutputNode(options.topology, options.state, options.outputNode, options.nextAnchors, options.perf);
  markNodeVisited(options.state, options.outputNode);

  for (const inputNode of getDeviceInputViewNodes(options.topology, device)) {
    if (prepareInputNodeForAnchor(options.topology, options.state, inputNode)) {
      options.nextAnchors.set(inputNode.id, inputNode);
    }
  }
}

function solveOutputNode(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
  nextAnchors: Map<string, CompiledSimulationNode>,
  perf?: SolveTransferGraphPerf,
): boolean {
  if (perf !== undefined) perf.outputNodeCount += 1;

  let movedAny = false;
  let moved = true;
  while (moved) {
    moved = false;
    for (const edgeId of getOrderedOutputEdgeIds(topology, state, node)) {
      const slotPerf = state.transient._perf;
      if (slotPerf !== undefined) { slotPerf.solveOutputEdgeChecks += 1; }

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

      if (perf !== undefined) perf.moveCount += 1;

      movedAny = true;
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

      const tRefresh = perf !== undefined ? performance.now() : 0;
      refreshBlockedInputNodesAfterMove(topology, state, nextAnchors);
      if (perf !== undefined) {
        perf.refreshBlockedMs += performance.now() - tRefresh;
        perf.refreshBlockedCalls += 1;
      }

      const targetNode = topology.nodes[edge.targetNodeId];
      if (targetNode !== undefined) {
        solveInputNode(topology, state, targetNode);
      }
      moved = true;
    }
  }
  return movedAny;
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
  const perf = options.state.transient._perf;
  if (perf !== undefined) { perf.selectSourceCalls += 1; }

  for (const sourceSlotId of getReadableSourceSlotIds(options.sourceNode)) {
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

function allDownstreamInputNodesResolved(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  outputNode: CompiledSimulationNode,
): boolean {
  for (const edgeId of getRawOutputEdgeIds(topology, outputNode)) {
    const targetNodeId = topology.transferEdges[edgeId]?.targetNodeId;
    const targetNode = targetNodeId === undefined ? undefined : topology.nodes[targetNodeId];
    if (targetNode !== undefined && !isInputNodeResolved(state, targetNode)) {
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
  sourceNode: CompiledSimulationNode,
): readonly string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const slotId of sourceNode.slotIds) {
    if (!seen.has(slotId)) {
      seen.add(slotId);
      result.push(slotId);
    }
  }
  return result;
}

function collectAvailableInputAnchors(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  maybeNodes: readonly (CompiledSimulationNode | undefined)[],
): readonly CompiledSimulationNode[] {
  const anchors: CompiledSimulationNode[] = [];
  for (const node of maybeNodes) {
    if (node === undefined || node.viewRole !== "input-view") {
      continue;
    }
    // 无入边端口的 input-view 永远无法通过传输接收物品，求解无意义。
    // 跳过不计入 blockedInputNodeIds —— 它不可能被上游传输激活。
    if (node.inputPortIds.length === 0) {
      continue;
    }
    if (prepareInputNodeForAnchor(topology, state, node)) {
      anchors.push(node);
    }
  }
  return sortInputAnchors(topology, anchors);
}

function prepareInputNodeForAnchor(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
): boolean {
  if (node.viewRole !== "input-view" || isNodeVisited(state, node)) {
    return false;
  }
  if (inputNodeCanAcceptAtCurrentTick(topology, state, node)) {
    markInputNodeUnresolved(state, node);
    return true;
  }
  markInputNodeBlocked(state, node);
  return false;
}

function prepareInputNodeForProcessing(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
): boolean {
  return prepareInputNodeForAnchor(topology, state, node);
}

function refreshBlockedInputNodesAfterMove(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  nextAnchors: Map<string, CompiledSimulationNode>,
): void {
  const blockedIds = state.transient.blockedInputNodeIds;
  if (blockedIds.size === 0) return;

  const reactivated: string[] = [];
  for (const nodeId of blockedIds) {
    const node = topology.nodes[nodeId];
    const nodeState = node === undefined ? undefined : state.transient.nodes[node.id];
    if (node === undefined || node.viewRole !== "input-view" || nodeState?.resolveState !== "blocked-resolved") {
      reactivated.push(nodeId);
      continue;
    }
    if (inputNodeCanAcceptAtCurrentTick(topology, state, node)) {
      markInputNodeUnresolved(state, node);
      nextAnchors.set(node.id, node);
    }
  }

  for (const nodeId of reactivated) {
    blockedIds.delete(nodeId);
  }
}

function isNodeVisited(
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
): boolean {
  return state.transient.nodes[node.id]?.resolveState === "visited";
}

function isInputNodeResolved(
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
): boolean {
  const resolveState = state.transient.nodes[node.id]?.resolveState ?? "unresolved";
  return resolveState === "visited" || resolveState === "blocked-resolved";
}

function markInputNodeBlocked(
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
): void {
  const nodeState = state.transient.nodes[node.id];
  if (nodeState === undefined || nodeState.resolveState === "visited") {
    return;
  }
  nodeState.resolveState = "blocked-resolved";
  state.transient.blockedInputNodeIds.add(node.id);
  if (nodeState.result === "uncertain") {
    nodeState.result = "solved-block";
  }
}

function markInputNodeUnresolved(
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
): void {
  const nodeState = state.transient.nodes[node.id];
  if (nodeState === undefined || nodeState.resolveState !== "blocked-resolved") {
    return;
  }
  nodeState.resolveState = "unresolved";
  nodeState.result = "uncertain";
  nodeState.blockReason = undefined;
  state.transient.blockedInputNodeIds.delete(node.id);
}

function markNodeVisited(
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
): void {
  const nodeState = state.transient.nodes[node.id];
  if (nodeState !== undefined) {
    nodeState.resolveState = "visited";
    state.transient.blockedInputNodeIds.delete(node.id);
  }
}

function inputNodeCanAcceptAtCurrentTick(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
): boolean {
  const device = topology.devices[node.deviceId];
  if (device !== undefined && !canDeviceTransferAtCurrentPhase(topology, state, device)) {
    return false;
  }

  return inputNodeHasAnyCapacity(topology, state, node);
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
  }).filter((edgeId) => topology.transferEdges[edgeId]?.targetNodeId === node.id);
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
  }).filter((edgeId) => topology.transferEdges[edgeId]?.sourceNodeId === node.id);
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
  return node.outputPortIds
    .flatMap((portId) => getPortOutputEdgeIds(topology, portId))
    .filter((edgeId) => topology.transferEdges[edgeId]?.sourceNodeId === node.id);
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
