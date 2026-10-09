import type { WorldEntity } from "@/domain/document/world-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { GridPoint, GridRect } from "@/domain/shared/grid";
import type { LogisticsKind } from "@/domain/shared/logistics";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { allowsPlannerOverlap, cellKey, DELTAS, EDGES, findLogisticsDevice, opposite, resolveTransportPose, type PlannerPort } from "./geometry";
import { PlannerCandidateError } from "./model";
import { PlannerRoutingGrid, ROUTE_BLOCKED, ROUTE_RESERVED, ROUTE_OCCUPIED, ROUTE_OBSTACLE, ROUTE_OPEN, ROUTE_ENTER_SHIFT } from "./routing-grid";
import { PlannerRoutingSearch } from "./routing-search";
import type { PlannerRoutingBackend } from "./routing-backend";

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

/** 清空格子时的进入方向掩码：允许四个方向重新进入。 */
const ROUTE_EMPTY_ENTER = 15;

/** 压缩线路前记录的逐格数值状态；重排未变短时用于精确回滚。 */
interface PlannerRouteCellSnapshot { readonly x: number; readonly y: number; readonly values: readonly [number, number]; }

// AI-REMOVED 2026-10-03:
// Reason: 对象堆由可复用数值工作区替代。
// Trigger: 用户授权 CPU 数值结构和增量更新。
// Evidence: 原实现每步分配字符串状态与对象。
// Replacement: routing-search.ts
// Risk: 路径和冲突反馈需逐项对照。
// Human Review: Required
// Original code:
// /** A* 队列；相同估价保留确定性的插入顺序。 */
// // 订正 2026-09-16：同估价由确定性的堆遍历顺序决定，不保证插入顺序。
// class SearchQueue {
//   private readonly entries: SearchEntry[] = [];
//   get size(): number { return this.entries.length; }
//   push(entry: SearchEntry): void {
//     let index = this.entries.length;
//     this.entries.push(entry);
//     while (index > 0) {
//       const parent = Math.floor((index - 1) / 2);
//       if (this.entries[parent]!.estimate <= entry.estimate) break;
//       this.entries[index] = this.entries[parent]!;
//       index = parent;
//     }
//     this.entries[index] = entry;
//   }
//   pop(): SearchEntry {
//     const first = this.entries[0]!;
//     const tail = this.entries.pop()!;
//     if (this.entries.length === 0) return first;
//     let index = 0;
//     while (index * 2 + 1 < this.entries.length) {
//       let child = index * 2 + 1;
//       if (child + 1 < this.entries.length && this.entries[child + 1]!.estimate < this.entries[child]!.estimate) child++;
//       if (tail.estimate <= this.entries[child]!.estimate) break;
//       this.entries[index] = this.entries[child]!;
//       index = child;
//     }
//     this.entries[index] = tail;
//     return first;
//   }
// }
//

/** 一条已提交线路的记录；压缩回滚需要按原索引放回，因此显式命名。 */
export interface PlannerRouteRecord { source: string; target: string; sourcePort: string; targetPort: string;
  sourceEdge: PlannerPort["edge"]; targetEdge: PlannerPort["edge"]; minimumCells: number; cells: readonly GridPoint[]; turns: number }

/**
 * 清格留下的回滚凭据。
 * 订正 2026-10-06（评审 P1）：原实现只快照网格数值，而清理同时摘除了线路记录与 paths 索引，
 * 回滚只把数值写回，于是"压缩未变短"会永久丢掉该链路：网格仍显示占用、paths 已无该格、
 * routes 少了这条线，后续审计与复用全部失真。现在凭据覆盖网格数值、paths 条目、
 * 被摘除的线路记录（含原索引）与清格前的实体数。
 */
interface PlannerChainRollback {
  readonly routesBefore: number;
  readonly entitiesBefore: number;
  readonly cells: readonly PlannerRouteCellSnapshot[];
  readonly paths: readonly { readonly key: number; readonly kind: LogisticsKind; readonly value: RouteCell }[];
  readonly removed: readonly { readonly index: number; readonly route: PlannerRouteRecord }[];
  /** 订正 2026-10-07：被清格摘除索引的实体本体。压缩成功时必须把它们从 generated 里去掉。 */
  readonly entities: readonly WorldEntity[];
}

/** 订正 2026-10-07：commit 对既有实体的就地改写，供压缩回滚逆向重放。 */
interface PlannerEntityMutation {
  readonly entity: WorldEntity;
  readonly definitionId: string;
  readonly rotation: WorldEntity["rotation"];
  readonly cell: RouteCell;
  readonly crossed: boolean;
}

export class PlannerRouter {
  readonly routes: PlannerRouteRecord[] = [];
  readonly conflicts = new Map<string, Set<string>>();
  private activeRoute = "";
// AI-REMOVED 2026-10-03:
// Reason: 字符串格子集合改为共同数值状态；实体归属仍由 Router 维护。
// Trigger: 用户授权 CPU 数值结构和增量更新。
// Evidence: 原实现每步分配字符串状态与对象。
// Replacement: PlannerRoutingGrid 与本类 paths
// Risk: 路径和冲突反馈需逐项对照。
// Human Review: Required
// Original code:
//   private readonly blocked = new Set<string>();
//   private readonly permeable = new Map<string, Set<LogisticsKind>>();
//   private readonly paths = new Map<string, Map<LogisticsKind, RouteCell>>();
//   private readonly reserved = new Map<string, Set<LogisticsKind>>();
  private readonly grid = new PlannerRoutingGrid();
  private readonly search = new PlannerRoutingSearch();
  private readonly paths = new Map<number, Map<LogisticsKind, RouteCell>>();
  private readonly overlap = new Map<string, boolean>();
  private readonly generated: WorldEntity[] = [];
  /**
   * 订正 2026-10-07（PR #34 评审「线路压缩没有同步处理实体」）：
   * 实体 id 原为 `eda-route-${generated.length}`，靠「数组只增不减」隐含保证唯一。
   * 压缩成功现在会从数组中间摘除旧实体，长度回退会让后续 id 与存活实体重复，
   * 故改为单调递增序列号：不摘除时编号与原实现完全一致，摘除后也不再重复。
   */
  private entitySerial = 0;
  /**
   * 订正 2026-10-07（同上）：commit 遇到已被同种物流占用的格子时，会把那个既有实体就地改写成
   * 连接器（definitionId / rotation 与 RouteCell.crossed 都被改写）。原回滚只还原网格与索引，
   * 于是「压缩未变短」会把这处改写永久留下。这里按发生顺序记账，回滚时逆向重放；
   * 只在压缩阶段记账，避免普通布线过程无限累积。
   */
  private readonly entityMutations: PlannerEntityMutation[] = [];
  private journaling = false;
  private readonly bounds: GridRect;
  private readonly escapes = new Map<string, GridPoint>();
  private readonly generalLogistics = new Set<string>();
  /** 线路端点端口按稳定端口号索引；压缩后重建端点几何时使用。 */
  private readonly allPorts: readonly PlannerPort[];

