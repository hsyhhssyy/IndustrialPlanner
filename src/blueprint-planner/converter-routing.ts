import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import { converterConsumers, planConverterSupply } from "./converter-supply";
import { PlannerCandidateError, type MaterialDemand, type PlannerNetwork, type PlannerWire } from "./model";
import { PlannerPlacement } from "./placement";
import { prepareConverterStartups } from "./support";
import { wireProductionNetwork } from "./wiring";
import { PlannerRouter } from "./router";
import type { PlannerRoutingBackend } from "./routing-backend";
import type { PlannerSearchStatistics } from "./search-types";
import { getPlannerPorts, transportCapacity, ROTATIONS } from "./geometry";
import { auditPlannerSupply } from "./supply-audit";
// AI-REMOVED 2026-10-09: 固定主体重排改用共享退火器，逐步反馈布线失败；原构造器整轮扫描耗尽局部预算。
// Evidence: 五机原图同摆位 9 个组合耗尽 15000 次仍无重建成功。
// Replacement: CompactLayoutSearch 的 fixedNodeIds。Risk: 有界搜索不保证可行解；Human Review: Required。
// Original code: import { constructCompactLayout } from "./constructive-layout";
import { CompactLayoutSearch } from "./compact-layout";
import { resolveSearchProfile } from "./search-profile";

export interface ConverterRebuildScope {
  readonly items: ReadonlySet<string>;
  readonly nodes: ReadonlySet<string>;
  readonly controls: ReadonlySet<string>;
  readonly wires: ReadonlySet<PlannerWire>;
}

/** 沿同物料连通分量圈定循环子网；混料控制、库存链接和边界设施不属于可删除对象。 */
export function converterRebuildScope(registry: RegistryContract, network: PlannerNetwork, wires: readonly PlannerWire[]): ConverterRebuildScope {
  const consumers = converterConsumers(registry, network);
  const items = new Set<string>(), selected = new Set<PlannerWire>(), ids = new Set<string>(), controls = new Set<string>();
  const linked = new Set(network.slotLinks.flatMap(link => [link.source.entityId, link.target.entityId]));
  for (const itemId of new Set(consumers.map(entry => entry.input.itemId))) {
    const component = new Set(consumers.filter(entry => entry.input.itemId === itemId).map(entry => entry.node.entity.id));
    const edges = new Set<PlannerWire>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const wire of wires) if (wire.itemIds.includes(itemId)
        && (component.has(wire.source.entityId) || component.has(wire.target.entityId))) {
        edges.add(wire);
        for (const id of [wire.source.entityId, wire.target.entityId]) if (!component.has(id)) { component.add(id); changed = true; }
      }
    }
    if (!edges.size || [...edges].some(wire => wire.itemIds.length !== 1)) continue;
    const removable = network.nodes.filter(node => component.has(node.entity.id) && !node.recipe && !node.boundaryPort && !node.external
      && !["supply", "product", "byproduct", "power", "environment"].includes(node.purpose)
      && (registry.queries.isGeneralLogisticsDevice(node.definition.id) || ["gas_storager_1", "liquid_storager_1"].includes(node.definition.id)));
    if (removable.some(node => linked.has(node.entity.id)
      || wires.some(wire => (wire.source.entityId === node.entity.id || wire.target.entityId === node.entity.id) && !edges.has(wire)))) continue;
    items.add(itemId);
    for (const wire of edges) selected.add(wire);
    for (const id of component) ids.add(id);
    for (const node of removable) controls.add(node.entity.id);
  }
  return { items, nodes: ids, controls, wires: selected };
}

/** 主体上的可变字段仅为本子网物料端口的过滤与输出优先级；配方、库存及其他端口保持原样。 */
export function converterPortConfigKeys(registry: RegistryContract, node: PlannerNetwork["nodes"][number], items: ReadonlySet<string>): Set<string> {
  return new Set((["input", "output"] as const).flatMap(direction => (direction === "input" ? node.inputs : node.outputs)
    .filter(flow => items.has(flow.itemId)).flatMap(flow => getPlannerPorts(registry, node.entity, node.definition, direction, flow.itemId, flow.storageGroupIds)
      .flatMap(port => ["acceptRule", "acceptRule.base", "acceptRule.exclude", "priorityGroup"]
        .map(field => `portGroups[${port.groupIndex}].ports[${port.portIndex}].${field}`)))));
}

