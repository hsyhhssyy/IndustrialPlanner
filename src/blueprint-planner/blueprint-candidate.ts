import type { BlueprintPlannerRequest, BlueprintPlannerPhase } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import type { PlannerCandidate } from "./candidate";
import { PlannerCandidateError, type PlannerNetwork, type PlannerNode, type PlannerWire } from "./model";
import { restorePlannerSeed, capturePlannerSeed } from "./search-seed";
import type { PlannerSearchOptions, PlannerSearchStatistics } from "./search-types";
import { getPlannerPorts, transportCapacity } from "./geometry";
import { CompactLayoutSearch } from "./compact-layout";
import { resolveSearchProfile } from "./search-profile";
import { PlannerRouter } from "./router";
import type { PlannerRoutingBackend } from "./routing-backend";
import { blueprintRecognitionScene } from "./blueprint-scene";
import { measurePlannerQuality, boundedPlannerScore } from "./quality";
import { assertPlannerOutline } from "./search-outline";
import { assertPlannerCandidateBounds } from "./verification";
import { collectPoweredEntityIds } from "@/shared/geometry/power-range";

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

function reduceBlueprintNetwork(registry: RegistryContract, network: PlannerNetwork, wires: PlannerWire[], removed: ReadonlySet<string>, variant: number) {
  const existing = new Map(network.nodes.map(node => [node.entity.id, node]));
  const remaining = network.nodes.filter(node => !removed.has(node.entity.id));
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
  const reconnect = (wire: PlannerWire, source: boolean) => {
    const old = existing.get(source ? wire.source.entityId : wire.target.entityId)!;
    const peers = remaining.filter(node => node.purpose === old.purpose
      && (source ? node.outputs : node.inputs).some(flow => wire.itemIds.includes(flow.itemId)));
    const ports = peers.flatMap(node => getPlannerPorts(registry, node.entity, node.definition, source ? "output" : "input", wire.itemIds[0]));
    const available = ports.filter(port => !used.has(key(port)) && wire.perMinute <= transportCapacity(port.kind) + 1e-6);
    if (!available.length) throw new PlannerCandidateError("本次入口／出口减量没有可用的剩余端口。");
    const port = available[variant % available.length]!; used.add(key(port));
    return { ...wire, [source ? "source" : "target"]: port };
  };
  const next: PlannerWire[] = [];
  for (let wire of activeWires) {
    if (removed.has(wire.target.entityId) && existing.get(wire.target.entityId)!.purpose === "environment") continue;
    if (removed.has(wire.source.entityId) && removed.has(wire.target.entityId)) continue;
    if (removed.has(wire.source.entityId)) wire = reconnect(wire, true);
    if (removed.has(wire.target.entityId)) wire = reconnect(wire, false);
    next.push(wire);
  }
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
  reportEvaluations: (count: number) => void, routing?: PlannerRoutingBackend): Promise<PlannerCandidate> {
  const original = options.originSeed ?? options.seed;
  if (!original || !request.blueprintSource) throw new Error("蓝图任务缺少已识别的原图基线。");
  // 每隔一次回到原图探索减量；续搜失败不会永久失去已删设施。
  const reduction = variant % 2 === 0;
  const source = reduction ? original : options.seed ?? original;
  const { network, wires: originalWires } = restorePlannerSeed(registry, request, source);
  const outline = options.targetOutline ?? { width: source.width, height: source.height };
  assertPlannerOutline(outline);
  const statistics: PlannerSearchStatistics = { strategy: "compact", seed: variant, evaluationLimit: options.maxEvaluations ?? 5000,
    outline, evaluations: 0, acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0 };
  try {
    const removed = reduction ? blueprintReductionIds(network.nodes, Math.floor(variant / 2)) : new Set<string>();
    statistics.evaluations++; reportEvaluations(statistics.evaluations);
    const wires = removed.size ? reduceBlueprintNetwork(registry, network, originalWires, removed, variant) : originalWires;
    if (network.nodes.some(node => node.recipe?.requiredGasDiffusion
      && !network.nodes.some(other => other.recipe?.gasDiffusionOutput?.gasItemId === node.recipe!.requiredGasDiffusion))) {
      throw new PlannerCandidateError("减量后缺少必要的气体扩散环境。");
    }
    const search = new CompactLayoutSearch(registry, network, wires, statistics, resolveSearchProfile(options.profile));
    while (statistics.evaluations < statistics.evaluationLimit) {
      checkBudget(); update("layout", "正在优化原图设备位置与减量组合");
      const feasible = await search.advance(Math.min(250, statistics.evaluationLimit - statistics.evaluations), checkBudget);
      reportEvaluations(statistics.evaluations);
      if (!feasible) continue;
      search.applyBest();
      const powered = collectPoweredEntityIds(network.nodes.map(node => node.entity), registry.entityDefinitions);
      if (network.nodes.some(node => node.definition.requiresPower && !powered.has(node.entity.id))) continue;
      const router = new PlannerRouter(registry, network.nodes.map(node => node.entity), wires.flatMap(wire => [wire.source, wire.target]),
        { minimumX: 0, minimumY: 0, maximumX: outline.width - 1, maximumY: outline.height - 1, escapeLength: 0 }, routing);
      statistics.routingAttempts++;
      update("routing", "正在重建原图物流路径");
      try {
        for (const wire of wires) {
          const cached = source.routes.find(route => route.sourcePort === key(wire.source) && route.targetPort === key(wire.target));
          if (cached && router.reuse(wire.source, wire.target, cached.cells, wire.minimumCells)) statistics.reusedRoutes = (statistics.reusedRoutes ?? 0) + 1;
          else await router.connect(wire.source, wire.target, checkBudget, wire.minimumCells);
        }
        if (router.entities.some(entity => !registry.queries.isBelt(entity.definitionId) && !registry.queries.isPipe(entity.definitionId))) {
          throw new PlannerCandidateError("重布线需要新增物流控制设备，本次候选不满足数量约束。");
        }
        const reservedIds = new Set(request.blueprintSource.blueprint.entityOrder);
        const tracks = router.entities.map((entity, index) => {
          let id = `__blueprint_route_${index}`;
          while (reservedIds.has(id)) id += "_";
          reservedIds.add(id);
          return { ...entity, id };
        });
        const entities = [...network.nodes.map(node => node.entity), ...tracks];
        const blueprint = createBlueprintDocument({ name: request.plan.name, description: request.blueprintSource.blueprint.description,
          baseId: request.plan.sourceBaseId, initialGridPoint: { x: 0, y: 0 }, entities: Object.fromEntries(entities.map(entity => [entity.id, entity])),
          entityOrder: entities.map(entity => entity.id), slotLinks: network.slotLinks, regions: request.blueprintSource.blueprint.regions });
        const execution = (() => {
          try { return blueprintRecognitionScene(registry, request.blueprintSource!, blueprint); }
          catch (error) { throw new PlannerCandidateError(error instanceof Error ? error.message : String(error)); }
        })();
        const quality = measurePlannerQuality(registry, network, entities, router.routes, outline.width * outline.height, outline.width, outline.height);
        // 输出方式中立：原有“同面积优先少箱”只属于产线生成，不影响蓝图优化。
        statistics.quality = { ...quality, outputStashCount: 0 };
        const area = outline.width * outline.height;
        const candidate: PlannerCandidate = { execution, connections: [], search: statistics,
          seed: capturePlannerSeed(request, network, wires, router.routes, outline.width, outline.height),
          supplyAudit: { operatingLimits: [], splitterCount: 0, bufferedAdmissions: 0 },
          metrics: { width: outline.width, height: outline.height, area, entityCount: entities.length,
            productionDeviceCount: network.nodes.filter(node => node.purpose === "production").length,
            gasDiffuserCount: network.nodes.filter(node => node.purpose === "environment").length, additionalGasDiffuserCount: 0,
            score: boundedPlannerScore(area, quality.secondary),
            // 订正 2026-10-06：蓝图优化路径同样交付占用与利用率，界面展示口径与产线生成保持一致。
            occupiedCells: quality.occupiedCells, utilization: quality.utilization } };
        assertPlannerCandidateBounds(registry, candidate);
        return candidate;
      } catch (error) {
        if (!(error instanceof PlannerCandidateError)) throw error;
        for (const wire of wires) search.penalize(wire.source.entityId, wire.target.entityId);
      }
    }
    throw new PlannerCandidateError("本轮未找到满足原图约束的更优布局。", statistics);
  } catch (error) {
    if (error instanceof PlannerCandidateError) throw new PlannerCandidateError(error.message, statistics);
    throw error;
  }
}
