import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { getPlannerPorts } from "./geometry";
import type { PlannerNetwork, PlannerNode, PlannerWire } from "./model";
import type { PlannerRouter } from "./router";
import type { PlannerSearchStatistics } from "./search-types";

/** 续搜只序列化可变状态和 Registry id，不复制设备定义，也不把已验证结果作为可修改对象传入。 */
export interface PlannerSearchSeed {
  /** 当前保存边界下共同几何裁判确认的静态断连数；普通可行布局与完整成果省略时为零。 */
  readonly disconnectedWires?: number;
  /** 当前 Router 静态图的共同通道容量缺口下界；不包含上述单线不可达数。 */
  readonly capacityDeficit?: number;
  /** 已完成候选的固定评分，供成果池沿用与 Host 相同的同面积选优规则。 */
  readonly quality?: PlannerSearchStatistics["quality"];
  readonly requestKey: string;
  readonly network: Omit<PlannerNetwork, "nodes"> & {
    readonly nodes: readonly (Omit<PlannerNode, "definition" | "recipe"> & { readonly recipeId: string | null })[];
  };
  readonly wires: readonly PlannerWire[];
  readonly routes: PlannerRouter["routes"];
  readonly width: number;
  readonly height: number;
}

/** 未完成路径与静态通道缺口共同决定进展；同缺口数先保留可达状态，再比较待接距离。 */
// AI-CORRECTION 2026-10-21：加入多线共享通道的容量缺口；同总缺口先比较单线可达性，再比较容量和距离。
// AI-CORRECTION 2026-10-22：静态必要条件优先于未完成路径，再比较断连、缺线和距离；避免已证容量不足的多连线状态挤掉可行入口。
export function plannerPartialRank(seed: Pick<PlannerSearchSeed, "wires" | "routes" | "disconnectedWires" | "capacityDeficit">): readonly [number, number, number, number] {
  const disconnected = seed.disconnectedWires ?? 0, capacity = seed.capacityDeficit ?? 0, count = Math.max(1, seed.wires.length);
  if (![disconnected, capacity].every(value => Number.isSafeInteger(value) && value >= 0) || disconnected + capacity > seed.wires.length) {
    throw new Error("部分布局的静态断连计数无效。");
  }
  const routed = new Set(seed.routes.map(route => `${route.sourcePort}>${route.targetPort}`));
  const distance = seed.wires.reduce((sum, wire) => {
    const key = `${wire.source.entityId}/${wire.source.groupIndex}/${wire.source.portIndex}>${wire.target.entityId}/${wire.target.groupIndex}/${wire.target.portIndex}`;
    return sum + (Math.abs(wire.source.outside.x - wire.target.outside.x) + Math.abs(wire.source.outside.y - wire.target.outside.y))
      * (routed.has(key) ? 0.05 : 1);
  }, 0);
  // AI-REMOVED 2026-10-22:
  // Reason: 总缺口混合必要约束违例和暂未布线路径，淘汰静态安全入口。
  // Trigger: 胶囊 54/63 缺口 0 被 60/63 缺口 1 覆盖。
  // Evidence: Windows probe531～533 的真实共享池保留结果。
  // Replacement: 下方可行性优先四元组，全部调用方共用。
  // Risk: 搜索顺序改变，须按原种子与预算冷启动复核。
  // Human Review: Required
  // Original code:
  // return [(seed.wires.length - seed.routes.length + disconnected + capacity) / count,
  //   disconnected / count, capacity / count, distance / count];
  return [(disconnected + capacity) / count, disconnected / count,
    (seed.wires.length - seed.routes.length) / count, distance / count];
}

/** 局部修复、本批快照与跨批缓存使用同一排序，避免低距离的静态断路覆盖实际进展。 */
export function comparePlannerPartialSeeds(left: Pick<PlannerSearchSeed, "wires" | "routes" | "disconnectedWires" | "capacityDeficit">,
  right: Pick<PlannerSearchSeed, "wires" | "routes" | "disconnectedWires" | "capacityDeficit">): number {
  const a = plannerPartialRank(left), b = plannerPartialRank(right);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3];
}

const restoredSeeds = new WeakMap<PlannerSearchSeed, PlannerSearchSeed>();
const immutableSeeds = new WeakSet<PlannerSearchSeed>();

