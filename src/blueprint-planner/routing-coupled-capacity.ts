
// AI-REMOVED 2026-10-26:
// Reason: 用户要求恢复 beta1/2 搜索内核，撤回其后搜索实现；保留业务正确性修复与公开任务接口。
// Trigger: 多版本对照后用户明确要求回退算法并使用 2S 渐增至 3S 初始面积。
// Evidence: .temp/eda/all-items/comparisons/default-area-20261026T015057315Z.json；回退前 SHA256 cadb8caafafdf2f58c7da2c72ea98b700179c67ac05d1451262eba095016ec78。
// Replacement: None；功能随 beta1/2 搜索内核回退撤下
// Risk: 搜索策略、检查点及后续局部修复能力变化；原始未提交内容完整保留。
// Human Review: Required
// Original code (src/blueprint-planner/routing-coupled-capacity.ts):
// import type { RegistryContract } from "@/domain/registry/registry-contract";
// import type { GridRect } from "@/domain/shared/grid";
// import { LOGISTICS_KIND, LOGISTICS_KINDS } from "@/domain/shared/logistics";
// import { allowsPlannerOverlap, DELTAS, EDGES, findLogisticsDevice, opposite } from "./geometry";
// import type { PlannerWire } from "./model";
// import { PlannerRoutingSearch } from "./routing-search";
// import {
//   allowsPlannerReservationTransit, ROUTE_BLOCKED, ROUTE_ENTER_SHIFT, ROUTE_OPEN,
//   ROUTE_RESERVED, ROUTE_RESERVED_AXIS_SHIFT, type PlannerRoutingGrid,
// } from "./routing-grid";
//
// interface CoupledCapacityRule {
//   readonly weights: readonly [number, number];
//   readonly capacity: number;
// }
//
// interface RegistryCapacityCache {
//   readonly rules: readonly CoupledCapacityRule[];
//   readonly layouts: Map<string, number>;
// }
//
// const registryCaches = new WeakMap<RegistryContract, RegistryCapacityCache>();
// const STATIC_MASK = ROUTE_BLOCKED | ROUTE_RESERVED | (3 << ROUTE_RESERVED_AXIS_SHIFT);
//
// /** 从实际桥接器与全部异族路径形状推导共同资源，不按物品或蓝图选择规则。 */
// function registryCapacityCache(registry: RegistryContract): RegistryCapacityCache {
//   const cached = registryCaches.get(registry);
//   if (cached) return cached;
//   const definitions = LOGISTICS_KINDS.map(kind => ({
//     connector: findLogisticsDevice(registry, kind, "connector"),
//     segments: (["straight", "turn-cw", "turn-ccw"] as const).map(shape =>
//       registry.queries.findEntityDefinition(registry.queries.resolveLogisticsDefinitionId(kind, shape))!),
//   }));
//   const rules: CoupledCapacityRule[] = [];
//   for (const kind of [0, 1] as const) {
//     const own = definitions[kind]!, other = definitions[1 - kind]!;
//     if ([other.connector, ...other.segments].every(definition => !allowsPlannerOverlap(registry, own.connector, definition))) {
//       // 2026-10-23：同族两线共格必须升级桥接器。若其不容许异族，两线时异族只能为零；
//       // 单线时异族至多两线，因此 2*同族线数+异族线数<=4 是必要条件。
//       rules.push({ weights: kind === 0 ? [2, 1] : [1, 2], capacity: 4 });
//     }
//   }
//   const result = { rules, layouts: new Map<string, number>() };
//   registryCaches.set(registry, result);
//   return result;
// }
//
// /** 有限次数的非负资源定价；只有安全整数权重重新验证的正缺口才返回冲突。 */
// function hasCoupledCapacityCertificate(grid: PlannerRoutingGrid,
//   wires: readonly Pick<PlannerWire, "source" | "target">[], bounds: GridRect, rule: CoupledCapacityRule): boolean {
//   const { width, height } = bounds, size = width * height;
//   const states = [new Uint32Array(size), new Uint32Array(size)] as const;
//   const transit = [new Uint8Array(size * 4), new Uint8Array(size * 4)] as const;
//   const next = new Int32Array(size * 4).fill(-1), capacities = new Uint32Array(size * 5), resources: number[] = [];
//   for (let cell = 0; cell < size; cell++) {
//     for (const kind of [0, 1] as const) {
//       states[kind][cell] = (grid.read(grid.cell(bounds.x + cell % width,
//         bounds.y + Math.floor(cell / width)), kind) & STATIC_MASK) | ROUTE_OPEN;
//       // 2026-10-23：固定的端点轴预留不随价格轮次或待查线路改变；仅预计算原通行谓词。
//       for (let incoming = 0; incoming < 4; incoming++) for (let outgoing = 0; outgoing < 4; outgoing++) {
//         if (allowsPlannerReservationTransit(states[kind][cell]!, incoming, outgoing)) {
//           transit[kind][cell * 4 + incoming] = transit[kind][cell * 4 + incoming]! | (1 << outgoing);
//         }
//       }
//       if (!(states[kind][cell]! & ROUTE_BLOCKED)) for (let axis = 0; axis < 2; axis++) {
//         const resource = cell * 5 + kind * 2 + axis;
//         capacities[resource] = 1; resources.push(resource);
//       }
//     }
//     if (capacities[cell * 5] || capacities[cell * 5 + 2]) {
//       capacities[cell * 5 + 4] = rule.capacity; resources.push(cell * 5 + 4);
//     }
//     for (let direction = 0; direction < 4; direction++) {
//       const x = cell % width + DELTAS[direction]!.x, y = Math.floor(cell / width) + DELTAS[direction]!.y;
//       if (x >= 0 && y >= 0 && x < width && y < height) next[cell * 4 + direction] = y * width + x;
//     }
//   }
//   const lines = wires.map(wire => ({
//     kind: wire.source.kind === LOGISTICS_KIND.pipe ? 1 as const : 0 as const,
//     start: (wire.source.outside.y - bounds.y) * width + wire.source.outside.x - bounds.x,
//     goal: (wire.target.outside.y - bounds.y) * width + wire.target.outside.x - bounds.x,
//     incoming: EDGES.indexOf(wire.source.edge), outgoing: EDGES.indexOf(opposite(wire.target.edge)),
//     // 潜在零格直连按零资源放宽；不能用物流设备身份或长度要求制造额外必要冲突。
//     direct: wire.source.outside.x === wire.target.cell.x && wire.source.outside.y === wire.target.cell.y
//       && wire.target.outside.x === wire.source.cell.x && wire.target.outside.y === wire.source.cell.y,
//   }));
//   // 非法几何交回原共同裁判；本下界只在端点位于有限格网内时计算。
//   if (wires.some(wire => [wire.source.outside, wire.target.outside].some(point => point.x < bounds.x
//     || point.x >= bounds.x + width || point.y < bounds.y || point.y >= bounds.y + height))) return false;
//   const normalization = resources.reduce((sum, resource) => sum + capacities[resource]!, 0);
//   if (!normalization || lines.every(line => line.direct)) return false;
//   const queue = new PlannerRoutingSearch(size + 1);
//   // AI-REMOVED 2026-10-23:
//   // Reason: 逆向格网A*未解除原90秒超时，约8884次仍低于11250片额，不采用额外队列。
//   // Trigger: Vitest固定产线回归；Evidence: .temp/.trash/eda-vitest-fix-20261023/ore-reverse-astar.json。
//   // Replacement: 原精确Dijkstra；Risk: 既有计算成本仍待修复；Human Review: Required
//   // Original code:
//   // const heuristicQueue = new PlannerRoutingSearch();
//   const audit = (weights: Float64Array, recordUsage: boolean) => {
//     const usage = new Uint32Array(weights.length), minimums: number[] = [];
//     // AI-REMOVED 2026-10-23:
//     // Reason: 全局最小单步价在非均匀拥塞价格下过弱，原90秒复测仍仅推进8863次，未解决Vitest超时。
//     // Trigger: 原固定产线回归超时；不能放大时限或预算。
//     // Evidence: .temp/.trash/eda-vitest-fix-20261023/ore-astar.json及对应CPU采样。
//     // Replacement: 下方忽略朝向/预留约束的逆向格网最短路，作为精确方向寻路的一致下界。
//     // Risk: 并列最短路径选择可能改变后续定价轨迹，整数证书与真实正反对照仍必跑。
//     // Human Review: Required
//     // Original code:
//     //     // 2026-10-23：每次移动至少支付其出轴及该格共享资源；再加目标格出轴，得到一致的曼哈顿下界。
//     //     // 沿用PlannerRoutingSearch的估价入口做A*，最短消耗仍精确计算，正证书继续独立整数复核。
//     //     const minimumStep = [[Infinity, Infinity], [Infinity, Infinity]];
//     //     for (const kind of [0, 1] as const) for (let cell = 0; cell < size; cell++) {
//     //       if (states[kind][cell]! & ROUTE_BLOCKED) continue;
//     //       for (const axis of [0, 1]) minimumStep[kind]![axis] = Math.min(minimumStep[kind]![axis]!,
//     //         weights[cell * 5 + kind * 2 + axis]! + rule.weights[kind] * weights[cell * 5 + 4]!);
//     //     }
//     //     for (const step of minimumStep) for (const axis of [0, 1]) if (!Number.isFinite(step[axis]!)) step[axis] = 0;
//     //     for (const line of lines) {
//     //       if (line.direct) { minimums.push(0); continue; }
//     //       const goalX = line.goal % width, goalY = Math.floor(line.goal / width), step = minimumStep[line.kind]!;
//     //       const estimate = (cell: number) => cell === size ? 0 : Math.abs(cell % width - goalX) * step[1]!
//     //         + Math.abs(Math.floor(cell / width) - goalY) * step[0]! + step[line.outgoing % 2]!;
//     //       queue.reset(0); queue.push(line.start, line.incoming, 0, 0, estimate(line.start), -1);
//     // AI-REMOVED 2026-10-23:
//     // Reason: 逆向启发式预计算抵消了定向寻路收益，原回归仍90秒超时，撤回未采用算法。
//     // Trigger: 同输入/同预算性能复测未改善。
//     // Evidence: .temp/.trash/eda-vitest-fix-20261023/ore-reverse-astar.json及对应CPU采样。
//     // Replacement: 下方原精确Dijkstra和后续共用有界缓冲；不继续叠加估价方案。
//     // Risk: 并列路径恢复原顺序；Human Review: Required
//     // Original code:
//     //     const remainingCosts = new Float64Array(size);
//     //     for (const line of lines) {
//     //       if (line.direct) { minimums.push(0); continue; }
//     //       // 放宽朝向与端点预留，但保留本体与每格出轴价格；真实路径的每一步成本均不低于此模型。
//     //       remainingCosts.fill(Infinity);
//     //       const goalCost = weights[line.goal * 5 + line.kind * 2 + line.outgoing % 2]!
//     //         + rule.weights[line.kind] * weights[line.goal * 5 + 4]!;
//     //       heuristicQueue.reset(0); heuristicQueue.push(line.goal, 0, 0, goalCost, goalCost, -1);
//     //       while (heuristicQueue.size) {
//     //         const entry = heuristicQueue.pop();
//     //         if (heuristicQueue.stale(entry)) continue;
//     //         const cell = heuristicQueue.cells[entry]!, cost = heuristicQueue.costs[entry]!;
//     //         remainingCosts[cell] = cost;
//     //         for (let direction = 0; direction < 4; direction++) {
//     //           const previous = next[cell * 4 + direction]!;
//     //           if (previous < 0 || (states[line.kind][previous]! & ROUTE_BLOCKED)) continue;
//     //           const candidate = cost + weights[previous * 5 + line.kind * 2 + direction % 2]!
//     //             + rule.weights[line.kind] * weights[previous * 5 + 4]!;
//     //           heuristicQueue.push(previous, 0, 0, candidate, candidate, entry);
//     //         }
//     //       }
//     //       if (!Number.isFinite(remainingCosts[line.start]!)) return undefined;
//     //       const estimate = (cell: number) => cell === size ? 0 : remainingCosts[cell]!;
//     //       queue.reset(0); queue.push(line.start, line.incoming, 0, 0, estimate(line.start), -1);
//     for (const line of lines) {
//       if (line.direct) { minimums.push(0); continue; }
//       queue.reset(0); queue.push(line.start, line.incoming, 0, 0, 0, -1);
//       let tail = -1;
//       while (queue.size) {
//         const entry = queue.pop();
//         if (queue.stale(entry)) continue;
//         const cell = queue.cells[entry]!, incoming = queue.directions[entry]!;
//         if (cell === size) { tail = entry; break; }
//         const state = states[line.kind][cell]!;
//         if ((state & ROUTE_BLOCKED) || !(state & (1 << (ROUTE_ENTER_SHIFT + incoming)))
//           || cell === line.start && incoming !== line.incoming) continue;
//         const firstCost = queue.costs[entry]! + weights[cell * 5 + line.kind * 2 + incoming % 2]!;
//         const sharedCost = rule.weights[line.kind] * weights[cell * 5 + 4]!;
//         for (let outgoing = 0; outgoing < 4; outgoing++) {
//           if (cell === line.goal && outgoing !== line.outgoing || !(state & (1 << (incoming * 4 + outgoing)))
//             || cell !== line.start && cell !== line.goal && !(transit[line.kind][cell * 4 + incoming]! & (1 << outgoing))) continue;
//           const target = cell === line.goal ? size : next[cell * 4 + outgoing]!;
//           if (target < 0) continue;
//           const cost = firstCost
//             + (incoming % 2 !== outgoing % 2 ? weights[cell * 5 + line.kind * 2 + outgoing % 2]! : 0)
//             + sharedCost;
//           queue.push(target, outgoing, 0, cost, cost, entry);
//         }
//       }
//       // 未找到单线路径不是该整数证书；原断连检查和正式 Router 继续负责它。
//       if (tail < 0) return undefined;
//       minimums.push(queue.costs[tail]!);
//       if (recordUsage) while (queue.parents[tail]! >= 0) {
//         const parent = queue.parents[tail]!, cell = queue.cells[parent]!;
//         const incoming = queue.directions[parent]!, outgoing = queue.directions[tail]!;
//         usage[cell * 5 + line.kind * 2 + incoming % 2]!++;
//         if (incoming % 2 !== outgoing % 2) usage[cell * 5 + line.kind * 2 + outgoing % 2]!++;
//         usage[cell * 5 + 4]! += rule.weights[line.kind]; tail = parent;
//       }
//     }
//     const capacity = resources.reduce((sum, resource) => sum + weights[resource]! * capacities[resource]!, 0);
//     const required = minimums.reduce((sum, value) => sum + value, 0);
//     return { capacity, required, gap: required - capacity, minimums, usage };
//   };
//   const weights = new Float64Array(capacities.length);
//   for (const resource of resources) weights[resource] = 1 / normalization;
//   for (let iteration = 0; iteration < 32; iteration++) {
//     const result = audit(weights, true);
//     if (!result) return false;
//     // AI-REMOVED 2026-10-23:
//     // Reason: 可行原始路径早停在本次超时输入无收益；撤回未采用的额外资源扫描。
//     // Trigger: 原90秒回归仍只能推进8863次；Evidence: ore-primal-early-exit.json。
//     // Replacement: 原32轮精确价格证书；Risk: 低负荷前缀潜在收益未保留；Human Review: Required
//     // Original code:
//     //     // 2026-10-23：这组实际最短路径若已满足放宽模型的全部资源容量，任意非负价格均不可能证明正缺口。
//     //     // 提前返回与原32轮结束相同的0；只证明此下界无证书，实际Router和最终验收仍继续负责。
//     //     if (resources.every(resource => result.usage[resource]! <= capacities[resource]!)) return false;
//     if (result.gap > 1e-8) {
//       const proof = audit(weights.map(weight => Math.round(weight * 1e8)), false);
//       if (proof && proof.gap > 0
//         && [proof.capacity, proof.required, proof.gap, ...proof.minimums].every(Number.isSafeInteger)) return true;
//     }
//     const logs = new Float64Array(weights.length), step = 1 / Math.sqrt(iteration + 1);
//     let maximum = -Infinity;
//     for (const resource of resources) {
//       logs[resource] = Math.log(Math.max(weights[resource]!, 1e-300)) + step * result.usage[resource]! / capacities[resource]!;
//       maximum = Math.max(maximum, logs[resource]!);
//     }
//     let sum = 0;
//     for (const resource of resources) {
//       weights[resource] = Math.exp(logs[resource]! - maximum); sum += weights[resource]! * capacities[resource]!;
//     }
//     for (const resource of resources) weights[resource] = weights[resource]! / sum;
//   }
//   return false;
// }
//
// /** 已有纯格网检查为零后，补充跨物流类型共享容量。零只表示本次未找到必要冲突。 */
// // AI-CORRECTION 2026-10-23：联合定价同时保留各线方向与端点配对；单一物流也可能形成原汇总流量遗漏的必要冲突。
// export function countPlannerCoupledCapacityDeficit(registry: RegistryContract, grid: PlannerRoutingGrid,
//   wires: readonly Pick<PlannerWire, "source" | "target">[], bounds: GridRect): number {
//   // AI-REMOVED 2026-10-23:
//   // Reason: 单一物流仍需要保留端点配对的必要容量检查，不能因没有跨类型混用而跳过。
//   // Trigger: EDA-008 全部为传送带，原59/63状态的方向配对瓶颈被提前返回漏掉。
//   // Evidence: Windows probe604 第8轮正缺口1344480，probe606独立整数最短路逐项精确复核；四完整对照均通过。
//   // Replacement: 下方空线路检查；其余Registry派生规则和整数证书路径保持统一。
//   // Risk: 单一物流新增32轮内的必要条件成本，缓存仍有界；未发现证书仍表示未知。
//   // Human Review: Required
//   //
//   // Original code:
//   // if (new Set(wires.map(wire => wire.source.kind)).size < 2) return 0;
//   if (!wires.length) return 0;
//   const cache = registryCapacityCache(registry);
//   if (!cache.rules.length) return 0;
//   const masks: number[] = [];
//   for (let y = bounds.y; y < bounds.y + bounds.height; y++) for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
//     const cell = grid.cell(x, y);
//     for (const kind of [0, 1]) masks.push(grid.read(cell, kind) & STATIC_MASK);
//   }
//   const key = JSON.stringify([bounds, masks, wires.map(wire => [wire.source, wire.target])]);
//   const previous = cache.layouts.get(key);
//   if (previous !== undefined) return previous;
//   const deficit = Number(cache.rules.some(rule => hasCoupledCapacityCertificate(grid, wires, bounds, rule)));
//   cache.layouts.set(key, deficit);
//   if (cache.layouts.size > 64) cache.layouts.delete(cache.layouts.keys().next().value!);
//   return deficit;
// }
//
