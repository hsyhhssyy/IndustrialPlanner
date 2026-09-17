import type { WorldEntity } from "@/domain/document/world-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import type { PlannerNetwork } from "./model";
import type { PlannerRouter } from "./router";
import type { PlannerSearchStatistics } from "./search-types";
import { getPlannerPorts, opposite, transportCapacity } from "./geometry";
import { PlannerCandidateError } from "./model";

/** 验收评分固定，不接受训练权重；长度在单入单出物流节点处连续累计。 */
export function measurePlannerQuality(registry: RegistryContract, network: PlannerNetwork, entities: readonly WorldEntity[],
  routes: PlannerRouter["routes"], area: number, width: number, height: number): NonNullable<PlannerSearchStatistics["quality"]> {
  const occupied = new Set<string>();
  const rectangles = entities.map(entity => ({ entity, rect: resolveEntityGridRect({ entity,
    definition: registry.queries.findEntityDefinition(entity.definitionId)! }) }));
  for (const { rect } of rectangles) for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) occupied.add(`${x},${y}`);
  }
  const buildings = rectangles.filter(({ entity }) => !registry.queries.isGeneralLogisticsDevice(entity.definitionId));
  let adjacencyPairs = 0;
  for (let i = 0; i < buildings.length; i++) for (let j = 0; j < i; j++) {
    const a = buildings[i]!.rect, b = buildings[j]!.rect;
    if (((a.x + a.width === b.x || b.x + b.width === a.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y))
      || ((a.y + a.height === b.y || b.y + b.height === a.y) && Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x))) adjacencyPairs++;
  }
  const sources = new Map<string, Array<{ capacity: number; demand: number }>>();
  for (const node of network.nodes.filter(node => node.purpose === "supply")) for (const flow of node.outputs) {
    const ports = getPlannerPorts(registry, node.entity, node.definition, "output", flow.itemId);
    if (!ports.some(port => port.kind === "pipe")) continue;
    const values = sources.get(flow.itemId) ?? [];
    values.push({ capacity: ports.reduce((sum, port) => sum + transportCapacity(port.kind), 0), demand: flow.perMinute });
    sources.set(flow.itemId, values);
  }
  let excessFluidSources = 0;
  for (const values of sources.values()) {
    let required = values.reduce((sum, entry) => sum + entry.demand, 0), minimum = 0;
    for (const value of [...values].sort((a, b) => b.capacity - a.capacity)) {
      if (required <= 1e-6) break;
      required -= value.capacity; minimum++;
    }
    excessFluidSources += values.length - minimum;
  }
  const passThrough = new Set(network.nodes.filter(node => node.purpose === "logistics"
    && routes.filter(route => route.source === node.entity.id).length === 1
    && routes.filter(route => route.target === node.entity.id).length === 1).map(node => node.entity.id));
  const visited = new Set<number>();
  let lengthPenalty = 0, turnPenalty = 0;
  const scoreChain = (start: number) => {
    let index = start, length = 0, turns = 0;
    while (!visited.has(index)) {
      visited.add(index);
      const route = routes[index]!;
      length += route.cells.length; turns += route.turns;
      if (!passThrough.has(route.target)) break;
      length++;
      const next = routes.findIndex(other => other.source === route.target);
      if (next < 0) break;
      turns += Number(opposite(route.targetEdge) !== routes[next]!.sourceEdge);
      index = next;
    }
    lengthPenalty += Math.pow(2, Math.max(0, Math.ceil(length / 5) - 1)) - 1;
    turnPenalty += Math.max(0, turns - 2);
  };
  routes.forEach((route, index) => { if (!passThrough.has(route.source) && !visited.has(index)) scoreChain(index); });
  routes.forEach((_, index) => { if (!visited.has(index)) scoreChain(index); });
  const extraGas = Math.max(0, network.nodes.filter(node => node.purpose === "environment").length - network.preferredGasCount);
  const aspect = Math.max(width / height, height / width);
  const secondary = lengthPenalty + turnPenalty * 0.1 + excessFluidSources * 20 + extraGas * 20
    + (aspect - 1) ** 2 - adjacencyPairs * 0.2;
  if (!Number.isFinite(secondary)) throw new PlannerCandidateError("物流长度评分超出数值范围，候选过于分散。");
  return { secondary, occupiedCells: occupied.size, utilization: occupied.size / area,
    excessFluidSources, lengthPenalty, turnPenalty, adjacencyPairs };
}

/** 所有辅助项合计严格位于 (0,1)，面积差一格也不能被辅助分翻转。 */
export function boundedPlannerScore(area: number, secondary: number): number {
  return area + Math.min(0.999999, Math.max(0.000001, 0.5 + Math.atan(secondary / 100) / Math.PI));
}
