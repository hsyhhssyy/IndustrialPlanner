import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { GridRect } from "@/domain/shared/grid";
import { LOGISTICS_KIND, LOGISTICS_KINDS } from "@/domain/shared/logistics";
import { allowsPlannerOverlap, DELTAS, EDGES, findLogisticsDevice, opposite } from "./geometry";
import type { PlannerWire } from "./model";
import { PlannerRoutingSearch } from "./routing-search";
import {
  allowsPlannerReservationTransit, ROUTE_BLOCKED, ROUTE_ENTER_SHIFT, ROUTE_OPEN,
  ROUTE_RESERVED, ROUTE_RESERVED_AXIS_SHIFT, type PlannerRoutingGrid,
} from "./routing-grid";

interface CoupledCapacityRule {
  readonly weights: readonly [number, number];
  readonly capacity: number;
}

interface RegistryCapacityCache {
  readonly rules: readonly CoupledCapacityRule[];
  readonly layouts: Map<string, number>;
}

const registryCaches = new WeakMap<RegistryContract, RegistryCapacityCache>();
const STATIC_MASK = ROUTE_BLOCKED | ROUTE_RESERVED | (3 << ROUTE_RESERVED_AXIS_SHIFT);

/** 从实际桥接器与全部异族路径形状推导共同资源，不按物品或蓝图选择规则。 */
function registryCapacityCache(registry: RegistryContract): RegistryCapacityCache {
  const cached = registryCaches.get(registry);
  if (cached) return cached;
  const definitions = LOGISTICS_KINDS.map(kind => ({
    connector: findLogisticsDevice(registry, kind, "connector"),
    segments: (["straight", "turn-cw", "turn-ccw"] as const).map(shape =>
      registry.queries.findEntityDefinition(registry.queries.resolveLogisticsDefinitionId(kind, shape))!),
  }));
  const rules: CoupledCapacityRule[] = [];
  for (const kind of [0, 1] as const) {
    const own = definitions[kind]!, other = definitions[1 - kind]!;
    if ([other.connector, ...other.segments].every(definition => !allowsPlannerOverlap(registry, own.connector, definition))) {
      // 2026-10-23：同族两线共格必须升级桥接器。若其不容许异族，两线时异族只能为零；
      // 单线时异族至多两线，因此 2*同族线数+异族线数<=4 是必要条件。
      rules.push({ weights: kind === 0 ? [2, 1] : [1, 2], capacity: 4 });
    }
  }
  const result = { rules, layouts: new Map<string, number>() };
  registryCaches.set(registry, result);
  return result;
}

