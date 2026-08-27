import type {
  CompiledSimulationNode,
  CompiledSimulationPort,
  CompiledSimulationTopology,
  SimulationPortDirection,
} from "../types";

export interface RoutingCursorGroup {
  readonly key: string;
  readonly ports: readonly CompiledSimulationPort[];
}

/**
 * 路由游标属于同一 Node 上、同方向、同物流类型、同优先级的候选端口集合。
 * PortGroup 负责配置和绑定，不是运行时争用同一库存 Node 时的轮询边界。
 */
export function collectNodeRoutingCursorGroups(options: {
  readonly node: CompiledSimulationNode;
  readonly direction: SimulationPortDirection;
  readonly ports: readonly CompiledSimulationPort[];
}): readonly RoutingCursorGroup[] {
  const portsByKey = new Map<string, CompiledSimulationPort[]>();

  for (const port of options.ports) {
    const key = createRoutingCursorGroupKey(options.node, options.direction, port);
    const ports = portsByKey.get(key) ?? [];
    ports.push(port);
    portsByKey.set(key, ports);
  }

  return [...portsByKey.entries()]
    .map(([key, ports]) => ({
      key,
      ports: ports.sort(comparePortsForRouting),
    }))
    .sort((left, right) => compareRoutingCursorGroups(left, right));
}

export function collectTopologyRoutingCursorGroups(
  topology: CompiledSimulationTopology,
): readonly RoutingCursorGroup[] {
  const groups: RoutingCursorGroup[] = [];

  for (const nodeId of topology.ordering.nodeOrder) {
    const node = topology.nodes[nodeId];
    if (node === undefined) {
      continue;
    }

    groups.push(
      ...collectNodeRoutingCursorGroups({
        node,
        direction: "input",
        ports: resolvePorts(topology, node.inputPortIds),
      }),
      ...collectNodeRoutingCursorGroups({
        node,
        direction: "output",
        ports: resolvePorts(topology, node.outputPortIds),
      }),
    );
  }

  return groups;
}

function createRoutingCursorGroupKey(
  node: CompiledSimulationNode,
  direction: SimulationPortDirection,
  port: CompiledSimulationPort,
): string {
  const transportKind = port.isPipe ? "pipe" : "belt";
  return `${node.deviceId}:node:${node.id}:${direction}:${transportKind}:kind-${port.kind}:priority-${port.priorityGroup}`;
}

function resolvePorts(
  topology: CompiledSimulationTopology,
  portIds: readonly string[],
): readonly CompiledSimulationPort[] {
  return portIds.flatMap((portId) => {
    const port = topology.ports[portId];
    return port === undefined ? [] : [port];
  });
}

function compareRoutingCursorGroups(
  left: RoutingCursorGroup,
  right: RoutingCursorGroup,
): number {
  const leftPort = left.ports[0];
  const rightPort = right.ports[0];
  if (leftPort === undefined || rightPort === undefined) {
    return left.key.localeCompare(right.key);
  }
  return leftPort.priorityGroup - rightPort.priorityGroup
    || leftPort.order - rightPort.order
    || left.key.localeCompare(right.key);
}

function comparePortsForRouting(
  left: CompiledSimulationPort,
  right: CompiledSimulationPort,
): number {
  return left.roundRobinSeed - right.roundRobinSeed
    || left.order - right.order
    || left.id.localeCompare(right.id);
}
