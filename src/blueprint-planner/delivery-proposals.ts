import type { RegistryContract } from "@/domain/registry/registry-contract";
import { cellKey, DELTAS, findLogisticsDevice, getPlannerPorts, ROTATIONS } from "./geometry";
import { createPlainNode } from "./placement";
import { restrictPort } from "./wiring";
import { refreshDeliveryLines, type DeliveryLayout, type DeliveryLine } from "./delivery-routing";
import type { PlannerNode } from "./model";

export interface DeliveryEdit {
  layout: DeliveryLayout;
  changed: number[];
}

function movable(node: PlannerNode) {
  return !node.manualPlacement && !node.manualFacility && !node.external && !node.boundaryPort;
}

function* permutations(values: number[]): Generator<number[]> {
  if (!values.length) {
    yield [];
    return;
  }
  for (const value of values)
    for (const tail of permutations(values.filter((other) => other !== value))) yield [value, ...tail];
}

/** 口位归属按相交的真实线路分组，包括远离取货口的桥。物料配置与仓库关联保留在原实体 ID 上。 */
export function* warehouseEdits(registry: RegistryContract, layout: DeliveryLayout): Generator<DeliveryEdit> {
  const depots = layout.network.nodes.filter((n) => n.definition.id === "unloader_1" && movable(n));
  const owners = new Map<string, number[]>(),
    adjacent = new Map<number, Set<number>>();
  const lines = depots.map((n) =>
    layout.lines.flatMap(({ wire }, i) => (wire.source.entityId === n.entity.id ? [i] : [])),
  );
  for (const [index, group] of lines.entries())
    for (const i of group)
      for (const cell of layout.lines[i]!.cells) {
        const key = cellKey(cell),
          peers = owners.get(key) ?? [];
        for (const peer of peers) {
          const a = depots[index]!,
            b = depots[peer]!;
          if (
            peer === index ||
            a.entity.rotation !== b.entity.rotation ||
            a.manualBoundarySide !== b.manualBoundarySide
          )
            continue;
          const axis = a.entity.rotation % 180 === 0 ? "y" : "x";
          if (a.entity.position[axis] !== b.entity.position[axis]) continue;
          for (const [left, right] of [
            [index, peer],
            [peer, index],
          ] as const) {
            const list = adjacent.get(left) ?? new Set();
            list.add(right);
            adjacent.set(left, list);
          }
        }
        peers.push(index);
        owners.set(key, peers);
      }
  const seen = new Set<number>();
  for (const start of adjacent.keys()) {
    if (seen.has(start)) continue;
    const group = [start];
    seen.add(start);
    for (const id of group)
      for (const peer of adjacent.get(id)!)
        if (!seen.has(peer)) {
          group.push(peer);
          seen.add(peer);
        }
    // 小组完整枚举；大组先检查每座现有桥的两端，避免阶乘级延迟。
    const groups =
      group.length <= 4 ? [group] : group.flatMap((a) => [...adjacent.get(a)!].filter((b) => a < b).map((b) => [a, b]));
    if (group.length > 4) groups.push(group);
    for (const members of groups)
      for (const order of permutations(members)) {
        const moved = members.filter((v, i) => v !== order[i]);
        if (!moved.length) continue;
        const positions = new Map(members.map((v, i) => [depots[v]!.entity.id, depots[order[i]!]!.entity.position]));
        const network = {
          ...layout.network,
          nodes: layout.network.nodes.map((n) =>
            positions.has(n.entity.id) ? { ...n, entity: { ...n.entity, position: positions.get(n.entity.id)! } } : n,
          ),
        };
        yield {
          layout: { network, lines: refreshDeliveryLines(registry, { ...layout, network }) },
          changed: members.flatMap((m) => lines[m]!),
        };
      }
  }
}

