import type { GridRect } from "@/domain/shared/grid";
import { EDGES } from "./geometry";
import type { PlannerWire } from "./model";
import { ROUTE_BLOCKED, type PlannerRoutingGrid } from "./routing-grid";

/**
 * 每格横纵轴各容纳一条线，转弯消耗两轴，正交直穿各用一轴。
 * 放宽端点配对、方向和预留位后求最大流：流不足是必要容量缺口，流足不代表能同时布线。
 * 仅读取本体阻挡，不受已经提交的动态路径影响；与带端点配对的切面检查互补。
 */
export function countPlannerAxisCapacityDeficit(grid: PlannerRoutingGrid,
  wires: readonly Pick<PlannerWire, "source" | "target">[], bounds: GridRect): number {
  const { width, height } = bounds, size = width * height;
  const cell = (x: number, y: number) => x < bounds.x || y < bounds.y || x >= bounds.x + width || y >= bounds.y + height
    ? -1 : (y - bounds.y) * width + x - bounds.x;
  const direct = (wire: Pick<PlannerWire, "source" | "target">) => wire.source.outside.x === wire.target.cell.x
    && wire.source.outside.y === wire.target.cell.y && wire.target.outside.x === wire.source.cell.x && wire.target.outside.y === wire.source.cell.y;
  let deficit = 0;
  for (let kind = 0; kind < 2; kind++) {
    const members = wires.filter(wire => Number(wire.source.kind === "pipe") === kind && !direct(wire));
    const required = members.length;
    if (!required) continue;
    const source = size * 4, sink = source + 1, nodeCount = sink + 1 + required * 2;
    // AI-REMOVED 2026-10-23:
    // Reason: 单路径BFS改为分层增广，复用显式栈而非每条流量重新扫描全图。
    // Trigger: 真实Worker固定90秒回归超时；Evidence: 轴容量内核采样约18%。
    // Replacement: 下方层号、当前弧与路径栈；Risk: Low；精确整数流量差分核验。
    // Human Review: Required
    // Original code:
    // const heads = new Int32Array(nodeCount).fill(-1), parent = new Int32Array(nodeCount), queue = new Int32Array(nodeCount);
    const heads = new Int32Array(nodeCount).fill(-1), level = new Int32Array(nodeCount), queue = new Int32Array(nodeCount);
    const cursor = new Int32Array(nodeCount), pathNodes = new Int32Array(nodeCount), pathEdges = new Int32Array(nodeCount);
    const targets: number[] = [], next: number[] = [], capacities: number[] = [];
    const add = (from: number, to: number, capacity: number) => {
      const index = targets.length;
      targets.push(to, from); next.push(heads[from]!, heads[to]!); capacities.push(capacity, 0);
      heads[from] = index; heads[to] = index + 1;
    };
    const free = new Uint8Array(size);
    for (let c = 0; c < size; c++) {
      free[c] = Number(!(grid.read(grid.cell(bounds.x + c % width, bounds.y + Math.floor(c / width)), kind) & ROUTE_BLOCKED));
    }
    for (let c = 0; c < size; c++) if (free[c]) {
      const vertical = c * 4, horizontal = vertical + 2;
      add(vertical, vertical + 1, 1); add(horizontal, horizontal + 1, 1);
      add(vertical + 1, horizontal, required); add(horizontal + 1, vertical, required);
      if (c % width + 1 < width && free[c + 1]) {
        add(horizontal + 1, (c + 1) * 4 + 2, required); add((c + 1) * 4 + 3, horizontal, required);
      }
      if (c + width < size && free[c + width]) {
        add(vertical + 1, (c + width) * 4, required); add((c + width) * 4 + 1, vertical, required);
      }
    }
    for (const [at, wire] of members.entries()) {
      const sourceHub = sink + 1 + at * 2, targetHub = sourceHub + 1;
      add(source, sourceHub, 1); add(targetHub, sink, 1);
      const start = cell(wire.source.outside.x, wire.source.outside.y), end = cell(wire.target.outside.x, wire.target.outside.y);
      if (start >= 0) add(sourceHub, start * 4 + EDGES.indexOf(wire.source.edge) % 2 * 2, required);
      if (end >= 0) add(end * 4 + EDGES.indexOf(wire.target.edge) % 2 * 2 + 1, targetHub, required);
    }
    let flow = 0;
    // 显式队列增广，狭长通道不依赖 JavaScript 递归栈深度。
    // AI-REMOVED 2026-10-23:
    // Reason: 每单位流量重新BFS导致同一残量网络反复全图遍历。
    // Trigger: Vitest固定时限回归；Evidence: thread-profile-1151079-1.cpuprofile。
    // Replacement: 下方分层图阻塞流；源到每条线的容量仍为1，增广仍使用精确整数。
    // Risk: 保留显式栈，避免狭长图递归溢出；真实格网新旧流量逐项核对。
    // Human Review: Required
    // Original code:
    // while (flow < required) {
    //   parent.fill(-1); parent[source] = -2;
    //   let read = 0, length = 1; queue[0] = source;
    //   while (read < length && parent[sink] === -1) {
    //     const from = queue[read++]!;
    //     for (let edge = heads[from]!; edge !== -1; edge = next[edge]!) {
    //       const to = targets[edge]!;
    //       if (capacities[edge]! <= 0 || parent[to] !== -1) continue;
    //       parent[to] = edge; queue[length++] = to;
    //       if (to === sink) break;
    //     }
    //   }
    //   if (parent[sink] === -1) break;
    //   for (let node = sink; node !== source;) {
    //     const edge = parent[node]!;
    //     capacities[edge]!--; capacities[edge ^ 1]!++; node = targets[edge ^ 1]!;
    //   }
    //   flow++;
    // }
    // AI-CORRECTION 2026-10-23：一次BFS建立分层图，在当前弧上迭代增广多条路径，不改变最大流值。
    while (flow < required) {
      level.fill(-1); level[source] = 0;
      let read = 0, length = 1; queue[0] = source;
      while (read < length) {
        const from = queue[read++]!;
        for (let edge = heads[from]!; edge !== -1; edge = next[edge]!) {
          const to = targets[edge]!;
          if (capacities[edge]! <= 0 || level[to] !== -1) continue;
          level[to] = level[from]! + 1; queue[length++] = to;
        }
      }
      if (level[sink] === -1) break;
      cursor.set(heads);
      let depth = 0; pathNodes[0] = source;
      while (depth >= 0 && flow < required) {
        const from = pathNodes[depth]!;
        if (from === sink) {
          // 每个源hub入边容量为1，因此本条增广路径的瓶颈必为1。
          for (let at = 0; at < depth; at++) {
            const edge = pathEdges[at]!; capacities[edge]!--; capacities[edge ^ 1]!++;
          }
          flow++; depth = 0;
          continue;
        }
        let edge = cursor[from]!;
        while (edge !== -1 && (capacities[edge]! <= 0 || level[targets[edge]!] !== level[from]! + 1)) {
          edge = next[edge]!; cursor[from] = edge;
        }
        if (edge === -1) { level[from] = -1; depth--; }
        else { pathEdges[depth] = edge; pathNodes[++depth] = targets[edge]!; }
      }
    }
    deficit += required - flow;
  }
  return deficit;
}
