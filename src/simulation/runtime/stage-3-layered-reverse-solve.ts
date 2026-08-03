import {
  incrementFixedWindowCounterForCurrentWindow,
  readAdmissionOutputRemainingAllowance,
  readAdmissionRateWindowRemainingAllowance,
  type SimulationMutableRuntimeState,
} from "./runtime-state";
import type {
  CompiledSimulationDevice,
  CompiledSimulationNode,
  CompiledSimulationPort,
  CompiledSimulationTopology,
  SimulationAcceptRule,
} from "../types";
import {
  acceptsItem,
  canOutputSlotProvideItem,
  findInputSlotForItem,
  moveOneItem,
  resolveStorageSlotId,
} from "./runtime-slot-access";
import { canDeviceTransferAtCurrentPhase } from "./phase-gating";
import type { RegistryContract } from "@/domain/registry/registry-contract";

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
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  perf?: SolveTransferGraphPerf,
): void {
  let currentLayer = collectFirstLayerAnchors(registry, topology, state);

  while (currentLayer.length > 0) {
    if (perf !== undefined) perf.layerCount += 1;

    const nextAnchors = new Map<string, CompiledSimulationNode>();

    for (const node of currentLayer) {
      if (perf !== undefined) perf.anchorCount += 1;
      processInputAnchor({
        registry,
        topology,
        state,
        node,
        nextAnchors,
        perf,
      });
    }

    currentLayer = collectAvailableInputAnchors(
      registry,
      topology,
      state,
      [...nextAnchors.values()],
    );
  }
}

/**
 * 撤销给定 input-view 上游所有非严格设备 output-view 的 visited 状态。
 * 当下游 blocked input-view 被重新激活时调用，确保上游 output-view
 * 在后续锚点处理中不会被 isNodeVisited 跳过。
 */
function unvisitUpstreamNonStrictOutputViews(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  inputNode: CompiledSimulationNode,
  nextAnchors: Map<string, CompiledSimulationNode>,
): void {
  for (const edgeId of getOrderedInputEdgeIds(topology, state, inputNode)) {
    const edge = topology.transferEdges[edgeId];
    const sourceNode = edge === undefined ? undefined : topology.nodes[edge.sourceNodeId];
    if (sourceNode === undefined || sourceNode.viewRole !== "output-view") {
      continue;
    }
    const device = topology.devices[sourceNode.deviceId];
    if (device === undefined || isStrictLogisticsDevice(device)) {
      continue;
    }
    const nodeState = state.transient.nodes[sourceNode.id];
    if (nodeState !== undefined && nodeState.resolveState === "visited") {
      nodeState.resolveState = "unresolved";
      // 撤销 visited 后，将非严格设备的 input-view 加入下一层锚点，
      // 确保本层遍历即可通过 processInputAnchor → searchUpstreamFromOutputNode
      // 重新进入该设备处理。
      for (const inputNode of getDeviceInputViewNodes(topology, device)) {
        if (prepareInputNodeForAnchor(registry, topology, state, inputNode)) {
          nextAnchors.set(inputNode.id, inputNode);
        }
      }
    }
  }
}

function collectFirstLayerAnchors(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): readonly CompiledSimulationNode[] {
  return collectAvailableInputAnchors(
    registry,
    topology,
    state,
    topology.ordering.nodeOrder.map((nodeId) => topology.nodes[nodeId]),
  );
}

function processInputAnchor(options: {
  readonly registry: RegistryContract;
  readonly topology: CompiledSimulationTopology;
  readonly state: SimulationMutableRuntimeState;
  readonly node: CompiledSimulationNode;
  readonly nextAnchors: Map<string, CompiledSimulationNode>;
  readonly perf?: SolveTransferGraphPerf;
}): void {
  if (isNodeVisited(options.state, options.node)) {
    return;
  }

  if (!prepareInputNodeForProcessing(options.registry, options.topology, options.state, options.node)) {
    return;
  }

  solveInputNode(options.registry, options.topology, options.state, options.node);
  markNodeVisited(options.state, options.node);

  for (const edgeId of getOrderedInputEdgeIds(options.topology, options.state, options.node)) {
    const edge = options.topology.transferEdges[edgeId];
    const sourceNode = edge === undefined ? undefined : options.topology.nodes[edge.sourceNodeId];
    if (edge === undefined || sourceNode === undefined) {
      continue;
    }

    searchUpstreamFromOutputNode({
      registry: options.registry,
      topology: options.topology,
      state: options.state,
      outputNode: sourceNode,
      nextAnchors: options.nextAnchors,
      perf: options.perf,
    });
  }
}

