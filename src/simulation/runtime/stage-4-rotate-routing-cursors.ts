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
 * 订正（2026-05-17）：修复两个问题：
 *   ① 未连接端口阻塞游标 → 跳过未连接端口（永久死端口不应参与轮转）；
 *   ② 无传输的空 tick 中游标震荡导致与输出节奏同步锁死 → 仅当端口组内至少有一个端口发生了
 *      moved 传输时才执行旋转；空 tick 时保留游标位置不变。
 */
export function rotateRoutingCursors(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  // 预建 port→moved 缓存：一次扫描 edgeOrder，避免 portHasMovedEdge 逐 port 重复全量扫描。
  const movedByPort = buildMovedEdgeByPort(topology, state);
  // 预建已连接端口集合：有 transferEdge 的 port 视为"已连接"。
  const connectedPortIds = buildConnectedPortIds(topology);

  for (const portGroup of collectRoutingPortGroups(topology)) {
    const currentCursor = state.persistent.routingCursors[portGroup.key] ?? 0;
    const normalizedCursor = ((currentCursor % portGroup.ports.length) + portGroup.ports.length) % portGroup.ports.length;
    const rotatedPorts = [
      ...portGroup.ports.slice(normalizedCursor),
      ...portGroup.ports.slice(0, normalizedCursor),
    ];

    // 订正（2026-05-17）：仅当端口组内至少有一个端口发生了 moved 传输时才旋转游标。
    // 空 tick（无传输）保留游标位置，避免游标震荡与设备输出节奏同步锁死。
    const anyMoved = rotatedPorts.some((port) => movedByPort.get(port.id));
    if (!anyMoved) {
      continue;
    }

    let skipped = 0;
    for (const port of rotatedPorts) {
      // ① 未连接端口 → 跳过（永久死端口，不应阻塞轮转）
      if (!connectedPortIds.has(port.id)) {
        skipped++;
        continue;
      }

      // ② 已连接且有传输 → 跳过
      if (movedByPort.get(port.id)) {
        skipped++;
        continue;
      }

      // ③ 第一个已连接但无传输的端口 → 停在此处（保留下 tick 优先权）
      break;
    }

    state.persistent.routingCursors[portGroup.key] = (normalizedCursor + skipped) % portGroup.ports.length;
  }
}

/**
 * 扫描所有 transferEdge，收集出现在 source 或 target 上的 port ID。
 * 这些 port 已通过物理连接与对端设备连通，视为"已连接"。
 * 未出现在此集合中的 port 即使有端口定义，也没有任何可传输的边，视为"未连接"（死端口）。
 */
function buildConnectedPortIds(
  topology: CompiledSimulationTopology,
): Set<string> {
  const connected = new Set<string>();
  for (const edgeId of topology.ordering.edgeOrder) {
    const edge = topology.transferEdges[edgeId];
    if (edge === undefined) {
      continue;
    }
    connected.add(edge.sourcePortId);
    connected.add(edge.targetPortId);
  }
  return connected;
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