/** 有限次数的非负资源定价；只有安全整数权重重新验证的正缺口才返回冲突。 */
function hasCoupledCapacityCertificate(grid: PlannerRoutingGrid,
  wires: readonly Pick<PlannerWire, "source" | "target">[], bounds: GridRect, rule: CoupledCapacityRule): boolean {
  const { width, height } = bounds, size = width * height;
  const states = [new Uint32Array(size), new Uint32Array(size)] as const;
  const next = new Int32Array(size * 4).fill(-1), capacities = new Uint32Array(size * 5), resources: number[] = [];
  for (let cell = 0; cell < size; cell++) {
    for (const kind of [0, 1] as const) {
      states[kind][cell] = (grid.read(grid.cell(bounds.x + cell % width,
        bounds.y + Math.floor(cell / width)), kind) & STATIC_MASK) | ROUTE_OPEN;
      if (!(states[kind][cell]! & ROUTE_BLOCKED)) for (let axis = 0; axis < 2; axis++) {
        const resource = cell * 5 + kind * 2 + axis;
        capacities[resource] = 1; resources.push(resource);
      }
    }
    if (capacities[cell * 5] || capacities[cell * 5 + 2]) {
      capacities[cell * 5 + 4] = rule.capacity; resources.push(cell * 5 + 4);
    }
    for (let direction = 0; direction < 4; direction++) {
      const x = cell % width + DELTAS[direction]!.x, y = Math.floor(cell / width) + DELTAS[direction]!.y;
      if (x >= 0 && y >= 0 && x < width && y < height) next[cell * 4 + direction] = y * width + x;
    }
  }
  const lines = wires.map(wire => ({
    kind: wire.source.kind === LOGISTICS_KIND.pipe ? 1 as const : 0 as const,
    start: (wire.source.outside.y - bounds.y) * width + wire.source.outside.x - bounds.x,
    goal: (wire.target.outside.y - bounds.y) * width + wire.target.outside.x - bounds.x,
    incoming: EDGES.indexOf(wire.source.edge), outgoing: EDGES.indexOf(opposite(wire.target.edge)),
    // 潜在零格直连按零资源放宽；不能用物流设备身份或长度要求制造额外必要冲突。
    direct: wire.source.outside.x === wire.target.cell.x && wire.source.outside.y === wire.target.cell.y
      && wire.target.outside.x === wire.source.cell.x && wire.target.outside.y === wire.source.cell.y,
  }));
  // 非法几何交回原共同裁判；本下界只在端点位于有限格网内时计算。
  if (wires.some(wire => [wire.source.outside, wire.target.outside].some(point => point.x < bounds.x
    || point.x >= bounds.x + width || point.y < bounds.y || point.y >= bounds.y + height))) return false;
  const normalization = resources.reduce((sum, resource) => sum + capacities[resource]!, 0);
  if (!normalization || lines.every(line => line.direct)) return false;
  const queue = new PlannerRoutingSearch();
  const audit = (weights: Float64Array, recordUsage: boolean) => {
    const usage = new Uint32Array(weights.length), minimums: number[] = [];
    for (const line of lines) {
      if (line.direct) { minimums.push(0); continue; }
      queue.reset(0); queue.push(line.start, line.incoming, 0, 0, 0, -1);
      let tail = -1;
      while (queue.size) {
        const entry = queue.pop();
        if (queue.stale(entry)) continue;
        const cell = queue.cells[entry]!, incoming = queue.directions[entry]!;
        if (cell === size) { tail = entry; break; }
        const state = states[line.kind][cell]!;
        if ((state & ROUTE_BLOCKED) || !(state & (1 << (ROUTE_ENTER_SHIFT + incoming)))
          || cell === line.start && incoming !== line.incoming) continue;
        for (let outgoing = 0; outgoing < 4; outgoing++) {
          if (cell === line.goal && outgoing !== line.outgoing || !(state & (1 << (incoming * 4 + outgoing)))
            || cell !== line.start && cell !== line.goal && !allowsPlannerReservationTransit(state, incoming, outgoing)) continue;
          const target = cell === line.goal ? size : next[cell * 4 + outgoing]!;
          if (target < 0) continue;
          const cost = queue.costs[entry]! + weights[cell * 5 + line.kind * 2 + incoming % 2]!
            + (incoming % 2 !== outgoing % 2 ? weights[cell * 5 + line.kind * 2 + outgoing % 2]! : 0)
            + rule.weights[line.kind] * weights[cell * 5 + 4]!;
          queue.push(target, outgoing, 0, cost, cost, entry);
        }
      }
      // 未找到单线路径不是该整数证书；原断连检查和正式 Router 继续负责它。
      if (tail < 0) return undefined;
      minimums.push(queue.costs[tail]!);
      if (recordUsage) while (queue.parents[tail]! >= 0) {
        const parent = queue.parents[tail]!, cell = queue.cells[parent]!;
        const incoming = queue.directions[parent]!, outgoing = queue.directions[tail]!;
        usage[cell * 5 + line.kind * 2 + incoming % 2]!++;
        if (incoming % 2 !== outgoing % 2) usage[cell * 5 + line.kind * 2 + outgoing % 2]!++;
        usage[cell * 5 + 4]! += rule.weights[line.kind]; tail = parent;
      }
    }
    const capacity = resources.reduce((sum, resource) => sum + weights[resource]! * capacities[resource]!, 0);
    const required = minimums.reduce((sum, value) => sum + value, 0);
    return { capacity, required, gap: required - capacity, minimums, usage };
  };
  const weights = new Float64Array(capacities.length);
  for (const resource of resources) weights[resource] = 1 / normalization;
  for (let iteration = 0; iteration < 32; iteration++) {
    const result = audit(weights, true);
    if (!result) return false;
    if (result.gap > 1e-8) {
      const proof = audit(weights.map(weight => Math.round(weight * 1e8)), false);
      if (proof && proof.gap > 0
        && [proof.capacity, proof.required, proof.gap, ...proof.minimums].every(Number.isSafeInteger)) return true;
    }
    const logs = new Float64Array(weights.length), step = 1 / Math.sqrt(iteration + 1);
    let maximum = -Infinity;
    for (const resource of resources) {
      logs[resource] = Math.log(Math.max(weights[resource]!, 1e-300)) + step * result.usage[resource]! / capacities[resource]!;
      maximum = Math.max(maximum, logs[resource]!);
    }
    let sum = 0;
    for (const resource of resources) {
      weights[resource] = Math.exp(logs[resource]! - maximum); sum += weights[resource]! * capacities[resource]!;
    }
    for (const resource of resources) weights[resource] = weights[resource]! / sum;
  }
  return false;
}

/** 已有纯格网检查为零后，补充跨物流类型共享容量。零只表示本次未找到必要冲突。 */
// AI-CORRECTION 2026-10-23：联合定价同时保留各线方向与端点配对；单一物流也可能形成原汇总流量遗漏的必要冲突。
export function countPlannerCoupledCapacityDeficit(registry: RegistryContract, grid: PlannerRoutingGrid,
  wires: readonly Pick<PlannerWire, "source" | "target">[], bounds: GridRect): number {
  // AI-REMOVED 2026-10-23:
  // Reason: 单一物流仍需要保留端点配对的必要容量检查，不能因没有跨类型混用而跳过。
  // Trigger: EDA-008 全部为传送带，原59/63状态的方向配对瓶颈被提前返回漏掉。
  // Evidence: Windows probe604 第8轮正缺口1344480，probe606独立整数最短路逐项精确复核；四完整对照均通过。
  // Replacement: 下方空线路检查；其余Registry派生规则和整数证书路径保持统一。
  // Risk: 单一物流新增32轮内的必要条件成本，缓存仍有界；未发现证书仍表示未知。
  // Human Review: Required
  //
  // Original code:
  // if (new Set(wires.map(wire => wire.source.kind)).size < 2) return 0;
  if (!wires.length) return 0;
  const cache = registryCapacityCache(registry);
  if (!cache.rules.length) return 0;
  const masks: number[] = [];
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
    const cell = grid.cell(x, y);
    for (const kind of [0, 1]) masks.push(grid.read(cell, kind) & STATIC_MASK);
  }
  const key = JSON.stringify([bounds, masks, wires.map(wire => [wire.source, wire.target])]);
  const previous = cache.layouts.get(key);
  if (previous !== undefined) return previous;
  const deficit = Number(cache.rules.some(rule => hasCoupledCapacityCertificate(grid, wires, bounds, rule)));
  cache.layouts.set(key, deficit);
  if (cache.layouts.size > 64) cache.layouts.delete(cache.layouts.keys().next().value!);
  return deficit;
}
