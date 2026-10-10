import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorldEntity } from "@/domain/document/world-document";
import type { BlueprintPlannerConnection, BlueprintPlannerMetrics, BlueprintPlannerPhase, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import type { SimulationBlueprintRunRequest } from "@/domain/simulation";
import { lookupText } from "@/shared/i18n";
// AI-REMOVED 2026-10-05:
// Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// Replacement: 候选面积固定使用 outline，无需按实体重算尺寸。
// Risk: 旧搜索种子失效，按算法版本重置。
// Human Review: Required
// Original code:
// import { resolveEntityGridRect } from "@/shared/geometry/power-range";

import { createProductionNetwork, supplyAuxiliaryDemand } from "./production-network";
import { createPlainNode, PlannerPlacement, placeProduction, redundantEnvironmentStations } from "./placement";
import { addTerminals, configureSource, getPlannerStashDrainPorts, materialBalance } from "./terminals";
import { connectPlantStartups, placePower, preparePlantStartups, prepareConverterStartups, configureConverterStartupInventory, scheduleConverterStartups, converterStartupTimes } from "./support";
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
import type { PlannerRoutingBackend } from "./routing-backend";
import type { PlannerLayoutBackend } from "./layout-backend";
import { constructCompactLayout } from "./constructive-layout";
import { capturePlannerSeed, restorePlannerSeed, type PlannerSearchSeed } from "./search-seed";
import { resolvePlannerAttempt } from "./search-portfolio";
import { PLANNER_MAX_SIDE, assertPlannerOutline, initialPlannerOutline, continuationOutline, fixedOutlineMinimum } from "./search-outline";
import { assertPlannerCandidateBounds } from "./verification";
import { PlannerBoundary } from "./boundary";
import { createBlueprintCandidate } from "./blueprint-candidate";
import { planConverterSupply } from "./converter-supply";
import { routeConverterAlternatives } from "./converter-routing";

export interface PlannerCandidate {
  readonly seed?: PlannerSearchSeed;
  readonly supplyAudit: PlannerSupplyAudit;
  readonly search: PlannerSearchStatistics;
  readonly execution: SimulationBlueprintRunRequest;
  readonly metrics: BlueprintPlannerMetrics;
  readonly connections: readonly BlueprintPlannerConnection[];
}

export async function createPlannerCandidate(
  registry: RegistryContract, request: BlueprintPlannerRequest, variant: number,
  checkBudget: () => void, update: (phase: BlueprintPlannerPhase, message: string) => void,
  options: PlannerSearchOptions = {}, reportEvaluations: (count: number) => void = () => undefined,
  routing?: PlannerRoutingBackend, layoutBackend?: PlannerLayoutBackend,
): Promise<PlannerCandidate> {
  if (request.blueprintSource) return createBlueprintCandidate(registry, request, variant, checkBudget, update, options, reportEvaluations, routing);
  ({ request, variant } = resolvePlannerAttempt(request, variant));
  // 独立重启轮换箱数；预算内重排必须保持本轮拓扑选择。
  options = { ...options, stashPackingVariant: options.stashPackingVariant ?? Math.floor((variant + 1) / 4) };
  // 每四轮的独立重启轮换供水结构；三种结构避免与 32 分片步长锁定，阶段重排保持本轮选择。
  // 容量共享作为首选；管道能承担总需求时先搜索单口分流，多口局部直连仍参与轮换。
  options = { ...options, conduitTopology: options.conduitTopology
    ?? (["shared", "trunk", "local"] as const)[Math.floor((variant + 1) / 4) % 3] };
  const total = options.maxEvaluations ?? 50_000;
  const tight = !options.seed && !options.outline && !options.targetOutline && options.strategy !== "baseline" && total >= 10;
  const reserve = !options.seed && options.strategy !== "baseline" && total >= 20_000;
  // 两倍初排先使用十分之一预算，随后复用紧凑重排与宽松工序重排；所有阶段共用截止时间与次数。
  const phases: { strategy: "compact" | "baseline"; initial: boolean; fraction: number }[] = [
    ...(tight ? [{ strategy: "compact" as const, initial: true, fraction: 0.1 }] : []),
    { strategy: options.strategy ?? "compact", initial: !tight && !reserve, fraction: reserve ? 0.25 : 1 },
    ...(reserve ? [{ strategy: "baseline" as const, initial: false, fraction: 1 }] : []),
  ];
  let accumulated: PlannerSearchStatistics | undefined;
  const combine = (first: PlannerSearchStatistics, last: PlannerSearchStatistics): PlannerSearchStatistics => ({ ...last, evaluationLimit: total,
    evaluations: first.evaluations + last.evaluations, acceptedMoves: first.acceptedMoves + last.acceptedMoves,
    gpuEvaluations: (first.gpuEvaluations ?? 0) + (last.gpuEvaluations ?? 0), gpuBatches: (first.gpuBatches ?? 0) + (last.gpuBatches ?? 0),
    gpuKernelMs: (first.gpuKernelMs ?? 0) + (last.gpuKernelMs ?? 0),
    gpuCheckedLayouts: (first.gpuCheckedLayouts ?? 0) + (last.gpuCheckedLayouts ?? 0),
    gpuFeasibleLayouts: (first.gpuFeasibleLayouts ?? 0) + (last.gpuFeasibleLayouts ?? 0),
    constructiveEvaluations: (first.constructiveEvaluations ?? 0) + (last.constructiveEvaluations ?? 0),
    constructivePlaced: first.constructivePlaced === true || last.constructivePlaced === true, restartEvaluations: first.evaluations,
    rebuildAttempts: (first.rebuildAttempts ?? 0) + (last.rebuildAttempts ?? 0),
    rebuildEvaluations: (first.rebuildEvaluations ?? 0) + (last.rebuildEvaluations ?? 0),
    rebuildCompleted: (first.rebuildCompleted ?? 0) + (last.rebuildCompleted ?? 0),
    rebuildImprovements: (first.rebuildImprovements ?? 0) + (last.rebuildImprovements ?? 0),
    strategy: "compact", routingAttempts: first.routingAttempts + last.routingAttempts,
    supplyTopologyAttempts: (first.supplyTopologyAttempts ?? 0) + (last.supplyTopologyAttempts ?? 0),
    diagnostics: first.diagnostics && last.diagnostics ? { ...last.diagnostics,
      timingsMs: Object.fromEntries(Object.entries(last.diagnostics.timingsMs).map(([key, value]) =>
        [key, value + first.diagnostics!.timingsMs[key as PlannerDiagnosticPhase]])) as PlannerSearchDiagnostics["timingsMs"],
      layoutChecks: first.diagnostics.layoutChecks + last.diagnostics.layoutChecks,
      feasibleLayouts: first.diagnostics.feasibleLayouts + last.diagnostics.feasibleLayouts,
      fullyRoutedAttempts: first.diagnostics.fullyRoutedAttempts + last.diagnostics.fullyRoutedAttempts,
      rejectionCounts: Object.fromEntries(Object.entries(last.diagnostics.rejectionCounts).map(([key, value]) =>
        [key, value + first.diagnostics!.rejectionCounts[key as keyof PlannerSearchDiagnostics["rejectionCounts"]]])) as PlannerSearchDiagnostics["rejectionCounts"],
      rejections: [...first.diagnostics.rejections, ...last.diagnostics.rejections],
      omittedRejectionDetails: first.diagnostics.omittedRejectionDetails + last.diagnostics.omittedRejectionDetails,
    } : last.diagnostics });
  for (const [index, phase] of phases.entries()) {
    checkBudget();
    const used = accumulated?.evaluations ?? 0;
    const remaining = total - used;
    if (remaining <= 0) throw new PlannerCandidateError("本轮尝试次数已用尽。", accumulated);
    if (index > 0) update("optimization", "初排暂未布通，使用剩余预算重排");
    const finish = (last: PlannerSearchStatistics) => accumulated ? combine(accumulated, last) : { ...last, evaluationLimit: total };
    try {
      const result = await createPlannerAttempt(registry, request, phase.strategy === "baseline" && index > 0 ? variant % 9 : variant,
        checkBudget, update, { ...options, strategy: phase.strategy, maxEvaluations: Math.max(1, Math.floor(remaining * phase.fraction)),
          coolingEvaluations: phase.strategy === "baseline" && index > 0 ? total : options.coolingEvaluations }, count => reportEvaluations(used + count), routing, phase.initial, layoutBackend);
      return { ...result, search: finish(result.search) };
    } catch (error) {
      if (!(error instanceof PlannerCandidateError) || !error.search) throw error;
      accumulated = finish(error.search);
      if (index === phases.length - 1) throw new PlannerCandidateError(error.message, accumulated);
    }
  }
  throw new PlannerCandidateError("本轮尚未找到可用布局。", accumulated);
}

// AI-REMOVED 2026-10-06:
// Reason: 两倍初排失败后需要独立的有界重排阶段，不能在同一过紧范围内用尽剩余预算。
// Trigger: 用户要求两倍初始面积及 70×70 上限；真实产线回归暴露固定两阶段调度无法覆盖新初排。
// Evidence: candidate、converter-startup、output-selection 的真实生成失败；两倍初排和既有重排需共享累计预算。
// Replacement: createPlannerCandidate 的分阶段循环与 createPlannerAttempt 的初排阶段参数。
// Risk: 首解会消耗额外初排预算；总次数、截止时间及验收规则不变。
// Human Review: Required
// Original code:
// export async function createPlannerCandidate(
//   registry: RegistryContract, request: BlueprintPlannerRequest, variant: number,
//   checkBudget: () => void, update: (phase: BlueprintPlannerPhase, message: string) => void,
//   options: PlannerSearchOptions = {}, reportEvaluations: (count: number) => void = () => undefined,
//   routing?: PlannerRoutingBackend,
// ): Promise<PlannerCandidate> {
//   if (request.blueprintSource) return createBlueprintCandidate(registry, request, variant, checkBudget, update, options, reportEvaluations, routing);
//   ({ request, variant } = resolvePlannerAttempt(request, variant));
//   // 独立重启轮换箱数；紧凑失败后的预算内重排必须保持本轮拓扑选择。
//   options = { ...options, stashPackingVariant: options.stashPackingVariant ?? Math.floor((variant + 1) / 4) };
//   const total = options.maxEvaluations ?? 50_000;
//   // 初排收紧后，小预算也要保留重排机会；至少四次才能划分四分之一初排额度。
//   const reserve = !options.seed && options.strategy !== "baseline" && total >= 4;
//   const firstBudget = reserve ? Math.floor(total / 4) : total;
//   try {
//     const result = await createPlannerAttempt(registry, request, variant, checkBudget, update, { ...options, maxEvaluations: firstBudget }, reportEvaluations, routing);
//     return { ...result, search: { ...result.search, evaluationLimit: total } };
//   } catch (error) {
//     if (!reserve || !(error instanceof PlannerCandidateError) || !error.search) throw error;
//     checkBudget();
//     const first = error.search;
//     update("optimization", "紧凑初排暂未布通，使用剩余预算重排");
//     const combine = (last: PlannerSearchStatistics): PlannerSearchStatistics => ({ ...last, evaluationLimit: total,
//       evaluations: first.evaluations + last.evaluations, acceptedMoves: first.acceptedMoves + last.acceptedMoves,
//       constructiveEvaluations: first.constructiveEvaluations, constructivePlaced: first.constructivePlaced, restartEvaluations: first.evaluations,
//       rebuildAttempts: (first.rebuildAttempts ?? 0) + (last.rebuildAttempts ?? 0),
//       rebuildEvaluations: (first.rebuildEvaluations ?? 0) + (last.rebuildEvaluations ?? 0),
//       rebuildCompleted: (first.rebuildCompleted ?? 0) + (last.rebuildCompleted ?? 0),
//       rebuildImprovements: (first.rebuildImprovements ?? 0) + (last.rebuildImprovements ?? 0),
//       strategy: "compact", routingAttempts: first.routingAttempts + last.routingAttempts,
//       diagnostics: first.diagnostics && last.diagnostics ? { ...last.diagnostics,
//         timingsMs: Object.fromEntries(Object.entries(last.diagnostics.timingsMs).map(([key, value]) =>
//           [key, value + first.diagnostics!.timingsMs[key as PlannerDiagnosticPhase]])) as PlannerSearchDiagnostics["timingsMs"],
//         layoutChecks: first.diagnostics.layoutChecks + last.diagnostics.layoutChecks,
//         feasibleLayouts: first.diagnostics.feasibleLayouts + last.diagnostics.feasibleLayouts,
//         fullyRoutedAttempts: first.diagnostics.fullyRoutedAttempts + last.diagnostics.fullyRoutedAttempts,
//         rejectionCounts: Object.fromEntries(Object.entries(last.diagnostics.rejectionCounts).map(([key, value]) =>
//           [key, value + first.diagnostics!.rejectionCounts[key as keyof PlannerSearchDiagnostics["rejectionCounts"]]])) as PlannerSearchDiagnostics["rejectionCounts"],
//         rejections: [...first.diagnostics.rejections, ...last.diagnostics.rejections],
//       } : last.diagnostics });
//     try {
//       // 重排使用有限的初排尺度，长会话不能因轮号增加而无限放大搜索框。
//       const result = await createPlannerAttempt(registry, request, variant % 9, checkBudget, update,
//         { ...options, strategy: "baseline", maxEvaluations: total - first.evaluations, coolingEvaluations: total },
//         count => reportEvaluations(first.evaluations + count), routing);
//       return { ...result, search: combine(result.search) };
//     } catch (failure) {
//       if (failure instanceof PlannerCandidateError && failure.search) throw new PlannerCandidateError(failure.message, combine(failure.search));
//       throw failure;
//     }
//   }
// }

/** 单次布局尝试；外层重排只消费剩余预算，不重置任务计数或截止时间。 */
async function createPlannerAttempt(
  registry: RegistryContract, request: BlueprintPlannerRequest, variant: number,
  assertBudget: () => void, update: (phase: BlueprintPlannerPhase, message: string) => void,
  options: PlannerSearchOptions, reportEvaluations: (count: number) => void,
  routing?: PlannerRoutingBackend, initialPass = false, layoutBackend?: PlannerLayoutBackend,
): Promise<PlannerCandidate> {
  let readEvaluations = () => 0;
  const checkBudget = () => { reportEvaluations(readEvaluations()); assertBudget(); };
  const diagnosticStarted = performance.now();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  checkBudget();
  const experiments: readonly PlannerSearchExperiment[] = options.experiments
    ?? (options.maximumArea !== undefined && options.strategy !== "baseline" ? ["power-dedup", "partial-rebuild"] : ["power-dedup"]);
  for (const experiment of experiments) {
    if (!["constraint-repair", "power-dedup", "constrained-routing", "partial-rebuild"].includes(experiment)) throw new Error(`未知搜索实验：${experiment}`);
  }
  const strategy = options.strategy ?? "compact";
  const profile = resolveSearchProfile({ ...(strategy === "compact" ? { areaWeight: 0.4, congestionWeight: 2, fluidGroupSize: 2 } : {}), ...options.profile });
  let restored = options.seed ? restorePlannerSeed(registry, request, options.seed) : undefined;
  let environmentLimits: Map<string, number> | undefined;
  if (restored) {
    const redundant = redundantEnvironmentStations(restored.network);
    if (redundant.length) {
      environmentLimits = new Map();
      for (const node of restored.network.nodes.filter(entry => entry.purpose === "environment" && !redundant.includes(entry))) {
        const gas = node.recipe!.gasDiffusionOutput!.gasItemId;
        environmentLimits.set(gas, (environmentLimits.get(gas) ?? 0) + 1);
      }
      // 拓扑改变时从原始生产需求重新补算辅助产能和物流，不复用已撤设备的管线或消耗。
      restored = undefined;
    }
  }
  let network = restored?.network ?? createProductionNetwork(registry, request);
  if (environmentLimits) {
    const counts = new Map<string, number>();
    const nodes = network.nodes.filter(node => {
      const gas = node.recipe?.gasDiffusionOutput?.gasItemId;
      if (!gas) return true;
      counts.set(gas, (counts.get(gas) ?? 0) + 1);
      return counts.get(gas)! <= (environmentLimits.get(gas) ?? 0);
    });
    network.nodes.splice(0, network.nodes.length, ...nodes);
  }
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
  // AI-REMOVED 2026-10-06:
  // Reason: 初始面积与尺度统一由 initialPlannerOutline 计算，取消重复放大的公式。
  // Trigger: 用户要求初始设备面积两倍、蓝图最大 70×70。
  // Evidence: 原宽高分别放大并增加边距，面积并非两倍。
  // Replacement: search-outline.ts initialPlannerOutline。
  // Risk: 初排更紧，可能增加布线失败次数；Human Review: Required。
  // Original code:
  //  const scale = strategy === "compact" ? [1, 1.12, 1.25][Math.floor(variant / 3) % 3]! : 1 + Math.floor(variant / 3) * 0.25;
  // AI-REMOVED 2026-10-02:
  // Reason: 固定设施最小边界由候选生成与广度调度共享，避免两处判定不一致。
  // Trigger: 多尺寸并行批次必须在派发前排除不可能的搜索盒子。
  // Evidence: 原边界计算仅存在于本候选生成器内。
  // Replacement: fixedOutlineMinimum，src/blueprint-planner/search-outline.ts。
  // Risk: 最小边界增加单体设备尺寸约束；Human Review: Required。
  // Original code:
  // const fixedMinimum = network.nodes.filter(node => node.purpose === "bus" || node.external
  //   || node.entity.definitionId === "unloader_1" || node.entity.definitionId === "loader_1")
  //   .reduce((bounds, node) => {
  //     const rect = resolveEntityGridRect({ entity: node.entity, definition: node.definition });
  //     return { width: Math.max(bounds.width, rect.x + rect.width), height: Math.max(bounds.height, rect.y + rect.height) };
  //   }, { width: 1, height: 1 });
  const fixedMinimum = fixedOutlineMinimum(registry, network.nodes);
  // 两倍约束用于初次紧凑搜索；失败后的工序重排保留更宽松的通道和辅助设施空间。
  const expandedScale = 1 + Math.floor(variant / 3) * 0.25;
  const expandedSide = Math.sqrt(bodyArea * 4) * expandedScale;
  const compactSide = Math.sqrt(bodyArea * 2) * [1, 1.12, 1.25][Math.floor(variant / 3) % 3]!;
  // AI-REMOVED 2026-09-30:
  // Reason: 只减单边从 20×20 直接要求 380 格，遗漏 399、396 等长宽比。
  // Trigger: 用户要求尝试打破面积停滞。Evidence: 五百万提案曲线及原分支。
  // Replacement: continuationOutline；前两次沿用快速缩边，此后枚举整数面积边界。
  // Risk: 新形状可能布不通；沿用预算和完整真实验收。Human Review: Required
  // Original code (seed branch):
  // { width: Math.min(options.outline?.width ?? Infinity, Math.max(1, options.seed.width - (variant % 2 ? 1 : 0))),
  //   height: Math.min(options.outline?.height ?? Infinity, Math.max(1, options.seed.height - (variant % 2 ? 0 : 1))) }
  // AI-REMOVED 2026-10-02:
  // Reason: 显式尺寸批次必须先于种子缩边选择盒子。
  // Trigger: 不同 Worker 对不同长宽比例进行有界搜索。
  // Evidence: 旧选择会在读取 targetOutline 之前先抛出面积上限错误。
  // Replacement: 下方 targetOutline 优先的 outline 选择。
  // Risk: Low；Human Review: Required。
  // Original code:
  // let outline = options.seed
  //   ? continuationOutline(options.seed, variant, options.continuationStep, fixedMinimum, options.outline, options.maximumArea)
  //   : options.outline ? { ...options.outline }
  //   : strategy === "compact" ? { width: Math.max(16, Math.ceil(Math.sqrt(bodyArea / 0.5) * scale) + 4), height: Math.max(18, Math.ceil(Math.sqrt(bodyArea / 0.5) * 1.2 * scale) + 2) }
  //     : { width: Math.max(24, Math.ceil(Math.sqrt(bodyArea / 0.25) * scale)), height: Math.max(32, Math.ceil(Math.sqrt(bodyArea / 0.25) * 1.35 * scale)) };
  // AI-REMOVED 2026-10-06:
  // Reason: 紧凑与重排初始盒子共用明确的两倍面积基准及 70 格边长上限。
  // Trigger: 用户指定新的尺寸规则。
  // Evidence: 原公式叠加边距、最小 16×18 和不同面积倍率。
  // Replacement: initialPlannerOutline。
  // Risk: 首解耗时可能增加；Human Review: Required。
  // Original code (initial outline branches):
  //     : strategy === "compact" ? { width: Math.max(16, Math.ceil(Math.sqrt(bodyArea / 0.5) * scale) + 4), height: Math.max(18, Math.ceil(Math.sqrt(bodyArea / 0.5) * 1.2 * scale) + 2) }
  //       : { width: Math.max(24, Math.ceil(Math.sqrt(bodyArea / 0.25) * scale)), height: Math.max(32, Math.ceil(Math.sqrt(bodyArea / 0.25) * 1.35 * scale)) };
  // AI-CORRECTION 2026-10-06：两倍面积仅约束初次紧凑搜索；后续紧凑重排与宽松重排仍在原预算和 70 格上限内扩框。
  let outline = options.targetOutline ? { ...options.targetOutline } : options.seed
    ? continuationOutline(options.seed, variant, options.continuationStep, fixedMinimum, options.outline, options.maximumArea)
    : options.outline ? { ...options.outline }
    : initialPass ? initialPlannerOutline(bodyArea, fixedMinimum, variant)
    : strategy === "compact" ? { width: Math.min(PLANNER_MAX_SIDE, Math.max(16, fixedMinimum.width, Math.ceil(compactSide) + 4)),
      height: Math.min(PLANNER_MAX_SIDE, Math.max(18, fixedMinimum.height, Math.ceil(compactSide * 1.2) + 2)) }
    : { width: Math.min(PLANNER_MAX_SIDE, Math.max(24, fixedMinimum.width, Math.ceil(expandedSide))),
      height: Math.min(PLANNER_MAX_SIDE, Math.max(32, fixedMinimum.height, Math.ceil(expandedSide * 1.35))) };
  // AI-CORRECTION 2026-10-02: 调度器指定的盒子不可由冷启动回退改成另一尺寸；原注释所述面积上限仍有效。
  if (!options.seed && !options.targetOutline && options.maximumArea !== undefined && outline.width * outline.height > options.maximumArea) {
    outline = continuationOutline(outline, variant, Math.floor(variant / 4) + 2, fixedMinimum, options.outline, options.maximumArea);
  }
  assertPlannerOutline(outline);
  const statistics: PlannerSearchStatistics = { seed: variant, evaluationLimit: options.maxEvaluations ?? 50_000,
    evaluations: 0, acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline, profile, strategy,
    resumedFromArea: options.seed ? options.seed.width * options.seed.height : undefined, coolingEvaluations: options.coolingEvaluations,
    maximumArea: options.maximumArea };
  readEvaluations = () => statistics.evaluations;
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
  try {
    const placement = new PlannerPlacement(registry, Math.max(1, outline.width - 2), 1, 1, profile.initialClearance, 1);
    placement.maximumX = outline.width;
    let startups: ReturnType<typeof preparePlantStartups> = [];
    update("layout", "正在安排设备与环境设施");
    if (!restored) {
    await placeProduction(registry, network, placement, variant, checkBudget, environmentLimits);
    const redundant = redundantEnvironmentStations(network);
    if (redundant.length) {
      placement.remove(redundant);
      network.nodes.splice(0, network.nodes.length, ...network.nodes.filter(node => !redundant.includes(node)));
    }
    const processedEnvironments = new Set<string>();
    for (;;) {
      checkBudget();
      const added = network.nodes.filter((node) => node.purpose === "environment" && !processedEnvironments.has(node.entity.id));
      if (!added.length) break;
      for (const environment of added) {
        processedEnvironments.add(environment.entity.id);
        for (const input of environment.inputs) {
          const deficit = -(materialBalance(network).get(input.itemId) ?? 0);
          if (deficit > 1e-6) supplyAuxiliaryDemand(registry, network, input.itemId, deficit);
        }
      }
      await placeProduction(registry, network, placement, variant, checkBudget, environmentLimits);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    // AI-REMOVED 2026-09-16: 初排供电由后面的候选覆盖计算替代。
    // Reason: 不能把初排的桩数固定为搜索约束。Trigger: 赤铜矿覆盖缺口。
    // Evidence: 1789569174504-774676。Replacement: 布线前 placePower。
    // 订正 2026-09-16：最终实现在布线后补桩，避免桩位占用物流通道。
    // Risk: Low。Human Review: Required。
    // Original code: await placePower(registry, network, placement, checkBudget);
    startups = preparePlantStartups(registry, network, placement);
    prepareConverterStartups(registry, network, placement, planConverterSupply(registry, network, variant));
    addTerminals(registry, network, placement, profile.separateOperatingSupply === 1, profile.fluidGroupSize,
      strategy === "compact", options.stashPackingVariant, options.conduitTopology);
    }
    const boundary = new PlannerBoundary(registry, network, outline);
    if (!restored) boundary.arrange(variant);
    else for (const entry of boundary.entries) {
      const node = network.nodes[entry.index]!, pose = { ...node.entity.position, rotation: node.entity.rotation };
      boundary.snap(entry.index, pose);
      node.entity.position = { x: pose.x, y: pose.y }; node.entity.rotation = pose.rotation;
    }
    checkBudget();
    // AI-REMOVED 2026-10-02:
    // Reason: 共享准入口可能使当前有限布局预算无法布通；既有 baseline 重排应探索逐消费者限速拓扑。
    // Trigger: 赤铜矿外供候选在共享入口拓扑下用尽 50,000 次提案，独立限速拓扑通过。
    // Evidence: candidate.test.ts 的同输入隔离对照。
    // Replacement: 下方按搜索策略选择共享入口或逐消费者限速。
    // Risk: 回退拓扑增加准入口及缓冲占地。Human Review: Required
    // Original code:
    // const wires = restored?.wires ?? await wireProductionNetwork(registry, network, placement, checkBudget, strategy === "compact");
    let wires = restored?.wires ?? await wireProductionNetwork(registry, network, placement, checkBudget,
      strategy === "compact", strategy !== "baseline", options.conduitTopology === "trunk");
    connectPlantStartups(registry, startups, wires);
    statistics.wireCount = wires.length;
    statistics.bestRoutedWireCount = 0;
    // AI-REMOVED 2026-09-16: 初排供电由后面的候选覆盖计算替代。
    // Reason: 不能把初排的桩数固定为搜索约束。Trigger: 赤铜矿覆盖缺口。
    // Evidence: 1789569174504-774676。Replacement: 布线前 placePower。
    // 订正 2026-09-16：最终实现在布线后补桩，避免桩位占用物流通道。
    // Risk: Low。Human Review: Required。
    // Original code: await placePower(registry, network, placement, checkBudget);
    // AI-CORRECTION 2026-10-02: 显式调度盒子也是硬约束，不得由固定设施自动扩宽。
  // AI-REMOVED 2026-10-05:
  // Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
  // Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
  // Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
  // Replacement: boundary.ts；本次候选始终使用预先选定的包围盒。
  // Risk: 旧搜索种子失效，按算法版本重置。
  // Human Review: Required
  // Original code:
  //   if (options.outline === undefined && !options.seed && !options.targetOutline) for (const node of network.nodes.filter(node => node.purpose === "bus" || node.external
  //     || node.definition.id === "unloader_1" || node.definition.id === "loader_1")) {
  //     const rect = resolveEntityGridRect({ entity: node.entity, definition: node.definition });
  //     outline.width = Math.max(outline.width, rect.x + rect.width); outline.height = Math.max(outline.height, rect.y + rect.height);
  //   }
  //   // 2026-09-30：新增固定存取口后可能撑大初始盒子；按实际固定边界重新选形状，不能突破全局面积上限。
    const currentFixedMinimum = fixedOutlineMinimum(registry, network.nodes);
    if (options.targetOutline && (outline.width < currentFixedMinimum.width || outline.height < currentFixedMinimum.height
      || (options.maximumArea !== undefined && outline.width * outline.height > options.maximumArea))) {
      throw new PlannerCandidateError("指定搜索盒子无法容纳固定设施或超过面积上限。", statistics);
    }
    if (options.maximumArea !== undefined && outline.width * outline.height > options.maximumArea) {
      // AI-REMOVED 2026-10-02:
      // Reason: 固定设施边界改为共享实现，派发与生成使用同一规则。
      // Trigger: 多尺寸并行批次。Evidence: 两处 reduce 原先重复计算。
      // Replacement: currentFixedMinimum；Risk: Low；Human Review: Required。
      // Original code:
      // const minimum = network.nodes.filter(node => node.purpose === "bus" || node.external
      //   || node.definition.id === "unloader_1" || node.definition.id === "loader_1").reduce((bounds, node) => {
      //   const rect = resolveEntityGridRect({ entity: node.entity, definition: node.definition });
      //   return { width: Math.max(bounds.width, rect.x + rect.width), height: Math.max(bounds.height, rect.y + rect.height) };
      // }, { width: 1, height: 1 });
      const minimum = currentFixedMinimum;
      Object.assign(outline, continuationOutline(outline, variant, Math.floor(variant / 4) + 2, minimum, options.outline, options.maximumArea));
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
    if (strategy === "compact" && !restored && statistics.evaluationLimit >= 3000) {
      const limit = Math.min(8000, Math.floor(statistics.evaluationLimit * 0.4));
      const poses = constructCompactLayout(registry, network, wires, outline, variant, () => {
        checkBudget();
        if (statistics.evaluations >= limit) return false;
        statistics.evaluations++; return true;
      });
      statistics.constructiveEvaluations = statistics.evaluations;
      statistics.constructivePlaced = poses !== null;
      if (poses) network.nodes.forEach((node, index) => { node.entity.position = { x: poses[index]!.x, y: poses[index]!.y }; node.entity.rotation = poses[index]!.rotation; });
    }
    const search = new CompactLayoutSearch(registry, network, wires, statistics, profile, layoutBackend);
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
      }, 0) + (restored ? network.nodes.filter(node => node.entity.id.startsWith("eda-startup-admission-")
        && wires.some(wire => wire.source.entityId === node.entity.id && group.nodeIds.includes(wire.target.entityId)))
        .reduce((sum, node) => sum + Object.values(node.entity.config).reduce<number>((total, rule) => total
          + (rule && typeof rule === "object" && "limit" in rule && typeof rule.limit === "number" ? rule.limit : 0), 0), 0) : 0);
      const processing = nodes.reduce((sum, node) => sum + (node.recipe?.durationSeconds ?? 0)
        * edges.reduce((rate, index) => rate + (wires[index]!.target.entityId === node.entity.id ? wires[index]!.perMinute : 0), 0) / 60, 0);
      return [{ edges, inventory: preload + admitted, processing }];
    });
    let fixtures: WorldEntity[] = [];
    let external = network.nodes.filter(node => node.external);
    let router: PlannerRouter | null = null;
    let powerNodes: PlannerNode[] = [];
    const travelSeconds: number[] = [];
    let failure = "当前预算内尚未找到符合边界的合法布局";
    let reusableRoutes = options.seed?.routes ?? [];
    let inspectSeed = restored !== undefined;
    // GPU 批内的其他候选已经扣过次数，即使预算用尽也要完成其有界布线验收。
    while (statistics.evaluations < statistics.evaluationLimit || search.hasPendingLayouts) {
      update("optimization", "正在优化布局");
      enterPhase("layout");
      // 缩边可能只切掉空地或旧线路；先检验已有摆位，避免在首次复用前随机扰动已验证结构。
      const feasible = await search.advance(inspectSeed ? 0 : Math.min(layoutBackend ? 20_000 : 750, statistics.evaluationLimit - statistics.evaluations), checkBudget);
      inspectSeed = false;
      if (diagnostics) { diagnostics.layoutChecks++; if (feasible) diagnostics.feasibleLayouts++; }
      if (!feasible) continue;
      search.applyBest();
      enterPhase("routing");
      fixtures = [];
      for (const node of network.nodes.filter(entry => entry.definition.id === "storager_1" && (entry.purpose === "product" || entry.purpose === "byproduct"))) {
        // AI-REMOVED 2026-09-30:
        // Reason: 单排空线不足以验收多线合箱。Trigger: 分离芯 60/min 合箱需求。
        // Evidence: 单线额定 30/min，小于箱接收速率。Replacement: getPlannerStashDrainPorts。
        // Risk: 需长窗口验收。Human Review: Required。
        // Original code: const output = getPlannerPorts(registry, node.entity, node.definition, "output", node.inputs[0]!.itemId)[0]!;
        for (const output of getPlannerStashDrainPorts(registry, node)) {
          // 验证中持续清空成品容器；夹具不进入交付蓝图，实际放置后由用户取走成品。
          const sink = createPlainNode(registry, "cheat_infinite_solid", `eda-validation-sink-${fixtures.length}`, "logistics");
          const drain: WorldEntity = { id: `eda-validation-drain-${fixtures.length}`,
            ...resolveTransportPose(registry, output.kind, opposite(output.edge), output.edge), position: output.outside, config: {}, tags: [] };
          sink.entity.position = { x: output.outside.x * 2 - output.cell.x, y: output.outside.y * 2 - output.cell.y };
          fixtures.push(drain, sink.entity);
        }
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
            minimumX: 0,
            minimumY: 0,
            maximumX: outline.width - 1, maximumY: outline.height - 1, escapeLength: 0, history,
          }, routing);
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
            const cached = retry === 0 ? reusableRoutes.find(route => route.source === wire.source.entityId && route.target === wire.target.entityId
              && route.sourcePort === `${wire.source.entityId}/${wire.source.groupIndex}/${wire.source.portIndex}`
              && route.targetPort === `${wire.target.entityId}/${wire.target.groupIndex}/${wire.target.portIndex}`) : undefined;
            const reused = cached !== undefined && candidateRouter.reuse(wire.source, wire.target, cached.cells, wire.minimumCells);
            const length = reused ? cached!.cells.length : await candidateRouter.connect(wire.source, wire.target, checkBudget, wire.minimumCells);
            if (reused) statistics.reusedRoutes = (statistics.reusedRoutes ?? 0) + 1;
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
          if (strategy === "compact") reusableRoutes = candidateRouter.routes;
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
      update("routing", "正在尝试当前摆位的其他供气关系");
      const adaptive = await routeConverterAlternatives(registry, network, wires, statistics, variant, fixtures, checkBudget,
        async (alternative, connections, routed) => {
          if (circulationLimits.some(limit => limit.processing + limit.edges.reduce((sum, index) => {
            const wire = wires[index]!;
            const route = routed.routes.find(route => route.sourcePort === `${wire.source.entityId}/${wire.source.groupIndex}/${wire.source.portIndex}`
              && route.targetPort === `${wire.target.entityId}/${wire.target.groupIndex}/${wire.target.portIndex}`);
            return sum + (route ? wire.perMinute * (route.cells.length + 1) / transportCapacity(wire.source.kind) : Infinity);
          }, 0) > limit.inventory)) return false;
          auditPlannerSupply(registry, alternative, connections, routed.routes);
          const coverage = await placePower(registry, alternative, connections, [...fixtures, ...routed.entities], outline, checkBudget);
          if (!coverage) return false;
          powerNodes = coverage;
          return true;
        }, routing);
      if (adaptive) {
        network = adaptive.network; wires = adaptive.wires; router = adaptive.router;
        external = network.nodes.filter(node => node.external);
        travelSeconds.splice(0, travelSeconds.length, ...adaptive.travelSeconds);
        statistics.wireCount = wires.length; statistics.bestRoutedWireCount = wires.length;
        break;
      }
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
    // AI-REMOVED 2026-10-09:
    // Reason: 两个规划入口与冷态识别共用实际依赖到达时间，避免全网串联估时。
    // Trigger: 同摆位重建及按根启动需求。
    // Evidence: 原图全网累加等待远大于实际最长依赖路径。
    // Replacement: support.ts converterStartupTimes，保留原 SCC 时序公式。
    // Risk: 仍须 Dense 检查有限库存；Human Review: Required。
    // Original code:
    // const graph = buildLayoutGraph(network.nodes.map((node) => node.entity.id), wires.map((wire) => ({ from: wire.source.entityId, to: wire.target.entityId })));
    // const arrival = graph.groups.map(() => 0);
    // for (const { group, index } of graph.groups.map((group, index) => ({ group, index })).sort((a, b) => a.group.rank - b.group.rank)) {
    // const processing = network.nodes.filter((node) => group.nodeIds.includes(node.entity.id)).reduce((sum, node) => sum + (node.recipe?.durationSeconds ?? 0), 0);
    // const cycleTravel = wires.reduce((sum, wire, wireIndex) => sum + (graph.groupIndexByNodeId.get(wire.source.entityId) === index
    // && graph.groupIndexByNodeId.get(wire.target.entityId) === index ? travelSeconds[wireIndex]! : 0), 0);
    // arrival[index] = arrival[index]! + processing + cycleTravel;
    // wires.forEach((wire, wireIndex) => {
    // if (graph.groupIndexByNodeId.get(wire.source.entityId) !== index) return;
    // const target = graph.groupIndexByNodeId.get(wire.target.entityId)!;
    // if (target !== index) arrival[target] = Math.max(arrival[target]!, arrival[index]! + travelSeconds[wireIndex]! + 10);
    // });
    // }
    const arrival = converterStartupTimes(network, wires, travelSeconds);
    const entities = [...network.nodes.map((node) => node.entity), ...router.entities];
    configureConverterStartupInventory(network, id => arrival.get(id)!);
    const scheduledSlots = scheduleConverterStartups(registry, network, id => arrival.get(id)!, wires);
  // AI-REMOVED 2026-10-05:
  // Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
  // Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
  // Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
  // Replacement: 当前候选 outline；只允许换盒重新布局，不再按实体裁剪边界。
  // Risk: 旧搜索种子失效，按算法版本重置。
  // Human Review: Required
  // Original code:
  //   const rects = entities.map((entity) => resolveEntityGridRect({ entity, definition: registry.queries.findEntityDefinition(entity.definitionId)! }));
  //   const left = Math.min(...rects.map((rect) => rect.x)), top = Math.min(...rects.map((rect) => rect.y));
  //   const width = Math.max(...rects.map((rect) => rect.x + rect.width)) - left;
  //   const height = Math.max(...rects.map((rect) => rect.y + rect.height)) - top;
  //   const seed = capturePlannerSeed(request, network, wires, router.routes, width, height, { x: left, y: top });
  //   for (const entity of [...entities, ...fixtures]) entity.position = { x: entity.position.x - left, y: entity.position.y - top };
    assertPlannerOutline(outline);
    const { width, height } = outline;
    const finalBoundary = new PlannerBoundary(registry, network, outline);
    const boundaryResult = finalBoundary.resolve(network.nodes.map(node => ({ ...node.entity.position, rotation: node.entity.rotation })));
    if (boundaryResult.violations || boundaryResult.busMask === null) throw new PlannerCandidateError("最终布局违反边界接入约束。", statistics);
    fixtures.push(...finalBoundary.fixtures(boundaryResult.busMask));
    const seed = capturePlannerSeed(request, network, wires, router.routes, width, height);
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
    const busSides = ["上", "右", "下", "左"].filter((_, side) => boundaryResult.busMask! & (1 << side));
    const blueprint = createBlueprintDocument({
      name: request.plan.name.trim() || targetDescription, baseId: request.plan.sourceBaseId,
      initialGridPoint: { x: 0, y: 0 }, entityOrder: entities.map((entity) => entity.id),
      entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])), slotLinks: network.slotLinks,
      description: `自动规划产线（EDA）\n目标：${targetDescription}\n范围：${width} × ${height}\n存取线：${({ straight: "直线", corner: "直角", "u-shaped": "U型" })[request.options.warehouseBus]}；${busSides.length ? `请在包围盒外${busSides.join("、")}侧自行放置` : "无需接入"}\n供电：外部供电，已布置供电桩${network.nodes.some((node) => node.definition.id === "seedcol_1") ? `\n植物循环启动：${request.options.plantStartup === "preload" ? "采种机预置 50 个物品" : "仓库通过准入口提供 29 个物品"}` : ""}`,
    });
    const result: PlannerCandidate = {
      metrics, connections, search: statistics, supplyAudit, seed,
      execution: {
        blueprint,
        scene: { externalEntities: fixtures, externalSlotLinks: [], initialSlots: network.initialSlots, scheduledSlots, powerMode: "infinite" },
        probes: [...request.plan.targets.map((flow) => ({
          id: flow.itemId, itemId: flow.itemId, direction: "input" as const,
          entityIds: network.nodes.filter((node) => node.purpose === "product" && node.inputs.some((input) => input.itemId === flow.itemId)).map((node) => node.entity.id),
        })), ...supplyAudit.operatingLimits.map(limit => ({ id: `operating:${limit.entityId}`, itemId: limit.itemId,
          direction: "output" as const, entityIds: [limit.entityId] })), ...(supplyAudit.startupProduction ?? []).map(limit => ({
          id: `startup:${limit.entityId}`, itemId: limit.itemId, direction: "output" as const, entityIds: [limit.entityId],
        })), ...(supplyAudit.startupStorage ?? []).flatMap(storage => (["input", "output"] as const).map(direction => ({
          id: `startup-storage:${direction}:${storage.entityId}`, itemId: storage.itemId, direction, entityIds: [storage.entityId],
        })))],
        warmupSeconds: Math.max(180, Math.ceil(Math.max(...arrival.values()) * 3)),
        observationSeconds: 120, inventorySampleCount: 9, maxWallTimeMs: 120_000,
        activeActivityIds: request.plan.activeActivityIds,
      },
    };
    enterPhase("finalization");
    assertPlannerCandidateBounds(registry, result);
    return result;
  } catch (error) {
    // 边界安排等准备阶段也可能没有可行几何；保留精确的零计数，让上层在原预算内扩框重排。
    if (error instanceof PlannerCandidateError && !error.search) {
      enterPhase("finalization");
      throw new PlannerCandidateError(error.message, statistics);
    }
    throw error;
  }
}
