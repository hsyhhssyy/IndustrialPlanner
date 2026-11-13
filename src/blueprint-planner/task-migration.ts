import { BLUEPRINT_SCHEMA_VERSION, type BlueprintDocument } from "@/domain/document/blueprint-document";
import type { SimulationBlueprintRunReport, SimulationBlueprintRunRequest } from "@/domain/simulation";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { isBlueprintRecognitionRequest, normalizePlannerTaskTitle } from "@/shared/planner-task";
import { emptyPlannerCheckpoint, parsePlannerTaskFile, validateTaskRequest, type PlannerCheckpoint } from "./task-checkpoint";
import { PLANNER_ALGORITHM_VERSION } from "./search-policy";
import { migratePlannerFailureSummary } from "./failure-summary";
import { assertBlueprintPreserved } from "./blueprint-constraints";
import { withBlueprintConverterStartup } from "./blueprint-startup";
import { assertBlueprintRecognition, assertBlueprintSteadyState } from "./blueprint-analysis";
import { blueprintRecognitionScene } from "./blueprint-scene";
import { identifyBlueprintNetwork, reconstructVerifiedPlannerSeed } from "./blueprint-network";
import { assertPlannerWarehousePorts, assertPlannerCandidateBounds, meetsOperatingLimits, meetsProductionTargets, plannerOutputPerMinute } from "./verification";
import type { BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { PlannerBoundary } from "./boundary";
import type { PlannerCandidate } from "./candidate";
import type { PlannerNetwork } from "./model";
import { restorePlannerOutputRequest } from "./output-policy";
import { createPlainNode } from "./placement";
import { boundedPlannerScore, measurePlannerQuality } from "./quality";
import { capturePlannerSeed, plannerRequestKey, restorePlannerSeed, type PlannerSearchSeed } from "./search-seed";
import { stashSubmissionProbe } from "./stash-submission";

const isBus = (definitionId: string) => definitionId === "log_hongs_bus" || definitionId === "log_hongs_bus_source";

/** 只移除盒外设施并整体平移，不替旧布局移动口位；不满足新边界的布局不能作为最优解。 */
// AI-CORRECTION 2026-10-11：同时移除旧排空夹具、补齐自动规划遗漏的提交默认配置，再采集真实提交配方运行证据；不覆盖显式配置。
export function migratePlannerCandidate(registry: RegistryContract, request: BlueprintPlannerRequest,
  original: PlannerCandidate): PlannerCandidate | null {
  const candidate = structuredClone(original);
  const blueprint = candidate.execution.blueprint;
  const entities = blueprint.entityOrder.map(id => blueprint.entities[id]!).filter(entity => !isBus(entity.definitionId));
  if (!entities.length) return null;
  // 旧自动规划漏写放置默认配置；只补缺省字段，不覆盖显式关闭提交的配置，也不改用户原图。
  if (!request.blueprintSource) for (const entity of entities.filter(entity => entity.definitionId === "storager_1")) {
    if (entity.config.channelRecipes !== undefined) continue;
    entity.config.channelRecipes = structuredClone(registry.queries.findEntityDefinition(entity.definitionId)!.placementDefaults?.config?.channelRecipes);
    const node = candidate.seed?.network.nodes.find(node => node.entity.id === entity.id);
    if (node) node.entity.config.channelRecipes = structuredClone(entity.config.channelRecipes);
  }
  const rectangles = entities.map(entity => resolveEntityGridRect({ entity,
    definition: registry.queries.findEntityDefinition(entity.definitionId)! }));
  const origin = { x: Math.min(...rectangles.map(rect => rect.x)), y: Math.min(...rectangles.map(rect => rect.y)) };
  const width = Math.max(...rectangles.map(rect => rect.x + rect.width)) - origin.x;
  const height = Math.max(...rectangles.map(rect => rect.y + rect.height)) - origin.y;
  const area = width * height;
  if (![origin.x, origin.y, width, height, area].every(Number.isSafeInteger) || width <= 0 || height <= 0) return null;
  const translate = (point: { x: number; y: number }) => ({ x: point.x - origin.x, y: point.y - origin.y });
  for (const entity of entities) entity.position = translate(entity.position);
  blueprint.entities = Object.fromEntries(entities.map(entity => [entity.id, entity]));
  blueprint.entityOrder = entities.map(entity => entity.id);
  blueprint.initialGridPoint = { x: 0, y: 0 };
  const connections = candidate.connections.map(connection => ({ ...connection, position: translate(connection.position) }));
  // 边界检查直接使用交付实体，避免缺失或过期种子掩盖仓库口和外接入口。
  const network: PlannerNetwork = { request, slotLinks: blueprint.slotLinks, initialSlots: [], preferredGasCount: 0,
    nodes: entities.map(entity => ({ ...createPlainNode(registry, entity.definitionId, entity.id, "logistics"), entity,
      external: connections.some(connection => connection.direction === "input"
        && connection.position.x === entity.position.x && connection.position.y === entity.position.y) })) };
  const boundary = new PlannerBoundary(registry, network, { width, height });
  const resolved = boundary.resolve(network.nodes.map(node => ({ ...node.entity.position, rotation: node.entity.rotation })));
  if (resolved.violations !== 0 || resolved.busMask === null) return null;
  const fixtures = boundary.fixtures(resolved.busMask);
  const externalEntities = (candidate.execution.scene?.externalEntities ?? []).filter(entity => !isBus(entity.definitionId)
    && !entity.id.startsWith("__eda_fixture_") && !entity.id.startsWith("eda-validation-drain-") && !entity.id.startsWith("eda-validation-sink-"))
    .map(entity => ({ ...entity, position: translate(entity.position) }));
  let seed: PlannerCandidate["seed"];
  let quality = measurePlannerQuality(registry, network, entities, [], area, width, height);
  if (candidate.seed) {
    const old = candidate.seed;
    const seedOptions = { ...old.network.request.options,
      warehouseBus: (old.network.request.options.warehouseBus as string) === "free" ? "corner" as const : old.network.request.options.warehouseBus };
    const seedRequest = restorePlannerOutputRequest(request, seedOptions);
    const keyedRequest = JSON.parse(old.requestKey) as BlueprintPlannerRequest;
    if ((keyedRequest.options.warehouseBus as string) === "free") Object.assign(keyedRequest.options, { warehouseBus: "corner" });
    if (plannerRequestKey(keyedRequest) !== plannerRequestKey(seedRequest)) throw new Error("旧最优布局的种子与输入配置不一致。");
    const nodes = old.network.nodes.filter(node => !isBus(node.entity.definitionId));
    for (const node of nodes) {
      const entity = blueprint.entities[node.entity.id];
      const position = translate(node.entity.position);
      if (!entity || entity.definitionId !== node.entity.definitionId || entity.rotation !== node.entity.rotation
        || entity.position.x !== position.x || entity.position.y !== position.y) throw new Error("旧最优布局的种子与蓝图不一致。");
    }
    const restored = restorePlannerSeed(registry, seedRequest, { ...old, requestKey: plannerRequestKey(seedRequest),
      network: { ...old.network, request: { ...old.network.request, options: seedOptions }, nodes } });
    seed = capturePlannerSeed(seedRequest, restored.network, restored.wires, old.routes, width, height, origin);
    const current = restorePlannerSeed(registry, seedRequest, seed);
    quality = measurePlannerQuality(registry, current.network, entities, seed.routes, area, width, height);
  } else if (candidate.search.quality) {
    // 早期结果可能没有续搜种子：保留已验证的物流成本，只重算几何项，后续从新布局搜索。
    // AI-CORRECTION 2026-11-07：统一恢复入口在重新验收后从成品重建当前种子，再落盘并启动续搜。
    const previous = candidate.search.quality;
    const aspect = (w: number, h: number) => (Math.max(w / h, h / w) - 1) ** 2;
    quality = { ...previous, occupiedCells: quality.occupiedCells, utilization: quality.utilization,
      adjacencyPairs: quality.adjacencyPairs, secondary: previous.secondary
        - aspect(candidate.metrics.width, candidate.metrics.height) + aspect(width, height)
        + (previous.adjacencyPairs - quality.adjacencyPairs) * 0.2 };
  }
  const sides = ["上", "右", "下", "左"].filter((_, side) => resolved.busMask! & (1 << side));
  blueprint.description = `${blueprint.description ?? ""}\n按当前规则重算：${width} × ${height}；存取线${sides.length ? `请在包围盒外${sides.join("、")}侧自行放置` : "无需接入"}。`;
  return { ...candidate, outlineOrigin: { x: 0, y: 0 }, seed, connections, search: { ...candidate.search, quality },
    metrics: { ...candidate.metrics, width, height, area, entityCount: entities.length, score: boundedPlannerScore(area, quality.secondary) },
    execution: { ...candidate.execution, blueprint, collectAnalysis: true,
      probes: [...candidate.execution.probes.filter(probe => !probe.id.startsWith("stash-submit:")),
        ...entities.filter(entity => entity.definitionId === "storager_1").map(entity => {
          const input = candidate.seed?.network.nodes.find(node => node.entity.id === entity.id)?.inputs[0];
          const itemId = input?.itemId ?? candidate.execution.probes.find(probe => probe.direction === "input" && probe.entityIds.includes(entity.id))?.itemId;
          if (!itemId) throw new Error("旧协议储存箱缺少物品证据，无法重新验收。");
          return stashSubmissionProbe(entity.id, itemId);
        })], scene: { ...candidate.execution.scene, externalEntities: [...externalEntities, ...fixtures] } } };
}

/** 内嵌蓝图有自己的版本；空升级不重置算法状态，也不执行旧算法的几何转换。 */
// 订正 2026-10-11：同步补齐旧任务的任意摆放选项与尺寸算法版本，不改变旧任务的几何规则。
// AI-CORRECTION 2026-10-15：不改算法版本；旧缓存原样携带到用户继续时统一丢弃，不解析其结构。
export function migrateTaskBlueprintSchemas(value: BlueprintPlannerTaskFile): BlueprintPlannerTaskFile {
  const file: { -readonly [K in keyof BlueprintPlannerTaskFile]: BlueprintPlannerTaskFile[K] } = structuredClone(value);
  // 2026-11-07：早期导出用 null 表示未命名；格式校验之前统一归一为缺省标题。
  file.title = normalizePlannerTaskTitle(file.title ?? undefined);
  const options = (value: BlueprintPlannerRequest["options"]) => value.warehousePortPlacement === undefined
    ? { ...value, warehousePortPlacement: "any" as const } : value;
  file.request = { ...file.request, options: options(file.request.options) };
  // AI-REMOVED 2026-10-15:
  // Reason: 算法版本不同统一丢弃搜索缓存，不逐版本伪装为另一版本。
  // Trigger: 用户要求任何算法更新都从最优面积重新调度。
  // Evidence: 旧种子和分片结构无需被新算法理解。
  // Replacement: 下方版本不同的成果提取。
  // Risk: 未形成成果的进展丢弃；Human Review: Required。
  // Original code:
  // if (["dimension-shards-1", "warehouse-port-shards-1"].includes(file.algorithmVersion)) file.algorithmVersion = "seeded-strategies-1";
  const upgrade = (blueprint: BlueprintDocument): BlueprintDocument => {
    if (blueprint.schemaVersion === BLUEPRINT_SCHEMA_VERSION) return blueprint;
    const next = normalizeBlueprintDocument(blueprint);
    if (next === null) throw new Error("计算任务中的蓝图版本无法升级，原始任务已保留。");
    return next;
  };
  if (isBlueprintRecognitionRequest(file.request)) {
    file.request = { ...file.request, input: { ...file.request.input, blueprint: upgrade(file.request.input.blueprint) } };
    return file;
  }
  const upgradeRequest = (request: BlueprintPlannerRequest): BlueprintPlannerRequest => ({ ...request, options: options(request.options),
    ...(request.blueprintSource ? { blueprintSource: { ...request.blueprintSource, blueprint: upgrade(request.blueprintSource.blueprint) } } : {}) });
  // 指纹保存原始请求，network.request 可能已被归一化；分别升级，不能用网络请求重建指纹。
  const upgradeKey = (key: string): string => {
    const request = JSON.parse(key) as BlueprintPlannerRequest;
    const upgraded = upgradeRequest(request);
    return upgraded === request ? key : plannerRequestKey(upgraded);
  };
  file.request = upgradeRequest(file.request);
  // AI-REMOVED 2026-10-15:
  // Reason: Schema 转换先于任务恢复，过早删除缓存会破坏损坏任务的原文保护。
  // Trigger: task-checkpoint 的损坏历史导出回归失败。
  // Evidence: 未完成恢复即丢失 attempt、portfolio 等原始字段。
  // Replacement: restorePlannerTaskFile 原子重置；此处旧缓存不解析、不迁移。
  // Risk: 用户继续前仍保存旧缓存；Human Review: Required
  // Original code:
  //   if (file.algorithmVersion !== PLANNER_ALGORITHM_VERSION) {
  //     // 只读取成果的公开场景和验收约束；旧 seed、portfolio、parallel 的形状完全不参与转换。
  //     const previous = file.checkpoint as PlannerCheckpoint | undefined;
  //     const original = previous?.best?.candidate;
  //     const best = original ? { report: previous!.best!.report, candidate: {
  //       outlineOrigin: original.outlineOrigin,
  //       execution: { ...original.execution, blueprint: upgrade(original.execution.blueprint) },
  //       metrics: original.metrics, connections: original.connections, supplyAudit: original.supplyAudit,
  //       search: { seed: 0, evaluationLimit: 0, evaluations: 0, acceptedMoves: 0, routingAttempts: 0,
  //         initialWireLength: 0, finalWireLength: 0, outline: { width: original.metrics.width, height: original.metrics.height } },
  //     } satisfies PlannerCandidate } : null;
  //     file.checkpoint = { best, savedBlueprintId: previous?.savedBlueprintId ?? null };
  //     return file;
  //   }
  if (file.algorithmVersion !== PLANNER_ALGORITHM_VERSION) {
    const point = file.checkpoint as PlannerCheckpoint | undefined;
    const best = point?.best;
    if (best) file.checkpoint = { ...point, best: { ...best, candidate: { ...best.candidate,
      execution: { ...best.candidate.execution, blueprint: upgrade(best.candidate.execution.blueprint) } } } };
    return file;
  }
  const seed = (value: PlannerSearchSeed): PlannerSearchSeed => {
    const request = upgradeRequest(value.network.request);
    return { ...value, network: { ...value.network, request }, requestKey: upgradeKey(value.requestKey) };
  };
  const candidate = (value: PlannerCandidate | null | undefined): PlannerCandidate | null => value == null ? null : ({
    ...value, execution: { ...value.execution, blueprint: upgrade(value.execution.blueprint) },
    seed: value.seed ? seed(value.seed) : value.seed,
  });
  const point = file.checkpoint as PlannerCheckpoint;
  if (!point) return file;
  const pools = (portfolio: PlannerCheckpoint["portfolio"] | undefined) => portfolio === undefined ? portfolio : ({
    ...portfolio, pools: portfolio.pools.map(pool => {
      if (pool.entries.some(entry => entry.seed.requestKey !== pool.key)) throw new Error("检查点与当前生产方案不匹配。");
      return { ...pool, key: upgradeKey(pool.key), entries: pool.entries.map(entry => ({ ...entry, seed: seed(entry.seed) })) };
    }),
  });
  file.checkpoint = { ...point,
    ...(point.blueprintBaseline ? { blueprintBaseline: { ...point.blueprintBaseline, candidate: candidate(point.blueprintBaseline.candidate)! } } : {}),
    best: point.best ? { ...point.best, candidate: candidate(point.best.candidate)! } : point.best,
    pendingCandidate: candidate(point.pendingCandidate),
    result: point.result ? { ...point.result, blueprint: upgrade(point.result.blueprint) } : point.result,
    portfolio: pools(point.portfolio),
    ...(point.parallel ? { parallel: { ...point.parallel, requestKey: upgradeKey(point.parallel.requestKey),
      shards: point.parallel.shards.map(shard => ({ ...shard, portfolio: pools(shard.portfolio), pendingCandidate: candidate(shard.pendingCandidate) })) } } : {}),
  };
  return file;
}

/** 算法版本不同只恢复任务事实和成果；任何旧版计算缓存都不能影响新调度。 */
export async function restorePlannerTaskFile(value: BlueprintPlannerTaskFile, registry: RegistryContract,
  verify?: (execution: SimulationBlueprintRunRequest) => Promise<SimulationBlueprintRunReport>,
): Promise<BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest; checkpoint: PlannerCheckpoint }> {
  if (value?.formatVersion !== 1 || typeof value.algorithmVersion !== "string" || !value.algorithmVersion) {
    throw new Error("任务格式或算法版本无效。");
  }
  const changed = value.algorithmVersion !== PLANNER_ALGORITHM_VERSION;
  // 先从旧任务提取稳定成果，完全不读取旧计算缓存；仅在整次恢复成功后持久化新检查点。
  const previous = changed ? value.checkpoint as PlannerCheckpoint | undefined : undefined;
  const original = previous?.best?.candidate;
  const retained = original ? { report: previous!.best!.report, candidate: {
    outlineOrigin: original.outlineOrigin, execution: original.execution,
    metrics: original.metrics, connections: original.connections, supplyAudit: original.supplyAudit,
    search: { seed: 0, evaluationLimit: 0, evaluations: 0, acceptedMoves: 0, routingAttempts: 0,
      initialWireLength: 0, finalWireLength: 0, outline: { width: original.metrics.width, height: original.metrics.height } },
  } satisfies PlannerCandidate } : null;
  const normalized = migrateTaskBlueprintSchemas(changed
    ? { ...value, checkpoint: { best: retained, savedBlueprintId: previous?.savedBlueprintId ?? null } } : value);
  if (!changed) {
    const file = parsePlannerTaskFile(normalized, registry);
    if (!file.request.blueprintSource || !verify) return file;
    const source = file.request.blueprintSource;
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
  const file = normalized as BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest; checkpoint: PlannerCheckpoint };
  if ((file.request.options.warehouseBus as string) === "free") Object.assign(file.request.options, { warehouseBus: "corner" });
  validateTaskRequest(registry, file.request);
  const history = file.progress.areaHistory ?? [];
  let checkpoint: PlannerCheckpoint = { ...emptyPlannerCheckpoint(), attempt: file.progress.candidateCount,
    evaluations: file.progress.evaluatedProposals, legacyHistoryLength: history.length,
    failureSummary: migratePlannerFailureSummary(previous?.failureSummary, value.algorithmVersion,
      PLANNER_ALGORITHM_VERSION, file.progress.candidateCount, file.progress.evaluatedProposals) };
  if (file.request.blueprintSource) {
    if (!verify) throw new Error("算法更新后需要重新识别原始蓝图，请通过规划器继续任务。");
    const source = file.request.blueprintSource;
    let execution = blueprintRecognitionScene(registry, source);
    let report = await verify(execution);
    if (report.analysis) {
      execution = withBlueprintConverterStartup(registry, source, file.request.options, report.analysis, execution);
      report = await verify(execution);
    }
    const baseline = identifyBlueprintNetwork(registry, source, file.request.options, execution, report);
    if (JSON.stringify(baseline.request.plan) !== JSON.stringify(file.request.plan)) throw new Error("原图产率基线变化，请重新识别蓝图。");
    checkpoint = { ...checkpoint, blueprintBaseline: { candidate: baseline.candidate, report } };
  }
  let message = "算法已更新：历史统计与曲线已保留，搜索状态已重建。";
  if (file.checkpoint?.best) {
    if (!verify) throw new Error("旧最优蓝图需要仿真验收后才能恢复，请通过规划器导入任务。");
    let candidate = migratePlannerCandidate(registry, file.request, file.checkpoint.best.candidate);
    if (candidate) {
      assertPlannerCandidateBounds(registry, candidate);
      const report = await verify(candidate.execution);
      if (report.status !== "completed") throw new Error("最优蓝图验收未完成，原始任务已保留。");
      if (meetsProductionTargets(file.request, report) && meetsOperatingLimits(candidate.supplyAudit, report)) {
        assertPlannerWarehousePorts(registry, file.request, candidate);
        if (file.request.blueprintSource) {
          assertBlueprintRecognition(registry, { ...file.request.blueprintSource, blueprint: candidate.execution.blueprint }, report);
          assertBlueprintSteadyState(registry, report, candidate.execution.probes);
          assertBlueprintPreserved(registry, file.request, checkpoint.blueprintBaseline!.candidate.seed!, candidate.execution.blueprint);
        }
        // 2026-11-07：在启动前重建完整种子，确保持久化的是可直接继续的检查点。
        if (!file.request.blueprintSource) candidate = { ...candidate,
          seed: reconstructVerifiedPlannerSeed(registry, file.request, candidate, report) };
        checkpoint.best = { candidate, report };
        checkpoint.savedBlueprintId = file.checkpoint.savedBlueprintId;
        checkpoint.result = { taskId: file.taskId, blueprint: candidate.execution.blueprint, folderId: null,
          manualTransform: candidate.manualTransform, metrics: candidate.metrics, connections: candidate.connections,
          // 2026-10-16：迁移成果也按净产率交付，避免把同物品外部输入计为新增产出。
          measuredOutputs: report.probes.filter(probe => file.request.plan.targets.some(target => target.itemId === probe.id))
            .map(probe => ({ itemId: probe.id, perMinute: plannerOutputPerMinute(file.request, report, probe.id) })), warmupSeconds: candidate.execution.warmupSeconds,
          observationSeconds: report.observationSeconds, elapsedMs: file.progress.elapsedMs };
      }
    }
    if (!checkpoint.best) message = "历史统计与曲线已保留；旧成果未通过当前验收，将重新寻找有效布局。";
  }
  return parsePlannerTaskFile({ ...file, algorithmVersion: PLANNER_ALGORITHM_VERSION, checkpoint,
    progress: { ...file.progress, status: "waiting", phase: "preparing", estimatedProgress: null, activeWorkerCount: 0,
      roundEvaluatedProposals: 0, bestArea: checkpoint.best?.candidate.metrics.area ?? null, areaHistory: history, message } }, registry);
}
