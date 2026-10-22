import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { capturePlannerSeed, comparePlannerPartialSeeds, restorePlannerSeed, type PlannerSearchSeed } from "./search-seed";
import { PlannerRandom } from "./search-random";
import { PlannerRouter } from "./router";
import { PlannerCandidateError } from "./model";
import { CompactLayoutSearch } from "./compact-layout";
import type { PlannerSearchProfile } from "./search-profile";
import type { PlannerSearchStatistics } from "./search-types";
import { yieldPlannerTask } from "./yield-task";
import { repairPlannerRoutes } from "./route-repair";
import { plannerRouteRepairWindow } from "./search-policy";

/** 诊断原型：沿无主体的逐行切线收缩一格，所有返回状态仍经过完整几何和真实路由。 */
// 2026-10-21 订正：Windows probe306 自动入口获得完整 Dense 成果，现供普通完整成果缩边使用；冷启动验收仍待完成。
// AI-CORRECTION 2026-10-21：probe331 的第二入口可修复，单一最佳入口会丢失机会；现保留最多四份并共用原额度修复。
export async function compactAlongPlannerSeam(registry: RegistryContract, request: BlueprintPlannerRequest,
  seed: PlannerSearchSeed, outline: { width: number; height: number }, profile: PlannerSearchProfile,
  statistics: PlannerSearchStatistics, limit: number, checkBudget: () => void): Promise<PlannerSearchSeed | undefined> {
  const axis = outline.width === seed.width - 1 && outline.height === seed.height ? "x"
    : outline.height === seed.height - 1 && outline.width === seed.width ? "y" : undefined;
  if (!axis || request.blueprintSource) return undefined;
  const cross = axis === "x" ? "y" : "x";
  const width = axis === "x" ? seed.width : seed.height, height = axis === "x" ? seed.height : seed.width;
  const restored = restorePlannerSeed(registry, request, seed), random = new PlannerRandom(statistics.seed);
  const rects = restored.network.nodes.map(node => {
    const rect = resolveEntityGridRect({ entity: node.entity, definition: node.definition });
    return { x: rect[axis], y: rect[cross], width: axis === "x" ? rect.width : rect.height, height: axis === "x" ? rect.height : rect.width };
  });
  // 初态必须在原框内，含框外固定实体或迁移中的状态继续交给既有几何流程。
  if (rects.some(rect => rect.x < 0 || rect.y < 0 || rect.x + rect.width > width || rect.y + rect.height > height)) return undefined;
  const free = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) =>
    !rects.some(rect => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height)));
  const transitions = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) =>
    y === 0 || !free[y]![x] ? [] : Array.from({ length: width }, (_, previous) => previous).filter(previous =>
      free[y - 1]![previous] && !rects.some(rect => rect.y < y && rect.y + rect.height > y
        && ((previous < rect.x) !== (x < rect.x))))));
  const stop = Math.min(statistics.evaluationLimit, statistics.evaluations + limit), seen = new Set<string>();
  const candidates: PlannerSearchSeed[] = [];
  let best: PlannerSearchSeed | undefined, attempt = 0;
  while (statistics.evaluations < stop) {
    checkBudget();
    if (attempt > 0 && attempt % 16 === 0) await yieldPlannerTask();
    statistics.evaluations++;
    const costs = Array.from({ length: height }, () => Array.from({ length: width }, () => random.next() / 4294967296));
    const distance = Array.from({ length: height }, () => new Array<number>(width).fill(Infinity));
    const previous = Array.from({ length: height }, () => new Array<number>(width).fill(-1));
    const bendWeight = attempt % 3 === 0 ? 0.1 : attempt % 3 === 1 ? 0.01 : 0;
    attempt++;
    for (let x = 0; x < width; x++) if (free[0]![x]) distance[0]![x] = costs[0]![x]!;
    for (let y = 1; y < height; y++) for (let x = 0; x < width; x++) if (free[y]![x]) {
      for (const prior of transitions[y]![x]!) {
        const cost = distance[y - 1]![prior]! + costs[y]![x]! + Math.abs(x - prior) * bendWeight;
        if (cost < distance[y]![x]!) { distance[y]![x] = cost; previous[y]![x] = prior; }
      }
    }
    let end = distance[height - 1]!.reduce((chosen, value, x) => value < distance[height - 1]![chosen]! ? x : chosen, 0);
    if (!Number.isFinite(distance[height - 1]![end])) break;
    const seam = new Array<number>(height);
    for (let y = height - 1; y >= 0; y--) { seam[y] = end; end = previous[y]![end]!; }
    const moved = rects.flatMap((rect, index) => rect.x > seam[rect.y]! ? [index] : []), signature = moved.join(",");
    if (seen.has(signature)) continue;
    seen.add(signature);
    const { network, wires } = restorePlannerSeed(registry, request, seed);
    for (const index of moved) {
      const entity = network.nodes[index]!.entity;
      entity.position = { ...entity.position, [axis]: entity.position[axis] - 1 };
    }
    const local: PlannerSearchStatistics = { seed: statistics.seed, evaluationLimit: 1, evaluations: 0, acceptedMoves: 0,
      routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline, strategy: "compact" };
    const layout = new CompactLayoutSearch(registry, network, wires, local, profile);
    if (!await layout.advance(0, checkBudget)) continue;
    layout.applyBest();
    statistics.routingAttempts++;
    const router = new PlannerRouter(registry, network.nodes.map(node => node.entity), wires.flatMap(wire => [wire.source, wire.target]),
      { minimumX: 0, minimumY: 0, maximumX: outline.width - 1, maximumY: outline.height - 1, escapeLength: 0 });
    const keys = new Map(wires.map((wire, index) =>
      [`${wire.source.entityId}/${wire.source.groupIndex}/${wire.source.portIndex}>${wire.target.entityId}/${wire.target.groupIndex}/${wire.target.portIndex}`, index]));
    const reused = new Set<number>();
    for (const route of seed.routes) {
      const index = keys.get(`${route.sourcePort}>${route.targetPort}`);
      if (index === undefined) continue;
      const wire = wires[index]!;
      const cells = route.cells.filter(point => point[axis] !== seam[point[cross]])
        .map(point => ({ ...point, [axis]: point[axis] > seam[point[cross]]! ? point[axis] - 1 : point[axis] }));
      if (cells.length && router.reuse(wire.source, wire.target, cells, wire.minimumCells)) reused.add(index);
    }
    for (const [index, wire] of wires.entries()) if (!reused.has(index)) {
      try { await router.connect(wire.source, wire.target, checkBudget, wire.minimumCells); }
      catch (error) { if (!(error instanceof PlannerCandidateError)) throw error; }
    }
    const candidate = { ...capturePlannerSeed(request, network, wires, router.routes, outline.width, outline.height), ...router.staticConstraints(wires) };
    candidates.push(candidate);
    candidates.sort(comparePlannerPartialSeeds);
    if (candidates.length > 4) candidates.length = 4;
    if (!best || comparePlannerPartialSeeds(candidate, best) < 0) best = candidate;
    if (router.routes.length === wires.length) break;
  }
  // 2026-10-21：生成后的不同摆位分别领取剩余量的均分份额；进展可续窗，但不得用尽其他入口的份额。
  for (const [index, candidate] of candidates.entries()) {
    if (best && best.routes.length === best.wires.length) break;
    const allowance = Math.floor((statistics.evaluationLimit - statistics.evaluations) / (candidates.length - index));
    if (allowance < 1) break;
    const { network, wires } = restorePlannerSeed(registry, request, candidate);
    const routes = await repairPlannerRoutes(registry, network, wires, candidate.routes, statistics, profile,
      plannerRouteRepairWindow(allowance), checkBudget, statistics.evaluations + allowance);
    if (!routes) continue;
    const repaired = { ...capturePlannerSeed(request, network, wires, routes, outline.width, outline.height),
      disconnectedWires: statistics.routeRepairDisconnectedWires ?? 0,
      capacityDeficit: statistics.routeRepairCapacityDeficit ?? 0 };
    if (!best || comparePlannerPartialSeeds(repaired, best) < 0) best = repaired;
  }
  if (best) {
    statistics.routeRepairDisconnectedWires = best.disconnectedWires ?? 0;
    statistics.routeRepairCapacityDeficit = best.capacityDeficit ?? 0;
  }
  return best;
}
