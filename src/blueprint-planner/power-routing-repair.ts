import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import { areGridRectsIntersecting, collectPoweredEntityIds, resolveEntityGridRect, resolvePowerRangeGridRect } from "@/shared/geometry/power-range";
import { PlannerCandidateError, type PlannerNetwork, type PlannerNode, type PlannerWire } from "./model";
import { createPlainNode } from "./placement";
import { PlannerRouter } from "./router";
import type { PlannerRoutingBackend } from "./routing-backend";
import type { PlannerSearchStatistics } from "./search-types";
import { placePower } from "./support";

/** 设备和端口固定；补电失败时只重布占据候选桩位的线路，最多检查 24 个桩位分支。 */
export async function completePlannerPowerRouting(registry: RegistryContract, network: PlannerNetwork,
  wires: readonly PlannerWire[], fixtures: readonly WorldEntity[], outline: { width: number; height: number },
  routed: PlannerRouter, statistics: PlannerSearchStatistics, checkBudget: () => void, routing?: PlannerRoutingBackend):
  Promise<{ router: PlannerRouter; powerNodes: PlannerNode[] } | null> {
  const portKey = (port: PlannerWire["source"]) => `${port.entityId}/${port.groupIndex}/${port.portIndex}`;
  const byRoute = new Map(wires.map(wire => [`${portKey(wire.source)}>${portKey(wire.target)}`, wire]));
  const routes = routed.routes.map(route => `${route.sourcePort}>${route.targetPort}`);
  if (byRoute.size !== wires.length || routes.length !== wires.length || new Set(routes).size !== wires.length
    || routes.some(route => !byRoute.has(route))) throw new Error("补电重布要求完整且属于当前网表的线路。");
  const initial = await placePower(registry, network, wires, [...fixtures, ...routed.entities], outline, checkBudget);
  const finish = (router: PlannerRouter, powerNodes: PlannerNode[]) => {
    const ids = new Set([...network.nodes.map(node => node.entity.id), ...fixtures.map(entity => entity.id), ...router.entities.map(entity => entity.id)]);
    for (const node of powerNodes) {
      while (ids.has(node.entity.id)) node.entity.id += "_";
      ids.add(node.entity.id);
    }
    return { router, powerNodes };
  };
  if (initial !== null) return finish(routed, initial);
  const definition = registry.queries.findEntityDefinition("power_diffuser_1")!;
  const endpoints = wires.flatMap(wire => [wire.source, wire.target]);
  const ports = endpoints.map(port => port.outside);
  const rectOf = (entity: WorldEntity) => resolveEntityGridRect({ entity, definition: registry.queries.findEntityDefinition(entity.definitionId)! });
  const pending: Array<{ router: PlannerRouter; powers: PlannerNode[]; skip: number }> = [{ router: routed, powers: [], skip: 0 }];
  let attempts = 0;
  while (pending.length && attempts < 24) {
    checkBudget();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const state = pending.pop()!;
    const nodes = [...network.nodes, ...state.powers];
    const powered = collectPoweredEntityIds(nodes.map(node => node.entity), registry.entityDefinitions);
    const targets = network.nodes.filter(node => node.definition.requiresPower && !powered.has(node.entity.id));
    const targetRects = targets.map(node => resolveEntityGridRect(node));
    const bodies = [...nodes.map(node => resolveEntityGridRect(node)), ...fixtures.map(rectOf)];
    const tracks = state.router.entities.map(rectOf);
    const pole = createPlainNode(registry, definition.id, `eda-power-reserved-${state.powers.length}`, "power");
    const ids = new Set([...nodes.map(node => node.entity.id), ...fixtures.map(entity => entity.id)]);
    while (ids.has(pole.entity.id)) pole.entity.id += "_";
    const sites: Array<{ x: number; y: number; covered: number[]; blocked: boolean; routes: number[] }> = [];
    for (let y = 0; y + definition.footprint.height <= outline.height; y++) {
      checkBudget();
      for (let x = 0; x + definition.footprint.width <= outline.width; x++) {
        const rect = { x, y, ...definition.footprint };
        if (bodies.some(other => areGridRectsIntersecting(rect, other))
          || ports.some(port => port.x >= x && port.x < x + rect.width && port.y >= y && port.y < y + rect.height)) continue;
        const range = resolvePowerRangeGridRect({ entity: { ...pole.entity, position: { x, y } }, definition })!;
        const covered = targetRects.flatMap((other, index) => areGridRectsIntersecting(range, other) ? [index] : []);
        if (!covered.length) continue;
        const routes = state.router.routes.flatMap((route, index) => route.cells.some(cell => cell.x >= x && cell.x < x + rect.width
          && cell.y >= y && cell.y < y + rect.height) ? [index] : []);
        sites.push({ x, y, covered, routes, blocked: tracks.some(other => areGridRectsIntersecting(rect, other)) });
      }
    }
    const missing = targets.findIndex((_node, index) => !sites.some(site => !site.blocked && site.covered.includes(index)));
    // 没有覆盖位置是当前修复的因果入口；普通供电贪心的其他失败继续交给布局搜索。
    if (missing < 0) continue;
    const choices = sites.filter(site => site.covered.includes(missing))
      .sort((a, b) => a.routes.length - b.routes.length || b.covered.length - a.covered.length);
    for (let choice = state.skip; choice < choices.length && attempts < 24; choice++) {
      checkBudget(); attempts++; statistics.routingAttempts++;
      const site = choices[choice]!;
      const fixed = { ...pole, entity: { ...pole.entity, position: { x: site.x, y: site.y } } };
      const powers = [...state.powers, fixed];
      const router = new PlannerRouter(registry, [...network.nodes.map(node => node.entity), ...powers.map(node => node.entity), ...fixtures],
        endpoints, { minimumX: 0, minimumY: 0, maximumX: outline.width - 1, maximumY: outline.height - 1, escapeLength: 0 }, routing);
      try {
        for (const [index, route] of state.router.routes.entries()) {
          checkBudget();
          if (site.routes.includes(index)) continue;
          const wire = byRoute.get(`${route.sourcePort}>${route.targetPort}`)!;
          if (!router.reuse(wire.source, wire.target, route.cells, wire.minimumCells)) throw new PlannerCandidateError("补电重布无法保留原线路");
          statistics.reusedRoutes = (statistics.reusedRoutes ?? 0) + 1;
        }
        for (const index of site.routes) {
          checkBudget();
          const route = state.router.routes[index]!, wire = byRoute.get(`${route.sourcePort}>${route.targetPort}`)!;
          await router.connect(wire.source, wire.target, checkBudget, wire.minimumCells);
        }
        if (statistics.summary) statistics.summary.fullyRoutedAttempts++;
        if (statistics.diagnostics) statistics.diagnostics.fullyRoutedAttempts++;
        const coverage = await placePower(registry, { ...network, nodes: [...network.nodes, ...powers] }, wires,
          [...fixtures, ...router.entities], outline, checkBudget);
        if (coverage !== null) return finish(router, [...powers, ...coverage]);
        // 先继续处理同一布局的下一处受阻桩位；失败时再尝试本层其他位置。
        pending.push({ ...state, skip: choice + 1 }, { router, powers, skip: 0 });
        break;
      } catch (error) {
        if (!(error instanceof PlannerCandidateError)) throw error;
      }
    }
  }
  return null;
}
