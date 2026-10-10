import type { BlueprintPlannerRequest, BlueprintPlannerPhase } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import type { PlannerCandidate } from "./candidate";
import { PlannerCandidateError, type PlannerNetwork, type PlannerNode, type PlannerWire } from "./model";
import { restorePlannerSeed, capturePlannerSeed } from "./search-seed";
import type { PlannerSearchOptions, PlannerSearchStatistics } from "./search-types";
import { getPlannerPorts, plannerPortAcceptsItem, transportCapacity } from "./geometry";
import { CompactLayoutSearch } from "./compact-layout";
import { resolveSearchProfile } from "./search-profile";
import { PlannerRouter } from "./router";
import type { PlannerLayoutBackend } from "./layout-backend";
import type { PlannerRoutingBackend } from "./routing-backend";
import { blueprintRecognitionScene } from "./blueprint-scene";
import { measurePlannerQuality, boundedPlannerScore } from "./quality";
import { assertPlannerOutline } from "./search-outline";
import { assertPlannerCandidateBounds } from "./verification";
import { collectPoweredEntityIds } from "@/shared/geometry/power-range";
import { auditConverterSupply, routeConverterAlternatives, converterRebuildScope, isConverterRouteControl } from "./converter-routing";
import { configureConverterStartupInventory, scheduleConverterStartups, converterStartupTimes } from "./support";
import { createPlannerDiagnostics } from "./search-diagnostics";
import type { PlannerSearchSessions } from "./search-sessions";
import type { PlannerSupplyAudit } from "./supply-audit";

/** 按原图个体选择删减，不按设备类型预排序；小集合完整轮换，大集合先覆盖所有单减。 */
// AI-CORRECTION 2026-10-06：全部规模按删减个数枚举组合，先覆盖所有单减，再覆盖二减及更大组合；不截断混合接入类型。
export function blueprintReductionIds(nodes: readonly PlannerNode[], variant: number): ReadonlySet<string> {
  const choices = nodes.filter(node => ["environment", "supply", "product"].includes(node.purpose))
    .map(node => node.entity.id).sort();
  if (!choices.length || variant === 0) return new Set();
  const combinations = (n: number, k: number) => {
    let result = 1n;
    for (let at = 1; at <= Math.min(k, n - k); at++) result = result * BigInt(n - at + 1) / BigInt(at);
    return result;
  };
  let rank = BigInt(variant) % (1n << BigInt(choices.length)), count = 0;
  while (rank >= combinations(choices.length, count)) { rank -= combinations(choices.length, count); count++; }
  const removed = new Set<string>();
  for (let index = 0; count > 0 && index < choices.length; index++) {
    const branch = combinations(choices.length - index - 1, count - 1);
    if (rank < branch) { removed.add(choices[index]!); count--; } else rank -= branch;
  }
  return removed;
}

