import type { GridRect } from "@/domain/shared/grid";
import { DELTAS, EDGES, opposite } from "./geometry";
import type { PlannerWire } from "./model";
import { ROUTE_BLOCKED, ROUTE_OPEN, ROUTE_RESERVED_AXIS_SHIFT, type PlannerRoutingGrid } from "./routing-grid";
import { countPlannerAxisCapacityDeficit } from "./routing-axis-capacity";

/**
 * 当前 Router 的静态约束下，计算单线不可达数和共同通道容量缺口下界。
 * DFS 子树给出一组割集；跨割集的必经线路不能超过边界格边数量。
 * 仅对线路集合互不相交的过载割集求和，避免重复计数。零缺口不保证可以全通。
 * 只读取本体阻挡和端口预留位，已经提交的动态路径不参与此项布局事实。
 */
// 2026-10-21：补充横纵扫描切面；DFS 子树不覆盖所有必经瓶颈。两种保守聚合取较大值，避免新增割集降低原下界。
// AI-CORRECTION 2026-10-22：原格边切面会漏掉每格横纵轴的共享瓶颈；先通过便宜检查，再组合一般双轴最大流必要条件。
export function countPlannerRoutingConstraints(grid: PlannerRoutingGrid,
  wires: readonly Pick<PlannerWire, "source" | "target">[], bounds: GridRect) {
  const { width, height } = bounds, size = width * height;
  if (![bounds.x, bounds.y, width, height, size].every(Number.isSafeInteger) || width < 1 || height < 1) {
    throw new Error("通道容量检查需要有限整数边界。");
  }
  const cell = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? -1 : y * width + x;
  const neighbor = (index: number, direction: number) => cell(index % width + DELTAS[direction]!.x,
    Math.floor(index / width) + DELTAS[direction]!.y);
  const count = (forcedTurns: boolean) => {
    const overloaded: Array<{ capacity: number; wires: number[]; scan?: { axis: "x" | "y"; split: number } }> = [];
    let disconnectedWires = 0;
    for (let kind = 0; kind < 2; kind++) {
      const free = new Uint8Array(size), entered = new Int32Array(size), finished = new Int32Array(size);
      const component = new Int32Array(size), parent = new Int32Array(size).fill(-1), next = new Uint8Array(size);
      const order: number[] = [], crossing = new Int32Array(size);
      for (let index = 0; index < size; index++) {
        const key = grid.cell(bounds.x + index % width, bounds.y + Math.floor(index / width));
        // 2026-10-21：单轴端口允许垂直桥接；此无向下界保守放宽方向，不能将合法交叉误判为静态断连。
        const state = grid.read(key, kind);
        free[index] = Number(!(state & ROUTE_BLOCKED) && ((state >>> ROUTE_RESERVED_AXIS_SHIFT) & 3) !== 3);
      }
      // 2026-10-21：端口向外无法直行时必然转弯，其他同种线路不能在该格桥接。
      if (forcedTurns) for (const wire of wires) {
        if ((wire.source.kind === "belt" ? 0 : 1) !== kind) continue;
        // 可能零格直连的相邻端口不承诺占用外侧格，保守跳过。
        if (wire.source.outside.x === wire.target.cell.x && wire.source.outside.y === wire.target.cell.y
          && wire.target.outside.x === wire.source.cell.x && wire.target.outside.y === wire.source.cell.y) continue;
        // 2026-10-21 订正：两端外格相同的单格路径可直行到目标设备；下一格主体阻挡不能推出必转弯。
        if (wire.source.outside.x === wire.target.outside.x && wire.source.outside.y === wire.target.outside.y) continue;
        for (const port of [wire.source, wire.target]) {
          const origin = cell(port.outside.x - bounds.x, port.outside.y - bounds.y);
          if (origin < 0) continue;
          const direction = EDGES.indexOf(port.edge), beyond = neighbor(origin, direction);
          const blocked = beyond < 0 || Boolean(grid.read(grid.cell(bounds.x + beyond % width,
            bounds.y + Math.floor(beyond / width)), kind) & ROUTE_BLOCKED);
          if (!blocked) continue;
          free[origin] = 0;

        }
      }
      let clock = 0, componentId = 0;
      for (let root = 0; root < size; root++) {
        if (!free[root] || entered[root]) continue;
        component[root] = ++componentId; entered[root] = ++clock; order.push(root);
        const stack = [root];
        while (stack.length) {
          const current = stack.at(-1)!;
          if (next[current]! < 4) {
            const direction = next[current]!;
            next[current] = direction + 1;
            const target = neighbor(current, direction);
            if (target < 0 || !free[target] || entered[target]) continue;
            parent[target] = current; entered[target] = ++clock; component[target] = componentId;
            order.push(target); stack.push(target);
          } else { stack.pop(); finished[current] = clock; }
        }
      }
      // 无向 DFS 的非树边连接祖先与后代；树上差分得到每个子树额外跨出的格边数。
      for (const current of order) for (let direction = 0; direction < 4; direction++) {
        const target = neighbor(current, direction);
        if (target <= current || !free[target] || parent[current] === target || parent[target] === current) continue;
        const descendant = entered[current]! > entered[target]! ? current : target;
        const ancestor = descendant === current ? target : current;
        crossing[descendant] = crossing[descendant]! + 1;
        crossing[ancestor] = crossing[ancestor]! - 1;
      }
      const cuts: Array<{ child: number; capacity: number; wires: number[]; scan?: { axis: "x" | "y"; split: number } }> = [];
      for (let index = order.length - 1; index >= 0; index--) {
        const child = order[index]!, owner = parent[child]!;
        if (owner < 0) continue;
        const capacity = 1 + crossing[child]!;
        if (capacity < wires.length) cuts.push({ child, capacity, wires: [] });
        crossing[owner] = crossing[owner]! + crossing[child]!;
      }
      // 同一物流不能共享格边；正交桥接使用不同边，仍各占一个真实通道。
      for (const axis of ["x", "y"] as const) for (let split = 0; split < (axis === "x" ? width : height) - 1; split++) {
        const capacities = new Map<number, { child: number; capacity: number }>();
        for (let offset = 0; offset < (axis === "x" ? height : width); offset++) {
          const a = axis === "x" ? cell(split, offset) : cell(offset, split);
          const b = axis === "x" ? cell(split + 1, offset) : cell(offset, split + 1);
          if (!free[a] || !free[b]) continue;
          const id = component[a]!, current = capacities.get(id) ?? { child: a, capacity: 0 };
          current.capacity++; capacities.set(id, current);
        }
        for (const value of capacities.values()) if (value.capacity < wires.length) {
          cuts.push({ ...value, wires: [], scan: { axis, split } });
        }
      }
      const terminals = (port: PlannerWire["source"], source: boolean) => {
        const origin = cell(port.outside.x - bounds.x, port.outside.y - bounds.y);
        if (origin < 0) return [];
        const direction = EDGES.indexOf(source ? port.edge : opposite(port.edge)), result: number[] = [];
        for (let side = 0; side < 4; side++) {
          const target = neighbor(origin, side), incoming = source ? direction : (side + 2) % 4;
          const outgoing = source ? side : direction;
          if (target >= 0 && free[target] && (ROUTE_OPEN & (1 << (incoming * 4 + outgoing)))) result.push(target);
        }
        return result;
      };
      for (const [index, wire] of wires.entries()) {
        if ((wire.source.kind === "belt" ? 0 : 1) !== kind) continue;
        // 相邻端口可不经过任何空闲图边；跳过是保守下界，不替代实际直连与缓冲检查。
        if (Math.abs(wire.source.outside.x - wire.target.outside.x)
          + Math.abs(wire.source.outside.y - wire.target.outside.y) <= 1) continue;
        const source = terminals(wire.source, true), target = terminals(wire.target, false);
        const common = [...new Set(source.map(point => component[point]!))]
          .filter(group => target.some(point => component[point] === group));
        if (!common.length) { disconnectedWires++; continue; }
        // 可任选多个连通分量时，某一个分量内的割集不是必经约束。
        if (common.length !== 1) continue;
        const starts = source.filter(point => component[point] === common[0]);
        const ends = target.filter(point => component[point] === common[0]);
        for (const cut of cuts) {
          if (component[cut.child] !== common[0]) continue;
          const inside = (point: number) => cut.scan
            ? (cut.scan.axis === "x" ? point % width : Math.floor(point / width)) <= cut.scan.split
            : entered[point]! >= entered[cut.child]! && entered[point]! <= finished[cut.child]!;
          if (starts.every(inside) && ends.every(point => !inside(point))
            || ends.every(inside) && starts.every(point => !inside(point))) cut.wires.push(index);
        }
      }
      overloaded.push(...cuts.filter(cut => cut.wires.length > cut.capacity));
    }
    overloaded.sort((a, b) => (b.wires.length - b.capacity) - (a.wires.length - a.capacity));
    const counted = new Uint8Array(wires.length);
    const treeCounted = new Uint8Array(wires.length);
    let capacityDeficit = 0, treeDeficit = 0;
    for (const cut of overloaded) {
      if (!cut.scan && cut.wires.every(index => !treeCounted[index])) {
        treeDeficit += cut.wires.length - cut.capacity;
        for (const index of cut.wires) treeCounted[index] = 1;
      }
      if (cut.wires.every(index => !counted[index])) {
        capacityDeficit += cut.wires.length - cut.capacity;
        for (const index of cut.wires) counted[index] = 1;
      }
    }
    return { disconnectedWires, capacityDeficit: Math.max(capacityDeficit, treeDeficit) };
  };
  const baseline = count(false);
  if (baseline.disconnectedWires === 0 && baseline.capacityDeficit === 0) {
    baseline.capacityDeficit = countPlannerAxisCapacityDeficit(grid, wires, bounds);
  }
  // 2026-10-21：强制占用来自其他必须存在的线路，是共同容量事实；仅给出至少一条无法同时成立的保守下界。
  // 不把多个强制占位造成的断连逐条相加，避免多个冲突由同一条线引起而重复计数。
  if (baseline.disconnectedWires === 0 && baseline.capacityDeficit === 0) {
    const forced = count(true);
    if (forced.disconnectedWires || forced.capacityDeficit) return { disconnectedWires: 0, capacityDeficit: 1 };
  }
  return baseline;
}
