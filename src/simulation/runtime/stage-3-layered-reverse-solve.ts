import type {
  CompiledSimulationNode,
  CompiledSimulationTopology,
  SimulationAcceptRule,
  SimulationCountLimit,
} from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import {
  acceptsItem,
  findInputSlotForItem,
  findOutputSlotForItem,
  moveOneItem,
} from "./runtime-slot-access";

/**
 * 对应《仿真运行原理》§5.3 Tick 阶段 3 与 §8 分层逆向求解。
 * 算法从终端设备向上游分层遍历：先让输入 Node 产生 shadowPull，再让上游输出 Node
 * 响应 shadowPush 并执行真实移动。每次真实移动后，会重新求解目标输入 Node，保证链路在同
 * 一个 tick 内按“目标需要 -> 来源供给”的因果顺序传播。
 */
export function solveTransferGraph(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  const deviceLayers = buildReverseDeviceLayers(topology);
  for (const layer of deviceLayers) {
    for (const deviceId of layer) {
      solveDeviceOutputs(topology, state, deviceId);
      solveDeviceInputs(topology, state, deviceId);
    }
  }
}

function solveDeviceInputs(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  deviceId: string,
): void {
  const device = topology.devices[deviceId];
  if (device === undefined) {
    return;
  }

  for (const nodeId of device.nodeIds) {
    const node = topology.nodes[nodeId];
    if (node === undefined || node.viewRole === "output-view") {
      continue;
    }
    solveInputNode(topology, state, node);
  }
}

