import type { GridPoint } from "@/domain/shared/grid";
import type { WorldEntity } from "@/domain/document/world-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { allowsPlannerOverlap, cellKey, getPlannerPorts } from "./geometry";
import type { PlannerNetwork, PlannerWire } from "./model";
import { PlannerRouter } from "./router";
import { blueprintPortKey } from "./blueprint-optimizations";

export interface DeliveryLine { wire: PlannerWire; cells: readonly GridPoint[] }
export interface DeliveryLayout { network: PlannerNetwork; lines: DeliveryLine[] }

export function deliveryCost(registry: RegistryContract, entities: readonly WorldEntity[], turns: number) {
  return { bridges: entities.filter(e => registry.queries.resolveLogisticsRole(e.definitionId) === "connector").length,
    entities: entities.length, turns };
}
export function compareDeliveryCost(a: ReturnType<typeof deliveryCost>, b: ReturnType<typeof deliveryCost>) {
  return a.bridges - b.bridges || a.entities - b.entities || a.turns - b.turns;
}

export function deliveryRouteKey(wire: PlannerWire) {
  return `${blueprintPortKey(wire.source)}>${blueprintPortKey(wire.target)}`;
}

/** 移动物流设备时，按组和端口的稳定身份重新取得真实旋转后的端点。 */
export function refreshDeliveryLines(registry: RegistryContract, layout: DeliveryLayout): DeliveryLine[] {
  const nodes = new Map(layout.network.nodes.map(n => [n.entity.id, n]));
  const refresh = (p: PlannerWire["source"]) => {
    const n = nodes.get(p.entityId)!;
    return getPlannerPorts(registry, n.entity, n.definition, p.direction)
      .find(q => p.groupIndex === q.groupIndex && p.portIndex === q.portIndex)!;
  };
  return layout.lines.map(({ wire, cells }) => ({ cells, wire: { ...wire, source: refresh(wire.source), target: refresh(wire.target) } }));
}

export function fitsDeliveryNode(registry: RegistryContract, entity: WorldEntity, fixed: readonly WorldEntity[]) {
  const definition = registry.queries.findEntityDefinition(entity.definitionId)!;
  const a = resolveEntityGridRect({ entity, definition });
  return fixed.every(other => {
    const def = registry.queries.findEntityDefinition(other.definitionId)!;
    const b = resolveEntityGridRect({ entity: other, definition: def });
    return a.x >= b.x + b.width || b.x >= a.x + a.width || a.y >= b.y + b.height || b.y >= a.y + a.height
      || allowsPlannerOverlap(registry, definition, def);
  });
}

/** 冻结无关线路，联合求解受影响的线路。对同族冲突格分别禁止其中一路占用并回溯。 */
export function routeDeliveryGroup(registry: RegistryContract, layout: DeliveryLayout, fixed: readonly WorldEntity[],
  width: number, height: number, changed: readonly number[], spend: () => boolean): PlannerRouter | null {
  const indices = new Set(changed);
  const router = () => new PlannerRouter(registry, [...layout.network.nodes.map(n => n.entity), ...fixed],
    layout.lines.flatMap(({ wire }) => [wire.source, wire.target]),
    { minimumX: 0, minimumY: 0, maximumX: width - 1, maximumY: height - 1, escapeLength: 0 });
  const base = router();
  const replay = (r: PlannerRouter, i: number, cells: readonly GridPoint[]) => {
    const { wire } = layout.lines[i]!;
    return r.reuse(wire.source, wire.target, cells, wire.minimumCells);
  };
  for (const [i, line] of layout.lines.entries()) if (!indices.has(i) && !replay(base, i, line.cells)) return null;
  if (!changed.length) return base;
  const queue: Map<number, Set<string>>[] = [new Map()];
  let best: PlannerRouter | null = null;
  let bestCost: ReturnType<typeof deliveryCost> | null = null;
  const cache = new Map<string, readonly GridPoint[] | null>();
  for (let index = 0; index < queue.length && index < 48 && spend(); index++) {
    const bans = queue[index]!, owners = new Map<string, number>(), paths = new Map<number, readonly GridPoint[]>();
    let conflict: { key: string; a: number; b: number } | undefined;
    for (const i of changed) {
      const { wire } = layout.lines[i]!, blocked = bans.get(i) ?? new Set<string>();
      const cacheKey = i + ":" + [...blocked].sort().join("/");
      if (!cache.has(cacheKey)) cache.set(cacheKey, base.deliveryPath(wire.source, wire.target, wire.minimumCells ?? 0, blocked, spend));
      const path = cache.get(cacheKey);
      if (!path) break;
      paths.set(i, path);
      for (const p of path) {
        const key = cellKey(p), layer = wire.source.kind + key, previous = owners.get(layer);
        if (!conflict && previous !== undefined && previous !== i) conflict = { key, a: previous, b: i };
        owners.set(layer, i);
      }
    }
    if (paths.size !== changed.length) continue;
    const candidate = router();
    if (layout.lines.every((line, i) => replay(candidate, i, paths.get(i) ?? line.cells))) {
      const cost = deliveryCost(registry, candidate.entities, candidate.routes.reduce((sum, line) => sum + line.turns, 0));
      if (!bestCost || compareDeliveryCost(cost, bestCost) < 0) { best = candidate; bestCost = cost; }
    }
    if (!conflict) break;
    for (const i of [conflict.a, conflict.b]) {
      const child = new Map(bans);
      child.set(i, new Set(bans.get(i)).add(conflict.key));
      queue.push(child);
    }
  }
  return best;
}
