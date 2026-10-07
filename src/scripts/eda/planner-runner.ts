import type { PlannerSearchExperiment, PlannerSearchStatistics, PlannerSearchOptions } from "@/blueprint-planner/search-types";
import type { PlannerSearchProfile } from "@/blueprint-planner/search-profile";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cpus, availableParallelism } from "node:os";
import type { BlueprintPlannerItemPolicy, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { SimulationEngineKind } from "@/domain/simulation";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";
import { validatePlannerRequest } from "@/blueprint-planner/production-network";
import { meetsProductionTargets } from "@/blueprint-planner/verification";
import { PlannerCandidateError, PlanningBudgetExhausted } from "@/blueprint-planner/model";
import { NodePlannerClient } from "./node-planner-client";
import { createLayoutPreview, saveSuccessfulPlanning } from "./artifacts";
// AI-REMOVED 2026-10-05:
// Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// Replacement: @/scripts/eda/placement-scene
// Risk: 旧搜索种子失效，按算法版本重置。
// Human Review: Required
// Original code:
// import { createWorldDocument } from "@/domain/document/world-document";
import { createPlannerPlacementScene } from "@/scripts/eda/placement-scene";
import { createEditorStateReadWrite } from "@/editor/state-impl";
import { resolvePlacementValidations } from "@/editor/placement-validation";
import { edaOutputPath } from "./artifact-paths";
import type { PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import { createProposalCurve } from "./proposal-curve";
import { PlannerSearchPortfolio } from "@/blueprint-planner/search-portfolio";

/** 常驻执行器只复用 Registry、Host 和 Worker；每次规划仍拥有独立的输入、预算和仿真世界。 */
export class PlannerBatchSession {
  readonly workspace: WorkspaceContract = { state: createWorkspaceState(), registry: createRegistryContract(), app: null,
    editor: null, render: null, simulation: null, sync: null, audio: null, blueprintPlanner: null };
  readonly simulation = createSimulationHost(this.workspace, { engineKind: "dense-v2", workerMode: "runtime", blueprintDenseTickRate: 2 });
  readonly planner = new NodePlannerClient();
  busy = false;

  async dispose(): Promise<void> {
    try { await this.planner.dispose(); }
    finally { this.simulation.dispose(); }
  }
}

export interface PlannerBatchOptions {
  readonly strategy?: "baseline" | "compact";
  readonly seed?: PlannerSearchSeed;
  readonly attempts?: number;
  readonly localEvaluations?: number;
  readonly width?: number;
  readonly height?: number;
  readonly seconds?: number;
  readonly startVariant?: number;
  readonly candidateSeconds?: number;
  readonly verificationSeconds?: number;
  readonly engineKind: Extract<SimulationEngineKind, "dense-v2">;
  readonly profile?: Partial<PlannerSearchProfile>;
  readonly diagnostics?: boolean;
  readonly experiments?: readonly PlannerSearchExperiment[];
  readonly stashPackingVariant?: number;
  readonly conduitTopology?: PlannerSearchOptions["conduitTopology"];
}

export interface PlannerAttemptRecord {
  readonly variant: number;
  readonly solidOutput?: "warehouse" | "stash";
  readonly itemPolicies?: readonly BlueprintPlannerItemPolicy[];
  readonly evaluations: number;
  readonly evaluationAccounting: "exact" | "upper-bound";
  readonly elapsedMs: number;
  readonly outcome: "success" | "layout-failed" | "verification-failed" | "timeout";
  readonly generationMs: number;
  readonly verificationMs: number;
  readonly error?: string;
  readonly area?: number;
  readonly width?: number;
  readonly height?: number;
  readonly search?: PlannerSearchStatistics;
  readonly measuredOutputs?: readonly { id: string; perMinute: number }[];
  readonly artifactPath?: string;
  readonly diagnosticPath?: string;
  readonly constraints?: { readonly placementErrors: readonly string[]; readonly excessiveOperatingInputs: readonly string[] };
}

export async function runPlannerBatch(request: BlueprintPlannerRequest, options: PlannerBatchOptions, session?: PlannerBatchSession,
  onAttempt?: (record: PlannerAttemptRecord) => void | Promise<void>) {
  if (options.engineKind !== "dense-v2") throw new Error("EDA 测试固定使用 dense-v2 引擎。");
  if ((options.attempts === undefined) === (options.seconds === undefined)) throw new Error("必须且只能指定 attempts 或 seconds。");
  if (options.attempts !== undefined && (!Number.isInteger(options.attempts) || options.attempts <= 0)) throw new Error("attempts 必须是正整数。");
  if (options.seconds !== undefined && (!Number.isFinite(options.seconds) || options.seconds <= 0)) throw new Error("seconds 必须大于零。");
  if (options.startVariant !== undefined && (!Number.isInteger(options.startVariant) || options.startVariant < 0)) throw new Error("startVariant 必须是非负整数。");
  for (const limit of [options.candidateSeconds, options.verificationSeconds]) if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) throw new Error("每阶段时间必须大于零。");
  if (options.localEvaluations !== undefined && (!Number.isInteger(options.localEvaluations) || options.localEvaluations <= 0)) throw new Error("localEvaluations 必须是正整数。");
  if ((options.width === undefined) !== (options.height === undefined)) throw new Error("边界宽高必须同时指定。");
  for (const size of [options.width, options.height]) if (size !== undefined && (!Number.isInteger(size) || size <= 0)) throw new Error("边界宽高必须是正整数。");
  const execution = session ?? new PlannerBatchSession();
  if (execution.busy) throw new Error("规划执行器已有任务。");
  const { workspace, simulation, planner } = execution;
  let portfolio: PlannerSearchPortfolio;
  try {
    validatePlannerRequest(workspace.registry, request);
    portfolio = new PlannerSearchPortfolio(request, options.seed);
  }
  catch (error) { if (session === undefined) await execution.dispose(); throw error; }
  execution.busy = true;
  const startedAt = performance.now(), deadline = startedAt + (options.seconds ?? Infinity) * 1000;
  const records: PlannerAttemptRecord[] = [];
  let firstSuccessMs: number | null = null;
  let localEvaluations = 0;
  // AI-REMOVED 2026-09-30:
  // Reason: 全局单一种子会阻断另一种固体输出拓扑的独立续搜。
  // Trigger: 用户要求自动选择面积更小的固体输出方式。
  // Evidence: seed.requestKey 包含 solidOutput，两种拓扑不能共用种子。
  // Replacement: PlannerSearchPortfolio，浏览器 Host 与批量运行器共用。
  // Risk: Low；固定模式仍保留单种子。Human Review: Required
  // Original code:
  // let bestSeed = options.seed;
  // let bestArea = bestSeed ? bestSeed.width * bestSeed.height : Infinity;
  try {
    for (let index = 0; index < (options.attempts ?? Infinity) && performance.now() < deadline; index++) {
      if (localEvaluations >= (options.localEvaluations ?? Infinity)) break;
      const variant = (options.startVariant ?? 0) + index;
      const selection = portfolio.next(variant, options.strategy !== "baseline");
      const solidOutput = selection.request.options.solidOutput as "warehouse" | "stash";
      const itemPolicies = selection.request.options.itemPolicies;
      const generationStart = performance.now();
      let generationMs = 0, verificationMs = 0;
      let attemptEvaluations = 0;
      let evaluationAccounting: PlannerAttemptRecord["evaluationAccounting"] = "exact";
      let generatedSearch: PlannerSearchStatistics | undefined;
      const remainingEvaluations = Math.min(50_000, Math.ceil(((options.localEvaluations ?? Infinity) - localEvaluations)
        / (options.localEvaluations !== undefined && options.attempts !== undefined ? options.attempts - index : 1)));
      try {
        const candidate = await planner.build(selection.request, selection.variant,
          Math.min((options.candidateSeconds ?? 30) * 1000, deadline - performance.now()), {
            maxEvaluations: remainingEvaluations,
            strategy: options.strategy,
            seed: selection.seed,
            continuationStep: selection.continuationStep,
            maximumArea: selection.maximumArea,
            profile: options.profile,
            diagnostics: options.diagnostics,
            experiments: options.experiments,
            stashPackingVariant: options.stashPackingVariant,
            conduitTopology: options.conduitTopology,
            ...(options.width === undefined ? {} : { outline: { width: options.width, height: options.height! } }),
          });
        localEvaluations += candidate.search.evaluations;
        attemptEvaluations = candidate.search.evaluations;
        generatedSearch = candidate.search;
        generationMs = performance.now() - generationStart;
        if (performance.now() >= deadline) throw new PlanningBudgetExhausted();
        const verificationStart = performance.now();
        workspace.registry.baseDefinitions = [...workspace.registry.baseDefinitions.filter(base => base.id !== "eda-batch-land"),
          { id: "eda-batch-land", name: "空地", tag: "武陵", tags: ["武陵"], placeableArea: { width: 10000, height: 10000 },
            outerRing: { top: 0, right: 0, bottom: 0, left: 0 }, builtinEntities: [] }];
// AI-REMOVED 2026-10-05:
// Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// Replacement: @/scripts/eda/placement-scene
// Risk: 旧搜索种子失效，按算法版本重置。
// Human Review: Required
// Original code:
//         const document = createWorldDocument({ baseId: "eda-batch-land" });
//         Object.assign(document, { entities: candidate.execution.blueprint.entities, entityOrder: candidate.execution.blueprint.entityOrder,
//           slotLinks: candidate.execution.blueprint.slotLinks });
//         // 2026-10-05：交付蓝图不含存取线，施工检查按用户补齐外部存取线后的场景进行。
//         const buses = candidate.execution.scene.externalEntities.filter(entity => entity.definitionId === "log_hongs_bus" || entity.definitionId === "log_hongs_bus_source");
//         document.entities = { ...document.entities, ...Object.fromEntries(buses.map(entity => [entity.id, entity])) };
//         document.entityOrder = [...document.entityOrder, ...buses.map(entity => entity.id)];
        const document = createPlannerPlacementScene(workspace.registry, candidate.execution, "eda-batch-land");
        const placements = resolvePlacementValidations({ document, workspace, state: createEditorStateReadWrite() });
        const placementErrors = Object.entries(placements).filter(([, value]) => !value.canPlace).map(([id]) => id);
        const report = await simulation.actions.runBlueprint({ ...candidate.execution,
          maxWallTimeMs: Math.min((options.verificationSeconds ?? 180) * 1000, deadline - performance.now()),
        });
        verificationMs = performance.now() - verificationStart;
        const excessiveOperatingInputs = candidate.supplyAudit.operatingLimits.filter(limit => {
          const measured = report.probes.find(probe => probe.id === `operating:${limit.entityId}`);
          return measured === undefined || measured.perMinute > limit.perMinute + 1e-6;
        }).map(limit => limit.entityId);
        const constraints = { placementErrors, excessiveOperatingInputs };
        const success = meetsProductionTargets(request, report) && placementErrors.length === 0 && excessiveOperatingInputs.length === 0;
        if (success) firstSuccessMs ??= performance.now() - startedAt;
        if (success) portfolio.remember(candidate.seed);
        const artifactPath = success ? await saveSuccessfulPlanning(workspace.registry, `${request.plan.name}-${variant}`,
          candidate.execution.blueprint, request, { variant, solidOutput, itemPolicies, generationMs, verificationMs, engineKind: options.engineKind, ticksPerSecond: 2,
            metrics: candidate.metrics, search: candidate.search, supplyAudit: candidate.supplyAudit, constraints, report }) : undefined;
        if (artifactPath && candidate.seed) await writeFile(resolve(artifactPath, "search-seed.json"), JSON.stringify(candidate.seed, null, 2));
        const diagnosticPath = success ? undefined : edaOutputPath("runs/candidates", `${Date.now()}-${process.pid}-${variant}`);
        if (diagnosticPath !== undefined) {
          await mkdir(diagnosticPath, { recursive: true });
          await Promise.all([
            writeFile(resolve(diagnosticPath, "candidate.json"), JSON.stringify(candidate, null, 2)),
            writeFile(resolve(diagnosticPath, "validation.json"), JSON.stringify(report, null, 2)),
            writeFile(resolve(diagnosticPath, "preview.svg"), createLayoutPreview(workspace.registry, candidate.execution.blueprint)),
          ]);
        }
        records.push({ variant, solidOutput, itemPolicies, generationMs, verificationMs, evaluations: attemptEvaluations, evaluationAccounting,
          elapsedMs: performance.now() - startedAt,
          outcome: success ? "success" : report.status === "timeout" ? "timeout" : "verification-failed",
          area: candidate.metrics.area, width: candidate.metrics.width, height: candidate.metrics.height, search: candidate.search,
          measuredOutputs: report.probes.filter(probe => request.plan.targets.some(target => target.itemId === probe.id)), artifactPath, diagnosticPath, constraints,
          error: success ? undefined : report.diagnostics.find((entry) => entry.severity === "error")?.message
            ?? (placementErrors.length ? `设备放置不合法：${placementErrors.join(",")}` : excessiveOperatingInputs.length ? "运行消耗超过准入口限额"
              : report.status === "timeout" ? "仿真验证达到时间预算" : "实测产量不足或存在缺电设备"),
        });
      } catch (error) {
        if (!(error instanceof PlannerCandidateError) && !(error instanceof PlanningBudgetExhausted)) throw error;
        const search = error instanceof PlannerCandidateError ? error.search : generatedSearch;
        if (generatedSearch === undefined) {
          attemptEvaluations = search?.evaluations ?? remainingEvaluations;
          evaluationAccounting = search === undefined ? "upper-bound" : "exact";
          localEvaluations += attemptEvaluations;
        }
        records.push({ variant, solidOutput, itemPolicies, search, evaluations: attemptEvaluations, evaluationAccounting, elapsedMs: performance.now() - startedAt,
          generationMs: generationMs || performance.now() - generationStart, verificationMs,
          outcome: error instanceof PlanningBudgetExhausted ? "timeout" : "layout-failed", error: error.message });
      }
      await onAttempt?.(records[records.length - 1]!);
    }
  } finally { execution.busy = false; if (session === undefined) await execution.dispose(); }
  const elapsedMs = performance.now() - startedAt;
  return { input: request, options, elapsedMs, localEvaluations, firstSuccessMs, attempts: records.length,
    successes: records.filter((entry) => entry.outcome === "success").length,
    attemptsPerMinute: records.length * 60_000 / elapsedMs, workerThreadId: planner.threadId,
    environment: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, availableParallelism: availableParallelism(), node: process.version, engineKind: options.engineKind, ticksPerSecond: 2 },
    records, proposalCurve: createProposalCurve(records),
  };
}