function solveDeviceOutputs(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  deviceId: string,
): void {
  const device = topology.devices[deviceId];
  if (device === undefined) {
    return;
  }

  for (const nodeId of [...device.nodeIds].reverse()) {
    const node = topology.nodes[nodeId];
    if (node === undefined || node.viewRole === "input-view") {
      continue;
    }

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

        const itemType = edgeState.itemType;
        if (itemType === null) {
          continue;
        }
        const sourceSlotId = findOutputSlotForItem({ topology, state, node, itemType });
        if (sourceSlotId === null || edgeState.targetSlotId === null) {
          continue;
        }
        const ok = moveOneItem({
          topology,
          state,
          sourceSlotId,
          targetSlotId: edgeState.targetSlotId,
          itemType,
        });
        if (!ok) {
          continue;
        }

        edgeState.shadowPush = "accept";
        edgeState.sourceSlotId = sourceSlotId;
        edgeState.amount += 1;
        edgeState.currentThroughCount += 1;
        // §8.2.3: 移动物品后将边的 shadowPull 与 shadowPush 置为 moved，
        // 阻止本 tick 内同一条边被再次选中，防止存储箱一次性清空所有物品到传送带。
        edgeState.shadowPull = "moved";
        edgeState.shadowPush = "moved";
        state.transient.nodes[node.id]?.acceptedOutputEdgeIds.push(edgeId);
        state.transient.transfers.push({
          edgeId,
          sourceSlotId,
          targetSlotId: edgeState.targetSlotId,
          itemType,
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
    const itemType = selectAcceptedSourceItemType(topology, state, sourceNode, edge.acceptRule);
    if (itemType === null) {
      continue;
    }
    const targetSlotId = findInputSlotForItem({ topology, state, node, itemType });
    if (targetSlotId === null) {
      continue;
    }

    edgeState.shadowPull = "accept";
    edgeState.targetSlotId = targetSlotId;
    edgeState.itemType = itemType;
    nodeState.result = "solved-run";
    nodeState.acceptedInputEdgeIds.push(edgeId);
  }

  if (nodeState.result === "uncertain") {
    nodeState.result = "solved-block";
  }
}

function selectAcceptedSourceItemType(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  sourceNode: CompiledSimulationNode,
  acceptRule: SimulationAcceptRule,
): string | null {
  const candidates = new Set<string>();
  for (const slotId of sourceNode.slotIds) {
    const slot = topology.slots[slotId];
    const storageSlotId = state.persistent.shareAllTargetSlotIdBySourceSlotId[slotId] ?? slotId;
    const itemType = state.persistent.slots[storageSlotId]?.itemType ?? slot?.lock ?? null;
    if (itemType !== null) {
      candidates.add(itemType);
    }
  }

  return [...candidates].sort().find((itemType) =>
    acceptsItem(topology, acceptRule, itemType)
    && findOutputSlotForItem({ topology, state, node: sourceNode, itemType }) !== null,
  ) ?? null;
}

function resolvePerTickLimit(count: SimulationCountLimit): number {
  return count === "unlimited" ? Number.MAX_SAFE_INTEGER : count;
}

function getOrderedInputEdgeIds(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
): readonly string[] {
  return applyRoutingCursor(topology, state, node.inputPortIds.flatMap((portId) => getPortInputEdgeIds(topology, portId)));
}

function getOrderedOutputEdgeIds(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  node: CompiledSimulationNode,
): readonly string[] {
  return applyRoutingCursor(topology, state, node.outputPortIds.flatMap((portId) => getPortOutputEdgeIds(topology, portId)));
}

function getPortInputEdgeIds(topology: CompiledSimulationTopology, portId: string): readonly string[] {
  return topology.ordering.edgeOrder.filter((edgeId) => topology.transferEdges[edgeId]?.targetPortId === portId);
}

function getPortOutputEdgeIds(topology: CompiledSimulationTopology, portId: string): readonly string[] {
  return topology.ordering.edgeOrder.filter((edgeId) => topology.transferEdges[edgeId]?.sourcePortId === portId);
}

function applyRoutingCursor(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  edgeIds: readonly string[],
): readonly string[] {
  if (edgeIds.length <= 1) {
    return edgeIds;
  }

  const firstEdge = topology.transferEdges[edgeIds[0] ?? ""];
  const portId = firstEdge?.targetPortId ?? firstEdge?.sourcePortId;
  const port = portId === undefined ? undefined : topology.ports[portId];
  const cursorKey = port === undefined ? null : `${port.deviceId}:${port.portGroupId}.${port.portDefinitionId}`;
  const cursor = cursorKey === null ? 0 : state.persistent.routingCursors[cursorKey] ?? 0;
  const normalizedCursor = ((cursor % edgeIds.length) + edgeIds.length) % edgeIds.length;
  return [...edgeIds.slice(normalizedCursor), ...edgeIds.slice(0, normalizedCursor)];
}

function buildReverseDeviceLayers(topology: CompiledSimulationTopology): readonly (readonly string[])[] {
  const incomingDeviceIdsByDeviceId = new Map<string, Set<string>>();
  const outgoingEdgeCountByDeviceId = new Map<string, number>();
  for (const deviceId of topology.ordering.deviceOrder) {
    incomingDeviceIdsByDeviceId.set(deviceId, new Set());
    outgoingEdgeCountByDeviceId.set(deviceId, 0);
  }

  for (const edge of Object.values(topology.transferEdges)) {
    const sourceDeviceId = topology.nodes[edge.sourceNodeId]?.deviceId;
    const targetDeviceId = topology.nodes[edge.targetNodeId]?.deviceId;
    if (sourceDeviceId === undefined || targetDeviceId === undefined || sourceDeviceId === targetDeviceId) {
      continue;
    }
    incomingDeviceIdsByDeviceId.get(targetDeviceId)?.add(sourceDeviceId);
    outgoingEdgeCountByDeviceId.set(sourceDeviceId, (outgoingEdgeCountByDeviceId.get(sourceDeviceId) ?? 0) + 1);
  }

  const visited = new Set<string>();
  const layers: string[][] = [];
  let currentLayer = topology.ordering.deviceOrder
    .filter((deviceId) => (outgoingEdgeCountByDeviceId.get(deviceId) ?? 0) === 0)
    .reverse();

  while (currentLayer.length > 0) {
    const layer = currentLayer.filter((deviceId) => !visited.has(deviceId));
    if (layer.length === 0) {
      break;
    }
    layers.push(layer);
    for (const deviceId of layer) {
      visited.add(deviceId);
    }

    const nextLayerSet = new Set<string>();
    for (const deviceId of layer) {
      for (const upstreamDeviceId of incomingDeviceIdsByDeviceId.get(deviceId) ?? []) {
        if (!visited.has(upstreamDeviceId)) {
          nextLayerSet.add(upstreamDeviceId);
        }
      }
    }
    currentLayer = [...nextLayerSet].sort((left, right) =>
      topology.ordering.deviceOrder.indexOf(right) - topology.ordering.deviceOrder.indexOf(left),
    );
  }

  const remaining = topology.ordering.deviceOrder.filter((deviceId) => !visited.has(deviceId)).reverse();
  if (remaining.length > 0) {
    layers.push(remaining);
  }

  return layers;
}
