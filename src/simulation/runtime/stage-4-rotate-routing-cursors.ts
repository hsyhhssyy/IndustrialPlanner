import type { CompiledSimulationTopology } from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";

/**
 * 对应《仿真运行原理》§5.4 Tick 阶段 4 与 §9 游标轮转。
 * shadowPull 与 shadowPush 同时 accept 的边——即本 tick 准备就绪但未发生实际传输的边——跳过游标；
 * 已 moved 的边（实际传输过）也推进游标，保证 round-robin 来自真实输送结果。
 *
 * 订正（2026-05-06）：引入 moved 状态后，moved 边也需推进游标，否则游标会卡在 moved 边上无法轮转。
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
    // §9: shadowPull 与 shadowPush 同时 accept 的边（准备就绪但可能未实际传输）跳过游标；
    // moved 的边（实际传输过）也推进游标，仅 uncertain 或单边 accept 的边不推进。
    const bothAccept = edgeState.shadowPull === "accept" && edgeState.shadowPush === "accept";
    const moved = edgeState.shadowPull === "moved" || edgeState.shadowPush === "moved";
    if (!bothAccept && !moved) {
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
