import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { getPlannerPorts, transportCapacity, type PlannerPort } from "./geometry";
import type { PlannerNetwork, PlannerNode, PlannerWire } from "./model";
import type { Connection } from "./wiring";

export function isRoutingReactor(node: PlannerNode): boolean {
  return node.definition.id === "mix_pool_1" || node.definition.id === "mix_pool_2";
}

const epsilon = 1e-6;
const portKey = (port: PlannerPort) => JSON.stringify([port.entityId, port.groupIndex, port.portIndex]);
const distance = (a: PlannerPort, b: PlannerPort) => Math.abs(a.outside.x - b.outside.x) + Math.abs(a.outside.y - b.outside.y);

interface Transfer {
  pool: PlannerNode;
  connection: Connection;
  item: string;
  inlet: PlannerPort;
  outlet: PlannerPort;
  maximum: number;
  extraDistance: number;
  shared: number;
  identity: string;
}

function addFlow(connections: Connection[], source: PlannerPort, target: PlannerPort, item: string, rate: number): void {
  const from = portKey(source), to = portKey(target);
  let connection = connections.find(edge => portKey(edge.source) === from && portKey(edge.target) === to);
  if (!connection) {
    connection = { source, target, amounts: new Map() };
    connections.push(connection);
  }
  connection.amounts.set(item, (connection.amounts.get(item) ?? 0) + rate);
}

function transfers(registry: RegistryContract, pools: readonly PlannerNode[], connections: readonly Connection[],
  checkBudget: () => void): Transfer[] {
  const loads = new Map<string, Map<string, number>>();
  const neighbours = new Map<string, Set<string>>();
  for (const { source, target } of connections) {
    const key = portKey(source);
    const targets = neighbours.get(key) ?? new Set<string>();
    targets.add(portKey(target));
    neighbours.set(key, targets);
  }
  for (const edge of connections) for (const port of [edge.source, edge.target]) {
    const key = portKey(port);
    const values = loads.get(key) ?? new Map<string, number>();
    for (const [item, rate] of edge.amounts) values.set(item, (values.get(item) ?? 0) + rate);
    loads.set(key, values);
  }
  const available = (port: PlannerPort, item: string) => {
    const values = loads.get(portKey(port));
    if (values && [...values.keys()].some(id => id !== item)) return 0;
    return transportCapacity(port.kind) - (values?.get(item) ?? 0);
  };
  const result: Transfer[] = [];
  for (const pool of pools) {
    // 同一候选摆位下，多个来源和下游共享该物料的合法端口对。
    const pairs = new Map<string, { inlet: PlannerPort; outlet: PlannerPort }[]>();
    for (const connection of connections) {
      checkBudget();
      const { source, target } = connection;
      if (pool.entity.id === source.entityId || pool.entity.id === target.entityId) continue;
      for (const [item, rate] of connection.amounts) {
        let ports = pairs.get(item);
        if (!ports) {
          const domain = registry.queries.resolveItemDomain(item);
          ports = [];
          pairs.set(item, ports);
          if (domain !== ItemDomainFlag.Solid && domain !== ItemDomainFlag.Liquid) continue;
          for (const inlet of getPlannerPorts(registry, pool.entity, pool.definition, "input", item)) {
            const groups = pool.definition.portStorageBindings.filter(binding =>
              binding.portGroupId === pool.definition.portGroups[inlet.groupIndex]!.id).map(binding => binding.storageSlotGroupId);
            for (const outlet of getPlannerPorts(registry, pool.entity, pool.definition, "output", item, groups)) {
              ports.push({ inlet, outlet });
            }
          }
        }
        for (const { inlet, outlet } of ports) {
          if (inlet.kind !== source.kind || outlet.kind !== target.kind) continue;
          const maximum = Math.min(rate, available(inlet, item), available(outlet, item));
          if (maximum <= epsilon) continue;
          const shared = Number(neighbours.get(portKey(source))?.has(portKey(inlet)) ?? false)
            + Number(neighbours.get(portKey(outlet))?.has(portKey(target)) ?? false);
          result.push({ pool, connection, item, inlet, outlet, maximum, shared,
            extraDistance: distance(source, inlet) + distance(outlet, target) - distance(source, target),
            identity: JSON.stringify([portKey(source), portKey(target), item, portKey(inlet), portKey(outlet)]) });
        }
      }
    }
  }
  return result.sort((a, b) => b.shared - a.shared || a.extraDistance - b.extraDistance || a.identity.localeCompare(b.identity));
}

