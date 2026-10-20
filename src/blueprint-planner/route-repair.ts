import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { GridRotation } from "@/domain/shared/grid";
import { CompactLayoutSearch } from "./compact-layout";
import { PlannerCandidateError, type PlannerNetwork, type PlannerWire } from "./model";
import { PlannerRandom } from "./search-random";
import { PlannerRouter } from "./router";
import type { PlannerSearchProfile } from "./search-profile";
import type { PlannerSearchStatistics } from "./search-types";
import { yieldPlannerTask } from "./yield-task";
// AI-REMOVED 2026-10-20:
// Reason: 端口对齐重定位在本地六轮均未改善连通率，撤回独立实验，避免无收益叠加。
// Trigger: v24 的 24/25 布局在六轮各 8000 次 v25 修复后仍为 24/25。
// Evidence: .temp/playwright-test/eda-fixed-area-20261020/local-repair-v25/
// Replacement: 保留下方原有移动；后续改为修复跨长宽比的指导池淘汰。
// Risk: 仅为该布局的局部诊断，不能证明这种提案普遍无效。Human Review: Required
// Original code:
// import { getPlannerPorts, opposite, ROTATIONS } from "./geometry";

/** 首解的未完成网表按真实连通率修复；几何、路径和最终产量仍使用共同裁判。 */
// AI-CORRECTION 2026-10-20：缩面积阶段的未完成网表也使用同一修复流程，完整成果继续交由布局搜索压缩。
export async function repairPlannerRoutes(registry: RegistryContract, network: PlannerNetwork, wires: PlannerWire[],
  initialRoutes: PlannerRouter["routes"], statistics: PlannerSearchStatistics, profile: PlannerSearchProfile,
  limit: number, checkBudget: () => void): Promise<PlannerRouter["routes"]> {
  if (!initialRoutes.length || initialRoutes.length >= wires.length || network.request.blueprintSource || network.slotLinks.some(link => network.nodes.some(node => node.entity.id === link.source.entityId)
    && network.nodes.some(node => node.entity.id === link.target.entityId))) return initialRoutes;
  // AI-REMOVED 2026-10-20:
  // Reason: 持续修复实验未达首解要求，收敛回已取得首解的局部修复组织。
  // Trigger: Windows sustained-repair-v20 固定 2S、20M 无首解。
  // Evidence: 最好连通 24/25；footprint-exchange-v19 在 13,197,760 次取得 342 格有效首解。
  // Replacement: 本函数下方逐提案几何检查，以及 candidate.ts 的有界修复份额。
  // Risk: 不能将预算和入口限制的组合实验解释为其中单一变量的独立结论。
  // Human Review: Required
  // Original code:
  // // 2026-10-20：只对当前盒子内已合法的摆位做连通修复；缩边造成的几何违例交回布局搜索。
  // const initialStatistics: PlannerSearchStatistics = { seed: statistics.seed, evaluationLimit: 1, evaluations: 0, acceptedMoves: 0,
  //   routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: statistics.outline, strategy: "compact" };
  // if (!await new CompactLayoutSearch(registry, network, wires, initialStatistics, profile).advance(0, checkBudget)) return initialRoutes;
  const random = new PlannerRandom((statistics.seed ^ 0x738ac521) >>> 0 || 1);
  const nodes = new Map(network.nodes.map(node => [node.entity.id, node]));
  const key = (wire: PlannerWire) => `${wire.source.entityId}/${wire.source.groupIndex}/${wire.source.portIndex}>${wire.target.entityId}/${wire.target.groupIndex}/${wire.target.portIndex}`;
  const routeKey = (route: PlannerRouter["routes"][number]) => `${route.sourcePort}>${route.targetPort}`;
  const snapshot = () => ({ entities: network.nodes.map(node => structuredClone(node.entity)), wires: wires.slice() });
  const restore = (value: ReturnType<typeof snapshot>) => {
    network.nodes.forEach((node, index) => Object.assign(node.entity, structuredClone(value.entities[index]!)));
    wires.splice(0, wires.length, ...value.wires);
  };
  const score = (routes: PlannerRouter["routes"]) => {
    const connected = new Set(routes.map(routeKey));
    return (wires.length - routes.length) * 100 + wires.reduce((sum, wire) => sum
      + (Math.abs(wire.source.outside.x - wire.target.outside.x) + Math.abs(wire.source.outside.y - wire.target.outside.y))
        * (connected.has(key(wire)) ? 0.05 : 1), 0);
  };
  // 绑定启动根及库存的连接不能作为等价物料配对；普通生产及同流量分流边才允许换目标。
  const reassignable = (wire: PlannerWire) => {
    const source = nodes.get(wire.source.entityId)!, target = nodes.get(wire.target.entityId)!;
    return !wire.minimumCells && source.purpose !== "startup" && target.purpose !== "startup"
      && !source.supplyTarget && !source.outputSource && !target.supplyTarget && !target.outputSource
      && !target.inputs.some(input => input.sourceEntityIds?.length);
  };
  let routes = initialRoutes, bestRoutes = routes, currentCost = score(routes), bestCost = currentCost;
  let blockers = new Map<string, readonly string[]>();
  let best = snapshot();
  const stop = Math.min(statistics.evaluationLimit, statistics.evaluations + limit);
  let step = 0;
  try {
    while (statistics.evaluations < stop && bestRoutes.length < wires.length) {
      checkBudget();
      if (step > 0 && step % 500 === 0 && currentCost > bestCost + 10) {
        restore(best); routes = bestRoutes; blockers.clear(); currentCost = score(routes);
      }
      const previous = snapshot(), completed = new Set(routes.map(routeKey));
      const unfinished = wires.filter(wire => !completed.has(key(wire)));
      if (!unfinished.length) break;
      const focus = unfinished[random.integer(unfinished.length)]!;
      const focusIndex = wires.indexOf(focus);
      const anchor = nodes.get(random.integer(2) ? focus.source.entityId : focus.target.entityId)!;
      const nearby = network.nodes.filter(node => Math.abs(node.entity.position.x - anchor.entity.position.x)
        + Math.abs(node.entity.position.y - anchor.entity.position.y) < 10);
      const selected = random.integer(2) ? anchor : nearby[random.integer(nearby.length)]!;
      const blockingRoutes = blockers.get(key(focus)) ?? [];
      const guided = blockingRoutes.length > 0 && random.integer(2) === 0;
      const mode = guided ? 0 : random.integer(100);
      if (mode < 10) {
        // 保留摆位，只重排少量路径；已连通线路也可主动让出拥塞通道。
      } else if (mode < 20) {
        const ids = new Set([selected.entity.id, ...wires.filter(wire => wire.source.entityId === selected.entity.id || wire.target.entityId === selected.entity.id)
          .map(wire => wire.source.entityId === selected.entity.id ? wire.target.entityId : wire.source.entityId).filter(() => random.integer(2) === 0)]);
        const axis = random.integer(2) ? "x" : "y", delta = random.integer(2) ? 1 : -1;
        for (const node of network.nodes) if (ids.has(node.entity.id)) node.entity.position = { ...node.entity.position, [axis]: node.entity.position[axis] + delta };
      } else if (mode < 45 && reassignable(focus)) {
        const items = focus.itemIds.slice().sort().join("/");
        const alternatives = wires.filter(wire => wire !== focus && reassignable(wire) && wire.perMinute === focus.perMinute
          && wire.source.kind === focus.source.kind && wire.itemIds.slice().sort().join("/") === items
          && wire.source.entityId !== focus.target.entityId && focus.source.entityId !== wire.target.entityId);
        if (alternatives.length) {
          const other = alternatives[random.integer(alternatives.length)]!;
          wires[wires.indexOf(focus)] = { ...focus, target: other.target };
          wires[wires.indexOf(other)] = { ...other, target: focus.target };
        }
      } else if (mode < 55) selected.entity.rotation = ((selected.entity.rotation + 90) % 360) as GridRotation;
      // AI-REMOVED 2026-10-20:
      // Reason: 端口对齐重定位实验未观察到改善，恢复原提案比例。
      // Trigger: v25 六轮局部诊断仍为 24/25；Evidence: local-repair-v25/。
      // Replacement: 下方既有移动与交换；Risk: 未作 Windows 冷启动对照。Human Review: Required
      // Original code:
      // else if (mode < 60) {
      //   // 2026-10-20：按失败连接重定位一端，越过逐格移动无法穿越的设备；共同几何检查仍拒绝重叠、越界和断口。
      //   const source = random.integer(2) === 0, own = source ? focus.source : focus.target, other = source ? focus.target : focus.source;
      //   const node = nodes.get(own.entityId)!;
      //   const { rotation, port } = ROTATIONS.map(rotation => ({ rotation,
      //     port: getPlannerPorts(registry, { ...node.entity, position: { x: 0, y: 0 }, rotation }, node.definition, own.direction)
      //       .find(port => port.groupIndex === own.groupIndex && port.portIndex === own.portIndex)! }))
      //     .find(({ port }) => port.edge === opposite(other.edge))!;
      //   const gap = 1 + random.integer(3), dx = other.outside.x - other.cell.x, dy = other.outside.y - other.cell.y;
      //   node.entity.position = { x: other.outside.x + dx * gap - port.cell.x, y: other.outside.y + dy * gap - port.cell.y };
      //   node.entity.rotation = rotation;
      // }
      else if (mode < 90) {
        const axis = random.integer(2) ? "x" : "y";
        selected.entity.position = { ...selected.entity.position, [axis]: selected.entity.position[axis]
          + (random.integer(2) ? 1 : -1) * (random.integer(5) ? 1 : 3) };
      } else {
        // 2026-10-20：等占地设备可直接交换姿态，越过逐格移动无法穿越的密集局部；端口与边界仍由共同布局检查。
        const peers = network.nodes.filter(node => node.definition.footprint.width === selected.definition.footprint.width
          && node.definition.footprint.height === selected.definition.footprint.height);
        const other = peers[random.integer(peers.length)]!, position = { ...selected.entity.position }, rotation = selected.entity.rotation;
        selected.entity.position = { ...other.entity.position }; selected.entity.rotation = other.entity.rotation;
        other.entity.position = position; other.entity.rotation = rotation;
      }
      statistics.evaluations++; step++;
      statistics.routeRepairEvaluations = (statistics.routeRepairEvaluations ?? 0) + 1;
      const local: PlannerSearchStatistics = { seed: statistics.seed, evaluationLimit: 1, evaluations: 0, acceptedMoves: 0,
        routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: statistics.outline, strategy: "compact" };
      const layout = new CompactLayoutSearch(registry, network, wires, local, profile);
      let accepted = false;
      if (await layout.advance(0, checkBudget)) {
        layout.applyBest();
        const router = new PlannerRouter(registry, network.nodes.map(node => node.entity), wires.flatMap(wire => [wire.source, wire.target]),
          { minimumX: 0, minimumY: 0, maximumX: statistics.outline.width - 1, maximumY: statistics.outline.height - 1, escapeLength: 0 });
        statistics.routingAttempts++;
        const reused = new Set<number>(), byKey = new Map(wires.map((wire, index) => [key(wire), index]));
        // 2026-10-20：按失败搜索实际接触的阻塞线路定向让路；每次只释放少量路径，保留其他合法缓存。
        const released = new Set(guided ? blockingRoutes.slice(0, 1 + random.integer(Math.min(3, blockingRoutes.length))) : []);
        const rip = !guided && random.integer(5) < 2;
        // 先恢复全部仍合法的缓存，避免新失败边抢占已有路径后把部分指导退化成随机重布。
        for (const route of routes) {
          if (released.has(routeKey(route)) || rip && random.integer(100) < 8) continue;
          const index = byKey.get(routeKey(route));
          if (index === undefined) continue;
          const wire = wires[index]!;
          if (router.reuse(wire.source, wire.target, route.cells, wire.minimumCells)) reused.add(index);
        }
        const order = wires.flatMap((_, index) => reused.has(index) ? [] : [index]);
        // applyBest 会重建端口对象，必须按连接索引保持失败边优先级。
        order.sort((a, b) => Number(b === focusIndex) - Number(a === focusIndex));
        const nextBlockers = new Map<string, readonly string[]>();
        for (const index of order) {
          const wire = wires[index]!;
          try { await router.connect(wire.source, wire.target, checkBudget, wire.minimumCells); }
          catch (error) {
            if (!(error instanceof PlannerCandidateError)) throw error;
            nextBlockers.set(key(wire), [...router.conflicts].sort((a, b) => b[1].size - a[1].size).map(([id]) => id));
          }
        }
        const cost = score(router.routes);
        // 2026-10-16：升温到 80 的对照未改善连通率，保留以已有线路为主的低温修复。
        // AI-CORRECTION 2026-10-20：不持续高温；连通数停滞后交替恢复探索与低温精修，最终仍返回历史最佳完整快照。
        // AI-CORRECTION 2026-10-20：交替升温本地六轮仍停在 21/25，未进入 Windows 对照；撤回实验，优先处理已确认的供电桩位阻塞。
        // AI-REMOVED 2026-10-20:
        // Reason: 未观察到局部改善，避免与已定位的供电调整叠加。
        // Trigger: local-chain-v23 六轮各 8000 次仍为 21/25。
        // Evidence: 本地探索不足以断言通用无效，只能作为本轮优先级判断。
        // Replacement: 下方固定低温及 candidate.ts 的供电桩位替代搜索。
        // Risk: 可能遗漏其他案例的收益；Human Review: Required。
        // Original code:
        // let step = 0, lastImprovement = 0;
        // const temperature = Math.floor((step - lastImprovement) / 500) % 2 === 0 ? 8 : 80;
        // lastImprovement = step;
        const temperature = 8;
        accepted = cost <= currentCost || random.next() / 4294967296 < Math.exp((currentCost - cost) / temperature);
        if (accepted) {
          routes = router.routes; blockers = nextBlockers; currentCost = cost; statistics.acceptedMoves++;
          if (routes.length > bestRoutes.length || routes.length === bestRoutes.length && cost < bestCost) {
            if (routes.length > bestRoutes.length) {
              statistics.routeRepairImprovements = (statistics.routeRepairImprovements ?? 0) + 1;
            }
            best = snapshot(); bestRoutes = routes; bestCost = cost;
            statistics.bestRoutedWireCount = Math.max(statistics.bestRoutedWireCount ?? 0, routes.length);
          }
        }
      }
      if (!accepted) restore(previous);
      if (step % 16 === 0) await yieldPlannerTask();
    }
  } finally { restore(best); }
  // 多目标分组属于初排提示；配对改变后按实际物流树重建，不能把旧分组写进续搜种子。
  for (const [index, node] of network.nodes.entries()) {
    if (!node.supplyTargets && !node.outputSources) continue;
    const forward = Boolean(node.supplyTargets), found = new Set<string>(), visited = new Set([node.entity.id]), pending = [node.entity.id];
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const id = pending[cursor]!;
      for (const wire of wires) {
        if ((forward ? wire.source.entityId : wire.target.entityId) !== id) continue;
        const next = forward ? wire.target.entityId : wire.source.entityId;
        if (visited.has(next)) continue;
        visited.add(next);
        if (nodes.get(next)!.purpose === "logistics") pending.push(next); else found.add(next);
      }
    }
    const targets = [...found].map(entityId => ({ entityId }));
    network.nodes[index] = { ...node, ...(forward ? { supplyTargets: targets } : { outputSources: targets }) };
  }
  return bestRoutes;
}