/** 原图中不属于重建范围的控制保持原验收；只对新建的循环供料执行生成器约束。 */
export function auditConverterSupply(registry: RegistryContract, network: PlannerNetwork, wires: readonly PlannerWire[], routes: PlannerRouter["routes"]) {
  const scope = converterRebuildScope(registry, network, wires);
  return auditPlannerSupply(registry, { ...network, nodes: network.nodes.filter(node => scope.nodes.has(node.entity.id)).map(node => ({ ...node,
    inputs: node.inputs.filter(flow => scope.items.has(flow.itemId)), outputs: node.outputs.filter(flow => scope.items.has(flow.itemId)) })) },
  wires.filter(wire => scope.wires.has(wire)), routes);
}

/** Router 新建的桥接器只在所有经过通道都属于获准重建的供料网时放行。 */
export function isConverterRouteControl(registry: RegistryContract, entity: WorldEntity, scope: ConverterRebuildScope,
  routes: PlannerRouter["routes"]): boolean {
  if (!registry.queries.isPipeLogistics(entity.definitionId) || registry.queries.resolveLogisticsRole(entity.definitionId) !== "connector"
    || Object.keys(entity.config).length || entity.tags.length) return false;
  const crossing = routes.filter(route => route.cells.some(cell => cell.x === entity.position.x && cell.y === entity.position.y));
  return crossing.length >= 2 && crossing.every(route => [...scope.wires].some(wire => route.sourcePort === portKey(wire.source)
    && route.targetPort === portKey(wire.target)));
}

function aggregate(flows: readonly MaterialDemand[]): MaterialDemand[] {
  const result = new Map<string, MaterialDemand>();
  for (const flow of flows) {
    const key = JSON.stringify([flow.itemId, [...flow.storageGroupIds ?? []].sort()]);
    const previous = result.get(key);
    result.set(key, { ...flow, perMinute: (previous?.perMinute ?? 0) + flow.perMinute, sourceEntityIds: undefined });
  }
  return [...result.values()];
}

/** 从功能设备副本重建一次关系组合；失败不会污染原摆位、端口配置或续搜种子。 */
export async function rebuildConverterNetwork(registry: RegistryContract, original: PlannerNetwork, originalWires: readonly PlannerWire[],
  outline: { width: number; height: number }, variant: number, checkBudget: () => void) {
  const scope = converterRebuildScope(registry, original, originalWires);
  if (!scope.items.size) return null;
  const network: PlannerNetwork = { ...original, slotLinks: structuredClone(original.slotLinks),
    initialSlots: structuredClone(original.initialSlots.filter(slot => !scope.controls.has(slot.entityId))),
    nodes: original.nodes.filter(node => !scope.controls.has(node.entity.id)).map(node => ({ ...node,
      entity: structuredClone(node.entity), inputs: structuredClone(node.inputs), outputs: structuredClone(node.outputs) })) };
  const placement = new PlannerPlacement(registry, outline.width, 0, 0, 0, 1);
  placement.maximumX = outline.width; placement.maximumY = outline.height;
  placement.auxiliaryRotation = ROTATIONS[variant % 4]!;
  placement.reserve(network.nodes);
  const subnet: PlannerNetwork = { ...network, nodes: network.nodes.filter(node => scope.nodes.has(node.entity.id)).map(node => {
    for (const key of converterPortConfigKeys(registry, node, scope.items)) delete node.entity.config[key];
    return { ...node, inputs: aggregate(node.inputs.filter(flow => scope.items.has(flow.itemId))),
      outputs: aggregate(node.outputs.filter(flow => scope.items.has(flow.itemId))), outputSource: undefined, outputSources: undefined,
      supplyTarget: undefined, supplyTargets: undefined };
  }) };
  prepareConverterStartups(registry, subnet, placement, planConverterSupply(registry, subnet, variant));
  const rebuilt = await wireProductionNetwork(registry, subnet, placement, checkBudget, variant % 2 === 0, variant % 3 !== 1, false, scope.items);
  // 生成器按完整网表分配编号；子网外节点同样可能占用了这些编号，合并前统一消除冲突。
  const reserved = new Set(network.nodes.map(node => node.entity.id));
  const renamed = new Map<string, string>();
  for (const node of subnet.nodes.filter(node => !scope.nodes.has(node.entity.id) || scope.controls.has(node.entity.id))) {
    let id = node.entity.id;
    while (reserved.has(id)) id += "_";
    reserved.add(id); renamed.set(node.entity.id, id);
  }
  const idOf = (id: string) => renamed.get(id) ?? id;
  for (const node of subnet.nodes) {
    const entity = { ...node.entity, id: idOf(node.entity.id) };
    const remap = (flows: readonly MaterialDemand[]) => flows.map(flow => ({ ...flow, sourceEntityIds: flow.sourceEntityIds?.map(idOf) }));
    const replacement = { ...node, entity, inputs: remap(node.inputs), outputs: remap(node.outputs),
      supplyTarget: node.supplyTarget && { ...node.supplyTarget, entityId: idOf(node.supplyTarget.entityId) },
      outputSource: node.outputSource && { ...node.outputSource, entityId: idOf(node.outputSource.entityId) } };
    const index = network.nodes.findIndex(entry => entry.entity.id === node.entity.id && !scope.controls.has(entry.entity.id));
    if (index >= 0 && !renamed.has(node.entity.id)) {
      const old = network.nodes[index]!;
      network.nodes[index] = { ...replacement, inputs: [...old.inputs.filter(flow => !scope.items.has(flow.itemId)), ...replacement.inputs],
        outputs: [...old.outputs.filter(flow => !scope.items.has(flow.itemId)), ...replacement.outputs] };
    } else network.nodes.push(replacement);
  }
  const wires = [...originalWires.filter(wire => !scope.wires.has(wire)), ...rebuilt.map(wire => ({ ...wire,
    source: { ...wire.source, entityId: idOf(wire.source.entityId) }, target: { ...wire.target, entityId: idOf(wire.target.entityId) } }))];
  return { network, wires, scope };
}