/** 已发布种子不可变；分片快照只复制访问计数，共享种子内容。 */
export function retainPlannerSeed(seed: PlannerSearchSeed, copy = false): PlannerSearchSeed {
  if (immutableSeeds.has(seed)) return seed;
  const restored = restoredSeeds.get(seed);
  if (copy && restored) return restored;
  const result = copy ? structuredClone(seed) : seed;
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
    Object.freeze(value);
    for (const entry of Object.values(value)) freeze(entry);
  };
  freeze(result);
  immutableSeeds.add(result);
  if (copy) restoredSeeds.set(seed, result);
  return result;
}

export function plannerRequestKey(request: BlueprintPlannerRequest): string {
  // 拒绝模式与旧任务缺省同义，省略此字段以保留已有检查点的请求指纹。
  return JSON.stringify({ boundaryVersion: 1, ...request, options: { ...request.options,
    warehousePortPlacement: (request.options.warehousePortPlacement ?? "any") === "any" ? undefined : request.options.warehousePortPlacement,
    converterStartup: (request.options.converterStartup ?? "reject") === "reject" ? undefined : request.options.converterStartup,
    // 2026-10-17：执行控制不改变生产约束或布局种子的兼容性。
    budgetMs: 0, evaluationsPerRound: 0, concurrency: undefined, gpu: undefined,
    randomSeed: undefined, initialArea: undefined, stopAfterFirstSolution: undefined, deterministicSearch: undefined } });
}

export function capturePlannerSeed(request: BlueprintPlannerRequest, network: PlannerNetwork, wires: readonly PlannerWire[],
  routes: PlannerRouter["routes"], width: number, height: number, origin = { x: 0, y: 0 }): PlannerSearchSeed {
  const point = (p: { x: number; y: number }) => ({ x: p.x - origin.x, y: p.y - origin.y });
  const port = (p: PlannerWire["source"]) => ({ ...p, cell: point(p.cell), outside: point(p.outside) });
  return structuredClone({ requestKey: plannerRequestKey(request), width, height,
    routes: routes.map(route => ({ ...route, cells: route.cells.map(point) })),
    wires: wires.map(wire => ({ ...wire, source: port(wire.source), target: port(wire.target) })),
    // 2026-10-21：已进入联合布局的供电设施属于可续搜状态；仅延后补电的种子继续过滤派生桩位。
    network: { ...network, nodes: network.nodes.filter(node => request.blueprintSource || network.deferPowerPlacement === false || node.purpose !== "power").map(node => ({
      entity: { ...node.entity, position: point(node.entity.position) }, recipeId: node.recipe?.id ?? null,
      purpose: node.purpose, inputs: node.inputs, outputs: node.outputs, external: node.external,
      boundaryPort: node.boundaryPort,
      supplyTarget: node.supplyTarget, supplyTargets: node.supplyTargets, outputSource: node.outputSource, outputSources: node.outputSources,
    })) } });
}

export function restorePlannerSeed(registry: RegistryContract, request: BlueprintPlannerRequest, seed: PlannerSearchSeed) {
  if (seed.requestKey !== plannerRequestKey(request)) throw new Error("续搜布局与当前生产方案或供给条件不一致。");
  const snapshot = structuredClone(seed);
  const network: PlannerNetwork = { ...snapshot.network, nodes: snapshot.network.nodes.map(({ recipeId, ...node }) => {
    const definition = registry.queries.findEntityDefinition(node.entity.definitionId);
    const recipe = recipeId === null ? null : registry.queries.findRecipeDefinition(recipeId);
    if (!definition || (recipeId !== null && !recipe)) throw new Error("续搜布局引用了不存在的设备或配方。");
    return { ...node, definition, recipe };
  }) };
  const nodes = new Map(network.nodes.map(node => [node.entity.id, node]));
  const wires = snapshot.wires.map(wire => {
    const resolve = (port: PlannerWire["source"]) => {
      const node = nodes.get(port.entityId);
      if (!node) throw new Error("续搜连接引用了不存在的设备。");
      const current = getPlannerPorts(registry, node.entity, node.definition, port.direction)
        .find(entry => entry.groupIndex === port.groupIndex && entry.portIndex === port.portIndex);
      if (!current) throw new Error("续搜连接引用了不存在的端口。");
      return current;
    };
    return { ...wire, source: resolve(wire.source), target: resolve(wire.target) };
  });
  return { network, wires };
}