/** 沿原主管直接接入一条折返支路，保留这两段，只重布剩余两个出口。 */
export function* relocateSplitters(registry: RegistryContract, layout: DeliveryLayout): Generator<DeliveryEdit> {
  const { network, lines } = layout;
  if (network.request.manualLayout?.enabled && network.request.manualLayout.mode === "topology") return;
  let inspected = 0;
  for (const node of network.nodes) {
    if (!movable(node) || node.entity.tags.length || registry.queries.resolveLogisticsRole(node.definition.id) !== "splitter") continue;
    if (++inspected > 8) return;
    const trunk = lines.find(l => l.wire.target.entityId === node.entity.id);
    const arms = lines.filter(l => l.wire.source.entityId === node.entity.id);
    if (!trunk || arms.length !== 3 || new Set(arms.map(l => l.wire.source.portIndex)).size !== 3) continue;
    const item = trunk.wire.itemIds[0];
    if (!item || [trunk, ...arms].some(l => l.wire.itemIds.length !== 1 || l.wire.itemIds[0] !== item)) continue;
    // 仅互换具有相同配置的出口，保留筛选与优先级。
    const signatures = arms.map(({ wire: { source } }) => {
      const prefix = `portGroups[${source.groupIndex}].ports[${source.portIndex}].`;
      return JSON.stringify(Object.keys(node.entity.config).filter(k => k.startsWith(prefix)).sort()
        .map(k => [k.slice(prefix.length), node.entity.config[k]]));
    });
    if (new Set(signatures).size !== 1) continue;
    if (trunk.cells.length + arms.reduce((n, arm) => n + arm.cells.length, 0) > 512) continue;
    const sites: { branch: DeliveryLine; i: number; j: number; gain: number }[] = [];
    for (const branch of arms) {
      const cells = new Map(branch.cells.map((p, j) => [cellKey(p), j]));
      for (const [i, tap] of trunk.cells.entries()) {
        if (i < (trunk.wire.minimumCells ?? 0)) continue;
        for (const delta of DELTAS) {
          const x = tap.x + delta.x, y = tap.y + delta.y;
          const j = cells.get(cellKey({ x, y }));
          if (j === undefined || branch.cells.length - j < (branch.wire.minimumCells ?? 0)) continue;
          const next = branch.cells[j + 1] ?? branch.wire.target.cell;
          if (next.x !== x + delta.x || next.y !== y + delta.y) continue;
          const gain = trunk.cells.length - i + j;
          if (gain < 4) continue;
          sites.push({ branch, i, j, gain });
          sites.sort((a, b) => b.gain - a.gain);
          if (sites.length > 2) sites.pop();
        }
      }
    }
    for (const { branch, i, j } of sites) {
      const position = trunk.cells[i]!;
      const upstream = trunk.cells[i - 1] ?? trunk.wire.source.cell;
      for (const rotation of ROTATIONS) {
        const entity = { ...node.entity, position, rotation };
        const inlet = getPlannerPorts(registry, entity, node.definition, "input")[0]!;
        if (cellKey(inlet.outside) !== cellKey(upstream)) continue;
        const exits = getPlannerPorts(registry, entity, node.definition, "output");
        const direct = exits.find(p => cellKey(p.outside) === cellKey(branch.cells[j]!));
        if (!direct || exits.length !== 3) continue;
        const free = exits.filter(p => p !== direct);
        const rest = arms.filter(l => l !== branch);
        const changed = rest.map(l => lines.indexOf(l));
        for (const order of [free, [...free].reverse()]) {
          yield {
            layout: {
              network: { ...network, nodes: network.nodes.map(n => n === node ? { ...n, entity } : n) },
              lines: lines.map(l => {
                if (l === trunk) return { wire: { ...l.wire, target: inlet }, cells: l.cells.slice(0, i) };
                if (l === branch) return { wire: { ...l.wire, source: direct }, cells: l.cells.slice(j) };
                const index = rest.indexOf(l);
                return index < 0 ? l : { ...l, wire: { ...l.wire, source: order[index]! } };
              }),
            },
            changed,
          };
        }
      }
    }
    // 原位只试三种两两互换。第三支路与主管可原样复用。
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]] as const) {
      const left = arms[a]!, right = arms[b]!;
      yield {
        layout: { network, lines: lines.map(l => l === left || l === right
          ? { ...l, wire: { ...l.wire, source: (l === left ? right : left).wire.source } } : l) },
        changed: [lines.indexOf(left), lines.indexOf(right)],
      };
    }
  }
}