/** 同一主体摆位先尝试集中、级联、就近以及多个独立启动根；每次组合消耗同一个任务预算。 */
export async function routeConverterAlternatives(registry: RegistryContract, network: PlannerNetwork, wires: readonly PlannerWire[],
  statistics: PlannerSearchStatistics, variant: number, fixtures: readonly WorldEntity[], checkBudget: () => void,
  accept: (network: PlannerNetwork, wires: PlannerWire[], router: PlannerRouter) => Promise<boolean>, routing?: PlannerRoutingBackend,
  existingRoutes: PlannerRouter["routes"] = []) {
  const count = converterConsumers(registry, network).length;
  if (!count || network.request.options.converterStartup === "reject" || !network.request.options.converterStartup) return null;
  const variants = [0, 2, 1, 3 * count, 3 * count + 2, 3 * count + 1, 3, 5, 4].map(value => value + Math.floor(variant / 3) * 3);
  for (const choice of variants) {
    checkBudget();
    if (statistics.evaluations >= statistics.evaluationLimit) break;
    statistics.evaluations++;
    statistics.supplyTopologyAttempts = (statistics.supplyTopologyAttempts ?? 0) + 1;
    try {
      const candidate = await rebuildConverterNetwork(registry, network, wires, statistics.outline, choice, checkBudget);
      if (!candidate) return null;
      const fixed = new Set(network.nodes.filter(node => !candidate.scope.controls.has(node.entity.id)).map(node => node.entity.id));
      const local: PlannerSearchStatistics = { ...statistics, seed: choice, diagnostics: undefined, experiments: [],
        evaluationLimit: Math.min(statistics.evaluationLimit, statistics.evaluations + 1000) };
      const layout = new CompactLayoutSearch(registry, candidate.network, candidate.wires, local, resolveSearchProfile(statistics.profile), undefined, fixed);
      const preserved = new Set(wires.filter(wire => !candidate.scope.wires.has(wire)).map(wire => `${portKey(wire.source)}>${portKey(wire.target)}`));
      const cachedRoute = (wire: PlannerWire) => preserved.has(`${portKey(wire.source)}>${portKey(wire.target)}`)
        ? existingRoutes.find(route => route.sourcePort === portKey(wire.source) && route.targetPort === portKey(wire.target)) : undefined;
      const orderWires = () => [...candidate.wires].sort((a, b) => Number(Boolean(cachedRoute(b))) - Number(Boolean(cachedRoute(a))) || distance(a) - distance(b));
      let order = orderWires();
      for (let retry = 0; retry < 12; retry++) {
        checkBudget(); statistics.routingAttempts++;
        const router = new PlannerRouter(registry, [...candidate.network.nodes.map(node => node.entity), ...fixtures],
          candidate.wires.flatMap(wire => [wire.source, wire.target]), { minimumX: 0, minimumY: 0,
            maximumX: statistics.outline.width - 1, maximumY: statistics.outline.height - 1, escapeLength: 0 }, routing);
        let blocked: PlannerWire | undefined;
        try {
          for (const wire of order) {
            blocked = wire; checkBudget();
            const cached = cachedRoute(wire);
            if (!cached || !router.reuse(wire.source, wire.target, cached.cells, wire.minimumCells)) {
              await router.connect(wire.source, wire.target, checkBudget, wire.minimumCells);
            }
          }
          for (const node of network.nodes.filter(node => fixed.has(node.entity.id))) {
            const current = candidate.network.nodes.find(entry => entry.entity.id === node.entity.id)!;
            if (current.entity.position.x !== node.entity.position.x || current.entity.position.y !== node.entity.position.y
              || current.entity.rotation !== node.entity.rotation) throw new Error("同摆位供气搜索移动了固定设备。");
          }
          if (await accept(candidate.network, candidate.wires, router)) return { ...candidate, router,
            travelSeconds: candidate.wires.map(wire => {
              const route = router.routes.find(route => route.sourcePort === portKey(wire.source) && route.targetPort === portKey(wire.target))!;
              return (route.cells.length + 1) * 60 / transportCapacity(wire.source.kind);
            }) };
          break;
        } catch (error) {
          if (!(error instanceof PlannerCandidateError)) throw error;
          statistics.lastSupplyTopologyFailure = error.message;
          // AI-REMOVED 2026-10-09:
          // Reason: 全量构造新物流摆位在稀疏五机图中耗尽局部预算。
          // Trigger: 同摆位重建需要针对受阻边逐步调整辅助设施。
          // Evidence: 原图重建 8 次组合用尽 15000 次预算，只能回退旧图。
          // Replacement: 下方固定主体的 CompactLayoutSearch。
          // Risk: 有界搜索不保证最优；Human Review: Required。
          // Original code:
          // if (retry === 0) {
          // const fixed = new Set(network.nodes.filter(node => !candidate.scope.controls.has(node.entity.id)).map(node => node.entity.id));
          // const limit = Math.min(statistics.evaluationLimit, statistics.evaluations + 2000);
          // const poses = constructCompactLayout(registry, candidate.network, candidate.wires, statistics.outline, choice, () => {
          // checkBudget();
          // if (statistics.evaluations >= limit) return false;
          // statistics.evaluations++; return true;
          // }, { poses: candidate.network.nodes.map(node => ({ ...node.entity.position, rotation: node.entity.rotation })),
          // movable: candidate.network.nodes.flatMap((node, index) => fixed.has(node.entity.id) ? [] : [index]) });
          // if (poses) {
          // candidate.network.nodes.forEach((node, index) => {
          // node.entity.position = { x: poses[index]!.x, y: poses[index]!.y }; node.entity.rotation = poses[index]!.rotation;
          // });
          // const resolve = (port: PlannerWire["source"]) => {
          // const node = candidate.network.nodes.find(node => node.entity.id === port.entityId)!;
          // return getPlannerPorts(registry, node.entity, node.definition, port.direction)
          // .find(entry => entry.groupIndex === port.groupIndex && entry.portIndex === port.portIndex)!;
          // };
          // candidate.wires.splice(0, candidate.wires.length, ...candidate.wires.map(wire => ({ ...wire,
          // source: resolve(wire.source), target: resolve(wire.target) })));
          // order = [...candidate.wires].sort((a, b) => distance(a) - distance(b));
          // continue;
          // }
          // }
          if (blocked && (retry % 3 === 0 || !router.conflicts.size) && local.evaluations < local.evaluationLimit) {
            layout.penalize(blocked.source.entityId, blocked.target.entityId);
            const feasible = await layout.advance(Math.min(250, local.evaluationLimit - local.evaluations), () => {
              statistics.evaluations = local.evaluations; checkBudget();
            });
            statistics.evaluations = local.evaluations;
            if (feasible) {
              layout.applyBest();
              order = orderWires();
              continue;
            }
          }
          if (!blocked || !router.conflicts.size) break;
          order.splice(order.indexOf(blocked), 1); order.unshift(blocked);
        }
      }
    } catch (error) {
      if (!(error instanceof PlannerCandidateError)) throw error;
      statistics.lastSupplyTopologyFailure = error.message;
    }
  }
  return null;
}

const portKey = (port: PlannerWire["source"]) => `${port.entityId}/${port.groupIndex}/${port.portIndex}`;
const distance = (wire: PlannerWire) => Math.abs(wire.source.outside.x - wire.target.outside.x) + Math.abs(wire.source.outside.y - wire.target.outside.y);
