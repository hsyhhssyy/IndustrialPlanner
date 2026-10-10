import { restorePlannerOutputRequest, MAX_PLANNER_OUTPUT_MODES, plannerOutputModeKey, resolvePlannerOutputAttempt } from "./output-policy";
import type { BlueprintPlannerRequest, BlueprintPlannerResult, BlueprintPlannerTaskFile, BlueprintPlannerOptions } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { SimulationBlueprintRunReport, SimulationBlueprintRunRequest } from "@/domain/simulation";
import { BLUEPRINT_SCHEMA_VERSION } from "@/domain/document/blueprint-document";
import type { PlannerCandidate } from "./candidate";
import { validatePlannerRequest } from "./production-network";
import { PlannerSearchPortfolio, type PlannerPortfolioSnapshot } from "./search-portfolio";
import { isBlueprintRecognitionRequest } from "@/shared/planner-task";
import { plannerRequestKey } from "./search-seed";
import { comparePlannerRanks } from "./quality";
import { restorePlannerSeed } from "./search-seed";
import { migratePlannerCandidate } from "./task-migration";
import { assertPlannerCandidateBounds, meetsOperatingLimits, meetsProductionTargets } from "./verification";
import { assertBlueprintPreserved } from "./blueprint-constraints";
import { withBlueprintConverterStartup } from "./blueprint-startup";
import { excludeDisconnectedBlueprintPipes } from "./blueprint-disconnections";
import { assertBlueprintRecognition, assertBlueprintSteadyState } from "./blueprint-analysis";
import { blueprintRecognitionScene } from "./blueprint-scene";
import { identifyBlueprintNetwork } from "./blueprint-network";
import { assertPlannerDimensionSchedule, partitionPlannerDimensions, PLANNER_SHARD_COUNT,
  type PlannerDimension, type PlannerDimensionSchedule } from "./dimension-schedule";

// AI-REMOVED 2026-10-02:
// Reason: 多尺寸批次增加持久化访问记录，旧检查点需要显式迁移。
// Trigger: 用户要求长宽比例广度和多 Worker 避免重复搜索。
// Evidence: compact-portfolio-2 分片仅保存 nextVariant 和局部种子池。
// Replacement: compact-breadth-1 与 restorePlannerTaskFile 迁移；Risk: 旧任务无历史尺寸访问记录；Human Review: Required。
// Original code:
// export const PLANNER_ALGORITHM_VERSION = "compact-portfolio-2";
export const PLANNER_ALGORITHM_VERSION = "dimension-shards-1";

export interface PlannerShardCheckpoint {
  index: number;
  nextVariant: number;
  attempts: number;
  evaluations: number;
  validatedCandidates: number;
  portfolio: PlannerPortfolioSnapshot;
  pendingCandidate: PlannerCandidate | null;
  shapeVisits: Record<string, number>;
  /** 各尺寸已结算的真实提案数；旧记录未采集时缺省，不把派发次数冒充提案数。 */
  shapeEvaluations?: Record<string, number>;
  /** 尺寸访问次数所属的全局最优目标；旧任务缺省时在下次运行同步，累计计数保留。 */
  // AI-CORRECTION 2026-10-10：searchTarget 仅标识种子目标；尺寸访问和实际提案历史跨目标保留。
  searchTarget?: string;
  /** 尺寸唯一归属及跨领取轮转位置；旧算法恢复后首次运行生成，不能由访问次数推算。 */
  dimensions?: PlannerDimension[];
  dimensionCursor?: number;
}

export interface PlannerParallelCheckpoint {
  count: number;
  originTaskId: string;
  baseAttempt: number;
  baseVariant?: number;
  baseEvaluations: number;
  baseValidatedCandidates: number;
  ownedShards: number[];
  shards: PlannerShardCheckpoint[];
  requestKey: string;
  nextShard: number;
  dimensionSchedule?: PlannerDimensionSchedule;
}

export interface PlannerCheckpoint {
  readonly blueprintBaseline?: { readonly candidate: PlannerCandidate; readonly report: SimulationBlueprintRunReport };
  attempt: number;
  evaluations: number;
  portfolio: PlannerPortfolioSnapshot;
  best: { candidate: PlannerCandidate; report: SimulationBlueprintRunReport } | null;
  pendingCandidate: PlannerCandidate | null;
  result: BlueprintPlannerResult | null;
  savedBlueprintId: string | null;
  /** 新规则生效前的历史点数量；此后的曲线才与当前最优结果比较。 */
  legacyHistoryLength?: number;
  parallel?: PlannerParallelCheckpoint;
}