/** 在供料进线与同料支路靠近的位置提前分流，沿真实支路布置限速与缓冲。 */
export function* splitEdits(registry: RegistryContract, layout: DeliveryLayout): Generator<DeliveryEdit> {
  const { network, lines } = layout;
  if (network.request.manualLayout?.mode === "topology" && network.request.manualLayout.enabled) return;
  for (const original of network.nodes) {
    if (!movable(original) || registry.queries.resolveLogisticsRole(original.definition.id) !== "splitter") continue;
    const incoming = lines.filter((l) => l.wire.target.entityId === original.entity.id);
    const outgoing = lines.filter((l) => l.wire.source.entityId === original.entity.id);
    if (incoming.length !== 1 || outgoing.length < 2) continue;
    const trunk = incoming[0]!,
      item = trunk.wire.itemIds[0];
    if (
      !item ||
      trunk.wire.itemIds.length !== 1 ||
      outgoing.some((l) => l.wire.itemIds.length !== 1 || l.wire.itemIds[0] !== item)
    )
      continue;
    for (const branch of outgoing) {
      const branchCells = new Map(branch.cells.map((p, i) => [cellKey(p), i]));
      for (const [i, tap] of trunk.cells.entries()) {
        const nearby = [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ]
          .map(([dx, dy]) => branchCells.get(cellKey({ x: tap.x + dx!, y: tap.y + dy! })))
          .filter((v): v is number => v !== undefined);
        for (const j of nearby) {
          if (trunk.cells.length - i + j < 4) continue;
          const upstream = trunk.cells[i - 1] ?? trunk.wire.source.cell;
          const downstream = trunk.cells[i + 1] ?? original.entity.position;
          for (const rot of ROTATIONS) {
            const node = createPlainNode(
              registry,
              original.definition.id,
              availableId(network.nodes, "delivery-split"),
              "logistics",
            );
            node.entity.position = tap;
            node.entity.rotation = rot;
            const inlet = getPlannerPorts(registry, node.entity, node.definition, "input")[0]!;
            if (cellKey(inlet.outside) !== cellKey(upstream)) continue;
            const outlets = getPlannerPorts(registry, node.entity, node.definition, "output");
            const arm = outlets.find((p) => cellKey(p.outside) === cellKey(branch.cells[j]!));
            const remaining = outlets.find((p) => cellKey(p.outside) === cellKey(downstream));
            if (!arm || !remaining || arm === remaining) continue;
            const rate = branch.wire.perMinute,
              rest = trunk.wire.perMinute - rate;
            if (rate <= 0 || rest <= 0) continue;
            node.inputs.push({ itemId: item, perMinute: trunk.wire.perMinute });
            node.outputs.push(...node.inputs);
            for (const p of outlets) {
              restrictPort(registry, node, p, p === arm || p === remaining ? [item] : []);
              node.entity.config[`portGroups[${p.groupIndex}].ports[${p.portIndex}].priorityGroup`] = 1;
            }
            const untouched = lines.filter((l) => l !== trunk && l !== branch);
            const inletLine = { wire: { ...trunk.wire, target: inlet }, cells: trunk.cells.slice(0, i) };
            const restLine = {
              wire: { ...trunk.wire, source: remaining, perMinute: rest },
              cells: trunk.cells.slice(i + 1),
            };
            const armLine = { wire: { ...branch.wire, source: arm }, cells: branch.cells.slice(j) };
            const balance = [{ itemId: item, perMinute: rest }];
            const residualNode = {
              ...original,
              entity: { ...original.entity, config: { ...original.entity.config } },
              inputs: balance,
              outputs: balance,
            };
            restrictPort(registry, residualNode, branch.wire.source, []);
            const fork = {
              ...network,
              nodes: network.nodes.map((n) => (n === original ? residualNode : n)).concat(node),
            };
            const restIndex = untouched.length + 1,
              armIndex = restIndex + 1;
            const result = { network: fork, lines: [...untouched, inletLine, restLine, armLine] };
            yield* meteredForks(registry, result, armIndex, restIndex, item);
            // 将下游分流器沿现有出口平移一格，可腾出上游准入口所需的缓冲。
            for (const leg of outgoing.filter((l) => l !== branch && l.cells.length)) {
              const to = leg.cells[0]!,
                from = original.entity.position,
                dx = to.x - from.x,
                dy = to.y - from.y;
              const n = { ...residualNode, entity: { ...original.entity, position: to } };
              const shifted = { ...fork, nodes: fork.nodes.map((v) => (v === residualNode ? n : v)) };
              for (let bend = 0; bend < restLine.cells.length; bend++) {
                const main = [
                  ...restLine.cells.slice(0, bend + 1),
                  ...restLine.cells.slice(bend).map((p) => ({ x: p.x + dx, y: p.y + dy })),
                ];
                const adjusted = result.lines.map((l) => {
                  if (l === restLine) return { ...l, cells: main };
                  if (l === leg) return { ...l, cells: l.cells.slice(1) };
                  if (l.wire.source.entityId === original.entity.id) return { ...l, cells: [from, ...l.cells] };
                  return l;
                });
                yield* meteredForks(
                  registry,
                  { network: shifted, lines: refreshDeliveryLines(registry, { network: shifted, lines: adjusted }) },
                  armIndex,
                  restIndex,
                  item,
                );
              }
            }
          }
        }
      }
    }
  }
}
function availableId(nodes: readonly PlannerNode[], prefix: string) {
  let id = prefix;
  while (nodes.some((n) => n.entity.id === id)) id += "_";
  return id;
}

