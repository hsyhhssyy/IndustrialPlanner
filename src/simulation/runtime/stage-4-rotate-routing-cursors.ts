import type { CompiledSimulationTopology } from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";

/**
 * 对应《仿真运行原理》§5.4 Tick 阶段 4 与 §9 游标轮转。
 * 只有 shadowPull 与 shadowPush 同时 accept，并且本 tick 实际通过了物品的边才推进端口游标；
 * 这样 round-robin 的轮转来自真实输送结果，而不是来自未满足的尝试。
 */
export function rotateRoutingCursors(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  for (const edgeId of topology.ordering.edgeOrder) {
    const edge = topology.transferEdges[edgeId];
    const edgeState = state.transient.edges[edgeId];
    if (edge === undefined || edgeState === undefined) {
      continue;
    }
    if (edgeState.shadowPull !== "accept" || edgeState.shadowPush !== "accept" || edgeState.amount <= 0) {
      continue;
    }

    rotatePortCursor(topology, state, edge.sourcePortId);
    rotatePortCursor(topology, state, edge.targetPortId);
  }
}

function rotatePortCursor(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  portId: string,
): void {
  const port = topology.ports[portId];
  if (port === undefined) {
    return;
  }
  const cursorKey = `${port.deviceId}:${port.portGroupId}.${port.portDefinitionId}`;
  const edgeCount = Math.max(1, countPortEdges(topology, portId));
  state.persistent.routingCursors[cursorKey] = ((state.persistent.routingCursors[cursorKey] ?? 0) + 1) % edgeCount;
}

function countPortEdges(topology: CompiledSimulationTopology, portId: string): number {
  return topology.ordering.edgeOrder.filter((edgeId) => {
    const edge = topology.transferEdges[edgeId];
    return edge?.sourcePortId === portId || edge?.targetPortId === portId;
  }).length;
}