export function emptyPlannerCheckpoint(): PlannerCheckpoint {
  return { attempt: 0, evaluations: 0, portfolio: { pools: [] }, best: null, pendingCandidate: null,
    result: null, savedBlueprintId: null };
}

/** 2026-09-30：仅明确支持的旧算法允许保留输入、重置搜索；不猜测未知版本顺序。 */
// AI-CORRECTION 2026-10-06：保留历史计数和曲线，最优蓝图按盒外存取线规则重算并重新验收，只重建搜索内部状态。
import { migrateTaskBlueprintSchemas } from "./task-blueprint-migration";

export async function restorePlannerTaskFile(value: BlueprintPlannerTaskFile, registry: RegistryContract,
  verify?: (execution: SimulationBlueprintRunRequest) => Promise<SimulationBlueprintRunReport>,
): Promise<BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest; checkpoint: PlannerCheckpoint }> {
  value = migrateTaskBlueprintSchemas(value);
  // 仅调度规则升级：保留结果、计数、历史和旧种子池，首次运行时创建尺寸清单。
  if (value.algorithmVersion === "external-boundary-1") value = { ...value, algorithmVersion: PLANNER_ALGORITHM_VERSION };
  if (value?.request && !isBlueprintRecognitionRequest(value.request) && value.request.blueprintSource) {
    const file = parsePlannerTaskFile(value, registry);
    if (!verify) return file;
    const source = file.request.blueprintSource!;
    const scene = blueprintRecognitionScene(registry, source);
    const analysis = file.checkpoint.blueprintBaseline!.report.analysis;
    const execution = analysis ? withBlueprintConverterStartup(registry, source, file.request.options, analysis, scene) : scene;
    const report = await verify(execution);
    const baseline = identifyBlueprintNetwork(registry, source, file.request.options, execution, report);
    const seedContents = (candidate: PlannerCandidate) => JSON.stringify({ ...candidate.seed,
      network: { ...candidate.seed!.network, request: null } });
    if (JSON.stringify(baseline.request.plan) !== JSON.stringify(file.request.plan)
      || seedContents(baseline.candidate) !== seedContents(file.checkpoint.blueprintBaseline!.candidate)) {
      throw new Error("原图识别基线与任务不一致，请重新识别蓝图。");
    }
    const best = file.checkpoint.best;
    if (best && JSON.stringify(best.candidate.execution.blueprint) !== JSON.stringify(execution.blueprint)) {
      const base = blueprintRecognitionScene(registry, source, best.candidate.execution.blueprint);
      const request = { ...base, probes: best.candidate.execution.probes, warmupSeconds: best.candidate.execution.warmupSeconds,
        scene: { ...base.scene, scheduledSlots: best.candidate.execution.scene.scheduledSlots } };
      const measured = await verify(request);
      assertBlueprintRecognition(registry, { ...source, blueprint: request.blueprint }, measured);
      assertBlueprintSteadyState(registry, measured, request.probes);
      if (!meetsProductionTargets(file.request, measured) || !meetsOperatingLimits(best.candidate.supplyAudit, measured)) {
        throw new Error("恢复的最优蓝图未通过原产率及循环供料验收。");
      }
    }
    return file;
  }
// AI-REMOVED 2026-10-05:
// Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// Replacement: restorePlannerTaskFile：保留输入、重置旧面积与口位状态。
// Risk: 旧搜索种子失效，按算法版本重置。
// Human Review: Required
// Original code:
//   if (value?.formatVersion === 1 && value.algorithmVersion === "compact-portfolio-2") {
//     const file = structuredClone(value) as BlueprintPlannerTaskFile & { checkpoint: PlannerCheckpoint };
//     if (file.checkpoint?.parallel) file.checkpoint.parallel = { ...file.checkpoint.parallel, nextShard: 0,
//       shards: file.checkpoint.parallel.shards.map(shard => ({ ...shard, shapeVisits: {} })) };
//     return parsePlannerTaskFile({ ...file, algorithmVersion: PLANNER_ALGORITHM_VERSION }, registry);
//   }
//   if (value?.formatVersion !== 1 || value.algorithmVersion !== "compact-portfolio-1") return parsePlannerTaskFile(value, registry);
//   validateTaskRequest(registry, value.request);
//   return parsePlannerTaskFile({ ...value, algorithmVersion: PLANNER_ALGORITHM_VERSION,
//     checkpoint: emptyPlannerCheckpoint(), progress: { taskId: value.taskId, status: "waiting", phase: "preparing",
//       startedAt: value.progress?.startedAt, elapsedMs: 0, estimatedProgress: null, candidateCount: 0,
//       evaluatedProposals: 0, roundEvaluatedProposals: 0, validatedCandidateCount: 0, bestArea: null, areaHistory: [],
//       message: "算法已更新，旧计算进度已重置，请重新开始计算。" } }, registry);
  if (value?.formatVersion !== 1 || !["compact-portfolio-1", "compact-portfolio-2", "compact-breadth-1"].includes(value.algorithmVersion)) {
    return parsePlannerTaskFile(value, registry);
  }
  const file = structuredClone(value) as BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest; checkpoint: PlannerCheckpoint };
  if ((file.request.options.warehouseBus as string) === "free") Object.assign(file.request.options, { warehouseBus: "corner" });
  validateTaskRequest(registry, file.request);
  // AI-REMOVED 2026-10-06:
  // Reason: 全量重置会丢失仍可用的最优蓝图、累计计算量和历史曲线。
  // Trigger: 用户要求保留历史计算进度，只重算最后一个面积点。
  // Evidence: 原恢复分支始终使用 emptyPlannerCheckpoint 并清空 areaHistory。
  // Replacement: 下方保留历史并重验最优候选的迁移。
  // Risk: 旧图重新验收增加一次仿真耗时；Human Review: Required
  // Original code:
  // return parsePlannerTaskFile({ ...file, algorithmVersion: PLANNER_ALGORITHM_VERSION,
  //   checkpoint: emptyPlannerCheckpoint(), progress: { taskId: file.taskId, status: "waiting", phase: "preparing",
  //     startedAt: file.progress?.startedAt, elapsedMs: 0, estimatedProgress: null, candidateCount: 0,
  //     evaluatedProposals: 0, roundEvaluatedProposals: 0, validatedCandidateCount: 0, bestArea: null, areaHistory: [],
  //     message: "存取线已改为包围盒外接入，面积规则已更新；旧计算进度已重置，请重新开始计算。" } }, registry);
  const history = file.progress.areaHistory ?? [];
  const restored = parsePlannerTaskFile({ ...file, algorithmVersion: PLANNER_ALGORITHM_VERSION,
    checkpoint: { ...emptyPlannerCheckpoint(), attempt: file.checkpoint?.attempt ?? file.progress.candidateCount,
      evaluations: file.checkpoint?.evaluations ?? file.progress.evaluatedProposals, legacyHistoryLength: history.length },
    progress: { ...file.progress, status: "waiting", phase: "preparing", estimatedProgress: null, activeWorkerCount: 0,
      bestArea: null, areaHistory: history, message: "历史计算进度已保留，可以继续计算。" } }, registry);
  if (!file.checkpoint?.best) return restored;
  const candidate = migratePlannerCandidate(registry, file.request, file.checkpoint.best.candidate);
  if (candidate === null) return { ...restored, progress: { ...restored.progress,
    message: "历史计算进度和曲线已保留；旧最优蓝图不满足当前边界规则，将继续搜索有效布局。" } };
  if (!verify) throw new Error("旧最优蓝图需要仿真验收后才能恢复，请通过规划器导入任务。");
  assertPlannerCandidateBounds(registry, candidate);
  const report = await verify(candidate.execution);
  // 超时、取消和服务异常不能判定布局无效，也不能自动覆盖原始任务。
  if (report.status !== "completed") throw new Error("旧最优蓝图验收未完成，原始计算记录已保留。");
  if (!meetsProductionTargets(file.request, report) || !meetsOperatingLimits(candidate.supplyAudit, report)) {
    return { ...restored, progress: { ...restored.progress,
      message: "历史计算进度和曲线已保留；旧最优蓝图未通过当前产量验收，将继续搜索有效布局。" } };
  }
  const portfolio = new PlannerSearchPortfolio(file.request, candidate.seed);
  const checkpoint: PlannerCheckpoint = { ...restored.checkpoint, best: { candidate, report }, portfolio: portfolio.snapshot(),
    legacyHistoryLength: Math.max(0, history.length - 1), result: {
      taskId: file.taskId, blueprint: candidate.execution.blueprint, folderId: null, metrics: candidate.metrics,
      connections: candidate.connections, measuredOutputs: report.probes.filter(probe => file.request.plan.targets.some(target => target.itemId === probe.id))
        .map(probe => ({ itemId: probe.id, perMinute: probe.perMinute })), warmupSeconds: candidate.execution.warmupSeconds,
      observationSeconds: report.observationSeconds, elapsedMs: restored.progress.elapsedMs } };
  return parsePlannerTaskFile({ ...restored, checkpoint, progress: { ...restored.progress, bestArea: candidate.metrics.area,
    areaHistory: history.length ? history.map((point, index) => index === history.length - 1 ? { ...point, bestArea: candidate.metrics.area } : point)
      : [{ evaluatedProposals: checkpoint.evaluations, bestArea: candidate.metrics.area }],
    message: "历史计算进度和曲线已保留；最后一个面积点已按当前规则重算，最优蓝图可继续优化。" } }, registry);
}

