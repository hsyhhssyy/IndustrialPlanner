import type { GridPoint } from "@/domain/shared/grid";
import type { WorldEntity } from "@/domain/document/world-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { allowsPlannerOverlap, cellKey, getPlannerPorts, opposite, EDGES, DELTAS } from "./geometry";
import type { PlannerNetwork, PlannerWire } from "./model";
import { PlannerRouter } from "./router";
import { blueprintPortKey } from "./blueprint-optimizations";

export interface DeliveryLine {
  wire: PlannerWire;
  cells: readonly GridPoint[];
}
export interface DeliveryLayout {
  network: PlannerNetwork;
  lines: DeliveryLine[];
}

export function deliveryCost(registry: RegistryContract, entities: readonly WorldEntity[], turns: number) {
  let bridges = 0;
  let logisticsControls = 0;
  for (const entity of entities) {
    const role = registry.queries.resolveLogisticsRole(entity.definitionId);
    if (role === "connector") bridges++;
    if (role === "splitter" || role === "converger" || role === "admission") logisticsControls++;
  }
  return {
    bridges,
    logisticsDevices: bridges + logisticsControls,
    logisticsControls,
    entities: entities.length,
    turns,
  };
}
export function compareDeliveryCost(a: ReturnType<typeof deliveryCost>, b: ReturnType<typeof deliveryCost>) {
  return a.logisticsDevices - b.logisticsDevices || a.bridges - b.bridges || a.entities - b.entities || a.turns - b.turns;
}

export function deliveryRouteKey(wire: PlannerWire) {
  return `${blueprintPortKey(wire.source)}>${blueprintPortKey(wire.target)}`;
}

/** 移动物流设备时，按组和端口的稳定身份重新取得真实旋转后的端点。 */
export function refreshDeliveryLines(registry: RegistryContract, layout: DeliveryLayout): DeliveryLine[] {
  const nodes = new Map(layout.network.nodes.map((n) => [n.entity.id, n]));
  const refresh = (p: PlannerWire["source"]) => {
    const n = nodes.get(p.entityId)!;
    return getPlannerPorts(registry, n.entity, n.definition, p.direction).find(
      (q) => p.groupIndex === q.groupIndex && p.portIndex === q.portIndex,
    )!;
  };
  return layout.lines.map(({ wire, cells }) => ({
    cells,
    wire: { ...wire, source: refresh(wire.source), target: refresh(wire.target) },
  }));
}

export function fitsDeliveryNode(registry: RegistryContract, entity: WorldEntity, fixed: readonly WorldEntity[]) {
  const definition = registry.queries.findEntityDefinition(entity.definitionId)!;
  const a = resolveEntityGridRect({ entity, definition });
  return fixed.every((other) => {
    const def = registry.queries.findEntityDefinition(other.definitionId)!;
    const b = resolveEntityGridRect({ entity: other, definition: def });
    return (
      a.x >= b.x + b.width ||
      b.x >= a.x + a.width ||
      a.y >= b.y + b.height ||
      b.y >= a.y + a.height ||
      allowsPlannerOverlap(registry, definition, def)
    );
  });
}

