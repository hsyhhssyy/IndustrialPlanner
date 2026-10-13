import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { getPlannerPorts } from "./geometry";
import type { PlannerNetwork, PlannerNode, PlannerWire } from "./model";
import type { PlannerRouter } from "./router";

/** 续搜只序列化可变状态和 Registry id，不复制设备定义，也不把已验证结果作为可修改对象传入。 */
export interface PlannerSearchSeed {
  readonly requestKey: string;
  readonly network: Omit<PlannerNetwork, "nodes"> & {
    readonly nodes: readonly (Omit<PlannerNode, "definition" | "recipe"> & { readonly recipeId: string | null })[];
  };
  readonly wires: readonly PlannerWire[];
  readonly routes: PlannerRouter["routes"];
  readonly width: number;
  readonly height: number;
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
    budgetMs: 0, evaluationsPerRound: 0, concurrency: undefined, gpu: undefined } });
}

export function capturePlannerSeed(request: BlueprintPlannerRequest, network: PlannerNetwork, wires: readonly PlannerWire[],
  routes: PlannerRouter["routes"], width: number, height: number, origin = { x: 0, y: 0 }): PlannerSearchSeed {
  const point = (p: { x: number; y: number }) => ({ x: p.x - origin.x, y: p.y - origin.y });
  const port = (p: PlannerWire["source"]) => ({ ...p, cell: point(p.cell), outside: point(p.outside) });
  return structuredClone({ requestKey: plannerRequestKey(request), width, height,
    routes: routes.map(route => ({ ...route, cells: route.cells.map(point) })),
    wires: wires.map(wire => ({ ...wire, source: port(wire.source), target: port(wire.target) })),
    network: { ...network, nodes: network.nodes.filter(node => request.blueprintSource || node.purpose !== "power").map(node => ({
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
