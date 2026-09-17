import type { WorldEntity } from "@/domain/document/world-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { GridPoint, GridRect } from "@/domain/shared/grid";
import type { LogisticsKind } from "@/domain/shared/logistics";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { cellKey, DELTAS, EDGES, findLogisticsDevice, opposite, resolveTransportPose, type PlannerPort } from "./geometry";
import { PlannerCandidateError } from "./model";

interface RouteCell {
  readonly entity: WorldEntity;
  readonly routeId: string;
  readonly direction: number;
  readonly straight: boolean;
  crossed: boolean;
}

interface SearchEntry {
  readonly steps?: number;
  readonly point: GridPoint;
  readonly direction: number;
  readonly cost: number;
  readonly estimate: number;
  readonly parent: SearchEntry | null;
}

/** A* 队列；相同估价保留确定性的插入顺序。 */
// 订正 2026-09-16：同估价由确定性的堆遍历顺序决定，不保证插入顺序。
class SearchQueue {
  private readonly entries: SearchEntry[] = [];
  get size(): number { return this.entries.length; }
  push(entry: SearchEntry): void {
    let index = this.entries.length;
    this.entries.push(entry);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.entries[parent]!.estimate <= entry.estimate) break;
      this.entries[index] = this.entries[parent]!;
      index = parent;
    }
    this.entries[index] = entry;
  }
  pop(): SearchEntry {
    const first = this.entries[0]!;
    const tail = this.entries.pop()!;
    if (this.entries.length === 0) return first;
    let index = 0;
    while (index * 2 + 1 < this.entries.length) {
      let child = index * 2 + 1;
      if (child + 1 < this.entries.length && this.entries[child + 1]!.estimate < this.entries[child]!.estimate) child++;
      if (tail.estimate <= this.entries[child]!.estimate) break;
      this.entries[index] = this.entries[child]!;
      index = child;
    }
    this.entries[index] = tail;
    return first;
  }
}

export class PlannerRouter {
  readonly routes: Array<{ source: string; target: string; sourcePort: string; targetPort: string;
    sourceEdge: PlannerPort["edge"]; targetEdge: PlannerPort["edge"]; cells: readonly GridPoint[]; turns: number }> = [];
  readonly conflicts = new Map<string, Set<string>>();
  private activeRoute = "";
  private readonly blocked = new Set<string>();
  private readonly paths = new Map<string, Map<LogisticsKind, RouteCell>>();
  private readonly reserved = new Map<string, Set<LogisticsKind>>();
  private readonly generated: WorldEntity[] = [];
  private readonly bounds: GridRect;
  private readonly escapes = new Map<string, GridPoint>();
  private readonly generalLogistics = new Set<string>();

