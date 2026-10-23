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
      let required = 0;
      for (const wire of wires) if ((wire.source.kind === "belt" ? 0 : 1) === kind) required++;
      if (!required) continue;
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
        // 2026-10-23：该物流最多只有required条线，容量更大的切面不可能过载，无需逐线检查。
        if (capacity < required) cuts.push({ child, capacity, wires: [] });
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
        for (const value of capacities.values()) if (value.capacity < required) {
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
      // 2026-10-23：切面判定在整轮复用，避免在线路×切面的热循环反复创建并命名函数。
      // AI-CORRECTION 2026-10-23：继续按端点范围筛选切面；只有可能整侧包含端点时才检查另一侧的离散点。
      // AI-REMOVED 2026-10-23:
      // Reason: 每个切面重复查询所有端点，真实 Worker 采样仍有21.3%落在该判定。
      // Trigger: 紧凑验收原90秒仍超时；Evidence: thread-profile-1148138-1.cpuprofile。
      // Replacement: 下方端点范围与割集区间判断；原集合条件保持。
      // Risk: Low；空集合保持every语义，真实容量对照复核。
      // Human Review: Required
      // Original code:
      // const inside = (point: number, cut: (typeof cuts)[number]) => cut.scan
      //   ? (cut.scan.axis === "x" ? point % width : Math.floor(point / width)) <= cut.scan.split
      //   : entered[point]! >= entered[cut.child]! && entered[point]! <= finished[cut.child]!;
      const range = (points: readonly number[]) => {
        let entryMin = Infinity, entryMax = -Infinity, xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
        for (const point of points) {
          entryMin = Math.min(entryMin, entered[point]!); entryMax = Math.max(entryMax, entered[point]!);
          xMin = Math.min(xMin, point % width); xMax = Math.max(xMax, point % width);
          yMin = Math.min(yMin, Math.floor(point / width)); yMax = Math.max(yMax, Math.floor(point / width));
        }
        return { entryMin, entryMax, xMin, xMax, yMin, yMax };
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
        const startRange = range(starts), endRange = range(ends);
        for (const cut of cuts) {
          if (component[cut.child] !== common[0]) continue;
          // AI-REMOVED 2026-10-23:
          // Reason: 内层闭包创建及 TSX 函数命名处理占用大量 Node Worker 时间。
          // Trigger: 固定 50k / 90 秒紧凑验收超时。
          // Evidence: thread-profile-1146509-1.cpuprofile 中 routing-capacity 的 __name 自耗时 18.5%。
          // Replacement: 上方复用 inside 判定与下方显式遍历；保留 every 的空集合语义和割集顺序。
          // Risk: Low；容量控制与真实 Worker 验收复核。
          // Human Review: Required
          // Original code:
          // const inside = (point: number) => cut.scan
          //   ? (cut.scan.axis === "x" ? point % width : Math.floor(point / width)) <= cut.scan.split
          //   : entered[point]! >= entered[cut.child]! && entered[point]! <= finished[cut.child]!;
          // if (starts.every(inside) && ends.every(point => !inside(point))
          //   || ends.every(inside) && starts.every(point => !inside(point))) cut.wires.push(index);
          // AI-REMOVED 2026-10-23:
          // Reason: 将逐切面端点判定收敛为同义区间查询，避免重复函数调用。
          // Trigger: 真实Worker原90秒仍超时；Evidence: thread-profile-1148138-1.cpuprofile。
          // Replacement: 下方扫描极值与DFS区间判定；Risk: Low；Human Review: Required
          // Original code:
          // let startsInside = true, startsOutside = true, endsInside = true, endsOutside = true;
          // for (const point of starts) {
          //   if (inside(point, cut)) startsOutside = false;
          //   else startsInside = false;
          // }
          // for (const point of ends) {
          //   if (inside(point, cut)) endsOutside = false;
          //   else endsInside = false;
          // }
          // if (startsInside && endsOutside || endsInside && startsOutside) cut.wires.push(index);
          if (cut.scan) {
            const { axis, split } = cut.scan;
            if (axis === "x"
              ? startRange.xMax <= split && endRange.xMin > split || endRange.xMax <= split && startRange.xMin > split
              : startRange.yMax <= split && endRange.yMin > split || endRange.yMax <= split && startRange.yMin > split) cut.wires.push(index);
          } else {
            const low = entered[cut.child]!, high = finished[cut.child]!;
            let forward = startRange.entryMin >= low && startRange.entryMax <= high;
            let backward = endRange.entryMin >= low && endRange.entryMax <= high;
            if (forward) for (const point of ends) if (entered[point]! >= low && entered[point]! <= high) { forward = false; break; }
            if (!forward && backward) for (const point of starts) if (entered[point]! >= low && entered[point]! <= high) { backward = false; break; }
            if (forward || backward) cut.wires.push(index);
          }
        }
      }
      overloaded.push(...cuts.filter(cut => cut.wires.length > cut.capacity));
    }
    overloaded.sort((a, b) => (b.wires.length - b.capacity) - (a.wires.length - a.capacity));
    const counted = new Uint8Array(wires.length);
    const treeCounted = new Uint8Array(wires.length);
    const uncounted = (index: number) => !counted[index];
    const treeUncounted = (index: number) => !treeCounted[index];
    let capacityDeficit = 0, treeDeficit = 0;
    for (const cut of overloaded) {
      if (!cut.scan && cut.wires.every(treeUncounted)) {
        treeDeficit += cut.wires.length - cut.capacity;
        for (const index of cut.wires) treeCounted[index] = 1;
      }
      if (cut.wires.every(uncounted)) {
        capacityDeficit += cut.wires.length - cut.capacity;
        for (const index of cut.wires) counted[index] = 1;
      }
    }
    return { disconnectedWires, capacityDeficit: Math.max(capacityDeficit, treeDeficit) };
  };
  const baseline = count(false);
  // AI-CORRECTION 2026-10-23：静态缺口参与共同数量评分；较弱正下界不能屏蔽更强轴容量，重叠证据取max而不相加。
  if (baseline.disconnectedWires === 0) {
    baseline.capacityDeficit = Math.max(baseline.capacityDeficit, countPlannerAxisCapacityDeficit(grid, wires, bounds));
  }
  // 2026-10-21：强制占用来自其他必须存在的线路，是共同容量事实；仅给出至少一条无法同时成立的保守下界。
  // 不把多个强制占位造成的断连逐条相加，避免多个冲突由同一条线引起而重复计数。
  if (baseline.disconnectedWires === 0 && baseline.capacityDeficit === 0) {
    const forced = count(true);
    if (forced.disconnectedWires || forced.capacityDeficit) return { disconnectedWires: 0, capacityDeficit: 1 };
  }
  return baseline;
}