/** JSON 边界验证失败时拒绝导入，不能悄悄丢弃检查点后从头计算。 */
export function parsePlannerTaskFile(value: unknown, registry: RegistryContract): BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest; checkpoint: PlannerCheckpoint } {
  try {
    const file = structuredClone(value) as BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest; checkpoint: PlannerCheckpoint };
    if (file?.formatVersion !== 1 || file.algorithmVersion !== PLANNER_ALGORITHM_VERSION) throw new Error("任务格式或算法版本不兼容。");
    if (typeof file.taskId !== "string" || !file.taskId || file.taskId.length > 200) throw new Error("任务编号无效。");
    assertJson(file);
    const { request, checkpoint: point, progress } = file;
    validateTaskRequest(registry, request);
    const outputModes = new Set(Array.from({ length: MAX_PLANNER_OUTPUT_MODES }, (_, variant) =>
      plannerOutputModeKey(resolvePlannerOutputAttempt(request, variant).request.options)));
    if (!point || !progress || progress.taskId !== file.taskId) throw new Error("任务缺少检查点或进度。");
    for (const count of [point.attempt, point.evaluations, progress.candidateCount, progress.validatedCandidateCount]) {
      if (!Number.isSafeInteger(count) || count < 0) throw new Error("任务计数无效。");
    }
    // 旧任务未暴露提案进度；以已持久化检查点恢复累计，旧本轮无记录则归零。
    const evaluatedProposals = progress.evaluatedProposals ?? point.evaluations;
    const roundEvaluatedProposals = progress.roundEvaluatedProposals ?? 0;
    if (evaluatedProposals !== point.evaluations || !Number.isSafeInteger(roundEvaluatedProposals)
      || roundEvaluatedProposals < 0 || roundEvaluatedProposals > evaluatedProposals
      || roundEvaluatedProposals > request.options.evaluationsPerRound) throw new Error("尝试计数无效。");
    if (!Number.isFinite(progress.elapsedMs) || progress.elapsedMs < 0 || !Number.isFinite(progress.startedAt)
      || point.attempt !== progress.candidateCount || progress.validatedCandidateCount > point.attempt
      || !["running", "waiting", "saving", "completed", "cancelled", "failed", "save-failed"].includes(progress.status)) throw new Error("任务进度无效。");
    if (!Array.isArray(point.portfolio?.pools) || point.portfolio.pools.length > MAX_PLANNER_OUTPUT_MODES) throw new Error("搜索池无效。");
    const portfolio = new PlannerSearchPortfolio(request);
    portfolio.restore(point.portfolio);
// AI-REMOVED 2026-10-03:
// Reason: 自动去向改为逐物品组合，检查点需要保留每种组合。
// Trigger: 用户要求精确配置物品。
// Evidence: 原搜索和恢复只读取全局 solidOutput。
// Replacement: restorePlannerOutputRequest
// Risk: 种子池上限增为 64 种组合。
// Human Review: Required
// Original code:
//     const seedRequest = (mode: BlueprintPlannerRequest["options"]["solidOutput"]) => request.options.solidOutput === "auto"
//       ? { ...request, options: { ...request.options, solidOutput: mode } } : request;

    for (const pool of point.portfolio.pools) for (const entry of pool.entries) {
      validateTaskRequest(registry, entry.seed.network.request);
      restorePlannerSeed(registry, restorePlannerOutputRequest(request, entry.seed.network.request.options), entry.seed);
    }
    if (request.blueprintSource) {
      const baseline = point.blueprintBaseline;
      if (!baseline?.candidate.seed || baseline.report.status !== "completed"
        || JSON.stringify(baseline.candidate.execution.blueprint) !== JSON.stringify(excludeDisconnectedBlueprintPipes(registry, request.blueprintSource).input.blueprint)) throw new Error("蓝图任务缺少原图识别基线。");
      const identified = identifyBlueprintNetwork(registry, request.blueprintSource, request.options, baseline.candidate.execution, baseline.report);
      if (JSON.stringify(identified.request.plan) !== JSON.stringify(request.plan)
        || baseline.candidate.seed.requestKey !== plannerRequestKey(request)) throw new Error("蓝图任务产率基线或输入配置不一致。");
    }
    for (const candidate of [point.blueprintBaseline?.candidate ?? null, point.best?.candidate ?? null, point.pendingCandidate]) {
      if (candidate === null) continue;
      if (!candidate?.execution?.blueprint || candidate.execution.blueprint.schemaVersion !== BLUEPRINT_SCHEMA_VERSION
        || !Array.isArray(candidate.execution.blueprint.entityOrder) || !Array.isArray(candidate.connections)
        || !Array.isArray(candidate.supplyAudit?.operatingLimits) || !Number.isSafeInteger(candidate.search?.evaluations)
        || candidate.search.evaluations < 0 || !Number.isFinite(candidate.metrics?.area) || candidate.metrics.area <= 0) throw new Error("候选蓝图无效。");
      for (const id of candidate.execution.blueprint.entityOrder) {
        const entity = candidate.execution.blueprint.entities[id];
        if (!entity || registry.queries.findEntityDefinition(entity.definitionId) === null
          || !Number.isFinite(entity.position.x) || !Number.isFinite(entity.position.y)) throw new Error("候选蓝图包含无效设备。");
      }
      assertPlannerCandidateBounds(registry, candidate);
      if (candidate.seed) restorePlannerSeed(registry, restorePlannerOutputRequest(request, candidate.seed.network.request.options), candidate.seed);
      if (request.blueprintSource) assertBlueprintPreserved(registry, request, point.blueprintBaseline!.candidate.seed!, candidate.execution.blueprint, candidate.seed);
    }
    if (point.best !== null && (!Array.isArray(point.best.report?.probes) || point.best.report.status !== "completed")) throw new Error("最优结果缺少验证报告。");
    if (point.result !== null && (point.result.taskId !== file.taskId || !point.best
      || point.result.blueprint.blueprintId !== point.best.candidate.execution.blueprint.blueprintId)) throw new Error("结果与检查点不匹配。");
    if (point.result && point.best) assertPlannerCandidateBounds(registry, { ...point.best.candidate,
      execution: { ...point.best.candidate.execution, blueprint: point.result.blueprint }, metrics: point.result.metrics });
    if (point.savedBlueprintId !== null && typeof point.savedBlueprintId !== "string") throw new Error("保存记录无效。");
    const history = progress.areaHistory ?? [];
    const legacyHistoryLength = point.legacyHistoryLength ?? 0;
    if (!Number.isSafeInteger(legacyHistoryLength) || legacyHistoryLength < 0 || legacyHistoryLength > history.length) throw new Error("历史曲线边界无效。");
    if (!Array.isArray(history) || history.some((entry, index) => !Number.isSafeInteger(entry.evaluatedProposals)
      || entry.evaluatedProposals < 0 || entry.evaluatedProposals > point.evaluations
      || !Number.isSafeInteger(entry.bestArea) || entry.bestArea <= 0
      || (index > 0 && (entry.evaluatedProposals < history[index - 1]!.evaluatedProposals
        || (index !== legacyHistoryLength && entry.bestArea >= history[index - 1]!.bestArea))))) throw new Error("面积曲线无效。");
    if (history.length > legacyHistoryLength && (point.best === null || history.at(-1)!.bestArea < point.best.candidate.metrics.area)) throw new Error("面积曲线与最优结果不匹配。");
    if (point.parallel) {
      const parallel = point.parallel;
      if (parallel.dimensionSchedule !== undefined) {
        assertPlannerDimensionSchedule(parallel.dimensionSchedule, parallel.shards);
        if (parallel.count !== PLANNER_SHARD_COUNT || point.best
          && parallel.dimensionSchedule.targetArea !== point.best.candidate.metrics.area) throw new Error("尺寸调度与最优面积不一致。");
      } else if (parallel.shards?.some(shard => shard.dimensions !== undefined || shard.dimensionCursor !== undefined)) {
        throw new Error("分片尺寸缺少调度身份。");
      }
      if (!Number.isSafeInteger(parallel.count) || parallel.count < 1 || parallel.count > 32
        || !Number.isSafeInteger(parallel.nextShard) || parallel.nextShard < 0 || parallel.nextShard >= parallel.count
        || parallel.originTaskId.length < 1 || parallel.requestKey !== plannerRequestKey(request)
        || !Number.isSafeInteger(parallel.baseAttempt) || parallel.baseAttempt < 0
        || (parallel.baseVariant !== undefined && (!Number.isSafeInteger(parallel.baseVariant)
          || parallel.baseVariant < parallel.baseAttempt))
        || !Number.isSafeInteger(parallel.baseEvaluations) || parallel.baseEvaluations < 0
        || !Number.isSafeInteger(parallel.baseValidatedCandidates) || parallel.baseValidatedCandidates < 0
        || !Array.isArray(parallel.shards) || parallel.shards.length !== parallel.count
        || !Array.isArray(parallel.ownedShards) || parallel.ownedShards.length < 1
        || parallel.ownedShards.some(index => !Number.isSafeInteger(index) || index < 0 || index >= parallel.count)
        || new Set(parallel.ownedShards).size !== parallel.ownedShards.length
        || parallel.shards.some((shard, index) => shard.index !== index
          || !Number.isSafeInteger(shard.nextVariant) || shard.nextVariant < (parallel.baseVariant ?? parallel.baseAttempt) + index
          || (shard.nextVariant - (parallel.baseVariant ?? parallel.baseAttempt) - index) % parallel.count !== 0
          || !Number.isSafeInteger(shard.attempts) || shard.attempts < 0
          || shard.nextVariant !== (parallel.baseVariant ?? parallel.baseAttempt) + index + shard.attempts * parallel.count
          || !Number.isSafeInteger(shard.evaluations) || shard.evaluations < 0
          || !Number.isSafeInteger(shard.validatedCandidates) || shard.validatedCandidates < 0
          || shard.validatedCandidates > shard.attempts
          || !shard.shapeVisits || typeof shard.shapeVisits !== "object" || Array.isArray(shard.shapeVisits)
          || (shard.searchTarget !== undefined && (typeof shard.searchTarget !== "string"
            || shard.searchTarget.length === 0 || shard.searchTarget.length > 1024))
          || Object.entries(shard.shapeVisits).some(([key, visits]) => (!/^.+\/\d+\/\d+$/.test(key) || !outputModes.has(key.split("/").slice(0, -2).join("/")))
            || !Number.isSafeInteger(visits) || visits < 0)
          || Object.values(shard.shapeVisits).reduce((sum, visits) => sum + visits, 0) > shard.attempts
          || (shard.shapeEvaluations !== undefined && (!shard.shapeEvaluations || typeof shard.shapeEvaluations !== "object"
            || Array.isArray(shard.shapeEvaluations)
            || Object.entries(shard.shapeEvaluations).some(([key, used]) => !(shard.shapeVisits[key]! > 0)
              || !Number.isSafeInteger(used) || used < 0)
            || Object.values(shard.shapeEvaluations).reduce((sum, used) => sum + used, 0) > shard.evaluations))
          || !Array.isArray(shard.portfolio?.pools))) throw new Error("分片检查点无效。");
      if (point.attempt !== parallel.baseAttempt + parallel.shards.reduce((sum, shard) => sum + shard.attempts, 0)
        || point.evaluations !== parallel.baseEvaluations + parallel.shards.reduce((sum, shard) => sum + shard.evaluations, 0)
        || progress.validatedCandidateCount !== parallel.baseValidatedCandidates
          + parallel.shards.reduce((sum, shard) => sum + shard.validatedCandidates, 0)
        || point.pendingCandidate !== null) throw new Error("分片汇总计数无效。");
      for (const shard of parallel.shards) {
        if (shard.pendingCandidate) assertPlannerCandidateBounds(registry, shard.pendingCandidate);
        const pool = new PlannerSearchPortfolio(request);
        pool.restore(shard.portfolio);
        if (shard.pendingCandidate !== null && (!shard.pendingCandidate.execution?.blueprint
          || !Number.isSafeInteger(shard.pendingCandidate.search?.evaluations))) throw new Error("分片候选无效。");
      }
    }
    if (progress.activeWorkerCount !== undefined && (!Number.isSafeInteger(progress.activeWorkerCount)
      || progress.activeWorkerCount < 0 || progress.activeWorkerCount > 32)) throw new Error("并行状态无效。");
    return { ...file, progress: { ...progress, evaluatedProposals, roundEvaluatedProposals, areaHistory: history,
      ...(progress.activeWorkerCount === undefined ? {} : { activeWorkerCount: 0 }) } };
  } catch (error) {
    throw new Error(`无法读取计算任务：${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 识别任务尚无生产计划，参数校验与计划校验分开复用。 */
export function validatePlannerTaskOptions(options: BlueprintPlannerOptions): void {
  if (!options) throw new Error("计算参数无效。");
  if (options.concurrency !== undefined && options.concurrency !== "auto" && (!Number.isSafeInteger(options.concurrency)
    || options.concurrency < 1 || options.concurrency > 32)) throw new Error("并发计算数必须介于 1 到 32。");
  if (options.gpu !== undefined && typeof options.gpu !== "boolean") throw new Error("GPU 辅助计算选项必须为布尔值。");
  for (const key of ["solidSupply", "fluidSupply", "warehouseBus", "solidOutput", "byproducts", "plantStartup"] as const) {
    const choices = { solidSupply: ["external", "warehouse"], fluidSupply: ["external", "conduit"], warehouseBus: ["straight", "corner", "u-shaped"],
      solidOutput: ["auto", "warehouse", "stash"], byproducts: ["destroy", "output"], plantStartup: ["preload", "warehouse"] };
    if (!choices[key].includes(options[key])) throw new Error(`无效的规划选项：${key}`);
  }
  if (!Number.isSafeInteger(options.evaluationsPerRound) || options.evaluationsPerRound < 1000 || options.evaluationsPerRound % 1000 !== 0) throw new Error("每轮计算次数必须是大于零的 1000 整数倍。");
  if (options.converterStartup !== undefined && !["manual", "tank", "reject"].includes(options.converterStartup)) throw new Error("未知转化设备启动方式。");
}

export function validateTaskRequest(registry: RegistryContract, request: BlueprintPlannerRequest): void {
  const { plan, options } = request;
  if (request.blueprintSource) {
    const { blueprint, boundaries, activeActivityIds } = request.blueprintSource;
    if (blueprint.schemaVersion !== BLUEPRINT_SCHEMA_VERSION || !blueprint.entityOrder.length
      || !Array.isArray(boundaries) || !Array.isArray(activeActivityIds)
      || boundaries.some(boundary => !blueprint.entities[boundary.entityId] || !boundary.itemId
        || !registry.queries.findItemDefinition(boundary.itemId) || !["input", "output"].includes(boundary.direction)
        || !["port", "facility"].includes(boundary.kind))) throw new Error("原蓝图或边界配置无效。");
  }
// AI-REMOVED 2026-10-07:
// Reason: 识别和规划任务复用计算参数校验，避免两套规则漂移。
// Trigger: 用户要求识别任务可恢复、自动识别出口与预览联动。
// Evidence: 原实现只在识别成功后建任务，边界必须全部手动补齐。
// Replacement: src/blueprint-planner/task-checkpoint.ts validatePlannerTaskOptions
// Risk: 已保存规划任务保留原有格式和验收；Human Review: Required
// Original code:
//   if (options.concurrency !== undefined && options.concurrency !== "auto" && (!Number.isSafeInteger(options.concurrency)
//     || options.concurrency < 1 || options.concurrency > 32)) throw new Error("并发计算数必须介于 1 到 32。");
//   if (options.gpu !== undefined && typeof options.gpu !== "boolean") throw new Error("GPU 辅助计算选项必须为布尔值。");
//   if (typeof plan.name !== "string" || typeof plan.sourceBaseId !== "string" || typeof plan.containsModules !== "boolean") throw new Error("产线信息无效。");
//   for (const key of ["solidSupply", "fluidSupply", "warehouseBus", "solidOutput", "byproducts", "plantStartup"] as const) {
//     const choices = { solidSupply: ["external", "warehouse"], fluidSupply: ["external", "conduit"], warehouseBus: ["straight", "corner", "u-shaped"],
//       solidOutput: ["auto", "warehouse", "stash"], byproducts: ["destroy", "output"], plantStartup: ["preload", "warehouse"] };
//     if (!choices[key].includes(options[key])) throw new Error(`无效的规划选项：${key}`);
//   }
  validatePlannerTaskOptions(options);
  if (typeof plan.name !== "string" || typeof plan.sourceBaseId !== "string" || typeof plan.containsModules !== "boolean") throw new Error("产线信息无效。");
  for (const list of [plan.targets, plan.externalSupplies, ...plan.recipes.flatMap(recipe => [recipe.inputs, recipe.outputs, recipe.runningInputs])]) {
    if (!Array.isArray(list) || list.some(flow => typeof flow.itemId !== "string" || !Number.isFinite(flow.perMinute) || flow.perMinute < 0)) throw new Error("产线流量无效。");
  }
  for (const list of [plan.infiniteItemIds, plan.byproductItemIds, plan.activeActivityIds]) {
    if (!Array.isArray(list) || list.some(id => typeof id !== "string")) throw new Error("产线标识无效。");
  }
  validatePlannerRequest(registry, request);
}

/** 独立分片的已提交检查点合并；跨机器没有可信的全局事件时钟，只记录合并时的准确总计数。 */
export async function mergePlannerTaskFiles(values: readonly BlueprintPlannerTaskFile[], registry: RegistryContract): Promise<BlueprintPlannerTaskFile> {
  if (values.length < 1) throw new Error("至少提供一个分片任务。");
  const files = [];
  for (const value of values) files.push(await restorePlannerTaskFile(value, registry));
  const first = files[0]!;
  const base = first.checkpoint.parallel;
  if (!base) throw new Error("任务没有分片检查点。");
  const selected = new Map<number, PlannerShardCheckpoint>();
  for (const file of files) {
    const parallel = file.checkpoint.parallel;
    if (!parallel || parallel.count !== base.count || parallel.originTaskId !== base.originTaskId
      || parallel.requestKey !== base.requestKey || parallel.baseAttempt !== base.baseAttempt
      || parallel.baseVariant !== base.baseVariant
      || parallel.baseEvaluations !== base.baseEvaluations
      || parallel.baseValidatedCandidates !== base.baseValidatedCandidates) throw new Error("分片任务不是同一计算起点。");
    for (const index of parallel.ownedShards) {
      if (selected.has(index)) throw new Error(`分片 ${index} 重复，不能合并。`);
      selected.set(index, structuredClone(parallel.shards[index]!));
    }
  }
  if (selected.size !== base.count) throw new Error(`分片不完整：已收到 ${selected.size}/${base.count}。`);
  const shards = Array.from({ length: base.count }, (_, index) => selected.get(index)!);
  const attempt = base.baseAttempt + shards.reduce((sum, shard) => sum + shard.attempts, 0);
  const evaluations = base.baseEvaluations + shards.reduce((sum, shard) => sum + shard.evaluations, 0);
  const ranked = files.filter(file => file.checkpoint.best !== null).sort((a, b) => {
    const candidateA = a.checkpoint.best!.candidate, candidateB = b.checkpoint.best!.candidate;
    return comparePlannerRanks({ area: candidateA.metrics.area,
      outputStashCount: candidateA.search.quality?.outputStashCount,
      secondary: candidateA.search.quality?.secondary ?? candidateA.metrics.score },
    { area: candidateB.metrics.area, outputStashCount: candidateB.search.quality?.outputStashCount,
      secondary: candidateB.search.quality?.secondary ?? candidateB.metrics.score });
  });
  const winner = ranked[0];
  const best = winner?.checkpoint.best ?? null;
  const result = winner?.checkpoint.result ?? null;
  // 离线进程可能独立发现不同面积；合并采用胜出目标的唯一分配，异目标游标不能拼接。
  const schedule = winner?.checkpoint.parallel?.dimensionSchedule
    ?? (!best || base.dimensionSchedule?.targetArea === best.candidate.metrics.area ? base.dimensionSchedule : undefined);
  if (schedule) {
    const dimensions = partitionPlannerDimensions(schedule.targetArea, schedule.minimum);
    for (const shard of shards) {
      const source = files.find(file => file.checkpoint.parallel!.ownedShards.includes(shard.index))!.checkpoint.parallel!;
      const sameTarget = source.dimensionSchedule?.targetArea === schedule.targetArea
        && source.dimensionSchedule.minimum.width === schedule.minimum.width
        && source.dimensionSchedule.minimum.height === schedule.minimum.height;
      shard.dimensions = dimensions[shard.index]!;
      if (!sameTarget) { shard.dimensionCursor = 0; shard.pendingCandidate = null; }
    }
  } else for (const shard of shards) {
    // 新旧算法混合且胜出目标尚无分配：保留统计，下一次运行统一生成，不能拼接不同目标的清单。
    Reflect.deleteProperty(shard, "dimensions");
    Reflect.deleteProperty(shard, "dimensionCursor");
  }
  const taskId = base.originTaskId;
  const merged: BlueprintPlannerTaskFile = {
    ...first, taskId,
    checkpoint: { ...first.checkpoint, attempt, evaluations, best,
      result: result ? { ...result, taskId, folderId: null } : null,
      savedBlueprintId: null, pendingCandidate: null, legacyHistoryLength: 0,
      parallel: { ...base, dimensionSchedule: schedule, ownedShards: shards.map(shard => shard.index), shards } } satisfies PlannerCheckpoint,
    progress: { ...first.progress, taskId, status: "waiting", estimatedProgress: null,
      elapsedMs: Math.max(...files.map(file => file.progress.elapsedMs)),
      evaluatedProposals: evaluations, roundEvaluatedProposals: 0, candidateCount: attempt,
      validatedCandidateCount: base.baseValidatedCandidates + shards.reduce((sum, shard) => sum + shard.validatedCandidates, 0),
      bestArea: best?.candidate.metrics.area ?? null,
      areaHistory: best ? [{ evaluatedProposals: evaluations, bestArea: best.candidate.metrics.area }] : [],
      message: "分片结果已合并，可以继续计算或保存蓝图。" },
  };
  return parsePlannerTaskFile(merged, registry);
}

function assertJson(value: unknown, depth = 0): void {
  if (depth > 100) throw new Error("任务数据嵌套过深。");
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("任务包含非有限数值。");
  if (value && typeof value === "object") {
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new Error("任务必须是 JSON 数据。");
    for (const entry of Object.values(value)) assertJson(entry, depth + 1);
  }
}
