import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorldEntity } from "@/domain/document/world-document";
import type { BlueprintPlannerConnection, BlueprintPlannerMetrics, BlueprintPlannerPhase, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import type { SimulationBlueprintRunRequest } from "@/domain/simulation";
import { lookupText } from "@/shared/i18n";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { createProductionNetwork, supplyAuxiliaryDemand } from "./production-network";
import { createPlainNode, PlannerPlacement, placeProduction } from "./placement";
import { addTerminals, configureSource, materialBalance } from "./terminals";
import { connectPlantStartups, placePower, preparePlantStartups } from "./support";
import { wireProductionNetwork } from "./wiring";
import { PlannerRouter } from "./router";
import { getPlannerPorts, opposite, resolveTransportPose, transportCapacity } from "./geometry";
import { buildLayoutGraph } from "./layout-graph";
import { PlannerCandidateError, type PlannerNode } from "./model";
import { CompactLayoutSearch } from "./compact-layout";
import { resolveSearchProfile } from "./search-profile";
import { boundedPlannerScore, measurePlannerQuality } from "./quality";
import { auditPlannerSupply, type PlannerSupplyAudit } from "./supply-audit";
import type { PlannerDiagnosticPhase, PlannerSearchDiagnostics, PlannerSearchExperiment, PlannerSearchOptions, PlannerSearchStatistics } from "./search-types";

export interface PlannerCandidate {
  readonly supplyAudit: PlannerSupplyAudit;
  readonly search: PlannerSearchStatistics;
  readonly execution: SimulationBlueprintRunRequest;
  readonly metrics: BlueprintPlannerMetrics;
  readonly connections: readonly BlueprintPlannerConnection[];
}

export async function createPlannerCandidate(
  registry: RegistryContract, request: BlueprintPlannerRequest, variant: number,
  checkBudget: () => void, update: (phase: BlueprintPlannerPhase, message: string) => void,
  options: PlannerSearchOptions = {},
): Promise<PlannerCandidate> {
  const diagnosticStarted = performance.now();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  checkBudget();
  const experiments: readonly PlannerSearchExperiment[] = options.experiments ?? ["power-dedup"];
  for (const experiment of experiments) {
    if (!["constraint-repair", "power-dedup", "constrained-routing"].includes(experiment)) throw new Error(`未知搜索实验：${experiment}`);
  }
  const profile = resolveSearchProfile(options.profile);
  const network = createProductionNetwork(registry, request);
  // AI-REMOVED 2026-09-16:
  // Reason: 固定六格间距与无拓扑随机排列使紧凑目标不可达。
  // Trigger: 用户要求一万次局部评估内优化完整蓝图面积。
  // Evidence: 赤铜矿版间距膨胀面积 1534 大于目标可用空间。
  // Replacement: 工序初排、CompactLayoutSearch 和受边界约束的布线反馈。
  // Risk: 新搜索需要真实布线与 dense 产量回归。
  // Human Review: Required
  // Original code:
//   if (variant >= 4) {
//     const order = (id: string) => { let value = variant * 2654435761; for (const char of id) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return value >>> 0; };
//     network.nodes.sort((left, right) => order(left.entity.id) - order(right.entity.id));
//   }
//   const area = network.nodes.reduce((sum, node) => sum + (node.definition.footprint.width + 3) * (node.definition.footprint.height + 3), 0);
//   const factors = [1, 1.3, 0.8, 1.6, 1.1, 0.65];
//   const plantGap = Math.floor(variant / 8) % 2 === 0 ? 3 : 1;
//   const hasPlants = network.nodes.some((node) => node.definition.id === "seedcol_1");
//   const placement = new PlannerPlacement(registry, Math.max(16, Math.ceil(Math.sqrt(area) * factors[Math.floor(variant / 4) % factors.length]! * (1 + Math.floor(variant / 24) * 0.05))), 8, request.options.warehouseBus === "free" ? 8 : 0,
//     hasPlants ? plantGap : 6,
//     hasPlants ? plantGap : Math.floor(variant / 24) % 2 !== 0 ? 3 : 1);
  const producers = new Map<string, string[]>();
  for (const node of network.nodes) for (const flow of node.outputs) producers.set(flow.itemId, [...(producers.get(flow.itemId) ?? []), node.entity.id]);
  const initialGraph = buildLayoutGraph(network.nodes.map(node => node.entity.id), network.nodes.flatMap(node => node.inputs.flatMap(flow =>
    (producers.get(flow.itemId) ?? []).map(from => ({ from, to: node.entity.id })))));
  network.nodes.sort((a, b) => initialGraph.groups[initialGraph.groupIndexByNodeId.get(a.entity.id)!]!.rank
    - initialGraph.groups[initialGraph.groupIndexByNodeId.get(b.entity.id)!]!.rank);
  const bodyArea = network.nodes.reduce((sum, node) => sum + node.definition.footprint.width * node.definition.footprint.height, 0);
  const scale = 1 + Math.floor(variant / 3) * 0.25;
  const outline = options.outline ? { ...options.outline } : { width: Math.max(24, Math.ceil(Math.sqrt(bodyArea / 0.25) * scale)), height: Math.max(32, Math.ceil(Math.sqrt(bodyArea / 0.25) * 1.35 * scale)) };
  const statistics: PlannerSearchStatistics = { seed: variant, evaluationLimit: options.maxEvaluations ?? 50_000,
    evaluations: 0, acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline, profile };
  if (experiments.length) Object.assign(statistics, { experiments: [...experiments] });
  const diagnostics: PlannerSearchDiagnostics | undefined = options.diagnostics ? {
    timingsMs: { setup: 0, layout: 0, routing: 0, power: 0, supply: 0, finalization: 0 },
    layoutChecks: 0, feasibleLayouts: 0, fullyRoutedAttempts: 0,
    rejectionCounts: { routing: 0, power: 0, supply: 0, circulation: 0 }, rejections: [], omittedRejectionDetails: 0,
  } : undefined;
  if (diagnostics) statistics.diagnostics = diagnostics;
  let diagnosticPhase: PlannerDiagnosticPhase = "setup", diagnosticSince = diagnosticStarted;
  const enterPhase = (next: PlannerDiagnosticPhase): void => {
    if (!diagnostics) return;
    const now = performance.now();
    diagnostics.timingsMs[diagnosticPhase] += now - diagnosticSince;
    diagnosticPhase = next; diagnosticSince = now;
  };
  const reject = (phase: keyof PlannerSearchDiagnostics["rejectionCounts"], reason: string): void => {
    if (!diagnostics) return;
    diagnostics.rejectionCounts[phase]++;
    const existing = diagnostics.rejections.find(entry => entry.phase === phase && entry.reason === reason);
    if (existing) { existing.count++; existing.lastEvaluation = statistics.evaluations; }
    else if (diagnostics.rejections.length < 64) diagnostics.rejections.push({ phase, reason, count: 1,
      firstEvaluation: statistics.evaluations, lastEvaluation: statistics.evaluations });
    else diagnostics.omittedRejectionDetails++;
  };
  if (!Number.isInteger(statistics.evaluationLimit) || statistics.evaluationLimit <= 0 || !Number.isInteger(outline.width) || !Number.isInteger(outline.height)
    || outline.width <= 0 || outline.height <= 0) throw new Error("布局搜索预算和边界必须是正整数。");
  const placement = new PlannerPlacement(registry, Math.max(16, outline.width - 8), 7, request.options.warehouseBus === "free" ? 8 : 2, profile.initialClearance, 1);
  placement.maximumX = outline.width;
  update("layout", "正在安排设备与环境设施");
  await placeProduction(registry, network, placement, variant, checkBudget);
  const processedEnvironments = new Set<string>();
  for (;;) {
    checkBudget();
    const added = network.nodes.filter((node) => node.entity.id.startsWith("eda-environment-") && !processedEnvironments.has(node.entity.id));
    if (!added.length) break;
    for (const environment of added) {
      processedEnvironments.add(environment.entity.id);
      for (const input of environment.inputs) {
        const deficit = -(materialBalance(network).get(input.itemId) ?? 0);
        if (deficit > 1e-6) supplyAuxiliaryDemand(registry, network, input.itemId, deficit);
      }
    }
    await placeProduction(registry, network, placement, variant, checkBudget);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  // AI-REMOVED 2026-09-16: 初排供电由后面的候选覆盖计算替代。
  // Reason: 不能把初排的桩数固定为搜索约束。Trigger: 赤铜矿覆盖缺口。
  // Evidence: 1789569174504-774676。Replacement: 布线前 placePower。
  // 订正 2026-09-16：最终实现在布线后补桩，避免桩位占用物流通道。
  // Risk: Low。Human Review: Required。
  // Original code: await placePower(registry, network, placement, checkBudget);
  const startups = preparePlantStartups(registry, network, placement);
  addTerminals(registry, network, placement, profile.separateOperatingSupply === 1, profile.fluidGroupSize);
  checkBudget();
  const wires = await wireProductionNetwork(registry, network, placement, checkBudget);
  connectPlantStartups(registry, startups, wires);
  statistics.wireCount = wires.length;
  statistics.bestRoutedWireCount = 0;
  // AI-REMOVED 2026-09-16: 初排供电由后面的候选覆盖计算替代。
  // Reason: 不能把初排的桩数固定为搜索约束。Trigger: 赤铜矿覆盖缺口。
  // Evidence: 1789569174504-774676。Replacement: 布线前 placePower。
  // 订正 2026-09-16：最终实现在布线后补桩，避免桩位占用物流通道。
  // Risk: Low。Human Review: Required。
  // Original code: await placePower(registry, network, placement, checkBudget);
  if (options.outline === undefined) for (const node of network.nodes.filter(node => node.purpose === "bus" || node.external
    || node.definition.id === "unloader_1" || node.definition.id === "loader_1")) {
    const rect = resolveEntityGridRect({ entity: node.entity, definition: node.definition });
    outline.width = Math.max(outline.width, rect.x + rect.width); outline.height = Math.max(outline.height, rect.y + rect.height);
  }
  // AI-REMOVED 2026-09-16:
  // Reason: 完全冻结摆位后扩大 A* 搜索范围会无限放大蓝图，且没有失败反馈。
  // Trigger: 30×40 紧凑布局与局部评估预算要求。
  // Evidence: 旧成功蓝图 48×54 / 60×69；布线绕行没有回馈设备布局。
  // Replacement: 下方共享搜索预算、受限布线及 CompactLayoutSearch.penalize。
  // Risk: 端口密集区需回归；失败不交付为有效蓝图。
  // Human Review: Required
  // Original code:
//   const fixtures: WorldEntity[] = [];
//   for (const node of network.nodes.filter((entry) => entry.definition.id === "storager_1" && (entry.purpose === "product" || entry.purpose === "byproduct"))) {
//     const output = getPlannerPorts(registry, node.entity, node.definition, "output", node.inputs[0]!.itemId)[0]!;
//     // 验证中持续清空成品容器；夹具不进入交付蓝图，实际放置后由用户取走成品。
//     const sink = createPlainNode(registry, "cheat_infinite_solid", `eda-validation-sink-${fixtures.length}`, "logistics");
//     sink.entity.position = output.outside;
//     fixtures.push(sink.entity);
//   }
//   const external = network.nodes.filter((node) => node.external);
//   const maximumX = external[0]?.entity.position.x;
//   const makeRouter = () => new PlannerRouter(registry, [...network.nodes.map((node) => node.entity), ...fixtures],
//     wires.flatMap((wire) => [wire.source, wire.target]), {
//       minimumX: network.nodes.some((node) => node.purpose === "bus") ? registry.queries.findEntityDefinition("log_hongs_bus_source")!.footprint.width : 0,
//       ...(request.options.warehouseBus === "free" ? { minimumY: 4 } : {}),
//       ...(maximumX === undefined ? {} : { maximumX }),
//     });
//   const wireLength = (wire: typeof wires[number]) => Math.abs(wire.source.cell.x - wire.target.cell.x) + Math.abs(wire.source.cell.y - wire.target.cell.y);
//   const routingGraph = buildLayoutGraph(network.nodes.map((node) => node.entity.id), wires.map((wire) => ({ from: wire.source.entityId, to: wire.target.entityId })));
//   const isReturn = (wire: typeof wires[number]) => {
//     const group = routingGraph.groupIndexByNodeId.get(wire.source.entityId)!;
//     return routingGraph.groups[group]!.cyclic && group === routingGraph.groupIndexByNodeId.get(wire.target.entityId);
//   };
//   wires.sort((left, right) => Number(isReturn(right)) - Number(isReturn(left)) || (variant % 2 ? 1 : -1) * (wireLength(left) - wireLength(right)));
//   const travelSeconds: number[] = [];
//   let router = makeRouter();
//   for (let retry = 0; ; retry++) {
//     let index = 0;
//     try {
//       for (; index < wires.length; index++) {
//         checkBudget();
//         update("routing", `正在连接物流 ${index + 1}/${wires.length}`);
//         const wire = wires[index]!;
//         const length = await router.connect(wire.source, wire.target, checkBudget);
//         travelSeconds.push((length + 1) * 60 / transportCapacity(wire.source.kind));
//       }
//       break;
//     } catch (error) {
//       if (!(error instanceof PlannerCandidateError) || retry >= 5) throw error;
//       // 优先连接上轮受阻线路，再重新布线，避免只因先后顺序放弃整个设备布局。
//       const [blocked] = wires.splice(index, 1);
//       wires.unshift(blocked!);
//       travelSeconds.length = 0;
//       router = makeRouter();
//     }
//   }
  const search = new CompactLayoutSearch(registry, network, wires, statistics, profile);
  enterPhase("layout");
  const routingGraph = buildLayoutGraph(network.nodes.map(node => node.entity.id), wires.map(wire => ({ from: wire.source.entityId, to: wire.target.entityId })));
  const circulationLimits = routingGraph.groups.filter(group => group.cyclic).flatMap(group => {
    const nodes = network.nodes.filter(node => group.nodeIds.includes(node.entity.id));
    if (!nodes.some(node => node.definition.id === "seedcol_1") || nodes.some(node => node.recipe !== null
      && !["seedcol_1", "planter_1", "planter_1_liquid"].includes(node.definition.id))) return [];
    const edges = wires.flatMap((wire, index) => group.nodeIds.includes(wire.source.entityId) && group.nodeIds.includes(wire.target.entityId) ? [index] : []);
    if (!edges.length || edges.some(index => Math.abs(wires[index]!.perMinute - wires[edges[0]!]!.perMinute) > 1e-6)) return [];
    const preload = nodes.reduce((total, node) => total + Object.entries(node.entity.config)
      .reduce((sum, [key, value]) => sum + (key.endsWith(".initialCount") && typeof value === "number" ? value : 0), 0), 0);
    const admitted = startups.filter(startup => group.nodeIds.includes(startup.picker.entity.id)).reduce((sum, startup) => {
      const rule = Object.values(startup.admission.entity.config).find(value => typeof value === "object" && value !== null && "limit" in value);
      return sum + (rule && typeof rule.limit === "number" ? rule.limit : 0);
    }, 0);
    const processing = nodes.reduce((sum, node) => sum + (node.recipe?.durationSeconds ?? 0)
      * edges.reduce((rate, index) => rate + (wires[index]!.target.entityId === node.entity.id ? wires[index]!.perMinute : 0), 0) / 60, 0);
    return [{ edges, inventory: preload + admitted, processing }];
  });
  let fixtures: WorldEntity[] = [];
  const external = network.nodes.filter(node => node.external);
  let router: PlannerRouter | null = null;
  let powerNodes: PlannerNode[] = [];
  const travelSeconds: number[] = [];
  let failure = "当前预算内尚未找到符合边界的合法布局";
  while (statistics.evaluations < statistics.evaluationLimit) {
    update("optimization", `正在优化布局 ${statistics.evaluations}/${statistics.evaluationLimit}`);
    enterPhase("layout");
    const feasible = await search.advance(Math.min(750, statistics.evaluationLimit - statistics.evaluations), checkBudget);
    if (diagnostics) { diagnostics.layoutChecks++; if (feasible) diagnostics.feasibleLayouts++; }
    if (!feasible) continue;
    search.applyBest();
    enterPhase("routing");
    fixtures = [];
    for (const node of network.nodes.filter(entry => entry.definition.id === "storager_1" && (entry.purpose === "product" || entry.purpose === "byproduct"))) {
      const output = getPlannerPorts(registry, node.entity, node.definition, "output", node.inputs[0]!.itemId)[0]!;
      // 验证中持续清空成品容器；夹具不进入交付蓝图，实际放置后由用户取走成品。
      const sink = createPlainNode(registry, "cheat_infinite_solid", `eda-validation-sink-${fixtures.length}`, "logistics");
      const drain: WorldEntity = { id: `eda-validation-drain-${fixtures.length}`,
        ...resolveTransportPose(registry, output.kind, opposite(output.edge), output.edge), position: output.outside, config: {}, tags: [] };
      sink.entity.position = { x: output.outside.x * 2 - output.cell.x, y: output.outside.y * 2 - output.cell.y };
      fixtures.push(drain, sink.entity);
    }
    // AI-REMOVED 2026-09-16: 供电移到布线后补齐，防止新桩阻断原本可达的通道。
    // Reason: 稀疏覆盖贪心不应抢占物流通道。Trigger: 布线受阻。
    // Evidence: 1789569625663-777721。Replacement: 成功布线后的 placePower。
    // Risk: 无剩余桩位时继续搜索。Human Review: Required。
    // Original code:
    // const coverage = await placePower(registry, network, wires, fixtures, outline, checkBudget);
    //     if (coverage === null) { failure = "候选布局没有足够的合法供电桩位置"; continue; }
    //     powerNodes = coverage;
    const lengths = wires.map(wire => Math.abs(wire.source.outside.x - wire.target.outside.x) + Math.abs(wire.source.outside.y - wire.target.outside.y));
    const order = wires.map((_, index) => index).sort((a, b) => lengths[a]! - lengths[b]!);
    const history = new Map<string, number>();
    let blockedIndex = 0;
    for (let retry = 0; retry < 24; retry++) {
      enterPhase("routing");
      const candidateRouter = new PlannerRouter(registry, [...network.nodes.map(node => node.entity), ...fixtures],
        wires.flatMap(wire => [wire.source, wire.target]), {
          minimumX: network.nodes.some(node => node.purpose === "bus") ? 4 : 0,
          minimumY: network.nodes.some(node => node.purpose === "bus") && request.options.warehouseBus === "free" ? 4 : 0,
          maximumX: outline.width - 1, maximumY: outline.height - 1, escapeLength: 0, history,
        });
      if (retry === 0 && experiments.includes("constrained-routing")) {
        const freedom = wires.map(wire => candidateRouter.estimateEndpointFreedom(wire.source, wire.target));
        order.sort((a, b) => freedom[a]! - freedom[b]! || lengths[a]! - lengths[b]!);
      }
      statistics.routingAttempts++;
      travelSeconds.length = 0;
      let routedWireCount = 0;
      let rejectionPhase: "routing" | "power" | "supply" = "routing";
      try {
        // 先处理短线，失败边的代价反馈给后续摆位，而非反复扩大世界边界。
        // 订正 2026-09-17：constrained-routing 实验先处理端口自由空间较少的线，同分仍按短线优先。
        for (const index of order) {
          blockedIndex = index; checkBudget();
          update("routing", `正在连接物流 ${index + 1}/${wires.length}`);
          const wire = wires[index]!;
          const length = await candidateRouter.connect(wire.source, wire.target, checkBudget, wire.minimumCells);
          routedWireCount++;
          statistics.bestRoutedWireCount = Math.max(statistics.bestRoutedWireCount!, routedWireCount);
          travelSeconds[index] = (length + 1) * 60 / transportCapacity(wire.source.kind);
        }
        if (diagnostics) diagnostics.fullyRoutedAttempts++;
        // 等流量植物回路的最少在途库存为流率×真实路程时间；启动数量固定，不能以额外物品掩盖长回路。
        const starved = circulationLimits.find(limit => limit.processing + limit.edges.reduce((sum, index) => sum
          + wires[index]!.perMinute * travelSeconds[index]! / 60, 0) > limit.inventory);
        if (starved !== undefined) {
          blockedIndex = starved.edges.reduce((longest, index) => travelSeconds[index]! > travelSeconds[longest]! ? index : longest);
          failure = "植物回路过长，固定启动库存不足以维持目标流量";
          reject("circulation", failure);
          break;
        }
        enterPhase("power"); rejectionPhase = "power";
        const coverage = await placePower(registry, network, wires, [...fixtures, ...candidateRouter.entities], outline, checkBudget);
        if (coverage === null) {
          failure = "候选布局没有足够的合法供电桩位置"; reject("power", failure);
          if (experiments.includes("power-dedup")) break;
          continue;
        }
        enterPhase("supply"); rejectionPhase = "supply";
        auditPlannerSupply(registry, network, wires, candidateRouter.routes);
        powerNodes = coverage;
        router = candidateRouter; break;
      } catch (error) {
        if (!(error instanceof PlannerCandidateError)) throw error;
        failure = error.message;
        reject(rejectionPhase, failure);
        statistics.routeSnapshot = candidateRouter.entities;
        statistics.blockedWire = wires[blockedIndex];
        // 对实际阻挡线路累计历史拥塞成本，让它们下一轮主动绕开争抢的格子。
        for (const [route, cells] of candidateRouter.conflicts) for (const cell of cells) {
          const key = `${route}|${cell}`; history.set(key, (history.get(key) ?? 0) + 3);
        }
        // 静态设备或缓冲空间阻塞无法靠重复布线顺序修复，直接反馈给布局搜索。
        if (candidateRouter.conflicts.size === 0) break;
        const position = order.indexOf(blockedIndex);
        order.splice(position, 1); order.unshift(blockedIndex);
      }
    }
    if (router !== null) break;
    enterPhase("layout");
    const blocked = wires[blockedIndex]!;
    search.penalize(blocked.source.entityId, blocked.target.entityId);
  }
  if (router === null) {
    search.applyBest();
    statistics.layoutSnapshot = network.nodes.map(node => structuredClone(node.entity));
    enterPhase("finalization");
    throw new PlannerCandidateError(`${failure}；局部评估 ${statistics.evaluations}/${statistics.evaluationLimit}`, statistics);
  }
  enterPhase("finalization");
  network.nodes.push(...powerNodes);
  statistics.routeSnapshot = undefined;
  statistics.blockedWire = undefined;
  const supplyAudit = auditPlannerSupply(registry, network, wires, router.routes);
  const graph = buildLayoutGraph(network.nodes.map((node) => node.entity.id), wires.map((wire) => ({ from: wire.source.entityId, to: wire.target.entityId })));
  const arrival = graph.groups.map(() => 0);
  for (const { group, index } of graph.groups.map((group, index) => ({ group, index })).sort((a, b) => a.group.rank - b.group.rank)) {
    const processing = network.nodes.filter((node) => group.nodeIds.includes(node.entity.id)).reduce((sum, node) => sum + (node.recipe?.durationSeconds ?? 0), 0);
    const cycleTravel = wires.reduce((sum, wire, wireIndex) => sum + (graph.groupIndexByNodeId.get(wire.source.entityId) === index
      && graph.groupIndexByNodeId.get(wire.target.entityId) === index ? travelSeconds[wireIndex]! : 0), 0);
    arrival[index] = arrival[index]! + processing + cycleTravel;
    wires.forEach((wire, wireIndex) => {
      if (graph.groupIndexByNodeId.get(wire.source.entityId) !== index) return;
      const target = graph.groupIndexByNodeId.get(wire.target.entityId)!;
      if (target !== index) arrival[target] = Math.max(arrival[target]!, arrival[index]! + travelSeconds[wireIndex]! + 10);
    });
  }
  const entities = [...network.nodes.map((node) => node.entity), ...router.entities];
  const rects = entities.map((entity) => resolveEntityGridRect({ entity, definition: registry.queries.findEntityDefinition(entity.definitionId)! }));
  const left = Math.min(...rects.map((rect) => rect.x)), top = Math.min(...rects.map((rect) => rect.y));
  const width = Math.max(...rects.map((rect) => rect.x + rect.width)) - left;
  const height = Math.max(...rects.map((rect) => rect.y + rect.height)) - top;
  for (const entity of [...entities, ...fixtures]) entity.position = { x: entity.position.x - left, y: entity.position.y - top };
  const connections: BlueprintPlannerConnection[] = [];
  for (const source of external) {
    const flow = source.outputs[0]!;
    const domain = registry.queries.resolveItemDomain(flow.itemId);
    const definitionId = domain === ItemDomainFlag.Solid ? "cheat_infinite_solid" : domain === ItemDomainFlag.Gas ? "cheat_infinite_gas" : "cheat_infinite_liquid";
    const fixture = createPlainNode(registry, definitionId, `eda-validation-source-${fixtures.length}`, "supply");
    const inlet = getPlannerPorts(registry, source.entity, source.definition, "input", flow.itemId)[0]!;
    fixture.entity.position = inlet.outside;
    configureSource(fixture, flow.itemId, true);
    fixtures.push(fixture.entity);
    connections.push({ itemId: flow.itemId, kind: inlet.kind, direction: "input", position: source.entity.position, edge: inlet.edge, perMinute: transportCapacity(inlet.kind) });
  }
  const targetDescription = request.plan.targets.map((flow) => {
    const definition = registry.queries.findItemDefinition(flow.itemId)!;
    return `${lookupText("zh-CN", definition.nameKey) ?? flow.itemId} ${flow.perMinute}/min`;
  }).join("、");
  const gasCount = network.nodes.filter((node) => node.purpose === "environment").length;
  const additionalGasCount = Math.max(0, gasCount - network.preferredGasCount);
  // AI-REMOVED 2026-09-16:
  // Reason: 加权面积会让更小布局输给形状项。Trigger: 用户要求面积绝对优先。
  // Evidence: 供料约束与施工评分.md。Replacement: measurePlannerQuality / boundedPlannerScore。
  // Risk: Low。Human Review: Required。
  // Original code: const ratio = Math.max(width / height, height / width);
  statistics.quality = measurePlannerQuality(registry, network, entities, router.routes, width * height, width, height);
  const metrics: BlueprintPlannerMetrics = {
    width, height, area: width * height, entityCount: entities.length,
    productionDeviceCount: network.nodes.filter((node) => node.purpose === "production" || node.purpose === "auxiliary").length,
    gasDiffuserCount: gasCount, additionalGasDiffuserCount: additionalGasCount,
    score: boundedPlannerScore(width * height, statistics.quality.secondary),
  };
  const blueprint = createBlueprintDocument({
    name: request.plan.name.trim() || targetDescription, baseId: request.plan.sourceBaseId,
    initialGridPoint: { x: 0, y: 0 }, entityOrder: entities.map((entity) => entity.id),
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])), slotLinks: network.slotLinks,
    description: `自动规划产线（EDA）\n目标：${targetDescription}\n范围：${width} × ${height}\n供电：外部供电，已布置供电桩${network.nodes.some((node) => node.definition.id === "seedcol_1") ? `\n植物循环启动：${request.options.plantStartup === "preload" ? "采种机预置 50 个物品" : "仓库通过准入口提供 29 个物品"}` : ""}`,
  });
  const result: PlannerCandidate = {
    metrics, connections, search: statistics, supplyAudit,
    execution: {
      blueprint,
      scene: { externalEntities: fixtures, externalSlotLinks: [], initialSlots: network.initialSlots, powerMode: "infinite" },
      probes: [...request.plan.targets.map((flow) => ({
        id: flow.itemId, itemId: flow.itemId, direction: "input" as const,
        entityIds: network.nodes.filter((node) => node.purpose === "product" && node.inputs.some((input) => input.itemId === flow.itemId)).map((node) => node.entity.id),
      })), ...supplyAudit.operatingLimits.map(limit => ({ id: `operating:${limit.entityId}`, itemId: limit.itemId,
        direction: "output" as const, entityIds: [limit.entityId] }))],
      warmupSeconds: Math.max(180, Math.ceil(Math.max(...arrival) * 3)),
      observationSeconds: 120, inventorySampleCount: 9, maxWallTimeMs: 120_000,
      activeActivityIds: request.plan.activeActivityIds,
    },
  };
  enterPhase("finalization");
  return result;
}