export function reduceBlueprintNetwork(registry: RegistryContract, network: PlannerNetwork, wires: PlannerWire[], removed: ReadonlySet<string>, variant: number) {
  const existing = new Map(network.nodes.map(node => [node.entity.id, node]));
  const remaining = network.nodes.filter(node => !removed.has(node.entity.id));
  if (remaining.some(node => node.recipe?.requiredGasDiffusion && !remaining.some(other =>
    other.recipe?.gasDiffusionOutput?.gasItemId === node.recipe!.requiredGasDiffusion))) {
    throw new PlannerCandidateError("减量后缺少必要的气体扩散环境。");
  }
  const retainedWires = wires.filter(wire => !(removed.has(wire.target.entityId) && existing.get(wire.target.entityId)!.purpose === "environment"));
  // 裁撤环境设施后反向追踪仍有需求的支路，保留控制设备本体，但不强迫外供继续喂无消费者的支路。
  const needed = new Set(network.nodes.filter(node => node.purpose === "product"
    || !removed.has(node.entity.id) && ["production", "environment", "auxiliary"].includes(node.purpose)).map(node => node.entity.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const wire of retainedWires) if (needed.has(wire.target.entityId) && !needed.has(wire.source.entityId)) {
      needed.add(wire.source.entityId); changed = true;
    }
  }
  const activeWires = retainedWires.filter(wire => needed.has(wire.target.entityId));
  const used = new Set(activeWires.filter(wire => !removed.has(wire.source.entityId) && !removed.has(wire.target.entityId))
    .flatMap(wire => [key(wire.source), key(wire.target)]));
  // AI-REMOVED 2026-10-10:
  // Reason: 顺序贪心占端口会误拒存在完整匹配的组合。
  // Trigger: 减量长期准备失败；Evidence: 兼容端口集合有交叠时早期任取会耗尽专用端口。
  // Replacement: 下方增广路径匹配；Risk: 图规模内有界，未改变设备/端口容量；Human Review: Required。
  //   const reconnect = (wire: PlannerWire, source: boolean) => {
  //     const old = existing.get(source ? wire.source.entityId : wire.target.entityId)!;
  //     const peers = remaining.filter(node => node.purpose === old.purpose
  //       && (source ? node.outputs : node.inputs).some(flow => wire.itemIds.includes(flow.itemId)));
  //     const ports = peers.flatMap(node => getPlannerPorts(registry, node.entity, node.definition, source ? "output" : "input", wire.itemIds[0]));
  //     const available = ports.filter(port => !used.has(key(port)) && wire.perMinute <= transportCapacity(port.kind) + 1e-6);
  //     if (!available.length) throw new PlannerCandidateError("本次入口／出口减量没有可用的剩余端口。");
  //     const port = available[variant % available.length]!; used.add(key(port));
  //     return { ...wire, [source ? "source" : "target"]: port };
  //   };
  //   const next: PlannerWire[] = [];
  //   for (let wire of activeWires) {
  //     if (removed.has(wire.target.entityId) && existing.get(wire.target.entityId)!.purpose === "environment") continue;
  //     if (removed.has(wire.source.entityId) && removed.has(wire.target.entityId)) continue;
  //     if (removed.has(wire.source.entityId)) wire = reconnect(wire, true);
  //     if (removed.has(wire.target.entityId)) wire = reconnect(wire, false);
  //     next.push(wire);
  //   }
  // 对全部待重接端口求二分图匹配；局部贪心失败不能证明该减量组合不可行。
  const next = activeWires.filter(wire => !(removed.has(wire.source.entityId) && removed.has(wire.target.entityId))).map(wire => ({ ...wire }));
  const demands = next.flatMap((wire, index) => ([true, false] as const).flatMap(source => {
    const old = existing.get(source ? wire.source.entityId : wire.target.entityId)!;
    if (!removed.has(old.entity.id)) return [];
    const ports = remaining.filter(node => node.purpose === old.purpose)
      .flatMap(node => getPlannerPorts(registry, node.entity, node.definition, source ? "output" : "input")
        .filter(port => !used.has(key(port)) && port.kind === (source ? wire.source.kind : wire.target.kind)
          && wire.perMinute <= transportCapacity(port.kind) + 1e-6 && wire.itemIds.every(item =>
            (source ? node.outputs : node.inputs).some(flow => flow.itemId === item)
            && getPlannerPorts(registry, node.entity, node.definition, source ? "output" : "input", item)
              .some(allowed => key(allowed) === key(port))
            && plannerPortAcceptsItem(registry, node.entity, node.definition, port, item))));
    const offset = ports.length ? variant % ports.length : 0;
    return [{ index, source, ports: [...ports.slice(offset), ...ports.slice(0, offset)] }];
  }));
  const owners = new Map<string, number>(), assignments = new Map<number, PlannerWire["source"]>();
  const assign = (index: number, visited: Set<string>): boolean => {
    for (const port of demands[index]!.ports) {
      const id = key(port);
      if (visited.has(id)) continue;
      visited.add(id);
      const previous = owners.get(id);
      if (previous !== undefined && !assign(previous, visited)) continue;
      owners.set(id, index); assignments.set(index, port); return true;
    }
    return false;
  };
  for (const [index] of demands.entries()) if (!assign(index, new Set())) {
    throw new PlannerCandidateError("本次入口／出口减量没有可用的剩余端口。");
  }
  for (const [index, demand] of demands.entries()) next[demand.index]![demand.source ? "source" : "target"] = assignments.get(index)!;
  network.nodes.splice(0, network.nodes.length, ...remaining);
  // 数量变化后重新汇总端口需求；辅助需求由真实剩余连接决定，不递减主体设备。
  for (const node of remaining) {
    node.inputs.splice(0, node.inputs.length, ...next.filter(wire => wire.target.entityId === node.entity.id)
      .flatMap(wire => wire.itemIds.map(itemId => ({ itemId, perMinute: wire.perMinute, storageGroupIds: node.definition.portStorageBindings
        .filter(binding => binding.portGroupId === node.definition.portGroups[wire.target.groupIndex]!.id).map(binding => binding.storageSlotGroupId) }))));
    node.outputs.splice(0, node.outputs.length, ...next.filter(wire => wire.source.entityId === node.entity.id)
      .flatMap(wire => wire.itemIds.map(itemId => ({ itemId, perMinute: wire.perMinute, storageGroupIds: node.definition.portStorageBindings
        .filter(binding => binding.portGroupId === node.definition.portGroups[wire.source.groupIndex]!.id).map(binding => binding.storageSlotGroupId) }))));
  }
  network.slotLinks.splice(0, network.slotLinks.length, ...network.slotLinks.filter(link => !removed.has(link.source.entityId) && !removed.has(link.target.entityId)));
  return next;
}