  constructor(private readonly registry: RegistryContract, entities: readonly WorldEntity[], ports: readonly PlannerPort[],
    private readonly boundary: { readonly minimumX: number; readonly minimumY?: number; readonly maximumX?: number; readonly maximumY?: number; readonly escapeLength?: number;
      readonly history?: ReadonlyMap<string, number> } = { minimumX: 0 }, private readonly routing?: PlannerRoutingBackend) {
    this.allPorts = ports;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const entity of entities) {
      const definition = registry.queries.findEntityDefinition(entity.definitionId);
      if (definition === null) throw new Error(`未知设备：${entity.definitionId}`);
      if (registry.queries.isGeneralLogisticsDevice(definition.id)) this.generalLogistics.add(entity.id);
      const rect = resolveEntityGridRect({ entity, definition });
      minX = Math.min(minX, rect.x); minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.width); maxY = Math.max(maxY, rect.y + rect.height);
      const permeableKinds = (["belt", "pipe"] as const).filter(kind => allowsPlannerOverlap(registry, definition,
        registry.queries.findEntityDefinition(registry.queries.resolveLogisticsDefinitionId(kind, "straight"))!));
      for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
// AI-REMOVED 2026-10-03:
// Reason: 重叠设备的阻挡并集改为两种物流各自的位标记。
// Trigger: 用户授权 CPU 数值结构和增量更新。
// Evidence: 原实现每步分配字符串状态与对象。
// Replacement: grid.block
// Risk: 路径和冲突反馈需逐项对照。
// Human Review: Required
// Original code:
//           const key = cellKey({ x, y });
//           const allowed = new Set(permeableKinds);
//           if (this.blocked.has(key)) for (const kind of allowed) if (!this.permeable.get(key)?.has(kind)) allowed.delete(kind);
//           this.permeable.set(key, allowed);
//           this.blocked.add(key);
          this.grid.block(this.grid.cell(x, y), Number(permeableKinds.includes("belt")) | (Number(permeableKinds.includes("pipe")) << 1));
        }
      }
    }
    // 路由边界还包括端点；只有端口、没有实体障碍的空地也必须具有有限搜索框。
    for (const port of ports) {
      minX = Math.min(minX, port.outside.x); minY = Math.min(minY, port.outside.y);
      maxX = Math.max(maxX, port.outside.x + 1); maxY = Math.max(maxY, port.outside.y + 1);
    }
    this.bounds = { x: Number.isFinite(minX) ? minX : 0, y: Number.isFinite(minY) ? minY : 0,
      width: Number.isFinite(maxX - minX) ? maxX - minX : 0, height: Number.isFinite(maxY - minY) ? maxY - minY : 0 };
    for (const port of ports) this.reserve(this.grid.cell(port.outside.x, port.outside.y), port.kind);
    for (const port of ports) this.prepareEscape(port);
  }

  get entities(): readonly WorldEntity[] { return this.generated; }

  /**
   * 2026-10-06：布线完成后逐条尝试更短路径，消除先布线路被后续占用逼出的绕行与冗余皮带。
   * 清格前记录被改动的格子状态；重排未变短或失败时按快照逐格回滚，绝不让候选因压缩而丢线。
   * 订正 2026-10-06（评审 P1）：回滚范围不止网格数值，必须同时还原 paths 索引与线路记录，
   * 否则"未变短"这条常见路径会把线路记录丢掉；详见 removeChain / restoreChain。
   */
  async compactRoutes(checkBudget: () => void, fail: (message: string) => never): Promise<number> {
    const ports = this.portIndex();
    let improved = 0;
    const considered = new Set<number>();
    // 订正 2026-10-07：压缩阶段才需要对实体改写记账（见 entityMutations 说明）。
    this.journaling = true;
    for (let index = 0; index < this.routes.length; index++) {
      if (considered.has(index)) continue;
      considered.add(index);
      // 整条直通链一次重排，避免逐段改写造成链内端点不一致。
      const chain = [index];
      for (;;) {
        const tail = this.routes[chain.at(-1)!]!;
        const next = this.routes.findIndex((other, otherIndex) => !considered.has(otherIndex)
          && other.source === tail.target && other.sourcePort === tail.targetPort);
        // 直通节点只有这一进一出；端口分叉时不跨段改写。
        if (next < 0 || this.routes.filter(other => other.target === tail.target).length > 1
          || this.routes.filter(other => other.source === tail.target).length > 1) break;
        considered.add(next); chain.push(next);
      }
      const head = this.routes[chain[0]!]!, tail = this.routes[chain.at(-1)!]!;
      const source = ports.get(head.sourcePort), target = ports.get(tail.targetPort);
      if (!source || !target) continue;
      // 2026-10-06：准入缓冲下限是硬约束，重排必须按同一长度下限校验并回填。
      const minimumCells = Math.max(...chain.map(entry => this.routes[entry]!.minimumCells));
      const cells = chain.flatMap(entry => this.routes[entry]!.cells);
      if (!cells.length) continue;
      // 直接可连的线路没有可压缩空间；明显绕行的线路才值得再搜一次。
      if (cells.length <= Math.abs(source.outside.x - target.outside.x) + Math.abs(source.outside.y - target.outside.y) + 4) continue;
      checkBudget();
      const kinds = chain.map(entry => {
        const kind = ports.get(this.routes[entry]!.sourcePort)?.kind;
        if (!kind) fail(`压缩线路缺少端口定义：${this.routes[entry]!.sourcePort}`);
        return kind;
      });
      const journalMark = this.entityMutations.length;
      const rollback = this.removeChain(chain, kinds);
      let replaced = false;
      try {
        // 订正 2026-10-06（评审 P1）：重排成功即由 connectCpu 提交占用、实体与线路记录，
        // 因此这里不再调用 reuse——reuse 会二次 commit 并再 push 一条记录，令同一线路在
        // 实体与 routes 里各多一份。
        if (await this.connectCpu(source, target, checkBudget, minimumCells) < cells.length) replaced = true;
      } catch (error) {
        // 压缩失败不是候选失败；预算取消与程序错误必须继续上抛。
        if (error instanceof DOMException || !(error instanceof PlannerCandidateError)) throw error;
      }
      if (replaced) {
        // 订正 2026-10-07（PR #34 评审）：成功路径必须同时摘掉旧链路的实体。原实现只删了 paths 索引
        // 与线路记录，generated 里仍留着旧绕行实体（评审的最小复现：线路 14 格缩到 6 格，实体却由
        // 18 增到 24，并留下重叠）。只移除已不再被任何 paths 条目引用的实体，避免误删与其他线路
        // 共享的交叉格实体；网格占用与 paths 已由 removeChain 与 connectCpu 同步。
        const dropped = new Set(rollback.entities);
        if (dropped.size) {
          const referenced = new Set<WorldEntity>();
          for (const routed of this.paths.values()) for (const cell of routed.values()) referenced.add(cell.entity);
          for (let at = this.generated.length - 1; at >= 0; at--) {
            const entity = this.generated[at]!;
            if (dropped.has(entity) && !referenced.has(entity)) this.generated.splice(at, 1);
          }
        }
        this.entityMutations.length = journalMark;
        improved++;
        continue;
      }
      this.restoreChain(rollback, kinds, journalMark);
    }
    this.journaling = false;
    return improved;
  }

  /**
   * 链路按物流种类清格并返回回滚凭据；一条线路只占用它所属 kind 的格子。
   * 只保留端点外侧格：设备侧端口格不在任何线路上。
   * 订正 2026-10-06（评审 P1）：除网格数值外，还要记录被删除的 paths 条目与被摘除的线路记录，
   * 否则回滚无法还原三者一致的状态。
   */
  private removeChain(indices: readonly number[], kinds: readonly LogisticsKind[]): PlannerChainRollback {
    const ports = this.portIndex();
    // 订正 2026-10-07（PR #34 评审：escapeLength: 0 时同一场景无法压缩）：
    // 端点外侧格只保护「仍被其它线路引用」的那些。原实现无条件保留本链路自己的端点外侧格，
    // 而生产路径（candidate.ts / blueprint-candidate.ts / reference-analysis.ts 都用 escapeLength: 0）
    // 里路线端点就是该格，于是清格之后重排的起点/终点仍被自己刚摘除的占用挡着，
    // connectCpu 直接判定「端口外侧被设备阻挡」，压缩永远失败、只留下清格的副作用。
    const keep = new Set<string>();
    const shared = new Set<string>();
    for (const [other, route] of this.routes.entries()) {
      if (indices.includes(other)) continue;
      for (const cell of route.cells) shared.add(cellKey(cell));
    }
    for (const entry of indices) {
      const route = this.routes[entry]!;
      for (const value of [route.sourcePort, route.targetPort]) {
        const port = ports.get(value);
        if (port) keep.add(cellKey(port.outside));
      }
    }
    const entitiesBefore = this.generated.length;
    const routesBefore = this.routes.length;
    const cells: PlannerRouteCellSnapshot[] = [];
    const paths: Array<{ key: number; kind: LogisticsKind; value: RouteCell }> = [];
    // 订正 2026-10-07：连同实体本体一起收集，压缩成功时逐个从 generated 摘除。
    const entities: WorldEntity[] = [];
    for (const point of indices.flatMap(entry => this.routes[entry]!.cells)) {
      if (keep.has(cellKey(point))) continue;
      const key = this.grid.cell(point.x, point.y);
      cells.push({ x: point.x, y: point.y, values: [this.grid.read(key, 0), this.grid.read(key, 1)] });
      for (const kind of kinds) {
        const routed = this.paths.get(key);
        const cell = routed?.get(kind);
        if (!routed || cell === undefined) continue;
        paths.push({ key, kind, value: cell });
        entities.push(cell.entity);
        routed.delete(kind);
        if (!routed.size) this.paths.delete(key);
        this.grid.updateRoute(key, kindIndex(kind), ROUTE_EMPTY_ENTER, ROUTE_OPEN & 0xffff);
      }
    }
    const removed: Array<{ index: number; route: PlannerRouteRecord }> = [];
    for (const entry of [...indices].sort((left, right) => right - left)) {
      removed.unshift({ index: entry, route: this.routes[entry]! });
      this.routes.splice(entry, 1);
    }
    return { routesBefore, entitiesBefore, cells, paths, removed, entities };
  }

  /**
   * 按回滚凭据完整恢复：先丢弃重排新增的实体与线路记录，再写回网格数值与 paths 索引，
   * 最后按原索引把被摘除的线路记录放回。压缩未变短或复核不通过都必须走这里，
   * 不允许留下"网格占用与线路记录不一致"的中间态。
   */
  private restoreChain(rollback: PlannerChainRollback, kinds: readonly LogisticsKind[], journalMark: number): void {
    // 订正 2026-10-07（PR #34 评审「线路压缩没有同步处理实体」）：commit 会把交叉格上的既有实体
    // 就地改写成连接器，回滚必须逆向重放这些改写，否则线路记录已还原、实体定义却永久变成连接器。
    while (this.entityMutations.length > journalMark) {
      const mutation = this.entityMutations.pop()!;
      mutation.entity.definitionId = mutation.definitionId;
      mutation.entity.rotation = mutation.rotation;
      mutation.cell.crossed = mutation.crossed;
    }
    while (this.generated.length > rollback.entitiesBefore) this.generated.pop();
    const kept = rollback.routesBefore - rollback.removed.length;
    while (this.routes.length > kept) this.routes.pop();
    for (const cell of rollback.cells) {
      const key = this.grid.cell(cell.x, cell.y);
      for (const kind of kinds) this.grid.restoreValue(key, kindIndex(kind), cell.values[kindIndex(kind)]!);
    }
    for (const entry of rollback.paths) {
      const routed = this.paths.get(entry.key) ?? new Map<LogisticsKind, RouteCell>();
      routed.set(entry.kind, entry.value);
      this.paths.set(entry.key, routed);
    }
    for (const entry of rollback.removed) this.routes.splice(entry.index, 0, entry.route);
  }

  /** 线路端点端口按稳定端口号索引；压缩后重建端点几何时使用。 */
  private portIndex(): Map<string, PlannerPort> {
    const index = new Map<string, PlannerPort>();
    for (const port of this.allPorts) index.set(portId(port), port);
    return index;
  }

  /** 仅复用当前端口、边界、障碍及交叉都仍合法的完整线路；校验完成前不写占用。 */
  reuse(source: PlannerPort, target: PlannerPort, cells: readonly GridPoint[], minimumCells = 0): boolean {
    const prepared = this.prepareReuse(source, target, cells, minimumCells);
    if (!prepared) return false;
    this.activeRoute = `${portId(source)}>${portId(target)}`;
    this.commit(prepared.tail, source.kind, EDGES.indexOf(opposite(target.edge)));
    this.routes.push({ source: source.entityId, target: target.entityId, sourcePort: portId(source), targetPort: portId(target),
      sourceEdge: source.edge, targetEdge: target.edge, minimumCells, cells: cells.map(point => ({ ...point })), turns: prepared.turns });
    return true;
  }

  private prepareReuse(source: PlannerPort, target: PlannerPort, cells: readonly GridPoint[], minimumCells: number):
    { tail: SearchEntry; turns: number } | false {
    if (source.kind !== target.kind || cells.length < minimumCells) return false;
    if (!cells.length) return false;
    const first = cells[0]!, last = cells.at(-1)!;
    if (first.x !== source.outside.x || first.y !== source.outside.y || last.x !== target.outside.x || last.y !== target.outside.y) return false;
    const seen = new Set<number>();
    let incoming = EDGES.indexOf(source.edge), tail: SearchEntry | null = null, turns = 0;
    for (const [index, point] of cells.entries()) {
      const key = this.grid.cell(point.x, point.y), next = cells[index + 1];
      const outgoing = next ? DELTAS.findIndex(delta => point.x + delta.x === next.x && point.y + delta.y === next.y) : EDGES.indexOf(opposite(target.edge));
      if (outgoing < 0 || seen.has(key) || point.x < this.boundary.minimumX || point.y < (this.boundary.minimumY ?? -Infinity)
        || point.x > (this.boundary.maximumX ?? Infinity) || point.y > (this.boundary.maximumY ?? Infinity)
        || this.isBlocked(key, source.kind) || (index > 0 && index < cells.length - 1 && (this.grid.read(key, kindIndex(source.kind)) & ROUTE_RESERVED) !== 0)
        || !this.canEnter(key, source.kind, incoming) || !this.canLeave(key, source.kind, incoming, outgoing)) return false;
      seen.add(key); turns += Number(incoming !== outgoing);
      tail = { point, direction: incoming, cost: index, estimate: index, parent: tail, steps: index + 1 };
      incoming = outgoing;
    }
    // AI-REMOVED 2026-10-03:
    // Reason: 校验需供 GPU 同题计时复用，计时前不能修改占用。
    // Trigger: CPU/GPU 调度必须比较搜索与校验成本，提交成本不应只计在 CPU 上。
    // Evidence: reuse 原本混合校验和提交。Replacement: 上方 reuse 在校验完成后提交。
    // Risk: Low。Human Review: Required
    // Original code:
    // this.activeRoute = `${portId(source)}>${portId(target)}`;
    // this.commit(tail!, source.kind, EDGES.indexOf(opposite(target.edge)));
    // this.routes.push({ source: source.entityId, target: target.entityId, sourcePort: portId(source), targetPort: portId(target),
    //   sourceEdge: source.edge, targetEdge: target.edge, cells: cells.map(point => ({ ...point })), turns });
    // return true;
    return { tail: tail!, turns };
  }

  /** 初次布线排序的局部空间估计；复用真实静态占用与端口预留，不替代 A* 可达性验证。 */
  estimateEndpointFreedom(source: PlannerPort, target: PlannerPort): number {
    const terminals = new Set([this.grid.cell(source.outside.x, source.outside.y), this.grid.cell(target.outside.x, target.outside.y)]);
    const count = (port: PlannerPort): number => {
      const visited = new Set([this.grid.cell(port.outside.x, port.outside.y)]);
      let frontier = [port.outside];
      for (let depth = 0; depth < 2; depth++) {
        const next: GridPoint[] = [];
        for (const point of frontier) for (const delta of DELTAS) {
          const neighbor = { x: point.x + delta.x, y: point.y + delta.y }, key = this.grid.cell(neighbor.x, neighbor.y);
          if (visited.has(key) || this.isBlocked(key, port.kind) || ((this.grid.read(key, kindIndex(port.kind)) & ROUTE_RESERVED) !== 0 && !terminals.has(key))
            || neighbor.x < this.boundary.minimumX || neighbor.x > (this.boundary.maximumX ?? Infinity)
            || neighbor.y < (this.boundary.minimumY ?? -Infinity) || neighbor.y > (this.boundary.maximumY ?? Infinity)) continue;
          visited.add(key); next.push(neighbor);
        }
        frontier = next;
      }
      return visited.size - 1;
    };
    return Math.min(count(source), count(target));
  }

  async connect(source: PlannerPort, target: PlannerPort, checkBudget: () => void, minimumCells = 0): Promise<number> {
    checkBudget();
    this.activeRoute = `${portId(source)}>${portId(target)}`;
    this.conflicts.clear();
    const { minimumX: x, minimumY: y, maximumX, maximumY } = this.boundary;
    const cpu = () => this.connectCpu(source, target, checkBudget, minimumCells);
    // GPU 波前只覆盖有限图、无长度下限、无历史罚分的路径；其余约束仍走完整 CPU A*。
    if (!this.routing || minimumCells > 0 || source.kind !== target.kind || (this.boundary.escapeLength ?? 2) !== 0
      || this.boundary.history?.size || y === undefined || maximumX === undefined || maximumY === undefined
      || cellKey(source.outside) === cellKey(target.cell)) return cpu();
    const width = maximumX - x + 1, height = maximumY - y + 1;
    if (![x, y, width, height].every(Number.isSafeInteger) || width < 1 || height < 1 || width * height > 4096) return cpu();
    return this.routing.connect({ grid: this.grid, bounds: { x, y, width, height }, start: source.outside, goal: target.outside,
      startDirection: EDGES.indexOf(source.edge), finalDirection: EDGES.indexOf(opposite(target.edge)), kind: kindIndex(source.kind) },
    checkBudget, async () => {
      let searchMs = 0;
      const length = await this.connectCpu(source, target, checkBudget, minimumCells, milliseconds => { searchMs = milliseconds; });
      return { length, searchMs };
    }, cells => this.prepareReuse(source, target, cells, minimumCells) !== false,
    cells => this.reuse(source, target, cells, minimumCells));
  }

  private async connectCpu(source: PlannerPort, target: PlannerPort, checkBudget: () => void, minimumCells: number,
    searched?: (milliseconds: number) => void): Promise<number> {
    const searchStarted = performance.now();
    this.activeRoute = `${portId(source)}>${portId(target)}`;
    this.conflicts.clear();
    if (source.kind !== target.kind) throw new Error("不能连接不同物流类型的端口。");
    if (cellKey(source.outside) === cellKey(target.cell) && opposite(source.edge) === target.edge) {
      if (minimumCells > 0) throw new PlannerCandidateError(`准入口前需要至少 ${minimumCells} 格物流。`);
      if (!this.generalLogistics.has(source.entityId) && !this.generalLogistics.has(target.entityId)) {
        throw new PlannerCandidateError("两个非物流设备之间必须经过传送带或管道。");
      }
      this.routes.push({ source: source.entityId, target: target.entityId, sourcePort: portId(source), targetPort: portId(target),
        sourceEdge: source.edge, targetEdge: target.edge, minimumCells, cells: [], turns: 0 });
      return 0;
    }
    const start = this.escapes.get(portId(source)) ?? source.outside, goal = this.escapes.get(portId(target)) ?? target.outside;
    const startKey = this.grid.cell(start.x, start.y), goalKey = this.grid.cell(goal.x, goal.y);
    const kind = kindIndex(source.kind), queue = this.search;
    if (this.isBlocked(startKey, source.kind) || this.isBlocked(goalKey, source.kind)) throw new PlannerCandidateError("端口外侧被设备阻挡。");
    const startDirection = EDGES.indexOf(source.edge), finalDirection = EDGES.indexOf(opposite(target.edge));
    let margin = 8;
    const routeDeadline = performance.now() + 1500;
    // 空间没有固定上限；逐步扩展搜索区域，终止由任务预算或取消决定。
    for (;;) {
      checkBudget();
      if (performance.now() >= routeDeadline) throw new PlannerCandidateError(`物流通道受阻：${source.entityId} → ${target.entityId}`);
      queue.reset(minimumCells);
      queue.push(startKey, startDirection, 1, 0, distance(start, goal), -1);
      let expanded = 0;
      while (queue.size > 0) {
        const current = queue.pop();
        if (queue.stale(current)) continue;
        const key = queue.cells[current]!, incoming = queue.directions[current]!, steps = queue.steps[current]!;
        const x = this.grid.x[key]!, y = this.grid.y[key]!, state = this.grid.read(key, kind);
        if (key === goalKey && steps >= minimumCells && (state & (1 << (incoming * 4 + finalDirection)))) {
          const sequence: SearchEntry[] = [];
          for (let entry = current; entry >= 0; entry = queue.parents[entry]!) {
            const cell = queue.cells[entry]!;
            sequence.push({ point: { x: this.grid.x[cell]!, y: this.grid.y[cell]! }, direction: queue.directions[entry]!,
              cost: queue.costs[entry]!, estimate: 0, parent: null, steps: queue.steps[entry]! });
          }
          sequence.reverse();
          let tail: SearchEntry | null = null;
          for (const entry of sequence) tail = { ...entry, parent: tail };
          // 提交实体是两种后端的共同步骤，调度对照只比较取得合法路径的代价。
          searched?.(performance.now() - searchStarted);
          this.routes.push({ source: source.entityId, target: target.entityId, sourcePort: portId(source), targetPort: portId(target),
            sourceEdge: source.edge, targetEdge: target.edge, minimumCells, cells: sequence.map(entry => entry.point),
            turns: sequence.reduce((sum, entry, index) => sum + Number(entry.direction !== (sequence[index + 1]?.direction ?? finalDirection)), 0) });
          return this.commit(tail!, source.kind, finalDirection) + distance(start, source.outside) + distance(goal, target.outside);
        }
        for (let nextDirection = 0; nextDirection < 4; nextDirection++) {
          if (!(state & (1 << (incoming * 4 + nextDirection)))) { this.recordConflict(key); continue; }
          const delta = DELTAS[nextDirection]!, nextX = x + delta.x, nextY = y + delta.y;
          if (nextX < this.boundary.minimumX || nextX > (this.boundary.maximumX ?? Infinity) || nextY < (this.boundary.minimumY ?? -Infinity) || nextY < this.bounds.y - margin
            || nextY > (this.boundary.maximumY ?? Infinity) || nextX > this.bounds.x + this.bounds.width + margin || nextY > this.bounds.y + this.bounds.height + margin) continue;
          const nextKey = this.grid.cell(nextX, nextY);
          if (minimumCells > 0) {
            let repeated = false;
            for (let parent = current; parent >= 0; parent = queue.parents[parent]!) {
              if (queue.cells[parent] === nextKey) { repeated = true; break; }
            }
            if (repeated) continue;
          }
          const nextState = this.grid.read(nextKey, kind);
          if ((nextState & ROUTE_BLOCKED) || ((nextState & ROUTE_RESERVED) && nextKey !== startKey && nextKey !== goalKey)) continue;
          if (!(nextState & (1 << (ROUTE_ENTER_SHIFT + nextDirection)))) { this.recordConflict(nextKey); continue; }
          const cost = queue.costs[current]! + 1 + (nextDirection === incoming ? 0 : key === startKey ? 3 : 1)
            + (nextState & ROUTE_OCCUPIED ? 0.2 : 0) + (this.boundary.history?.get(`${this.activeRoute}|${nextX},${nextY}`) ?? 0);
          queue.push(nextKey, nextDirection, steps + 1, cost, cost + (Math.abs(nextX - goal.x) + Math.abs(nextY - goal.y)), current);
        }
        if (++expanded % 2048 === 0) {
          checkBudget();
          if (performance.now() >= routeDeadline) throw new PlannerCandidateError(`物流通道受阻：${source.entityId} → ${target.entityId}`);
          await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
      }
      if (this.boundary.maximumX !== undefined && this.boundary.maximumY !== undefined) {
        throw new PlannerCandidateError(`物流通道受阻：${source.entityId} → ${target.entityId}`);
      }
      margin *= 2;
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }
// AI-REMOVED 2026-10-03:
// Reason: 移除每条线的对象堆与字符串 best 状态，保留原 A* 顺序和代价。
// Trigger: 用户授权 CPU 数值结构和增量更新。
// Evidence: 原实现每步分配字符串状态与对象。
// Replacement: 上方 connect 与 routing-search.ts
// Risk: 路径和冲突反馈需逐项对照。
// Human Review: Required
// Original code:
//     const startKey = cellKey(start), goalKey = cellKey(goal);
//     if (this.isBlocked(startKey, source.kind) || this.isBlocked(goalKey, source.kind)) throw new PlannerCandidateError("端口外侧被设备阻挡。");
//     let margin = 8;
//     const routeDeadline = performance.now() + 1500;
//     // 空间没有固定上限；逐步扩展搜索区域，终止由任务预算或取消决定。
//     for (;;) {
//       checkBudget();
//       if (performance.now() >= routeDeadline) throw new PlannerCandidateError(`物流通道受阻：${source.entityId} → ${target.entityId}`);
//       const queue = new SearchQueue();
//       const best = new Map<string, number>();
//       const startDirection = EDGES.indexOf(source.edge);
//       queue.push({ point: start, direction: startDirection, cost: 0, estimate: distance(start, goal), parent: null, steps: 1 });
//       best.set(`${startKey}/${startDirection}/${Math.min(1, minimumCells)}`, 0);
//       let expanded = 0;
//       while (queue.size > 0) {
//         const current = queue.pop();
//         const key = cellKey(current.point);
//         if (best.get(`${key}/${current.direction}/${Math.min(current.steps!, minimumCells)}`)! < current.cost) continue;
//         const finalDirection = EDGES.indexOf(opposite(target.edge));
//         if (key === goalKey && current.steps! >= minimumCells && this.canLeave(key, source.kind, current.direction, finalDirection)) {
//           const sequence: SearchEntry[] = [];
//           for (let entry: SearchEntry | null = current; entry; entry = entry.parent) sequence.push(entry);
//           sequence.reverse();
//           this.routes.push({ source: source.entityId, target: target.entityId, sourcePort: portId(source), targetPort: portId(target),
//             sourceEdge: source.edge, targetEdge: target.edge, cells: sequence.map(entry => entry.point),
//             turns: sequence.reduce((sum, entry, index) => sum + Number(entry.direction !== (sequence[index + 1]?.direction ?? finalDirection)), 0) });
//           return this.commit(current, source.kind, finalDirection) + distance(start, source.outside) + distance(goal, target.outside);
//         }
//         for (let nextDirection = 0; nextDirection < 4; nextDirection++) {
//           if (!this.canLeave(key, source.kind, current.direction, nextDirection)) { this.recordConflict(key); continue; }
//           const delta = DELTAS[nextDirection]!;
//           const point = { x: current.point.x + delta.x, y: current.point.y + delta.y };
//           if (point.x < this.boundary.minimumX || point.x > (this.boundary.maximumX ?? Infinity) || point.y < (this.boundary.minimumY ?? -Infinity) || point.y < this.bounds.y - margin
//             || point.y > (this.boundary.maximumY ?? Infinity) || point.x > this.bounds.x + this.bounds.width + margin || point.y > this.bounds.y + this.bounds.height + margin) continue;
//           const nextKey = cellKey(point);
//           if (minimumCells > 0) {
//             let repeated = false;
//             for (let parent: SearchEntry | null = current; parent; parent = parent.parent) {
//               if (parent.point.x === point.x && parent.point.y === point.y) { repeated = true; break; }
//             }
//             if (repeated) continue;
//           }
//           if (this.isBlocked(nextKey, source.kind) || (this.reserved.get(nextKey)?.has(source.kind) && nextKey !== startKey && nextKey !== goalKey)) continue;
//           if (!this.canEnter(nextKey, source.kind, nextDirection)) { this.recordConflict(nextKey); continue; }
//           const cost = current.cost + 1 + (nextDirection === current.direction ? 0 : key === startKey ? 3 : 1)
//             + (this.paths.has(nextKey) ? 0.2 : 0) + (this.boundary.history?.get(`${this.activeRoute}|${nextKey}`) ?? 0);
//           const stateKey = `${nextKey}/${nextDirection}/${Math.min(current.steps! + 1, minimumCells)}`;
//           if ((best.get(stateKey) ?? Infinity) <= cost) continue;
//           best.set(stateKey, cost);
//           queue.push({ point, direction: nextDirection, cost, estimate: cost + distance(point, goal), parent: current, steps: current.steps! + 1 });
//         }
//         if (++expanded % 2048 === 0) {
//           checkBudget();
//           if (performance.now() >= routeDeadline) throw new PlannerCandidateError(`物流通道受阻：${source.entityId} → ${target.entityId}`);
//           await new Promise<void>((resolve) => setTimeout(resolve, 0));
//         }
//       }
//       if (this.boundary.maximumX !== undefined && this.boundary.maximumY !== undefined) {
//         throw new PlannerCandidateError(`物流通道受阻：${source.entityId} → ${target.entityId}`);
//       }
//       margin *= 2;
//       await new Promise<void>((resolve) => setTimeout(resolve, 0));
//     }
//   }

  private canEnter(key: number, kind: LogisticsKind, direction: number): boolean {
    // 异族重叠只使用双方注册表明确允许的组合。
    // AI-CORRECTION 2026-10-03：注册表规则在 commit 后增量编入该格数值状态，查询只读位掩码。
    return (this.grid.read(key, kindIndex(kind)) & (1 << (ROUTE_ENTER_SHIFT + direction))) !== 0;
  }

  private isBlocked(key: number, kind: LogisticsKind): boolean {
    return (this.grid.read(key, kindIndex(kind)) & ROUTE_BLOCKED) !== 0;
  }
// AI-REMOVED 2026-10-03:
// Reason: 通行查询改读已增量维护的数值编码。
// Trigger: 用户授权 CPU 数值结构和增量更新。
// Evidence: 原实现每步分配字符串状态与对象。
// Replacement: canEnter / isBlocked / updateRouteState
// Risk: 路径和冲突反馈需逐项对照。
// Human Review: Required
// Original code:
//   private canEnter(key: string, kind: LogisticsKind, direction: number): boolean {
//     const routes = this.paths.get(key);
//     if (routes === undefined) return true;
//     const same = routes.get(kind);
//     if (same !== undefined) return same.straight && !same.crossed && same.direction % 2 !== direction % 2;
//     // 异族重叠只使用双方注册表明确允许的组合。
//     const other = [...routes.values()][0]!;
//     const otherDefinition = this.registry.queries.findEntityDefinition(other.entity.definitionId)!;
//     const straight = this.registry.queries.findEntityDefinition(this.registry.queries.resolveLogisticsDefinitionId(kind, "straight"))!;
//     const has = (definition: typeof straight, type: string) => definition.placementBehaviors.some((behavior) => behavior.type === type);
//     return (has(straight, "allow-belt-overlap") && has(otherDefinition, "allow-pipe-overlap"))
//       || (has(straight, "allow-pipe-overlap") && has(otherDefinition, "allow-belt-overlap"));
//   }
//
//   private isBlocked(key: string, kind: LogisticsKind): boolean {
//     return this.blocked.has(key) && !this.permeable.get(key)?.has(kind);
//   }

  private recordConflict(key: number): void {
    for (const route of this.paths.get(key)?.values() ?? []) {
      if (!route.routeId || route.routeId === this.activeRoute) continue;
      const cells = this.conflicts.get(route.routeId) ?? new Set<string>();
      cells.add(`${this.grid.x[key]},${this.grid.y[key]}`); this.conflicts.set(route.routeId, cells);
    }
  }

  private reserve(key: number, kind: LogisticsKind): void {
    this.grid.reserve(key, kindIndex(kind));
  }
// AI-REMOVED 2026-10-03:
// Reason: 端口预留改为格子状态位。
// Trigger: 用户授权 CPU 数值结构和增量更新。
// Evidence: 原实现每步分配字符串状态与对象。
// Replacement: grid.reserve
// Risk: 路径和冲突反馈需逐项对照。
// Human Review: Required
// Original code:
//   private reserve(key: string, kind: LogisticsKind): void {
//     const kinds = this.reserved.get(key) ?? new Set<LogisticsKind>();
//     kinds.add(kind); this.reserved.set(key, kinds);
//   }

  private prepareEscape(port: PlannerPort): void {
    if (this.escapes.has(portId(port))) return;
    const outward = EDGES.indexOf(port.edge), delta = DELTAS[outward]!;
    const direction = port.direction === "output" ? outward : (outward + 2) % 4;
    let point = port.outside;
    for (let step = 0; step < (this.boundary.escapeLength ?? 2); step++) {
      const next = { x: point.x + delta.x, y: point.y + delta.y };
      const currentCell = this.grid.cell(point.x, point.y), nextCell = this.grid.cell(next.x, next.y);
      const nextState = this.grid.read(nextCell, kindIndex(port.kind));
      if ((this.grid.read(currentCell, 0) & ROUTE_OBSTACLE) || (nextState & (ROUTE_OBSTACLE | ROUTE_RESERVED | ROUTE_OCCUPIED))
        || !this.canEnter(currentCell, port.kind, direction)) break;
      this.commit({ point, direction, cost: 0, estimate: 0, parent: null }, port.kind, direction);
      point = next;
    }
    this.escapes.set(portId(port), point);
    this.reserve(this.grid.cell(point.x, point.y), port.kind);
  }

  private canLeave(key: number, kind: LogisticsKind, incoming: number, outgoing: number): boolean {
    // 桥接器必须直穿。若另一族也占据该格，还需确认桥接器支持该重叠。
    // AI-CORRECTION 2026-10-03：交叉或另一族提交时即时更新掩码，热路径不再查 Map。
    return (this.grid.read(key, kindIndex(kind)) & (1 << (incoming * 4 + outgoing))) !== 0;
  }

  private updateRouteState(key: number): void {
    const routes = this.paths.get(key)!;
    for (const kind of ["belt", "pipe"] as const) {
      const same = routes.get(kind);
      let enter = 15, leave = ROUTE_OPEN & 0xffff;
      if (same) {
        enter = same.straight && !same.crossed ? (same.direction % 2 === 0 ? 10 : 5) : 0;
        leave = routes.size === 1 ? (enter & 1 ? 1 : 0) | (enter & 2 ? 1 << 5 : 0)
          | (enter & 4 ? 1 << 10 : 0) | (enter & 8 ? 1 << 15 : 0) : 0;
      } else {
        const other = routes.values().next().value!;
        const pair = `${kind}/${other.entity.definitionId}`;
        let allowed = this.overlap.get(pair);
        if (allowed === undefined) {
          const otherDefinition = this.registry.queries.findEntityDefinition(other.entity.definitionId)!;
          const straight = this.registry.queries.findEntityDefinition(this.registry.queries.resolveLogisticsDefinitionId(kind, "straight"))!;
          const has = (definition: typeof straight, type: string) => definition.placementBehaviors.some(behavior => behavior.type === type);
          allowed = (has(straight, "allow-belt-overlap") && has(otherDefinition, "allow-pipe-overlap"))
            || (has(straight, "allow-pipe-overlap") && has(otherDefinition, "allow-belt-overlap"));
          this.overlap.set(pair, allowed);
        }
        if (!allowed) enter = 0;
      }
      this.grid.updateRoute(key, kindIndex(kind), enter, leave);
    }
  }
// AI-REMOVED 2026-10-03:
// Reason: 交叉规则编译到每格方向矩阵，提交后局部刷新。
// Trigger: 用户授权 CPU 数值结构和增量更新。
// Evidence: 原实现每步分配字符串状态与对象。
// Replacement: updateRouteState / grid.updateRoute
// Risk: 路径和冲突反馈需逐项对照。
// Human Review: Required
// Original code:
//   private canLeave(key: string, kind: LogisticsKind, incoming: number, outgoing: number): boolean {
//     if ((incoming + 2) % 4 === outgoing) return false;
//     const routes = this.paths.get(key);
//     const same = routes?.get(kind);
//     if (same === undefined) return true;
//     // 桥接器必须直穿。若另一族也占据该格，还需确认桥接器支持该重叠。
//     if (routes!.size > 1) return false;
//     return same.straight && !same.crossed && incoming === outgoing && same.direction % 2 !== incoming % 2;
//   }

  private commit(tail: SearchEntry, kind: LogisticsKind, finalDirection: number): number {
    const sequence: SearchEntry[] = [];
    for (let entry: SearchEntry | null = tail; entry !== null; entry = entry.parent) sequence.push(entry);
    sequence.reverse();
    for (let index = 0; index < sequence.length; index++) {
      const current = sequence[index]!;
      const direction = sequence[index + 1]?.direction ?? finalDirection;
      const key = this.grid.cell(current.point.x, current.point.y);
      const existing = this.paths.get(key)?.get(kind);
      if (existing !== undefined) {
        // 订正 2026-10-07：改写前先记账，压缩失败时由 restoreChain 逆向重放（见 entityMutations）。
        if (this.journaling) this.entityMutations.push({ entity: existing.entity, definitionId: existing.entity.definitionId,
          rotation: existing.entity.rotation, cell: existing, crossed: existing.crossed });
        existing.entity.definitionId = findLogisticsDevice(this.registry, kind, "connector").id;
        existing.entity.rotation = 0;
        existing.crossed = true;
        this.updateRouteState(key);
        continue;
      }
      const pose = resolveTransportPose(this.registry, kind, opposite(EDGES[current.direction]!), EDGES[direction]!);
      const entity: WorldEntity = {
        // 订正 2026-10-07：改用单调序列号，压缩摘除实体后不再复用已存在的 id（见 entitySerial）。
        id: `eda-route-${this.entitySerial++}`, ...pose, position: current.point, config: {}, tags: [],
      };
      this.generated.push(entity);
      const routes = this.paths.get(key) ?? new Map<LogisticsKind, RouteCell>();
      routes.set(kind, { entity, routeId: this.activeRoute, direction, straight: direction === current.direction, crossed: false });
      this.paths.set(key, routes);
      this.updateRouteState(key);
    }
    return sequence.length;
  }
}

function distance(a: GridPoint, b: GridPoint): number { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
function portId(port: PlannerPort): string { return `${port.entityId}/${port.groupIndex}/${port.portIndex}`; }

function kindIndex(kind: LogisticsKind): number { return kind === "belt" ? 0 : 1; }