function searchUpstreamFromOutputNode(options: {
  readonly registry: RegistryContract;
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
    if (!canDeviceTransferAtCurrentPhase(options.registry, options.topology, options.state, device)) {
      return;
    }

    const outputMoved = solveOutputNode(options.registry, options.topology, options.state, options.outputNode, options.nextAnchors, options.perf);
    if (outputMoved) {
      markNodeVisited(options.state, options.outputNode);
    }

    const inputNode = getDeviceInputViewNodes(options.topology, device)[0];
    if (inputNode === undefined || isNodeVisited(options.state, inputNode)) {
      return;
    }
    if (!prepareInputNodeForProcessing(options.registry, options.topology, options.state, inputNode)) {
      return;
    }

    solveInputNode(options.registry, options.topology, options.state, inputNode);
    markNodeVisited(options.state, inputNode);
    for (const edgeId of getOrderedInputEdgeIds(options.topology, options.state, inputNode)) {
      const edge = options.topology.transferEdges[edgeId];
      const sourceNode = edge === undefined ? undefined : options.topology.nodes[edge.sourceNodeId];
      if (sourceNode !== undefined) {
        searchUpstreamFromOutputNode({
          registry: options.registry,
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

  // AI-CORRECTION 2026-07-23:
  // 一般 PipeFamily 组件也受整数秒相位门禁约束；BeltFamily 锚点仍保持原有逐 tick 行为。
  // AI-CORRECTION 2026-07-27: 当前门禁依据编译期 logisticsKind；管道设备族全部受门禁，传送带族不受此门禁。
  if (!canDeviceTransferAtCurrentPhase(options.registry, options.topology, options.state, device)) {
    return;
  }

  if (!allDownstreamInputNodesResolved(options.topology, options.state, options.outputNode)) {
    return;
  }

  solveOutputNode(options.registry, options.topology, options.state, options.outputNode, options.nextAnchors, options.perf);
  markNodeVisited(options.state, options.outputNode);

  for (const inputNode of getDeviceInputViewNodes(options.topology, device)) {
    if (prepareInputNodeForAnchor(options.registry, options.topology, options.state, inputNode)) {
      options.nextAnchors.set(inputNode.id, inputNode);
    }
  }
}

function solveOutputNode(
  registry: RegistryContract,
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
      // AI-REMOVED 2026-06-12:
      // Reason: edge.currentThroughCount / edge.count 是 per-tick 限流旧设计。
      // Trigger: 用户要求准入口上限使用跨 tick 计数。
      // Evidence: CompiledSimulationTransferEdge.count 已删除。
      // Replacement: canAdmitItemThroughTargetPort(topology, state, edge.targetPortId, itemType)。
      // Risk: Medium - 这里必须在 moveOneItem 前重新检查，避免同 tick 内并发候选越过总量上限。
      // Human Review: Required
      //
      // Original code:
      // if (edgeState.currentThroughCount >= resolvePerTickLimit(edge.count)) {
      //   continue;
      // }
      if (edgeState.sourceSlotId === null || edgeState.targetSlotId === null || edgeState.itemType === null) {
        continue;
      }
      if (!canAdmitItemThroughTargetPort(topology, state, edge.targetPortId, edgeState.itemType)) {
        continue;
      }
      if (!canReleaseItemThroughSourcePort(topology, state, edge.sourcePortId, edgeState.itemType)) {
        continue;
      }

      const ok = moveOneItem({
        registry,
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
      recordAdmissionMove(topology, state, edge.sourcePortId, edgeState.itemType);
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
      refreshBlockedInputNodesAfterMove(
        registry,
        topology,
        state,
        nextAnchors,
        edgeState.sourceSlotId,
      );
      if (perf !== undefined) {
        perf.refreshBlockedMs += performance.now() - tRefresh;
        perf.refreshBlockedCalls += 1;
      }

      const targetNode = topology.nodes[edge.targetNodeId];
      if (targetNode !== undefined) {
        solveInputNode(registry, topology, state, targetNode);
      }
      moved = true;
    }
  }
  return movedAny;
}

function solveInputNode(
  registry: RegistryContract,
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
    if (edge === undefined || edgeState === undefined) {
      continue;
    }

    const sourceNode = topology.nodes[edge.sourceNodeId];
    if (sourceNode === undefined) {
      continue;
    }

    const selection = selectAcceptedSourceForEdge({
      registry,
      topology,
      state,
      sourceNode,
      targetNode: node,
      sourcePortId: edge.sourcePortId,
      targetPortId: edge.targetPortId,
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
  readonly registry: RegistryContract;
  readonly topology: CompiledSimulationTopology;
  readonly state: SimulationMutableRuntimeState;
  readonly sourceNode: CompiledSimulationNode;
  readonly targetNode: CompiledSimulationNode;
  readonly sourcePortId: string;
  readonly targetPortId: string;
  readonly acceptRule: SimulationAcceptRule;
}): SourceSelection | null {
  const perf = options.state.transient._perf;
  if (perf !== undefined) { perf.selectSourceCalls += 1; }

  for (const sourceSlotId of getReadableSourceSlotIds(options.sourceNode)) {
    const slot = options.topology.slots[sourceSlotId];
    const storageSlotId = resolveStorageSlotId(options.state, sourceSlotId);
    const itemType = options.state.persistent.slots[storageSlotId]?.itemType ?? slot?.lock ?? null;
    if (
      slot === undefined
      || itemType === null
      || !acceptsItem(options.registry, options.topology, options.acceptRule, itemType)
    ) {
      continue;
    }
    if (!canAdmitItemThroughTargetPort(options.topology, options.state, options.targetPortId, itemType)) {
      continue;
    }
    if (!canReleaseItemThroughSourcePort(options.topology, options.state, options.sourcePortId, itemType)) {
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
      registry: options.registry,
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

function canAdmitItemThroughTargetPort(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  targetPortId: string,
  itemType: string,
): boolean {
  const rule = topology.ports[targetPortId]?.admissionRule;
  if (rule === undefined || rule === null || rule.itemId === null) {
    return true;
  }
  if (rule.itemId !== itemType) {
    return false;
  }
  // AI-CORRECTION 2026-07-24: 输入端只预留尚未输出的准入额度，不再把进入设备缓存视为已经准入。
  // 已输出计数与设备内同物品占用之和达到任一上限时停止预取，避免管道多拿一份后锁住其他流体。
  const bufferedCount = countBufferedAdmissionItems(
    topology,
    state,
    targetPortId,
    itemType,
  );
  if (
    rule.limit !== null
    && (state.persistent.admissionCounters[targetPortId] ?? 0) + bufferedCount >= rule.limit
  ) {
    return false;
  }
  return bufferedCount
    < readAdmissionRateWindowRemainingAllowance(topology, state, targetPortId);
}

function canReleaseItemThroughSourcePort(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  sourcePortId: string,
  itemType: string,
): boolean {
  const admissionPort = resolveAdmissionInputPortForSourcePort(topology, sourcePortId);
  const rule = admissionPort?.admissionRule;
  if (admissionPort === null || rule === undefined || rule === null || rule.itemId === null) {
    return true;
  }
  if (rule.itemId !== itemType) {
    return false;
  }
  return readAdmissionOutputRemainingAllowance(topology, state, admissionPort.id) > 0;
}

// AI-CORRECTION 2026-07-24: admission move 现在只表示物品从准入口输出口真实离开；
// target input 缓存写入不再提交总计数或速率窗口计数。
function recordAdmissionMove(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  sourcePortId: string,
  itemType: string,
): void {
  const admissionPort = resolveAdmissionInputPortForSourcePort(topology, sourcePortId);
  const rule = admissionPort?.admissionRule;
  if (
    admissionPort === null
    || rule === undefined
    || rule === null
    || rule.itemId !== itemType
  ) {
    return;
  }
  state.persistent.admissionCounters[admissionPort.id] =
    (state.persistent.admissionCounters[admissionPort.id] ?? 0) + 1;
  incrementFixedWindowCounterForCurrentWindow(topology, state, admissionPort.id);
}

function resolveAdmissionInputPortForSourcePort(
  topology: CompiledSimulationTopology,
  sourcePortId: string,
): CompiledSimulationPort | null {
  const sourcePort = topology.ports[sourcePortId];
  const sourceDevice = sourcePort === undefined
    ? undefined
    : topology.devices[sourcePort.deviceId];
  if (sourceDevice === undefined) {
    return null;
  }

  for (const portId of sourceDevice.portIds) {
    const port = topology.ports[portId];
    if (
      port?.direction === "input"
      && port.admissionRule !== null
      && port.admissionRule !== undefined
    ) {
      return port;
    }
  }
  return null;
}

function countBufferedAdmissionItems(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  admissionPortId: string,
  itemType: string,
): number {
  const port = topology.ports[admissionPortId];
  const device = port === undefined ? undefined : topology.devices[port.deviceId];
  if (device === undefined) {
    return 0;
  }

  const visitedStorageSlotIds = new Set<string>();
  let count = 0;
  for (const nodeId of device.nodeIds) {
    const node = topology.nodes[nodeId];
    if (node === undefined) {
      continue;
    }
    for (const slotId of node.slotIds) {
      const storageSlotId = resolveStorageSlotId(state, slotId);
      if (visitedStorageSlotIds.has(storageSlotId)) {
        continue;
      }
      visitedStorageSlotIds.add(storageSlotId);
      const slotState = state.persistent.slots[storageSlotId];
      if (slotState?.itemType === itemType) {
        count += Math.max(0, slotState.count);
      }
    }
  }
  return count;
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
  for (const edgeId of getRawOutputEdgeIds(topology, state, outputNode)) {
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
  registry: RegistryContract,
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
    if (prepareInputNodeForAnchor(registry, topology, state, node)) {
      anchors.push(node);
    }
  }
  return sortInputAnchors(topology, anchors);
}

function prepareInputNodeForAnchor(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
): boolean {
  if (node.viewRole !== "input-view" || isNodeVisited(state, node)) {
    return false;
  }
  if (inputNodeCanAcceptAtCurrentTick(registry, topology, state, node)) {
    markInputNodeUnresolved(state, node);
    return true;
  }
  markInputNodeBlocked(state, node);
  return false;
}

function prepareInputNodeForProcessing(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
): boolean {
  return prepareInputNodeForAnchor(registry, topology, state, node);
}

function refreshBlockedInputNodesAfterMove(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  nextAnchors: Map<string, CompiledSimulationNode>,
  sourceSlotId: string,
): void {
  const blockedIds = state.transient.blockedInputNodeIds;
  if (blockedIds.size === 0) return;

  const sourceStorageSlotId = resolveStorageSlotId(state, sourceSlotId);
  const reactivated: string[] = [];
  for (const nodeId of blockedIds) {
    const node = topology.nodes[nodeId];
    const nodeState = node === undefined ? undefined : state.transient.nodes[node.id];
    if (node === undefined || node.viewRole !== "input-view" || nodeState?.resolveState !== "blocked-resolved") {
      reactivated.push(nodeId);
      continue;
    }
    // 同一次搬运只会减少来源库存、增加目标库存；因此只有容量依赖来源存储的
    // blocked input-view 可能从“无容量”变为“可接收”。
    if (!inputNodeCapacityDependsOnStorageSlot(state, node, sourceStorageSlotId)) {
      continue;
    }
    if (inputNodeCanAcceptAtCurrentTick(registry, topology, state, node)) {
      markInputNodeUnresolved(state, node);
      nextAnchors.set(node.id, node);
      // AI-CORRECTION 2026-05-27: 解除 blocked 时，撤销上游非严格 output-view 的 visited，
      // 并立即将该设备的 input-view 加入下一层锚点，确保本层即可重新处理上传。
      unvisitUpstreamNonStrictOutputViews(registry, topology, state, node, nextAnchors);
    }
  }

  for (const nodeId of reactivated) {
    blockedIds.delete(nodeId);
  }
}

function inputNodeCapacityDependsOnStorageSlot(
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
  storageSlotId: string,
): boolean {
  for (const slotId of node.slotIds) {
    const sharedSlotIds = state.persistent.sharedCapacitySlotIdsBySlotId[slotId];
    if (sharedSlotIds === undefined) {
      if (resolveStorageSlotId(state, slotId) === storageSlotId) {
        return true;
      }
      continue;
    }

    for (const sharedSlotId of sharedSlotIds) {
      if (resolveStorageSlotId(state, sharedSlotId) === storageSlotId) {
        return true;
      }
    }
  }
  return false;
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
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
): boolean {
  const device = topology.devices[node.deviceId];
  if (device !== undefined && !canDeviceTransferAtCurrentPhase(registry, topology, state, device)) {
    return false;
  }

  return inputNodeHasAnyCapacity(topology, state, node);
}

function sortInputAnchors(
  topology: CompiledSimulationTopology,
  nodes: readonly CompiledSimulationNode[],
): readonly CompiledSimulationNode[] {
  return [...nodes].sort((left, right) => {
    const rightOrder = topology.deviceOrderIndexById?.[right.deviceId]
      ?? topology.ordering.deviceOrder.indexOf(right.deviceId);
    const leftOrder = topology.deviceOrderIndexById?.[left.deviceId]
      ?? topology.ordering.deviceOrder.indexOf(left.deviceId);
    const deviceOrder = rightOrder - leftOrder;
    if (deviceOrder !== 0) {
      return deviceOrder;
    }
    return left.groupOrder - right.groupOrder;
  });
}

// AI-REMOVED 2026-06-12:
// Reason: per-tick count resolver 属于被删除的旧限流设计。
// Trigger: 用户确认文档没有 per tick count。
// Evidence: SimulationCountLimit 已删除，准入口限制改由 canAdmitItemThroughTargetPort 读取 persistent counter。
// Replacement: canAdmitItemThroughTargetPort。
// Risk: Low - 所有调用点已移除。
// Human Review: Required
//
// Original code:
// function resolvePerTickLimit(count: SimulationCountLimit): number {
//   return count === "unlimited" ? Number.MAX_SAFE_INTEGER : count;
// }

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
  readonly edgeSelector: (
    topology: CompiledSimulationTopology,
    state: SimulationMutableRuntimeState,
    portId: string,
  ) => readonly string[];
}): readonly string[] {
  return getOrderedPorts(options.topology, options.state, options.portIds)
    .flatMap((port) => options.edgeSelector(options.topology, options.state, port.id));
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

function getRawOutputEdgeIds(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
): readonly string[] {
  return node.outputPortIds
    .flatMap((portId) => getPortOutputEdgeIds(topology, state, portId))
    .filter((edgeId) => topology.transferEdges[edgeId]?.sourceNodeId === node.id);
}

function getPortInputEdgeIds(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  portId: string,
): readonly string[] {
  const startedAt = state.transient._perf === undefined ? 0 : performance.now();
  const indexed = topology.edgeIdsByInputPortId?.[portId];
  // 编译期每条 edge 同时写入 edgeIdsByInputPortId 和 edgeIdsByOutputPortId。
  // 端口不在索引中 ⇒ 该端口无任何连接边 ⇒ 无需回退全扫描。
  const result = indexed ?? [];
  const perf = state.transient._perf;
  if (perf !== undefined) {
    perf.inputEdgeLookupCalls += 1;
    perf.inputEdgeLookupMs += performance.now() - startedAt;
    if (indexed === undefined) perf.edgeIndexFallbackScans += 1;
  }
  return result;
}

function getPortOutputEdgeIds(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  portId: string,
): readonly string[] {
  const startedAt = state.transient._perf === undefined ? 0 : performance.now();
  const indexed = topology.edgeIdsByOutputPortId?.[portId];
  // 编译期每条 edge 同时写入 edgeIdsByInputPortId 和 edgeIdsByOutputPortId。
  // 端口不在索引中 ⇒ 该端口无任何连接边 ⇒ 无需回退全扫描。
  const result = indexed ?? [];
  const perf = state.transient._perf;
  if (perf !== undefined) {
    perf.outputEdgeLookupCalls += 1;
    perf.outputEdgeLookupMs += performance.now() - startedAt;
    if (indexed === undefined) perf.edgeIndexFallbackScans += 1;
  }
  return result;
}

function pushUnique(values: string[] | undefined, value: string): void {
  if (values !== undefined && !values.includes(value)) {
    values.push(value);
  }
}