/** 冻结无关线路，联合求解受影响的线路。对同族冲突格分别禁止其中一路占用并回溯。 */
export function routeDeliveryGroup(
  registry: RegistryContract,
  layout: DeliveryLayout,
  fixed: readonly WorldEntity[],
  width: number,
  height: number,
  changed: readonly number[],
  spend: () => boolean,
  markTruncated?: () => void,
): PlannerRouter | null {
  const indices = new Set(changed);
  const router = () =>
    new PlannerRouter(
      registry,
      [...layout.network.nodes.map((n) => n.entity), ...fixed],
      layout.lines.flatMap(({ wire }) => [wire.source, wire.target]),
      { minimumX: 0, minimumY: 0, maximumX: width - 1, maximumY: height - 1, escapeLength: 0 },
    );
  const base = router();
  const replay = (r: PlannerRouter, i: number, cells: readonly GridPoint[]) => {
    const { wire } = layout.lines[i]!;
    return r.reuse(wire.source, wire.target, cells, wire.minimumCells);
  };
  for (const [i, line] of layout.lines.entries()) if (!indices.has(i) && !replay(base, i, line.cells)) return null;
  if (!changed.length) return base;
  const queue: Map<number, Set<string>>[] = [new Map()];
  const scheduled = new Set<string>();
  let best: PlannerRouter | null = null;
  let bestCost: ReturnType<typeof deliveryCost> | null = null;
  const cache = new Map<string, readonly GridPoint[] | null>();
  for (let index = 0; index < queue.length && index < 48 && spend(); index++) {
    const bans = queue[index]!,
      owners = new Map<string, number>(),
      paths = new Map<number, readonly GridPoint[]>();
    const conflicts: { key: string; a: number; b: number }[] = [];
    for (const i of changed) {
      const { wire } = layout.lines[i]!,
        blocked = bans.get(i) ?? new Set<string>();
      const cacheKey = i + ":" + [...blocked].sort().join("/");
      if (!cache.has(cacheKey))
        cache.set(cacheKey, base.deliveryPath(wire.source, wire.target, wire.minimumCells ?? 0, blocked, spend));
      const path = cache.get(cacheKey);
      if (!path) break;
      paths.set(i, path);
      for (const p of path) {
        const key = cellKey(p),
          layer = wire.source.kind + key,
          previous = owners.get(layer);
        if (previous !== undefined && previous !== i) conflicts.push({ key, a: previous, b: i });
        owners.set(layer, i);
      }
    }
    if (paths.size !== changed.length) continue;
    const candidate = router();
    if (layout.lines.every((line, i) => replay(candidate, i, paths.get(i) ?? line.cells))) {
      const cost = deliveryCost(
        registry,
        candidate.entities,
        candidate.routes.reduce((sum, line) => sum + line.turns, 0),
      );
      if (!bestCost || compareDeliveryCost(cost, bestCost) < 0) {
        best = candidate;
        bestCost = cost;
      }
    }
    // 一座必须保留的桥不能挡住对后续交叉的检查。每个分支只禁止一条线使用一个格。
    for (const conflict of conflicts) {
      for (const i of [conflict.a, conflict.b]) {
        if (queue.length >= 48) {
          markTruncated?.();
          break;
        }
        const child = new Map(bans);
        child.set(i, new Set(bans.get(i)).add(conflict.key));
        const signature = Array.from(child, ([route, cells]) => route + ":" + [...cells].sort().join("/"))
          .sort()
          .join("|");
        if (scheduled.has(signature)) continue;
        scheduled.add(signature);
        queue.push(child);
      }
      if (queue.length >= 48) break;
    }
  }
  return best;
}

/** 重建的旧种子只有逻辑线。沿真实物流方向补齐格子，桥接器始终沿进入轴直穿。 */
export function recoverDeliveryLines(
  registry: RegistryContract,
  wires: readonly PlannerWire[],
  tracks: readonly WorldEntity[],
): DeliveryLine[] {
  const cells = new Map(
    tracks.map((e) => [(registry.queries.isPipeFamily(e.definitionId) ? "pipe" : "belt") + cellKey(e.position), e]),
  );
  return wires.map((wire) => {
    const path: GridPoint[] = [],
      visited = new Set<string>();
    let point = wire.source.outside,
      heading = wire.source.edge;
    while (cellKey(point) !== cellKey(wire.target.cell) || heading !== opposite(wire.target.edge)) {
      const key = wire.source.kind + cellKey(point),
        e = cells.get(key);
      if (!e || visited.has(key)) throw new Error("无法从实体还原物流路径。");
      visited.add(key);
      path.push(point);
      if (registry.queries.resolveLogisticsRole(e.definitionId) !== "connector") {
        const def = registry.queries.findEntityDefinition(e.definitionId)!;
        const inlet = getPlannerPorts(registry, e, def, "input")[0];
        const outlet = getPlannerPorts(registry, e, def, "output")[0];
        if (inlet?.edge !== opposite(heading) || !outlet) throw new Error("物流端口朝向不匹配。");
        heading = outlet.edge;
      }
      const delta = DELTAS[EDGES.indexOf(heading)]!;
      point = { x: point.x + delta.x, y: point.y + delta.y };
    }
    return { wire, cells: path };
  });
}