const key = (port: PlannerWire["source"]) => `${port.entityId}/${port.groupIndex}/${port.portIndex}`;

/** 复用正式紧凑布局和 Router；导入模式只替换输入准备、可变约束与交付装配。 */
export async function createBlueprintCandidate(registry: RegistryContract, request: BlueprintPlannerRequest, variant: number,
  checkBudget: () => void, update: (phase: BlueprintPlannerPhase, message: string) => void, options: PlannerSearchOptions,
  reportEvaluations: (count: number) => void, routing?: PlannerRoutingBackend, layoutBackend?: PlannerLayoutBackend, sessions?: PlannerSearchSessions): Promise<PlannerCandidate> {
  const original = options.originSeed ?? options.seed;
  if (!original || !request.blueprintSource) throw new Error("蓝图任务缺少已识别的原图基线。");
  // 每隔一次回到原图探索减量；续搜失败不会永久失去已删设施。
  const reduction = variant % 2 === 0;
  const source = reduction ? original : options.seed ?? original;
  const restored = restorePlannerSeed(registry, request, source);
  let network = restored.network;
  const originalWires = restored.wires;
  const outline = options.targetOutline ?? { width: source.width, height: source.height };
  assertPlannerOutline(outline);
  let statistics: PlannerSearchStatistics = { strategy: "compact", seed: variant, evaluationLimit: options.maxEvaluations ?? 5000,
    maximumArea: options.maximumArea, experiments: options.experiments ?? ["constraint-repair", "partial-rebuild"],
    outline, evaluations: 0, acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0 };
  try {
    const removed = reduction ? blueprintReductionIds(network.nodes, Math.floor(variant / 2)) : new Set<string>();
    statistics.evaluations++; reportEvaluations(statistics.evaluations);
    const fingerprint = JSON.stringify([source, outline, [...removed].sort(), options.profile, options.experiments]);
    const resumed = sessions?.get(options.sessionKey, fingerprint);
    const fresh = statistics;
    const reductionKey = [...removed].sort().join("\n"), scope = JSON.stringify(source);
    const rejected = removed.size ? sessions?.reduction(scope, reductionKey) : undefined;
    if (rejected) { statistics.preparationRejected = true; throw new PlannerCandidateError(rejected); }
    let wires: PlannerWire[];
    try { wires = resumed?.wires ?? (removed.size ? reduceBlueprintNetwork(registry, network, originalWires, removed, variant) : originalWires); }
    catch (error) {
      if (error instanceof PlannerCandidateError) { statistics.preparationRejected = true; sessions?.reduction(scope, reductionKey, error.message); }
      throw error;
    }
    if (resumed) network = resumed.network;
    if (network.nodes.some(node => node.recipe?.requiredGasDiffusion
      && !network.nodes.some(other => other.recipe?.gasDiffusionOutput?.gasItemId === node.recipe!.requiredGasDiffusion))) {
      throw new PlannerCandidateError("减量后缺少必要的气体扩散环境。");
    }
    const search = resumed?.search ?? new CompactLayoutSearch(registry, network, wires, statistics, resolveSearchProfile(options.profile), layoutBackend);
    if (resumed) { search.beginSlice(fresh); statistics = search.statistics; }
    sessions?.set(options.sessionKey, { fingerprint, network, wires, search });
    const { diagnostics, enterPhase, reject } = createPlannerDiagnostics(statistics, options.diagnostics === true);
    statistics.wireCount = wires.length;
    const assertBudget = checkBudget;
    checkBudget = () => { reportEvaluations(statistics.evaluations); assertBudget(); };
    let inspectSeed = !resumed;
    while (statistics.evaluations < statistics.evaluationLimit || search.hasPendingLayouts) {
      checkBudget(); enterPhase("layout"); update("layout", "正在优化原图设备位置与减量组合");
      const feasible = await search.advance(inspectSeed ? 0 : Math.min(250, statistics.evaluationLimit - statistics.evaluations), checkBudget);
      inspectSeed = false;
      reportEvaluations(statistics.evaluations);
      if (diagnostics) { diagnostics.layoutChecks++; if (feasible) diagnostics.feasibleLayouts++; }
      if (!feasible) continue;
      search.applyBest();
      enterPhase("power");
      const powered = collectPoweredEntityIds(network.nodes.map(node => node.entity), registry.entityDefinitions);
      if (network.nodes.some(node => node.definition.requiresPower && !powered.has(node.entity.id))) { reject("power", "原图供电覆盖不足"); continue; }
      let router = new PlannerRouter(registry, [...network.nodes.map(node => node.entity), ...search.fixtures], wires.flatMap(wire => [wire.source, wire.target]),
        { minimumX: 0, minimumY: 0, maximumX: outline.width - 1, maximumY: outline.height - 1, escapeLength: 0 }, routing);
      statistics.routingAttempts++;
      update("routing", "正在重建原图物流路径");
      const layoutNetwork = network;
      let blockedWire: PlannerWire | undefined;
      let rejectionPhase: "routing" | "supply" = "routing";
      enterPhase("routing");
      try {
        let supplyAudit: PlannerSupplyAudit = { operatingLimits: [], splitterCount: 0, bufferedAdmissions: 0 };
        const adaptive = await routeConverterAlternatives(registry, network, wires, statistics, variant, search.fixtures, checkBudget,
          async (alternative, connections, routed) => {
            const scope = converterRebuildScope(registry, alternative, connections);
            if (routed.entities.some(entity => !registry.queries.isBelt(entity.definitionId) && !registry.queries.isPipe(entity.definitionId)
              && !isConverterRouteControl(registry, entity, scope, routed.routes))) return false;
            supplyAudit = auditConverterSupply(registry, alternative, connections, routed.routes);
            return true;
          }, routing, source.routes);
        if (adaptive) { sessions?.delete(options.sessionKey); network = adaptive.network; wires = adaptive.wires; router = adaptive.router; }
        for (const wire of adaptive ? [] : wires) {
          blockedWire = wire;
          const cached = source.routes.find(route => route.sourcePort === key(wire.source) && route.targetPort === key(wire.target));
          if (cached && router.reuse(wire.source, wire.target, cached.cells, wire.minimumCells)) statistics.reusedRoutes = (statistics.reusedRoutes ?? 0) + 1;
          else await router.connect(wire.source, wire.target, checkBudget, wire.minimumCells);
        }
        statistics.bestRoutedWireCount = Math.max(statistics.bestRoutedWireCount ?? 0, router.routes.length);
        if (diagnostics) diagnostics.fullyRoutedAttempts++;
        blockedWire = undefined;
        rejectionPhase = "supply"; enterPhase("supply");
        if (!adaptive && router.entities.some(entity => !registry.queries.isBelt(entity.definitionId) && !registry.queries.isPipe(entity.definitionId))) {
          throw new PlannerCandidateError("重布线需要新增物流控制设备，本次候选不满足数量约束。");
        }
        // 供气重建未成功时仍须审计复用线路，不能漏掉启动产量与库存探针。
        if (!adaptive) supplyAudit = auditConverterSupply(registry, network, wires, router.routes);
        const reservedIds = new Set(request.blueprintSource.blueprint.entityOrder);
        const tracks = router.entities.map((entity, index) => {
          let id = `__blueprint_route_${index}`;
          while (reservedIds.has(id)) id += "_";
          reservedIds.add(id);
          return { ...entity, id };
        });
        // AI-REMOVED 2026-10-09:
        // Reason: 全网串联上界误把互不依赖的并行线路累加，偏离原图固定 360 秒预热。
        // Trigger: 冷态识别与同摆位供气时序统一。
        // Evidence: 五机手动补料被无关线路推迟到 534 秒。
        // Replacement: converterStartupTimes 按依赖与真实路由求时序。
        // Risk: 延迟过长仍由固定窗口验收拒绝；Human Review: Required。
        // Original code:
        // // 对导入线路采用全网路程上界，避免有限启动库存先于上游原料耗尽。
        // const startupDelay = wires.reduce((sum, wire) => sum + ((router.routes.find(route => route.sourcePort === key(wire.source)
        // && route.targetPort === key(wire.target))?.cells.length ?? 0) + 1) * 60 / transportCapacity(wire.source.kind), 10)
        // + network.nodes.reduce((sum, node) => sum + (node.recipe?.durationSeconds ?? 0), 0);
        // if (adaptive) configureConverterStartupInventory(network, () => startupDelay);
        // const scheduledSlots = scheduleConverterStartups(registry, network, () => startupDelay, wires);
        const arrival = converterStartupTimes(network, wires, wires.map(wire => ((router.routes.find(route => route.sourcePort === key(wire.source)
          && route.targetPort === key(wire.target))?.cells.length ?? 0) + 1) * 60 / transportCapacity(wire.source.kind)));
        if (adaptive) configureConverterStartupInventory(network, id => arrival.get(id)!);
        const scheduledSlots = scheduleConverterStartups(registry, network, id => arrival.get(id)!, wires);
        const entities = [...network.nodes.map(node => node.entity), ...tracks];
        const blueprint = createBlueprintDocument({ name: request.plan.name, description: request.blueprintSource.blueprint.description,
          baseId: request.plan.sourceBaseId, initialGridPoint: { x: 0, y: 0 }, entities: Object.fromEntries(entities.map(entity => [entity.id, entity])),
          entityOrder: entities.map(entity => entity.id), slotLinks: network.slotLinks, regions: request.blueprintSource.blueprint.regions });
        let execution = (() => {
          try { return blueprintRecognitionScene(registry, request.blueprintSource!, blueprint, 600, false, search.drainPorts); }
          catch (error) { throw new PlannerCandidateError(error instanceof Error ? error.message : String(error)); }
        })();
        if (adaptive || scheduledSlots.length) {
          execution = { ...execution, scene: { ...execution.scene, scheduledSlots },
            // AI-REMOVED 2026-10-09: 固定 360 秒预热遵循原图验收要求；Replacement: blueprintRecognitionScene；Risk: Low；Human Review: Required。
            // Original code: warmupSeconds: Math.max(execution.warmupSeconds, Math.ceil(startupDelay * 3)),
            probes: [...execution.probes, ...supplyAudit.operatingLimits.map(limit => ({ id: `operating:${limit.entityId}`,
            itemId: limit.itemId, direction: "output" as const, entityIds: [limit.entityId] })),
          ...(supplyAudit.startupProduction ?? []).map(limit => ({ id: `startup:${limit.entityId}`, itemId: limit.itemId,
            direction: "output" as const, entityIds: [limit.entityId] })),
          ...(supplyAudit.startupStorage ?? []).flatMap(storage => (["input", "output"] as const).map(direction => ({
            id: `startup-storage:${direction}:${storage.entityId}`, itemId: storage.itemId, direction, entityIds: [storage.entityId],
          })))] };
        }
        const quality = measurePlannerQuality(registry, network, entities, router.routes, outline.width * outline.height, outline.width, outline.height);
        // 输出方式中立：原有“同面积优先少箱”只属于产线生成，不影响蓝图优化。
        statistics.quality = { ...quality, outputStashCount: 0 };
        const area = outline.width * outline.height;
        const candidate: PlannerCandidate = { execution, connections: [], search: statistics,
          seed: capturePlannerSeed(request, network, wires, router.routes, outline.width, outline.height),
          supplyAudit,
          metrics: { width: outline.width, height: outline.height, area, entityCount: entities.length,
            productionDeviceCount: network.nodes.filter(node => node.purpose === "production").length,
            gasDiffuserCount: network.nodes.filter(node => node.purpose === "environment").length, additionalGasDiffuserCount: 0,
            score: boundedPlannerScore(area, quality.secondary) } };
        enterPhase("finalization");
        assertPlannerCandidateBounds(registry, candidate);
        sessions?.delete(options.sessionKey);
        return candidate;
      } catch (error) {
        if (!(error instanceof PlannerCandidateError)) throw error;
        reject(rejectionPhase, error.message);
        statistics.bestRoutedWireCount = Math.max(statistics.bestRoutedWireCount ?? 0, router.routes.length);
        if (network !== layoutNetwork) throw error;
        // AI-REMOVED 2026-10-10: 全网惩罚会稀释真实堵点并错误加重已连通边。
        // Trigger: 长期无候选；Evidence: Router 逐边失败；Replacement: blockedWire。
        // Risk: Low；Human Review: Required。
        // for (const wire of wires) search.penalize(wire.source.entityId, wire.target.entityId);
        statistics.blockedWire = blockedWire;
        if (blockedWire) search.penalize(blockedWire.source.entityId, blockedWire.target.entityId);
      }
    }
    enterPhase("finalization");
    throw new PlannerCandidateError("本轮未找到满足原图约束的更优布局。", statistics);
  } catch (error) {
    if (error instanceof PlannerCandidateError) throw new PlannerCandidateError(error.message, statistics);
    throw error;
  } finally { reportEvaluations(statistics.evaluations); }
}
