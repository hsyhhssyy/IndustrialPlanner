import type {
  CompiledSimulationPort,
  CompiledSimulationTopology,
} from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";

/**
 * 对应《仿真运行原理》§5.4 Tick 阶段 4 与 §9 游标轮转。
 * shadowPull 与 shadowPush 同时 accept 的边——即本 tick 准备就绪但未发生实际传输的边——跳过游标；
 * 已 moved 的边（实际传输过）也推进游标，保证 round-robin 来自真实输送结果。
 *
 * 订正（2026-05-06）：引入 moved 状态后，moved 边也需推进游标，否则游标会卡在 moved 边上无法轮转。
 * 订正（2026-05-08）：第 8 章移动阶段会把 shadowPull 与 shadowPush 同时置为 moved；
 * 第 9 章游标轮转只按双 moved 边推进，不再使用 accept && accept 或单侧 moved。
 */
export function rotateRoutingCursors(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  // 预建 port→moved 缓存：一次扫描 edgeOrder，避免 portHasMovedEdge 逐 port 重复全量扫描。
  const movedByPort = buildMovedEdgeByPort(topology, state);

  for (const portGroup of collectRoutingPortGroups(topology)) {
    const currentCursor = state.persistent.routingCursors[portGroup.key] ?? 0;
    const normalizedCursor = ((currentCursor % portGroup.ports.length) + portGroup.ports.length) % portGroup.ports.length;
    const rotatedPorts = [
      ...portGroup.ports.slice(normalizedCursor),
      ...portGroup.ports.slice(0, normalizedCursor),
    ];

    let skipped = 0;
    for (const port of rotatedPorts) {
      if (!movedByPort.get(port.id)) {
        break;
      }
      skipped += 1;
    }

    state.persistent.routingCursors[portGroup.key] = (normalizedCursor + skipped) % portGroup.ports.length;
  }
}

/**
 * 一次扫描 edgeOrder，为每个 port 缓存其关联边上是否存在 moved 传输。
 * O(E) 替代原 portHasMovedEdge 的 O(P×E)。
 */
function buildMovedEdgeByPort(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): Map<string, boolean> {
  const moved = new Map<string, boolean>();
  for (const edgeId of topology.ordering.edgeOrder) {
    const edge = topology.transferEdges[edgeId];
    const edgeState = state.transient.edges[edgeId];
    if (edge === undefined || edgeState === undefined) {
      continue;
    }
    if (edgeState.shadowPull !== "moved" || edgeState.shadowPush !== "moved") {
      continue;
    }

    if (moved.get(edge.sourcePortId) !== true) {
      moved.set(edge.sourcePortId, true);
    }
    if (moved.get(edge.targetPortId) !== true) {
      moved.set(edge.targetPortId, true);
    }
  }
  return moved;
}

function collectRoutingPortGroups(topology: CompiledSimulationTopology): Array<{
  readonly key: string;
  readonly ports: readonly CompiledSimulationPort[];
}> {
  const portsByKey = new Map<string, CompiledSimulationPort[]>();
  for (const portId of topology.ordering.portOrder) {
    const port = topology.ports[portId];
    if (port === undefined) {
      continue;
    }

    const key = getRoutingCursorGroupKey(port);
    const ports = portsByKey.get(key) ?? [];
    ports.push(port);
    portsByKey.set(key, ports);
  }

  return [...portsByKey.entries()].map(([key, ports]) => ({
    key,
    ports: ports.sort(comparePortsForRouting),
  }));
}

function comparePortsForRouting(left: CompiledSimulationPort, right: CompiledSimulationPort): number {
  return left.priorityGroup - right.priorityGroup
    || left.roundRobinSeed - right.roundRobinSeed
    || left.order - right.order
    || left.id.localeCompare(right.id);
}

function getRoutingCursorGroupKey(port: CompiledSimulationPort): string {
  return `${port.deviceId}:${port.portGroupId}:${port.direction}:priority-${port.priorityGroup}`;
}