// 用 Stern–Brocot 树遍历 (0,1) 内的有理分摊。0 为 1/2，子节点按游标的二进制路径选择。
function fraction(index: number): number {
  let a = 0, b = 1, c = 1, d = 1;
  for (const bit of (index + 1).toString(2).slice(1)) {
    if (bit === "0") { c += a; d += b; }
    else { a += c; b += d; }
  }
  return (a + c) / (b + d);
}

/** 游标 0 保留当前接法。正游标按当前合法操作数展开，可从同一初始接线重放多次借池。 */
export function routeThroughReactors(registry: RegistryContract, nodes: readonly PlannerNode[], connections: Connection[],
  cursor: number, checkBudget: () => void) {
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("反应池接线游标无效。");
  const inlets = new Map<string, { node: PlannerNode; port: PlannerPort; item: string }>();
  if (!cursor) return [];
  const pools = nodes.filter(isRoutingReactor);
  while (cursor && pools.length) {
    const choices = transfers(registry, pools, connections, checkBudget);
    if (!choices.length) break;
    const index = cursor - 1;
    const choice = choices[index % choices.length]!;
    let rest = Math.floor(index / choices.length);
    let rate = choice.maximum;
    if (rest % 2) {
      // 将后续位交错分给比例和下一次操作，部分转供后仍可继续借另一座池。
      const bits = Math.floor(rest / 2).toString(2).split("").reverse();
      const decode = (offset: number) => parseInt(bits.filter((_, i) => i % 2 === offset).reverse().join("") || "0", 2);
      rate *= fraction(decode(0));
      rest = decode(1);
    } else rest /= 2;
    cursor = rest;
    const { connection, item, inlet, outlet } = choice;
    const remaining = connection.amounts.get(item)! - rate;
    if (rate <= epsilon || remaining > 0 && remaining <= epsilon) continue;
    if (remaining > 0) connection.amounts.set(item, remaining);
    else connection.amounts.delete(item);
    if (!connection.amounts.size) connections.splice(connections.indexOf(connection), 1);
    inlets.set(portKey(inlet), { node: choice.pool, port: inlet, item });
    addFlow(connections, connection.source, inlet, item, rate);
    addFlow(connections, outlet, connection.target, item, rate);
  }
  return [...inlets.values()];
}

/** 逐格寻路前，在当前实际摆位上试用一对空闲口。原网表供下一次摆位和失败回退使用。 */
export function selectPlacedReactorTransit(registry: RegistryContract, network: PlannerNetwork, wires: readonly PlannerWire[],
  choiceIndex: number, protectedEdges: ReadonlySet<number>, checkBudget: () => void) {
  const pools = network.nodes.filter(isRoutingReactor);
  if (!pools.length) return null;
  const occupied = new Set(wires.flatMap(wire => [portKey(wire.source), portKey(wire.target)]));
  // 此阶段只替换一条完整的单物料线路，不拆混合线、不改变外部分流设施的计划吞吐。
  const indices = new Map<Connection, number>();
  for (const [index, wire] of wires.entries()) {
    if (wire.itemIds.length !== 1 || wire.minimumCells || protectedEdges.has(index)) continue;
    indices.set({ source: wire.source, target: wire.target, amounts: new Map([[wire.itemIds[0]!, wire.perMinute]]) }, index);
  }
  const choices = transfers(registry, pools, [...indices.keys()], checkBudget).filter(choice =>
    !occupied.has(portKey(choice.inlet)) && !occupied.has(portKey(choice.outlet))
    && choice.maximum === choice.connection.amounts.get(choice.item));
  if (!choices.length) return null;
  const choice = choices[choiceIndex % choices.length]!;
  const index = indices.get(choice.connection)!;
  return { index, pool: choice.pool, inlet: choice.inlet, outlet: choice.outlet, item: choice.item };
}