  constructor(private readonly registry: RegistryContract, entities: readonly WorldEntity[], ports: readonly PlannerPort[],
    private readonly boundary: { readonly minimumX: number; readonly minimumY?: number; readonly maximumX?: number; readonly maximumY?: number; readonly escapeLength?: number;
      readonly history?: ReadonlyMap<string, number> } = { minimumX: 0 }) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const entity of entities) {
      const definition = registry.queries.findEntityDefinition(entity.definitionId);
      if (definition === null) throw new Error(`未知设备：${entity.definitionId}`);
      if (registry.queries.isGeneralLogisticsDevice(definition.id)) this.generalLogistics.add(entity.id);
      const rect = resolveEntityGridRect({ entity, definition });
      minX = Math.min(minX, rect.x); minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.width); maxY = Math.max(maxY, rect.y + rect.height);
      for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) this.blocked.add(cellKey({ x, y }));
      }
    }
    this.bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    for (const port of ports) this.reserve(cellKey(port.outside), port.kind);
    for (const port of ports) this.prepareEscape(port);
  }

  get entities(): readonly WorldEntity[] { return this.generated; }

  async connect(source: PlannerPort, target: PlannerPort, checkBudget: () => void, minimumCells = 0): Promise<number> {
    this.activeRoute = `${portId(source)}>${portId(target)}`;
    this.conflicts.clear();
    if (source.kind !== target.kind) throw new Error("不能连接不同物流类型的端口。");
    if (cellKey(source.outside) === cellKey(target.cell) && opposite(source.edge) === target.edge) {
      if (minimumCells > 0) throw new PlannerCandidateError(`准入口前需要至少 ${minimumCells} 格物流。`);
      if (!this.generalLogistics.has(source.entityId) && !this.generalLogistics.has(target.entityId)) {
        throw new PlannerCandidateError("两个非物流设备之间必须经过传送带或管道。");
      }
      this.routes.push({ source: source.entityId, target: target.entityId, sourcePort: portId(source), targetPort: portId(target),
        sourceEdge: source.edge, targetEdge: target.edge, cells: [], turns: 0 });
      return 0;
    }
    const start = this.escapes.get(portId(source)) ?? source.outside, goal = this.escapes.get(portId(target)) ?? target.outside;
    const startKey = cellKey(start), goalKey = cellKey(goal);
    if (this.blocked.has(startKey) || this.blocked.has(goalKey)) throw new PlannerCandidateError("端口外侧被设备阻挡。");
    let margin = 8;
    const routeDeadline = performance.now() + 1500;
    // 空间没有固定上限；逐步扩展搜索区域，终止由任务预算或取消决定。
    for (;;) {
      checkBudget();
      if (performance.now() >= routeDeadline) throw new PlannerCandidateError(`物流通道受阻：${source.entityId} → ${target.entityId}`);
      const queue = new SearchQueue();
      const best = new Map<string, number>();
      const startDirection = EDGES.indexOf(source.edge);
      queue.push({ point: start, direction: startDirection, cost: 0, estimate: distance(start, goal), parent: null, steps: 1 });
      best.set(`${startKey}/${startDirection}/${Math.min(1, minimumCells)}`, 0);
      let expanded = 0;
      while (queue.size > 0) {
        const current = queue.pop();
        const key = cellKey(current.point);
        if (best.get(`${key}/${current.direction}/${Math.min(current.steps!, minimumCells)}`)! < current.cost) continue;
        const finalDirection = EDGES.indexOf(opposite(target.edge));
        if (key === goalKey && current.steps! >= minimumCells && this.canLeave(key, source.kind, current.direction, finalDirection)) {
          const sequence: SearchEntry[] = [];
          for (let entry: SearchEntry | null = current; entry; entry = entry.parent) sequence.push(entry);
          sequence.reverse();
          this.routes.push({ source: source.entityId, target: target.entityId, sourcePort: portId(source), targetPort: portId(target),
            sourceEdge: source.edge, targetEdge: target.edge, cells: sequence.map(entry => entry.point),
            turns: sequence.reduce((sum, entry, index) => sum + Number(entry.direction !== (sequence[index + 1]?.direction ?? finalDirection)), 0) });
          return this.commit(current, source.kind, finalDirection) + distance(start, source.outside) + distance(goal, target.outside);
        }
        for (let nextDirection = 0; nextDirection < 4; nextDirection++) {
          if (!this.canLeave(key, source.kind, current.direction, nextDirection)) { this.recordConflict(key); continue; }
          const delta = DELTAS[nextDirection]!;
          const point = { x: current.point.x + delta.x, y: current.point.y + delta.y };
          if (point.x < this.boundary.minimumX || point.x > (this.boundary.maximumX ?? Infinity) || point.y < (this.boundary.minimumY ?? -Infinity) || point.y < this.bounds.y - margin
            || point.y > (this.boundary.maximumY ?? Infinity) || point.x > this.bounds.x + this.bounds.width + margin || point.y > this.bounds.y + this.bounds.height + margin) continue;
          const nextKey = cellKey(point);
          if (minimumCells > 0) {
            let repeated = false;
            for (let parent: SearchEntry | null = current; parent; parent = parent.parent) {
              if (parent.point.x === point.x && parent.point.y === point.y) { repeated = true; break; }
            }
            if (repeated) continue;
          }
          if (this.blocked.has(nextKey) || (this.reserved.get(nextKey)?.has(source.kind) && nextKey !== startKey && nextKey !== goalKey)) continue;
          if (!this.canEnter(nextKey, source.kind, nextDirection)) { this.recordConflict(nextKey); continue; }
          const cost = current.cost + 1 + (nextDirection === current.direction ? 0 : key === startKey ? 3 : 1)
            + (this.paths.has(nextKey) ? 0.2 : 0) + (this.boundary.history?.get(`${this.activeRoute}|${nextKey}`) ?? 0);
          const stateKey = `${nextKey}/${nextDirection}/${Math.min(current.steps! + 1, minimumCells)}`;
          if ((best.get(stateKey) ?? Infinity) <= cost) continue;
          best.set(stateKey, cost);
          queue.push({ point, direction: nextDirection, cost, estimate: cost + distance(point, goal), parent: current, steps: current.steps! + 1 });
        }
        if (++expanded % 2048 === 0) {
          checkBudget();
          if (performance.now() >= routeDeadline) throw new PlannerCandidateError(`物流通道受阻：${source.entityId} → ${target.entityId}`);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
      if (this.boundary.maximumX !== undefined && this.boundary.maximumY !== undefined) {
        throw new PlannerCandidateError(`物流通道受阻：${source.entityId} → ${target.entityId}`);
      }
      margin *= 2;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  private canEnter(key: string, kind: LogisticsKind, direction: number): boolean {
    const routes = this.paths.get(key);
    if (routes === undefined) return true;
    const same = routes.get(kind);
    if (same !== undefined) return same.straight && !same.crossed && same.direction % 2 !== direction % 2;
    // 异族重叠只使用双方注册表明确允许的组合。
    const other = [...routes.values()][0]!;
    const otherDefinition = this.registry.queries.findEntityDefinition(other.entity.definitionId)!;
    const straight = this.registry.queries.findEntityDefinition(this.registry.queries.resolveLogisticsDefinitionId(kind, "straight"))!;
    const has = (definition: typeof straight, type: string) => definition.placementBehaviors.some((behavior) => behavior.type === type);
    return (has(straight, "allow-belt-overlap") && has(otherDefinition, "allow-pipe-overlap"))
      || (has(straight, "allow-pipe-overlap") && has(otherDefinition, "allow-belt-overlap"));
  }

  private recordConflict(key: string): void {
    for (const route of this.paths.get(key)?.values() ?? []) {
      if (!route.routeId || route.routeId === this.activeRoute) continue;
      const cells = this.conflicts.get(route.routeId) ?? new Set<string>();
      cells.add(key); this.conflicts.set(route.routeId, cells);
    }
  }

  private reserve(key: string, kind: LogisticsKind): void {
    const kinds = this.reserved.get(key) ?? new Set<LogisticsKind>();
    kinds.add(kind); this.reserved.set(key, kinds);
  }

  private prepareEscape(port: PlannerPort): void {
    if (this.escapes.has(portId(port))) return;
    const outward = EDGES.indexOf(port.edge), delta = DELTAS[outward]!;
    const direction = port.direction === "output" ? outward : (outward + 2) % 4;
    let point = port.outside;
    for (let step = 0; step < (this.boundary.escapeLength ?? 2); step++) {
      const next = { x: point.x + delta.x, y: point.y + delta.y };
      if (this.blocked.has(cellKey(point)) || this.blocked.has(cellKey(next))
        || this.reserved.get(cellKey(next))?.has(port.kind) || this.paths.has(cellKey(next))
        || !this.canEnter(cellKey(point), port.kind, direction)) break;
      this.commit({ point, direction, cost: 0, estimate: 0, parent: null }, port.kind, direction);
      point = next;
    }
    this.escapes.set(portId(port), point);
    this.reserve(cellKey(point), port.kind);
  }

  private canLeave(key: string, kind: LogisticsKind, incoming: number, outgoing: number): boolean {
    if ((incoming + 2) % 4 === outgoing) return false;
    const routes = this.paths.get(key);
    const same = routes?.get(kind);
    if (same === undefined) return true;
    // 桥接器必须直穿。若另一族也占据该格，还需确认桥接器支持该重叠。
    if (routes!.size > 1) return false;
    return same.straight && !same.crossed && incoming === outgoing && same.direction % 2 !== incoming % 2;
  }

  private commit(tail: SearchEntry, kind: LogisticsKind, finalDirection: number): number {
    const sequence: SearchEntry[] = [];
    for (let entry: SearchEntry | null = tail; entry !== null; entry = entry.parent) sequence.push(entry);
    sequence.reverse();
    for (let index = 0; index < sequence.length; index++) {
      const current = sequence[index]!;
      const direction = sequence[index + 1]?.direction ?? finalDirection;
      const key = cellKey(current.point);
      const existing = this.paths.get(key)?.get(kind);
      if (existing !== undefined) {
        existing.entity.definitionId = findLogisticsDevice(this.registry, kind, "connector").id;
        existing.entity.rotation = 0;
        existing.crossed = true;
        continue;
      }
      const pose = resolveTransportPose(this.registry, kind, opposite(EDGES[current.direction]!), EDGES[direction]!);
      const entity: WorldEntity = {
        id: `eda-route-${this.generated.length}`, ...pose, position: current.point, config: {}, tags: [],
      };
      this.generated.push(entity);
      const routes = this.paths.get(key) ?? new Map<LogisticsKind, RouteCell>();
      routes.set(kind, { entity, routeId: this.activeRoute, direction, straight: direction === current.direction, crossed: false });
      this.paths.set(key, routes);
    }
    return sequence.length;
  }
}

function distance(a: GridPoint, b: GridPoint): number { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
function portId(port: PlannerPort): string { return `${port.entityId}/${port.groupIndex}/${port.portIndex}`; }