function* meteredForks(
  registry: RegistryContract,
  layout: DeliveryLayout,
  armIndex: number,
  restIndex: number,
  item: string,
): Generator<DeliveryEdit> {
  yield { layout, changed: [] };
  const withValve = (index: number) => {
    const line = layout.lines[index]!,
      limit = line.wire.perMinute,
      minimum = Math.ceil(limit / 6);
    if (minimum < 1 || limit % 6 !== 0) return null;
    const def = findLogisticsDevice(registry, line.wire.source.kind, "admission");
    for (let k = minimum; k < line.cells.length; k++) {
      const valve = createPlainNode(
        registry,
        def.id,
        availableId(layout.network.nodes, index === armIndex ? "delivery-branch-limit" : "delivery-trunk-limit"),
        "logistics",
      );
      valve.entity.position = line.cells[k]!;
      for (const rotation of ROTATIONS) {
        valve.entity.rotation = rotation;
        const inlet = getPlannerPorts(registry, valve.entity, def, "input")[0]!,
          outlet = getPlannerPorts(registry, valve.entity, def, "output")[0]!;
        if (
          cellKey(inlet.outside) !== cellKey(line.cells[k - 1]!) ||
          cellKey(outlet.outside) !== cellKey(line.cells[k + 1] ?? line.wire.target.cell)
        )
          continue;
        valve.inputs.push({ itemId: item, perMinute: limit });
        valve.outputs.push(...valve.inputs);
        restrictPort(registry, valve, inlet, [item]);
        restrictPort(registry, valve, outlet, [item]);
        valve.entity.config[`portGroups[${inlet.groupIndex}].ports[${inlet.portIndex}].admissionRule`] = {
          itemId: item,
          limit: null,
          perMinuteLimit: limit,
        };
        const replacements: DeliveryLine[] = [
          { wire: { ...line.wire, target: inlet, minimumCells: minimum }, cells: line.cells.slice(0, k) },
          { wire: { ...line.wire, source: outlet, minimumCells: 0 }, cells: line.cells.slice(k + 1) },
        ];
        return { valve, index, replacements };
      }
    }
    return null;
  };
  const arm = withValve(armIndex),
    rest = withValve(restIndex);
  for (const selected of [[arm, rest], [arm], [rest]]) {
    if (selected.some((v) => !v)) continue;
    const added = selected.filter((v) => !!v);
    yield {
      layout: {
        network: { ...layout.network, nodes: [...layout.network.nodes, ...added.map((v) => v.valve)] },
        lines: layout.lines.flatMap((line, i) => added.find((v) => v.index === i)?.replacements ?? [line]),
      },
      changed: [],
    };
  }
}
